'use strict';

// Overview's Mistakes Heatmap (review.html). One cell per printed mushaf page,
// shaded by how much has gone wrong there — the "where am I weak?" view that
// the aggregate sections cannot answer below Hizb granularity.

const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { loadPage } = require('./helpers/loadPage.js');

const toPlain = (v) => JSON.parse(JSON.stringify(v));

let w;
before(async () => {
  w = (await loadPage('review.html')).window;
  w.localStorage.setItem('quranReviewMemorizedHizbs', JSON.stringify([1, 2, 3, 4, 5, 6]));
});

const mistake = (a, id, date, type = null) => ({
  id, surah: a.surah, ayah: a.ayah, hizb: a.hizb, date, type, source: 'live',
});

// ── Scope ──────────────────────────────────────────────────────────────────

test('each scope produces the page count the mushaf actually has', () => {
  // Measured from QURAN_LINE_BANDS, not assumed — these are what make the page
  // the right cell: every scope lands in a grid you can take in at a glance.
  const n = (scope) => w.computeMistakesHeatmap({ scope }).cells.length;
  assert.equal(n('hizb:1'), 11);
  assert.equal(n('juz:1'), 21);
  assert.equal(n('surah:2'), 48);
  assert.equal(n('all'), 62, 'six memorized hizbs');
});

test('an unmemorized scope is empty, and a bad scope falls back to all', () => {
  assert.deepEqual(toPlain(w.computeMistakesHeatmap({ scope: 'hizb:59' }).cells), []);
  assert.equal(w.computeMistakesHeatmap({ scope: 'nonsense' }).cells.length,
    w.computeMistakesHeatmap({ scope: 'all' }).cells.length);
});

test('a partly-memorized Surah shows only the memorized part of it', () => {
  // The reason every scope is memorized-filtered, not just "all": an
  // un-memorized page is ABSENT, not clean, and shading it level 0 next to
  // genuinely clean pages reads as "all good here" for material never recited.
  w.localStorage.setItem('quranReviewMemorizedHizbs', JSON.stringify([1]));
  const cells = w.computeMistakesHeatmap({ scope: 'surah:2' }).cells;
  // 10, not Hizb 1's own 11: page 1 is Al-Fatiha, which is not in this Surah.
  assert.equal(cells.length, 10, 'Al-Baqara spans Hizb 1-5; only Hizb 1 is done');
  assert.equal(w.computeMistakesHeatmap({ scope: 'hizb:1' }).cells.length, 11);
  w.localStorage.setItem('quranReviewMemorizedHizbs', JSON.stringify([1, 2, 3, 4, 5, 6]));
});

test('pages with no mistakes still get a cell', () => {
  // Half the value of a heatmap is seeing the CLEAN stretches; dropping empty
  // pages would leave a grid of only bad news with no sense of proportion.
  w.localStorage.setItem('quranReviewAyahMistakes', '[]');
  const { cells, max } = w.computeMistakesHeatmap({ scope: 'hizb:1' });
  assert.equal(cells.length, 11);
  assert.ok(cells.every(c => c.value === 0));
  assert.equal(max, 0);
});

// ── Metrics ────────────────────────────────────────────────────────────────

test('the two metrics rank pages differently — which is why both exist', () => {
  const idx = w.mushafAyahIndex();
  const p3 = idx.filter(x => x.page === 3);
  const p4 = idx.filter(x => x.page === 4);
  // Page 3: ONE ayah missed five times. Page 4: five DIFFERENT ayat, once each.
  w.localStorage.setItem('quranReviewAyahMistakes', JSON.stringify([
    ...Array.from({ length: 5 }, (_, i) => mistake(p3[0], `a${i}`, '2026-09-25')),
    ...p4.slice(0, 5).map((a, i) => mistake(a, `b${i}`, '2026-09-25')),
  ]));

  const at = (metric, page) =>
    w.computeMistakesHeatmap({ scope: 'hizb:1', metric }).cells.find(c => c.page === page).value;

  assert.equal(at('mistakes', 3), 5);
  assert.equal(at('mistakes', 4), 5);
  assert.equal(at('distinct', 3), 1, 'one shaky ayah, hit repeatedly');
  assert.equal(at('distinct', 4), 5, 'five shaky ayat');
  assert.ok(at('distinct', 4) > at('distinct', 3),
    'by spread, page 4 is the worse page; by raw count they tie');
});

