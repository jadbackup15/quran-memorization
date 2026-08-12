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
    { ayah: 207, type: null, note: '' },
    { ayah: 218, type: null, note: 'mutashabihat' },
    { ayah: 200, type: null, note: 'forgot ina' },
  ]);
});

test('parseAyahMistakesText trims trailing whitespace/CR from each line', () => {
  const parsed = w.parseAyahMistakesText('221 note here \r\n230\r\n');
  assert.deepEqual(toPlain(parsed), [
    { ayah: 221, type: null, note: 'note here' },
    { ayah: 230, type: null, note: '' },
  ]);
});

test('parseAyahMistakesText splits a leading type code (S/B/W/M/A) off the note', () => {
  const parsed = w.parseAyahMistakesText([
    '255 S',
    '218 B forgot ina',
    '10 w',              // lowercase code is normalized to uppercase
    '30 M multiple here',
    '40 A',
  ].join('\n'));

  assert.deepEqual(toPlain(parsed), [
    { ayah: 255, type: 'S', note: '' },
    { ayah: 218, type: 'B', note: 'forgot ina' },
    { ayah: 10, type: 'W', note: '' },
    { ayah: 30, type: 'M', note: 'multiple here' },
    { ayah: 40, type: 'A', note: '' },
  ]);
});

test('parseAyahMistakesText also accepts the type code with no space before it, e.g. "255S"', () => {
  const parsed = w.parseAyahMistakesText([
    '255S',
    '218b',              // lowercase, no space — still normalized to uppercase
    '40A',
  ].join('\n'));

  assert.deepEqual(toPlain(parsed), [
    { ayah: 255, type: 'S', note: '' },
    { ayah: 218, type: 'B', note: '' },
    { ayah: 40, type: 'A', note: '' },
  ]);
});

test('parseAyahMistakesText leaves a note untyped when it merely starts with a type letter', () => {
  // "Slow" starts with 'S' but isn't the standalone code "S" — word-boundary
  // check in splitMistakeTypeAndNote keeps this a plain note, unchanged from
  // before there was a type system at all.
  const parsed = w.parseAyahMistakesText('218 Slow and hesitant');
  assert.deepEqual(toPlain(parsed), [{ ayah: 218, type: null, note: 'Slow and hesitant' }]);
});

test('splitMistakeTypeAndNote recognizes each MISTAKE_TYPE_META code standalone, case-insensitively', () => {
  assert.deepEqual(toPlain(w.splitMistakeTypeAndNote('s')), { type: 'S', note: '' });
  assert.deepEqual(toPlain(w.splitMistakeTypeAndNote('B  forgot ina')), { type: 'B', note: 'forgot ina' });
  assert.deepEqual(toPlain(w.splitMistakeTypeAndNote('mutashabihat')), { type: null, note: 'mutashabihat' });
  assert.deepEqual(toPlain(w.splitMistakeTypeAndNote('')), { type: null, note: '' });
});

test('splitMistakeTypeAndNote recognizes "T" (Mutashabihat) as a standalone type code', () => {
  assert.deepEqual(toPlain(w.splitMistakeTypeAndNote('T')), { type: 'T', note: '' });
  assert.deepEqual(toPlain(w.splitMistakeTypeAndNote('t mixed up with 2:5')), { type: 'T', note: 'mixed up with 2:5' });
});

test('splitMistakeTypeAndNote combines multiple type codes into one canonically-sorted type, e.g. "SB" -> "BS"', () => {
  assert.deepEqual(toPlain(w.splitMistakeTypeAndNote('SB')), { type: 'BS', note: '' });
  assert.deepEqual(toPlain(w.splitMistakeTypeAndNote('bs')), { type: 'BS', note: '' }, 'lowercase, still canonicalized');
  assert.deepEqual(toPlain(w.splitMistakeTypeAndNote('SB forgot ina')), { type: 'BS', note: 'forgot ina' });
  assert.deepEqual(toPlain(w.splitMistakeTypeAndNote('MWT')), { type: 'MTW', note: '' }, 'three codes combine and sort together');
});

