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

test('hizb.html renders a logged session\'s mistakes and clusters when "Mistakes by Session" is expanded', async () => {
  const { window } = loadPage('hizb.html', { url: 'http://localhost/hizb.html?hizb=1' });
  await flush();

  // Folded in here (rather than its own loadPage() call) since it doesn't
  // depend on the ?hizb= value at all — top-level const/let (e.g. SURAHS)
  // don't attach to `window`, only function declarations do, so this checks
  // one function from each shared file to confirm they're all inlined.
  assert.equal(typeof window.hizbRange, 'function');
  assert.equal(typeof window.fetchSurahData, 'function');
  assert.equal(typeof window.computeHizbStrength, 'function');
  assert.equal(typeof window.clusterAyahMistakes, 'function');
  assert.equal(typeof window.computeSessionRevisionClusters, 'function');

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

test('computeSessionClustersForHizb pools mistakes from multiple sessions logged on the same day into one cluster set, tagged with that day\'s latest session — a real bug this fixed: two sittings on the same day used to produce two separate, never-merged cluster sets', async () => {
  const { window } = loadPage('hizb.html', { url: 'http://localhost/hizb.html?hizb=1' });
  window.localStorage.setItem('quranReviewHizbLog', JSON.stringify([
    { id: 's1', hizb: 1, mistakes: 1, date: '2026-08-01T09:00:00.000Z' },
    { id: 's2', hizb: 1, mistakes: 1, date: '2026-08-01T18:00:00.000Z' }, // same day, a later sitting
  ]));
  window.localStorage.setItem('quranReviewAyahMistakes', JSON.stringify([
    { surah: 1, ayah: 1, hizb: 1, sessionId: 's1', date: '2026-08-01T09:00:00.000Z' },
    { surah: 1, ayah: 2, hizb: 1, sessionId: 's2', date: '2026-08-01T18:00:00.000Z' }, // adjacent to ayah 1 — merges into one cluster once both sessions are pooled
  ]));

  const clusters = JSON.parse(JSON.stringify(window.computeSessionClustersForHizb(1, 'all')));

  assert.equal(clusters.length, 1, 'both same-day sessions pool into one cluster set instead of two separate ones');
  assert.equal(clusters[0].distinctCount, 2);
  assert.equal(clusters[0].sessionId, 's2', 'tagged with the day\'s LATEST session');
});

test('computeSessionClustersForHizb and computeRevisionClustersForHizb both accept "last-session" — every sitting on this Hizb\'s most recent real calendar day, not a rolling window', async () => {
  const { window } = loadPage('hizb.html', { url: 'http://localhost/hizb.html?hizb=1' });
  window.localStorage.setItem('quranReviewHizbLog', JSON.stringify([
    { id: 'old', hizb: 1, mistakes: 1, date: '2026-01-01T09:00:00.000Z' }, // long ago — still "last session" if it's the most recent one
  ]));
  window.localStorage.setItem('quranReviewAyahMistakes', JSON.stringify([
    { surah: 1, ayah: 1, hizb: 1, sessionId: 'old', date: '2026-01-01T09:00:00.000Z' },
  ]));

  const sessionClusters = JSON.parse(JSON.stringify(window.computeSessionClustersForHizb(1, 'last-session')));
  const revisionClusters = JSON.parse(JSON.stringify(window.computeRevisionClustersForHizb(1, 'last-session')));

  assert.equal(sessionClusters.length, 1, '"last-session" finds the real last sitting no matter how long ago it was, not a rolling window that would show nothing here');
  assert.equal(revisionClusters.length, 1);
});

test('groupClustersBySession merges clusters from different literal sessions into one group when they share the same calendar day — a real bug this fixed: the same date used to print twice as two back-to-back group headers', () => {
  const { window } = loadPage('hizb.html', { url: 'http://localhost/hizb.html?hizb=1' });
  const clusters = [
    { sessionId: 's1', sessionDate: '2026-08-01T09:00:00.000Z', startSurah: 1, startAyah: 1 },
    { sessionId: 's2', sessionDate: '2026-08-01T18:00:00.000Z', startSurah: 1, startAyah: 50 },
    { sessionId: 's3', sessionDate: '2026-08-02T09:00:00.000Z', startSurah: 2, startAyah: 5 },
  ];

  const groups = JSON.parse(JSON.stringify(window.groupClustersBySession(clusters)));

  assert.equal(groups.length, 2, 'the two Aug 1 sessions merge into one group; Aug 2 stays separate');
  assert.equal(groups[0].clusters.length, 1, 'most recent day (Aug 2) first');
  assert.equal(groups[1].clusters.length, 2, 'both Aug 1 sessions grouped together');
});

test('the Revision Clusters timeframe dropdowns offer "Last Session" and never a rolling "1d"/"Last 1 day" option, and stay in sync with each other', async () => {
  const { window } = loadPage('hizb.html', { url: 'http://localhost/hizb.html?hizb=1' });
  await flush();

  const selects = window.document.querySelectorAll('.clusters-timeframe-select');
  assert.equal(selects.length, 2, 'one per cluster card');
  selects.forEach(sel => {
    const values = Array.from(sel.options).map(o => o.value);
    assert.ok(values.includes('last-session'), 'offers "Last Session"');
    assert.ok(!values.includes('1d'), 'no rolling "1d"/"Last 1 day" option — merged into "last-session"');
  });

  await window.setClustersTimeframe('last-session');
  selects.forEach(sel => assert.equal(sel.value, 'last-session', 'both selects stay in sync with each other'));
});
