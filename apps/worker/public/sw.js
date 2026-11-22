// RMS Worker service worker.
// 1. Shows system notifications (Android Chrome only allows these through a service worker).
// 2. Keeps the app opening when the Wi-Fi drops: the page shell and built assets are cached.
// Live data (the API and WebSocket) is never cached.

const CACHE = "rms-worker-v1";
const SHELL = ["/", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png", "/apple-touch-icon.png", "/favicon.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // Only this app's own files. The API runs on another port, so it never matches.
  if (url.origin !== self.location.origin) return;

  // Opening the app: try the network, fall back to the saved page when offline.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          void caches.open(CACHE).then((c) => c.put("/", copy));
          return res;
        })
        .catch(() => caches.match("/").then((hit) => hit ?? Response.error())),
    );
    return;
  }

  // Built files have a hash in their name, so a saved copy is always the right one.
  // (The dev server serves from /src, so this never serves stale code while developing.)
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ??
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              void caches.open(CACHE).then((c) => c.put(req, copy));
            }
            return res;
          }),
      ),
    );
    return;
  }

  // Icons and the manifest: use the saved copy, refresh it quietly.
  if (SHELL.includes(url.pathname)) {
    event.respondWith(
      caches.match(req).then((hit) => {
        const refresh = fetch(req)
          .then((res) => {
            if (res.ok) void caches.open(CACHE).then((c) => c.put(req, res.clone()));
            return res;
          })
          .catch(() => hit ?? Response.error());
        return hit ?? refresh;
      }),
    );
  }
});

// Tapping a notification brings the RMS window back to the front.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const open = clients.find((c) => "focus" in c);
      return open ? open.focus() : self.clients.openWindow("/");
    }),
  );
});
