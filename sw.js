// Service worker for Quran Review PWA.
// CACHE_NAME includes APP_VERSION so that bumping the version in version.js
// (which is in PRECACHE_URLS) causes the browser to install a fresh worker
// and replace stale cached files automatically.
// The version string below is updated by the same commit that bumps version.js.
const CACHE_NAME = 'quran-review-5.42.5';

const PRECACHE_URLS = [
  'review.html',
  'hizb.html',
  'version.js',
  'log.js',
  'quran-data.js',
  'quran-cache.js',
  'mistake-analytics.js',
  'manifest.json',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

// On install: cache all static assets and activate immediately (skip waiting).
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

// On activate: delete any old caches from previous versions.
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// On fetch: serve precached static files from cache (cache-first), pass
// everything else (Firebase, Gemini, alquran.cloud, allorigins proxy)
// straight to the network. Also pass through any request with
// cache: 'no-store' (used by version.js's own update check and the
// Telegram/prompt cache-busters) so those always hit the network and
// the update banner still fires correctly.
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || req.cache === 'no-store') return;
  // Only intercept same-origin requests.
  if (new URL(req.url).origin !== self.location.origin) return;

  event.respondWith(
    caches.match(req).then(cached => cached || fetch(req))
  );
});
