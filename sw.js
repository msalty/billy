// Simple offline cache for the app shell + background badge refresh.
const CACHE = "billy-v3";
const ASSETS = ["./", "index.html", "manifest.json"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
  );
  self.clients.claim();
});

// Network-first for the app shell (so updates arrive), cache fallback offline.
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return; // let sync POSTs pass through
  e.respondWith(
    fetch(e.request)
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request).then(r => r || caches.match("index.html")))
  );
});

// Periodic background badge update (Android Chrome; registered by the page).
// The page mirrors each bill's next-due date into IndexedDB so we can compute
// the overdue + due-soon count without the app being open.
self.addEventListener("periodicsync", e => {
  if (e.tag === "billy-badge") e.waitUntil(updateBadgeFromStore());
});

function updateBadgeFromStore() {
  return new Promise(resolve => {
    try {
      const req = indexedDB.open("billy", 1);
      req.onupgradeneeded = () => req.result.createObjectStore("kv");
      req.onsuccess = () => {
        try {
          const get = req.result.transaction("kv", "readonly").objectStore("kv").get("dueDates");
          get.onsuccess = () => {
            const dates = get.result || [];
            const today = new Date(); today.setHours(0, 0, 0, 0);
            const n = dates.filter(ds => {
              const p = ds.split("-").map(Number);
              return (new Date(p[0], p[1] - 1, p[2]) - today) / 86400000 <= 7;
            }).length;
            if ("setAppBadge" in self.navigator) {
              (n > 0 ? self.navigator.setAppBadge(n) : self.navigator.clearAppBadge()).catch(() => {});
            }
            resolve();
          };
          get.onerror = () => resolve();
        } catch (e) { resolve(); }
      };
      req.onerror = () => resolve();
    } catch (e) { resolve(); }
  });
}
