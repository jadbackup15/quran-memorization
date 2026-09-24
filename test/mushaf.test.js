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
  // 2:31 occupies lines 4-5 of page 6, whose ink is measured at 21.90-32.00%.
  assert.equal(bands[0].top, 20.52);
  assert.ok(bands[0].top <= 21.90 && bands[0].top + bands[0].height >= 32.00,
    'band must contain the real ink of lines 4-5');
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
  // 2:31 starts on line 4 and 2:34 ends on line 11 of page 6. Measured ink:
  // line 4 at 21.90-26.00%, line 11 at 63.80-67.60%.
  assert.equal(bands[0].top, 20.52);
  assert.equal(bands[0].height, 48.32);
  assert.ok(bands[0].top <= 21.90, 'must not clip the start of line 4');
  assert.ok(bands[0].top + bands[0].height >= 67.60, 'must reach the end of line 11');
  assert.ok(bands[0].top + bands[0].height < 69.90, 'must not spill into line 12');
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

// ── Tap-to-zoom ────────────────────────────────────────────────────────────

test('zoom: tapping a page renders it alone at full width, and back', () => {
  const d = w.document;
  w.openMushaf({ surah: 2, ayah: 31 });            // spread 5|6
  const body = () => d.getElementById('mushaf-overlay-body').innerHTML;
  assert.deepEqual(pagesInDomOrder(body()), [6, 5]);

  w.toggleMushafZoom(6);
  assert.deepEqual(pagesInDomOrder(body()), [6], 'only the zoomed page renders');
  assert.match(body(), /mushaf-spread is-zoomed/);
  assert.match(body(), /mushaf-zoom-out/, 'offers a way back to both pages');

  w.toggleMushafZoom(6);
  assert.deepEqual(pagesInDomOrder(body()), [6, 5], 'tapping again restores the spread');
  w.closeMushaf();
});

test('zoom: the highlight band survives zooming', () => {
  const d = w.document;
  w.openMushaf({ surah: 2, ayah: 31 });
  const spreadBand = bandsIn(d.getElementById('mushaf-overlay-body').innerHTML);
  w.toggleMushafZoom(6);
  const zoomBand = bandsIn(d.getElementById('mushaf-overlay-body').innerHTML);
  // Percentages, so the band is identical at any rendered size.
  assert.deepEqual(zoomBand, spreadBand);
  w.closeMushaf();
});

test('zoom: paging, closing and reopening all clear it', () => {
  const d = w.document;
  const zoomed = () => /is-zoomed/.test(d.getElementById('mushaf-overlay-body').innerHTML);

  w.openMushaf({ surah: 2, ayah: 31 });
  w.toggleMushafZoom(6);
  assert.ok(zoomed());
  w.mushafOverlayNext();
  assert.ok(!zoomed(), 'a new spread must not open mid-zoom');

  w.toggleMushafZoom(7);
  w.closeMushaf();
  w.openMushaf({ surah: 2, ayah: 31 });
  assert.ok(!zoomed(), 'reopening always lands on the spread');
  w.closeMushaf();
});

test('zoom: a page outside the current spread is ignored, not shown', () => {
  // mushafZoomPage is a top-level `let` and so is NOT settable via `w.` (see
  // CLAUDE.md's Tests section) — go through the real toggle.
  const d = w.document;
  w.openMushaf({ surah: 2, ayah: 31 });   // spread 5|6
  w.toggleMushafZoom(400);                // not part of this spread
  const html = d.getElementById('mushaf-overlay-body').innerHTML;
  assert.deepEqual(pagesInDomOrder(html), [6, 5], 'falls back to the spread');
  assert.doesNotMatch(html, /pages\/400\.jpg/);
  w.toggleMushafZoom(400);                // clear it again
  w.closeMushaf();
});

