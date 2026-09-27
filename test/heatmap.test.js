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
  // The thresholds alone are numbers with no meaning attached, so the
  // Overview legend names each band too. ("what is this heat map?")
  for (const word of ['clean', 'rare', 'recurring', 'often']) {
    assert.ok(legend.includes(word), `legend is missing "${word}"`);
  }
  const hint = w.document.getElementById('hm-hint').textContent;
  assert.match(hint, /per 10 recitations of its Hizb/);
  // Leading with "shaded by" explains the colour to someone who already knows
  // what a square is. Lead with what the NUMBER means instead.
  assert.match(hint, /how often the worst ayah on that page goes wrong/);
  assert.match(hint, /once every four times/, 'a worked example beats a definition');
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

// ── Walking Today's Plan on the page ───────────────────────────────────────

const planOf = (clusters) => {
  w.localStorage.setItem('quranReviewDailyPlan', JSON.stringify({
    date: today, clusters,
  }));
  w.localStorage.setItem('quranReviewRepetitionHistory', '[]');
};
const walkBar = () => w.document.querySelector('.plan-walk-bar').textContent.replace(/\s+/g, ' ').trim();

test('the drill hides the middle of a cluster but never its two ends', () => {
  // The cue is "from here to there" — exactly what a teacher gives you — so
  // masking either end would remove the question instead of the answer.
  const hi = w.planWalkHighlights({ ref: '2:6-16' }, true);
  assert.deepEqual(toPlain(hi.filter(h => h.mask).map(h => h.ayah)), [7, 8, 9, 10, 11, 12, 13, 14, 15]);
  assert.deepEqual(toPlain(hi.filter(h => !h.mask).map(h => h.ayah)), [6, 16]);

  // 2:6 is lines 1-2 of page 3 and 2:16 is lines 14-15, so only 3-13 may be
  // covered. Lines 2 and 14 are SHARED with masked neighbours and must stay.
  const html = w.mushafBandHtmlFor(3, hi);
  const masks = [...html.matchAll(/mushaf-mask" style="top:([\d.]+)%;height:([\d.]+)%/g)]
    .map(m => ({ top: +m[1], height: +m[2] }));
  assert.equal(masks.length, 1, 'contiguous masked lines merge into one cover');
  const line = (n) => w.mushafBandStyle([n, n], 3);
  assert.ok(masks[0].top >= line(3).top - 0.01, 'starts no earlier than line 3');
  assert.ok(masks[0].top + masks[0].height <= line(13).top + line(13).height + 0.01,
    'ends no later than line 13');
});

test('with the drill off nothing is covered', () => {
  const hi = w.planWalkHighlights({ ref: '2:6-16' }, false);
  assert.ok(hi.every(h => !h.mask));
  assert.ok(!w.mushafBandHtmlFor(3, hi).includes('mushaf-mask'));
});

test('a single-ayah cluster has no middle to hide', () => {
  const hi = w.planWalkHighlights({ ref: '2:255' }, true);
  assert.equal(hi.length, 1);
  assert.ok(!hi[0].mask, 'it is both the first and the last ayah');
});

test('the walk opens at the first cluster still to do', async () => {
  planOf([
    { id: 'c1', ref: '2:6-16', strength: 'vw', targetReps: 10, done: true },
    { id: 'c2', ref: '2:40-48', strength: 'w', targetReps: 5, done: false },
    { id: 'c3', ref: '2:255', strength: 'o', targetReps: 3, done: false },
  ]);
  w.startPlanMushafWalk();
  await new Promise(r => setTimeout(r, 30));
  // Restarting at one every time would mean tapping past finished work.
  assert.match(walkBar(), /2 \/ 3/);
  assert.match(walkBar(), /2:40-48/);
  assert.match(walkBar(), /1 of 3 done/);
  assert.match(walkBar(), /5× today/);
  w.closeMushaf();
});

