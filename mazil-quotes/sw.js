// Offline cache for the app shell. Bump VERSION on every release so phones pick up the update.
const VERSION = 'mazil-quotes-v1';
const ASSETS = [
  './', './index.html', './manifest.json',
  './css/app.css', './css/doc.css',
  './js/app.js', './js/doc.js', './js/store.js',
  './vendor/jspdf.umd.min.js', './vendor/html2canvas.min.js',
  './assets/header.jpg', './assets/icon-192.png', './assets/icon-512.png',
  './fonts/arimo-hebrew-400-normal.woff2', './fonts/arimo-hebrew-700-normal.woff2',
  './fonts/arimo-latin-400-normal.woff2', './fonts/arimo-latin-700-normal.woff2',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Network first (fresh code when online), cache fallback (works offline).
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('./index.html')))
  );
});
