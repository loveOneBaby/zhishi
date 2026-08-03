const CACHE = 'knowledge-mobile-v3';
const SHELL = ['/', '/manifest.webmanifest', '/knowledge-icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  const cacheableEntry = url.pathname.startsWith('/api/entries/');
  const cacheableAsset = /^\/api\/assets\/[^/]+\/raw$/.test(url.pathname);
  if (!cacheableEntry && !cacheableAsset && url.origin !== self.location.origin) return;
  const shouldCache = cacheableEntry || cacheableAsset || !url.pathname.startsWith('/api/');
  event.respondWith((async () => {
    try {
      const response = await fetch(event.request);
      if (response.ok && shouldCache && response.body && !response.bodyUsed) {
        try {
          const cachedResponse = response.clone();
          event.waitUntil(caches.open(CACHE).then((cache) => cache.put(event.request, cachedResponse)));
        } catch {
          // 某些响应流可能不允许 clone，失败则仅走网络不缓存。
        }
      }
      return response;
    } catch {
      const response = await caches.match(event.request);
      return response ?? caches.match('/');
    }
  })());
});
