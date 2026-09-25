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
