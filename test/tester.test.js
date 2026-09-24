'use strict';

// Tests for the Tester sub-tab's pure helpers (review.html) and for the
// integrity of the vendored quran-line-bands.js data it reads.
//
// The band arithmetic is the whole page-highlight feature, so it is asserted
// against hand-computed numbers rather than against itself: with the text
// block running from 8.5% to 91.8% of the image height over 15 lines, one
// line is (0.918 - 0.085) / 15 = 0.055533… of the image, i.e. 5.55% rounded.

const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { loadPage } = require('./helpers/loadPage.js');

// Arrays returned from the jsdom realm carry a foreign Array prototype, which
// assert.deepEqual rejects even when the data matches. Round-trip through JSON.
const toPlain = (value) => JSON.parse(JSON.stringify(value));

let w;
before(async () => { w = (await loadPage('review.html')).window; });

// ── Band geometry ──────────────────────────────────────────────────────────

test('testerBandStyle: line 1 starts at the top of the text block', () => {
  const s = w.testerBandStyle([1, 1], 6);
  assert.equal(s.top, 8.5);
  assert.equal(s.height, 5.55);
});

test('testerBandStyle: line 15 ends at the bottom of the text block', () => {
  const s = w.testerBandStyle([15, 15], 6);
  // top = 8.5 + 14 * 5.5533… = 86.25%, and 86.25 + 5.55 ≈ 91.8%
  assert.equal(s.top, 86.25);
  assert.ok(Math.abs(s.top + s.height - 91.8) < 0.02,
    `band should end at 91.8%, got ${s.top + s.height}`);
});

test('testerBandStyle: a full-page range spans the whole text block', () => {
  const s = w.testerBandStyle([1, 15], 48);
  assert.equal(s.top, 8.5);
  assert.ok(Math.abs(s.height - 83.3) < 0.02, `expected ~83.3%, got ${s.height}`);
});

test('testerBandStyle: multi-line range is proportional', () => {
  const one = w.testerBandStyle([4, 4], 6).height;
  const four = w.testerBandStyle([4, 7], 6).height;
  assert.ok(Math.abs(four - one * 4) < 0.02, 'four lines should be 4x one line');
});

test('testerBandStyle: pages 1-2 are never banded', () => {
  // Those two pages are decorative frames, not 15 plain lines, so the
  // arithmetic does not describe them.
  assert.equal(w.testerBandStyle([2, 2], 1), null);
  assert.equal(w.testerBandStyle([3, 3], 2), null);
  assert.notEqual(w.testerBandStyle([3, 3], 3), null);
});

test('testerBandStyle: rejects malformed or out-of-range input', () => {
  assert.equal(w.testerBandStyle(null, 6), null);
  assert.equal(w.testerBandStyle([1], 6), null);
  assert.equal(w.testerBandStyle([0, 3], 6), null);   // line 0 does not exist
  assert.equal(w.testerBandStyle([1, 16], 6), null);  // past the last line
  assert.equal(w.testerBandStyle([9, 4], 6), null);   // inverted
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
  assert.equal(w.testerPageOfAyah(2, 1), 2);
  assert.equal(w.testerPageOfAyah(2, 6), 3);
  assert.equal(w.testerPageOfAyah(2, 282), 48); // fills page 48 by itself
  assert.equal(w.testerPageOfAyah(2, 283), 49);
  assert.equal(w.testerPageOfAyah(3, 15), 51);  // page 51 ends here
  assert.equal(w.testerPageOfAyah(114, 1), 604);
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

test('testerLineRange: matches the reference page-6 screenshot', () => {
  // 2:31-2:34 highlighted on page 6 in the Quran Tester UI.
  assert.deepEqual(Array.from(w.testerLineRange(2, 31, 6)), [4, 5]);
  assert.deepEqual(Array.from(w.testerLineRange(2, 34, 6)), [9, 11]);
  assert.equal(w.testerLineRange(2, 31, 7), null); // not on that page
});

// ── Pool selection ─────────────────────────────────────────────────────────

test('testerPool: a page range yields only ayat on those pages', () => {
  const pool = w.testerPool({ mode: 'pages', startPage: 6, endPage: 7 });
  assert.ok(pool.length > 0);
  assert.ok(pool.every(x => x.page === 6 || x.page === 7));
  assert.equal(pool[0].surah, 2);
  assert.equal(pool[0].ayah, 30); // page 6 begins at 2:30
});

test('testerPool: reversed page bounds are accepted', () => {
  const fwd = w.testerPool({ mode: 'pages', startPage: 6, endPage: 8 });
  const rev = w.testerPool({ mode: 'pages', startPage: 8, endPage: 6 });
  assert.equal(fwd.length, rev.length);
});

test('testerPool: an ayah range is inclusive at both ends', () => {
  const pool = w.testerPool({
    mode: 'ayah', startSurah: 1, startAyah: 1, endSurah: 1, endAyah: 7,
  });
  assert.equal(pool.length, 7);
  assert.equal(pool[0].ayah, 1);
  assert.equal(pool[6].ayah, 7);
});

test('testerPool: an ayah range can cross a surah boundary in order', () => {
  const pool = w.testerPool({
    mode: 'ayah', startSurah: 1, startAyah: 5, endSurah: 2, endAyah: 3,
  });
  assert.deepEqual(
    toPlain(pool.map(x => x.key)),
    ['1:5', '1:6', '1:7', '2:1', '2:2', '2:3'],
  );
});

test('testerPool: pool is in mushaf order, so a chunk walks forward', () => {
  const pool = w.testerPool({ mode: 'pages', startPage: 3, endPage: 5 });
  for (let i = 1; i < pool.length; i++) {
    assert.ok(pool[i].global > pool[i - 1].global,
      `out of order at ${pool[i - 1].key} -> ${pool[i].key}`);
  }
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
