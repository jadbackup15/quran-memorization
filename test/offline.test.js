'use strict';

// What this file guards is one thing: the PWA keeps working with no network.
//
// Everything review.html needs same-origin has to be reachable from the
// service worker's caches, and the worker has to actually REPLACE itself when
// the app ships. Both halves have already failed silently in this repo:
// CACHE_NAME sat at 6.15.1 while APP_VERSION had moved on twice, so every
// device kept serving the old files and nothing anywhere said so.
//
// Deliberately NOT covered: Import from Telegram and anything that calls
// Gemini. Those are network by definition — there is no cached answer to
// serve, and they are expected to fail offline with their own error.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

const sw = read('sw.js');
const reviewHtml = read('review.html');
const appVersion = read('version.js').match(/APP_VERSION\s*=\s*"([^"]+)"/)[1];

/** The URLs the worker precaches, read out of the source as data. */
function precacheUrls() {
  const block = sw.match(/const PRECACHE_URLS = \[([\s\S]*?)\];/)[1];
  return [...block.matchAll(/'([^']+)'/g)].map(m => m[1]);
}

test('CACHE_NAME tracks APP_VERSION', () => {
  const cacheName = sw.match(/const CACHE_NAME = '([^']+)'/)[1];
  assert.strictEqual(
    cacheName, `quran-review-${appVersion}`,
    'sw.js CACHE_NAME must be bumped in the same commit as version.js — a ' +
    'stale name means the worker never replaces its cached files, so every ' +
    'device keeps running the old app with nothing to indicate it.'
  );
});

test('every same-origin script review.html loads is precached', () => {
  const srcs = [...reviewHtml.matchAll(/<script src="([^"]+)"/g)]
    .map(m => m[1])
    .filter(s => !/^https?:/.test(s));
  assert.ok(srcs.length >= 6, 'expected review.html to load several local scripts');

  const cached = precacheUrls();
  for (const src of srcs) {
    assert.ok(
      cached.includes(src),
      `${src} is loaded by review.html but missing from PRECACHE_URLS — the ` +
      `page would fail to start offline.`
    );
  }
});

test('both real pages and the manifest are precached', () => {
  const cached = precacheUrls();
  for (const page of ['review.html', 'hizb.html', 'manifest.json']) {
    assert.ok(cached.includes(page), `${page} must be precached`);
  }
});

test('the cache lookup ignores the query string', () => {
  // Every link to hizb.html carries `?hizb=N`, and caches.match() keys on the
  // full URL by default — so the precached bare `hizb.html` never matched and
  // the whole page was unreachable offline.
  assert.match(
    sw, /caches\.match\(req, \{ ignoreSearch: true \}\)/,
    'the static handler must match with ignoreSearch, or any URL carrying a ' +
    'query (hizb.html?hizb=3) misses the precache and fails offline'
  );
});

test('mushaf page images are cached on use, not precached', () => {
  const cached = precacheUrls();
  assert.ok(
    !cached.some(u => u.includes('assets/pages')),
    '604 JPEGs (~123 MB) in cache.addAll() would have to download before the ' +
    'worker could activate'
  );
  assert.match(sw, /assets\\\/pages\\\/\\d\+\\\.jpg/,
    'the fetch handler must recognise a mushaf page image so it can cache it ' +
    'on use — otherwise the mushaf is blank offline');
});

test('runtime caches survive a version bump', () => {
  // A patch release must not discard the mushaf pages the user has
  // accumulated, nor the last good copy of the prompts.
  const keep = sw.match(/const KEEP_CACHES = \[([^\]]*)\]/)[1];
  assert.ok(keep.includes('MUSHAF_CACHE'), 'mushaf cache must be kept on activate');
  assert.ok(keep.includes('PROMPT_CACHE'), 'prompt cache must be kept on activate');
  assert.match(
    sw, /!KEEP_CACHES\.includes\(k\)/,
    'activate must exempt the runtime caches from the delete sweep'
  );
});

test("version.js's update check still bypasses the cache", () => {
  // The update banner only fires if this request really reaches the network.
  assert.match(sw, /req\.cache === 'no-store'\) return;/);
});

