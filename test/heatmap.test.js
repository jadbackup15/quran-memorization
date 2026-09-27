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
  // All three: the two layer keys fall back to the legacy one, so resetting
  // only that would leave a previous test's explicit layer choice standing.
  w.localStorage.setItem('quranReviewMushafLens', 'false');
  w.localStorage.setItem('quranReviewMushafShowMistakes', 'false');
  w.localStorage.setItem('quranReviewMushafShowNotes', 'false');
  w.localStorage.setItem('quranReviewAyahNotes', '{}');
  w._ayahHistoryKey = null;
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

test('bands never OVERLAP — one level per line, worse ayah wins the seam', () => {
  // The reported "why are there several colours per ayah?". Consecutive ayat
  // share a line: page 23 is 2:146 [1,2], 2:147 [2,3], 2:148 [3,5]... 5,730
  // such pairs exist, so one rectangle per ayah stacked two translucent fills
  // on every seam and striped the page in shades belonging to no ayah at all.
  assert.deepEqual(toPlain(w.QURAN_LINE_BANDS['2:146']['23']), [1, 2]);
  assert.deepEqual(toPlain(w.QURAN_LINE_BANDS['2:147']['23']), [2, 3]);

  const html = w.mushafBandHtmlFor(23, [
    { surah: 2, ayah: 146, level: 1 },
    { surah: 2, ayah: 147, level: 3 },
  ]);
  const bands = [...html.matchAll(/lv(\d)" style="top:([\d.]+)%;height:([\d.]+)%/g)]
    .map(m => ({ level: +m[1], top: +m[2], height: +m[3] }))
    .sort((a, b) => a.top - b.top);
  assert.equal(bands.length, 2);
  // Line 1 alone is lv1; the shared line 2 goes to lv3 along with line 3.
  assert.equal(bands[0].level, 1);
  assert.equal(bands[1].level, 3);
  // The actual invariant: no band starts before the previous one ends.
  const gap = bands[1].top - (bands[0].top + bands[0].height);
  assert.ok(Math.abs(gap) < 0.01, `bands must abut, not overlap (gap ${gap})`);
});

test('a multi-line ayah is ONE band, not one strip per line', () => {
  // 2:150 spans lines 7-11 of page 23. Resolving per line must not fragment
  // it — contiguous lines at the same level merge back into one block.
  assert.deepEqual(toPlain(w.QURAN_LINE_BANDS['2:150']['23']), [7, 11]);
  const html = w.mushafBandHtmlFor(23, [{ surah: 2, ayah: 150, level: 2 }]);
  assert.equal((html.match(/mushaf-band/g) || []).length, 1);
  const solo = w.mushafBandStyle([7, 11], 23);
  assert.ok(html.includes(`top:${solo.top}%;height:${solo.height}%`),
    'and it covers exactly the lines the ayah occupies');
});

// ── Margin notes ───────────────────────────────────────────────────────────

test('the breakdown counts CODES, not entries', () => {
  // A mistake's type can hold several codes at once: "BS" is one mistake that
  // was both, so it adds one to B and one to S. The totals can therefore
  // legitimately exceed the mistake count, which the tooltip says out loud.
  const parts = w.mistakeTypeBreakdown([
    { type: 'B' }, { type: 'B' }, { type: 'B' }, { type: 'BS' },
  ]);
  assert.deepEqual(toPlain(parts), [{ code: 'B', count: 4 }, { code: 'S', count: 1 }]);
  assert.equal(w.mistakeBreakdownLabel(parts), '4B 1S');
  assert.match(w.mistakeBreakdownTitle(parts), /4 × Forgot the beginning/);
  assert.match(w.mistakeBreakdownTitle(parts), /need not add to 5/);
});

test('the breakdown is worst-first, and an untyped mistake still counts', () => {
  const parts = w.mistakeTypeBreakdown([
    { type: null }, { type: 'T' }, { type: 'T' }, { type: 'T' }, { type: 'E' },
  ]);
  assert.equal(parts[0].code, 'T');
  assert.equal(w.mistakeBreakdownLabel(parts), '3T 1E 1');
  // A real mistake with nothing recorded about it is a bare count, not a drop.
  assert.match(w.mistakeBreakdownTitle(parts), /1 × no type recorded/);
  // P is stored as one letter but has always been shown to users as "pem".
  assert.equal(w.mistakeBreakdownLabel(w.mistakeTypeBreakdown([{ type: 'P' }])), '1pem');
});