test('type A is excluded, matching every other mistake view', () => {
  const p5 = w.mushafAyahIndex().filter(x => x.page === 5);
  w.localStorage.setItem('quranReviewAyahMistakes', JSON.stringify([
    mistake(p5[0], 'real', '2026-09-25'),
    mistake(p5[1], 'att', '2026-09-25', 'A'),
    mistake(p5[2], 'combo', '2026-09-25', 'AB'),   // 'A' combines with a real code
  ]));
  const cell = w.computeMistakesHeatmap({ scope: 'hizb:1' }).cells.find(c => c.page === 5);
  assert.equal(cell.mistakes, 1, 'a near-miss is not a mistake');
  assert.equal(cell.distinctAyat, 1);
});

test('the window drops older mistakes', () => {
  const p6 = w.mushafAyahIndex().filter(x => x.page === 6);
  const old = new Date(Date.now() - 200 * 864e5).toISOString().slice(0, 10);
  const recent = new Date().toISOString().slice(0, 10);
  w.localStorage.setItem('quranReviewAyahMistakes', JSON.stringify([
    mistake(p6[0], 'old', old),
    mistake(p6[1], 'new', recent),
  ]));
  const val = (days) =>
    w.computeMistakesHeatmap({ scope: 'hizb:1', windowDays: days }).cells.find(c => c.page === 6).mistakes;
  assert.equal(val(0), 2, 'all time');
  assert.equal(val(30), 1, 'the old one falls outside');
});

// ── Shading ────────────────────────────────────────────────────────────────

test('level 0 is reserved for "no mistakes", and the scale is relative', () => {
  assert.equal(w.heatmapLevel(0, 10), 0, 'a clean page is never faintly shaded');
  assert.equal(w.heatmapLevel(10, 10), 4, 'the worst cell in view is always full');
  assert.equal(w.heatmapLevel(1, 10), 1);
  assert.equal(w.heatmapLevel(0, 0), 0);
  // Relative, not absolute: 3 mistakes is the darkest cell in a quiet scope
  // and a mid tone in a busy one. A fixed scale would wash one of them out.
  assert.equal(w.heatmapLevel(3, 3), 4);
  assert.ok(w.heatmapLevel(3, 20) < 4);
});

// ── Rendering and click-through ────────────────────────────────────────────

test('renders a grid, and clicking a cell opens its detail', async () => {
  const d = w.document;
  const idx = w.mushafAyahIndex();
  const p3 = idx.filter(x => x.page === 3);
  w.localStorage.setItem('quranReviewAyahMistakes', JSON.stringify(
    Array.from({ length: 4 }, (_, i) => mistake(p3[0], `m${i}`, '2026-09-25', 'B'))));
  w.localStorage.setItem('quranReviewHeatmapScope', 'hizb:1');

  w.setView('overview');
  await new Promise(r => setTimeout(r, 60));

  const cells = () => [...d.querySelectorAll('.hm-cell[onclick]')];
  assert.equal(cells().length, 11);

  const hot = cells().find(c => c.className.includes('lv4'));
  assert.ok(hot, 'the worst page is fully shaded');
  assert.match(hot.getAttribute('title'), /4 mistakes across 1 ayah/);

  assert.equal(d.getElementById('hm-detail').innerHTML, '', 'nothing open initially');
  hot.click();
  await new Promise(r => setTimeout(r, 40));

  const detail = d.getElementById('hm-detail');
  assert.equal(detail.querySelector('.hm-detail-title').textContent, 'Page 3');
  // Mistakes are grouped into clusters, so each block names a real range.
  assert.ok(detail.querySelectorAll('.hm-cluster').length >= 1);
  assert.match(detail.querySelector('.mushaf-open-btn').getAttribute('onclick'),
    /openMushaf\(\{page:3\}\)/);

  // One at a time, and clicking the same cell closes it.
  hot.click();
  await new Promise(r => setTimeout(r, 40));
  assert.equal(d.getElementById('hm-detail').innerHTML, '');
});

