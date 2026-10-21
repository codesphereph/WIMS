/* CPU WIMS — service worker.
 * App shell is precached (works offline); fonts are cached on first use;
 * API calls to Apps Script are never cached (always live).
 * Bump CACHE_VERSION whenever you deploy changes so clients pick them up.
 */
const CACHE_VERSION = 'cpu-wims-v1.1.1';
const SHELL = [
  './', './index.html', './manifest.webmanifest', './config.js', './css/styles.css',
  './js/icons.js', './js/demo.js', './js/api.js', './js/analytics.js', './js/app.js', './vendor/chart.umd.min.js',
  './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png', './icons/apple-touch-icon.png', './icons/cpu-logo.png', './icons/favicon-32.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_VERSION).then((c) => c.addAll(SHELL)));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener('message', (e) => { if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting(); });

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;                       // API POSTs go straight to the network
  const url = new URL(req.url);
  if (/script\.google(usercontent)?\.com$/.test(url.hostname)) return;

  // Google Fonts: cache-first
  if (/fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) {
    e.respondWith(caches.open(CACHE_VERSION + '-fonts').then((c) => c.match(req).then((hit) => hit || fetch(req).then((res) => { c.put(req, res.clone()); return res; }))));
    return;
  }
  if (url.origin !== self.location.origin) return;

  // Page navigations: network first, fall back to cached shell (offline)
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then((res) => { const copy = res.clone(); caches.open(CACHE_VERSION).then((c) => c.put('./index.html', copy)); return res; }).catch(() => caches.match('./index.html')));
    return;
  }
  // Static assets: stale-while-revalidate
  e.respondWith(caches.open(CACHE_VERSION).then((c) => c.match(req).then((hit) => {
    const net = fetch(req).then((res) => { if (res.ok) c.put(req, res.clone()); return res; }).catch(() => hit);
    return hit || net;
  })));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) { if ('focus' in c) return c.focus(); }
    return self.clients.openWindow('./#/alerts');
  }));
});
