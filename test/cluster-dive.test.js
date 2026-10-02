'use strict';

// Cluster Deep Dive (review.html) — a WEEKLY plan, deliberately unlike Today's
// Plan. It lists EVERY cluster that has been stuck for weeks, ranked, and
// drills them one at a time until they stop recurring — the list is a queue
// worked top-down, not a simultaneous commitment, which is why it is uncapped.
// Its template, parser and state are all separate from the daily plan's.

const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { loadPage } = require('./helpers/loadPage.js');

const toPlain = (v) => JSON.parse(JSON.stringify(v));

const AI_RESPONSE = `
🔬 Deep Dive

☐ Cluster 2:11-19 — 10× daily for 7 days
Why: missed on 8 separate days since July, always at the transition into 2:14.

☐ Cluster 2:100-108 — 15× daily for 10 days
Why: six distinct days over two months; the ending keeps merging with 2:109.

**Order of attack**
Start with 2:11-19.
`;

let w;
before(async () => { w = (await loadPage('review.html')).window; });

// ── Parsing ────────────────────────────────────────────────────────────────

test('parses ref, reps per day, duration and reason from the template', () => {
  const plan = w.parseClusterDiveFromAiResponse(AI_RESPONSE);
  assert.equal(plan.clusters.length, 2);
  assert.deepEqual(toPlain(plan.clusters.map(c => [c.ref, c.repsPerDay, c.days])),
    [['2:11-19', 10, 7], ['2:100-108', 15, 10]]);
  assert.match(plan.clusters[0].reason, /8 separate days since July/);
  assert.match(plan.clusters[1].reason, /merging with 2:109/);
});

test('starts focused on one cluster — the mode is explicitly one at a time', () => {
  const plan = w.parseClusterDiveFromAiResponse(AI_RESPONSE);
  assert.equal(plan.activeId, plan.clusters[0].id);
});

test('accepts the punctuation a model actually varies', () => {
  const variants = [
    '☐ Cluster 2:11-19 — 10× daily for 7 days',
    '☐ Cluster 2:11–19 - 10x daily for 7 day',
    '☐  Cluster  2:11 - 19  —  10 × daily for 7 days',
  ];
  for (const line of variants) {
    const plan = w.parseClusterDiveFromAiResponse(line);
    assert.equal(plan.clusters[0].ref, '2:11-19', `failed on: ${line}`);
    assert.equal(plan.clusters[0].repsPerDay, 10);
    assert.equal(plan.clusters[0].days, 7);
  }
});

test('a cluster with no Why line still parses', () => {
  const plan = w.parseClusterDiveFromAiResponse(
    '☐ Cluster 2:11-19 — 10× daily for 7 days\n☐ Cluster 3:1-9 — 5× daily for 5 days');
  assert.equal(plan.clusters.length, 2);
  assert.equal(plan.clusters[0].reason, '', 'must not steal the NEXT cluster\'s reason');
});

test('rejects a daily-plan response rather than silently saving nothing', () => {
  // The two templates are different on purpose; pasting the wrong one should
  // say so, not produce an empty plan that looks like the AI found nothing.
  assert.throws(
    () => w.parseClusterDiveFromAiResponse('🔴 Very Weak\n☐ Cluster 2:81-88: Practice 10 times'),
    /must use/);
  assert.throws(() => w.parseClusterDiveFromAiResponse(''), /No clusters found/);
});

// ── Progress ───────────────────────────────────────────────────────────────

test('clusterDiveDates covers exactly the run, from the start date', () => {
  const plan = { startDate: '2026-09-24', clusters: [] };
  const dates = w.clusterDiveDates(plan, { days: 3 });
  assert.deepEqual(toPlain(dates), ['2026-09-24', '2026-09-25', '2026-09-26']);
});

test('progress counts days and reps separately', () => {
  // Both matter and they differ: 3 heavy days is not the same as 7 light ones,
  // which is the whole reason the log stores a COUNT rather than a tick.
  const plan = { startDate: '2026-09-24', clusters: [] };
  const cluster = { repsPerDay: 10, days: 7, log: { '2026-09-24': 12, '2026-09-25': 8 } };
  const p = w.clusterDiveProgress(plan, cluster);
  assert.equal(p.daysDone, 2);
  assert.equal(p.repsDone, 20);
  assert.equal(p.repsTarget, 70);
  assert.equal(p.donePct, 29);
});

test('progress ignores reps logged outside the run', () => {
  const plan = { startDate: '2026-09-24', clusters: [] };
  const cluster = { repsPerDay: 10, days: 2, log: { '2026-09-24': 10, '2026-10-30': 99 } };
  const p = w.clusterDiveProgress(plan, cluster);
  assert.equal(p.daysDone, 1);
  assert.equal(p.repsDone, 10, 'a stray date must not inflate the run');
});

