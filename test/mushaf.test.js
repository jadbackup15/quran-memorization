'use strict';

// Tests for the app-wide mushaf view (review.html): the shared spread renderer
// behind both the Tester's inline panel and the overlay, the overlay itself,
// and the reveal-gating in the two self-testing views.
//
// The geometry helpers these build on (mushafBandStyle, mushafSpreadStart,
// mushafLineRange, mushafPageOfAyah) are covered in tester.test.js.

const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { loadPage } = require('./helpers/loadPage.js');

// A surah stub big enough for Al-Baqara, with 8 ayat per page so a range can
// be made to straddle a page boundary on demand.
const stubSurah = (n) => ({
  surahInfo: { number: n, englishName: 'Al-Baqara', name: 'البقرة' },
  arabicAyahs: Array.from({ length: 286 }, (_, i) => ({
    numberInSurah: i + 1, text: `ayah ${i + 1}`, page: 2 + Math.floor(i / 8),
  })),
  transAyahs: Array.from({ length: 286 }, (_, i) => ({ numberInSurah: i + 1, text: `t ${i + 1}` })),
});

let w;
before(async () => {
  w = (await loadPage('review.html')).window;
  w.fetchSurahData = async (n) => stubSurah(n);
});

const pagesInDomOrder = (html) => [...html.matchAll(/pages\/(\d+)\.jpg/g)].map(m => +m[1]);
const bandsIn = (html) => [...html.matchAll(/mushaf-band" style="top:([\d.]+)%;height:([\d.]+)%/g)]
  .map(m => ({ top: +m[1], height: +m[2] }));

// ── The shared spread renderer ─────────────────────────────────────────────

test('mushafSpreadHtml: odd page renders on the screen-right', () => {
  // DOM order is screen order, so the left column comes first.
  const html = w.mushafSpreadHtml({ viewPage: 6, highlights: [], prevFn: 'p()', nextFn: 'n()' });
  assert.deepEqual(pagesInDomOrder(html), [6, 5]);
  assert.match(html, /pages 5–6/);
  // Either page of the spread produces the same spread.
  assert.deepEqual(pagesInDomOrder(w.mushafSpreadHtml({ viewPage: 5, prevFn: 'p()', nextFn: 'n()' })), [6, 5]);
});