test('every code is shown — nothing is truncated away', () => {
  // An earlier version capped at three and appended "+3", which on a real
  // page rendered as "7E 4 …" — the margin hiding the very detail it exists
  // to carry. The margin is sized and wrapped to fit instead.
  const parts = w.mistakeTypeBreakdown([
    { type: 'B' }, { type: 'B' }, { type: 'B' },
    { type: 'S' }, { type: 'S' }, { type: 'T' }, { type: 'E' }, { type: 'W' },
  ]);
  const label = w.mistakeBreakdownLabel(parts);
  assert.equal(label, '3B 2S 1W 1T 1E');
  assert.ok(!label.includes('+'), 'no "+N", and nothing dropped');
  for (const name of ['Mutashabihat', 'Ending', 'Word slip']) {
    assert.ok(w.mistakeBreakdownTitle(parts).includes(name), name);
  }
});

test('a long label reserves more vertical room than a short one', () => {
  // Once nothing is truncated, a busy ayah's label really does wrap to two or
  // three lines. Spacing every note as though it were one line would put the
  // long ones straight through whatever sits below them.
  const tops = (html) => [...html.matchAll(/top:([\d.]+)%/g)].map(m => +m[1]);
  const at = (firstNote) => tops(w.mushafGutterHtmlFor(50, [
    { surah: 3, ayah: 1, level: 1, note: firstNote },
    { surah: 3, ayah: 2, level: 1, note: '1B' },
  ]));
  const short = at('1B');
  const long = at('3B 2S 1W 1T 1E');
  assert.ok(long[1] - long[0] > short[1] - short[0],
    `a wrapping label pushes further (${short} vs ${long})`);
});

test('notes are per AYAH even where the bands merge into one', () => {
  // 2:146 [1,2] and 2:147 [2,3] share line 2, so they draw as two abutting
  // bands — but two separate things are wrong with them, so two notes.
  const html = w.mushafGutterHtmlFor(23, [
    { surah: 2, ayah: 146, level: 2, note: '3B', noteTitle: 't' },
    { surah: 2, ayah: 147, level: 4, note: '2T 1S', noteTitle: 't' },
  ]);
  const notes = [...html.matchAll(/mushaf-note lv(\d)" style="top:([\d.]+)%[\s\S]*?>([^<]*)</g)]
    .map(m => ({ level: +m[1], top: +m[2], text: m[3] }));
  assert.equal(notes.length, 2);
  assert.deepEqual(notes.map(n => n.text), ['3B', '2T 1S']);
  assert.deepEqual(notes.map(n => n.level), [2, 4], 'tinted like its own band');
  assert.ok(notes[1].top > notes[0].top);
});

test('notes that would land on each other are pushed apart; others are not', () => {
  // 3:1 and 3:2 BOTH begin on line 3 of page 50 — without this they stamp on
  // top of one another. Consecutive ayat normally start a line apart, and
  // those must not be nudged, or every note drifts off its own line.
  assert.equal(w.QURAN_LINE_BANDS['3:1']['50'][0], 3);
  assert.equal(w.QURAN_LINE_BANDS['3:2']['50'][0], 3);
  const tops = (html) => [...html.matchAll(/top:([\d.]+)%/g)].map(m => +m[1]);

  const collided = tops(w.mushafGutterHtmlFor(50, [
    { surah: 3, ayah: 1, level: 1, note: '1B' },
    { surah: 3, ayah: 2, level: 1, note: '2S' },
  ]));
  const pitch = (0.930 - 0.024) / 15 * 100;
  assert.ok(collided[1] - collided[0] >= pitch * 0.74, `pushed apart (${collided})`);

  // Two ayat a line apart keep their own exact positions.
  const spaced = tops(w.mushafGutterHtmlFor(23, [
    { surah: 2, ayah: 146, level: 1, note: '1B' },
    { surah: 2, ayah: 147, level: 1, note: '1S' },
  ]));
  assert.equal(spaced[0], w.mushafBandStyle([1, 2], 23).top);
  assert.equal(spaced[1], w.mushafBandStyle([2, 3], 23).top);
});