// ── State and rendering ────────────────────────────────────────────────────

test('logs the reps ACTUALLY done, not the prescribed number', async () => {
  const plan = w.parseClusterDiveFromAiResponse(AI_RESPONSE);
  await w.saveClusterDivePlan(plan);
  const today = w.clusterDiveToday();

  const realPrompt = w.prompt;
  try {
    w.prompt = () => '12';                 // prescribed 10, managed 12
    w.logClusterDiveDay('1', today);
    assert.equal(w.loadClusterDivePlan().clusters[0].log[today], 12);

    w.prompt = () => '0';                  // 0 clears the day
    w.logClusterDiveDay('1', today);
    assert.deepEqual(toPlain(w.loadClusterDivePlan().clusters[0].log), {});

    w.prompt = () => null;                 // cancelled — no change
    w.logClusterDiveDay('1', today);
    assert.deepEqual(toPlain(w.loadClusterDivePlan().clusters[0].log), {});
  } finally { w.prompt = realPrompt; }
});

test('a future day cannot be logged', async () => {
  const plan = w.parseClusterDiveFromAiResponse(AI_RESPONSE);
  await w.saveClusterDivePlan(plan);
  const realPrompt = w.prompt;
  try {
    w.prompt = () => '10';
    w.logClusterDiveDay('1', '2099-01-01');
    assert.deepEqual(toPlain(w.loadClusterDivePlan().clusters[0].log), {},
      'logging reps for a day that has not happened is meaningless');
  } finally { w.prompt = realPrompt; }
});

test('renders one card per cluster, one focused, with a box per day', async () => {
  const d = w.document;
  w.setView('daily');
  w.setReviewSubview('clusterdive');
  await w.saveClusterDivePlan(w.parseClusterDiveFromAiResponse(AI_RESPONSE));

  assert.equal(d.querySelectorAll('.cdd-card').length, 2);
  assert.equal(d.querySelectorAll('.cdd-card.is-active').length, 1, 'exactly one focus');
  assert.equal(d.querySelectorAll('.cdd-day').length, 17, '7 + 10 days');
  // Future days are inert — no click handler at all, not just a disabled look.
  const future = [...d.querySelectorAll('.cdd-day.future')];
  assert.ok(future.length > 0);
  assert.ok(future.every(el => !el.getAttribute('onclick')));
  // Each cluster is a real ayah range, so the mushaf opens on it.
  assert.equal(d.querySelectorAll('.cdd-card .mdp-mushaf-btn').length, 2);
});

test('focus moves between clusters', async () => {
  await w.saveClusterDivePlan(w.parseClusterDiveFromAiResponse(AI_RESPONSE));
  w.setClusterDiveActive('2');
  assert.equal(w.loadClusterDivePlan().activeId, '2');
});

test('the plan syncs, and discarding clears it', async () => {
  await w.saveClusterDivePlan(w.parseClusterDiveFromAiResponse(AI_RESPONSE));
  assert.equal(w.buildSyncPayload().review.clusterDivePlan.clusters.length, 2);

  const realConfirm = w.confirm;
  try {
    w.confirm = () => false;
    w.discardClusterDive();
    assert.ok(w.loadClusterDivePlan(), 'declining the confirm keeps the plan');
    w.confirm = () => true;
    w.discardClusterDive();
    assert.equal(w.loadClusterDivePlan(), null);
  } finally { w.confirm = realConfirm; }
  assert.match(w.document.getElementById('cdd-content').innerHTML, /No deep dive running/);
});

test('Cluster Deep Dive is a dropdown MODE, but never an AI_REVIEW_STYLES member', () => {
  // It shares the AI Review tab, but it is not a text style: AI_REVIEW_STYLES
  // is what getAiReviewStyle() validates against and what runAiReview()
  // assumes it can treat as text, so admitting it there would store a tracked
  // plan where a one-off review result belongs.
  const modes = [...w.document.querySelectorAll('#ai-review-style option')].map(o => o.value);
  assert.ok(modes.includes('clusterdive'), 'offered in the dropdown');
  // AI_REVIEW_STYLES is a top-level const, so it is not on window (see
  // CLAUDE.md's Tests section) — check the behaviour it drives instead.
  w.saveAiReviewStyle('clusterdive');
  assert.notEqual(w.getAiReviewStyle(), 'clusterdive',
    'saveAiReviewStyle rejects it, so it can never become a text style');
});