test('marking done from the mushaf records the reps and moves on', async () => {
  planOf([
    { id: 'c1', ref: '2:6-16', strength: 'vw', targetReps: 10, done: false },
    { id: 'c2', ref: '2:40-48', strength: 'w', targetReps: 5, done: false },
  ]);
  w.startPlanMushafWalk();
  await new Promise(r => setTimeout(r, 30));
  assert.match(walkBar(), /1 \/ 2/);

  w.planWalkMarkDone();
  await new Promise(r => setTimeout(r, 30));
  const saved = toPlain(w.loadDailyPlan());
  assert.equal(saved.clusters[0].done, true);
  assert.equal(saved.clusters[0].reps, 10, 'ticked at its own target, not 1');
  // Auto-advance: the walk keeps moving without a second tap.
  assert.match(walkBar(), /2 \/ 2/);
  assert.match(walkBar(), /1 of 2 done/);

  // The last cluster stays put rather than wrapping round, which would look
  // like the tap did nothing.
  w.planWalkMarkDone();
  await new Promise(r => setTimeout(r, 30));
  assert.match(walkBar(), /2 \/ 2/);
  assert.match(walkBar(), /2 of 2 done/);
  assert.match(walkBar(), /Undo/);

  // And undo really undoes it.
  w.planWalkMarkDone();
  await new Promise(r => setTimeout(r, 30));
  assert.equal(toPlain(w.loadDailyPlan()).clusters[1].done, false);
  w.closeMushaf();
});

test('stepping is bounded, and Escape ends the walk', async () => {
  planOf([
    { id: 'c1', ref: '2:6-16', strength: 'vw', targetReps: 10, done: false },
    { id: 'c2', ref: '2:40-48', strength: 'w', targetReps: 5, done: false },
  ]);
  w.startPlanMushafWalk();
  await new Promise(r => setTimeout(r, 30));
  w.planWalkStep(-1);
  assert.match(walkBar(), /1 \/ 2/, 'cannot step before the first');
  w.planWalkStep(1); w.planWalkStep(1);
  assert.match(walkBar(), /2 \/ 2/, 'cannot step past the last');

  w.closeMushaf();
  assert.equal(w.document.querySelectorAll('.plan-walk-bar').length, 0,
    'closing the overlay ends the walk — no half-finished walk left invisible');
});

test('a plan with no usable refs says so instead of opening an empty walk', () => {
  planOf([{ id: 'x', ref: 'not a ref', strength: 'w', targetReps: 3, done: false }]);
  const realAlert = w.alert;
  try {
    let said = '';
    w.alert = (m) => { said = m; };
    w.startPlanMushafWalk();
    assert.match(said, /No plan clusters/);
    assert.equal(w.document.querySelectorAll('.plan-walk-bar').length, 0);
  } finally { w.alert = realAlert; }
});

test('during a walk only the cluster is highlighted on the page', async () => {
  // Reported as "it's not clear what is highlighted". With every mistaken
  // ayah tinted as well, the one range being worked on was indistinguishable.
  const p51 = pageAyat(51);
  const hizbs = [...new Set(p51.map(x => x.hizb))];
  w.localStorage.setItem('quranReviewMemorizedHizbs', JSON.stringify(hizbs));
  seed(p51.map((a, i) => mistake(a, `x${i}`)),
    hizbs.flatMap(h => sessions(h, 4)));
  w.localStorage.setItem('quranReviewMushafShowMistakes', 'true');
  planOf([{ id: 'c1', ref: '3:14-3:23', strength: 'vw', targetReps: 15, done: false }]);
  const d = w.document;
  const count = (sel) => d.querySelectorAll('#mushaf-overlay-body ' + sel).length;

  // Without a walk the severity shading is drawn, as it always was. (One
  // band, not six: every ayah here is the same level, so their contiguous
  // lines merge — which is the behaviour a separate test already pins.)
  w.openMushaf({ page: 51 });
  await new Promise(r => setTimeout(r, 30));
  const plainBands = [...d.querySelectorAll('#mushaf-overlay-body .mushaf-band')];
  assert.ok(plainBands.some(b => /lv[1-4]/.test(b.className)), 'severity is on the page');
  assert.equal(count('.mushaf-veil'), 0);
  const notesBefore = count('.mushaf-note');
  assert.ok(notesBefore > 0);
  w.closeMushaf();

  w.startPlanMushafWalk();
  await new Promise(r => setTimeout(r, 30));
  const bands = [...d.querySelectorAll('#mushaf-overlay-body .mushaf-band')];
  assert.ok(bands.length > 0);
  assert.ok(bands.every(b => b.className.includes('is-focus')),
    'the cluster is the only thing banded');
  assert.ok(!bands.some(b => /lv[1-4]/.test(b.className)), 'no severity bands');
  assert.ok(count('.mushaf-veil') > 0, 'and the rest of the page is dimmed');
  // Nothing is LOST: the severity still reaches the margin, it just stops
  // competing with the range being worked on.
  assert.equal(count('.mushaf-note'), notesBefore);
  w.closeMushaf();
});

