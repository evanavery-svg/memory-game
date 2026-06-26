/* Recall service worker — offline-first caching */
const CACHE = "recall-v19";
const ASSETS = [
  "./",
  "./index.html",
  "./style.css?v=1.6",
  "./game.js?v=1.6",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-180.png",
  "./icons/icon-maskable-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

// Network-first: fetch fresh, update the cache, fall back to cache when offline.
function networkFirst(request, fallbackKey) {
  const key = fallbackKey || request;
  return fetch(request)
    .then((res) => {
      if (res && res.ok && res.type === "basic") {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(key, copy));
      }
      return res;
    })
    .catch(() =>
      caches.match(key).then((cached) => cached || caches.match("./index.html"))
    );
}

// Cache-first: serve from cache, otherwise fetch and store.
function cacheFirst(request) {
  return caches.match(request).then(
    (cached) =>
      cached ||
      fetch(request).then((res) => {
        if (res.ok && res.type === "basic") {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy));
        }
        return res;
      })
  );
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  const sameOrigin = url.origin === self.location.origin;

  // The app shell (the page itself) is always network-first so an online
  // visitor gets the newest version, with the cached copy as offline fallback.
  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request, "./index.html"));
    return;
  }

  // Core same-origin assets (HTML/CSS/JS/manifest) are also network-first, so
  // the latest code is fetched whenever you're online. Icons rarely change and
  // are heavy, so they stay cache-first for speed.
  if (sameOrigin && !url.pathname.includes("/icons/")) {
    event.respondWith(networkFirst(request));
    return;
  }

  event.respondWith(cacheFirst(request));
});