test('switching modes swaps the actions and the output area', () => {
  const d = w.document;
  w.setView('daily');
  w.setReviewSubview('aireview');

  w.setAiReviewMode('clusterdive');
  assert.equal(d.getElementById('ai-review-cdd-actions').style.display, 'flex');
  assert.equal(d.getElementById('ai-review-text-actions').style.display, 'none');
  assert.equal(d.getElementById('cdd-content').style.display, 'block');
  assert.equal(d.getElementById('ai-review-output').style.display, 'none');

  // An empty result stays hidden, so give it one to show.
  w.localStorage.setItem('quranReviewAiReviewResult', 'some review text');
  w.setAiReviewMode('novel');
  assert.equal(d.getElementById('ai-review-text-actions').style.display, 'flex');
  assert.equal(d.getElementById('ai-review-cdd-actions').style.display, 'none');
  assert.notEqual(d.getElementById('ai-review-output').style.display, 'none');
  assert.equal(d.getElementById('cdd-content').style.display, 'none');
  w.localStorage.removeItem('quranReviewAiReviewResult');
});

test('picking the deep dive does not overwrite the chosen text style', () => {
  // The two settings are independent: coming back from the deep dive should
  // land on the style you were last using, not reset it.
  w.setAiReviewMode('recurrent');
  assert.equal(w.getAiReviewStyle(), 'recurrent');
  w.setAiReviewMode('clusterdive');
  assert.equal(w.getAiReviewStyle(), 'recurrent', 'text style survives');
  assert.equal(w.getAiReviewMode(), 'clusterdive', 'but the mode is the deep dive');
});

test('the Chat box toggles open inside AI Review', () => {
  const d = w.document;
  w.setView('daily');
  w.setReviewSubview('aireview');
  const wrap = d.getElementById('ai-review-chat-wrap');
  assert.equal(wrap.style.display, 'none', 'collapsed by default');
  w.toggleAiReviewChat();
  assert.equal(wrap.style.display, 'block');
  assert.ok(wrap.querySelector('#agent-chat-messages'));
  assert.match(d.getElementById('ai-review-chat-btn').textContent, /Hide Chat/);
  w.toggleAiReviewChat();
  assert.equal(wrap.style.display, 'none');
});

test('the AI Review row carries the two include toggles', () => {
  // A third mirrored copy of Today's Plan's pair, not new state — and both
  // resolve to the same underlying agent include flag.
  const d = w.document;
  assert.ok(d.getElementById('air-include-attention'));
  assert.ok(d.getElementById('air-include-practice'));
  w.saveDailyIncludeFlag('quranReviewDailyIncludeAttention', false);
  assert.equal(d.getElementById('air-include-attention').checked, false);
  assert.equal(d.getElementById('daily-include-attention').checked, false, 'stays in step');
  assert.equal(w.getAgentIncludeFlag('attention'), false, 'one flag underneath');
  w.saveDailyIncludeFlag('quranReviewDailyIncludeAttention', true);
});

// ── Uncapped list, and the empty case ──────────────────────────────────────

test('parses an arbitrarily long list — the list is deliberately uncapped', () => {
  // It is a ranked QUEUE the user works top-down, not a week's simultaneous
  // load, so trimming it would hide real work rather than reduce effort.
  const lines = ['🔬 Deep Dive', ''];
  for (let i = 0; i < 12; i++) {
    lines.push(`☐ Cluster 2:${10 + i * 12}-${18 + i * 12} — 10× daily for 7 days`);
    lines.push(`Why: stuck cluster ${i + 1}.`);
    lines.push('');
  }
  const plan = w.parseClusterDiveFromAiResponse(lines.join('\n'));
  assert.equal(plan.clusters.length, 12);
  assert.equal(plan.activeId, plan.clusters[0].id, 'focus starts at the top of the queue');
});

test('"NOTHING STUCK" is a valid answer, not a parse failure', () => {
  // Distinguishing "nothing qualifies" from "malformed response" matters: the
  // first is good news and the second needs the user to retry.
  const plan = w.parseClusterDiveFromAiResponse(
    '🔬 Deep Dive\n\nNOTHING STUCK\n\nEvery recurring cluster has been clean for three weeks.');
  assert.deepEqual(toPlain(plan.clusters), []);
  assert.equal(plan.activeId, null);
  assert.match(plan.note, /clean for three weeks/);
  assert.ok(plan.startDate, 'still a real plan object, so it saves and syncs');
});

test('an empty plan renders as "nothing stuck", not as "no plan"', async () => {
  const d = w.document;
  w.setView('daily');
  w.setReviewSubview('clusterdive');
  await w.saveClusterDivePlan(w.parseClusterDiveFromAiResponse(
    'NOTHING STUCK\n\nYour daily plan is keeping up.'));
  const html = d.getElementById('cdd-content').innerHTML;
  assert.match(html, /Nothing stuck right now/);
  assert.match(html, /keeping up/, 'the reasoning is kept, not discarded');
  assert.doesNotMatch(html, /No deep dive running/, 'that is the never-generated state');
});

