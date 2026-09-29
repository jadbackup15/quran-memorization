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
