/* Recall service worker — offline-first caching */
const CACHE = "recall-v60";
// A separate cache the page and worker both use as a tiny key/value store
// (the worker can't read localStorage). Kept across activations.
const META = "recall-meta";
const ASSETS = [
  "./",
  "./index.html",
  "./style.css?v=0.9.1",
  "./game.js?v=0.9.1",
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

// Network-first with a short timeout: fresh content when the network is
// healthy, the cached copy after ~3.5s when it's flaky (the fetch keeps going
// in the background and refreshes the cache for next launch), and an instant
// cache fallback when fully offline.
function networkFirst(request, fallbackKey) {
  const key = fallbackKey || request;
  const fromNetwork = fetch(request).then((res) => {
    if (res && res.ok && res.type === "basic") {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(key, copy));
    }
    return res;
  });
  const fromCache = () =>
    caches.match(key).then((cached) => cached || caches.match("./index.html"));
  const timeout = new Promise((resolve) =>
    setTimeout(() => resolve(fromCache()), 3500)
  );
  return Promise.race([fromNetwork.catch(fromCache), timeout]).then(
    // A cache miss on timeout (nothing to serve yet) waits the network out.
    (res) => res || fromNetwork.catch(fromCache)
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

function showDaily(title, body) {
  return self.registration.showNotification(title, {
    body,
    icon: REMINDER_ICON,
    badge: REMINDER_ICON,
    tag: "daily-ready",
    data: { url: REMINDER_URL },
  });
}

// Best-effort local delivery (no backend): on browsers that grant Periodic
// Background Sync to installed apps, the worker wakes up and — if reminders are
// on and today's Daily hasn't been played — posts at most one midday nudge
// ("it's ready") and one evening nudge ("it's about to expire", streak-aware).
async function maybeNotifyDaily() {
  if ((await metaGet("reminderOn")) !== "1") return;
  const now = new Date();
  const today = localDateKey(now);

  // Already played today? Nothing to nudge — mark both windows done.
  if ((await metaGet("dailyPlayed")) === today) {
    await metaSet("readyNotified", today);
    await metaSet("expiryNotified", today);
    return;
  }

  const hour = now.getHours();

  // Evening: the Daily is about to reset, and a streak may be on the line.
  if (hour >= 20) {
    if ((await metaGet("expiryNotified")) === today) return;
    const streak = parseInt((await metaGet("streakCurrent")) || "0", 10);
    const last = await metaGet("streakLast");
    const yesterday = localDateKey(new Date(now.getTime() - 86400000));
    // A streak is only really at risk if it ran through yesterday and today
    // hasn't been played yet — otherwise it's already broken or not started.
    if (streak >= 2 && last === yesterday) {
      await showDaily(
        `Your ${streak}-day streak ends at midnight`,
        "Play today’s Daily to keep it going."
      );
    } else {
      await showDaily(
        "Last call — today’s Daily",
        "It resets at midnight. Don’t miss it."
      );
    }
    await metaSet("expiryNotified", today);
    return;
  }

  // Midday: the new Daily is ready.
  if (hour >= 11) {
    if ((await metaGet("readyNotified")) === today) return;
    await showDaily(REMINDER_TITLE, REMINDER_BODY);
    await metaSet("readyNotified", today);
    return;
  }
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
