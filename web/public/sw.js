const CACHE = 'knowledge-mobile-v2';
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
  event.respondWith(fetch(event.request).then((response) => {
    if (response.ok && (cacheableEntry || cacheableAsset || !url.pathname.startsWith('/api/'))) {
      const cachedResponse = response.clone();
      event.waitUntil(caches.open(CACHE).then((cache) => cache.put(event.request, cachedResponse)));
    }
    return response;
  }).catch(() => caches.match(event.request).then((response) => response ?? caches.match('/'))));
});