test('rotate hint: only on a narrow portrait screen, and dismissible', () => {
  // loadPage.js stubs matchMedia to always return matches:false (it exists
  // because the real absence threw and silently halted evaluation), so the
  // hint is invisible to every other test. Stub it true just here.
  const realMM = w.matchMedia;
  try {
    w.localStorage.removeItem('quranReviewMushafRotateHintSeen');
    w.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
    assert.match(w.mushafSpreadHtml({ viewPage: 6, prevFn: 'p()', nextFn: 'n()' }),
      /mushaf-rotate-hint/);

    // Not while already reading one page full width. Go through the real
    // toggle — mushafZoomPage is a top-level `let` and `w.mushafZoomPage = 6`
    // silently does nothing (CLAUDE.md, Tests section).
    w.toggleMushafZoom(6);
    assert.doesNotMatch(w.mushafSpreadHtml({ viewPage: 6, prevFn: 'p()', nextFn: 'n()' }),
      /mushaf-rotate-hint/);
    w.toggleMushafZoom(6);

    w.dismissMushafRotateHint();
    assert.doesNotMatch(w.mushafSpreadHtml({ viewPage: 6, prevFn: 'p()', nextFn: 'n()' }),
      /mushaf-rotate-hint/, 'stays dismissed');
  } finally {
    w.matchMedia = realMM;
    w.localStorage.removeItem('quranReviewMushafRotateHintSeen');
  }
});

// ── The mobile home's own cards ────────────────────────────────────────────

test('mobile Mistakes Drill: the mushaf is gated by the reveal wrapper', async () => {
  const d = w.document;
  w.localStorage.setItem('quranReviewAyahMistakes', JSON.stringify([
    { id: 'm1', surah: 2, ayah: 30, hizb: 1, date: new Date().toISOString(), type: null, source: 'live' },
  ]));
  await w.mobStartDrill();
  await new Promise(r => setTimeout(r, 60));

  // The button is in the DOM but inside #mob-drill-answer-wrap, which stays
  // display:none until mobDrillReveal() — gated with no state of its own.
  assert.equal(d.getElementById('mob-drill-answer-wrap').style.display, 'none');
  const btn = d.querySelector('#mob-drill-answer-mushaf .mushaf-open-btn');
  assert.ok(btn, 'button rendered inside the hidden wrapper');
  assert.match(btn.getAttribute('onclick'), /openMushaf\(\{surah:2, ayah:30\}\)/);

  w.mobDrillReveal();
  assert.equal(d.getElementById('mob-drill-answer-wrap').style.display, 'block');
});

test('mobile AI cluster: ungated, and opens the whole range', () => {
  // A recommendation has no answer to protect, unlike a drill question.
  w.mobShowDrillCluster({ cluster: { ref: '2:10–2:17', reason: 'weak' } });
  const btn = w.document.querySelector('#mob-drill-cluster-mushaf .mushaf-open-btn');
  assert.ok(btn);
  assert.match(btn.getAttribute('onclick'), /openMushaf\(\{surah:2, ayah:10, endAyah:17\}\)/);
});

test('mobile Revise card: opens its page and marks both page-start ayat', async () => {
  const d = w.document;
  // Give the stub REAL page geometry so the card's page-snapping is genuine.
  const realPages = async (n) => ({
    surahInfo: { number: n, englishName: 'Al-Baqara', name: 'البقرة' },
    arabicAyahs: Array.from({ length: 286 }, (_, i) => ({
      numberInSurah: i + 1, text: `ayah ${i + 1}`, page: w.mushafPageOfAyah(2, i + 1) || 2,
    })),
    transAyahs: Array.from({ length: 286 }, (_, i) => ({ numberInSurah: i + 1, text: `t ${i + 1}` })),
  });
  const prev = w.fetchSurahData;
  w.fetchSurahData = realPages;
  w.localStorage.setItem('quranReviewMemorizedHizbs', JSON.stringify([1, 2, 3, 4, 5, 6]));
  try {
    const slot = () => d.getElementById('mob-revise-mushaf');
    assert.equal(slot().style.display, 'none', 'hidden until a pick resolves');

    await w.mobDoRevise();
    await new Promise(r => setTimeout(r, 80));

    const btn = slot().querySelector('.mushaf-open-btn');
    assert.ok(btn, 'button appears once the card has something to show');
    assert.equal(slot().style.display, 'block');

    // This card is page-oriented, so it opens a PAGE and bands the two ayat it
    // displays — the page's opening and the next page's. Those are separate
    // points, not a range, which is what the `highlights` argument is for.
    const arg = JSON.parse(btn.getAttribute('onclick').match(/openMushaf\((\{.*\})\)/)[1]);
    assert.ok(arg.page >= 1 && arg.page <= 604);
    assert.ok(arg.highlights.length >= 1);
    assert.ok(arg.highlights.every(h => h.surah === 2 && h.ayah >= 1));

    btn.click();
    const body = d.getElementById('mushaf-overlay-body').innerHTML;
    assert.ok(pagesInDomOrder(body).includes(arg.page), 'the spread shown contains that page');
    assert.match(body, /mushaf-page-col is-active/, 'the page in question is marked');
    w.closeMushaf();
  } finally {
    w.fetchSurahData = prev;
  }
});

