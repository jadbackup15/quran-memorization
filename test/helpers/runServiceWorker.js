'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');

/**
 * Runs the real sw.js in a sandbox with a stub Cache Storage, and returns a
 * driver that can answer a request either online or offline.
 *
 * This exercises the handler itself rather than asserting on its source, so
 * "works offline" is something that is demonstrated, not described.
 *
 * @param {object} opts
 * @param {string[]} opts.network - paths the (fake) network will serve.
 * @returns {{install: Function, activate: Function, get: Function,
 *            caches: Map, goOffline: Function}}
 */
function runServiceWorker({ network = [] } = {}) {
  const source = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const ORIGIN = 'https://example.test';

  const stores = new Map();           // cacheName -> Map(url -> response)
  let online = true;

  const bodyFor = url => ({ ok: true, url, from: 'network', clone() { return { ...this }; } });

  const openCache = name => {
    if (!stores.has(name)) stores.set(name, new Map());
    const map = stores.get(name);
    return Promise.resolve({
      match: req => Promise.resolve(map.get(urlOf(req)) || undefined),
      put: (req, res) => { map.set(urlOf(req), { ...res, from: 'cache' }); return Promise.resolve(); },
      addAll: urls => Promise.all(urls.map(u => {
        const abs = new URL(u, ORIGIN + '/').href;
        if (!online) return Promise.reject(new Error('offline'));
        map.set(abs, { ok: true, url: abs, from: 'cache' });
      })),
    });
  };

  const urlOf = req => (typeof req === 'string' ? new URL(req, ORIGIN + '/').href : req.url);

  const cachesStub = {
    open: openCache,
    keys: () => Promise.resolve([...stores.keys()]),
    delete: name => Promise.resolve(stores.delete(name)),
    match: async (req, opts = {}) => {
      const want = urlOf(req);
      const bare = want.split('?')[0];
      for (const map of stores.values()) {
        if (map.has(want)) return map.get(want);
        if (opts.ignoreSearch && map.has(bare)) return map.get(bare);
      }
      return undefined;
    },
  };

  const listeners = {};
  const waits = [];
  const sandbox = {
    self: {
      addEventListener: (type, fn) => { listeners[type] = fn; },
      location: { origin: ORIGIN },
      skipWaiting: () => Promise.resolve(),
      clients: { claim: () => Promise.resolve() },
    },
    caches: cachesStub,
    URL,
    fetch: req => {
      if (!online) return Promise.reject(new TypeError('Failed to fetch'));
      const p = new URL(urlOf(req)).pathname.replace(/^\//, '').split('?')[0];
      if (!network.includes(p)) return Promise.resolve({ ok: false, status: 404, url: urlOf(req), clone() { return { ...this }; } });
      return Promise.resolve(bodyFor(urlOf(req)));
    },
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);

  const fire = (type, event) => {
    const fn = listeners[type];
    if (!fn) throw new Error(`sw.js registered no "${type}" listener`);
    fn(event);
  };

  return {
    stores,
    goOffline() { online = false; },
    goOnline() { online = true; },
    install() {
      let done;
      fire('install', { waitUntil: p => { done = p; } });
      return done;
    },
    activate() {
      let done;
      fire('activate', { waitUntil: p => { done = p; } });
      return done;
    },
    /** @returns {Promise<object|'passthrough'|'error'>} what the worker serves. */
    get(url, { mode = 'no-cors', cache = 'default' } = {}) {
      const req = { method: 'GET', url: new URL(url, ORIGIN + '/').href, mode, cache };
      let responded = null;
      fire('fetch', { request: req, respondWith: p => { responded = p; } });
      if (responded === null) return Promise.resolve('passthrough');
      return Promise.resolve(responded).catch(() => 'error');
    },
    seed(cacheName, url) {
      if (!stores.has(cacheName)) stores.set(cacheName, new Map());
      stores.get(cacheName).set(new URL(url, ORIGIN + '/').href,
                               { ok: true, url, from: 'cache' });
    },
  };
}

module.exports = { runServiceWorker };
