// Simple offline cache for the app shell + background badge refresh.
//
// Cache storage is keyed by ORIGIN, not by service worker scope. On a host that
// serves several apps from sibling directories (e.g. a github.io account), a
// bare cache name would collide with the neighbours and a bare `caches.keys()`
// sweep would delete their caches. Everything below is therefore namespaced by
// the directory *this copy* is installed in, derived at runtime from
// self.location so the app stays portable to any path on any server.
const SCOPE = new URL("./", self.location);        // e.g. https://host/billy/
const CACHE_NS = "billy:" + SCOPE.pathname + "|";  // e.g. "billy:/billy/|"
const CACHE = CACHE_NS + "v17";
// The trailing "|" is load-bearing: without it a root install's namespace
// ("billy:/") is a string prefix of a subdirectory install's ("billy:/app/"),
// so the root copy would sweep the subdirectory copy's caches. "billy:/|" and
// "billy:/app/|" share no prefix.
const LEGACY = /^billy-v\d+$/; // pre-namespace names, written only by this app

const ASSETS = ["./", "index.html", "manifest.json", "icon-192.png", "icon-512.png", "icon-192m.png", "icon-512m.png", "apple-touch-icon.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", e => {
  // Only our own caches: this app's older versions at this same path, plus the
  // legacy un-namespaced names this app used to write. Never a neighbour's.
  e.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => (k.startsWith(CACHE_NS) && k !== CACHE) || LEGACY.test(k))
          .map(k => caches.delete(k))
    ))
  );
  self.clients.claim();
});

// A page in scope can request anything — another app on this origin, or the
// sync backend. Decline everything outside our own directory so we never answer
// for, or take a copy of, a file that isn't ours.
function inScope(url) {
  const u = new URL(url);
  return u.origin === SCOPE.origin && u.pathname.startsWith(SCOPE.pathname);
}

// Stale-while-revalidate: serve the cached shell instantly (no white screen
// waiting on the network), refresh the cache in the background. Updates
// therefore apply one launch later — fine for a personal app.
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return; // let sync POSTs pass through
  if (e.request.cache === "no-store") return; // forced update checks go straight to network
  if (!inScope(e.request.url)) return; // not ours — straight to the network
  e.respondWith(
    // Matching against our own cache, not the global `caches`, which would
    // answer from whichever cache on the origin happens to hold the URL first.
    caches.open(CACHE).then(cache =>
      cache.match(e.request).then(cached => {
        const network = fetch(e.request)
          .then(res => {
            const copy = res.clone();
            cache.put(e.request, copy);
            return res;
          })
          .catch(() => cached || cache.match("index.html"));
        return cached || network;
      })
    )
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
