'use strict';

const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { loadPage } = require('./helpers/loadPage.js');

// Objects/arrays returned directly from jsdom-realm functions have a
// different Array/Object prototype than Node's own realm, which trips up
// assert.deepEqual's structural check even when the data matches. Round-trip
// through JSON to normalize before comparing.
const toPlain = (value) => JSON.parse(JSON.stringify(value));

// review.html's inline script is loaded once — these are all pure functions
// with no DOM/network dependency, so a shared window is fine (no state to
// reset between tests).
let w;
before(() => {
  w = loadPage('review.html').window;
});

test('globalToSurahAyah / hizbRange agree on Hizb boundaries for every Hizb', () => {
  for (let hizb = 1; hizb <= 60; hizb++) {
    const [start, end] = w.hizbRange(hizb);
    assert.ok(start <= end, `Hizb ${hizb}: start (${start}) should be <= end (${end})`);
    assert.equal(w.hizbOfGlobalAyah(start), hizb, `first ayah of Hizb ${hizb} maps back to it`);
    assert.equal(w.hizbOfGlobalAyah(end), hizb, `last ayah of Hizb ${hizb} maps back to it`);
  }
});

test('hizbOfGlobalAyah is the exact inverse of hizbRange across the whole mushaf', () => {
  // GLOBAL_AYAH_MAX is a top-level const, not visible on window — 6236 is
  // the well-known total ayah count, asserted directly rather than derived.
  const TOTAL_AYAT = 6236;
  for (let g = 1; g <= TOTAL_AYAT; g += 37) { // sampled, not exhaustive — keeps the suite fast
    const hizb = w.hizbOfGlobalAyah(g);
    const [start, end] = w.hizbRange(hizb);
    assert.ok(g >= start && g <= end, `global ayah ${g} -> Hizb ${hizb} (${start}-${end})`);
  }
});

test('globalToSurahAyah round-trips with SURAH_OFFSETS-based global numbering', () => {
  // Surah 2 (Al-Baqara) starts right after Surah 1's 7 ayat.
  const { surah, ayah } = w.globalToSurahAyah(8);
  assert.equal(surah, 2);
  assert.equal(ayah, 1);
});

test('globalToSurahAyah handles the very first and very last ayah', () => {
  assert.deepEqual(toPlain(w.globalToSurahAyah(1)), { surah: 1, ayah: 1 });
  const last = w.globalToSurahAyah(6236);
  assert.equal(last.surah, 114);
});

test('ayahIsInHizb: an ayah within its own Hizb', () => {
  const [start] = w.hizbRange(4);
  const { surah, ayah } = w.globalToSurahAyah(start);
  assert.equal(w.ayahIsInHizb(surah, ayah, 4), true);
});

test('ayahIsInHizb: an ayah from a different Hizb', () => {
  const [start] = w.hizbRange(4);
  const { surah, ayah } = w.globalToSurahAyah(start);
  assert.equal(w.ayahIsInHizb(surah, ayah, 5), false);
});

test('parseAyahMistakesText parses "ayah note" lines and skips non-numeric lines', () => {
  const parsed = w.parseAyahMistakesText([
    'Mistakes', // header line — no leading number, skipped
    '207',
    '218 mutashabihat',
    '',
    '200 forgot ina',
  ].join('\n'));

  assert.deepEqual(toPlain(parsed), [
    { ayah: 207, note: '' },
    { ayah: 218, note: 'mutashabihat' },
    { ayah: 200, note: 'forgot ina' },
  ]);
});

test('parseAyahMistakesText trims trailing whitespace/CR from each line', () => {
  const parsed = w.parseAyahMistakesText('221 note here \r\n230\r\n');
  assert.deepEqual(toPlain(parsed), [
    { ayah: 221, note: 'note here' },
    { ayah: 230, note: '' },
  ]);
});