test('a malformed response still throws, even now that empty is allowed', () => {
  // Widening the parser must not turn a wrong-template paste into a silent
  // empty plan — that would look identical to "nothing stuck" and be wrong.
  assert.throws(() => w.parseClusterDiveFromAiResponse('some prose with no markers'), /No clusters found/);
  assert.throws(
    () => w.parseClusterDiveFromAiResponse('🔴 Very Weak\n☐ Cluster 2:81-88: Practice 10 times'),
    /No clusters found/);
});

// ── Cluster size ceiling ───────────────────────────────────────────────────

test('clusterDiveAyahCount counts a ref inclusively', () => {
  assert.equal(w.clusterDiveAyahCount('2:11-19'), 9);
  assert.equal(w.clusterDiveAyahCount('2:11-25'), 15);
  assert.equal(w.clusterDiveAyahCount('2:255'), 1, 'a single ayah is one');
  assert.equal(w.clusterDiveAyahCount('nonsense'), null, 'unparseable, not zero');
});

test('the 15-ayah ceiling matches the app\'s own clustering cap', () => {
  // mistake-analytics.js caps algorithmic clusters at REVISION_CLUSTER_MAX_SPAN.
  // The AI and the algorithm must not disagree about how long a reviewable
  // passage can be, so these two numbers are deliberately the same.
  const { extractConst } = require('./helpers/extractConst.js');
  const span = extractConst('mistake-analytics.js', 'REVISION_CLUSTER_MAX_SPAN');
  assert.equal(span, 15);
});

test('an overlong cluster is flagged, not silently accepted', async () => {
  // The ceiling lives in the prompt, so the model can ignore it. Showing the
  // count and flagging a breach is what keeps that visible.
  const d = w.document;
  w.setView('daily');
  w.setReviewSubview('clusterdive');
  await w.saveClusterDivePlan(w.parseClusterDiveFromAiResponse([
    '☐ Cluster 2:11-19 — 10× daily for 7 days',
    '☐ Cluster 2:100-114 — 10× daily for 7 days',
    '☐ Cluster 2:200-219 — 20× daily for 14 days',
  ].join('\n')));

  const cards = [...d.querySelectorAll('.cdd-card')];
  assert.equal(cards.length, 3);
  assert.ok(!cards[0].querySelector('.cdd-badge.warn'), '9 ayat is fine');
  assert.ok(!cards[1].querySelector('.cdd-badge.warn'), '15 is the inclusive ceiling');
  assert.ok(cards[2].querySelector('.cdd-badge.warn'), '20 is over and must be flagged');
  // The count is always shown, flagged or not, so the size is never a mystery.
  assert.match(cards[0].querySelector('.cdd-dose').textContent, /9 ayat/);
  assert.match(cards[2].querySelector('.cdd-dose').textContent, /20 ayat/);
});

// ── Revise range selector and the cue-growing control ──────────────────────

test('Select Range is a dropdown, and Agent Recs is gone', () => {
  const d = w.document;
  const opts = [...d.querySelectorAll('#revise-mode-select option')].map(o => o.value);
  assert.deepEqual(opts, ['hizb', 'surah', 'juz', 'page']);
  assert.equal(d.getElementById('panel-agent-recs'), null);
  assert.equal(typeof w.renderAgentRecsPanel, 'undefined');

  // setMode still drives the panels, and keeps the <select> in step when it is
  // called programmatically (restoring saved settings, not just on change).
  w.setView('revise');
  w.setMode('juz');
  assert.equal(d.getElementById('revise-mode-select').value, 'juz');
  assert.ok(d.getElementById('panel-juz').classList.contains('active'));
  assert.notEqual(d.getElementById('weight-wrap').style.display, 'none');
  w.setMode('page');
  assert.equal(d.getElementById('weight-wrap').style.display, 'none', 'weighting is meaningless per-page');
});

test('the Mushaf Drill can reveal one more cue word at a time', async () => {
  const d = w.document;
  const prev = w.fetchSurahData;
  w.fetchSurahData = async n => ({
    surahInfo: { number: n, englishName: 'S', name: 'س' },
    arabicAyahs: Array.from({ length: 286 }, (_, i) => ({ numberInSurah: i + 1, text: 'w1 w2 w3 w4 w5' })),
    transAyahs: Array.from({ length: 286 }, (_, i) => ({ numberInSurah: i + 1, text: 't' })),
  });
  try {
    w.localStorage.setItem('quranReviewMemorizedHizbs', JSON.stringify([1, 2, 3]));
    w.setView('revise');
    w.setReviseSubview('tester');
    d.getElementById('tester-words').value = '2';
    await w.nextTesterQuestion();
    await new Promise(r => setTimeout(r, 60));

    const cue = () => d.querySelector('.tester-cue').textContent.trim();
    assert.equal(cue(), 'w1 w2');
    w.showOneMoreCueWord();
    assert.equal(cue(), 'w1 w2 w3', 'one word, not the whole ayah');
    w.showOneMoreCueWord();
    assert.equal(cue(), 'w1 w2 w3 w4');

    // Cannot be tapped into revealing the whole answer indefinitely.
    for (let i = 0; i < 10; i++) w.showOneMoreCueWord();
    assert.equal(cue(), 'w1 w2 w3 w4 w5');
    const btn = [...d.querySelectorAll('button')].find(b => /One more word/.test(b.textContent));
    assert.ok(btn.disabled);

    // A fresh question starts from the configured cue length again.
    await w.nextTesterQuestion();
    await new Promise(r => setTimeout(r, 60));
    assert.equal(cue(), 'w1 w2');
  } finally { w.fetchSurahData = prev; }
});

