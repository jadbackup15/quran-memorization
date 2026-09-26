'use strict';

// Overview's Mistakes Heatmap (review.html) and the mushaf mistake lens it
// opens. One cell per printed mushaf page, shaded by an ABSOLUTE rate —
// mistakes per 10 recitations of that ayah's Hizb — so a colour means the same
// thing in every window, every scope, and on the page itself.

const { test, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { loadPage } = require('./helpers/loadPage.js');

const toPlain = (v) => JSON.parse(JSON.stringify(v));

let w;
before(async () => {
  w = (await loadPage('review.html')).window;
});

beforeEach(() => {
  w.localStorage.setItem('quranReviewMemorizedHizbs', JSON.stringify([1, 2, 3, 4, 5, 6]));
  w.localStorage.setItem('quranReviewAyahMistakes', '[]');
  w.localStorage.setItem('quranReviewHizbLog', '[]');
  w.localStorage.setItem('quranReviewMushafLens', 'false');
});

const today = new Date().toISOString().slice(0, 10);
const daysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);

const mistake = (a, id, date = today, type = null) => ({
  id, surah: a.surah, ayah: a.ayah, hizb: a.hizb, date, type, source: 'live',
});
/** n Recitation Log sessions for a Hizb, all inside the window. */
const sessions = (hizb, n, date = today) =>
  Array.from({ length: n }, (_, i) => ({ id: `s${hizb}-${i}-${date}`, hizb, mistakes: 1, date }));

const seed = (mistakes, log) => {
  w.localStorage.setItem('quranReviewAyahMistakes', JSON.stringify(mistakes));
  w.localStorage.setItem('quranReviewHizbLog', JSON.stringify(log));
};
const pageAyat = (p) => w.mushafAyahIndex().filter(x => x.page === p);

// ── The rate ───────────────────────────────────────────────────────────────

test('the rate is mistakes per 10 sessions, and the bands are absolute', () => {
  assert.equal(w.mistakeRatePer10(5, 20), 2.5);
  assert.equal(w.mistakeRatePer10(5, 10), 5);
  assert.equal(w.mistakeRatePer10(12, 10), 12, 'more mistakes than sittings is legal');

  assert.equal(w.rateLevel(0), 0);
  assert.equal(w.rateLevel(0.9), 1);
  assert.equal(w.rateLevel(1), 2, 'boundaries are inclusive at the bottom');
  assert.equal(w.rateLevel(2.4), 2);
  assert.equal(w.rateLevel(2.5), 3);
  assert.equal(w.rateLevel(4.9), 3);
  assert.equal(w.rateLevel(5), 4, 'exactly 5 per 10 sessions is already red');
  assert.equal(w.rateLevel(50), 4);
});

test('the two divide-by-zero cases go opposite ways', () => {
  // No mistakes and no sittings is CLEAN — an unrecited Hizb must not glow red
  // just because nothing is on record for it.
  assert.equal(w.mistakeRatePer10(0, 0), 0);
  assert.equal(w.rateLevel(w.mistakeRatePer10(0, 0)), 0);
  // Mistakes with no sitting on record is the WORST case, not a clean one:
  // something went wrong and nothing says you ever recited it.
  assert.equal(w.mistakeRatePer10(1, 0), Infinity);
  assert.equal(w.rateLevel(w.mistakeRatePer10(1, 0)), 4);
  assert.equal(w.formatMistakeRate(Infinity), '5+');
});

test('a quick review counts in the denominator', () => {
  // A `mistakes: null` session is the "I revised this but didn't track errors"
  // record. It is a real recitation, which is exactly what the rate measures —
  // excluding it would inflate the rate of everything in that Hizb.
  const a = pageAyat(3)[0];
  seed([mistake(a, 'm1'), mistake(a, 'm2')], [
    ...sessions(1, 3),
    { id: 'q1', hizb: 1, mistakes: null, date: today },
  ]);
  const rate = w.ayahMistakeRates().get(a.key);
  assert.equal(rate.sessions, 4, '3 logged + 1 quick review');
  assert.equal(rate.rate, 5, '10 × 2 / 4');
});