test('computeAyahMistakeRankingForHizb groups by ayah, counts occurrences, sorts by count desc, and ignores other Hizbs', () => {
  w.localStorage.setItem('quranReviewAyahMistakes', JSON.stringify([
    { surah: 1, ayah: 1, hizb: 1, date: '2026-08-01T00:00:00.000Z' },
    { surah: 1, ayah: 1, hizb: 1, date: '2026-08-02T00:00:00.000Z' },
    { surah: 1, ayah: 2, hizb: 1, date: '2026-08-01T00:00:00.000Z' },
    { surah: 1, ayah: 3, hizb: 2, date: '2026-08-01T00:00:00.000Z' }, // different Hizb — excluded
  ]));

  const ranking = toPlain(w.computeAyahMistakeRankingForHizb(1));
  w.localStorage.clear();

  assert.deepEqual(ranking, [
    { surah: 1, ayah: 1, count: 2 },
    { surah: 1, ayah: 2, count: 1 },
  ]);
});

test('timeToPositionPct places a timestamp proportionally between min and max', () => {
  const min = new Date('2026-08-01').getTime();
  const max = new Date('2026-08-11').getTime(); // 10 days later
  const mid = new Date('2026-08-04').getTime(); // 3 days in = 30%
  assert.equal(w.timeToPositionPct(min, min, max), 0);
  assert.equal(w.timeToPositionPct(max, min, max), 100);
  assert.equal(w.timeToPositionPct(mid, min, max), 30);
});

test('timeToPositionPct centers everything when the range is a single instant', () => {
  const t = new Date('2026-08-01').getTime();
  assert.equal(w.timeToPositionPct(t, t, t), 50);
});

test('trendTickFractions always includes both ends and is evenly spaced', () => {
  assert.deepEqual(toPlain(w.trendTickFractions(5)), [0, 0.25, 0.5, 0.75, 1]);
  assert.deepEqual(toPlain(w.trendTickFractions(2)), [0, 1]);
});

test('trendTickFractions collapses to a single centered tick for 0 or 1 entries', () => {
  assert.deepEqual(toPlain(w.trendTickFractions(1)), [0.5]);
  assert.deepEqual(toPlain(w.trendTickFractions(0)), [0.5]);
});

test('groupAyahMistakesByCount groups by surah:ayah and sorts most-mistaken first', () => {
  const grouped = toPlain(w.groupAyahMistakesByCount([
    { surah: 1, ayah: 1 }, { surah: 1, ayah: 1 }, { surah: 1, ayah: 2 },
  ]));
  assert.deepEqual(grouped, [
    { surah: 1, ayah: 1, count: 2 },
    { surah: 1, ayah: 2, count: 1 },
  ]);
});

test('ayahMistakesForSession finds mistakes linked by sessionId', () => {
  w.localStorage.setItem('quranReviewAyahMistakes', JSON.stringify([
    { surah: 1, ayah: 1, hizb: 1, sessionId: 's1', date: '2026-08-01T09:00:00.000Z' },
    { surah: 1, ayah: 2, hizb: 1, sessionId: 's2', date: '2026-08-01T09:05:00.000Z' }, // different session, same day — excluded
    { surah: 1, ayah: 3, hizb: 2, sessionId: 's1', date: '2026-08-01T09:00:00.000Z' }, // different Hizb — excluded
  ]));
  const found = toPlain(w.ayahMistakesForSession({ id: 's1', hizb: 1, date: '2026-08-01T09:10:00.000Z' }));
  w.localStorage.clear();
  assert.equal(found.length, 1);
  assert.equal(found[0].ayah, 1);
});

test('ayahMistakesForSession falls back to same-Hizb/same-day for mistakes with no sessionId', () => {
  w.localStorage.setItem('quranReviewAyahMistakes', JSON.stringify([
    { surah: 1, ayah: 1, hizb: 1, date: '2026-08-01T09:00:00.000Z' }, // no sessionId, same day — matched
    { surah: 1, ayah: 2, hizb: 1, date: '2026-08-02T09:00:00.000Z' }, // no sessionId, different day — excluded
    { surah: 1, ayah: 3, hizb: 1, sessionId: 'other', date: '2026-08-01T09:00:00.000Z' }, // explicitly tagged elsewhere — excluded even though same day
  ]));
  const found = toPlain(w.ayahMistakesForSession({ id: 's1', hizb: 1, date: '2026-08-01T20:00:00.000Z' }));
  w.localStorage.clear();
  assert.equal(found.length, 1);
  assert.equal(found[0].ayah, 1);
});