test('the veil covers only what is outside the cluster, page by page', () => {
  // 3:14-3:23 sits on lines 9-15 of page 51 and fills page 52 entirely.
  const hi = w.planWalkHighlights({ ref: '3:14-3:23' }, false);
  const parts = (page) => [...w.mushafBandHtmlFor(page, hi, { focusOutside: true })
    .matchAll(/class="mushaf-(band|veil)[^"]*" style="top:([\d.]+)%;height:([\d.]+)%/g)]
    .map(m => ({ kind: m[1], top: +m[2], height: +m[3] }));

  const p51 = parts(51);
  const band51 = p51.find(x => x.kind === 'band');
  const veil51 = p51.filter(x => x.kind === 'veil');
  assert.equal(veil51.length, 1, 'one veil, above the cluster');
  assert.ok(veil51[0].top + veil51[0].height <= band51.top + 0.01, 'and it stops where the cluster starts');

  const p52 = parts(52);
  assert.equal(p52.filter(x => x.kind === 'veil').length, 0,
    'a page entirely inside the cluster has nothing to dim');

  // A page the cluster does not reach is left alone — veiling a page you
  // simply turned to would say the page itself is irrelevant.
  assert.equal(parts(60).length, 0);
});

test('the drill still covers the middle when the Mistakes layer is on', async () => {
  // Reported as "hide middle is not working well — it should hide 243 till
  // 247". Every non-mask highlight was counted as protecting its line from
  // the cover, INCLUDING the severity ones. Because the lens bands every
  // mistaken ayah on the page, that punched the cover full of holes: with
  // mistakes logged across the spread, almost nothing was hidden.
  const p39 = pageAyat(39), p40 = pageAyat(40);
  const hizbs = [...new Set([...p39, ...p40].map(x => x.hizb))];
  w.localStorage.setItem('quranReviewMemorizedHizbs', JSON.stringify(hizbs));
  seed([...p39, ...p40].map((a, i) => mistake(a, `m${i}`, today, 'B')),
    hizbs.flatMap(h => sessions(h, 4)));
  w.localStorage.setItem('quranReviewMushafShowMistakes', 'true');
  w.localStorage.setItem('quranReviewMushafShowNotes', 'true');
  planOf([{ id: 'c1', ref: '2:242–2:247', strength: 'vw', targetReps: 10, done: false }]);
  w.setPlanHideMiddle(true);
  w.startPlanMushafWalk();
  await new Promise(r => setTimeout(r, 30));

  const d = w.document;
  const lines = (el) => {
    const top = parseFloat(el.style.top), h = parseFloat(el.style.height);
    const pitch = (0.930 - 0.024) / 15 * 100;
    return [Math.round((top - 2.4) / pitch) + 1, Math.round((top + h - 2.4) / pitch)];
  };
  const onPage = (p) => [...d.querySelectorAll('#mushaf-overlay-body .mushaf-image-wrap')]
    .find(el => el.querySelector('img').src.includes(`/${p}.jpg`));

  // 2:242 is lines 8-9 of page 39 and 2:247 is lines 6-11 of page 40, so the
  // middle to cover is 10-15 on the first page and 1-5 on the second.
  const masks39 = [...onPage(39).querySelectorAll('.mushaf-mask')].map(lines);
  assert.deepEqual(toPlain(masks39), [[10, 15]]);
  const masks40 = [...onPage(40).querySelectorAll('.mushaf-mask')].map(lines);
  assert.deepEqual(toPlain(masks40), [[1, 5]]);

  // The cue ayat are still banded, and the margin still reports severity —
  // the fix must not have thrown the lens away, only stopped it protecting
  // lines from the cover.
  assert.ok(onPage(39).querySelector('.mushaf-band.is-focus'));
  assert.ok(d.querySelectorAll('#mushaf-overlay-body .mushaf-note').length > 0);
  w.closeMushaf();
});