test('the denominator is that ayah\'s own Hizb, not every session', () => {
  const a = pageAyat(3)[0];           // Hizb 1
  seed([mistake(a, 'm1'), mistake(a, 'm2')],
    [...sessions(1, 4), ...sessions(5, 40)]);
  const rate = w.ayahMistakeRates().get(a.key);
  assert.equal(rate.hizb, 1);
  assert.equal(rate.sessions, 4, 'Hizb 5\'s 40 sittings are irrelevant here');
  assert.equal(rate.rate, 5);
});

test('the window filters BOTH halves, and the thresholds stay put', () => {
  const a = pageAyat(3)[0];
  seed(
    [mistake(a, 'old', daysAgo(60)), mistake(a, 'old2', daysAgo(50)), mistake(a, 'new')],
    [...sessions(1, 14, daysAgo(55)), ...sessions(1, 6)],
  );
  const at = (days) => w.ayahMistakeRates({ windowDays: days }).get(a.key);

  const all = at(0);
  assert.equal(all.mistakes, 3);
  assert.equal(all.sessions, 20);
  assert.equal(all.rate, 1.5, 'all time: 10 × 3 / 20');
  assert.equal(all.level, 2);

  const recent = at(30);
  assert.equal(recent.mistakes, 1, 'the two old ones fall outside');
  assert.equal(recent.sessions, 6, 'and so do the 14 old sittings');
  assert.ok(Math.abs(recent.rate - 10 / 6) < 1e-9);
  // The rate moved, the SCALE did not: level 2 is still 1–2.5 either way.
  assert.equal(recent.level, 2);
});

test('type A is excluded, matching every other mistake view', () => {
  const p = pageAyat(5);
  seed([
    mistake(p[0], 'real'),
    mistake(p[1], 'att', today, 'A'),
    mistake(p[2], 'combo', today, 'AB'),   // 'A' combines with a real code
  ], sessions(1, 10));
  const rates = w.ayahMistakeRates();
  assert.equal(rates.size, 1, 'a near-miss is not a mistake');
  assert.ok(rates.has(p[0].key));
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
});

test('pages with no mistakes still get a cell', () => {
  // Half the value of a heatmap is seeing the CLEAN stretches; dropping empty
  // pages would leave a grid of only bad news with no sense of proportion.
  const { cells, max } = w.computeMistakesHeatmap({ scope: 'hizb:1' });
  assert.equal(cells.length, 11);
  assert.ok(cells.every(c => c.rate === 0 && c.level === 0));
  assert.equal(max, 0);
});

// ── A cell takes its worst ayah ────────────────────────────────────────────

test('a page is coloured by its WORST ayah, not by an average or a total', () => {
  const p = pageAyat(3);
  // One genuinely bad ayah (5 in 10 sittings) among ten one-off slips. By any
  // page-wide average the page looks mild; the bad ayah is the thing to drill.
  seed([
    ...Array.from({ length: 5 }, (_, i) => mistake(p[0], `bad${i}`)),
    ...p.slice(1, 6).map((a, i) => mistake(a, `mild${i}`)),
  ], sessions(1, 10));

  const cell = w.computeMistakesHeatmap({ scope: 'hizb:1' }).cells.find(c => c.page === 3);
  assert.equal(cell.rate, 5);
  assert.equal(cell.level, 4, 'a red cell always means "a red ayah is in here"');
  assert.equal(cell.worstAyah.ayah, p[0].ayah);
  assert.equal(cell.mistakes, 10, 'the raw totals are still carried for the panel');
  assert.equal(cell.distinctAyat, 6);
  // A page-wide rate would have been 10 × 10 / 10 = 10 — also red, but for the
  // wrong reason: a long page would then outrank a short one at equal quality.
  assert.equal(cell.worstAyah.mistakes, 5);
});

// ── Rendering and click-through ────────────────────────────────────────────