test('More has no empty Settings sub-tab', () => {
  const subs = [...w.document.querySelectorAll('#view-more .log-subtab')].map(b => b.dataset.subview);
  assert.deepEqual(subs, ['print', 'backup']);
  assert.equal(w.document.getElementById('more-subview-settings'), null);
});

// ── "Page ahead": pair an ayah with the same position a page later ─────────

const pagedSurah = (n) => ({
  surahInfo: { number: n, englishName: 'Al-Baqara', name: 'البقرة' },
  // 8 ayat per page, so 2:17 opens page 4 and 2:20 is its 4th ayah.
  arabicAyahs: Array.from({ length: 286 }, (_, i) => ({
    numberInSurah: i + 1, text: `ayah ${i + 1}`, page: 2 + Math.floor(i / 8),
  })),
  transAyahs: Array.from({ length: 286 }, (_, i) => ({ numberInSurah: i + 1, text: `t${i + 1}` })),
});

test('desktop "Page ahead" keeps a mid-page anchor and lands mid-page', async () => {
  const d = w.document;
  const prev = w.fetchSurahData;
  w.fetchSurahData = async n => pagedSurah(n);
  try {
    w.setView('revise');
    const shown = () => [...d.querySelectorAll('#res-arabic .ayah-line')].map(e => +e.dataset.ayahNum);
    d.getElementById('length-unit').value = 'pageahead';
    d.getElementById('length-count').value = '1';

    // 2:20 is the 4th ayah of page 4 → the 4th ayah of page 5 is 2:28.
    await w.displayAyah(2, 20);
    assert.deepEqual(toPlain(shown()), [20, 28],
      'the anchor must NOT snap to the page start — that is what this mode avoids');

    // A page-start anchor still behaves sensibly.
    await w.displayAyah(2, 17);
    assert.deepEqual(toPlain(shown()), [17, 25]);

    // Count is a page distance here.
    d.getElementById('length-count').value = '2';
    await w.displayAyah(2, 20);
    assert.deepEqual(toPlain(shown()), [20, 36]);
  } finally { w.fetchSurahData = prev; }
});

test('desktop "Pages" still snaps to the page start', async () => {
  const d = w.document;
  const prev = w.fetchSurahData;
  w.fetchSurahData = async n => pagedSurah(n);
  try {
    w.setView('revise');
    d.getElementById('length-unit').value = 'page';
    d.getElementById('length-count').value = '1';
    await w.displayAyah(2, 20);
    const shown = [...d.querySelectorAll('#res-arabic .ayah-line')].map(e => +e.dataset.ayahNum);
    assert.equal(shown[0], 17, 'page mode anchors on the page opening, unchanged');
  } finally { w.fetchSurahData = prev; }
});

test('mobile Revise offers both modes, and they differ', async () => {
  const d = w.document;
  const prev = w.fetchSurahData, realRandom = w.Math.random;
  w.fetchSurahData = async n => pagedSurah(n);
  w.Math.random = () => 0.5;            // pin the draw; mobDoRevise picks randomly
  try {
    w.localStorage.setItem('quranReviewMemorizedHizbs', JSON.stringify([1, 2, 3]));
    w.mobShowHome();
    const refs = () => [d.getElementById('mob-ref-1').textContent, d.getElementById('mob-ref-2').textContent];

    w.setMobReviseMode('pagestart');
    await w.mobDoRevise();
    await new Promise(r => setTimeout(r, 80));
    const [startA, startB] = refs();

    w.setMobReviseMode('pageahead');
    await w.mobDoRevise();
    await new Promise(r => setTimeout(r, 80));
    const [aheadA, aheadB] = refs();

    assert.notEqual(startA, aheadA, 'page-ahead does not snap, so it starts elsewhere');
    // Both pair an ayah with one exactly a page later.
    for (const [a, b] of [[startA, startB], [aheadA, aheadB]]) {
      const [, x] = a.split(':').map(Number);
      const [, y] = b.split(':').map(Number);
      assert.equal(y - x, 8, `${a} → ${b} should be one 8-ayah page apart`);
    }
    assert.equal(d.querySelector('#mob-revise-mode .memtest-nav-btn.active').dataset.rmode, 'pageahead');
  } finally { w.fetchSurahData = prev; w.Math.random = realRandom; w.setMobReviseMode('pagestart'); }
});

