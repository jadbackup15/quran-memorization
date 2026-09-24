'use strict';

// Cluster Deep Dive (review.html) — a WEEKLY plan, deliberately unlike Today's
// Plan. It picks 2-4 clusters that have been stuck for weeks and drills each
// every day until they stop recurring, so its template, parser and state are
// all separate from the daily plan's.

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

test('Cluster Deep Dive is NOT one of the AI Review styles', () => {
  // It owns a sub-tab because it produces persistent, tracked state, whereas
  // every AI Review style renders a one-off block of text.
  const styles = [...w.document.querySelectorAll('#ai-review-style option')].map(o => o.value);
  assert.ok(!styles.includes('clusterdive'));
  assert.equal(w.AGENT_PROMPT_PRESET_LABELS?.clusterdive ?? 'Cluster Deep Dive', 'Cluster Deep Dive');
});
