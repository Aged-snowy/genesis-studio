// Genesis Studio as an app: works offline after the first visit and can be installed.
(() => {
  "use strict";
  if ("serviceWorker" in navigator && window.isSecureContext) {
    // when a newer version of the site takes over, reload once so the page runs the newest code
    const hadController = !!navigator.serviceWorker.controller;
    let reloaded = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => { if (hadController && !reloaded) { reloaded = true; location.reload(); } });
    addEventListener("load", () => { navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).then(r => r.update()).catch(() => { }); });
  }
  // files opened with the installed app arrive here
  if ("launchQueue" in window && window.launchQueue.setConsumer) {
    window.launchQueue.setConsumer(async p => { try { const files = await Promise.all((p.files || []).map(h => h.getFile())); if (files.length) openFiles(files); } catch (e) { } });
  }
  const btn = document.getElementById("installBtn"), done = document.getElementById("installDone");
  const standalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  if (standalone()) { done.hidden = false; return; }
  let ask = null;
  addEventListener("beforeinstallprompt", e => { e.preventDefault(); ask = e; btn.hidden = false; });
  btn.addEventListener("click", async () => {
    if (!ask) return;
    ask.prompt();
    try { const c = await ask.userChoice; if (c && c.outcome === "accepted") { btn.hidden = true; done.hidden = false; } } catch (e) { }
    ask = null;
  });
  addEventListener("appinstalled", () => { btn.hidden = true; done.hidden = false; say("Genesis Studio is installed. You can open it from your apps."); });
})();