test('the detail names each ayah\'s type codes, pooled across its mistakes', async () => {
  // clusterAyahMistakes() returns only {surah, ayah, count} per ayah, so the
  // codes must come from the raw entries. Reading a.type off the cluster —
  // which the first version did — renders no badge at all, silently.
  const d = w.document;
  const p7 = w.mushafAyahIndex().filter(x => x.page === 7);
  w.localStorage.setItem('quranReviewAyahMistakes', JSON.stringify([
    mistake(p7[0], 'x1', '2026-09-20', 'B'),
    mistake(p7[0], 'x2', '2026-09-24', 'SW'),
    mistake(p7[1], 'x3', '2026-09-22', 'M'),
  ]));
  w.setHeatmapScope('hizb:1');
  await new Promise(r => setTimeout(r, 40));
  [...d.querySelectorAll('.hm-cell[onclick]')].find(c => c.textContent.includes('p7')).click();
  await new Promise(r => setTimeout(r, 40));

  const text = d.getElementById('hm-detail').textContent.replace(/\s+/g, ' ');
  assert.match(text, /BSW ×2/, 'both mistakes’ codes on one ayah, deduped and ordered');
  assert.match(text, /M ×1/);
  // The range line shows the range's REAL length, per clusterAyahMistakes'
  // own note — gap-chaining can bridge clean ayat, so distinct alone misleads.
  assert.match(text, /2 ayat · 2 with mistakes · 3 total/);
});

test('switching scope closes a panel that may not exist in the new scope', async () => {
  const d = w.document;
  w.setHeatmapScope('hizb:1');
  await new Promise(r => setTimeout(r, 40));
  d.querySelector('.hm-cell[onclick]').click();
  await new Promise(r => setTimeout(r, 40));
  assert.notEqual(d.getElementById('hm-detail').innerHTML, '');

  w.setHeatmapScope('hizb:4');
  await new Promise(r => setTimeout(r, 40));
  assert.equal(d.getElementById('hm-detail').innerHTML, '',
    'page 1 is not in Hizb 4 — a stale open page must not linger');
});

test('the scope menu only offers scopes that contain memorized content', async () => {
  const d = w.document;
  w.localStorage.setItem('quranReviewMemorizedHizbs', JSON.stringify([1, 2]));
  w.setHeatmapScope('all');
  await new Promise(r => setTimeout(r, 40));

  const values = [...d.querySelectorAll('#hm-scope option')].map(o => o.value);
  assert.ok(values.includes('hizb:1') && values.includes('hizb:2'));
  assert.ok(!values.includes('hizb:3'), 'not memorized, so it would render empty');
  assert.ok(values.some(v => v.startsWith('surah:')));
  assert.ok(values.some(v => v.startsWith('juz:')));

  w.localStorage.setItem('quranReviewMemorizedHizbs', JSON.stringify([1, 2, 3, 4, 5, 6]));
});

test('no memorized hizbs says so rather than rendering an empty grid', async () => {
  const d = w.document;
  w.localStorage.setItem('quranReviewMemorizedHizbs', '[]');
  w.renderMistakesHeatmap();
  assert.match(d.getElementById('hm-grid').textContent, /No memorized hizbs/);
  assert.equal(d.querySelectorAll('.hm-cell[onclick]').length, 0);
  w.localStorage.setItem('quranReviewMemorizedHizbs', JSON.stringify([1, 2, 3, 4, 5, 6]));
});