test('the walk records the reps you actually did, not the target', async () => {
  // The plan ASKS for 10; what happened is the thing worth recording, since
  // repetitionHistory is only honest if it says what you really did.
  const d = w.document;
  w.localStorage.setItem('quranReviewRepetitionHistory', '[]');
  planOf([
    { id: 'c1', ref: '2:242–2:247', strength: 'vw', targetReps: 10, done: false },
    { id: 'c2', ref: '2:6-16', strength: 'w', targetReps: 5, done: false },
  ]);
  w.startPlanMushafWalk();
  await new Promise(r => setTimeout(r, 30));

  const box = () => d.getElementById('plan-walk-reps');
  assert.equal(box().value, '10', 'prefilled with the target, since that is usually the answer');

  // A number typed here must survive a re-render caused by something else —
  // silently resetting to the target would log the wrong count while looking
  // perfectly normal.
  box().value = '6';
  w.planWalkSetReps('6');
  w.setPlanHideMiddle(true);
  assert.equal(box().value, '6');

  w.planWalkMarkDone();
  await new Promise(r => setTimeout(r, 30));
  const plan = toPlain(w.loadDailyPlan());
  assert.equal(plan.clusters[0].reps, 6, 'logged what was done');
  assert.deepEqual(toPlain(w.loadRepetitionHistory()).map(h => h.reps), [6]);

  // The next cluster starts from ITS target, not the number just typed.
  assert.equal(box().value, '5');
  w.setPlanHideMiddle(false);
  w.closeMushaf();
});

test('an empty or zero rep count is refused, not silently treated as done', async () => {
  const d = w.document;
  planOf([{ id: 'c1', ref: '2:6-16', strength: 'w', targetReps: 5, done: false }]);
  w.startPlanMushafWalk();
  await new Promise(r => setTimeout(r, 30));
  const realAlert = w.alert;
  try {
    let said = '';
    w.alert = (m) => { said = m; };
    d.getElementById('plan-walk-reps').value = '';
    w.planWalkMarkDone();
    assert.match(said, /how many times/);
    assert.equal(toPlain(w.loadDailyPlan()).clusters[0].done, false);

    said = '';
    d.getElementById('plan-walk-reps').value = '0';
    w.planWalkMarkDone();
    assert.match(said, /how many times/);
    assert.equal(toPlain(w.loadDailyPlan()).clusters[0].done, false);
  } finally { w.alert = realAlert; }
  w.closeMushaf();
});

test('a ticked cluster shows what was recorded, not what was asked for', async () => {
  planOf([{ id: 'c1', ref: '2:6-16', strength: 'w', targetReps: 5, done: false }]);
  w.startPlanMushafWalk();
  await new Promise(r => setTimeout(r, 30));
  w.document.getElementById('plan-walk-reps').value = '3';
  w.planWalkMarkDone();
  await new Promise(r => setTimeout(r, 30));
  // Otherwise there is no way to see you logged 3 of the 5 asked for.
  assert.match(walkBar(), /did 3×/);
  assert.match(walkBar(), /Undo/);
  assert.equal(w.document.getElementById('plan-walk-reps'), null, 'no box once it is done');
  w.closeMushaf();
});

// ── Import from Telegram, in two places at once ────────────────────────────