test('renders a grid, and clicking a cell opens its detail', async () => {
  const d = w.document;
  const p = pageAyat(3);
  seed(Array.from({ length: 4 }, (_, i) => mistake(p[0], `m${i}`, today, 'B')),
    sessions(1, 8));
  w.localStorage.setItem('quranReviewHeatmapScope', 'hizb:1');

  w.setView('overview');
  await new Promise(r => setTimeout(r, 60));

  const cells = () => [...d.querySelectorAll('.hm-cell[onclick]')];
  assert.equal(cells().length, 11);

  const hot = cells().find(c => c.className.includes('lv4'));
  assert.ok(hot, '10 × 4 / 8 = 5.0, which is red');
  assert.match(hot.getAttribute('title'), /Worst: 2:6 — 5\.0 per 10 sessions/);
  assert.match(hot.querySelector('.n').textContent, /5\.0/);

  assert.equal(d.getElementById('hm-detail').innerHTML, '', 'nothing open initially');
  hot.click();
  await new Promise(r => setTimeout(r, 40));

  const detail = d.getElementById('hm-detail');
  assert.equal(detail.querySelector('.hm-detail-title').textContent, 'Page 3');
  // Mistakes are grouped into clusters, so each block names a real range.
  assert.ok(detail.querySelectorAll('.hm-cluster').length >= 1);
  assert.match(detail.querySelector('.mushaf-open-btn').getAttribute('onclick'),
    /openMushafLens\(3\)/);

  // One at a time, and clicking the same cell closes it.
  hot.click();
  await new Promise(r => setTimeout(r, 40));
  assert.equal(d.getElementById('hm-detail').innerHTML, '');
});

test('the legend states the real thresholds, not "none" and "most"', async () => {
  w.setHeatmapScope('hizb:1');
  await new Promise(r => setTimeout(r, 40));
  const legend = w.document.getElementById('hm-legend').textContent;
  for (const t of ['0', '<1', '1+', '2.5+', '5+']) assert.ok(legend.includes(t), t);
  assert.match(w.document.getElementById('hm-hint').textContent,
    /per 10 recitations of its Hizb.*5\+ is always red/);
});

test('the detail names each ayah\'s type codes, pooled across its mistakes', async () => {
  // clusterAyahMistakes() returns only {surah, ayah, count} per ayah, so the
  // codes must come from the raw entries. Reading a.type off the cluster —
  // which the first version did — renders no badge at all, silently.
  const d = w.document;
  const p7 = pageAyat(7);
  seed([
    mistake(p7[0], 'x1', daysAgo(6), 'B'),
    mistake(p7[0], 'x2', daysAgo(2), 'SW'),
    mistake(p7[1], 'x3', daysAgo(4), 'M'),
  ], sessions(1, 10));
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
});

test('no memorized hizbs says so rather than rendering an empty grid', async () => {
  const d = w.document;
  w.localStorage.setItem('quranReviewMemorizedHizbs', '[]');
  w.renderMistakesHeatmap();
  assert.match(d.getElementById('hm-grid').textContent, /No memorized hizbs/);
  assert.equal(d.querySelectorAll('.hm-cell[onclick]').length, 0);
});

// ── The mushaf mistake lens ────────────────────────────────────────────────

test('a highlight with no level still renders exactly ONE merged band', () => {
  // Guards the four pre-existing callers (overlay, Mushaf Drill, Memorization
  // Test, Mutashabihat compare): a contiguous cluster must stay one band
  // spanning first line to last, not fragment into one band per ayah.
  const p = pageAyat(3).slice(0, 4).map(a => ({ surah: a.surah, ayah: a.ayah }));
  const html = w.mushafBandHtmlFor(3, p);
  assert.equal((html.match(/mushaf-band/g) || []).length, 1);
  assert.ok(!/lv\d/.test(html), 'and it carries no level class');
});

test('levelled highlights are banded individually, and shaded by level', () => {
  const p = pageAyat(3);
  const html = w.mushafBandHtmlFor(3, [
    { surah: p[0].surah, ayah: p[0].ayah, level: 1 },
    { surah: p[5].surah, ayah: p[5].ayah, level: 4 },
  ]);
  assert.equal((html.match(/mushaf-band/g) || []).length, 2);
  assert.ok(html.includes('lv1') && html.includes('lv4'));
});

test('two ayat sharing a line range collapse into one band at the worse level', () => {
  // Otherwise two identical translucent rectangles stack and the line reads as
  // darker than either ayah deserves. Real pair, not a synthetic one: 3:1 and
  // 3:2 are both recorded as line [3,3] of page 50, and 290 such pairs exist
  // across the mushaf, so this is a case the lens will genuinely hit.
  assert.deepEqual(toPlain(w.QURAN_LINE_BANDS['3:1']['50']), [3, 3]);
  assert.deepEqual(toPlain(w.QURAN_LINE_BANDS['3:2']['50']), [3, 3]);

  const html = w.mushafBandHtmlFor(50, [
    { surah: 3, ayah: 1, level: 1 },
    { surah: 3, ayah: 2, level: 3 },
  ]);
  assert.equal((html.match(/mushaf-band/g) || []).length, 1);
  assert.ok(html.includes('lv3') && !html.includes('lv1'));
});

