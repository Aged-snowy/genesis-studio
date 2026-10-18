// Keeps Genesis Studio working offline. The version changes whenever the site changes.
// Every file is fetched fresh when online, so updates always arrive. The saved copy is only used offline.
const CACHE = "genesis-studio-afeea460fe64";
const SHELL = ["./", "index.html", "privacy.html", "manifest.webmanifest", "studio.css", "config.js", "supabase.js", "palette.js", "studio.js", "account.js", "shell.js", "pdf.min.js", "pdf.worker.min.js", "atkinson-400.woff2", "atkinson-700.woff2", "pixelify-500.woff2", "pixelify-700.woff2", "apple-touch-icon.png", "favicon-32.png", "icon-192.png", "icon-512.png", "maskable-512.png"];
self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: "reload" })))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith("genesis-studio-") && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // sign in and saving online always go straight to the network
  if (url.pathname.endsWith(".mcaddon") || url.pathname.endsWith("/sw.js")) return;
  e.respondWith(fetch(req, { cache: "no-cache" }).then(r => {
    if (r.ok && r.type === "basic") { const copy = r.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
    return r;
  }).catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || (req.mode === "navigate" ? caches.match("./index.html") : Response.error()))));
});