test('no lens, no gutter — the four other spread callers keep their full width', () => {
  // The Memorization Test, Mushaf Drill, Mutashabihat compare and a plain
  // openMushaf({surah, ayah}) all pass level-free highlights.
  assert.equal(w.mushafGutterHtmlFor(23, [{ surah: 2, ayah: 146 }]), '');
  // A level with no note (nothing typed on it) is not a note either.
  assert.equal(w.mushafGutterHtmlFor(23, [{ surah: 2, ayah: 146, level: 3 }]), '');
  const plain = w.mushafSpreadHtml({
    viewPage: 23, highlights: [{ surah: 2, ayah: 146 }], prevFn: 'p()', nextFn: 'n()',
  });
  assert.ok(!plain.includes('mushaf-gutter'));
});

test('the margin sits on each page\'s OUTER edge', async () => {
  const d = w.document;
  const today2 = new Date().toISOString().slice(0, 10);
  const p7 = pageAyat(7), p8 = pageAyat(8);
  const hizbs = [...new Set([...p7, ...p8].map(x => x.hizb))];
  w.localStorage.setItem('quranReviewMemorizedHizbs', JSON.stringify(hizbs));
  w.localStorage.setItem('quranReviewAyahMistakes', JSON.stringify([
    { id: 'g1', surah: p7[0].surah, ayah: p7[0].ayah, hizb: p7[0].hizb, date: today2, type: 'B', source: 'live' },
    { id: 'g2', surah: p8[0].surah, ayah: p8[0].ayah, hizb: p8[0].hizb, date: today2, type: 'T', source: 'live' },
  ]));
  w.localStorage.setItem('quranReviewHizbLog', JSON.stringify(
    hizbs.map(h => ({ id: 's' + h, hizb: h, mistakes: 1, date: today2 }))));

  w.openMushaf({ page: 7, lens: true, lensWindowDays: 0 });
  await new Promise(r => setTimeout(r, 40));

  for (const col of d.querySelectorAll('.mushaf-page-col')) {
    const page = col.querySelector('img').src.match(/(\d+)\.jpg/)[1];
    const kids = [...col.querySelector('.mushaf-page-body').children].map(e => e.className.split(' ')[0]);
    // Odd page prints on the RIGHT of the spread, so its margin follows the
    // image; the even page's precedes it. Both end up on the outside.
    assert.deepEqual(kids, page === '7'
      ? ['mushaf-image-wrap', 'mushaf-gutter']
      : ['mushaf-gutter', 'mushaf-image-wrap'], `page ${page}`);
  }
  assert.equal(d.querySelectorAll('.mushaf-note').length, 2);
  assert.equal(d.querySelector('.mushaf-gutter.right-side .mushaf-note').textContent, '1B');
  w.closeMushaf();
});

// ── User-written ayah notes ────────────────────────────────────────────────

test('an ayah you wrote a note about appears in the margin even with no mistakes', () => {
  // "I always drop the second فَ" is exactly what you want in front of you
  // while reading, and it may well be WHY that ayah has no mistakes any more.
  w.localStorage.setItem('quranReviewAyahNotes', JSON.stringify({
    '2:146': { note: 'I always drop the second fa', dateAdded: '2026-09-01T00:00:00.000Z' },
  }));
  const highlights = w.mushafLensHighlights(23, 0);
  const note = highlights.find(h => h.ayah === 146);
  assert.ok(note, 'a note-only ayah is still a highlight');
  assert.equal(note.level, 0, 'nothing went wrong on it, so it gets no band');
  assert.equal(note.userNote, 'I always drop the second fa');

  // Level 0 means a margin note but NO band — shading a clean ayah would lie.
  assert.equal(w.mushafBandHtmlFor(23, highlights), '');
  const gutter = w.mushafGutterHtmlFor(23, highlights);
  assert.ok(gutter.includes('lv0') && gutter.includes('📝'));
  assert.match(gutter, /openAyahHistory\(2, 146\)/,
    'clicking opens the ayah\u2019s history, which carries the add-note button');
});

