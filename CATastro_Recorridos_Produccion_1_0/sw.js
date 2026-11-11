const CACHE = 'catastro-produccion-1-0-3';
const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js?v=1.0.3',
  './assignments.js?v=1.0.3',
  './logo_dnp.png',
  './logo_econometria.png',
  './banner_catastro.png',
  './manifest.webmanifest'
];
const APP_FILES = new Set(['', 'index.html', 'app.js', 'assignments.js']);

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key.startsWith('catastro-') && key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  const path = url.pathname.split('/').pop();
  const isAppFile = APP_FILES.has(path);

  if (isAppFile || request.mode === 'navigate') {
    event.respondWith(
      fetch(new Request(request, { cache: 'no-cache' }))
        .then(response => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then(cache => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => caches.match(request).then(cached => cached || caches.match('./index.html')))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(cached => cached || fetch(request).then(response => {
      if (response && response.ok) {
        const copy = response.clone();
        caches.open(CACHE).then(cache => cache.put(request, copy));
      }
      return response;
    }).catch(() => caches.match('./index.html')))
  );
});
