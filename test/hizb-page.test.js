'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadPage } = require('./helpers/loadPage.js');

// Lets any pending microtasks from hizb.html's async init chain
// (initHizbDetailPage -> renderMistakesBySession/renderMistakeRanking/
// renderClusters) settle before asserting on the DOM it wrote.
const flush = () => new Promise(resolve => setImmediate(resolve));

test('hizb.html with no ?hizb= param shows the "not found" state', async () => {
  const { window } = loadPage('hizb.html', { url: 'http://localhost/hizb.html' });
  await flush();
  assert.equal(window.document.getElementById('hizb-not-found').style.display, 'block');
  assert.equal(window.document.getElementById('hizb-detail-content').style.display, 'none');
});

test('hizb.html rejects an out-of-range ?hizb= value the same way', async () => {
  const { window } = loadPage('hizb.html', { url: 'http://localhost/hizb.html?hizb=61' });
  await flush();
  assert.equal(window.document.getElementById('hizb-not-found').style.display, 'block');
});

test('hizb.html with a valid ?hizb= param renders that Hizb\'s title and strength badge', async () => {
  const { window } = loadPage('hizb.html', { url: 'http://localhost/hizb.html?hizb=3' });
  await flush();
  assert.equal(window.document.getElementById('hizb-not-found').style.display, 'none');
  assert.equal(window.document.getElementById('hizb-detail-title').textContent, 'Hizb 3');
  assert.match(window.document.getElementById('hizb-detail-strength').textContent, /Not Logged/);
});

test('hizb.html\'s getUrlParams parses hizb and cluster from the query string', () => {
  const { window } = loadPage('hizb.html', {
    url: 'http://localhost/hizb.html?hizb=12&cluster=' + encodeURIComponent('2:5-2:8'),
  });
  const parsed = window.getUrlParams();
  assert.equal(parsed.hizb, 12);
  assert.equal(parsed.cluster, '2:5-2:8');
});

test('hizb.html loads the shared quran-data.js, quran-cache.js, and mistake-analytics.js', () => {
  // Top-level const/let (e.g. SURAHS) don't attach to `window`, only function
  // declarations do — so this checks a function from each shared file.
  const { window } = loadPage('hizb.html', { url: 'http://localhost/hizb.html?hizb=1' });
  assert.equal(typeof window.hizbRange, 'function');
  assert.equal(typeof window.fetchSurahData, 'function');
  assert.equal(typeof window.computeHizbStrength, 'function');
  assert.equal(typeof window.clusterAyahMistakes, 'function');
  assert.equal(typeof window.computeSessionRevisionClusters, 'function');
});

test('hizb.html renders a logged session\'s mistakes and clusters when "Mistakes by Session" is expanded', async () => {
  const { window } = loadPage('hizb.html', { url: 'http://localhost/hizb.html?hizb=1' });
  await flush();

  window.localStorage.setItem('quranReviewHizbLog', JSON.stringify([
    { id: 's1', hizb: 1, mistakes: 2, date: '2026-08-01T00:00:00.000Z' },
  ]));
  window.localStorage.setItem('quranReviewAyahMistakes', JSON.stringify([
    { surah: 1, ayah: 1, hizb: 1, sessionId: 's1', date: '2026-08-01T00:00:00.000Z' },
    { surah: 1, ayah: 2, hizb: 1, sessionId: 's1', date: '2026-08-01T00:00:00.000Z' },
  ]));

  await window.initHizbDetailPage();
  await flush();

  const bySession = window.document.getElementById('hizb-detail-by-session').innerHTML;
  assert.match(bySession, /2 mistakes/);

  await window.toggleSessionMistakes('s1');
  await flush();

  const expanded = window.document.getElementById('hizb-detail-by-session').innerHTML;
  assert.match(expanded, /Clusters in this session/);
  assert.match(expanded, /1:1/);
  assert.match(expanded, /1:2/);
});