test('the lens follows you as you page — the whole point of it', async () => {
  const d = w.document;
  // Mistakes on page 3 (the spread we open on) and on page 5 (the next one).
  const p3 = pageAyat(3), p5 = pageAyat(5);
  seed([
    ...Array.from({ length: 5 }, (_, i) => mistake(p3[0], `a${i}`)),
    ...Array.from({ length: 2 }, (_, i) => mistake(p5[0], `b${i}`)),
  ], sessions(1, 10));

  w.openMushaf({ page: 3, lens: true, lensWindowDays: 0 });
  await new Promise(r => setTimeout(r, 40));
  const bands = () => [...d.querySelectorAll('#mushaf-overlay-body .mushaf-band')];
  assert.equal(bands().length, 1, 'one mistaken ayah on the 3|4 spread');
  assert.ok(bands()[0].className.includes('lv4'), '10 × 5 / 10 = 5.0');

  // ‹ advances (a mushaf turns leftward), so this lands on the 5|6 spread.
  d.querySelector('.mushaf-page-btn').click();
  await new Promise(r => setTimeout(r, 40));
  assert.match(d.querySelector('.mushaf-page-label').textContent, /pages 5–6/);
  assert.equal(bands().length, 1, 'recomputed for the new spread, not the old array');
  assert.ok(bands()[0].className.includes('lv2'), '10 × 2 / 10 = 2.0');

  // And a spread with nothing logged is simply bare, not stale.
  w.mushafOverlayNext();
  await new Promise(r => setTimeout(r, 40));
  assert.equal(bands().length, 0);
  w.closeMushaf();
});

test('the lens toggle persists, and the caller\'s own band drops to an outline', async () => {
  const d = w.document;
  const p3 = pageAyat(3);
  seed([mistake(p3[4], 'm1'), mistake(p3[4], 'm2')], sessions(1, 4));

  // Opened on a cluster, lens off: the caller's band is a normal filled band.
  w.openMushaf({ surah: p3[0].surah, ayah: p3[0].ayah, endAyah: p3[2].ayah });
  await new Promise(r => setTimeout(r, 40));
  let bands = [...d.querySelectorAll('#mushaf-overlay-body .mushaf-band')];
  assert.equal(bands.length, 1);
  assert.ok(!bands[0].className.includes('is-outline'));

  d.getElementById('mushaf-lens-toggle').click();
  await new Promise(r => setTimeout(r, 40));
  bands = [...d.querySelectorAll('#mushaf-overlay-body .mushaf-band')];
  assert.equal(bands.length, 2, 'the cluster, plus the lens band for 2:10');
  assert.ok(bands.some(b => b.className.includes('is-outline')),
    'the cluster band gives up its fill so the lens colours read true');
  assert.ok(bands.some(b => b.className.includes('lv4')), '10 × 2 / 4 = 5.0');
  assert.equal(w.localStorage.getItem('quranReviewMushafLens'), 'true');

  // The preference survives into the next overlay opened from anywhere.
  w.closeMushaf();
  w.openMushaf({ page: 3 });
  await new Promise(r => setTimeout(r, 40));
  assert.ok([...d.querySelectorAll('#mushaf-overlay-body .mushaf-band')].length > 0);
  w.closeMushaf();
});

test('openMushafLens takes its window from the heatmap\'s own selector', async () => {
  const d = w.document;
  const p3 = pageAyat(3);
  seed([mistake(p3[0], 'old', daysAgo(60))], sessions(1, 4, daysAgo(60)));

  w.setView('overview');
  await new Promise(r => setTimeout(r, 60));
  d.getElementById('hm-window').value = '7';

  w.openMushafLens(3);
  await new Promise(r => setTimeout(r, 40));
  assert.equal(d.querySelectorAll('#mushaf-overlay-body .mushaf-band').length, 0,
    'the only mistake is 60 days old, outside the 7-day window');

  d.getElementById('hm-window').value = '0';
  w.openMushafLens(3);
  await new Promise(r => setTimeout(r, 40));
  assert.equal(d.querySelectorAll('#mushaf-overlay-body .mushaf-band').length, 1);
  w.closeMushaf();
});