test('the sidebar and the sub-tab share one Telegram import, kept in step', async () => {
  // It is how mistakes actually get into this app day to day, and it used to
  // be four clicks deep. Two copies of a control is how they drift apart, so
  // every renderer writes to BOTH.
  const d = w.document;
  assert.equal(d.querySelectorAll('.js-telegram-import-btn').length, 2);
  assert.equal(d.querySelectorAll('.js-telegram-last-imported').length, 2);
  assert.equal(d.querySelectorAll('.js-telegram-checkpoint-status').length, 2);

  w.localStorage.setItem('quranReviewTelegramLastImportedAt', '2026-09-20T10:00:00.000Z');
  w.renderTelegramLastImportedAt();
  const texts = [...d.querySelectorAll('.js-telegram-last-imported')].map(e => e.textContent);
  assert.ok(texts.every(t => /Last imported/.test(t)), texts.join(' | '));
  assert.equal(new Set(texts).size, 1, 'both say the same thing');

  w.renderTelegramImportCheckpointStatus();
  const status = [...d.querySelectorAll('.js-telegram-checkpoint-status')].map(e => e.textContent);
  assert.equal(new Set(status).size, 1);

  // Both buttons must disable together: one still reading "Import from
  // Telegram" while the other says "Fetching…" invites a second run on top
  // of the first.
  const realFetch = w.fetch, realAlert = w.alert;
  try {
    w.fetch = async () => { throw new Error('offline'); };
    w.alert = () => {};
    const run = w.importMistakesFromTelegram();
    await new Promise(r => setTimeout(r, 5));
    const mid = [...d.querySelectorAll('.js-telegram-import-btn')];
    assert.ok(mid.every(b => b.disabled), 'both disabled during a run');
    assert.equal(new Set(mid.map(b => b.textContent)).size, 1, 'both show the same progress');
    await run.catch(() => {});
    await new Promise(r => setTimeout(r, 20));
    const after = [...d.querySelectorAll('.js-telegram-import-btn')];
    assert.ok(after.every(b => !b.disabled), 'and both come back');
    assert.ok(after.every(b => /Import from Telegram/.test(b.textContent)));
  } finally { w.fetch = realFetch; w.alert = realAlert; }
});

test('no element carries the same id twice', () => {
  // Adding a second copy of a control is the classic way to introduce one.
  const ids = [...w.document.querySelectorAll('[id]')].map(e => e.id);
  const dupes = [...new Set(ids.filter((x, i) => ids.indexOf(x) !== i))];
  assert.deepEqual(toPlain(dupes), []);
});

// ── Naming and iconography ─────────────────────────────────────────────────

test('no icon means two unrelated things', () => {
  // 🎯 once stood for the Drill tab, the Mistakes sub-tab, Practice Goals,
  // and two mobile cards at the same time. An icon that means five things
  // means nothing. Repeats are allowed only where the CONCEPT is the same —
  // a tab and its own mobile card, say.
  const d = w.document;
  const uses = new Map();
  const add = (icon, label) => {
    if (!icon || !/\p{Extended_Pictographic}/u.test(icon)) return;
    if (!uses.has(icon)) uses.set(icon, new Set());
    uses.get(icon).add(label);
  };
  const split = (text) => {
    const t = text.trim();
    const m = /^(\S+)\s+(.*)$/.exec(t);
    return m ? [m[1], m[2]] : [t, t];
  };
  for (const b of d.querySelectorAll('.view-tab')) add(...split(b.textContent));
  for (const b of d.querySelectorAll('.log-subtab')) add(...split(b.textContent));

  // A repeat is fine when one label CONTAINS the other — a tab and its own
  // sub-tab for the same thing, like Plan › Today's Plan. Anything else is
  // one glyph pulling double duty.
  const sameConcept = (labels) => {
    const list = [...labels].map(l => l.toLowerCase());
    return list.every(a => list.some(b => a !== b && (a.includes(b) || b.includes(a))));
  };
  const clashes = [...uses.entries()]
    .filter(([, labels]) => labels.size > 1 && !sameConcept(labels))
    .map(([icon, labels]) => `${icon} → ${[...labels].join(' / ')}`);
  assert.deepEqual(toPlain(clashes), [], clashes.join('; '));
});

test('a tab\'s default sub-tab is its first sub-tab', () => {
  // A default sitting in the middle of the row reads as arbitrary — the same
  // thing that was wrong with the top-level bar before it was reordered.
  const d = w.document;
  for (const view of ['revise', 'backup', 'daily', 'more']) {
    const subs = [...d.querySelectorAll(`#view-${view} .log-subtab`)];
    if (!subs.length) continue;
    const markup = require('fs').readFileSync(
      require('path').join(__dirname, '..', 'review.html'), 'utf8');
    // Read the shipped default from the file: this window has been navigated
    // by earlier tests, so the live .active says where they left off.
    const block = markup.slice(markup.indexOf(`<div id="view-${view}"`));
    const firstSub = /data-subview="([a-z]+)"/.exec(block);
    const activeSub = /class="log-subtab active" data-subview="([a-z]+)"/.exec(block);
    if (activeSub) assert.equal(activeSub[1], firstSub[1], `#view-${view}`);
  }
});

