'use strict';

// Tests for the Tester sub-tab's pure helpers (review.html) and for the
// integrity of the vendored quran-line-bands.js data it reads.
//
// The band arithmetic is the whole page-highlight feature. It is asserted
// against POSITIONS MEASURED FROM THE PAGE IMAGES, not against the formula's
// own arithmetic — an earlier version of this file did the latter, which is
// exactly why a real misalignment shipped: the constants were self-consistent
// and wrong, so every test passed while bands sat nearly a line too low.
//
// MEASURED_INK below is the dark-pixel extent of real text lines, found by
// decoding the JPEGs and profiling rows. A band for line N must CONTAIN its
// line's ink and must NOT reach into a neighbour's.

const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { loadPage } = require('./helpers/loadPage.js');

// Arrays returned from the jsdom realm carry a foreign Array prototype, which
// assert.deepEqual rejects even when the data matches. Round-trip through JSON.
const toPlain = (value) => JSON.parse(JSON.stringify(value));

let w;
before(async () => { w = (await loadPage('review.html')).window; });

// ── Band geometry ──────────────────────────────────────────────────────────

// Real ink extents (percent of image height) measured off the page JPEGs.
// Each entry: page -> { lineNumber: [inkTop, inkBottom] }.
const MEASURED_INK = {
  3: { 1: [3.00, 6.70], 6: [33.30, 36.90], 14: [81.60, 85.50] },
  4: { 1: [3.20, 6.50], 2: [9.00, 12.90], 3: [15.10, 19.00], 14: [81.90, 86.00] },
  6: { 1: [4.20, 8.00], 4: [21.90, 26.00], 11: [63.80, 67.60], 12: [69.90, 73.70] },
};

/** The band a single line would get, as {top, bottom} percentages. */
function slotFor(w, line, page) {
  const s = w.mushafBandStyle([line, line], page);
  return { top: s.top, bottom: +(s.top + s.height).toFixed(2) };
}

test('mushafBandStyle: every measured line sits inside its own band', () => {
  for (const [page, lines] of Object.entries(MEASURED_INK)) {
    for (const [line, [inkTop, inkBot]] of Object.entries(lines)) {
      const { top, bottom } = slotFor(w, +line, +page);
      assert.ok(top <= inkTop,
        `page ${page} line ${line}: band starts at ${top}% but ink starts at ${inkTop}%`);
      assert.ok(bottom >= inkBot,
        `page ${page} line ${line}: band ends at ${bottom}% but ink ends at ${inkBot}%`);
    }
  }
});

test('mushafBandStyle: a band does not reach into the neighbouring line', () => {
  // Page 4 lines 1,2,3 and page 6 lines 11,12 are adjacent measured pairs.
  const pairs = [[4, 1, 2], [4, 2, 3], [6, 11, 12]];
  for (const [page, a, b] of pairs) {
    const bandA = slotFor(w, a, page);
    const inkB = MEASURED_INK[page][b];
    assert.ok(bandA.bottom < inkB[0],
      `page ${page}: line ${a}'s band ends at ${bandA.bottom}%, into line ${b}'s ink at ${inkB[0]}%`);
  }
});

test('mushafBandStyle: the line pitch matches the images (~6.04%)', () => {
  // The regression that prompted the refit was a pitch of 5.553% against a
  // real ~6.04%, which compounds into a near-full-line shift at the top.
  const one = w.mushafBandStyle([1, 1], 6).height;
  assert.ok(Math.abs(one - 6.04) < 0.05, `expected ~6.04% per line, got ${one}%`);
  // And it must be uniform, since the band is linear in the line number.
  const five = w.mushafBandStyle([1, 5], 6).height;
  assert.ok(Math.abs(five - one * 5) < 0.02, 'five lines should be exactly 5x one');
});

test('mushafBandStyle: the text block spans the measured extent', () => {
  const first = slotFor(w, 1, 6);
  const last = slotFor(w, 15, 6);
  assert.equal(first.top, 2.4);
  assert.equal(last.bottom, 93);
  // Page 6's topmost ink is 4.20% and page 3's bottom line ends ~91.4%.
  assert.ok(first.top < 4.20 && last.bottom > 91.4);
});

test('mushafBandStyle: a multi-line range spans first line top to last line bottom', () => {
  // The reference case: 2:31-2:34 occupies lines 4-11 of page 6.
  const s = w.mushafBandStyle([4, 11], 6);
  assert.equal(s.top, slotFor(w, 4, 6).top);
  assert.equal(+(s.top + s.height).toFixed(2), slotFor(w, 11, 6).bottom);
  // ...and really does contain both those lines' ink.
  assert.ok(s.top <= MEASURED_INK[6][4][0]);
  assert.ok(s.top + s.height >= MEASURED_INK[6][11][1]);
});

