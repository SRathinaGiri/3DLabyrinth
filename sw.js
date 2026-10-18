// Service Worker for 3D Labyrinth PWA (network-first, offline fallback; pattern from 3D Tunnel Rush)
const CACHE_VERSION = 'labyrinth-v1.2.0';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './css/styles.css',
  './js/lib/three.min.js',
  './js/app.js',
  './js/config.js',
  './js/maze.js',
  './js/physics.js',
  './js/renderer.js',
  './js/board.js',
  './js/controls.js',
  './js/hud3d.js',
  './js/audio.js',
  './js/ui.js',
  './js/materials.js',
  './manifest.json',
  './assets/favicon.svg'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(cache => cache.addAll(ASSETS_TO_CACHE)).catch(err => console.warn('[SW] pre-cache:', err))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(names => Promise.all(names.filter(n => n !== CACHE_VERSION).map(n => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request).then(res => {
      if (res && res.status === 200 && res.type === 'basic') {
        const copy = res.clone();
        caches.open(CACHE_VERSION).then(cache => cache.put(event.request, copy));
      }
      return res;
    }).catch(() => caches.match(event.request, { ignoreSearch: true }))
  );
});