test('ayahBeginning returns short text unchanged and truncates long text with an ellipsis', () => {
  assert.equal(w.ayahBeginning('بِسْمِ اللَّهِ', 6), 'بِسْمِ اللَّهِ');
  assert.equal(w.ayahBeginning('one two three four five six seven eight', 6), 'one two three four five six …');
});

test('clusterAyahMistakes groups nearby mistakes into passages, ranked by total mistakes', () => {
  const mistakes = [
    { surah: 1, ayah: 1 }, { surah: 1, ayah: 2 }, { surah: 1, ayah: 3 }, // global 1,2,3 -> one cluster of 3
    { surah: 2, ayah: 5 }, { surah: 2, ayah: 7 },                        // global 12,14 -> one cluster of 2 (gap 2)
  ];
  const clusters = toPlain(w.clusterAyahMistakes(mistakes, 5));

  assert.equal(clusters.length, 2);
  assert.equal(clusters[0].distinctCount, 3, 'the 3-ayah cluster ranks first (most total mistakes)');
  assert.equal(clusters[0].startSurah, 1);
  assert.equal(clusters[0].startAyah, 1);
  assert.equal(clusters[0].endAyah, 3);
  assert.equal(clusters[0].totalMistakes, 3);
  assert.equal(clusters[1].distinctCount, 2);
  assert.equal(clusters[1].startAyah, 5);
  assert.equal(clusters[1].endAyah, 7);
});

test('clusterAyahMistakes reports totalAyatInRange as the range\'s real length, distinct from distinctCount', () => {
  // 2:166, 2:170, 2:174 — gaps of 4 each (within maxGap 5), so they chain
  // into one cluster, but only 3 of the 9 ayat from 166 to 174 were
  // actually mistaken. The displayed "ayat" count for a start-end range
  // must be the full 9, not 3 (which would look inconsistent with the
  // range shown).
  const mistakes = [{ surah: 2, ayah: 166 }, { surah: 2, ayah: 170 }, { surah: 2, ayah: 174 }];
  const clusters = toPlain(w.clusterAyahMistakes(mistakes, 5));
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].startAyah, 166);
  assert.equal(clusters[0].endAyah, 174);
  assert.equal(clusters[0].distinctCount, 3, 'only 3 ayat actually have a logged mistake');
  assert.equal(clusters[0].totalAyatInRange, 9, '166 through 174 inclusive is 9 ayat');
});

test('clusterAyahMistakes includes isolated mistakes as their own size-1 group', () => {
  const mistakes = [{ surah: 1, ayah: 1 }, { surah: 2, ayah: 20 }]; // far apart, both isolated
  const clusters = toPlain(w.clusterAyahMistakes(mistakes, 5));
  assert.equal(clusters.length, 2);
  assert.ok(clusters.every(c => c.distinctCount === 1));
  assert.ok(clusters.every(c => c.totalAyatInRange === 1), 'a size-1 cluster spans exactly 1 ayah');
});

test('clusterAyahMistakes respects the maxGap boundary exactly', () => {
  // Global ayah 7 and 8: Al-Fatiha (surah 1) has 7 ayat, so 7 = 1:7, 8 = 2:1.
  const justInside = toPlain(w.clusterAyahMistakes([{ surah: 1, ayah: 3 }, { surah: 1, ayah: 7 }], 4)); // gap 4
  assert.equal(justInside.length, 1);
  assert.equal(justInside[0].distinctCount, 2);
  const justOutside = toPlain(w.clusterAyahMistakes([{ surah: 1, ayah: 3 }, { surah: 1, ayah: 7 }], 3)); // gap 4 > 3
  assert.equal(justOutside.length, 2, 'too far apart to merge — two size-1 groups instead of one');
  assert.ok(justOutside.every(c => c.distinctCount === 1));
});

test('clusterAyahMistakes sums repeated mistakes on the same ayah into the cluster total', () => {
  const mistakes = [
    { surah: 1, ayah: 1 }, { surah: 1, ayah: 1 }, // ayah 1 mistaken twice
    { surah: 1, ayah: 2 },
  ];
  const clusters = toPlain(w.clusterAyahMistakes(mistakes, 5));
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].distinctCount, 2);
  assert.equal(clusters[0].totalMistakes, 3);
});