test('mushafBandStyle: pages 1-2 are never banded', () => {
  // Those two pages are decorative frames, not 15 plain lines, so the
  // arithmetic does not describe them.
  assert.equal(w.mushafBandStyle([2, 2], 1), null);
  assert.equal(w.mushafBandStyle([3, 3], 2), null);
  assert.notEqual(w.mushafBandStyle([3, 3], 3), null);
});

test('mushafBandStyle: rejects malformed or out-of-range input', () => {
  assert.equal(w.mushafBandStyle(null, 6), null);
  assert.equal(w.mushafBandStyle([1], 6), null);
  assert.equal(w.mushafBandStyle([0, 3], 6), null);   // line 0 does not exist
  assert.equal(w.mushafBandStyle([1, 16], 6), null);  // past the last line
  assert.equal(w.mushafBandStyle([9, 4], 6), null);   // inverted
});

// ── Line-bands data ────────────────────────────────────────────────────────

test('QURAN_LINE_BANDS: covers every ayah exactly once, on one page', () => {
  const bands = w.QURAN_LINE_BANDS;
  assert.equal(Object.keys(bands).length, 6236);
  const multiPage = Object.entries(bands).filter(([, v]) => Object.keys(v).length > 1);
  // Each ayah is recorded only on the page it BEGINS on — an ayah continuing
  // past a page break gets no band on the continuation page.
  assert.equal(multiPage.length, 0);
});

test('QURAN_LINE_BANDS: every line range is inside 1..15 and ordered', () => {
  const bad = [];
  for (const [key, byPage] of Object.entries(w.QURAN_LINE_BANDS)) {
    for (const [page, r] of Object.entries(byPage)) {
      if (!Array.isArray(r) || r.length !== 2) { bad.push(`${key} p${page} shape`); continue; }
      if (r[0] < 1 || r[1] > 15 || r[0] > r[1]) bad.push(`${key} p${page} ${JSON.stringify(r)}`);
    }
  }
  assert.deepEqual(bad, []);
});

test('QURAN_LINE_BANDS: page numbering matches the app\'s own page source', () => {
  // Anchors confirmed against api.alquran.cloud, the same source
  // quran-cache.js's fetchPageData() reads. This is the guard against the
  // images and the bands drifting onto different mushaf printings.
  assert.equal(w.mushafPageOfAyah(2, 1), 2);
  assert.equal(w.mushafPageOfAyah(2, 6), 3);
  assert.equal(w.mushafPageOfAyah(2, 282), 48); // fills page 48 by itself
  assert.equal(w.mushafPageOfAyah(2, 283), 49);
  assert.equal(w.mushafPageOfAyah(3, 15), 51);  // page 51 ends here
  assert.equal(w.mushafPageOfAyah(114, 1), 604);
});

test('QURAN_LINE_BANDS: pages run 1..604 with none missing', () => {
  const seen = new Set();
  for (const byPage of Object.values(w.QURAN_LINE_BANDS)) {
    Object.keys(byPage).forEach(p => seen.add(Number(p)));
  }
  assert.equal(seen.size, 604);
  assert.equal(Math.min(...seen), 1);
  assert.equal(Math.max(...seen), 604);
});

test('mushafLineRange: matches the reference page-6 screenshot', () => {
  // 2:31-2:34 highlighted on page 6 in the Quran Tester UI.
  assert.deepEqual(Array.from(w.mushafLineRange(2, 31, 6)), [4, 5]);
  assert.deepEqual(Array.from(w.mushafLineRange(2, 34, 6)), [9, 11]);
  assert.equal(w.mushafLineRange(2, 31, 7), null); // not on that page
});

// ── Pool selection ─────────────────────────────────────────────────────────

// Hizb 1 covers 1:1-2:74, Hizb 2 picks up at 2:75 — so a set of {1} is enough
// to exercise the memorized filter around a known boundary.
const HIZB_1 = new Set([1]);
const ALL_HIZBS = new Set(Array.from({ length: 60 }, (_, i) => i + 1));

test('testerPool: a page range yields only ayat on those pages', () => {
  const pool = w.testerPool({ mode: 'pages', startPage: 6, endPage: 7 }, ALL_HIZBS);
  assert.ok(pool.length > 0);
  assert.ok(pool.every(x => x.page === 6 || x.page === 7));
  assert.equal(pool[0].surah, 2);
  assert.equal(pool[0].ayah, 30); // page 6 begins at 2:30
});

