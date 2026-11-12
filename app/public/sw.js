// Offline cache of the app shell only. Unlocked book content lives in IndexedDB, never here.
// Network-first for data, cache-first for everything else. What is cacheable: see sw-rules.js.
importScripts("sw-rules.js");
const CACHE = "2d6-v4"; // v4: both branches had bumped to v3; a fresh name drops either v3 cache
self.addEventListener("install", (e) => self.skipWaiting());
self.addEventListener("activate", (e) =>
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  ),
);
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  if (!shouldCache(e.request.url, location.origin)) return;
  const networkFirst = url.pathname.endsWith(".json") || url.pathname.endsWith("/") || url.pathname.endsWith(".html");
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(e.request);
      const fetched = fetch(e.request).then((res) => {
        if (res.status === 200) cache.put(e.request, res.clone()).catch(() => {});
        return res;
      });
      fetched.catch(() => {}); // a failed background refresh must not be an unhandled rejection
      if (networkFirst) return fetched.catch(() => cached || Response.error());
      return cached || fetched;
    }),
  );
});
