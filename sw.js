// Service worker for Quran Review PWA.
//
// What must work with no network at all: everything except the two things that
// are network BY DEFINITION — Import from Telegram (it reads a Telegram
// channel) and anything that calls Gemini (Agent Chat, AI Review, Generate
// Plan). All of those fail with their own visible error, which is correct;
// there is nothing to serve from a cache.
//
// CACHE_NAME includes APP_VERSION so that bumping the version in version.js
// (which is in PRECACHE_URLS) causes the browser to install a fresh worker
// and replace stale cached files automatically.
// The version string below is updated by the same commit that bumps version.js.
const CACHE_NAME = 'quran-review-6.16.0';

// Caches that survive a version bump, because what they hold is expensive to
// refetch and is not versioned with the app. `activate` deletes every cache
// EXCEPT these and the current one — leaving them out is how a routine patch
// release silently throws away a few hundred MB the user has accumulated.
const MUSHAF_CACHE = 'quran-mushaf-pages';
const PROMPT_CACHE = 'quran-agent-prompts';
const KEEP_CACHES = [MUSHAF_CACHE, PROMPT_CACHE];

// Deliberately NOT listed below: assets/pages/*.jpg, the 604 mushaf page
// images. This whole list is fetched in one cache.addAll() during install, so
// adding them would mean a ~123 MB download before the worker could activate.
// They are cached ON USE instead — see the fetch handler — so a page you have
// actually opened is then available offline, with no install-time cost.
const PRECACHE_URLS = [
  'review.html',
  'hizb.html',
  'version.js',
  'log.js',
  'quran-data.js',
  'quran-cache.js',
  'mistake-analytics.js',
  'quran-line-bands.js',
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

// On activate: delete old VERSIONED caches, keeping the runtime ones.
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(k => k !== CACHE_NAME && !KEEP_CACHES.includes(k))
          .map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

const isMushafPage = url => /\/assets\/pages\/\d+\.jpg$/.test(url.pathname);
const isAgentPrompt = url => url.pathname.includes('/agent-prompts/')
                             && url.pathname.endsWith('.md');

/** Cache-first, then network, then whatever we can still serve. */
async function serveStatic(req) {
  // ignoreSearch matters: hizb.html is precached bare and every link to it
  // carries `?hizb=N`, so an exact match misses and the page was unreachable
  // offline — the one gap that made "works offline" false for a whole page.
  const cached = await caches.match(req, { ignoreSearch: true });
  if (cached) return cached;
  try {
    return await fetch(req);
  } catch (err) {
    // A navigation that can be served by nothing else still gets the app
    // rather than the browser's own "no internet" page.
    if (req.mode === 'navigate') {
      const shell = await caches.match('review.html');
      if (shell) return shell;
    }
    throw err;
  }
}

/** Cache on use, and keep serving it once the network is gone. */
async function serveMushafPage(req) {
  const cache = await caches.open(MUSHAF_CACHE);
  const cached = await cache.match(req);
  if (cached) return cached;
  const res = await fetch(req);
  // A failed put (quota) must never break the image itself — the browser's
  // own HTTP cache still has it for this session.
  if (res.ok) cache.put(req, res.clone()).catch(() => {});
  return res;
}

/**
 * Network FIRST, cache as fallback.
 *
 * review.html fetches these with `cache: 'no-store'` and a cache-buster
 * because a stale prompt is indistinguishable from "my edit didn't deploy".
 * That must stay true online. But offline it meant the fetch simply failed
 * and the app fell back to its short embedded prompt — silently producing a
 * different, weaker prompt than the one that ships. So: always try the
 * network, and keep the last good copy for when there isn't one.
 */
async function serveAgentPrompt(req) {
  const cache = await caches.open(PROMPT_CACHE);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req.url.split('?')[0], res.clone()).catch(() => {});
    return res;
  } catch (err) {
    const cached = await cache.match(req.url.split('?')[0]);
    if (cached) return cached;
    throw err;
  }
}

// Cross-origin (Firebase, Gemini, alquran.cloud, the allorigins proxy) is
// never intercepted — those are the network-by-definition calls, and
// alquran.cloud's ayah text has its own IndexedDB cache in quran-cache.js.
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (isMushafPage(url)) { event.respondWith(serveMushafPage(req)); return; }
  if (isAgentPrompt(url)) { event.respondWith(serveAgentPrompt(req)); return; }

  // version.js's own update check uses `cache: 'no-store'` and must always
  // hit the network, or the update banner can never fire.
  if (req.cache === 'no-store') return;

  event.respondWith(serveStatic(req));
});