test('the desktop and mobile labels for a view agree', () => {
  // The bottom bar called Overview "Stats", which is a second name for one
  // thing in the one place you cannot see them side by side.
  const d = w.document;
  const desktop = new Map([...d.querySelectorAll('.view-tab[data-view]')]
    .map(b => [b.dataset.view, b.textContent.replace(/\P{L}+/gu, ' ').trim()]));
  for (const b of d.querySelectorAll('.mobile-tab-btn[data-view]')) {
    const label = b.querySelector('.tab-label').textContent.trim();
    const full = desktop.get(b.dataset.view);
    assert.ok(full.includes(label),
      `mobile "${label}" vs desktop "${full}" for ${b.dataset.view}`);
  }
});

// ── Arrow keys turn pages ──────────────────────────────────────────────────

const press = (k, shift) => w.document.dispatchEvent(
  new w.KeyboardEvent('keydown', { key: k, shiftKey: !!shift, bubbles: true }));

test('arrows turn pages, leftward being forward as the mushaf reads', async () => {
  const d = w.document;
  w.setMushafTabPage(23);
  w.setView('mushaf');
  await new Promise(r => setTimeout(r, 30));
  const label = () => d.querySelector('#mushaf-tab-stage .mushaf-page-label').textContent;

  // A mushaf advances LEFTWARD, so the left arrow moves forward — the mirror
  // of the Western convention, and the same way the ‹ › buttons already work.
  press('ArrowLeft');
  assert.match(label(), /pages 25–26/);
  press('ArrowRight');
  assert.match(label(), /pages 23–24/);

  // Same keys, same meaning, in the overlay.
  w.openMushaf({ page: 51 });
  await new Promise(r => setTimeout(r, 30));
  const ov = () => d.querySelector('#mushaf-overlay-body .mushaf-page-label').textContent;
  press('ArrowLeft');
  assert.match(ov(), /pages 53–54/);
  press('ArrowRight');
  assert.match(ov(), /pages 51–52/);
  w.closeMushaf();
});

test('during a walk arrows still page; Shift steps clusters', async () => {
  const d = w.document;
  planOf([
    { id: 'c1', ref: '2:6-16', strength: 'vw', targetReps: 10, done: false },
    { id: 'c2', ref: '2:40-48', strength: 'w', targetReps: 5, done: false },
  ]);
  w.startPlanMushafWalk();
  await new Promise(r => setTimeout(r, 30));
  const ov = () => d.querySelector('#mushaf-overlay-body .mushaf-page-label').textContent;
  assert.match(walkBar(), /1 \/ 2/);

  // Arrows mean pages EVERYWHERE — one rule rather than one per mode. A
  // cluster spanning a spread has to be followable without leaving the walk.
  press('ArrowLeft');
  assert.match(ov(), /pages 5–6/);
  assert.match(walkBar(), /1 \/ 2/, 'the cluster did not move');

  press('ArrowLeft', true);
  assert.match(walkBar(), /2 \/ 2/, 'Shift is the cluster');
  w.closeMushaf();
});

test('a focused field keeps its own arrow keys', async () => {
  const d = w.document;
  planOf([{ id: 'c1', ref: '2:6-16', strength: 'vw', targetReps: 10, done: false }]);
  w.startPlanMushafWalk();
  await new Promise(r => setTimeout(r, 30));
  const ov = () => d.querySelector('#mushaf-overlay-body .mushaf-page-label').textContent;
  const before = ov();
  d.getElementById('plan-walk-reps').focus();
  press('ArrowLeft');
  assert.equal(ov(), before, 'typing a rep count must not turn the page');
  w.closeMushaf();
});

test('Save to Telegram sits beside Import, and both copies move together', async () => {
  const d = w.document;
  // Backup OUT next to import IN — two halves of one round trip, and the
  // save was buried in More › Backup.
  assert.equal(d.querySelectorAll('.js-save-telegram-btn').length, 2);
  const labels = [...d.querySelectorAll('.js-save-telegram-btn')].map(b => b.textContent);
  assert.equal(new Set(labels).size, 1, 'same label, so a run cannot strip one');
  assert.match(labels[0], /Save to Telegram/);

  const realFetch = w.fetch, realAlert = w.alert;
  try {
    w.alert = () => {};
    w.localStorage.setItem('quranReviewSyncAccount', 'acct');
    let release;
    w.fetch = () => new Promise(r => { release = r; });
    const run = w.saveToTelegramBackupChannel();
    await new Promise(r => setTimeout(r, 5));
    const mid = [...d.querySelectorAll('.js-save-telegram-btn')];
    assert.ok(mid.every(b => b.disabled), 'both disabled, so one run cannot start a second');
    assert.equal(new Set(mid.map(b => b.textContent)).size, 1);
    release({ ok: true, json: async () => ({}) });
    await run;
    const after = [...d.querySelectorAll('.js-save-telegram-btn')];
    assert.ok(after.every(b => !b.disabled));
    assert.equal(new Set(after.map(b => b.textContent)).size, 1, 'and come back identical');
  } finally { w.fetch = realFetch; w.alert = realAlert; }
});

