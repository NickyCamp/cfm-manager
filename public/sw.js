// CFM Manager service worker.
// - App shell and static files: cache first.
// - Pages: network first, falling back to the last copy so a league opens offline.
// - League data (Supabase storage): network first, cached copy when offline.
// - API calls and sign-in are never cached.
const VERSION = "cfm-v1";
const SHELL = ["/", "/icons/icon-192.png", "/icons/mark.svg", "/manifest.webmanifest"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/")) return;

  const isStatic = url.origin === location.origin && (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/"));
  const isLeagueData = url.pathname.includes("/storage/v1/object/public/league-data/");
  const isPage = req.mode === "navigate";

  if (isStatic) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => put(req, res))));
  } else if (isPage || isLeagueData) {
    e.respondWith(fetch(req).then((res) => put(req, res)).catch(() => caches.match(req).then((hit) => hit || caches.match("/"))));
  }
});

function put(req, res) {
  if (res && res.ok && (res.type === "basic" || res.type === "cors")) {
    const copy = res.clone();
    caches.open(VERSION).then((c) => c.put(req, copy));
  }
  return res;
}