test('mushafSpreadHtml: bands only the page the ayah is actually on', () => {
  const html = w.mushafSpreadHtml({
    viewPage: 6, highlights: [{ surah: 2, ayah: 31 }], prevFn: 'p()', nextFn: 'n()',
  });
  const bands = bandsIn(html);
  assert.equal(bands.length, 1, '2:31 is on page 6 only, so page 5 gets no band');
  assert.equal(bands[0].top, 25.16);   // lines 4-5
  // And the page carrying it is the marked one.
  assert.match(html, /mushaf-page-col is-active"[\s\S]*?pages\/6\.jpg/);
});

test('mushafSpreadHtml: a highlight spanning the spread bands both pages', () => {
  // Find a range whose ends sit on the two facing pages of one spread.
  const right = 5, left = 6;
  const onRight = [], onLeft = [];
  for (let a = 1; a <= 286; a++) {
    const p = w.mushafPageOfAyah(2, a);
    if (p === right) onRight.push(a);
    if (p === left) onLeft.push(a);
  }
  assert.ok(onRight.length && onLeft.length, 'fixture pages must both hold ayat');
  const highlights = [...onRight, ...onLeft].map(a => ({ surah: 2, ayah: a }));
  const bands = bandsIn(w.mushafSpreadHtml({ viewPage: 5, highlights, prevFn: 'p()', nextFn: 'n()' }));
  assert.equal(bands.length, 2, 'both facing pages should be banded');
});

test('mushafSpreadHtml: nav handlers are the ones passed in, RTL-wired', () => {
  const html = w.mushafSpreadHtml({ viewPage: 100, prevFn: 'myPrev()', nextFn: 'myNext()' });
  // A mushaf advances LEFTWARD: the left-pointing arrow goes forward.
  assert.match(html, /onclick="myNext\(\)"[^>]*>‹</);
  assert.match(html, /onclick="myPrev\(\)"[^>]*>›</);
});

test('mushafSpreadHtml: ends of the mushaf disable the right arrow', () => {
  assert.match(w.mushafSpreadHtml({ viewPage: 1, prevFn: 'p()', nextFn: 'n()' }),
    /onclick="p\(\)" disabled/);
  assert.match(w.mushafSpreadHtml({ viewPage: 604, prevFn: 'p()', nextFn: 'n()' }),
    /onclick="n\(\)" disabled/);
});

// ── The overlay ────────────────────────────────────────────────────────────

test('openMushaf: opens on the spread holding the ayah, and names it', () => {
  w.openMushaf({ surah: 2, ayah: 31 });
  const d = w.document;
  assert.equal(d.getElementById('mushaf-overlay').style.display, 'block');
  // SURAHS rows are ARRAYS ([num, english, arabic, ...]) — a `.name` here
  // silently produced "2:31 — undefined" before this was fixed.
  assert.equal(d.getElementById('mushaf-overlay-title').textContent, '2:31 — Al-Baqara');
  assert.deepEqual(pagesInDomOrder(d.getElementById('mushaf-overlay-body').innerHTML), [6, 5]);
  assert.equal(d.body.style.overflow, 'hidden', 'page behind must not scroll');
  w.closeMushaf();
});

test('openMushaf: a range highlights every ayah in it', () => {
  w.openMushaf({ surah: 2, ayah: 31, endAyah: 34 });
  const html = w.document.getElementById('mushaf-overlay-body').innerHTML;
  const bands = bandsIn(html);
  assert.equal(bands.length, 1);
  assert.equal(bands[0].top, 25.16);       // 2:31 starts line 4
  assert.equal(bands[0].height, 44.43);    // ...through 2:34 ending line 11
  assert.equal(w.document.getElementById('mushaf-overlay-title').textContent, '2:31-34 — Al-Baqara');
  w.closeMushaf();
});

test('openMushaf: can open a bare page, with no highlight', () => {
  w.openMushaf({ page: 163 });
  const d = w.document;
  assert.equal(d.getElementById('mushaf-overlay-title').textContent, 'Page 163');
  const html = d.getElementById('mushaf-overlay-body').innerHTML;
  assert.deepEqual(pagesInDomOrder(html), [164, 163]);
  assert.equal(bandsIn(html).length, 0);
  w.closeMushaf();
});

test('closeMushaf: hides the overlay and releases the page scroll', () => {
  w.openMushaf({ surah: 2, ayah: 31 });
  w.closeMushaf();
  assert.equal(w.document.getElementById('mushaf-overlay').style.display, 'none');
  assert.equal(w.document.body.style.overflow, '');
});

test('overlay paging turns a whole leaf, leftward-forward', () => {
  w.openMushaf({ surah: 2, ayah: 31 });          // spread 5|6
  const body = () => w.document.getElementById('mushaf-overlay-body').innerHTML;
  w.mushafOverlayNext();
  assert.deepEqual(pagesInDomOrder(body()), [8, 7], 'Next advances two pages');
  w.mushafOverlayPrev();
  assert.deepEqual(pagesInDomOrder(body()), [6, 5], 'Prev goes back two');
  w.closeMushaf();
});

test('overlay paging does not disturb the Tester\'s own view state', () => {
  // The two keep separate state; that is why the renderer takes handler names.
  w.openMushaf({ page: 300 });
  w.mushafOverlayNext();
  assert.equal(w.document.getElementById('tester-page-viewer'), null,
    'the Tester viewer should not have been created by overlay paging');
  w.closeMushaf();
});

// ── The button, everywhere an ayah is named ────────────────────────────────

test('ayahTextExpandHtml: every expanded ayah offers the mushaf', async () => {
  // One function backs all ten ayah-reference sites, so this covers them all.
  await w.toggleAyahText(2, 255);
  const html = w.ayahTextExpandHtml(2, 255);
  assert.match(html, /class="mushaf-open-btn"/);
  assert.match(html, /openMushaf\(\{surah:2, ayah:255\}\)/);
  // Several of those rows have their own click behaviour.
  assert.match(html, /event\.stopPropagation\(\)/);
  await w.toggleAyahText(2, 255);   // collapse again
});

// ── Reveal gating ──────────────────────────────────────────────────────────

test('Revise: the button announces that opening the page reveals a hidden ayah', async () => {
  const d = w.document;
  w.setView('revise');
  const btn = () => d.getElementById('btn-revise-mushaf');

  await w.displayAyah(2, 30);
  assert.equal(btn().textContent, '📖 Mushaf');

  await w.displayAyah(2, 30, 33);          // ayah 33 blanked
  assert.equal(btn().textContent, '👁 Reveal & open mushaf');
  const hiddenRow = d.querySelector('#res-arabic .ayah-line[data-ayah-num="33"]');
  assert.match(hiddenRow.innerHTML, /recite from memory/);
});

test('Revise: opening the mushaf un-blanks the card first', async () => {
  const d = w.document;
  w.setView('revise');
  await w.displayAyah(2, 30, 33);
  assert.match(d.querySelector('#res-arabic .ayah-line[data-ayah-num="33"]').innerHTML,
    /recite from memory/);

  await w.openMushafForRevise();

  // Assert on the AYAH ROW, not the whole card: the "⋯ N ayahs in between —
  // recite from memory ⋯" gap indicator carries the same phrase and would make
  // a card-wide search pass even when the ayah is still blanked.
  assert.doesNotMatch(d.querySelector('#res-arabic .ayah-line[data-ayah-num="33"]').innerHTML,
    /recite from memory/);
  assert.equal(d.getElementById('btn-revise-mushaf').textContent, '📖 Mushaf');
  assert.equal(d.getElementById('mushaf-overlay').style.display, 'block');
  w.closeMushaf();
});

test('Memorization Test: no mushaf button before an answer is revealed', () => {
  // The printed page answers the question outright — most starkly in
  // 'leftright', which asks which side of the spread a page falls on.
  assert.equal(w.memTestMushafBtnHtml(), '',
    'with no page under test there is nothing to offer');
});

// ── AI Review ──────────────────────────────────────────────────────────────

test('AI Review offers Copy Prompt alongside Copy and Print', () => {
  const row = w.document.getElementById('ai-review-style').parentElement.innerHTML;
  assert.match(row, /copyAiReviewPrompt\(\)/);
  assert.match(row, /copyAiReview\(\)/);   // still copies the RESULT, separately
  assert.equal(typeof w.copyAiReviewPrompt, 'function');
});

test('surah names resolve from the SURAHS array shape', () => {
  // SURAHS rows are arrays: [number, english, arabic, ayahCount, ...]. Reading
  // `.name` yields undefined, which is what broke the overlay title and filled
  // the Tester's surah dropdown with "1. undefined".
  w.setView('revise');
  w.setReviseSubview('tester');     // initTesterUI() is what populates them
  const opts = w.document.getElementById('tester-start-surah').options;
  assert.equal(opts.length, 114);
  assert.equal(opts[0].textContent, '1. Al-Fatiha');
  assert.equal(opts[113].textContent, '114. An-Nas');
});