test('computeAllRevisionClusters merges clusters from every Hizb into one ranked list, tagged by Hizb', () => {
  w.localStorage.setItem('quranReviewAyahMistakes', JSON.stringify([
    // Hizb 1: a 2-ayah cluster (2 total mistakes)
    { surah: 1, ayah: 1, hizb: 1, date: '2026-08-01T00:00:00.000Z' },
    { surah: 1, ayah: 2, hizb: 1, date: '2026-08-01T00:00:00.000Z' },
    // Hizb 2: a 3-ayah cluster (3 total mistakes) — should rank first
    { surah: 2, ayah: 5, hizb: 2, date: '2026-08-01T00:00:00.000Z' },
    { surah: 2, ayah: 6, hizb: 2, date: '2026-08-01T00:00:00.000Z' },
    { surah: 2, ayah: 7, hizb: 2, date: '2026-08-01T00:00:00.000Z' },
    // Hizb 3: an isolated mistake, far from anything — its own size-1 group
    { surah: 3, ayah: 1, hizb: 3, date: '2026-08-01T00:00:00.000Z' },
  ]));

  const all = toPlain(w.computeAllRevisionClusters());
  w.localStorage.clear();

  assert.equal(all.length, 3);
  assert.equal(all[0].hizb, 2, 'the bigger cluster (Hizb 2) ranks first');
  assert.equal(all[0].distinctCount, 3);
  assert.equal(all[1].hizb, 1);
  assert.equal(all[1].distinctCount, 2);
  assert.equal(all[2].hizb, 3);
  assert.equal(all[2].distinctCount, 1, 'the isolated mistake still shows up, ranked last');
});

test('computeAllRevisionClusters with the "7d" timeframe excludes older mistakes', () => {
  const recent = new Date(Date.now() - 2 * 86400000).toISOString(); // 2 days ago
  const old = new Date(Date.now() - 30 * 86400000).toISOString();   // 30 days ago
  w.localStorage.setItem('quranReviewAyahMistakes', JSON.stringify([
    { surah: 1, ayah: 1, hizb: 1, date: recent },
    { surah: 1, ayah: 2, hizb: 1, date: recent },
    { surah: 2, ayah: 1, hizb: 2, date: old },
  ]));

  const allTime = toPlain(w.computeAllRevisionClusters('all'));
  const last7d = toPlain(w.computeAllRevisionClusters('7d'));
  w.localStorage.clear();

  assert.equal(allTime.length, 2, 'all-time includes both the recent cluster and the old isolated mistake');
  assert.equal(last7d.length, 1, 'last-7-days drops the 30-day-old mistake');
  assert.equal(last7d[0].hizb, 1);
});

test('computeAllRevisionClusters also supports "1d" and "3d" timeframes', () => {
  const today = new Date(Date.now() - 2 * 3600000).toISOString();      // 2 hours ago
  const twoDaysAgo = new Date(Date.now() - 2 * 86400000).toISOString(); // 2 days ago
  const fiveDaysAgo = new Date(Date.now() - 5 * 86400000).toISOString(); // 5 days ago
  w.localStorage.setItem('quranReviewAyahMistakes', JSON.stringify([
    { surah: 1, ayah: 1, hizb: 1, date: today },
    { surah: 2, ayah: 1, hizb: 2, date: twoDaysAgo },
    { surah: 3, ayah: 1, hizb: 3, date: fiveDaysAgo },
  ]));

  const last1d = toPlain(w.computeAllRevisionClusters('1d'));
  const last3d = toPlain(w.computeAllRevisionClusters('3d'));
  w.localStorage.clear();

  assert.equal(last1d.length, 1, '1-day window keeps only today\'s mistake');
  assert.equal(last1d[0].hizb, 1);
  assert.equal(last3d.length, 2, '3-day window keeps today\'s and 2-days-ago, drops 5-days-ago');
  assert.deepEqual(last3d.map(c => c.hizb).sort(), [1, 2]);
});