test('testerPool: reversed page bounds are accepted', () => {
  const fwd = w.testerPool({ mode: 'pages', startPage: 6, endPage: 8 }, ALL_HIZBS);
  const rev = w.testerPool({ mode: 'pages', startPage: 8, endPage: 6 }, ALL_HIZBS);
  assert.equal(fwd.length, rev.length);
});

test('testerPool: an ayah range is inclusive at both ends', () => {
  const pool = w.testerPool({
    mode: 'ayah', startSurah: 1, startAyah: 1, endSurah: 1, endAyah: 7,
  }, ALL_HIZBS);
  assert.equal(pool.length, 7);
  assert.equal(pool[0].ayah, 1);
  assert.equal(pool[6].ayah, 7);
});

test('testerPool: an ayah range can cross a surah boundary in order', () => {
  const pool = w.testerPool({
    mode: 'ayah', startSurah: 1, startAyah: 5, endSurah: 2, endAyah: 3,
  }, ALL_HIZBS);
  assert.deepEqual(
    toPlain(pool.map(x => x.key)),
    ['1:5', '1:6', '1:7', '2:1', '2:2', '2:3'],
  );
});

test('testerPool: pool is in mushaf order, so a chunk walks forward', () => {
  const pool = w.testerPool({ mode: 'pages', startPage: 3, endPage: 5 }, ALL_HIZBS);
  for (let i = 1; i < pool.length; i++) {
    assert.ok(pool[i].global > pool[i - 1].global,
      `out of order at ${pool[i - 1].key} -> ${pool[i].key}`);
  }
});

// ── Memorized-Hizb filter ──────────────────────────────────────────────────

test('testerPool: only returns ayat from memorized Hizbs', () => {
  const pool = w.testerPool(
    { mode: 'ayah', startSurah: 1, startAyah: 1, endSurah: 114, endAyah: 6 },
    HIZB_1,
  );
  assert.ok(pool.length > 0);
  assert.ok(pool.every(x => x.hizb === 1), 'every ayah should be in Hizb 1');
  // Hizb 1 runs 1:1 to 2:74 (the real boundary — NOT the Juz midpoint; see
  // HIZB_RANGES' own note in quran-data.js).
  assert.equal(pool[0].key, '1:1');
  assert.equal(pool[pool.length - 1].key, '2:74');
});

test('testerPool: excludes ayat just past a memorized Hizb boundary', () => {
  const pool = w.testerPool(
    { mode: 'ayah', startSurah: 2, startAyah: 70, endSurah: 2, endAyah: 80 },
    HIZB_1,
  );
  assert.deepEqual(toPlain(pool.map(x => x.key)),
    ['2:70', '2:71', '2:72', '2:73', '2:74']);  // 2:75 starts Hizb 2
});

test('testerPool: a page range outside every memorized Hizb is empty', () => {
  // Page 300 is nowhere near Hizb 1.
  const pool = w.testerPool({ mode: 'pages', startPage: 300, endPage: 305 }, HIZB_1);
  assert.deepEqual(toPlain(pool), []);
});

test('testerPool: no memorized Hizbs means an empty pool, never a fallback', () => {
  const pool = w.testerPool({ mode: 'pages', startPage: 1, endPage: 604 }, new Set());
  assert.equal(pool.length, 0);
});

test('mushafAyahIndex: every ayah carries the Hizb it falls in', () => {
  const all = w.mushafAyahIndex();
  assert.equal(all.length, 6236);
  assert.ok(all.every(x => x.hizb >= 1 && x.hizb <= 60));
  const byKey = k => all.find(x => x.key === k);
  assert.equal(byKey('1:1').hizb, 1);
  assert.equal(byKey('2:74').hizb, 1);
  assert.equal(byKey('2:75').hizb, 2);   // the real Hizb 1/2 boundary
  assert.equal(byKey('114:6').hizb, 60);
});

// ── Cue words ──────────────────────────────────────────────────────────────

test('testerOpeningWords: takes the first N words', () => {
  assert.equal(w.testerOpeningWords('a b c d e', 3), 'a b c');
  assert.equal(w.testerOpeningWords('a b', 5), 'a b');   // shorter than N
  assert.equal(w.testerOpeningWords('  a   b  ', 2), 'a b'); // collapses runs
  assert.equal(w.testerOpeningWords('', 3), '');
  assert.equal(w.testerOpeningWords(null, 3), '');
});