test('mobile plan strength bands collapse independently', async () => {
  const d = w.document;
  w.localStorage.setItem('quranReviewDailyPlan', JSON.stringify({
    date: new Date().toISOString().slice(0, 10),
    clusters: [
      { id: '1', ref: '2:10-2:17', strength: 'vw', targetReps: 10, done: true, reps: 10 },
      { id: '2', ref: '2:21-2:30', strength: 'vw', targetReps: 10, done: false },
      { id: '3', ref: '2:39-2:44', strength: 'w', targetReps: 15, done: false },
    ],
  }));
  w.mobShowHome();
  await new Promise(r => setTimeout(r, 80));
  const el = () => d.getElementById('mob-daily-plan-inline');
  const rows = () => el().querySelectorAll('.mdp-row').length;

  assert.equal(el().querySelectorAll('.mdp-group-toggle').length, 2);
  // Each band shows its own done/total, so a collapsed band still reports.
  assert.deepEqual(toPlain([...el().querySelectorAll('.mdp-group-count')].map(e => e.textContent.trim())),
    ['1/2', '0/1']);

  assert.equal(rows(), 3);
  w.mobToggleDailyGroup('vw');
  await new Promise(r => setTimeout(r, 40));
  assert.equal(rows(), 1, 'only the collapsed band hides');
  w.mobToggleDailyGroup('vw');
  await new Promise(r => setTimeout(r, 40));
  assert.equal(rows(), 3);
});

test('"Page ahead" is not derailed by a mistake-triggered lead-in', async () => {
  // Five branches keyed off the unit mean "two landmarks are shown". The two
  // lead-in guards were missed at first: an ayah with past mistakes backs the
  // anchor up two ayat, which would compute the page-offset pairing from the
  // WRONG ayah — a silently wrong answer, not a visible error.
  const d = w.document;
  const prev = w.fetchSurahData;
  w.fetchSurahData = async n => pagedSurah(n);
  try {
    w.localStorage.setItem('quranReviewAyahMistakes', JSON.stringify([
      { id: 'a', surah: 2, ayah: 20, hizb: 1, date: '2026-09-20', type: null, source: 'live' },
      { id: 'b', surah: 2, ayah: 20, hizb: 1, date: '2026-09-21', type: null, source: 'live' },
    ]));
    w.setView('revise');
    d.getElementById('length-unit').value = 'pageahead';
    d.getElementById('length-count').value = '1';
    await w.displayAyah(2, 20);
    assert.deepEqual(toPlain([...d.querySelectorAll('#res-arabic .ayah-line')].map(e => +e.dataset.ayahNum)),
      [20, 28], 'the anchor must not shift');

    assert.equal(w.reviseShowsTwoLandmarks(), true);
    d.getElementById('length-unit').value = 'page';
    assert.equal(w.reviseShowsTwoLandmarks(), true);
    d.getElementById('length-unit').value = 'ayat';
    assert.equal(w.reviseShowsTwoLandmarks(), false, 'lead-in still applies in Ayat mode');
  } finally { w.fetchSurahData = prev; w.localStorage.removeItem('quranReviewAyahMistakes'); }
});

test('the Unit dropdown really offers all three units', () => {
  // Reported as "I don't see Page ahead" — it was present, but this pins it.
  const opts = [...w.document.querySelectorAll('#length-unit option')].map(o => o.value);
  assert.deepEqual(opts, ['ayat', 'page', 'pageahead']);
});

test('the daily plan prompt stays at the state that actually worked', () => {
  // A cautionary tale about theorising. The plan got worse; I traced the
  // prompt's growth (96 -> 333 lines since August), concluded the problem was
  // accretion — two sections assigning rep counts, recency weights written
  // twice — and rolled back to 15 Sep. It was STILL wrong, because the user
  // then produced a prompt they said read well: it contained both of the
  // "duplicated" sections and none of my 27 Sep cluster rules.
  //
  // So the regression was one commit, mine, not the accretion. The bloat is
  // real but was not what broke it, and the evidence beat the theory.
  const md = require('fs').readFileSync('agent-prompts/prompts.md', 'utf8');
  const plan = (() => {
    const out = []; let on = false;
    for (const line of md.split('\n')) {
      if (line.startsWith('# Print')) { on = true; continue; }
      if (on && line.startsWith('# ')) break;
      if (on) out.push(line);
    }
    return out;
  })();

  // Present in the version the user confirmed reads well.
  for (const marker of [
    '## Repetition counts — 10x is the default',
    '## Completeness — list every cluster that qualifies',
    'Crucial Rule (Padding)',
    'Crucial Rule (Maximum Size)',
  ]) assert.ok(plan.join('\n').includes(marker), `missing: ${marker}`);

  // The rules whose addition coincided with the reported regression.
  for (const marker of ['Crucial Rule (Merge first)', 'Crucial Rule (Size distribution)',
                        'Crucial Rule (What a cluster IS)'])
    assert.ok(!plan.join('\n').includes(marker),
      `${marker} was reverted — re-adding it needs evidence from a real plan, not a theory`);

  // 312 is the known-good size. A ceiling makes the next round of growth
  // visible rather than gradual, without pretending to judge its quality.
  assert.ok(plan.length <= 320, `# Print is ${plan.length} lines; it read well at 312`);
});