test('computeRevisionClustersForHizb accepts an optional timeframe the same way', () => {
  const recent = new Date(Date.now() - 1 * 86400000).toISOString();
  const old = new Date(Date.now() - 20 * 86400000).toISOString();
  w.localStorage.setItem('quranReviewAyahMistakes', JSON.stringify([
    { surah: 1, ayah: 1, hizb: 5, date: recent },
    { surah: 1, ayah: 2, hizb: 5, date: old },
  ]));

  const allTime = toPlain(w.computeRevisionClustersForHizb(5, 'all'));
  const last7d = toPlain(w.computeRevisionClustersForHizb(5, '7d'));
  w.localStorage.clear();

  assert.equal(allTime.length, 1, 'both ayat are close enough to merge into one cluster all-time');
  assert.equal(allTime[0].distinctCount, 2);
  assert.equal(last7d.length, 1, 'only the recent ayah survives the 7-day filter');
  assert.equal(last7d[0].distinctCount, 1);
});

test('computeSessionRevisionClusters clusters only the mistakes tied to that one session', () => {
  w.localStorage.setItem('quranReviewAyahMistakes', JSON.stringify([
    { surah: 1, ayah: 1, hizb: 1, sessionId: 's1', date: '2026-08-01T09:00:00.000Z' },
    { surah: 1, ayah: 2, hizb: 1, sessionId: 's1', date: '2026-08-01T09:00:00.000Z' },
    { surah: 1, ayah: 3, hizb: 1, sessionId: 's2', date: '2026-08-01T09:00:00.000Z' }, // different session — excluded
  ]));

  const clusters = toPlain(w.computeSessionRevisionClusters({ id: 's1', hizb: 1, date: '2026-08-01T09:10:00.000Z' }));
  w.localStorage.clear();

  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].distinctCount, 2);
});

test('clusterAyahMistakes caps a cluster at REVISION_CLUSTER_MAX_SPAN ayat even when every gap is within maxGap', () => {
  // Surah 2 (Al-Baqara) ayah 1 is global ayah 8 — using ayat 3 apart (well
  // within the default maxGap of 5) but spanning 18 ayat overall (past the
  // default 15-ayah maxSpan), so this must split into two clusters instead
  // of one 18-ayah "revision passage" that's mostly clean ayat.
  const mistakes = [1, 4, 7, 10, 13, 16, 19].map(ayah => ({ surah: 2, ayah }));
  const clusters = toPlain(w.clusterAyahMistakes(mistakes, 5));

  assert.equal(clusters.length, 2, 'the span cap forces a second cluster once span would exceed 15');
  assert.equal(clusters[0].distinctCount, 6, 'ayat 1,4,7,10,13,16 fit within a 15-ayah span');
  assert.equal(clusters[0].startAyah, 1);
  assert.equal(clusters[0].endAyah, 16);
  assert.equal(clusters[1].distinctCount, 1, 'ayah 19 would push span to 18 — starts a new cluster');
  assert.equal(clusters[1].startAyah, 19);
});

test('computeSessionClustersForHizb keeps each session\'s clusters separate, never merging across sessions', () => {
  w.localStorage.setItem('quranReviewHizbLog', JSON.stringify([
    { id: 's1', hizb: 1, mistakes: 2, date: '2026-08-01T00:00:00.000Z' },
    { id: 's2', hizb: 1, mistakes: 2, date: '2026-08-02T00:00:00.000Z' },
  ]));
  w.localStorage.setItem('quranReviewAyahMistakes', JSON.stringify([
    // Session 1: ayat 1-2 (adjacent)
    { surah: 1, ayah: 1, hizb: 1, sessionId: 's1', date: '2026-08-01T00:00:00.000Z' },
    { surah: 1, ayah: 2, hizb: 1, sessionId: 's1', date: '2026-08-01T00:00:00.000Z' },
    // Session 2: ayat 3-4 — immediately adjacent to session 1's range, but a
    // different sitting entirely, so must NOT merge with session 1's cluster.
    { surah: 1, ayah: 3, hizb: 1, sessionId: 's2', date: '2026-08-02T00:00:00.000Z' },
    { surah: 1, ayah: 4, hizb: 1, sessionId: 's2', date: '2026-08-02T00:00:00.000Z' },
  ]));

  const clusters = toPlain(w.computeSessionClustersForHizb(1, 'all'));
  w.localStorage.clear();

  assert.equal(clusters.length, 2, 'one cluster per session, not merged into one');
  const bySession = Object.fromEntries(clusters.map(c => [c.sessionId, c]));
  assert.equal(bySession.s1.distinctCount, 2);
  assert.equal(bySession.s1.endAyah, 2);
  assert.equal(bySession.s2.distinctCount, 2);
  assert.equal(bySession.s2.startAyah, 3);
});

