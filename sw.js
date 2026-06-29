/* Recall service worker — offline-first caching */
const CACHE = "recall-v35";
// A separate cache the page and worker both use as a tiny key/value store
// (the worker can't read localStorage). Kept across activations.
const META = "recall-meta";
const ASSETS = [
  "./",
  "./index.html",
  "./style.css?v=1.12.3",
  "./game.js?v=1.12.3",
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
        Promise.all(
          keys
            .filter((k) => k !== CACHE && k !== META)
            .map((k) => caches.delete(k))
        )
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

/* ============================================================
   Daily reminder notifications
   ============================================================ */
// Tiny key/value store shared with the page (see metaSet in game.js).
async function metaGet(key) {
  try {
    const c = await caches.open(META);
    const r = await c.match("/__meta/" + key);
    return r ? await r.text() : null;
  } catch {
    return null;
  }
}
async function metaSet(key, value) {
  try {
    const c = await caches.open(META);
    await c.put("/__meta/" + key, new Response(String(value)));
  } catch {
    /* ignore */
  }
}
function localDateKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const REMINDER_TITLE = "Today’s Daily is ready";
const REMINDER_BODY = "A fresh set of Recall boards is up.";
const REMINDER_ICON = "./icons/icon-192.png";
const REMINDER_URL = "./?daily=1";

// Best-effort local delivery (no backend): on browsers that grant Periodic
// Background Sync to installed apps, the worker wakes up and — if it's around
// midday, reminders are on, and today's Daily hasn't been played or already
// flagged — posts a single notification.
async function maybeNotifyDaily() {
  if ((await metaGet("reminderOn")) !== "1") return;
  const now = new Date();
  const today = localDateKey(now);
  if ((await metaGet("notifiedDate")) === today) return; // already nudged today
  if ((await metaGet("dailyPlayed")) === today) {
    await metaSet("notifiedDate", today); // already played — no need to nag
    return;
  }
  if (now.getHours() < 11) return; // hold until around noon
  await self.registration.showNotification(REMINDER_TITLE, {
    body: REMINDER_BODY,
    icon: REMINDER_ICON,
    badge: REMINDER_ICON,
    tag: "daily-ready",
    data: { url: REMINDER_URL },
  });
  await metaSet("notifiedDate", today);
}

self.addEventListener("periodicsync", (event) => {
  if (event.tag === "daily-ready") event.waitUntil(maybeNotifyDaily());
});

// Push from a server (Part 2 — not wired yet). Renders the same notification
// from the payload, so adding a backend sender later needs no client change.
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    /* non-JSON payload — fall back to defaults */
  }
  event.waitUntil(
    self.registration.showNotification(data.title || REMINDER_TITLE, {
      body: data.body || REMINDER_BODY,
      icon: REMINDER_ICON,
      badge: REMINDER_ICON,
      tag: data.tag || "daily-ready",
      data: { url: data.url || REMINDER_URL },
    })
  );
});

// Tapping the notification focuses an open tab (and routes it to Daily) or
// opens the app deep-linked to Daily.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url =
    (event.notification.data && event.notification.data.url) || REMINDER_URL;
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const client of all) {
        if ("focus" in client) {
          await client.focus();
          if ("navigate" in client) {
            try {
              await client.navigate(url);
            } catch {
              /* navigation may be disallowed — focus is enough */
            }
          }
          return;
        }
      }
      if (self.clients.openWindow) await self.clients.openWindow(url);
    })()
  );
});