test('testerOpeningIsAmbiguous: flags an opening shared with another ayah', () => {
  const ayahs = [
    { numberInSurah: 1, text: 'وإذ قال ربك' },
    { numberInSurah: 2, text: 'وإذ قال موسى' },
    { numberInSurah: 3, text: 'إن الله عليم' },
  ];
  // "وإذ قال" opens both 1 and 2 -> ambiguous for ayah 1.
  assert.equal(w.testerOpeningIsAmbiguous('وإذ قال', ayahs, 1, 2), true);
  // A third word separates them.
  assert.equal(w.testerOpeningIsAmbiguous('وإذ قال ربك', ayahs, 1, 3), false);
  // Unique opening.
  assert.equal(w.testerOpeningIsAmbiguous('إن الله', ayahs, 3, 2), false);
});

test('testerOpeningIsAmbiguous: an ayah never matches itself', () => {
  const ayahs = [{ numberInSurah: 1, text: 'قل هو الله أحد' }];
  assert.equal(w.testerOpeningIsAmbiguous('قل هو', ayahs, 1, 2), false);
});

// ── Mushaf spread ──────────────────────────────────────────────────────────

test('mushafSpreadStart: an open mushaf puts the ODD page on the right', () => {
  // Arabic reads right-to-left, so the right-hand page carries the lower
  // (odd) number and its even successor sits to its left — the same pairing
  // _renderMemTestSpread() documents for the Memorization Test.
  assert.equal(w.mushafSpreadStart(1), 1);   // 1 right, 2 left
  assert.equal(w.mushafSpreadStart(2), 1);
  assert.equal(w.mushafSpreadStart(3), 3);   // 3 right, 4 left
  assert.equal(w.mushafSpreadStart(6), 5);   // 5 right, 6 left
  assert.equal(w.mushafSpreadStart(163), 163);
  assert.equal(w.mushafSpreadStart(604), 603); // last spread is 603-604
});

test('mushafSpreadStart: clamps out-of-range input into the mushaf', () => {
  assert.equal(w.mushafSpreadStart(0), 1);
  assert.equal(w.mushafSpreadStart(-5), 1);
  assert.equal(w.mushafSpreadStart(9999), 603);
});

test('mushafSpreadStart: both pages of a spread resolve to the same start', () => {
  for (let p = 1; p <= 603; p += 2) {
    assert.equal(w.mushafSpreadStart(p), p);
    assert.equal(w.mushafSpreadStart(p + 1), p);
  }
});

test('the rendered spread pages RTL: odd on the right, left arrow advances', async () => {
  // Drives the real flow — testerQuestion is a top-level `let`, so it cannot
  // be injected from outside (see the const/let caveat in CLAUDE.md's Tests
  // section); stubbing the fetch and calling nextTesterQuestion() is the only
  // way to reach the viewer.
  const p2 = (await loadPage('review.html')).window;
  p2.fetchSurahData = async () => ({
    arabicAyahs: Array.from({ length: 300 }, (_, i) => ({ numberInSurah: i + 1, text: `ك${i + 1} ب ج د` })),
    transAyahs: Array.from({ length: 300 }, (_, i) => ({ numberInSurah: i + 1, text: `t${i + 1}` })),
  });
  p2.localStorage.setItem('quranReviewMemorizedHizbs',
    JSON.stringify(Array.from({ length: 60 }, (_, i) => i + 1)));
  p2.setView('revise');
  p2.setReviseSubview('tester');
  p2.document.getElementById('tester-start-page').value = '163';
  p2.document.getElementById('tester-end-page').value = '163';

  await p2.nextTesterQuestion();
  p2.revealTesterAnswer();
  await new Promise(r => setTimeout(r, 30));

  const viewerHtml = () => p2.document.getElementById('tester-page-viewer').innerHTML;
  const pagesInDomOrder = () => [...viewerHtml().matchAll(/pages\/(\d+)\.jpg/g)].map(m => +m[1]);

  // DOM order is screen order: first column renders on the left.
  assert.deepEqual(pagesInDomOrder(), [164, 163],
    'even page belongs on the screen-left, odd on the screen-right');
  assert.match(viewerHtml(), /pages 163–164/);

  // A mushaf advances LEFTWARD, so ‹ must go FORWARD and › back — the mirror
  // of the Western convention.
  assert.match(viewerHtml(), /onclick="testerNextPage\(\)"[^>]*>‹</);
  assert.match(viewerHtml(), /onclick="testerPrevPage\(\)"[^>]*>›</);

  const buttons = p2.document.querySelectorAll('#tester-page-viewer .mushaf-page-btn');
  buttons[0].click();                       // ‹
  assert.deepEqual(pagesInDomOrder(), [166, 165], '‹ should advance a leaf');

  const after = p2.document.querySelectorAll('#tester-page-viewer .mushaf-page-btn');
  after[after.length - 1].click();          // ›
  assert.deepEqual(pagesInDomOrder(), [164, 163], '› should go back a leaf');
});
