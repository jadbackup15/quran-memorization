'use strict';

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..', '..');

/**
 * Loads one of the site's HTML pages into a jsdom window and runs its inline
 * <script> so the page's own functions (hizbOfGlobalAyah, buildFullLogData,
 * etc.) become callable as window.<name>(...) in a test, without a real
 * browser.
 *
 * - External <script src="https://...">  tags (Firebase) are stripped —
 *   the app's own init code already tolerates Firebase being unavailable.
 * - Local <script src="version.js"|"log.js"> tags are inlined by reading the
 *   file directly, since jsdom's relative-URL script loading needs a live
 *   HTTP server we don't want to spin up for a unit test.
 *
 * @param {string} filename - e.g. "review.html", relative to the repo root.
 * @param {object} [options]
 * @param {string} [options.url] - full URL (e.g. with a "?hizb=3" query
 *   string) to load the page at, for pages that read location.search.
 *   Defaults to "http://localhost/".
 * @returns {import('jsdom').JSDOM}
 */
function loadPage(filename, options = {}) {
  let html = fs.readFileSync(path.join(ROOT, filename), 'utf8');

  // Drop external scripts (Firebase CDN) — no network in tests.
  html = html.replace(/<script src="https:\/\/[^"]+"><\/script>\s*/g, '');

  // Inline same-origin local scripts so no HTTP server is needed.
  html = html.replace(/<script src="([a-zA-Z0-9_-]+\.js)"><\/script>/g, (match, src) => {
    const code = fs.readFileSync(path.join(ROOT, src), 'utf8');
    return `<script>${code}</script>`;
  });

  const dom = new JSDOM(html, {
    url: options.url || 'http://localhost/',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    // review.html logs a caught, expected error when Firebase isn't present
    // (which it never is here) — a fresh, unwired VirtualConsole swallows
    // that instead of cluttering test output.
    virtualConsole: new (require('jsdom').VirtualConsole)(),
  });

  return dom;
}

module.exports = { loadPage };
