const CACHE = 'qureo-helper-shell-v6';
const BASE = new URL('./', self.location.href);
const SHELL = ['index.html', 'manifest.json', 'app.js', 'local-inference.js', 'preflight.js', 'image-load-guard.js'].map(file => new URL(file, BASE).href);
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys
    .filter(k => k.startsWith('qureo-helper-shell-') && k !== CACHE)
    .map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  event.respondWith(fetch(event.request).catch(async () => {
    const cached = await caches.match(event.request);
    if (cached) return cached;
    if (url.pathname.endsWith('/')) return caches.match(new URL('index.html', BASE).href);
    return Response.error();
  }));
});