test('the plan prompt weights recent mistakes far above old ones', () => {
  // Asked directly: "does the agent prioritise recent mistakes?" It does, and
  // these are the numbers — worth pinning so a prompt edit cannot quietly
  // flatten them.
  const md = require('fs').readFileSync('agent-prompts/prompts.md', 'utf8');
  const common = md.slice(0, md.indexOf('\n# General'));
  assert.match(common, /Last 3 days → 5× weight/);
  assert.match(common, /4–7 days ago → 2× weight/);
  assert.match(common, /8–30 days ago → 1× weight/);
  assert.match(common, /Older than 30 days → 0\.5× weight/);
  // The whole point of the curve: one fresh mistake outranks several stale ones.
  assert.match(common, /single mistake from the last 3\s*\n?days outweighs several from 8–30 days ago/);
});

test('each strength band shows how many clusters it holds', async () => {
  // The bands said "Very Weak" with no idea whether that meant one cluster or
  // twelve. Mobile already showed done/total; desktop and print showed
  // nothing, so the same plan reported its size differently depending on
  // where you looked.
  const today = new Date().toISOString().slice(0, 10);
  w.localStorage.setItem('quranReviewMemorizedHizbs', JSON.stringify([1, 2, 3]));
  w.localStorage.setItem('quranReviewDailyPlan', JSON.stringify({
    date: today,
    clusters: [
      { id: 'a', ref: '2:6-16', strength: 'vw', targetReps: 10, done: true, reps: 10 },
      { id: 'b', ref: '2:40-48', strength: 'vw', targetReps: 10, done: false },
      { id: 'c', ref: '2:60-70', strength: 'vw', targetReps: 10, done: false },
      { id: 'd', ref: '3:1-8', strength: 'w', targetReps: 5, done: true, reps: 5 },
    ],
  }));

  // done/total, so a band reports progress as well as size.
  assert.equal(w.dailyGroupCount([{ done: true }, { done: false }, { done: false }]), '1/3');
  // ...except where nothing can be done yet, where "0/5" would read as a
  // score rather than a size.
  assert.equal(w.dailyGroupCount([{ done: false }, { done: false }], false), '2');

  const d = w.document;
  w.setView('daily');
  await new Promise(r => setTimeout(r, 60));
  const desktop = [...d.querySelectorAll('#daily-plan-content .mdp-group-count')]
    .map(e => e.textContent.trim());
  assert.deepEqual(toPlain(desktop), ['1/3', '1/1']);

  // Mobile routes through the same helper, so the two cannot drift.
  w.mobShowHome();
  await new Promise(r => setTimeout(r, 60));
  const mobile = [...d.querySelectorAll('#mobile-home .mdp-group-count')]
    .map(e => e.textContent.trim());
  assert.deepEqual(toPlain(mobile), toPlain(desktop));
});

test('a saved prompt override announces that it is shadowing the file', () => {
  // generateDailyPlan() reads overrides['print'] || AGENT_PROMPT_PRESETS['print'],
  // so one saved override makes every later fix to prompts.md a no-op on that
  // device — and it syncs to the others. Nothing showed this, which is how a
  // prompt can be "still bad" right after being fixed.
  const w2 = loadPage('review.html').window;
  const d = w2.document;
  const banner = () => d.getElementById('agent-prompt-override-banner');
  w2.localStorage.setItem('quranReviewAgentPromptPreset', 'print');

  w2.localStorage.setItem('quranReviewAgentPromptOverrides', '{}');
  w2.renderAgentPromptOverrideBanner();
  assert.equal(banner().style.display, 'none', 'silent when nothing is shadowing');

  w2.localStorage.setItem('quranReviewAgentPromptOverrides',
    JSON.stringify({ print: 'a stale copy\nof the prompt' }));
  w2.renderAgentPromptOverrideBanner();
  assert.notEqual(banner().style.display, 'none');
  assert.match(banner().textContent, /using your own saved copy/);
  assert.match(banner().textContent, /do not reach this device/);

  // Another preset's override must not raise it for this one.
  w2.localStorage.setItem('quranReviewAgentPromptOverrides', JSON.stringify({ general: 'x' }));
  w2.renderAgentPromptOverrideBanner();
  assert.equal(banner().style.display, 'none');

  // One click hands control back to the shipped prompt.
  w2.localStorage.setItem('quranReviewAgentPromptOverrides', JSON.stringify({ print: 'stale' }));
  const realConfirm = w2.confirm;
  try {
    w2.confirm = () => false;
    w2.useShippedAgentPrompt();
    assert.ok(w2.loadAgentPromptOverrides().print, 'declining the confirm keeps it');
    w2.confirm = () => true;
    w2.useShippedAgentPrompt();
    assert.equal(w2.loadAgentPromptOverrides().print, undefined);
    assert.equal(banner().style.display, 'none');
  } finally { w2.confirm = realConfirm; }
});