test('splitMistakeTypeAndNote treats a combo containing "A" as untyped — "A" (Needs Attention) cannot combine with a real mistake type', () => {
  assert.deepEqual(toPlain(w.splitMistakeTypeAndNote('AS')), { type: null, note: 'AS' });
});

test('parseAyahMistakesText parses a combined type code with no space, e.g. "255SB" for ayah 255 with both an S and a B mistake', () => {
  const parsed = w.parseAyahMistakesText('255SB');
  assert.deepEqual(toPlain(parsed), [{ ayah: 255, type: 'BS', note: '' }]);
});

test('normalizeMistakeTypeCodes dedupes, sorts, and rejects an "A"+other-code combo or an all-invalid input', () => {
  assert.equal(w.normalizeMistakeTypeCodes('sb'), 'BS');
  assert.equal(w.normalizeMistakeTypeCodes('SSB'), 'BS', 'duplicate letters collapse');
  assert.equal(w.normalizeMistakeTypeCodes('BA'), null, "'A' can't combine with a real mistake type");
  assert.equal(w.normalizeMistakeTypeCodes('A'), 'A', "'A' alone is still valid");
  assert.equal(w.normalizeMistakeTypeCodes('xyz'), null, 'no recognized codes at all');
  assert.equal(w.normalizeMistakeTypeCodes(''), null);
});

test('isValidMistakeType is true only for an already-canonical type string', () => {
  assert.equal(w.isValidMistakeType('BS'), true);
  assert.equal(w.isValidMistakeType('SB'), false, 'valid codes, but not in canonical (sorted) order');
  assert.equal(w.isValidMistakeType('A'), true);
  assert.equal(w.isValidMistakeType('AS'), false, "'A' combined with another code is never valid");
  assert.equal(w.isValidMistakeType(null), false);
  assert.equal(w.isValidMistakeType(''), false);
});

test('mistakeTypeLabel formats a single code and a combo, and returns "" for falsy input', () => {
  assert.equal(w.mistakeTypeLabel('S'), 'S · Stopped');
  assert.equal(w.mistakeTypeLabel('BS'), 'B+S · Forgot the beginning, Stopped');
  assert.equal(w.mistakeTypeLabel(null), '');
  assert.equal(w.mistakeTypeLabel(''), '');
});

