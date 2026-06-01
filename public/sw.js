// Lightweight service worker for the "$20 a Day" PWA.
// Goal: instant repeat loads without ever serving a stale app.
//   - Navigations / HTML  → network-first (fresh when online, cached offline).
//   - Same-origin static  → stale-while-revalidate (instant, refreshed in bg).
//   - Cross-origin (GIPHY media, Supabase, etc.) → not handled, hits network.
// Bump CACHE_VERSION to force-evict old caches on the next visit.
const CACHE_VERSION = "v1";
const STATIC_CACHE = `static-${CACHE_VERSION}`;
const PAGE_CACHE = `pages-${CACHE_VERSION}`;

self.addEventListener("install", (event) => {
  // Take over as soon as the new worker is ready.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k !== STATIC_CACHE && k !== PAGE_CACHE)
          .map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  // Only handle our own origin; let GIPHY/Supabase/etc. go straight to network.
  if (url.origin !== self.location.origin) return;

  // HTML navigations: network-first so a deploy is picked up immediately.
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req);
          const cache = await caches.open(PAGE_CACHE);
          cache.put(req, fresh.clone());
          return fresh;
        } catch {
          const cached = await caches.match(req);
          return cached ?? caches.match("/");
        }
      })(),
    );
    return;
  }

  // Static assets (JS, CSS, images, fonts): stale-while-revalidate.
  event.respondWith(
    (async () => {
      const cache = await caches.open(STATIC_CACHE);
      const cached = await cache.match(req);
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200) cache.put(req, res.clone());
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })(),
  );
});
