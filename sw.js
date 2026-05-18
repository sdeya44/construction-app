const CACHE = 'cnstr-v24';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/app.css',
  './js/app.js',
  './js/config.js',
  './js/utils.js',
  './js/api.js',
  './js/state.js',
  './js/auth.js',
  './js/offline.js',
  './js/lightbox.js',
  './js/groups.js',
  './js/screens/dashboard.js',
  './js/screens/employees.js',
  './js/screens/sites.js',
  './js/screens/logs.js',
  './js/screens/management.js',
  './js/screens/wizard.js',
  './js/screens/photos.js',
  './js/screens/reports.js',
  './js/screens/search.js',
  './js/screens/admin.js',
  './js/screens/payroll.js',
  './js/screens/equip-report.js',
  './js/screens/calendar.js',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  if (url.hostname.includes('googleapis.com') ||
      url.hostname.includes('googleusercontent.com') ||
      url.hostname.includes('accounts.google.com') ||
      url.hostname.includes('fonts.googleapis.com') ||
      url.hostname.includes('cdnjs.cloudflare.com')) {
    e.respondWith(fetch(e.request).catch(() => new Response('', { status: 503 })));
    return;
  }

  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request).then(res => {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
        return res;
      }).catch(() => caches.match('./index.html'))
    );
    return;
  }

  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      });
    })
  );
});
