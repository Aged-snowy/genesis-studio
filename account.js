// Genesis Studio accounts. Optional: the whole page works without them.
// Passwords never touch this code beyond being handed to the sign in service over HTTPS.
// The service stores only a salted bcrypt hash. Each person can only ever read or change
// their own rows, which the database itself enforces (row level security), not this page.
(() => {
  "use strict";
  const C = window.GENESIS_CONFIG || {};
  const q = s => document.querySelector(s);
  const here = location.origin + location.pathname;

  const url = String(C.supabaseUrl || "").trim().replace(/\/+$/, "");
  const key = String(C.supabaseKey || "").trim();
  const ready = /^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(url) && key.length > 20 && window.supabase && typeof window.supabase.createClient === "function";
  if (!ready) { q("#acctOff").hidden = false; q("#acctLink").textContent = "About accounts"; return; }

  const sb = window.supabase.createClient(url, key, {
    auth: { flowType: "pkce", persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: "genesisStudio.auth" },
  });

  // ---------- messages ----------
  const msgEl = q("#acctMsg");
  function tell(text, bad) {
    msgEl.classList.toggle("bad", !!bad);
    msgEl.textContent = "";
    setTimeout(() => { msgEl.textContent = text; }, 30);
  }
  function friendly(err) {
    const code = (err && (err.code || err.error_code)) || "";
    const m = String((err && err.message) || "");
    if (code === "invalid_credentials" || /invalid login credentials/i.test(m)) return "That email and password don't match an account. Check them and try again, or choose Forgot my password.";
    if (code === "email_not_confirmed" || /not confirmed/i.test(m)) return "Your account isn't confirmed yet. Open the link in the email we sent you, then sign in.";
    if (code === "weak_password" || /weak|pwned|leaked/i.test(m)) return "That password is too easy to guess, or has shown up in a data leak somewhere else. Please choose a different one.";
    if (code === "user_already_exists" || /already registered/i.test(m)) return "That email may already have an account. Try signing in, or choose Forgot my password.";
    if (code === "same_password") return "That is already your password. Choose a different one.";
    if (/rate|too many/i.test(code + m)) return "Too many tries in a short time. Please wait a few minutes and try again.";
    if (code === "reauthentication_needed") return "For your safety, please sign out, then use Forgot my password to choose a new one.";
    if (code === "session_not_found" || code === "refresh_token_not_found" || /jwt|session/i.test(m)) return "You've been signed out. Please sign in again.";
    if (/fetch|network|load failed|offline/i.test(m) || !navigator.onLine) return "Couldn't reach the internet. Your library is still saved on this device. Try again when you're online.";
    return "Something went wrong" + (m ? ": " + m.slice(0, 160) : ".") + " Please try again.";
  }

  // ---------- checks before anything is sent ----------
  const emailOk = e => /^[^\s@<>()[\]\\,;:"]{1,64}@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/.test(e) && e.length <= 254;
  const COMMON = new Set(["password", "password1", "password12", "password123", "1234567890", "12345678910", "qwertyuiop", "minecraft", "minecraft1", "minecraft123", "iloveyou12", "letmein123", "football12", "baseball12", "abcdefghij", "0987654321", "1111111111", "passw0rd12", "welcome123", "genesis123", "dragon1234", "creeper123", "qwerty1234", "asdfghjkl1", "trustno1234"]);
  function passProblem(pw, pw2, email) {
    if (pw.length < 10) return "Your password needs at least 10 characters.";
    if (pw.length > 128) return "Your password can be at most 128 characters.";
    if (/^(.)\1+$/.test(pw)) return "Your password can't be one character repeated.";
    const low = pw.toLowerCase();
    if (COMMON.has(low)) return "That password is one of the most common ones and easy to guess. Please choose another.";
    const user = String(email || "").toLowerCase().split("@")[0];
    if (user.length >= 4 && low.includes(user)) return "Your password shouldn't contain your email name.";
    if (pw2 !== undefined && pw !== pw2) return "The two passwords don't match. Type them again.";
    return "";
  }

  // ---------- small helpers ----------
  const val = id => q("#" + id).value;
  function busy(form, on) { for (const el of form.querySelectorAll("button, input")) el.disabled = on; }
  async function guard(form, work) {
    busy(form, true);
    try { await work(); } catch (e) { tell(friendly(e), true); } finally { busy(form, false); }
  }
  function clearPasswords() { for (const el of document.querySelectorAll("#account input[type=password], #account input[data-was=password]")) el.value = ""; }
  for (const box of document.querySelectorAll("#account input[data-show]")) {
    box.addEventListener("change", () => {
      for (const id of box.dataset.show.split(" ")) { const el = q("#" + id); el.type = box.checked ? "text" : "password"; if (box.checked) el.dataset.was = "password"; }
    });
  }
  function hidePasswords() {
    for (const box of document.querySelectorAll("#account input[data-show]")) { box.checked = false; for (const id of box.dataset.show.split(" ")) q("#" + id).type = "password"; }
  }

  // ---------- which form shows ----------
  const tabs = [...document.querySelectorAll("#acctOut [data-form]")];
  function showForm(id, focus) {
    for (const t of tabs) { const me = t.dataset.form === id; t.setAttribute("aria-pressed", me ? "true" : "false"); q("#" + t.dataset.form).hidden = !me; }
    if (focus) { const first = q("#" + id + " input"); if (first) first.focus(); }
  }
  for (const t of tabs) t.addEventListener("click", () => { tell(""); showForm(t.dataset.form, true); });

  let recovering = false, user = null;
  function render() {
    const inside = !!user && !recovering;
    q("#acctOut").hidden = !!user || recovering;
    q("#acctIn").hidden = !inside;
    q("#fNew").hidden = !recovering;
    const st = q("#acctStatus");
    if (inside) {
      q("#who").textContent = "Signed in as " + (user.email || "you") + ".";
      st.textContent = "Signed in as " + (user.email || "you") + ". Your library is kept safe online.";
      st.hidden = false;
      q("#acctLink").textContent = "My account";
    } else {
      st.hidden = true;
      q("#acctLink").textContent = "Account, optional";
    }
  }

  // ---------- forms ----------
  q("#fIn").addEventListener("submit", e => {
    e.preventDefault(); const f = e.currentTarget;
    const email = val("inEmail").trim().toLowerCase(), pw = val("inPass");
    if (!emailOk(email)) return tell("Please type your email address, like name@example.com.", true);
    if (!pw) return tell("Please type your password.", true);
    guard(f, async () => {
      const { error } = await sb.auth.signInWithPassword({ email, password: pw });
      if (error) throw error;
      clearPasswords(); hidePasswords();
      tell("Welcome back. You're signed in.");
    });
  });

  q("#fUp").addEventListener("submit", e => {
    e.preventDefault(); const f = e.currentTarget;
    const email = val("upEmail").trim().toLowerCase(), pw = val("upPass"), pw2 = val("upPass2");
    if (!emailOk(email)) return tell("Please type your email address, like name@example.com.", true);
    const prob = passProblem(pw, pw2, email); if (prob) return tell(prob, true);
    guard(f, async () => {
      const { data, error } = await sb.auth.signUp({ email, password: pw, options: { emailRedirectTo: here } });
      if (error) throw error;
      clearPasswords(); hidePasswords();
      // The same message whether or not the email already had an account, so nobody can use this form to find out who has one.
      if (data && data.session) tell("Your account is ready and you're signed in.");
      else { tell("Almost done. We sent a link to " + email + ". Open it to finish creating your account, then come back and sign in. If it isn't there in a few minutes, look in your spam folder."); showForm("fIn"); q("#inEmail").value = email; }
    });
  });

  q("#fForgot").addEventListener("submit", e => {
    e.preventDefault(); const f = e.currentTarget;
    const email = val("fgEmail").trim().toLowerCase();
    if (!emailOk(email)) return tell("Please type your email address, like name@example.com.", true);
    guard(f, async () => {
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: here });
      if (error) throw error;
      tell("If " + email + " has an account, a link to choose a new password is on its way. It works once and only for a short time.");
    });
  });

  q("#fNew").addEventListener("submit", e => {
    e.preventDefault(); const f = e.currentTarget;
    const pw = val("nwPass"), pw2 = val("nwPass2");
    const prob = passProblem(pw, pw2, user && user.email); if (prob) return tell(prob, true);
    guard(f, async () => {
      const { error } = await sb.auth.updateUser({ password: pw });
      if (error) throw error;
      clearPasswords(); hidePasswords(); recovering = false; render();
      tell("Your new password is saved and you're signed in.");
      syncAll();
    });
  });

  q("#fPass").addEventListener("submit", e => {
    e.preventDefault(); const f = e.currentTarget;
    const pw = val("cpPass"), pw2 = val("cpPass2");
    const prob = passProblem(pw, pw2, user && user.email); if (prob) return tell(prob, true);
    guard(f, async () => {
      const { error } = await sb.auth.updateUser({ password: pw });
      if (error) throw error;
      clearPasswords(); hidePasswords(); f.closest("details").open = false;
      tell("Your password is changed.");
    });
  });

  q("#outBtn").addEventListener("click", async () => {
    const wipe = q("#wipeOnOut").checked;
    try { await sb.auth.signOut({ scope: "local" }); } catch (e) { /* signed out on this device either way */ }
    if (wipe) { state.bps = []; state.packUuid = state.modUuid = null; state.version = 0; persist(); renderLibrary(); }
    user = null; render(); showForm("fIn");
    tell(wipe ? "Signed out, and your library was cleared from this device. It's still safe online." : "Signed out. Your library stays on this device.");
  });

  q("#fDel").addEventListener("submit", e => {
    e.preventDefault(); const f = e.currentTarget;
    if (val("delConfirm").trim() !== "DELETE") return tell("To delete your account, type the word DELETE in capital letters first.", true);
    guard(f, async () => {
      const { error } = await sb.rpc("delete_my_account");
      if (error) throw error;
      try { await sb.auth.signOut({ scope: "local" }); } catch (e2) { }
      q("#delConfirm").value = ""; user = null; render(); showForm("fIn");
      tell("Your account and everything kept online for it are deleted. Your library on this device is still here.");
    });
  });

  q("#exportBtn").addEventListener("click", async () => {
    try {
      const [b, s] = await Promise.all([sb.from("blueprints").select("name,data,created_at,updated_at").order("created_at"), sb.from("studio_settings").select("data,updated_at")]);
      if (b.error) throw b.error; if (s.error) throw s.error;
      const out = { account: { email: user && user.email, created: user && user.created_at }, settings: s.data[0] || null, blueprints: b.data };
      await saveFile("Genesis Studio my data.json", new Blob([JSON.stringify(out, null, 2)], { type: "application/json" }));
    } catch (e) { tell(friendly(e), true); }
  });

  // ---------- keeping the library in step ----------
  const LIMIT = 200;
  function cleanBp(name, d) {
    if (!d || typeof d !== "object") return null;
    const size = d.size;
    if (!Array.isArray(size) || size.length !== 3 || !size.every(n => Number.isInteger(n) && n > 0 && n <= 4096)) return null;
    if (!Array.isArray(d.pal) || d.pal.length > 4096 || !d.pal.every(p => typeof p === "string" && p.length <= 300 && (p === "" || /^[a-z0-9_:.\-]+(\|[^<>`$\\\n|]*)*$/i.test(p)))) return null;
    if (typeof d.data !== "string" || d.data.length > 8e6) return null;
    const out = { size: size.slice(), pal: d.pal.slice(), data: d.data, name: cleanName(name) };
    if (typeof d.kind === "string") out.kind = d.kind.slice(0, 60);
    if (Number.isFinite(d.blocks)) out.blocks = Math.max(0, Math.floor(d.blocks));
    return out;
  }
  const payload = bp => ({ size: bp.size, pal: bp.pal, data: bp.data, kind: bp.kind || "blueprint", blocks: bp.blocks || 0 });
  const same = (a, b) => a.data === b.data && a.size.join() === b.size.join() && a.pal.join() === b.pal.join();
  function setSync(t) { q("#syncState").textContent = t; }
  let syncing = false, owed = false;

  async function pushBp(bp) {
    const { error } = await sb.from("blueprints").upsert({ name: bp.name, data: payload(bp) }, { onConflict: "user_id,name" });
    if (error) throw error;
  }
  async function pushSettings() {
    const { error } = await sb.from("studio_settings").upsert({ data: { lib: state.lib, packUuid: state.packUuid, modUuid: state.modUuid, version: state.version || 0 } }, { onConflict: "user_id" });
    if (error) throw error;
  }

  async function syncAll() {
    if (!user || recovering) return;
    if (syncing) { owed = true; return; }
    syncing = true; setSync("Bringing your library up to date...");
    try {
      const [b, s] = await Promise.all([sb.from("blueprints").select("name,data").order("created_at").limit(LIMIT + 50), sb.from("studio_settings").select("data").limit(1)]);
      if (b.error) throw b.error; if (s.error) throw s.error;
      let got = 0, sent = 0, skipped = 0;
      const cloud = new Map();
      for (const row of b.data) { const bp = cleanBp(row.name, row.data); if (bp) cloud.set(bp.name, bp); else skipped++; }
      // settings: keep one pack identity across devices so saving again updates the same pack
      const cs = s.data[0] && s.data[0].data;
      if (cs && typeof cs === "object") {
        if (!state.packUuid && typeof cs.packUuid === "string" && /^[0-9a-f-]{36}$/.test(cs.packUuid) && typeof cs.modUuid === "string" && /^[0-9a-f-]{36}$/.test(cs.modUuid)) {
          state.packUuid = cs.packUuid; state.modUuid = cs.modUuid; state.version = Math.max(state.version || 0, Number.isInteger(cs.version) ? cs.version : 0);
          if (typeof cs.lib === "string" && cs.lib.trim()) { state.lib = cs.lib.trim().slice(0, 40); q("#libName").value = state.lib; }
        } else if (Number.isInteger(cs.version) && cs.packUuid === state.packUuid) state.version = Math.max(state.version || 0, cs.version);
      }
      for (const bp of cloud.values()) if (!state.bps.some(l => l.name === bp.name)) { state.bps.push(bp); got++; }
      for (let i = 0; i < state.bps.length; i++) {
        const l = state.bps[i], c = cloud.get(l.name);
        if (c && same(c, l)) continue;
        if (c) { let n = 2, nm; do nm = (l.name + "_" + n++).slice(0, 48); while (state.bps.some(x => x.name === nm) || cloud.has(nm)); l.name = nm; }
        if (cloud.size + sent >= LIMIT) continue;
        await pushBp(l); sent++;
      }
      await pushSettings();
      persist(); renderLibrary();
      const parts = [];
      if (got) parts.push(`${got} blueprint${got === 1 ? "" : "s"} arrived from your account`);
      if (sent) parts.push(`${sent} from this device ${sent === 1 ? "was" : "were"} saved online`);
      const full = cloud.size + sent >= LIMIT ? ` Your account holds up to ${LIMIT} blueprints, so remove some to save more online.` : "";
      setSync((parts.length ? parts.join(", and ") + ". " : "") + `Everything is up to date. ${state.bps.length} blueprint${state.bps.length === 1 ? "" : "s"} in your library.` + full + (skipped ? ` ${skipped} damaged one${skipped === 1 ? " was" : "s were"} left out.` : ""));
    } catch (e) {
      setSync(friendly(e));
    } finally {
      syncing = false;
      if (owed) { owed = false; syncAll(); }
    }
  }
  q("#syncBtn").addEventListener("click", syncAll);
  window.addEventListener("online", () => { if (user) syncAll(); });

  // the library tells us when something changes
  window.GenesisCloud = {
    added(bp) { if (!user) return; pushBp(bp).then(() => setSync(`Saved ${bp.name.replace(/_/g, " ")} online too.`)).catch(e => setSync(friendly(e) + " It will be saved online next time you sync.")); },
    removed(name) { if (!user) return; sb.from("blueprints").delete().eq("name", name).then(({ error }) => setSync(error ? friendly(error) : `Removed ${name.replace(/_/g, " ")} online too.`)); },
    settings() { if (user) pushSettings().catch(() => { }); },
    signedIn: () => !!user,
  };

  // ---------- session ----------
  let linkKind = null;
  const tidy = () => { try { history.replaceState(null, "", here); } catch (e) { } };
  function askNewPassword() {
    render(); tell("Choose a new password for " + ((user && user.email) || "your account") + ".");
    setTimeout(() => { q("#account").scrollIntoView({ block: "start" }); q("#nwPass").focus(); }, 50);
  }
  sb.auth.onAuthStateChange((event, session) => {
    const was = user && user.id;
    user = session ? session.user : null;
    if (event === "PASSWORD_RECOVERY") { recovering = true; linkKind = null; askNewPassword(); return; }
    if (event === "SIGNED_OUT") recovering = false;
    render();
    if (event === "SIGNED_IN" && linkKind === "pkce" && !recovering) { linkKind = null; tell("Your email is confirmed. Welcome to Genesis Studio. You're signed in."); }
    if (user && user.id !== was) setTimeout(syncAll, 0);
  });

  // links from emails come back here; tidy the address afterwards and explain any problem
  (function fromEmail() {
    const sp = new URLSearchParams(location.search), hp = new URLSearchParams(location.hash.slice(1));
    const get = k => sp.get(k) || hp.get(k);
    const errText = get("error_description") || (get("error") ? "error" : "");
    if (errText) { tell(/expired|invalid|error/i.test(errText) ? "That email link has expired or was already used. Please ask for a new one." : "That link didn't work: " + errText.slice(0, 160), true); setTimeout(tidy, 0); return; }
    const th = sp.get("token_hash"), ty = sp.get("type");
    if (th && /^(email|signup|recovery|email_change|invite|magiclink)$/.test(ty || "")) {
      if (ty === "recovery") recovering = true;
      sb.auth.verifyOtp({ token_hash: th, type: ty === "signup" ? "email" : ty }).then(({ error }) => {
        tidy();
        if (error) { recovering = false; render(); tell("That email link has expired or was already used. Please ask for a new one.", true); return; }
        if (ty === "recovery") askNewPassword();
        else tell(ty === "email_change" ? "Your new email address is confirmed." : "Your email is confirmed. Welcome to Genesis Studio. You're signed in.");
      }, e => { recovering = false; render(); tell(friendly(e), true); });
      return;
    }
    if (get("code") || get("access_token")) {
      linkKind = "pkce";
      setTimeout(() => {
        tidy();
        if (linkKind === "pkce" && !user) { linkKind = null; tell("That link has to be opened in the same browser where you asked for it, or it has expired. You can sign in now, or ask for a new link.", true); }
      }, 4000);
    }
  })();

  q("#acctOut").hidden = false;
  render();
})();