test('saveHizbLogEdit re-tags a session\'s ayah mistakes when the session\'s Hizb changes', () => {
  w.localStorage.setItem('quranReviewHizbLog', JSON.stringify([
    { id: 's1', hizb: 1, mistakes: 2, date: '2026-08-01T00:00:00.000Z' },
  ]));
  w.localStorage.setItem('quranReviewAyahMistakes', JSON.stringify([
    { surah: 1, ayah: 1, hizb: 1, sessionId: 's1', date: '2026-08-01T00:00:00.000Z' },
    { surah: 1, ayah: 2, hizb: 1, sessionId: 's1', date: '2026-08-01T00:00:00.000Z' },
  ]));

  w.startHizbLogEdit('s1');
  w.document.getElementById('edit-log-hizb-s1').value = '2';
  w.saveHizbLogEdit('s1');

  const log = toPlain(w.loadHizbLog());
  const mistakes = toPlain(w.loadAyahMistakes());
  w.localStorage.clear();

  assert.equal(log[0].hizb, 2, 'the session itself moved to Hizb 2');
  assert.ok(mistakes.every(m => m.hizb === 2), 'its linked mistakes moved with it, not left behind on Hizb 1');
});

test('deleteHizbLogEntry asks for confirmation and, once confirmed, removes the session\'s linked mistakes too', () => {
  w.localStorage.setItem('quranReviewHizbLog', JSON.stringify([
    { id: 's1', hizb: 1, mistakes: 2, date: '2026-08-01T00:00:00.000Z' },
  ]));
  w.localStorage.setItem('quranReviewAyahMistakes', JSON.stringify([
    { surah: 1, ayah: 1, hizb: 1, sessionId: 's1', date: '2026-08-01T00:00:00.000Z' },
    { surah: 1, ayah: 2, hizb: 1, sessionId: 's1', date: '2026-08-01T00:00:00.000Z' },
  ]));

  let capturedMessage = null;
  w.confirm = (msg) => { capturedMessage = msg; return false; };
  w.deleteHizbLogEntry('s1');
  assert.match(capturedMessage, /2 ayah-level mistakes/, 'warns how many linked mistakes will go with it');
  assert.equal(w.loadHizbLog().length, 1, 'declining the confirm leaves the session in place');
  assert.equal(w.loadAyahMistakes().length, 2, 'declining the confirm leaves its mistakes in place');

  w.confirm = () => true;
  w.deleteHizbLogEntry('s1');
  const log = toPlain(w.loadHizbLog());
  const mistakes = toPlain(w.loadAyahMistakes());
  w.localStorage.clear();

  assert.equal(log.length, 0, 'the session is gone');
  assert.equal(mistakes.length, 0, 'its linked mistakes are gone too, not left as orphans');
});