// ── The worker, actually run ─────────────────────────────────────────────────
//
// Everything above reads the source. These drive the real fetch handler in a
// sandbox with a stub Cache Storage and a network that can be switched off, so
// what is asserted is what a device would actually be served.

const { runServiceWorker } = require('./helpers/runServiceWorker.js');

/** A worker that has installed and activated while online. */
async function warmWorker(extraNetwork = []) {
  const sw = runServiceWorker({
    network: [...precacheUrls(), 'assets/pages/23.jpg',
              'agent-prompts/prompts.md', ...extraNetwork],
  });
  await sw.install();
  await sw.activate();
  return sw;
}

test('offline: the app shell and every shared module still load', async () => {
  const sw = await warmWorker();
  sw.goOffline();
  for (const url of precacheUrls()) {
    const res = await sw.get(url);
    assert.notStrictEqual(res, 'error', `${url} failed offline`);
    assert.ok(res.ok, `${url} did not resolve offline`);
  }
});

test('offline: hizb.html?hizb=3 is served from the precache', async () => {
  const sw = await warmWorker();
  sw.goOffline();
  const res = await sw.get('hizb.html?hizb=3');
  assert.notStrictEqual(res, 'error',
    'the per-Hizb page must survive offline — it is linked from every ' +
    'mistake list and carries its Hizb in the query string');
  assert.ok(res.ok);
});

test('offline: a mushaf page opened while online is still there', async () => {
  const sw = await warmWorker();
  const online = await sw.get('assets/pages/23.jpg');
  assert.ok(online.ok, 'the page image should load online');

  sw.goOffline();
  const offline = await sw.get('assets/pages/23.jpg');
  assert.notStrictEqual(offline, 'error', 'a viewed page must stay readable offline');
  assert.strictEqual(offline.from, 'cache');
});

test('offline: a mushaf page never opened fails, and only that one', async () => {
  // Honest limit: caching is on use, so a page you have never looked at was
  // never downloaded. Asserted so the boundary is a decision, not a surprise.
  const sw = await warmWorker();
  sw.goOffline();
  assert.strictEqual(await sw.get('assets/pages/400.jpg'), 'error');
  assert.ok((await sw.get('review.html')).ok, 'the app itself is unaffected');
});

test('agent prompts: network wins online, cache answers offline', async () => {
  const sw = await warmWorker();
  const live = await sw.get('agent-prompts/prompts.md?_=1', { cache: 'no-store' });
  assert.strictEqual(live.from, 'network',
    'online this must always hit the network — a stale prompt is ' +
    'indistinguishable from "my edit did not deploy"');

  sw.goOffline();
  const cached = await sw.get('agent-prompts/prompts.md?_=2', { cache: 'no-store' });
  assert.notStrictEqual(cached, 'error',
    'offline the app would otherwise fall back to its short embedded prompt, ' +
    'silently sending something different from what ships');
  assert.strictEqual(cached.from, 'cache');
});

test('a failed navigation falls back to the app, not the browser error page', async () => {
  const sw = await warmWorker();
  sw.goOffline();
  const res = await sw.get('something-not-cached.html', { mode: 'navigate' });
  assert.notStrictEqual(res, 'error');
  assert.match(res.url, /review\.html$/);
});

test('cross-origin is never intercepted', async () => {
  const sw = await warmWorker();
  for (const url of [
    'https://api.alquran.cloud/v1/surah/2/editions/quran-uthmani,en.sahih',
    'https://generativelanguage.googleapis.com/v1beta/models',
    'https://api.allorigins.win/raw?url=x',
  ]) {
    assert.strictEqual(await sw.get(url), 'passthrough', `${url} must pass through`);
  }
});

test('a version bump keeps the mushaf pages and drops the stale app cache', async () => {
  const sw = await warmWorker();
  await sw.get('assets/pages/23.jpg');            // populates the runtime cache
  sw.stores.set('quran-review-0.0.1', new Map()); // a previous release

  await sw.activate();

  const names = [...sw.stores.keys()];
  assert.ok(!names.includes('quran-review-0.0.1'), 'the old app cache must go');
  assert.ok(names.includes('quran-mushaf-pages'),
    'a patch release must not discard hundreds of MB of page images');
});