test('computeAyahMistakeRanking\'s type filter matches a combo entry containing that code, not just an exact-equal type', () => {
  w.localStorage.setItem('quranReviewAyahMistakes', JSON.stringify([
    { surah: 1, ayah: 5, hizb: 1, type: 'BS', note: '', date: '2026-08-01T00:00:00.000Z' },
    { surah: 1, ayah: 6, hizb: 1, type: 'W', note: '', date: '2026-08-01T00:00:00.000Z' },
  ]));
  const sFiltered = toPlain(w.computeAyahMistakeRanking('S'));
  const bFiltered = toPlain(w.computeAyahMistakeRanking('B'));
  const wFiltered = toPlain(w.computeAyahMistakeRanking('W'));
  const tFiltered = toPlain(w.computeAyahMistakeRanking('T'));
  w.localStorage.clear();

  assert.deepEqual(sFiltered.map(r => r.ayah), [5], 'filtering by S matches the "BS" combo entry');
  assert.deepEqual(bFiltered.map(r => r.ayah), [5], 'filtering by B also matches the "BS" combo entry');
  assert.deepEqual(wFiltered.map(r => r.ayah), [6]);
  assert.deepEqual(tFiltered.map(r => r.ayah), [], 'no T-typed mistakes logged');
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

test('groupAyahMistakesByCount (and so computeAyahMistakeRankingForHizb) excludes type "A" entries entirely', () => {
  w.localStorage.setItem('quranReviewAyahMistakes', JSON.stringify([
    { surah: 1, ayah: 1, hizb: 1, date: '2026-08-01T00:00:00.000Z' },
    { surah: 1, ayah: 1, hizb: 1, type: 'A', date: '2026-08-02T00:00:00.000Z' }, // flagged, not a mistake
    { surah: 1, ayah: 2, hizb: 1, type: 'A', date: '2026-08-01T00:00:00.000Z' }, // only "A" ever logged for this ayah
  ]));
  const ranking = toPlain(w.computeAyahMistakeRankingForHizb(1));
  w.localStorage.clear();

  assert.deepEqual(ranking, [{ surah: 1, ayah: 1, count: 1 }], 'ayah 2 never appears — its one entry was type "A"');
});

test('computeAyahMistakeRanking excludes type "A", tracks the latest type/note independently, and supports a type filter', () => {
  w.localStorage.setItem('quranReviewAyahMistakes', JSON.stringify([
    { surah: 1, ayah: 5, hizb: 1, type: 'S', note: '', date: '2026-08-01T00:00:00.000Z' },
    { surah: 1, ayah: 5, hizb: 1, type: null, note: 'mixed up', date: '2026-08-03T00:00:00.000Z' }, // no type — shouldn't blank out the earlier "S"
    { surah: 1, ayah: 6, hizb: 1, type: 'B', note: '', date: '2026-08-01T00:00:00.000Z' },
    { surah: 1, ayah: 7, hizb: 1, type: 'A', note: 'felt shaky', date: '2026-08-01T00:00:00.000Z' }, // excluded entirely
  ]));

  const all = toPlain(w.computeAyahMistakeRanking());
  const sOnly = toPlain(w.computeAyahMistakeRanking('S'));
  w.localStorage.clear();

  assert.deepEqual(all.map(r => r.surah + ':' + r.ayah), ['1:5', '1:6'], 'ayah 7 (type "A") never appears');
  const ayah5 = all.find(r => r.surah === 1 && r.ayah === 5);
  assert.equal(ayah5.count, 2);
  assert.equal(ayah5.latestType, 'S', 'the later, type-less tap does not clear the earlier type');
  assert.equal(ayah5.latestNote, 'mixed up', 'the later tap\'s note still wins, tracked independently of type');

  assert.deepEqual(sOnly.map(r => r.surah + ':' + r.ayah), ['1:5'], 'type filter "S" excludes ayah 6 (type "B")');
});

test('computeAyatNeedingAttention lists only type "A" entries, most-recently-flagged first, one row per ayah', () => {
  w.localStorage.setItem('quranReviewAyahMistakes', JSON.stringify([
    { surah: 1, ayah: 1, hizb: 1, type: 'S', note: '', date: '2026-08-01T00:00:00.000Z' }, // not "A" — excluded
    { surah: 1, ayah: 2, hizb: 1, type: 'A', note: 'first flag', date: '2026-08-01T00:00:00.000Z' },
    { surah: 1, ayah: 2, hizb: 1, type: 'A', note: 'second flag', date: '2026-08-05T00:00:00.000Z' }, // same ayah, later — wins
    { surah: 1, ayah: 3, hizb: 1, type: 'A', note: '', date: '2026-08-03T00:00:00.000Z' },
  ]));
  const list = toPlain(w.computeAyatNeedingAttention());
  w.localStorage.clear();

  assert.deepEqual(list.map(r => `${r.surah}:${r.ayah}`), ['1:2', '1:3'], 'most-recently-flagged ayah first, ayah 1 excluded');
  assert.equal(list[0].note, 'second flag', 'the latest flag\'s note wins for a repeated ayah');
});

test('renderMistakeTypeBadge renders the code for a known type and nothing for an unknown/missing one', () => {
  assert.match(w.renderMistakeTypeBadge('S'), /type-S[^>]*>S</);
  assert.equal(w.renderMistakeTypeBadge(null), '');
  assert.equal(w.renderMistakeTypeBadge(undefined), '');
  assert.equal(w.renderMistakeTypeBadge('Z'), '', 'not a recognized MISTAKE_TYPE_META code');
});

test('renderMistakeTypeLegend renders every mistake type\'s badge, label, and full description visible inline (not just on hover)', () => {
  // MISTAKE_TYPE_META itself is a `const` in mistake-analytics.js, so it isn't
  // reachable as w.MISTAKE_TYPE_META (top-level const/let never become window
  // properties) — asserted against directly here instead.
  const expected = {
    S: { label: 'Stopped', descriptionSnippet: 'Blanked mid-ayah' },
    B: { label: 'Forgot the beginning', descriptionSnippet: "recall how the ayah starts" },
    W: { label: 'Word slip', descriptionSnippet: 'Minor substitution' },
    M: { label: 'Multiple mistakes', descriptionSnippet: 'More than one mistake' },
    A: { label: 'Needs attention', descriptionSnippet: 'tracked separately, not counted as a mistake' },
  };

  w.renderMistakeTypeLegend();
  const html = w.document.getElementById('mistake-type-legend').innerHTML;

  Object.entries(expected).forEach(([code, { label, descriptionSnippet }]) => {
    assert.match(html, new RegExp(`type-${code}[^>]*>${code}<`), `badge for ${code}`);
    assert.match(html, new RegExp(label), `label for ${code} shown inline`);
    assert.match(html, new RegExp(descriptionSnippet), `description for ${code} shown inline, not just in a title attribute`);
  });
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

test('validateMutashabihatAyat accepts a single ayah (a group can start with just one and grow later), rejects an empty list, out-of-range ayat, and duplicate ayat', () => {
  assert.equal(w.validateMutashabihatAyat([{ surah: 1, ayah: 1 }]), null,
    'a lone ayah is valid — you can add the rest later by editing the group');
  assert.match(w.validateMutashabihatAyat([]), /at least 1/);
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

test('sortHizbOverviewRows "hizb" mode sorts by ascending Hizb number regardless of input order', () => {
  const rows = [{ hizb: 5, score: 10 }, { hizb: 1, score: 90 }, { hizb: 3, score: 50 }];
  const sorted = toPlain(w.sortHizbOverviewRows(rows, 'hizb'));
  assert.deepEqual(sorted.map(r => r.hizb), [1, 3, 5]);
});

test('sortHizbOverviewRows "weakest" mode sorts by ascending strength score', () => {
  const rows = [{ hizb: 1, score: 90 }, { hizb: 2, score: 10 }, { hizb: 3, score: 50 }];
  const sorted = toPlain(w.sortHizbOverviewRows(rows, 'weakest'));
  assert.deepEqual(sorted.map(r => r.hizb), [2, 3, 1]);
});

test('sortHizbOverviewRows "stale" mode surfaces never-recited Hizbs first, then longest-since-recited', () => {
  const rows = [
    { hizb: 1, score: 50, daysSinceLast: 3 },
    { hizb: 2, score: 50, daysSinceLast: null },
    { hizb: 3, score: 50, daysSinceLast: 30 },
  ];
  const sorted = toPlain(w.sortHizbOverviewRows(rows, 'stale'));
  assert.deepEqual(sorted.map(r => r.hizb), [2, 3, 1], 'never-recited (null) first, then most days-since-last descending');
});

test('sortHizbOverviewRows breaks ties by ascending Hizb number for a stable order', () => {
  const rows = [{ hizb: 5, score: 50 }, { hizb: 2, score: 50 }];
  assert.deepEqual(toPlain(w.sortHizbOverviewRows(rows, 'weakest')).map(r => r.hizb), [2, 5]);
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

// entries mirror computeHizbStrength's shape: sorted ascending by date, only
// `mistakes` matters to computeMistakeTrend.
const trendEntries = (mistakesList) => mistakesList.map((mistakes, i) => ({ mistakes, date: `2026-01-${String(i + 1).padStart(2, '0')}` }));

test('computeMistakeTrend needs at least 2 entries to call a trend', () => {
  assert.equal(w.computeMistakeTrend([]), 'none');
  assert.equal(w.computeMistakeTrend(trendEntries([4])), 'none');
});

test('computeMistakeTrend "improving" when the recent half averages fewer mistakes than the earlier half', () => {
  assert.equal(w.computeMistakeTrend(trendEntries([8, 2])), 'improving');
  assert.equal(w.computeMistakeTrend(trendEntries([9, 7, 1])), 'improving', 'odd count: extra entry stays in the earlier half');
});

test('computeMistakeTrend "regressing" when the recent half averages more mistakes than the earlier half', () => {
  assert.equal(w.computeMistakeTrend(trendEntries([1, 6])), 'regressing');
  assert.equal(w.computeMistakeTrend(trendEntries([1, 2, 9])), 'regressing');
});

test('computeMistakeTrend "steady" when the two halves average the same', () => {
  assert.equal(w.computeMistakeTrend(trendEntries([3, 3])), 'steady');
  assert.equal(w.computeMistakeTrend(trendEntries([2, 4, 3])), 'steady', 'earlier avg (2,4)=3 equals recent (3)');
});

test('computeMistakeTrend compares two halves, so a single old bad sitting does not mask a run of recent good ones', () => {
  assert.equal(w.computeMistakeTrend(trendEntries([10, 1, 1, 1, 1])), 'improving',
    'earlier half (10,1,1)=4 vs recent half (1,1)=1 — the old spike inflates the earlier average, not the recent one');
});

test('renderHizbSparkline renders a fixed-width placeholder for a Hizb with no sittings logged', () => {
  const html = w.renderHizbSparkline([]);
  assert.match(html, /hizb-overview-spark-empty/);
});

test('renderHizbSparkline renders one bar per entry with a tooltip naming its mistake count and date', () => {
  const html = w.renderHizbSparkline(trendEntries([0, 5]));
  const bars = html.match(/hizb-overview-spark-bar/g) || [];
  assert.equal(bars.length, 2);
  assert.match(html, /5 mistakes/);
  assert.match(html, /0 mistakes/);
});

test('renderHizbTrendBadge shows the arrow and color class matching computeMistakeTrend\'s classification', () => {
  assert.match(w.renderHizbTrendBadge(trendEntries([8, 2])), /trend-improving[^>]*>▼/);
  assert.match(w.renderHizbTrendBadge(trendEntries([1, 6])), /trend-regressing[^>]*>▲/);
  assert.match(w.renderHizbTrendBadge(trendEntries([3, 3])), /trend-steady[^>]*>—/);
  assert.match(w.renderHizbTrendBadge([]), /trend-none[^>]*><\/span>/);
});

// ─── Mutashabihat Finder ────────────────────────────────────────────────────

test('tokenizeAyah splits on whitespace and drops empty tokens', () => {
  assert.deepEqual(toPlain(w.tokenizeAyah('  الحمد لله   رب العالمين ')), ['الحمد', 'لله', 'رب', 'العالمين']);
});

test('normalizeArabicWord strips harakat/tatweel and unifies alef/ta-marbuta/alef-maqsura variants', () => {
  assert.equal(w.normalizeArabicWord('أَحَدٌ'), 'احد');
  assert.equal(w.normalizeArabicWord('إِلَـٰهٌ'), 'اله');
  assert.equal(w.normalizeArabicWord('رَحْمَة'), 'رحمه');
  assert.equal(w.normalizeArabicWord('هُدًى'), 'هدي');
});

test('jaccardSimilarity is 1 for identical word sets, 0 for disjoint sets, and partial for overlap', () => {
  assert.equal(w.jaccardSimilarity(['a', 'b', 'c'], ['a', 'b', 'c']), 1);
  assert.equal(w.jaccardSimilarity(['a', 'b'], ['c', 'd']), 0);
  assert.equal(w.jaccardSimilarity(['a', 'b'], ['a', 'c']), 1 / 3, 'intersection 1, union 3');
  assert.equal(w.jaccardSimilarity([], []), 0, 'empty/empty defined as 0, not NaN');
});

test('findSimilarAyat excludes the source ayah itself, skips ayat shorter than minWords, and sorts most-similar first', () => {
  const sourceWords = ['a', 'b', 'c', 'd'];
  const candidates = [
    { surah: 2, ayah: 1, text: 'a b c d' },       // same surah:ayah as source below in one call — excluded there
    { surah: 2, ayah: 2, text: 'a b c x' },       // 3/5 = 0.6
    { surah: 2, ayah: 3, text: 'a x y z' },       // 1/7 ≈ 0.14
    { surah: 2, ayah: 4, text: 'a b' },           // only 2 words — below minWords, skipped
  ];
  const matches = toPlain(w.findSimilarAyat(2, 1, sourceWords, candidates, 0.1, 4));
  assert.deepEqual(matches.map(m => `${m.surah}:${m.ayah}`), ['2:2', '2:3'], 'source ayah (2:1) excluded, 2:4 skipped for being too short, rest sorted by score');
  assert.ok(matches[0].score > matches[1].score);
});

test('findSimilarAyat returns nothing when the source ayah itself is shorter than minWords', () => {
  const matches = w.findSimilarAyat(2, 1, ['a', 'b'], [{ surah: 2, ayah: 2, text: 'a b c d' }], 0.1, 4);
  assert.deepEqual(toPlain(matches), []);
});

test('findSimilarAyahPairs finds every pair above threshold within a candidate list, sorted most-similar first', () => {
  const candidates = [
    { surah: 1, ayah: 1, text: 'alpha beta gamma delta' },
    { surah: 1, ayah: 2, text: 'alpha beta gamma epsilon' }, // 3/5 = 0.6 vs ayah 1
    { surah: 1, ayah: 3, text: 'zeta eta theta iota' },       // no overlap with either
  ];
  const pairs = toPlain(w.findSimilarAyahPairs(candidates, 0.3));
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].a.ayah, 1);
  assert.equal(pairs[0].b.ayah, 2);
  assert.ok(pairs[0].score > 0.3);
});

test('findSimilarAyahPairs excludes any ayah shorter than minWords from every pair', () => {
  const candidates = [
    { surah: 1, ayah: 1, text: 'alpha beta gamma delta' },
    { surah: 1, ayah: 2, text: 'alpha beta' }, // too short
  ];
  assert.deepEqual(toPlain(w.findSimilarAyahPairs(candidates, 0.1)), []);
});

test('mutashabihatFinderRangeBounds computes global ayah bounds for a surah range', () => {
  const bounds = toPlain(w.mutashabihatFinderRangeBounds('surah', 1, 1));
  assert.deepEqual(bounds, { globalStart: 1, globalEnd: 7 }, 'Surah 1 (Al-Fatiha) is ayat 1-7');
});

test('mutashabihatFinderRangeBounds normalizes a reversed From/To surah range the same as a forward one', () => {
  const forward = toPlain(w.mutashabihatFinderRangeBounds('surah', 1, 2));
  const reversed = toPlain(w.mutashabihatFinderRangeBounds('surah', 2, 1));
  assert.deepEqual(forward, reversed);
});

test('rangeAyahCount matches globalEnd - globalStart + 1 for a surah range', () => {
  assert.equal(w.rangeAyahCount('surah', 1, 1), 7, 'Al-Fatiha has 7 ayat');
});

test('mutashabihatGroupContainsPair is true only when a group has BOTH ayat, in either order', () => {
  const group = { ayat: [{ surah: 2, ayah: 5 }, { surah: 3, ayah: 10 }] };
  assert.equal(w.mutashabihatGroupContainsPair(group, 2, 5, 3, 10), true);
  assert.equal(w.mutashabihatGroupContainsPair(group, 3, 10, 2, 5), true, 'order of the pair args does not matter');
  assert.equal(w.mutashabihatGroupContainsPair(group, 2, 5, 9, 9), false, 'only one of the two ayat is present');
});

test('isMutashabihatPairAlreadySaved checks every group and returns false when none match', () => {
  const groups = [
    { ayat: [{ surah: 1, ayah: 1 }, { surah: 1, ayah: 2 }] },
    { ayat: [{ surah: 2, ayah: 5 }, { surah: 3, ayah: 10 }] },
  ];
  assert.equal(w.isMutashabihatPairAlreadySaved(groups, 2, 5, 3, 10), true);
  assert.equal(w.isMutashabihatPairAlreadySaved(groups, 2, 5, 4, 4), false);
});

test('runMutashabihatFinderByAyah end-to-end: searches the target surah, excludes the source ayah, renders results with a Save button, and the Save button persists a group', async () => {
  const realFetchSurahData = w.fetchSurahData;
  w.fetchSurahData = async (surahNum) => {
    if (surahNum === 1) {
      return {
        arabicAyahs: [
          { numberInSurah: 1, text: 'قالوا سبحانك لا علم لنا الا ما علمتنا' },
          { numberInSurah: 2, text: 'قالوا سبحانك لا علم لنا الا ما علمتنا انك' }, // near-identical to ayah 1
          { numberInSurah: 3, text: 'شيء مختلف تماما بدون اي تشابه هنا اطلاقا' }, // unrelated
        ],
      };
    }
    return { arabicAyahs: [] };
  };
  w.localStorage.clear();

  w.document.getElementById('mutashabihat-finder-ayah-surah').value = 1;
  w.document.getElementById('mutashabihat-finder-ayah-num').value = 1;
  w.document.getElementById('mutashabihat-finder-search-surah').value = 1;
  w.document.getElementById('mutashabihat-finder-ayah-threshold').value = '0.35';

  await w.runMutashabihatFinderByAyah();

  // mutashabihatFinderResults is a top-level `let` in review.html's inline
  // script — not attached to `window`, so it can't be read directly from
  // here (see loadPage.js's const/let caveat). Assert on the rendered DOM
  // (which the same closure writes to) instead.
  const resultsHtml = w.document.getElementById('mutashabihat-finder-results').innerHTML;
  assert.match(resultsHtml, /1:2/, 'result row references the matched ayah (1:3, unrelated, and 1:1, the source, are absent)');
  assert.doesNotMatch(resultsHtml, /1:3/, 'unrelated ayah 1:3 is below threshold');
  assert.match(resultsHtml, /Save as Mutashabihat/);

  // Click-equivalent: call the save handler the button's onclick would call.
  w.saveMutashabihatFinderPair(1, 1, 1, 2);
  const saved = toPlain(w.loadMutashabihatGroups());
  assert.equal(saved.length, 1);
  assert.deepEqual(saved[0].ayat, [{ surah: 1, ayah: 1 }, { surah: 1, ayah: 2 }]);

  // Re-rendering after the save should now show it as already saved.
  w.renderMutashabihatFinderResults();
  assert.match(w.document.getElementById('mutashabihat-finder-results').innerHTML, /✓ Saved/);

  w.localStorage.clear();
  w.fetchSurahData = realFetchSurahData;
});

test('runMutashabihatFinderByRange end-to-end: rejects an oversized surah range before searching', async () => {
  const originalAlert = w.alert;
  let alertMessage = null;
  w.alert = (msg) => { alertMessage = msg; };

  w.setMutashabihatFinderMode('range'); // also clears any previous results from the DOM
  w.setMutashabihatFinderRangeMode('surah');
  w.document.getElementById('mutashabihat-finder-surah-from').value = 1;
  w.document.getElementById('mutashabihat-finder-surah-to').value = 114; // whole mushaf — way over the cap

  await w.runMutashabihatFinderByRange();

  assert.match(alertMessage || '', /narrow it/);
  assert.equal(w.document.getElementById('mutashabihat-finder-results').innerHTML, '',
    'search never ran, so the results container stays cleared rather than showing stale/partial results');

  w.alert = originalAlert;
});

test('runMutashabihatFinderByRange end-to-end: a small in-range surah search finds and renders a similar pair', async () => {
  const realFetchSurahData = w.fetchSurahData;
  w.fetchSurahData = async (surahNum) => {
    if (surahNum === 1) {
      return {
        arabicAyahs: [
          { numberInSurah: 1, text: 'كلمات غير متشابهة على الاطلاق هنا فقط' },
          { numberInSurah: 2, text: 'جملة اخرى مختلفة تماما بلا اي علاقة ابدا' },
          { numberInSurah: 3, text: 'اهدنا الصراط المستقيم صراط الذين انعمت' },
          { numberInSurah: 4, text: 'اهدنا الصراط المستقيم صراط الذين انعمت عليهم' }, // near-identical to ayah 3
        ],
      };
    }
    return { arabicAyahs: [] };
  };
  w.localStorage.clear();

  w.setMutashabihatFinderMode('range');
  w.setMutashabihatFinderRangeMode('surah');
  w.document.getElementById('mutashabihat-finder-surah-from').value = 1;
  w.document.getElementById('mutashabihat-finder-surah-to').value = 1;
  w.document.getElementById('mutashabihat-finder-range-threshold').value = '0.35';

  await w.runMutashabihatFinderByRange();

  const resultsHtml = w.document.getElementById('mutashabihat-finder-results').innerHTML;
  assert.match(resultsHtml, /1:3/);
  assert.match(resultsHtml, /1:4/);
  assert.match(resultsHtml, /Save as Mutashabihat/);

  w.localStorage.clear();
  w.fetchSurahData = realFetchSurahData;
});