test('a note on an ayah that ALSO has mistakes rides alongside the codes', () => {
  const today3 = new Date().toISOString().slice(0, 10);
  const p = pageAyat(23)[0];
  seed([{ id: 'n1', surah: p.surah, ayah: p.ayah, hizb: p.hizb, date: today3, type: 'B', source: 'live' }],
    sessions(p.hizb, 5, today3));
  w.localStorage.setItem('quranReviewMemorizedHizbs', JSON.stringify([p.hizb]));
  w.localStorage.setItem('quranReviewAyahNotes', JSON.stringify({
    [`${p.surah}:${p.ayah}`]: { note: 'watch the ending', dateAdded: '2026-09-01T00:00:00.000Z' },
  }));

  const h = w.mushafLensHighlights(23, 0).find(x => x.ayah === p.ayah);
  assert.ok(h.level > 0, 'the mistake still sets the level');
  assert.equal(h.note, '1B');
  assert.equal(h.userNote, 'watch the ending');
  assert.match(h.noteTitle, /📝 watch the ending/);
  // One block, so the whole thing stays clickable as a unit.
  assert.match(w.mushafGutterHtmlFor(23, [h]), />1B 📝</);
});

test('notes accumulate on an ayah rather than replacing each other', () => {
  const realPrompt = w.prompt;
  try {
    w.prompt = () => 'forget the waw';
    assert.equal(w.addAyahNote(2, 255), true);
    w.prompt = () => 'and the fa';
    assert.equal(w.addAyahNote(2, 255), true);

    const list = w.getAyahNotes(2, 255);
    assert.deepEqual(toPlain(list.map(n => n.text)), ['forget the waw', 'and the fa'],
      'oldest first — a second note must not overwrite the first');
    assert.ok(list[0].id !== list[1].id);

    // Nothing typed is not a note, and cancelling adds nothing either.
    w.prompt = () => '   ';
    assert.equal(w.addAyahNote(2, 255), false);
    w.prompt = () => null;
    assert.equal(w.addAyahNote(2, 255), false);
    assert.equal(w.getAyahNotes(2, 255).length, 2);
  } finally { w.prompt = realPrompt; }
});

test('editing one note leaves the others alone, and cancel is not delete', () => {
  const realPrompt = w.prompt, realConfirm = w.confirm;
  try {
    w.prompt = () => 'first';  w.addAyahNote(2, 255);
    w.prompt = () => 'second'; w.addAyahNote(2, 255);
    const [a, b] = w.getAyahNotes(2, 255);
    const added = a.dateAdded;

    w.prompt = () => 'first, revised';
    assert.equal(w.editAyahNoteAt(2, 255, a.id), true);
    let list = w.getAyahNotes(2, 255);
    assert.deepEqual(toPlain(list.map(n => n.text)), ['first, revised', 'second']);
    assert.equal(list[0].dateAdded, added, 'an edit keeps the original date');

    // null is CANCEL. Treating it as '' would lose a note to a stray Escape.
    w.prompt = () => null;
    assert.equal(w.editAyahNoteAt(2, 255, b.id), false);
    assert.equal(w.getAyahNotes(2, 255).length, 2);

    // Clearing the box deletes just that one, and only after a confirm.
    w.prompt = () => '';
    w.confirm = () => false;
    assert.equal(w.editAyahNoteAt(2, 255, b.id), false);
    assert.equal(w.getAyahNotes(2, 255).length, 2, 'declining the confirm keeps it');
    w.confirm = () => true;
    assert.equal(w.editAyahNoteAt(2, 255, b.id), true);
    list = w.getAyahNotes(2, 255);
    assert.deepEqual(toPlain(list.map(n => n.text)), ['first, revised'], 'only the edited one went');

    // Deleting the last one drops the key entirely rather than leaving a husk.
    assert.equal(w.deleteAyahNoteAt(2, 255, list[0].id), true);
    assert.deepEqual(toPlain(w.loadAyahNotes()), {});
  } finally { w.prompt = realPrompt; w.confirm = realConfirm; }
});