test('mobile cue block: the mushaf sits inside its own hidden reveal', () => {
  const html = w.mobCueBlockHtml(2, 29, 30, 'cue text', 'mistake text');
  const revealStart = html.indexOf('id="mob-cue-reveal-2-30"');
  assert.ok(revealStart > -1);
  // The reveal div is `hidden` until the 👁 button flips it...
  assert.match(html.slice(revealStart, revealStart + 60), /hidden/);
  // ...and the button lives inside it, so it cannot be tapped first.
  assert.match(html.slice(revealStart), /mushaf-open-btn/);
  assert.match(html.slice(revealStart), /openMushaf\(\{surah:2, ayah:30\}\)/);
});

// ── Today's Plan ───────────────────────────────────────────────────────────

test("Today's Plan: every cluster row opens its FULL range in the mushaf", async () => {
  const d = w.document;
  const plan = {
    date: new Date().toISOString().slice(0, 10),
    clusters: [
      { id: 'a', ref: '2:10–2:17', strength: 'vw', targetReps: 10, done: false },
      { id: 'b', ref: '2:21–2:30', strength: 'vw', targetReps: 10, done: true, reps: 10 },
      { id: 'c', ref: '2:255', strength: 'w', targetReps: 5, done: false },
    ],
  };
  w.localStorage.setItem('quranReviewDailyPlan', JSON.stringify(plan));

  w.setView('daily');
  await new Promise(r => setTimeout(r, 60));
  const desktop = d.getElementById('daily-plan-content').innerHTML;
  w.mobShowHome();
  await new Promise(r => setTimeout(r, 60));
  const mobile = d.getElementById('mob-daily-plan-inline').innerHTML;

  const count = h => (h.match(/mdp-mushaf-btn/g) || []).length;
  assert.equal(count(desktop), 3, 'desktop: one per row, done rows included');
  assert.equal(count(mobile), 3, 'mobile: the same, via the shared helper');

  // A plan row is a RANGE to recite, so the whole span is highlighted...
  assert.match(desktop, /openMushaf\(\{surah:2, ayah:10, endAyah:17\}\)/);
  assert.match(desktop, /openMushaf\(\{surah:2, ayah:21, endAyah:30\}\)/);  // done row too
  // ...and a single-ayah cluster collapses to start === end rather than breaking.
  assert.match(desktop, /openMushaf\(\{surah:2, ayah:255, endAyah:255\}\)/);
});

test("Today's Plan: a cluster spanning a page break bands both facing pages", async () => {
  const d = w.document;
  w.setView('daily');
  await new Promise(r => setTimeout(r, 60));
  d.querySelector('.mdp-mushaf-btn').click();
  await new Promise(r => setTimeout(r, 30));

  const body = d.getElementById('mushaf-overlay-body').innerHTML;
  assert.equal(d.getElementById('mushaf-overlay-title').textContent, '2:10-17 — Al-Baqara');
  // 2:10-2:17 straddles the 3|4 spread, so both columns carry a band.
  assert.deepEqual(pagesInDomOrder(body), [4, 3]);
  assert.equal(bandsIn(body).length, 2);
  w.closeMushaf();
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