test('computeLatestSessionClustersForAllHizb only uses each Hizb\'s most recent session', () => {
  w.localStorage.setItem('quranReviewHizbLog', JSON.stringify([
    // Hizb 1: an old session (bigger cluster) and a newer, smaller one — only the newer one should count.
    { id: 'h1-old', hizb: 1, mistakes: 3, date: '2026-07-01T00:00:00.000Z' },
    { id: 'h1-new', hizb: 1, mistakes: 1, date: '2026-08-01T00:00:00.000Z' },
    // Hizb 2: a single session.
    { id: 'h2-only', hizb: 2, mistakes: 2, date: '2026-07-15T00:00:00.000Z' },
  ]));
  w.localStorage.setItem('quranReviewAyahMistakes', JSON.stringify([
    { surah: 1, ayah: 1, hizb: 1, sessionId: 'h1-old', date: '2026-07-01T00:00:00.000Z' },
    { surah: 1, ayah: 2, hizb: 1, sessionId: 'h1-old', date: '2026-07-01T00:00:00.000Z' },
    { surah: 1, ayah: 3, hizb: 1, sessionId: 'h1-old', date: '2026-07-01T00:00:00.000Z' },
    { surah: 1, ayah: 5, hizb: 1, sessionId: 'h1-new', date: '2026-08-01T00:00:00.000Z' },
    { surah: 2, ayah: 10, hizb: 2, sessionId: 'h2-only', date: '2026-07-15T00:00:00.000Z' },
    { surah: 2, ayah: 11, hizb: 2, sessionId: 'h2-only', date: '2026-07-15T00:00:00.000Z' },
  ]));

  const clusters = toPlain(w.computeLatestSessionClustersForAllHizb());
  w.localStorage.clear();

  const byHizb = {};
  clusters.forEach(c => { (byHizb[c.hizb] ||= []).push(c); });

  assert.equal(byHizb[1].length, 1, 'Hizb 1 contributes only its latest session\'s cluster(s)');
  assert.equal(byHizb[1][0].distinctCount, 1, 'the old 3-ayah session is excluded — only the newer 1-ayah one counts');
  assert.equal(byHizb[1][0].sessionId, 'h1-new');
  assert.equal(byHizb[2].length, 1);
  assert.equal(byHizb[2][0].distinctCount, 2);
  assert.equal(byHizb[2][0].sessionId, 'h2-only');
});

test('computeLatestSessionClustersForAllHizb still splits one session into multiple clusters when its mistakes are far apart', () => {
  // Ayat 1 and 50 (surah 3) are nowhere near each other — a session can
  // genuinely have more than one separate weak spot, and this should still
  // surface both as their own rows rather than merging into one wide range.
  w.localStorage.setItem('quranReviewHizbLog', JSON.stringify([
    { id: 's1', hizb: 1, mistakes: 2, date: '2026-08-01T00:00:00.000Z' },
  ]));
  w.localStorage.setItem('quranReviewAyahMistakes', JSON.stringify([
    { surah: 1, ayah: 1, hizb: 1, sessionId: 's1', date: '2026-08-01T00:00:00.000Z' },
    { surah: 3, ayah: 50, hizb: 1, sessionId: 's1', date: '2026-08-01T00:00:00.000Z' },
  ]));

  const clusters = toPlain(w.computeLatestSessionClustersForAllHizb());
  w.localStorage.clear();

  assert.equal(clusters.length, 2, 'two separate clusters from the one session, not merged into one wide range');
  assert.ok(clusters.every(c => c.hizb === 1 && c.sessionId === 's1'));
  assert.ok(clusters.every(c => c.distinctCount === 1));
});

test('applyPrintCount reads the "how many to print" <select> and slices accordingly', () => {
  const list = [1, 2, 3, 4, 5, 6, 7];
  const select = w.document.getElementById('all-clusters-print-count');

  select.value = '5';
  assert.deepEqual(toPlain(w.applyPrintCount(list, 'all-clusters-print-count')), [1, 2, 3, 4, 5]);

  select.value = 'all';
  assert.deepEqual(toPlain(w.applyPrintCount(list, 'all-clusters-print-count')), list);
});

test('rankMutashabihatGroups enriches each ayah with its own mistake count and sorts most-mistaken-total first', () => {
  const groups = [
    { id: 'g1', ayat: [{ surah: 2, ayah: 1 }, { surah: 2, ayah: 2 }] },
    { id: 'g2', ayat: [{ surah: 1, ayah: 1 }, { surah: 1, ayah: 2 }] },
  ];
  const mistakeGroups = [
    { surah: 2, ayah: 1, count: 1 },
    { surah: 2, ayah: 2, count: 1 },
    { surah: 1, ayah: 1, count: 5 },
    { surah: 1, ayah: 2, count: 4 },
  ];

  const ranked = toPlain(w.rankMutashabihatGroups(groups, mistakeGroups));

  assert.equal(ranked[0].id, 'g2', 'g2 (5+4=9 mistakes) outranks g1 (1+1=2 mistakes)');
  assert.equal(ranked[0].ayat[0].count, 5);
  assert.equal(ranked[0].ayat[1].count, 4);
  assert.equal(ranked[0].totalCount, 9);
  assert.equal(ranked[1].id, 'g1');
  assert.equal(ranked[1].totalCount, 2);
});