test('a note written before multi-note support still loads', () => {
  // The store began as one note per ayah. Normalising on read costs nothing
  // and cannot half-finish, so there is no migration pass to go wrong.
  w.localStorage.setItem('quranReviewAyahNotes', JSON.stringify({
    '2:255': { note: 'written the old way', dateAdded: '2026-01-02T00:00:00.000Z' },
  }));
  const list = w.getAyahNotes(2, 255);
  assert.deepEqual(toPlain(list.map(n => n.text)), ['written the old way']);

  // And adding a second one upgrades the entry without losing the first.
  const realPrompt = w.prompt;
  try {
    w.prompt = () => 'written the new way';
    w.addAyahNote(2, 255);
    assert.deepEqual(toPlain(w.getAyahNotes(2, 255).map(n => n.text)),
      ['written the old way', 'written the new way']);
  } finally { w.prompt = realPrompt; }
});

test('a note survives a backup round-trip through review.html\'s own importer', () => {
  // buildFullLogData() has always written these, but importLogData() never
  // read them back, so export-then-import silently dropped every note. The
  // OTHER import path (log.js applyFullLogData) did handle them, which is
  // exactly why it went unnoticed — the two disagreed.
  const realPrompt = w.prompt, realConfirm = w.confirm;
  try {
    w.prompt = () => 'the long one';
    w.addAyahNote(2, 255);
    const backup = toPlain(w.buildFullLogData());
    assert.ok(backup.review.ayahNotes['2:255'], 'notes are in the exported file');

    w.localStorage.setItem('quranReviewAyahNotes', '{}');
    w.confirm = () => true;
    w.importLogData(backup);
    assert.deepEqual(toPlain(w.getAyahNotes(2, 255).map(n => n.text)), ['the long one']);
  } finally {
    w.prompt = realPrompt; w.confirm = realConfirm;
    w.localStorage.setItem('quranReviewAyahNotes', '{}');
  }
});