test('a reasoning scratchpad before the plan is not parsed as clusters', () => {
  // Some prompts ask the model to work out loud first ("write an <analysis>
  // block, iterate every ayah, assign a category"). That working-out repeats
  // the category emoji and the ☐ Cluster lines this parser keys off, so every
  // cluster was counted twice. Caught by running a candidate prompt's own
  // output shape through the parser: a plan listing 3 parsed as 6.
  const w2 = loadPage('review.html').window;
  const scratch = [
    '<analysis>',
    '2:40 is recent and recurring. 🔴 Very Weak.',
    '  ☐ Cluster 2:39–2:41: Practice 15 times.',
    '2:7 is old. 🔵 Used to be weak.',
    '  ☐ Cluster 2:6–2:8: Practice 5 times.',
    '</analysis>',
    '',
    'ACTIONABLE REVIEW PLAN',
    '',
    '🔴 Very Weak',
    '☐ Cluster 2:39–2:41 *text*: Practice 15 times.',
    '☐ Cluster 2:42–2:44 *text*: Practice 10 times.',
    '',
    '🔵 Used to be weak, good to review',
    '☐ Cluster 2:6–2:8 *text*: Practice 5 times.',
  ].join('\n');
  const plan = w2.parseDailyPlanFromAiResponse(scratch);
  assert.equal(plan.clusters.length, 3, 'the plan lists 3, so 3 come back');
  assert.deepEqual(JSON.parse(JSON.stringify(plan.clusters)).map(c => `${c.strength} ${c.ref}`),
    ['vw 2:39–2:41', 'vw 2:42–2:44', 'g 2:6–2:8']);

  // <thinking> and <scratchpad> are stripped the same way.
  for (const tag of ['thinking', 'scratchpad']) {
    const t = `<${tag}>\n🔴 x\n☐ Cluster 2:1–2:3: Practice 10 times.\n</${tag}>\n`
      + '🟠 Weak\n☐ Cluster 2:5–2:7 *t*: Practice 10 times.';
    const p = w2.parseDailyPlanFromAiResponse(t);
    assert.equal(p.clusters.length, 1, tag);
    assert.equal(p.clusters[0].ref, '2:5–2:7');
  }

  // The heading guard alone handles a model that reasons WITHOUT tags.
  const untagged = [
    'Let me think. 🔴 2:39 looks very weak.',
    '☐ Cluster 2:39–2:41: Practice 15 times.',
    'ACTIONABLE REVIEW PLAN',
    '🔴 Very Weak',
    '☐ Cluster 2:39–2:41 *text*: Practice 15 times.',
  ].join('\n');
  assert.equal(w2.parseDailyPlanFromAiResponse(untagged).clusters.length, 1);

  // And the current prompt's own output — no scratchpad, no heading — is
  // untouched, which is the thing that must not regress.
  const plain = [
    '🔴 Very Weak',
    '☐ Cluster 2:39–2:41 *t*: Practice 15 times.',
    '🟡 OK',
    '☐ Page 23: Practice 5 times.',
  ].join('\n');
  const p2 = w2.parseDailyPlanFromAiResponse(plain);
  assert.equal(p2.clusters.length, 2);
  assert.equal(p2.clusters[1].ref, 'p23');

  // The same ref may legitimately appear in two DIFFERENT bands (the model
  // moved it); only a repeat within one band is dropped.
  const twoBands = [
    '🔴 Very Weak', '☐ Cluster 2:1–2:3 *t*: Practice 15 times.',
    '☐ Cluster 2:1–2:3 *t*: Practice 15 times.',
    '🟠 Weak', '☐ Cluster 2:1–2:3 *t*: Practice 10 times.',
  ].join('\n');
  const p3 = w2.parseDailyPlanFromAiResponse(twoBands);
  assert.equal(p3.clusters.length, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(p3.clusters)).map(c => c.strength), ['vw', 'w']);
});
