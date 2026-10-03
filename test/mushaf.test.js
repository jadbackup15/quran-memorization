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

test('the mobile Mistakes Drill is gone, helpers and all', () => {
  // Removed on request. It overlapped the Drill card above it (both asked
  // "what comes next?") and cost a whole card of the home screen to do it.
  // Asserted here because a card can be deleted from the markup while its
  // ~200 lines of helpers sit on unreferenced, which is how dead code accrues.
  const d = w.document;
  assert.equal(d.getElementById('mob-drill-card'), null);
  assert.equal(d.getElementById('mob-drill-inner'), null);
  for (const fn of ['mobStartDrill', 'mobDrillReveal', 'mobDrillGetCluster',
                    'mobShowDrillCluster', 'mobCollapseDrill'])
    assert.equal(typeof w[fn], 'undefined', `${fn} outlived the card it served`);
  assert.equal(w.localStorage.getItem('quranMobDrillPlan'), null);
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
  const realRandom = w.Math.random;
  w.fetchSurahData = realPages;
  w.localStorage.setItem('quranReviewMemorizedHizbs', JSON.stringify([1, 2, 3, 4, 5, 6]));
  // mobDoRevise() picks at random, and it also RETRIES when the draw lands on
  // the same page as last time. Left unstubbed this test passes or fails
  // depending on the draw — it was genuinely flaky before this was pinned.
  w.Math.random = () => 0.42;
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
    w.Math.random = realRandom;
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

// ── Mutashabihat compare as mushaf spreads ─────────────────────────────────

test('mutashabihat compare shows each ayah as its own spread, both pages', async () => {
  // Confusable ayat are told apart largely by WHERE they sit — page, side,
  // how far down — which a text column throws away entirely.
  const d = w.document;
  w.localStorage.setItem('quranReviewMutashabihatPairs', JSON.stringify([
    { id: 'g1', ayat: [{ surah: 2, ayah: 31 }, { surah: 2, ayah: 100 }],
      note: 'similar', dateAdded: new Date().toISOString() },
  ]));
  w.setView('mutashabihat');
  await w.toggleMutashabihatCompare('g1');
  await new Promise(r => setTimeout(r, 80));

  const cmp = d.getElementById('mutashabihat-compare-g1');
  // Two ayat, each a left+right spread.
  assert.equal(pagesInDomOrder(cmp.innerHTML).length, 4);
  assert.equal(bandsIn(cmp.innerHTML).length, 2, 'one band per ayah');
  // Static: no per-column paging, because there is nothing to page relative to.
  assert.doesNotMatch(cmp.innerHTML, /mushaf-page-btn/);

  // Clicking a page opens the full viewer on that ayah. The handler must
  // survive being an attribute value: JSON.stringify's own double quotes would
  // close a double-quoted onclick early and silently break the click, so the
  // args are emitted as bare identifiers instead.
  const wrap = cmp.querySelector('.mushaf-image-wrap');
  assert.match(wrap.getAttribute('onclick'), /^openMushaf\(\{surah:2, ayah:\d+\}\)$/);
  wrap.click();
  await new Promise(r => setTimeout(r, 30));
  assert.equal(d.getElementById('mushaf-overlay').style.display, 'block');
  assert.match(d.getElementById('mushaf-overlay-title').textContent, /^2:\d+ — /);
  w.closeMushaf();
});

test('mushafOpenArgs emits attribute-safe arguments', () => {
  assert.equal(w.mushafOpenArgs({ surah: 2, ayah: 31 }), '{surah:2, ayah:31}');
  assert.equal(w.mushafOpenArgs({ surah: 2, ayah: 10, endAyah: 17 }), '{surah:2, ayah:10, endAyah:17}');
  assert.equal(w.mushafOpenArgs({ page: 163 }), '{page:163}');
  // The whole point: no double quotes, which would close the attribute.
  assert.ok(!w.mushafOpenArgs({ surah: 2, ayah: 31 }).includes('"'));
});

// ── The mobile home, after the card pass ───────────────────────────────────

test('every mobile card keeps its controls behind ONE ⋯, and it says it is open', () => {
  // The Today's Plan card had five always-visible control rows stacked above
  // the plan itself, which is the thing the card exists to show.
  const d = w.document;
  for (const name of ['daily', 'import', 'prompts']) {
    const more = d.getElementById(`mob-more-${name}`);
    assert.ok(more, `${name} has a collapsed section`);
    assert.equal(more.style.display, 'none', 'collapsed by default');
    assert.ok(more.classList.contains('mob-card-more'),
      'so the rows inside stack instead of flowing as one button row');

    const btn = more.previousElementSibling.querySelector('.mob-more-btn');
    assert.ok(btn, `${name}'s toggle sits in the row directly above it`);
    w.mobToggleCardMore(name);
    assert.equal(more.style.display, 'flex');
    assert.equal(btn.textContent, '✕', 'the glyph changes, so open is visible');
    w.mobToggleCardMore(name);
    assert.equal(more.style.display, 'none');
    assert.equal(btn.textContent, '⋯');
  }

  // The plan's own controls are the ones that moved.
  const daily = d.getElementById('mob-more-daily');
  for (const id of ['mob-daily-plan-days', 'mob-daily-plan-model', 'mob-daily-plan-extra',
                    'mob-daily-include-attention', 'mob-daily-include-practice'])
    assert.ok(daily.contains(d.getElementById(id)), `${id} moved into the section`);
  // ...and the two daily actions did NOT.
  assert.ok(!daily.contains(d.getElementById('mob-daily-generate-btn')));
});

test('the mobile Drill card shows Arabic only', () => {
  // It asks "what comes next" between two page landmarks. An English
  // translation under each one answers that question for you.
  const d = w.document;
  assert.equal(d.getElementById('mob-trans-1'), null);
  assert.equal(d.getElementById('mob-trans-2'), null);
  const inner = d.getElementById('mob-revise-inner');
  assert.equal(inner.querySelectorAll('.mob-trans').length, 0);
  assert.ok(d.getElementById('mob-ar-1') && d.getElementById('mob-ar-2'));
});

test('the mobile Prompts card picks a prompt and can copy the data alone', async () => {
  const d = w.document;
  const sel = d.getElementById('mob-agent-preset');
  assert.ok(sel);
  w.renderMobAgentCard();
  const ids = [...sel.options].map(o => o.value);
  assert.ok(ids.includes('print'), 'offers the full daily plan');
  assert.equal(sel.value, w.getAgentPromptPreset(), 'shows the active one');

  // Every option offered must actually RESOLVE. prompts.md has not been
  // fetched in this harness, so only the embedded fallbacks exist — and
  // setAgentPromptPreset() silently falls back to 'general' for anything
  // else, which would make a listed option snap back the moment it is picked.
  for (const id of ids) {
    sel.value = id;
    sel.dispatchEvent(new w.Event('change'));
    assert.equal(w.getAgentPromptPreset(), id, `${id} is offered but does not stick`);
  }

  // Once prompts.md lands the rest appear — 5-Minute Review among them.
  // Driven through the real loader rather than by poking the presets object,
  // which is a top-level `let` and so not reachable from out here anyway.
  const realFetch2 = w.fetch;
  try {
    const md = require('fs').readFileSync('agent-prompts/prompts.md', 'utf8');
    w.fetch = async () => ({ ok: true, text: async () => md });
    await w.loadAgentPromptFiles();
    const after = [...sel.options].map(o => o.value);
    assert.ok(after.includes('fiveminute'), '5-Minute Review is offered once loaded');
    assert.ok(after.length > ids.length, 'the list fills out rather than staying short');
    sel.value = 'fiveminute';
    sel.dispatchEvent(new w.Event('change'));
    assert.equal(w.getAgentPromptPreset(), 'fiveminute');
  } finally { w.fetch = realFetch2; }

  // Data without the prompt is a primary action now, and "Open Prompts" —
  // which dropped the phone into the desktop editor — is gone.
  const labels = [...d.querySelectorAll('.mob-action-card button')].map(b => b.textContent.trim());
  assert.ok(labels.some(t => /Data Only/.test(t)));
  assert.ok(!labels.some(t => /Open Prompts/.test(t)));
});

test('the mobile Import card offers Save to Telegram, not a file picker', () => {
  const d = w.document;
  const card = d.getElementById('mob-more-import').closest('.mob-action-card');
  const primary = [...d.getElementById('mob-more-import').previousElementSibling
    .querySelectorAll('button')].map(b => b.textContent.trim());
  assert.ok(primary.some(t => /Save to Telegram/.test(t)));
  assert.ok(!primary.some(t => /Export File/.test(t)), 'the picker is not a primary action');
  // Still reachable, just not competing with the two everyday buttons.
  assert.ok([...card.querySelectorAll('button')].some(b => /Export File/.test(b.textContent)));
});

test('the mobile Hizb Overview lists strength and when each hizb is due', () => {
  const d = w.document;
  const now = Date.now();
  w.localStorage.setItem('quranReviewMemorizedHizbs', JSON.stringify([1, 2]));
  w.localStorage.setItem('quranReviewHizbLog', JSON.stringify([
    // Hizb 1 recited today and cleanly; Hizb 2 not for a fortnight.
    { id: 'a', hizb: 1, mistakes: 0, date: new Date(now).toISOString() },
    { id: 'b', hizb: 2, mistakes: 9, date: new Date(now - 14 * 86400000).toISOString() },
  ]));
  w.renderMobHizbOverview();
  const rows = [...d.querySelectorAll('#mob-hizb-overview-list .mob-ho-row')];
  assert.equal(rows.length, 2);

  // Most urgent first, matching Overview's own grid rather than hizb order.
  assert.match(rows[0].textContent, /Hizb 2/);
  assert.match(rows[0].textContent, /Overdue/);
  assert.ok(rows[0].querySelector('.mob-ho-due').classList.contains('rs-red'));
  assert.match(rows[1].textContent, /Hizb 1/);

  // Both facts the card is for: how strong, and when due.
  assert.ok(rows[1].querySelector('.ov-strength-badge'), 'strength badge');
  assert.ok(rows[1].querySelector('.mob-ho-due'), 'due badge');
  assert.match(d.getElementById('mob-ho-sub').textContent, /1 of 2 due now/);

  // Tapping a row records a review, the same entry point as the desktop grid.
  assert.match(rows[0].getAttribute('onclick'), /setHizbLastReviewed\(2\)/);
});

test('the mobile plan collapses every strength band in one tap', async () => {
  // Per-band toggles already existed; what was missing was putting the WHOLE
  // plan away. On a three-band plan that was three taps, and the last band
  // was routinely left open — which is what "I still cannot collapse all the
  // sections" looked like from the outside.
  const d = w.document;
  w.localStorage.setItem('quranReviewDailyPlan', JSON.stringify({
    date: new Date().toDateString(),
    clusters: [
      { id: 'c1', ref: '2:27-2:29', strength: 'vw', targetReps: 5 },
      { id: 'c2', ref: '2:52-2:54', strength: 'w', targetReps: 5 },
      { id: 'c3', ref: '2:78-2:80', strength: 'o', targetReps: 5 },
    ],
  }));
  const plan = w.loadDailyPlan();
  assert.ok(plan, 'the plan loads');
  // JSON round-trip: an array from the page realm fails deepEqual against a
  // Node-realm one even when the data matches (see CLAUDE.md's Tests note).
  assert.deepEqual(JSON.parse(JSON.stringify(w.dailyPlanStrengthBands(plan))),
    ['vw', 'w', 'o'], 'only bands the plan actually has, in display order');

  await w.renderMobDailyInline(plan);
  // In the CARD's top-right controls, not the plan head — it sat below the
  // title there and read as part of the progress row.
  w.initMobCardCollapse();
  const btn = () => d.querySelector('.mob-action-card[data-card="daily"] .mob-card-actions .mdp-collapse-all');
  const carets = () => [...d.querySelectorAll('#mob-daily-plan-inline .mdp-caret')]
    .map(e => e.textContent.trim());
  assert.ok(btn(), 'the control is in the plan head, beside the progress bar');
  assert.deepEqual(carets(), ['▾', '▾', '▾'], 'starts fully expanded');

  btn().click();
  await new Promise(r => setTimeout(r, 20));
  assert.deepEqual(carets(), ['▸', '▸', '▸'], 'one tap closes every band');
  assert.match(btn().textContent, /Expand all/, 'and the label says what it does next');
  assert.equal(d.querySelectorAll('#mob-daily-plan-inline .mdp-row').length, 0,
    'no cluster rows left, which is the point');

  btn().click();
  await new Promise(r => setTimeout(r, 20));
  assert.deepEqual(carets(), ['▾', '▾', '▾']);

  // A half-open plan collapses rather than alternating, so one tap always
  // reaches the tidy state whatever was left open.
  w.mobToggleDailyGroup('w');
  await new Promise(r => setTimeout(r, 20));
  assert.deepEqual(carets(), ['▾', '▸', '▾']);
  assert.match(btn().textContent, /Collapse all/);
  btn().click();
  await new Promise(r => setTimeout(r, 20));
  assert.deepEqual(carets(), ['▸', '▸', '▸']);
  w.localStorage.removeItem('quranReviewDailyPlan');
});

test('Hizb Overview is the first card on the mobile home', () => {
  // "Where do I stand" comes before "what do I do today", and the plan card
  // below it is tall enough to push anything under it off the screen.
  const titles = [...w.document.querySelectorAll('#mobile-home .mob-action-card')]
    .map(c => (c.querySelector('.mob-action-title') || {}).textContent || '')
    .filter(Boolean).map(t => t.trim());
  assert.equal(titles[0], 'Hizb Overview');
  assert.equal(titles[1], "Today's Plan");
});

test('both prompt pickers group the daily-plan family and name it plainly', async () => {
  // "Add daily plan here", pointing at the Prompts dropdown — which already
  // had it, as "Full Plan". That name says how much of a plan it is and never
  // that it IS the daily plan, and five of the eight presets produce one.
  const d = w.document;
  // Asserted on the rendered option, not the label map — that is a top-level
  // const and so not reachable from out here, and the option text is what the
  // user actually reads.

  const realFetch = w.fetch;
  try {
    const md = require('fs').readFileSync('agent-prompts/prompts.md', 'utf8');
    w.fetch = async () => ({ ok: true, text: async () => md });
    await w.loadAgentPromptFiles();

    for (const id of ['mob-agent-preset', 'agent-prompt-preset']) {
      const sel = d.getElementById(id);
      assert.ok(sel, `${id} exists`);
      const groups = [...sel.querySelectorAll('optgroup')].map(g => g.label);
      assert.deepEqual(groups, ['Daily plan', 'Other'], `${id} is grouped`);

      const inPlan = [...sel.querySelector('optgroup[label="Daily plan"]').children]
        .map(o => o.value);
      // The full plan first, then the four variants that stack on it.
      assert.deepEqual(inPlan,
        ['print', 'fiveminute', 'recurrent', 'novel', 'mutashabihat', 'topclusters']);
      const inOther = [...sel.querySelector('optgroup[label="Other"]').children].map(o => o.value);
      assert.ok(inOther.includes('general') && inOther.includes('clusterdive'));

      // Every option offered must actually resolve — setAgentPromptPreset()
      // silently falls back to 'general' otherwise.
      for (const o of sel.options) {
        sel.value = o.value;
        sel.dispatchEvent(new w.Event('change'));
        assert.equal(w.getAgentPromptPreset(), o.value, `${o.value} is offered but does not stick`);
      }
    }
  } finally { w.fetch = realFetch; w.setAgentPromptPreset('print'); }

  // Today's Plan sends this exact preset, so the name has to match what the
  // plan is called everywhere else in the app.
  const label = [...d.getElementById('mob-agent-preset').options]
    .find(o => o.value === 'print').textContent;
  assert.equal(label, 'Daily Plan');
  assert.ok((await w.buildFullAgentPayloadText()).startsWith('Prompt: Daily Plan'));
});

test('every home card collapses from a caret in its top-right corner', async () => {
  const d = w.document;
  w.localStorage.removeItem('quranMobCollapsedCards');
  w.initMobCardCollapse();

  const cards = [...d.querySelectorAll('#mobile-home .mob-action-card[data-card]')];
  assert.deepEqual(cards.map(c => c.dataset.card),
    ['hizb', 'daily', 'drill', 'mutashabihat', 'import', 'mushaf', 'prompts'],
    'every real card carries a stable key, so renaming one cannot reset the view');

  for (const card of cards) {
    const actions = card.querySelector(':scope > .mob-card-actions');
    assert.ok(actions, `${card.dataset.card} has top-right controls`);
    const caret = actions.querySelector('.mob-card-collapse');
    assert.ok(caret, `${card.dataset.card} has a caret`);
    // Outside .mob-action-btn, which is itself a <button> and cannot nest one.
    assert.equal(caret.closest('.mob-action-btn'), null);
    assert.equal(caret.textContent, '▾');
    assert.equal(caret.getAttribute('aria-expanded'), 'true');

    caret.click();
    assert.ok(card.classList.contains('is-card-collapsed'));
    assert.equal(caret.textContent, '▸');
    assert.equal(caret.getAttribute('aria-expanded'), 'false');
    caret.click();
    assert.ok(!card.classList.contains('is-card-collapsed'));
  }

  // Collapsed cards persist — a card you put away should stay away across a
  // reload, unlike a strength band, which is within-session working state.
  w.mobToggleCard('prompts');
  w.mobToggleCard('import');
  assert.deepEqual(JSON.parse(w.localStorage.getItem('quranMobCollapsedCards')).sort(),
    ['import', 'prompts']);
  w.initMobCardCollapse();
  assert.ok(d.querySelector('[data-card="prompts"]').classList.contains('is-card-collapsed'));
  assert.ok(!d.querySelector('[data-card="daily"]').classList.contains('is-card-collapsed'));

  // ...and it is local only. Syncing one device's collapsed view to every
  // other is exactly what _mobDailyCollapsedGroups' own comment warns off.
  assert.ok(!JSON.stringify(w.buildSyncPayload()).includes('quranMobCollapsedCards'));
  assert.ok(!JSON.stringify(w.buildSyncPayload()).includes('collapsedCards'));

  // Injection is idempotent — it runs from every home render.
  w.initMobCardCollapse();
  w.initMobCardCollapse();
  for (const card of cards)
    assert.equal(card.querySelectorAll(':scope > .mob-card-actions').length, 1);

  w.localStorage.removeItem('quranMobCollapsedCards');
  w.initMobCardCollapse();
});

test("the plan's Expand all sits beside the card caret, not in the plan head", async () => {
  const d = w.document;
  w.localStorage.setItem('quranReviewDailyPlan', JSON.stringify({
    date: new Date().toDateString(),
    clusters: [{ id: 'c1', ref: '2:27-2:29', strength: 'vw', targetReps: 5 }],
  }));
  w.initMobCardCollapse();
  await w.renderMobDailyInline(w.loadDailyPlan());

  const actions = d.querySelector('[data-card="daily"] > .mob-card-actions');
  const bandBtn = actions.querySelector('.mdp-collapse-all');
  assert.ok(bandBtn, 'in the card controls');
  assert.equal(d.querySelector('#mob-daily-plan-inline .mdp-collapse-all'), null,
    'and no longer in the plan head');
  // Left of the caret: it acts on the card's CONTENTS, the caret on the card.
  assert.ok(bandBtn.compareDocumentPosition(actions.querySelector('.mob-card-collapse'))
    & w.Node.DOCUMENT_POSITION_FOLLOWING);
  // Only Today's Plan has bands to collapse, so only it gets the second control.
  for (const key of ['hizb', 'drill', 'import', 'mushaf', 'prompts'])
    assert.equal(d.querySelector(`[data-card="${key}"] .mdp-collapse-all`), null);

  // A plan with no clusters leaves the slot empty rather than offering a
  // control with nothing to act on.
  await w.renderMobDailyInline({ date: new Date().toDateString(), clusters: [] });
  assert.equal(actions.querySelector('.mdp-collapse-all'), null);
  w.localStorage.removeItem('quranReviewDailyPlan');
});

test('a short viewport hands the mushaf back its chrome', () => {
  // A 645x1000 page is bound by viewport HEIGHT, so in landscape the spread
  // renders small while most of the screen sits empty either side. Width is
  // not the lever; the chrome is.
  const css = require('fs').readFileSync('review.html', 'utf8');
  const block = css.slice(css.indexOf('@media (max-height: 640px)'));
  const rules = block.slice(0, block.indexOf('\n    }\n') + 7);

  // The allowance is what actually decides the size, so pin it.
  assert.match(rules, /#mushaf-overlay \.mushaf-spread \{ --mushaf-chrome: 92px; \}/);
  assert.match(rules, /has-walk \.mushaf-spread \{ --mushaf-chrome: 134px; \}/);

  // Every row that the allowance is made of must ALSO shrink, or the number
  // is a lie and the spread runs off the bottom. This is the list from the
  // comment above the block, and the walk bar's extra row.
  for (const sel of ['.mushaf-overlay-inner', '.mushaf-overlay-head',
                     '.mushaf-page-nav', '.mushaf-page-col', '.mushaf-col-head'])
    assert.ok(rules.includes(sel), `${sel} keeps its full-height styling`);

  // The allowance must stay below the normal one, or the query does nothing.
  const normal = Number(css.match(/#mushaf-overlay \.mushaf-spread \{\s*--mushaf-chrome: (\d+)px/)[1]);
  assert.ok(92 < normal, `92px is not a saving against ${normal}px`);

  // And the height cap itself must still be what sizes the spread — the
  // whole point is that no width cap gets to override it here.
  assert.match(css, /#mushaf-overlay \.mushaf-spread \{[^}]*max-width: calc\(\(100vh - var\(--mushaf-chrome\)\) \* 1\.29/);
});

test('Top N Clusters: the number reaches the model, and only this mode', async () => {
  const d = w.document;
  const realFetch = w.fetch;
  try {
    const md = require('fs').readFileSync('agent-prompts/prompts.md', 'utf8');
    w.fetch = async () => ({ ok: true, text: async () => md });
    await w.loadAgentPromptFiles();

    // It is a plan DELTA, so it carries Print's whole rule set and template
    // and overrides only how many clusters come back.
    const p = w.agentPromptForSending('topclusters');
    assert.ok(p.includes('OUTPUT TEMPLATE'), 'inherits the Print rules');
    assert.ok(p.includes('Return exactly N clusters'), 'and its own override');

    // The count is APPENDED, not substituted into a placeholder — editing the
    // prompt text must not be able to silently detach it.
    w.saveTopClustersN(7);
    assert.ok(w.agentPromptForSending('topclusters').endsWith('TOP CLUSTERS REQUESTED: 7'));
    w.localStorage.setItem('quranReviewAgentPromptOverrides',
      JSON.stringify({ topclusters: 'my own wording with no placeholder' }));
    assert.ok(w.agentPromptForSending('topclusters').endsWith('TOP CLUSTERS REQUESTED: 7'),
      'an override still gets the count');
    w.localStorage.removeItem('quranReviewAgentPromptOverrides');

    // No other preset gets the line.
    for (const id of ['print', 'fiveminute', 'general', 'clusterdive'])
      assert.ok(!w.agentPromptForSending(id).includes('TOP CLUSTERS REQUESTED'), id);

    // And the EDITOR must never see it: getEffectiveAgentPrompt() feeds the
    // textarea, and saving an appended count would store it as a permanent
    // override with a stale N baked in.
    // (The prompt TEXT mentions the line to explain the contract; what must
    // not be there is a concrete count appended to the end.)
    w.setAgentPromptPreset('topclusters');
    assert.ok(!/TOP CLUSTERS REQUESTED: \d+\s*$/.test(w.getEffectiveAgentPrompt()));
    assert.ok(/TOP CLUSTERS REQUESTED: \d+$/.test(w.agentPromptForSending('topclusters')));
    w.setAgentPromptPreset('print');
  } finally { w.fetch = realFetch; }

  // Clamped, not rejected — there is no way to mistype a count into something
  // worth an alert.
  assert.equal(w.saveTopClustersN(99), 30);
  assert.equal(w.saveTopClustersN(0), 1);
  assert.equal(w.saveTopClustersN('nonsense'), 5);
  assert.equal(w.getTopClustersN(), 5);

  // The box shows only for the mode that takes a parameter, and mirrors the
  // stored value whenever the mode changes.
  w.saveTopClustersN(9);
  w.setAiReviewMode('topclusters');
  assert.notEqual(d.getElementById('ai-review-topn-wrap').style.display, 'none');
  assert.equal(d.getElementById('ai-review-topn').value, '9');
  w.setAiReviewMode('fiveminute');
  assert.equal(d.getElementById('ai-review-topn-wrap').style.display, 'none');
  w.setAiReviewMode('clusterdive');
  assert.equal(d.getElementById('ai-review-topn-wrap').style.display, 'none');

  // A per-run number, not a setting about the user's memorization — so local,
  // like the heatmap scope, and out of the sync payload.
  assert.ok(!JSON.stringify(w.buildSyncPayload()).includes('topClusters'));
  w.localStorage.removeItem('quranReviewTopClustersN');
  w.setAiReviewMode('fiveminute');
});

test('mobile Mutashabihat: an ayah, and what it is confused with, as spreads', async () => {
  // Confusable ayat are told apart largely by WHERE they sit — which page,
  // which side, how far down — so this shows the mushaf spread rather than a
  // text column, reusing the desktop compare view's own renderer.
  const d = w.document;
  const realFetch = w.fetchSurahData;
  w.fetchSurahData = async (n) => ({
    surahInfo: { number: n, englishName: 'Al-Baqara', name: 'البقرة' },
    arabicAyahs: Array.from({ length: 286 }, (_, i) => ({ numberInSurah: i + 1, text: `ayah ${i + 1}` })),
    transAyahs: Array.from({ length: 286 }, (_, i) => ({ numberInSurah: i + 1, text: `t ${i + 1}` })),
  });
  try {
    w.localStorage.setItem('quranReviewMutashabihatPairs', JSON.stringify([
      { id: 'g1', anchor: { surah: 2, ayah: 144 },
        confusables: [{ surah: 2, ayah: 149 }, { surah: 2, ayah: 150 }], note: 'qibla set' },
      { id: 'g2', anchor: { surah: 2, ayah: 40 }, confusables: [{ surah: 2, ayah: 47 }], note: '' },
    ]));

    // Both roles count: an ayah added as someone else's confusable is just as
    // confusable from its own side.
    assert.equal(w.mutashabihatGroupsForAyah(2, 144).length, 1, 'as the anchor');
    assert.equal(w.mutashabihatGroupsForAyah(2, 149).length, 1, 'as a confusable');
    assert.equal(w.mutashabihatGroupsForAyah(2, 3).length, 0);

    w.renderMobMutashabihatCard();
    assert.match(d.getElementById('mob-mut-sub').textContent, /2 groups saved/);
    // Tap-to-open shortcuts, so the card works without typing a ref.
    const chips = [...d.querySelectorAll('#mob-mut-chips .mob-mut-chip')];
    assert.deepEqual(chips.map(c => c.textContent.trim()), ['2:144 +2', '2:40 +1']);

    await w.mobShowMutashabihat(2, 149);
    const out = d.getElementById('mob-mut-result');
    assert.equal(out.querySelectorAll('.mushaf-spread').length, 3, 'one spread per ayah');
    assert.match(out.textContent, /qibla set/, 'the group note rides along');
    // The column you asked about is marked, or a stack of near-identical
    // spreads gives no way to tell where you started.
    assert.deepEqual([...out.querySelectorAll('.mut-col-tag')].map(e => e.textContent),
      ['anchor', 'you asked']);
    assert.match(d.getElementById('mob-mut-status').textContent, /2:149 — 1 group/);
    // One row of layer checkboxes per group, not one per spread.
    assert.equal(out.querySelectorAll('.mushaf-spread-layers').length, 1);

    // The fields follow a chip tap, so Show re-runs the same lookup.
    assert.equal(d.getElementById('mob-mut-surah').value, '2');
    assert.equal(d.getElementById('mob-mut-ayah').value, '149');

    // An empty answer is a real one, and needs a way forward — this card is
    // where you notice two ayat blur together.
    await w.mobShowMutashabihat(2, 3);
    assert.equal(out.innerHTML, '');
    const empty = d.getElementById('mob-mut-status');
    assert.match(empty.textContent, /Nothing saved for 2:3/);
    assert.ok(empty.querySelector('button'), 'and offers somewhere to add one');

    // Validated against the surah's real ayah count, like every other entry
    // point in this app, rather than rendering a blank spread.
    await w.mobShowMutashabihat(2, 999);
    assert.match(d.getElementById('mob-mut-status').textContent, /no ayah 999/);
    await w.mobShowMutashabihat(2, NaN);
    assert.match(d.getElementById('mob-mut-status').textContent, /Pick a surah/);
  } finally {
    w.fetchSurahData = realFetch;
    w.localStorage.removeItem('quranReviewMutashabihatPairs');
  }
});