test('a spread with no active page is not dimmed — both pages read full', () => {
  // `.mushaf-page-col:not(.is-active)` dimmed to 55% opacity, which assumed a
  // page is always active. Opening by page number marks neither, so BOTH went
  // translucent and the whole spread read as washed out with nothing saying
  // why. Reported as "why is the text pale".
  const byPage = w.mushafSpreadHtml({ viewPage: 23, prevFn: 'p()', nextFn: 'n()' });
  assert.equal((byPage.match(/is-dimmed/g) || []).length, 0);
  assert.equal((byPage.match(/is-active/g) || []).length, 0);

  // With a real ayah to point at, the facing page still steps back.
  const byAyah = w.mushafSpreadHtml({
    viewPage: 23, highlights: [{ surah: 2, ayah: 146 }], prevFn: 'p()', nextFn: 'n()',
  });
  assert.equal((byAyah.match(/is-active/g) || []).length, 1);
  assert.equal((byAyah.match(/is-dimmed/g) || []).length, 1);

  // Lens bands must not drive it either, or a lens on both pages dims neither
  // and the marker stops meaning anything.
  const lensOnly = w.mushafSpreadHtml({
    viewPage: 23, highlights: [{ surah: 2, ayah: 146, level: 4 }], prevFn: 'p()', nextFn: 'n()',
  });
  assert.equal((lensOnly.match(/is-dimmed|is-active/g) || []).length, 0);
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
  d.querySelector('#mushaf-overlay-body .mushaf-page-btn').click();
  await new Promise(r => setTimeout(r, 40));
  assert.match(d.querySelector('#mushaf-overlay-body .mushaf-page-label').textContent, /pages 5–6/);
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

  // The single lens button is now two layer checkboxes.
  const boxes = [...d.querySelectorAll('#mushaf-lens-toggle input[type=checkbox]')];
  assert.equal(boxes.length, 2, 'Mistakes and Notes are independent layers');
  boxes.forEach(b => { if (!b.checked) { b.checked = true; b.onchange(); } });
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

// ── The Mushaf tab ─────────────────────────────────────────────────────────

test('the Mushaf tab pages on its own, without disturbing the overlay', async () => {
  const d = w.document;
  w.localStorage.setItem('quranReviewMushafShowMistakes', 'true');
  w.setView('mushaf');
  await new Promise(r => setTimeout(r, 40));

  const label = () => d.querySelector('#mushaf-tab-stage .mushaf-page-label').textContent;
  w.setMushafTabPage(23);
  assert.match(label(), /pages 23–24/);
  assert.equal(d.getElementById('mushaf-tab-page').value, '23');

  // ‹ advances — a mushaf turns leftward, same as everywhere else.
  d.querySelector('#mushaf-tab-stage .mushaf-page-btn').click();
  await new Promise(r => setTimeout(r, 20));
  assert.match(label(), /pages 25–26/);

  // The overlay keeps its own place: paging here must not move it.
  w.openMushaf({ page: 3 });
  await new Promise(r => setTimeout(r, 20));
  assert.match(d.querySelector('#mushaf-overlay-body .mushaf-page-label').textContent, /pages 3–4/);
  w.mushafTabNext();
  assert.match(d.querySelector('#mushaf-overlay-body .mushaf-page-label').textContent, /pages 3–4/,
    'the overlay stayed where it was');
  w.closeMushaf();

  // And the page survives a reload, so you resume where you stopped reading.
  // 23 → 25 (the click) → 27 (mushafTabNext above).
  assert.equal(w.localStorage.getItem('quranReviewMushafTabPage'), '27');
});

test('a bad page number is refused rather than silently clamped', () => {
  const realAlert = w.alert;
  try {
    let said = '';
    w.alert = (m) => { said = m; };
    w.setMushafTabPage(23);
    w.goToMushafPage('999');
    assert.match(said, /between 1 and 604/);
    assert.equal(w.getMushafTabPage(), 23, 'and the view did not move');
  } finally { w.alert = realAlert; }
});

test('the two layer checkboxes are independent, and drive what is drawn', async () => {
  const d = w.document;
  const p = pageAyat(23)[0];
  seed([mistake(p, 'x1', today, 'B')], sessions(p.hizb, 5));
  w.localStorage.setItem('quranReviewMemorizedHizbs', JSON.stringify([p.hizb]));
  w.localStorage.setItem('quranReviewAyahNotes', JSON.stringify({
    [`${pageAyat(23)[3].surah}:${pageAyat(23)[3].ayah}`]:
      { notes: [{ id: 'n1', text: 'only a note here', dateAdded: today }] },
  }));
  w.setMushafTabPage(23);
  w.setView('mushaf');

  const notes = () => [...d.querySelectorAll('#mushaf-tab-stage .mushaf-note')].map(n => n.className);
  const bands = () => d.querySelectorAll('#mushaf-tab-stage .mushaf-band').length;

  w.setMushafLayer('mistakes', true); w.setMushafLayer('notes', true);
  assert.equal(notes().length, 2, 'the mistaken ayah and the annotated one');
  assert.equal(bands(), 1, 'only the mistaken one is shaded');

  // Notes only: read the page with just your own annotations on it.
  w.setMushafLayer('mistakes', false);
  assert.equal(notes().length, 1);
  assert.ok(notes()[0].includes('lv0'));
  assert.equal(bands(), 0);

  // Mistakes only.
  w.setMushafLayer('mistakes', true); w.setMushafLayer('notes', false);
  assert.equal(notes().length, 1);
  assert.ok(!notes()[0].includes('lv0'));
  assert.equal(bands(), 1);

  // Both off is a clean page — no gutter at all, so it keeps its full width.
  w.setMushafLayer('mistakes', false);
  assert.equal(notes().length, 0);
  assert.equal(d.querySelectorAll('#mushaf-tab-stage .mushaf-gutter').length, 0);
});

// ── One ayah's history ─────────────────────────────────────────────────────

test('clicking a margin annotation opens that ayah\'s history', async () => {
  const d = w.document;
  const p = pageAyat(23)[0];
  seed([
    { id: 'h1', surah: p.surah, ayah: p.ayah, hizb: p.hizb, date: daysAgo(9), type: 'B', note: 'lost the opening', source: 'live' },
    { id: 'h2', surah: p.surah, ayah: p.ayah, hizb: p.hizb, date: daysAgo(2), type: 'ST', source: 'telegram' },
    { id: 'h3', surah: p.surah, ayah: p.ayah, hizb: p.hizb, date: daysAgo(1), type: 'A', source: 'live' },
  ], sessions(p.hizb, 4));
  w.localStorage.setItem('quranReviewMemorizedHizbs', JSON.stringify([p.hizb]));
  w.localStorage.setItem('quranReviewMushafShowMistakes', 'true');
  w.setMushafTabPage(23);
  w.setView('mushaf');
  await new Promise(r => setTimeout(r, 40));

  assert.equal(d.querySelectorAll('#mushaf-tab-stage .ayah-hist').length, 0, 'closed initially');
  d.querySelector('#mushaf-tab-stage .mushaf-note').click();
  await new Promise(r => setTimeout(r, 20));

  const panel = d.querySelector('#mushaf-tab-stage .ayah-hist');
  assert.ok(panel, 'the annotation opens the history, not a note prompt');
  assert.match(panel.querySelector('.ayah-hist-title').textContent, new RegExp(`${p.surah}:${p.ayah}`));
  // Every entry is listed, type A included — "it felt shaky" is worth seeing
  // beside the real slips even though it is not counted as one.
  assert.equal(panel.querySelectorAll('.ayah-hist-row').length, 3);
  assert.match(panel.textContent, /lost the opening/);
  assert.match(panel.textContent, /2 mistakes in 4 sessions/, 'the A is not counted');
  // Newest first.
  const dates = [...panel.querySelectorAll('.ayah-hist-date')].map(e => new Date(e.textContent));
  assert.ok(dates[0] >= dates[1] && dates[1] >= dates[2]);
  // And it carries the add-note button, so clicking through loses nothing.
  assert.match(panel.textContent, /Add a note/);

  // Clicking the same annotation again closes it.
  d.querySelector('#mushaf-tab-stage .mushaf-note.is-open').click();
  await new Promise(r => setTimeout(r, 20));
  assert.ok(d.querySelector('#mushaf-tab-stage .ayah-hist'), 'still open — only ✕ closes');
  w.closeAyahHistory();
  assert.equal(d.querySelectorAll('#mushaf-tab-stage .ayah-hist').length, 0);
});

test('an ayah with no mistakes still opens a history panel', () => {
  w.localStorage.setItem('quranReviewAyahMistakes', '[]');
  const html = w.ayahHistoryHtml(2, 255);
  assert.match(html, /Nothing logged on this ayah yet/);
  assert.match(html, /No mistakes logged/);
  assert.match(html, /Add a note/, 'the point of opening it is often to write one');
});

// ── Fitting the screen ─────────────────────────────────────────────────────

test('the spread declares exactly how much of its width is NOT page image', () => {
  // The viewport-height cap needs this to work out how wide a page can be.
  // Reserving two margins when only one is there would shrink both pages for
  // room that is never used, so it is counted rather than assumed.
  const p3 = pageAyat(3), p4 = pageAyat(4);
  const extra = (html) => (html.match(/--mushaf-extra:(\d+)px/) || [])[1];
  const lens = (ayat) => ayat.map(a => ({ surah: a.surah, ayah: a.ayah, level: 2, note: '1B' }));

  assert.equal(extra(w.mushafSpreadHtml({ viewPage: 3, prevFn: 'p()', nextFn: 'n()' })), '6',
    'no annotations: just the spine');
  assert.equal(extra(w.mushafSpreadHtml({
    viewPage: 3, highlights: lens([p3[0]]), prevFn: 'p()', nextFn: 'n()' })), '86',
    'one page annotated: one margin plus the spine');
  assert.equal(extra(w.mushafSpreadHtml({
    viewPage: 3, highlights: lens([p3[0], p4[0]]), prevFn: 'p()', nextFn: 'n()' })), '166',
    'both annotated: two margins plus the spine');
});

test('tapping a page in the Mushaf tab actually zooms it', async () => {
  // toggleMushafZoom() re-renders "whichever view is on screen", and the new
  // tab was not in that list — so a tap set the zoom state and redrew nothing.
  const d = w.document;
  w.setMushafTabPage(3);
  w.setView('mushaf');
  await new Promise(r => setTimeout(r, 40));
  const spread = () => d.querySelector('#mushaf-tab-stage .mushaf-spread');
  assert.ok(!spread().className.includes('is-zoomed'));

  d.querySelector('#mushaf-tab-stage .mushaf-image-wrap').click();
  await new Promise(r => setTimeout(r, 20));
  assert.ok(spread().className.includes('is-zoomed'), 'the tap reached the tab');
  assert.equal(d.querySelectorAll('#mushaf-tab-stage .mushaf-image-wrap').length, 1);

  d.querySelector('#mushaf-tab-stage .mushaf-zoom-out').click();
  await new Promise(r => setTimeout(r, 20));
  assert.ok(!spread().className.includes('is-zoomed'));
  assert.equal(d.querySelectorAll('#mushaf-tab-stage .mushaf-image-wrap').length, 2);
});

test('the two confusable tab names are gone', () => {
  // "Revise" and "Review" shared a root and read as the same word.
  const d = w.document;
  const labels = [...d.querySelectorAll('.view-tab')].map(b => b.textContent.trim());
  assert.ok(labels.some(l => l.includes('Drill')));
  assert.ok(labels.some(l => l.includes('Plan')));
  assert.ok(!labels.some(l => /Revise|Review/.test(l)), labels.join(' | '));
  // The sub-tab inside Drill was ALSO called "Revise" — "Drill > Revise" kept
  // the word. Its id has always been 'random', so the label now matches.
  const subs = [...d.querySelectorAll('#view-revise .log-subtab')].map(b => b.textContent.trim());
  assert.ok(!subs.some(l => /Revise/.test(l)), subs.join(' | '));

  // The data-view ids are deliberately UNCHANGED: they key localStorage and
  // the sync payload, so renaming them would strand saved state.
  const views = [...d.querySelectorAll('.view-tab')].map(b => b.dataset.view);
  assert.ok(views.includes('revise') && views.includes('daily'));
});

// ── The lookup window ──────────────────────────────────────────────────────

test('a window is that many calendar days, counting today', () => {
  // It used to subtract the full count from today and then compare >=, which
  // added a day to every window. Invisible at 7 or 30; indefensible once a
  // 1d option existed, where it meant today AND yesterday.
  const today = new Date().toISOString().slice(0, 10);
  const span = (d) => Math.round(
    (new Date(today) - new Date(w.heatmapWindowCutoff(d))) / 864e5) + 1;
  for (const d of [1, 3, 7, 14, 28]) assert.equal(span(d), d, `Last ${d}d`);
  assert.equal(w.heatmapWindowCutoff(0), '', 'all time has no cutoff');
});

test('a 1d window is today only, for mistakes AND for sessions', () => {
  // Both halves of the rate read the same cutoff, so a window can never
  // narrow one and not the other.
  const a = pageAyat(3)[0];
  seed(
    [mistake(a, 'today'), mistake(a, 'yesterday', daysAgo(1)), mistake(a, 'older', daysAgo(5))],
    [...sessions(1, 2), ...sessions(1, 4, daysAgo(1))],
  );
  const at = (d) => w.ayahMistakeRates({ windowDays: d }).get(a.key);

  const oneDay = at(1);
  assert.equal(oneDay.mistakes, 1, 'yesterday is outside a 1-day window');
  assert.equal(oneDay.sessions, 2, 'and so are yesterday’s sittings');
  assert.equal(oneDay.rate, 5, '10 × 1 / 2');

  const threeDay = at(3);
  assert.equal(threeDay.mistakes, 2);
  assert.equal(threeDay.sessions, 6);
  assert.equal(at(0).mistakes, 3, 'all time keeps the 5-day-old one too');
});

test('both lookup windows offer the same choices', () => {
  // Two dropdowns for one concept is exactly how they drift apart.
  const d = w.document;
  const opts = (id) => [...d.querySelectorAll(`#${id} option`)].map(o => `${o.value}:${o.textContent}`);
  assert.deepEqual(toPlain(opts('hm-window')), toPlain(opts('mushaf-tab-window')));
  assert.deepEqual(toPlain(opts('hm-window').map(o => o.split(':')[0])),
    ['1', '3', '7', '14', '28', '0']);
  // All time stays the DEFAULT even though it is listed last — reordering the
  // menu must not silently switch everyone to a one-day view.
  assert.equal(d.querySelector('#hm-window').value, '0');
  assert.equal(d.querySelector('#mushaf-tab-window').value, '0');
});