test('rankMutashabihatGroups treats an ayah with no logged mistakes as a zero count, not missing', () => {
  const ranked = toPlain(w.rankMutashabihatGroups(
    [{ id: 'g1', ayat: [{ surah: 5, ayah: 10 }, { surah: 6, ayah: 20 }] }],
    [],
  ));
  assert.equal(ranked[0].ayat[0].count, 0);
  assert.equal(ranked[0].ayat[1].count, 0);
  assert.equal(ranked[0].totalCount, 0);
});

test('rankMutashabihatGroups sums mistakes across a group of 3 or more ayat, not just a pair', () => {
  const groups = [{ id: 'g1', ayat: [{ surah: 1, ayah: 1 }, { surah: 1, ayah: 2 }, { surah: 1, ayah: 3 }] }];
  const mistakeGroups = [
    { surah: 1, ayah: 1, count: 2 },
    { surah: 1, ayah: 2, count: 3 },
    { surah: 1, ayah: 3, count: 1 },
  ];
  const ranked = toPlain(w.rankMutashabihatGroups(groups, mistakeGroups));
  assert.equal(ranked[0].totalCount, 6);
});

test('validateMutashabihatAyat rejects fewer than 2 ayat, out-of-range ayat, and duplicate ayat', () => {
  assert.match(w.validateMutashabihatAyat([{ surah: 1, ayah: 1 }]), /at least 2/);
  assert.match(w.validateMutashabihatAyat([{ surah: 1, ayah: 999 }, { surah: 1, ayah: 1 }]), /valid ayah number/);
  assert.match(w.validateMutashabihatAyat([{ surah: 2, ayah: 5 }, { surah: 2, ayah: 5 }]), /must be different/);
  assert.equal(w.validateMutashabihatAyat([{ surah: 1, ayah: 1 }, { surah: 1, ayah: 2 }, { surah: 2, ayah: 3 }]), null,
    'a valid group of 3 ayat passes');
});

test('normalizeMutashabihatGroup upgrades the legacy two-ayah { surahA, ayahA, surahB, ayahB } shape', () => {
  const upgraded = toPlain(w.normalizeMutashabihatGroup({ id: 'old1', surahA: 2, ayahA: 5, surahB: 3, ayahB: 7, note: 'x', dateAdded: '2026-01-01' }));
  assert.deepEqual(upgraded.ayat, [{ surah: 2, ayah: 5 }, { surah: 3, ayah: 7 }]);
});

test('normalizeMutashabihatGroup passes through the current { ayat: [...] } shape unchanged', () => {
  const ayat = [{ surah: 1, ayah: 1 }, { surah: 1, ayah: 2 }, { surah: 1, ayah: 3 }];
  const normalized = toPlain(w.normalizeMutashabihatGroup({ id: 'g1', ayat, note: '', dateAdded: '2026-01-01' }));
  assert.deepEqual(normalized.ayat, ayat);
});

test('mutashabihatContextWindow clamps to the surah\'s own ayah range instead of spilling past it', () => {
  assert.deepEqual(toPlain(w.mutashabihatContextWindow(1, 20, 2)), { start: 1, end: 3 },
    'first ayah: no room before it, so the window starts at 1');
  assert.deepEqual(toPlain(w.mutashabihatContextWindow(20, 20, 2)), { start: 18, end: 20 },
    'last ayah: no room after it, so the window ends at the surah\'s last ayah');
  assert.deepEqual(toPlain(w.mutashabihatContextWindow(10, 20, 2)), { start: 8, end: 12 },
    'a middle ayah gets the full 2-before/2-after window');
  assert.deepEqual(toPlain(w.mutashabihatContextWindow(2, 3, 2)), { start: 1, end: 3 },
    'a short surah clamps on both sides at once');
});
