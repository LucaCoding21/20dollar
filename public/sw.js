// Lightweight service worker for the "$20 a Day" PWA.
// Goal: instant repeat loads without ever serving a stale app.
//   - Navigations / HTML       → network-first (fresh when online, cached offline).
//   - Same-origin static        → stale-while-revalidate (instant, refreshed in bg).
//   - Remote *immutable* media   → cache-first (Supabase storage photos + GIPHY
//     gifs live at unique, never-changing URLs, so the network is only ever hit
//     once per asset — huge on slow wifi where these used to re-download).
//   - Other cross-origin (GIPHY search API, etc.) → not handled, hits network.
// Bump CACHE_VERSION to force-evict old caches on the next visit.
const CACHE_VERSION = "v3";
const STATIC_CACHE = `static-${CACHE_VERSION}`;
const PAGE_CACHE = `pages-${CACHE_VERSION}`;
const MEDIA_CACHE = `media-${CACHE_VERSION}`;
const KEEP = new Set([STATIC_CACHE, PAGE_CACHE, MEDIA_CACHE]);

// App-shell assets worth having before the first paint so the launcher is
// instant (and works offline) even on a cold cache. Kept to stable URLs only —
// hashed Next.js chunks fill in on their own via stale-while-revalidate.
const PRECACHE = [
  "/",
  "/clouds.webp",
  "/money.webp",
  "/ramen.webp",
  "/bucket.webp",
  "/wind.svg",
  "/icon.png",
  "/apple-icon.png",
  "/manifest.webmanifest",
  "/assetsforai(renameme)/luca.png",
  "/assetsforai(renameme)/irish.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(STATIC_CACHE);
      // Cache each asset independently so one missing file can't fail install.
      await Promise.allSettled(
        PRECACHE.map((u) =>
          fetch(u, { cache: "reload" }).then((res) => {
            if (res && res.ok) return cache.put(u, res);
          }),
        ),
      );
      // Take over as soon as the new worker is ready.
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => !KEEP.has(k)).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

// These URLs are content-addressed / immutable: a given Supabase storage object
// or GIPHY media file never changes, so once cached we can serve it forever.
function isImmutableMedia(url) {
  const host = url.hostname;
  if (host.endsWith(".supabase.co")) {
    return url.pathname.includes("/storage/v1/object/public/");
  }
  // GIPHY media hosts (media*.giphy.com, i.giphy.com) — but NOT the search API.
  if (host.endsWith(".giphy.com")) {
    return host !== "api.giphy.com";
  }
  return false;
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Cross-origin immutable media: cache-first. Opaque (no-cors) responses are
  // fine to store — we only need the bytes to paint an <img>.
  if (url.origin !== self.location.origin) {
    if (isImmutableMedia(url)) {
      event.respondWith(
        (async () => {
          const cache = await caches.open(MEDIA_CACHE);
          const cached = await cache.match(req);
          if (cached) return cached;
          try {
            const res = await fetch(req);
            if (res && (res.ok || res.type === "opaque")) cache.put(req, res.clone());
            return res;
          } catch {
            return cached ?? Response.error();
          }
        })(),
      );
    }
    // Everything else cross-origin (GIPHY search API, etc.) goes to the network.
    return;
  }

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

  // Same-origin static assets (JS, CSS, images, fonts): stale-while-revalidate.
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