// ── Memorization Test: scope and highlight ─────────────────────────────────

test('_pageInHizbSet resolves the right Hizb — SURAH_OFFSETS is 1-indexed', () => {
  // It read SURAH_OFFSETS[number - 1], i.e. the PREVIOUS surah's offset, so
  // every page landed hundreds of ayat too low and therefore in the wrong
  // Hizb. 3:149 came out as Hizb 3 (memorized, so it passed) instead of
  // Hizb 7 — which is how the test kept serving unmemorized pages.
  const pageData = (surah, ayah) => [{ surah: { number: surah }, numberInSurah: ayah }];
  const memorized = new Set([1, 2, 3, 4, 5, 6]);

  assert.equal(w._pageInHizbSet(pageData(3, 149), memorized), false,
    '3:149 is Hizb 7 — outside a 1-6 memorized set');
  assert.equal(w._pageInHizbSet(pageData(2, 30), memorized), true, '2:30 is Hizb 1');
  assert.equal(w._pageInHizbSet(pageData(1, 1), memorized), true, 'Al-Fatiha is Hizb 1');

  // An empty set means "no filter", not "nothing matches".
  assert.equal(w._pageInHizbSet(pageData(3, 149), new Set()), true);

  // Cross-check against the shared geometry rather than restating the answer.
  // SURAH_OFFSETS is a top-level const, so it is not on window — that is what
  // extractConst exists for.
  const OFFSETS = require('./helpers/extractConst.js').extractConst('quran-data.js', 'SURAH_OFFSETS');
  for (const [s, a] of [[2, 30], [3, 149], [2, 255], [4, 1]]) {
    const global = OFFSETS[s] + a - 1;
    const hizb = w.hizbOfGlobalAyah(global);
    assert.equal(w._pageInHizbSet(pageData(s, a), new Set([hizb])), true, `${s}:${a}`);
    assert.equal(w._pageInHizbSet(pageData(s, a), new Set([hizb + 1])), false, `${s}:${a}`);
  }
});

test('every Memorization Test mode highlights the ayah it asked about', () => {
  // The spread read only memTestRevealData.lastAyah. "Left or Right?" and
  // "Page Start?" never set it — they ask about an ayah already on screen —
  // so those two revealed a spread with nothing marked, which is the entire
  // reason for showing the page.
  const page = [
    { surah: { number: 3 }, numberInSurah: 149 },
    { surah: { number: 3 }, numberInSurah: 150 },
  ];
  const at = (reveal, cached) => toPlain(w.memTestHighlightAyah(reveal, cached));

  // Left or Right? — nothing revealed, the displayed ayah IS the question.
  assert.deepEqual(at(null, { p1: page, displayAyahIdx: 1 }), { surah: 3, ayah: 150 });
  // Page Start? — no index recorded, so the page's first ayah.
  assert.deepEqual(at(null, { p1: page }), { surah: 3, ayah: 149 });

  // The reveal modes still win, in both of their two shapes.
  assert.deepEqual(at({ lastAyah: page[1], mode: '1tolast' }, null), { surah: 3, ayah: 150 });
  assert.deepEqual(at({ firstAyah: page[0], mode: 'lastto1next' }, null), { surah: 3, ayah: 149 });
  // ending/transition store plain numbers rather than page-data objects.
  assert.deepEqual(at({ surah: 3, ayah: 149, mode: 'ending' }, null), { surah: 3, ayah: 149 });

  // Nothing to go on is null, not a broken half-object.
  assert.equal(w.memTestHighlightAyah(null, null), null);
});
