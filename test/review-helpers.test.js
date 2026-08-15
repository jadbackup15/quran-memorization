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

test('parseAyahMistakesText parses "ayah note" lines and skips non-numeric lines, tagging every entry with the default surah', () => {
  const parsed = w.parseAyahMistakesText([
    'Mistakes', // header line — no leading number, skipped
    '207',
    '218 mutashabihat',
    '',
    '200 forgot ina',
  ].join('\n'), 2);

  assert.deepEqual(toPlain(parsed), [
    { surah: 2, ayah: 207, type: null, note: '' },
    { surah: 2, ayah: 218, type: null, note: 'mutashabihat' },
    { surah: 2, ayah: 200, type: null, note: 'forgot ina' },
  ]);
});

test('parseAyahMistakesText trims trailing whitespace/CR from each line', () => {
  const parsed = w.parseAyahMistakesText('221 note here \r\n230\r\n', 2);
  assert.deepEqual(toPlain(parsed), [
    { surah: 2, ayah: 221, type: null, note: 'note here' },
    { surah: 2, ayah: 230, type: null, note: '' },
  ]);
});

test('parseAyahMistakesText splits a leading type code (S/B/W/M/A) off the note', () => {
  const parsed = w.parseAyahMistakesText([
    '255 S',
    '218 B forgot ina',
    '10 w',              // lowercase code is normalized to uppercase
    '30 M multiple here',
    '40 A',
  ].join('\n'), 2);

  assert.deepEqual(toPlain(parsed), [
    { surah: 2, ayah: 255, type: 'S', note: '' },
    { surah: 2, ayah: 218, type: 'B', note: 'forgot ina' },
    { surah: 2, ayah: 10, type: 'W', note: '' },
    { surah: 2, ayah: 30, type: 'M', note: 'multiple here' },
    { surah: 2, ayah: 40, type: 'A', note: '' },
  ]);
});

test('parseAyahMistakesText also accepts the type code with no space before it, e.g. "255S"', () => {
  const parsed = w.parseAyahMistakesText([
    '255S',
    '218b',              // lowercase, no space — still normalized to uppercase
    '40A',
  ].join('\n'), 2);

  assert.deepEqual(toPlain(parsed), [
    { surah: 2, ayah: 255, type: 'S', note: '' },
    { surah: 2, ayah: 218, type: 'B', note: '' },
    { surah: 2, ayah: 40, type: 'A', note: '' },
  ]);
});

test('parseAyahMistakesText leaves a note untyped when it merely starts with a type letter', () => {
  // "Slow" starts with 'S' but isn't the standalone code "S" — word-boundary
  // check in splitMistakeTypeAndNote keeps this a plain note, unchanged from
  // before there was a type system at all.
  const parsed = w.parseAyahMistakesText('218 Slow and hesitant', 2);
  assert.deepEqual(toPlain(parsed), [{ surah: 2, ayah: 218, type: null, note: 'Slow and hesitant' }]);
});

test('parseAyahMistakesText switches the active surah on a "N:" override line, applying to every bare-ayah line after it', () => {
  const parsed = w.parseAyahMistakesText([
    '3:',       // switch to surah 3 — no ayah on this line
    '15',
    '16',
    '22',
    '24a',
  ].join('\n'), 2); // default/starting surah is 2, but "3:" overrides before any ayah line

  assert.deepEqual(toPlain(parsed), [
    { surah: 3, ayah: 15, type: null, note: '' },
    { surah: 3, ayah: 16, type: null, note: '' },
    { surah: 3, ayah: 22, type: null, note: '' },
    { surah: 3, ayah: 24, type: 'A', note: '' },
  ]);
});

test('parseAyahMistakesText "N:ayah" both switches the active surah AND logs that ayah as a mistake in one line', () => {
  const parsed = w.parseAyahMistakesText([
    '5',      // surah 2 (default), ayah 5
    '3:15',   // switches to surah 3 AND logs ayah 15
    '16',     // still surah 3
  ].join('\n'), 2);

  assert.deepEqual(toPlain(parsed), [
    { surah: 2, ayah: 5, type: null, note: '' },
    { surah: 3, ayah: 15, type: null, note: '' },
    { surah: 3, ayah: 16, type: null, note: '' },
  ]);
});

test('parseAyahMistakesText handles multiple surah switches in one paste, and a type code/note right after "N:ayah"', () => {
  const parsed = w.parseAyahMistakesText([
    '3:',
    '15',
    '2:22 S forgot ina', // switches BACK to surah 2, ayah 22, type S, note
    '23',                // still surah 2
  ].join('\n'), 1);

  assert.deepEqual(toPlain(parsed), [
    { surah: 3, ayah: 15, type: null, note: '' },
    { surah: 2, ayah: 22, type: 'S', note: 'forgot ina' },
    { surah: 2, ayah: 23, type: null, note: '' },
  ]);
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
  const parsed = w.parseAyahMistakesText('255SB', 2);
  assert.deepEqual(toPlain(parsed), [{ surah: 2, ayah: 255, type: 'BS', note: '' }]);
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
  w.setRecitationLogTimeframe('all'); // Recitation Log defaults to "Last 3 days" — this fixture's fixed date needs no timeframe filter to be visible/editable
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
  w.clearRecitationLogFilters();

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

test('importLogData only replaces "review" fields present in the file — an absent field is left untouched, not wiped', () => {
  w.localStorage.setItem('quranReviewMemorizedHizbs', JSON.stringify([1, 2, 3]));
  w.localStorage.setItem('quranReviewHizbLog', JSON.stringify([
    { id: 'existing', hizb: 5, mistakes: 4, date: '2026-08-01T00:00:00.000Z' },
  ]));
  w.localStorage.setItem('quranReviewAyahMistakes', JSON.stringify([]));
  w.localStorage.setItem('quranReviewMutashabihatPairs', JSON.stringify([
    { id: 'existing-g', ayat: [{ surah: 1, ayah: 1 }], note: 'keep me', dateAdded: '2026-08-01T00:00:00.000Z' },
  ]));

  const originalConfirm = w.confirm, originalAlert = w.alert;
  let confirmMessage = null, alertMessage = null;
  w.confirm = (msg) => { confirmMessage = msg; return true; };
  w.alert = (msg) => { alertMessage = msg; };

  // File only mentions memorizedHizbs — recitationLog, ayahMistakes, and
  // mutashabihatPairs are absent, so they must survive untouched.
  w.importLogData({ review: { memorizedHizbs: [7, 8] } });

  assert.match(confirmMessage, /2 memorized Hizb/);
  assert.doesNotMatch(confirmMessage, /recitation log/, 'the dialog only lists what will actually change');
  assert.match(alertMessage, /2 memorized Hizb/);

  assert.deepEqual(toPlain(w.loadMemorizedHizbs()), [7, 8], 'the mentioned field was replaced');
  assert.equal(w.loadHizbLog().length, 1, 'recitationLog was absent from the file — untouched, not wiped to []');
  assert.equal(w.loadHizbLog()[0].id, 'existing');
  assert.equal(w.loadMutashabihatGroups().length, 1, 'mutashabihatPairs was absent from the file — untouched');

  w.localStorage.clear();
  w.confirm = originalConfirm;
  w.alert = originalAlert;
});

test('importLogData imports mutashabihatPairs (previously silently ignored), upgrading the legacy two-ayah shape too', () => {
  w.localStorage.clear();
  const originalConfirm = w.confirm, originalAlert = w.alert;
  w.confirm = () => true;
  w.alert = () => {};

  w.importLogData({
    review: {
      mutashabihatPairs: [
        { ayat: [{ surah: 2, ayah: 62 }, { surah: 5, ayah: 69 }], note: 'famous one', dateAdded: '2026-08-01T00:00:00.000Z' },
        { surahA: 1, ayahA: 1, surahB: 1, ayahB: 2 }, // legacy shape, no `ayat` array
        { ayat: [{ surah: 1, ayah: 1 }] }, // a single-ayah group — must survive (MUTASHABIHAT_MIN_AYAT is 1, not 2)
      ],
    },
  });

  const groups = toPlain(w.loadMutashabihatGroups());
  assert.equal(groups.length, 3);
  assert.deepEqual(groups[0].ayat, [{ surah: 2, ayah: 62 }, { surah: 5, ayah: 69 }]);
  assert.equal(groups[0].note, 'famous one');
  assert.deepEqual(groups[1].ayat, [{ surah: 1, ayah: 1 }, { surah: 1, ayah: 2 }], 'legacy surahA/ayahA/surahB/ayahB shape upgraded');
  assert.deepEqual(groups[2].ayat, [{ surah: 1, ayah: 1 }], 'a lone-ayah group imports successfully');

  w.localStorage.clear();
  w.confirm = originalConfirm;
  w.alert = originalAlert;
});

test('importLogData declining the confirm makes no changes at all', () => {
  w.localStorage.setItem('quranReviewMutashabihatPairs', JSON.stringify([
    { id: 'existing-g', ayat: [{ surah: 1, ayah: 1 }], note: '', dateAdded: '2026-08-01T00:00:00.000Z' },
  ]));
  const originalConfirm = w.confirm;
  w.confirm = () => false;

  w.importLogData({ review: { mutashabihatPairs: [{ ayat: [{ surah: 9, ayah: 9 }] }] } });

  assert.equal(w.loadMutashabihatGroups().length, 1);
  assert.equal(w.loadMutashabihatGroups()[0].id, 'existing-g', 'the pre-existing group is untouched');

  w.localStorage.clear();
  w.confirm = originalConfirm;
});

test('importLogData alerts and makes no changes when the "review" section has none of the four recognized fields', () => {
  const originalAlert = w.alert;
  let alertMessage = null;
  w.alert = (msg) => { alertMessage = msg; };

  w.importLogData({ review: { someUnrelatedField: 'x' } });

  assert.match(alertMessage, /nothing to import/);

  w.alert = originalAlert;
});

test('filterMistakesByTimeframe works generically on any `.date`-bearing entry, not just mistakes', () => {
  const recent = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();
  const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const entries = [{ id: 's1', date: recent }, { id: 's2', date: old }];
  const filtered = toPlain(w.filterMistakesByTimeframe(entries, '7d'));
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].id, 's1');
  assert.equal(w.filterMistakesByTimeframe(entries, 'all'), entries, "'all' returns the same array untouched");
});

test('renderHizbLogTable applies the Hizb filter and the timeframe filter together', () => {
  const recent = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();
  const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  w.localStorage.setItem('quranReviewHizbLog', JSON.stringify([
    { id: 's1', hizb: 1, mistakes: 2, date: recent },
    { id: 's2', hizb: 1, mistakes: 1, date: old }, // right Hizb, wrong timeframe
    { id: 's3', hizb: 2, mistakes: 3, date: recent }, // right timeframe, wrong Hizb
  ]));

  w.setRecitationLogFilter('1');
  w.setRecitationLogTimeframe('7d');

  const html = w.document.getElementById('hizb-log-table').innerHTML;
  assert.match(html, /s1|2 mistake/); // sanity: something rendered
  const rows = (html.match(/log-hizb-clickable/g) || []).length;
  assert.equal(rows, 1, 'only s1 matches both the Hizb and the timeframe filter');

  w.clearRecitationLogFilters();
  w.localStorage.clear();
});

test('printRecitationLogMistakes prints only ayah mistakes within the current Hizb/timeframe filter, excludes type "A", and opens synchronously', () => {
  const recent = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();
  const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  w.localStorage.setItem('quranReviewAyahMistakes', JSON.stringify([
    { surah: 2, ayah: 5, hizb: 1, type: null, note: '', date: recent },   // in range
    { surah: 2, ayah: 6, hizb: 1, type: 'A', note: '', date: recent },     // excluded — not a mistake
    { surah: 2, ayah: 7, hizb: 1, type: 'S', note: '', date: old },     // out of the timeframe
    { surah: 3, ayah: 1, hizb: 5, type: null, note: '', date: recent },    // wrong Hizb
  ]));

  w.setRecitationLogFilter('1');
  w.setRecitationLogTimeframe('7d');

  let captured = null;
  const realOpen = w.window.open;
  w.window.open = () => ({
    document: { write: (h) => { captured = h; }, close: () => {} },
    focus: () => {},
    print: () => {},
  });

  w.printRecitationLogMistakes();

  assert.ok(captured, 'window.open was called synchronously, not skipped');
  assert.match(captured, /2:5/);
  assert.doesNotMatch(captured, /2:6/, 'type "A" excluded');
  assert.doesNotMatch(captured, /2:7/, 'outside the timeframe');
  assert.doesNotMatch(captured, /<td>3:1<\/td>/, 'wrong Hizb'); // anchored to the table cell — a bare /3:1/ can spuriously match the printed "Generated H:MM:SS" timestamp
  assert.match(captured, /1 mistake/, 'the summary count reflects only the one matching mistake');

  w.window.open = realOpen;
  w.clearRecitationLogFilters();
  w.localStorage.clear();
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

test('exportMutashabihatAsJsonFile downloads just the mutashabihat groups, in the same { ayat, note, dateAdded } shape as the full export', () => {
  w.localStorage.setItem('quranReviewMutashabihatPairs', JSON.stringify([
    { id: 'g1', ayat: [{ surah: 2, ayah: 62 }, { surah: 5, ayah: 69 }], note: 'famous one', dateAdded: '2026-08-01T10:00:00.000Z' },
  ]));

  let captured = null;
  const realDownload = w.downloadJsonFile;
  w.downloadJsonFile = (data, filename) => { captured = { data, filename }; };

  w.exportMutashabihatAsJsonFile();

  assert.match(captured.filename, /^mutashabihat-\d{4}-\d{2}-\d{2}\.json$/);
  assert.equal(captured.data.mutashabihatPairs.length, 1);
  assert.deepEqual(toPlain(captured.data.mutashabihatPairs[0].ayat), [{ surah: 2, ayah: 62 }, { surah: 5, ayah: 69 }]);
  assert.equal(captured.data.mutashabihatPairs[0].note, 'famous one');
  assert.ok(captured.data.exportedAt, 'has a formatted export timestamp');
  assert.ok(captured.data._note, 'has hand-editing guidance');

  w.downloadJsonFile = realDownload;
  w.localStorage.clear();
});

test('exportMutashabihatAsJsonFile downloads an empty list (not an error) when no groups are saved', () => {
  w.localStorage.clear();

  let captured = null;
  const realDownload = w.downloadJsonFile;
  w.downloadJsonFile = (data, filename) => { captured = { data, filename }; };

  w.exportMutashabihatAsJsonFile();

  assert.deepEqual(toPlain(captured.data.mutashabihatPairs), []);

  w.downloadJsonFile = realDownload;
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

test('wordOverlapSimilarity (overlap coefficient) is 1 for identical word sets, 0 for disjoint sets, and intersection/min(|A|,|B|) for overlap', () => {
  assert.equal(w.wordOverlapSimilarity(['a', 'b', 'c'], ['a', 'b', 'c']), 1);
  assert.equal(w.wordOverlapSimilarity(['a', 'b'], ['c', 'd']), 0);
  assert.equal(w.wordOverlapSimilarity(['a', 'b'], ['a', 'c']), 1 / 2, 'intersection 1, min(2,2) = 2 — NOT union (3), unlike Jaccard');
  assert.equal(w.wordOverlapSimilarity([], []), 0, 'empty/empty defined as 0, not NaN');
});

test('wordOverlapSimilarity scores a short ayah fully echoed inside a much longer one highly — the case Jaccard under-scores', () => {
  const short = ['a', 'b', 'c', 'd']; // fully contained within `long`
  const long = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l'];
  assert.equal(w.wordOverlapSimilarity(short, long), 1, 'every word of the shorter set reappears in the longer one');
});

test('normalizedAyahWords drops a standalone Quranic pause mark instead of counting it as a shared "word"', () => {
  // ۗ is a Quranic pause mark (ۗ) — normalizeArabicWord strips it down
  // to an empty string, which must not survive into the word list.
  const words = toPlain(w.normalizedAyahWords('بِسْمِ اللَّهِ ۗ الرَّحْمَٰنِ'));
  assert.ok(!words.includes(''), 'no empty-string token from the pause mark');
  assert.equal(words.length, 3);
});

test('findSimilarAyat excludes the source ayah itself, skips ayat shorter than minWords, and sorts most-similar first', () => {
  const sourceWords = ['a', 'b', 'c', 'd'];
  const candidates = [
    { surah: 2, ayah: 1, text: 'a b c d' },       // same surah:ayah as source below in one call — excluded there
    { surah: 2, ayah: 2, text: 'a b c x' },       // intersection 3, min(4,4)=4 -> 0.75
    { surah: 2, ayah: 3, text: 'a x y z' },       // intersection 1, min(4,4)=4 -> 0.25
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
    { surah: 1, ayah: 2, text: 'alpha beta gamma epsilon' }, // intersection 3, min(4,4)=4 -> 0.75 vs ayah 1
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

test('runMutashabihatFinderByAyah end-to-end: finds 3:19 <-> 2:213, a real mutashabihat pair Jaccard missed because 2:213 is ~3x longer than 3:19', async () => {
  // Real Uthmani text (via alquran.cloud) — regression test for the bug
  // report that "Loose" strictness found nothing for this pair. Jaccard
  // scored it ~0.20 (below even Loose's 0.35) because the shared phrase gets
  // diluted by 2:213's much larger, unrelated vocabulary; overlap
  // coefficient scores it ~0.46 since the shared words are ~46% of 3:19's
  // (the shorter ayah's) own vocabulary.
  // fetchSurahData's real arabicAyahs array is indexed so that ayah N sits at
  // index N-1 — the code under test relies on that (sourceAyahs[num-1]) and
  // also iterates the whole array with for-of (which yields `undefined` for
  // holes in a sparse array, unlike map/forEach). So every index up to the
  // target needs a real object; fillerAyahs makes short (sub-minWords)
  // placeholders that findSimilarAyat will just skip on its own.
  const fillerAyahs = (count) => Array.from({ length: count }, (_, i) => ({ numberInSurah: i + 1, text: 'x' }));

  const realFetchSurahData = w.fetchSurahData;
  w.fetchSurahData = async (surahNum) => {
    if (surahNum === 3) {
      const arabicAyahs = fillerAyahs(19);
      arabicAyahs[18] = { numberInSurah: 19, text: 'إِنَّ ٱلدِّينَ عِندَ ٱللَّهِ ٱلْإِسْلَٰمُ ۗ وَمَا ٱخْتَلَفَ ٱلَّذِينَ أُوتُوا۟ ٱلْكِتَٰبَ إِلَّا مِنۢ بَعْدِ مَا جَآءَهُمُ ٱلْعِلْمُ بَغْيًۢا بَيْنَهُمْ ۗ وَمَن يَكْفُرْ بِـَٔايَٰتِ ٱللَّهِ فَإِنَّ ٱللَّهَ سَرِيعُ ٱلْحِسَابِ' };
      return { arabicAyahs };
    }
    if (surahNum === 2) {
      const arabicAyahs = fillerAyahs(213);
      arabicAyahs[212] = { numberInSurah: 213, text: 'كَانَ ٱلنَّاسُ أُمَّةًۭ وَٰحِدَةًۭ فَبَعَثَ ٱللَّهُ ٱلنَّبِيِّۦنَ مُبَشِّرِينَ وَمُنذِرِينَ وَأَنزَلَ مَعَهُمُ ٱلْكِتَٰبَ بِٱلْحَقِّ لِيَحْكُمَ بَيْنَ ٱلنَّاسِ فِيمَا ٱخْتَلَفُوا۟ فِيهِ ۚ وَمَا ٱخْتَلَفَ فِيهِ إِلَّا ٱلَّذِينَ أُوتُوهُ مِنۢ بَعْدِ مَا جَآءَتْهُمُ ٱلْبَيِّنَٰتُ بَغْيًۢا بَيْنَهُمْ ۖ فَهَدَى ٱللَّهُ ٱلَّذِينَ ءَامَنُوا۟ لِمَا ٱخْتَلَفُوا۟ فِيهِ مِنَ ٱلْحَقِّ بِإِذْنِهِۦ ۗ وَٱللَّهُ يَهْدِى مَن يَشَآءُ إِلَىٰ صِرَٰطٍۢ مُّسْتَقِيمٍ' };
      return { arabicAyahs };
    }
    return { arabicAyahs: [] };
  };

  w.document.getElementById('mutashabihat-finder-ayah-surah').value = 3;
  w.document.getElementById('mutashabihat-finder-ayah-num').value = 19;
  w.document.getElementById('mutashabihat-finder-search-surah').value = 2;
  w.document.getElementById('mutashabihat-finder-ayah-threshold').value = '0.35'; // "Loose" — the strictness the bug report used

  await w.runMutashabihatFinderByAyah();

  const resultsHtml = w.document.getElementById('mutashabihat-finder-results').innerHTML;
  assert.match(resultsHtml, /2:213/, 'found at "Loose" strictness, matching the bug report');

  w.fetchSurahData = realFetchSurahData;
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

test('toggleMutashabihatFinderExpanded shows each result\'s full ayah text instead of the truncated preview, and back again', async () => {
  const realFetchSurahData = w.fetchSurahData;
  const fullAyah = 'اهدنا الصراط المستقيم صراط الذين انعمت عليهم غير المغضوب عليهم ولا الضالين';
  w.fetchSurahData = async (surahNum) => {
    if (surahNum === 1) {
      return {
        arabicAyahs: [
          { numberInSurah: 1, text: fullAyah },
          { numberInSurah: 2, text: fullAyah + ' زائد' },
        ],
      };
    }
    return { arabicAyahs: [] };
  };

  w.document.getElementById('mutashabihat-finder-ayah-surah').value = 1;
  w.document.getElementById('mutashabihat-finder-ayah-num').value = 1;
  w.document.getElementById('mutashabihat-finder-search-surah').value = 1;
  w.document.getElementById('mutashabihat-finder-ayah-threshold').value = '0.35';
  await w.runMutashabihatFinderByAyah();

  const truncatedHtml = w.document.getElementById('mutashabihat-finder-results').innerHTML;
  assert.match(truncatedHtml, /⤢ Expand All/);
  assert.doesNotMatch(truncatedHtml, new RegExp(fullAyah), 'collapsed by default — only the truncated opening words show');

  w.toggleMutashabihatFinderExpanded();
  const expandedHtml = w.document.getElementById('mutashabihat-finder-results').innerHTML;
  assert.match(expandedHtml, /Collapse All/);
  assert.match(expandedHtml, new RegExp(fullAyah), 'expanded — the full ayah text now shows');

  w.toggleMutashabihatFinderExpanded(); // leave global test state as found
  w.fetchSurahData = realFetchSurahData;
});

test('ayahIsInSurah: true for an ayah within range, false past the last ayah, false for ayah 0', () => {
  assert.equal(w.ayahIsInSurah(1, 7), true, 'Al-Fatiha has exactly 7 ayat');
  assert.equal(w.ayahIsInSurah(1, 8), false, 'Al-Fatiha has no 8th ayah');
  assert.equal(w.ayahIsInSurah(1, 0), false);
  assert.equal(w.ayahIsInSurah(114, 6), true, 'An-Nas has exactly 6 ayat');
  assert.equal(w.ayahIsInSurah(114, 7), false);
});

test('ayahIsInSurah: false for an unrecognized surah number', () => {
  assert.equal(w.ayahIsInSurah(0, 1), false);
  assert.equal(w.ayahIsInSurah(115, 1), false);
});

test('tapMistake alerts and does not log a mistake when the ayah number does not exist in the surah', () => {
  w.localStorage.clear();
  const originalAlert = w.alert;
  let alertMessage = null;
  w.alert = (msg) => { alertMessage = msg; };

  w.document.getElementById('session-hizb').value = '1';
  w.document.getElementById('session-mistake-surah').value = '1'; // Al-Fatiha — only 7 ayat
  w.document.getElementById('session-mistake-ayah').value = '9';
  w.document.getElementById('session-mistake-note').value = '';
  const countInput = w.document.getElementById('session-count');
  countInput.value = '0';

  w.tapMistake();

  assert.match(alertMessage, /1:9 doesn't exist/);
  assert.match(alertMessage, /Al-Fatiha only has 7 ayat/);
  assert.equal(countInput.value, '0', 'the mistake counter is not bumped — the whole tap is aborted');
  assert.equal(w.loadAyahMistakes().length, 0, 'no mistake was logged');

  w.alert = originalAlert;
  w.localStorage.clear();
});

test('importAyahMistakesFromText drops out-of-range ayah numbers (after confirmation) and keeps the valid ones', () => {
  w.localStorage.clear();
  const originalConfirm = w.confirm, originalAlert = w.alert;
  const confirmMessages = [];
  // Two confirms fire in sequence: first the "N ayah numbers don't exist,
  // skip them?" warning, then the normal "Add N ayah mistakes..." summary —
  // capture both instead of just the last one.
  w.confirm = (msg) => { confirmMessages.push(msg); return true; };
  w.alert = () => {};

  // Al-Fatiha (surah 1) has 7 ayat — 9 and 10 don't exist.
  const applied = w.importAyahMistakesFromText('3\n9\n10', 1);

  assert.equal(applied, true);
  assert.match(confirmMessages[0], /2 ayah numbers don't exist/);
  assert.match(confirmMessages[0], /1:9, 1:10/, 'each invalid ayah is labeled with its own surah, since a paste can now touch more than one');
  assert.match(confirmMessages[1], /Add 1 ayah mistake/, 'the final summary reflects only the 1 valid ayah');
  const mistakes = w.loadAyahMistakes();
  assert.equal(mistakes.length, 1, 'only the one valid ayah (3) was imported');
  assert.equal(mistakes[0].ayah, 3);

  w.confirm = originalConfirm;
  w.alert = originalAlert;
  w.localStorage.clear();
});

test('importAyahMistakesFromText throws (no confirm shown) when every pasted ayah number is out of range', () => {
  w.localStorage.clear();
  assert.throws(() => w.importAyahMistakesFromText('9\n10', 1), /None of the ayah numbers pasted/);
  assert.equal(w.loadAyahMistakes().length, 0);
});

test('importAyahMistakesFromText declining the confirm imports nothing', () => {
  w.localStorage.clear();
  const originalConfirm = w.confirm;
  w.confirm = () => false;

  const applied = w.importAyahMistakesFromText('3\n9', 1);

  assert.equal(applied, false);
  assert.equal(w.loadAyahMistakes().length, 0);

  w.confirm = originalConfirm;
  w.localStorage.clear();
});

// End-to-end: a single paste spanning Hizb 5's real surah boundary
// (Al-Baqara 253-286, then Aal-i-Imran 1-29), using the "3:" override
// syntax, matching the exact real-world shorthand this feature was built
// for (a screenshot of "3: / 15 / 16 / 22 / 24a" from the user's own notes).
test('importAyahMistakesFromText end-to-end: a "3:" override mid-paste spans two surahs that land in the same Hizb, producing one session for it', () => {
  w.localStorage.clear();
  const originalConfirm = w.confirm, originalAlert = w.alert;
  let confirmMessage = null, alertMessage = null;
  w.confirm = (msg) => { confirmMessage = msg; return true; };
  w.alert = (msg) => { alertMessage = msg; };

  // Default surah is 2 (Al-Baqara); ayah 280 is Al-Baqara, still Hizb 5.
  // "3:" switches to Aal-i-Imran (surah 3) for 15/16/22/24a, also Hizb 5.
  const applied = w.importAyahMistakesFromText('280\n3:\n15\n16\n22\n24a', 2);

  assert.equal(applied, true);
  assert.match(confirmMessage, /2\. Al-Baqara/);
  assert.match(confirmMessage, /3\. Aal-i-Imran/);
  assert.match(alertMessage, /2\. Al-Baqara/);
  assert.match(alertMessage, /3\. Aal-i-Imran/);

  const mistakes = toPlain(w.loadAyahMistakes());
  assert.equal(mistakes.length, 5);
  assert.ok(mistakes.every(m => m.hizb === 5), 'every ayah — from both surahs — landed in Hizb 5');
  const bySurah = { 2: mistakes.filter(m => m.surah === 2), 3: mistakes.filter(m => m.surah === 3) };
  assert.deepEqual(bySurah[2].map(m => m.ayah), [280]);
  assert.deepEqual(bySurah[3].map(m => m.ayah).sort((a, b) => a - b), [15, 16, 22, 24]);
  assert.equal(mistakes.find(m => m.ayah === 24 && m.surah === 3).type, 'A', '"24a" is a Needs-Attention flag, not a mistake');

  const log = w.loadHizbLog();
  assert.equal(log.length, 1, 'one Hizb 5 session, not one per surah — the session-merge logic groups by Hizb regardless of surah');
  assert.equal(log[0].hizb, 5);
  assert.equal(log[0].mistakes, 4, '4 real mistakes — 280, 15, 16, 22 — excluding the "A"-flagged 24');
  assert.ok(mistakes.every(m => m.sessionId === log[0].id), 'every mistake, from both surahs, links to the one merged session');

  w.confirm = originalConfirm;
  w.alert = originalAlert;
  w.localStorage.clear();
});

test('saveAyahMistakeEdit alerts and keeps the row in edit mode when the edited ayah number does not exist in the surah', () => {
  w.localStorage.clear();
  w.localStorage.setItem('quranReviewAyahMistakes', JSON.stringify([
    { id: 'm1', surah: 1, ayah: 3, hizb: 1, type: null, note: '', date: '2026-08-01T00:00:00.000Z' },
  ]));
  w.startAyahMistakeEdit('m1'); // editingAyahMistakeId is a top-level `let`, not on window — go through the real setter

  const originalAlert = w.alert;
  let alertMessage = null;
  w.alert = (msg) => { alertMessage = msg; };

  w.document.getElementById('edit-mistake-surah-m1').value = '1'; // Al-Fatiha — only 7 ayat
  w.document.getElementById('edit-mistake-ayah-m1').value = '20';

  w.saveAyahMistakeEdit('m1');

  assert.match(alertMessage, /1:20 doesn't exist/);
  // editingAyahMistakeId is a top-level `let`, not readable via `w.` — check
  // via the DOM instead: the edit-mode row (with its input fields) still
  // exists, meaning saveAyahMistakeEdit didn't call renderAyahMistakeLog()
  // in read-only mode.
  assert.ok(w.document.getElementById('edit-mistake-surah-m1'), 'edit mode is not exited — the row stays open so the mistake can be fixed');
  assert.equal(w.loadAyahMistakes()[0].ayah, 3, 'the stored mistake is unchanged');

  w.alert = originalAlert;
  w.cancelAyahMistakeEdit();
  w.localStorage.clear();
});

test('computeAllHizbsMistakes groups mistakes by Hizb, ranked most-mistakes-first, excluding type "A"', () => {
  w.localStorage.clear();
  w.localStorage.setItem('quranReviewAyahMistakes', JSON.stringify([
    { surah: 1, ayah: 1, hizb: 1, type: null, note: '', date: '2026-08-01T00:00:00.000Z' },
    { surah: 1, ayah: 2, hizb: 1, type: 'S', note: '', date: '2026-08-02T00:00:00.000Z' },
    { surah: 1, ayah: 3, hizb: 1, type: 'A', note: '', date: '2026-08-02T00:00:00.000Z' }, // excluded
    { surah: 2, ayah: 5, hizb: 2, type: null, note: '', date: '2026-08-01T00:00:00.000Z' },
  ]));

  const groups = toPlain(w.computeAllHizbsMistakes('all'));

  assert.equal(groups.length, 2);
  assert.equal(groups[0].hizb, 1, 'Hizb 1 (2 real mistakes) ranks above Hizb 2 (1)');
  assert.equal(groups[0].mistakes.length, 2);
  assert.equal(groups[1].hizb, 2);
  assert.equal(groups[1].mistakes.length, 1);

  w.localStorage.clear();
});

test('computeAllHizbsMistakes "last-session" mode uses only each Hizb\'s most recent session', () => {
  w.localStorage.clear();
  w.localStorage.setItem('quranReviewHizbLog', JSON.stringify([
    { id: 'h1-old', hizb: 1, mistakes: 2, date: '2026-07-01T00:00:00.000Z' },
    { id: 'h1-new', hizb: 1, mistakes: 1, date: '2026-08-01T00:00:00.000Z' },
  ]));
  w.localStorage.setItem('quranReviewAyahMistakes', JSON.stringify([
    { surah: 1, ayah: 1, hizb: 1, sessionId: 'h1-old', date: '2026-07-01T00:00:00.000Z' },
    { surah: 1, ayah: 2, hizb: 1, sessionId: 'h1-old', date: '2026-07-01T00:00:00.000Z' },
    { surah: 1, ayah: 3, hizb: 1, sessionId: 'h1-new', date: '2026-08-01T00:00:00.000Z' },
  ]));

  const groups = toPlain(w.computeAllHizbsMistakes('last-session'));

  assert.equal(groups.length, 1);
  assert.equal(groups[0].mistakes.length, 1, 'only the newer session\'s mistake counts');
  assert.equal(groups[0].mistakes[0].ayah, 3);

  w.localStorage.clear();
});

test('computeAllHizbsMistakes "7d" timeframe excludes mistakes older than 7 days', () => {
  w.localStorage.clear();
  const recent = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();
  const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  w.localStorage.setItem('quranReviewAyahMistakes', JSON.stringify([
    { surah: 1, ayah: 1, hizb: 1, type: null, note: '', date: recent },
    { surah: 1, ayah: 2, hizb: 1, type: null, note: '', date: old },
  ]));

  const groups = toPlain(w.computeAllHizbsMistakes('7d'));

  assert.equal(groups.length, 1);
  assert.equal(groups[0].mistakes.length, 1);
  assert.equal(groups[0].mistakes[0].ayah, 1);

  w.localStorage.clear();
});

test('renderAllHizbsMistakes shows a status message when nothing is logged, and the group summary once it is', () => {
  w.localStorage.clear();
  w.setAllHizbsMistakesTimeframe('all');
  w.renderAllHizbsMistakes();
  assert.match(w.document.getElementById('all-hizbs-mistakes').innerHTML, /No mistakes logged/);

  w.localStorage.setItem('quranReviewAyahMistakes', JSON.stringify([
    { surah: 1, ayah: 1, hizb: 1, type: null, note: '', date: '2026-08-01T00:00:00.000Z' },
  ]));
  w.renderAllHizbsMistakes();
  const html = w.document.getElementById('all-hizbs-mistakes').innerHTML;
  assert.match(html, /1 mistake across 1 Hizb/);
  assert.match(html, /Hizb 1/);
  assert.match(html, /1:1/);

  w.localStorage.clear();
});

test('printAllHizbsMistakes opens synchronously and includes every Hizb group', () => {
  w.localStorage.clear();
  w.localStorage.setItem('quranReviewAyahMistakes', JSON.stringify([
    { surah: 1, ayah: 1, hizb: 1, type: 'S', note: 'slow', date: '2026-08-01T00:00:00.000Z' },
    { surah: 2, ayah: 5, hizb: 2, type: null, note: '', date: '2026-08-01T00:00:00.000Z' },
  ]));
  w.setAllHizbsMistakesTimeframe('all');

  let captured = null;
  const realOpen = w.window.open;
  w.window.open = () => ({
    document: { write: (h) => { captured = h; }, close: () => {} },
    focus: () => {},
    print: () => {},
  });

  w.printAllHizbsMistakes();

  assert.ok(captured, 'window.open was called synchronously');
  assert.match(captured, /Hizb 1/);
  assert.match(captured, /Hizb 2/);
  assert.match(captured, /1:1/);
  assert.match(captured, /2:5/);

  w.window.open = realOpen;
  w.localStorage.clear();
});

test('toggleAllHizbsMistakesCollapsed hides each group\'s mistake rows but keeps the Hizb headers, and flips back on a second toggle', () => {
  w.localStorage.clear();
  w.localStorage.setItem('quranReviewAyahMistakes', JSON.stringify([
    { surah: 1, ayah: 1, hizb: 1, type: null, note: '', date: '2026-08-01T00:00:00.000Z' },
  ]));
  w.setAllHizbsMistakesTimeframe('all');
  w.renderAllHizbsMistakes();
  assert.match(w.document.getElementById('all-hizbs-mistakes').innerHTML, /1:1/, 'row visible before collapsing');

  w.toggleAllHizbsMistakesCollapsed();
  let html = w.document.getElementById('all-hizbs-mistakes').innerHTML;
  assert.match(html, /Hizb 1/, 'header still shown once collapsed');
  assert.doesNotMatch(html, /1:1/, 'the mistake row itself is hidden');
  assert.match(w.document.getElementById('all-hizbs-mistakes-collapse-btn').textContent, /Expand All/);

  w.toggleAllHizbsMistakesCollapsed();
  html = w.document.getElementById('all-hizbs-mistakes').innerHTML;
  assert.match(html, /1:1/, 'expanded again — the row is back');
  assert.match(w.document.getElementById('all-hizbs-mistakes-collapse-btn').textContent, /Collapse All/);

  w.localStorage.clear();
});

test('toggleHizbMistakeGroupCollapsed collapses/expands one Hizb group independently of the others, and the bulk button reflects mixed state', () => {
  w.localStorage.clear();
  w.localStorage.setItem('quranReviewAyahMistakes', JSON.stringify([
    { surah: 1, ayah: 1, hizb: 1, type: null, note: '', date: '2026-08-01T00:00:00.000Z' },
    { surah: 2, ayah: 5, hizb: 2, type: null, note: '', date: '2026-08-01T00:00:00.000Z' },
  ]));
  w.setAllHizbsMistakesTimeframe('all');
  w.renderAllHizbsMistakes();

  w.toggleHizbMistakeGroupCollapsed(1);
  let html = w.document.getElementById('all-hizbs-mistakes').innerHTML;
  assert.doesNotMatch(html, /1:1/, 'Hizb 1\'s row is hidden');
  assert.match(html, /2:5/, 'Hizb 2 is untouched — still expanded');
  assert.match(w.document.getElementById('all-hizbs-mistakes-collapse-btn').textContent, /Collapse All/, 'bulk button still offers "Collapse All" since Hizb 2 is still expanded');

  w.toggleHizbMistakeGroupCollapsed(1); // toggle back
  html = w.document.getElementById('all-hizbs-mistakes').innerHTML;
  assert.match(html, /1:1/, 'Hizb 1 expanded again');

  w.localStorage.clear();
});

test('computeAyahMistakeRanking narrows by timeframe independently of the type filter', () => {
  w.localStorage.clear();
  const recent = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();
  const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  w.localStorage.setItem('quranReviewAyahMistakes', JSON.stringify([
    { surah: 1, ayah: 1, hizb: 1, type: 'S', note: '', date: recent },
    { surah: 1, ayah: 2, hizb: 1, type: 'S', note: '', date: old },
  ]));

  const allTime = toPlain(w.computeAyahMistakeRanking('all', 'all'));
  assert.equal(allTime.length, 2);

  const last7d = toPlain(w.computeAyahMistakeRanking('all', '7d'));
  assert.equal(last7d.length, 1);
  assert.equal(last7d[0].ayah, 1);

  w.localStorage.clear();
});

test('setAyahMistakeRankingTimeframe narrows the on-screen ranking and toggles the active button', () => {
  w.localStorage.clear();
  const recent = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();
  const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  w.localStorage.setItem('quranReviewAyahMistakes', JSON.stringify([
    { surah: 1, ayah: 1, hizb: 1, type: null, note: '', date: recent },
    { surah: 1, ayah: 2, hizb: 1, type: null, note: '', date: old },
  ]));

  w.setAyahMistakeRankingTimeframe('7d');
  let html = w.document.getElementById('ayah-mistake-list').innerHTML;
  assert.match(html, /1:1/);
  assert.doesNotMatch(html, /1:2/);
  const activeBtn = w.document.querySelector('.ayah-ranking-timeframe-btn.active');
  assert.equal(activeBtn.dataset.tf, '7d');

  w.setAyahMistakeRankingTimeframe('all');
  html = w.document.getElementById('ayah-mistake-list').innerHTML;
  assert.match(html, /1:1/);
  assert.match(html, /1:2/);

  w.localStorage.clear();
});

test('printAyahMistakeRanking includes the current timeframe in its title and only the in-range ayat', () => {
  w.localStorage.clear();
  const recent = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();
  const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  w.localStorage.setItem('quranReviewAyahMistakes', JSON.stringify([
    { surah: 1, ayah: 1, hizb: 1, type: null, note: '', date: recent },
    { surah: 1, ayah: 2, hizb: 1, type: null, note: '', date: old },
  ]));
  w.setAyahMistakeRankingTimeframe('7d');

  let captured = null;
  const realOpen = w.window.open;
  w.window.open = () => ({
    document: { write: (h) => { captured = h; }, close: () => {} },
    focus: () => {},
    print: () => {},
  });

  w.printAyahMistakeRanking();

  assert.match(captured, /Ayat You Mistake Most — Last 7 Days/);
  assert.match(captured, /1:1/);
  // Anchored to the table cell — a bare /1:2/ can spuriously match the
  // printed "Generated H:MM:SS" timestamp (e.g. "...41:20 PM" contains "1:2").
  assert.doesNotMatch(captured, /<td>1:2<\/td>/);

  w.window.open = realOpen;
  w.setAyahMistakeRankingTimeframe('all');
  w.localStorage.clear();
});

test('Hizb Log defaults to the "session" sub-tab on load, with "review" hidden', () => {
  assert.equal(w.document.getElementById('log-subview-session').style.display, '');
  assert.equal(w.document.getElementById('log-subview-review').style.display, 'none');
  const activeSubtab = w.document.querySelector('.log-subtab.active');
  assert.equal(activeSubtab.dataset.subview, 'session');
});

test('setLogSubview switches which sub-view is visible and which sub-tab is active', () => {
  w.setLogSubview('review');
  assert.equal(w.document.getElementById('log-subview-session').style.display, 'none');
  assert.equal(w.document.getElementById('log-subview-review').style.display, '');
  assert.equal(w.document.querySelector('.log-subtab.active').dataset.subview, 'review');

  w.setLogSubview('session'); // leave global test state as found
});

test('switching to another top-level tab and back to Hizb Log preserves the last-selected sub-tab', () => {
  w.setLogSubview('review');
  w.setView('revise');
  w.setView('log');

  assert.equal(w.document.getElementById('log-subview-review').style.display, '', 'still on "review" — setView(\'log\') didn\'t reset it to "session"');
  assert.equal(w.document.querySelector('.log-subtab.active').dataset.subview, 'review');

  w.setLogSubview('session'); // leave global test state as found
});

test('setLogSubview also handles the "history" sub-tab (All Revision Clusters + Recitation Log)', () => {
  w.setLogSubview('history');
  assert.equal(w.document.getElementById('log-subview-session').style.display, 'none');
  assert.equal(w.document.getElementById('log-subview-review').style.display, 'none');
  assert.equal(w.document.getElementById('log-subview-history').style.display, '');
  assert.equal(w.document.querySelector('.log-subtab.active').dataset.subview, 'history');

  w.setLogSubview('session'); // leave global test state as found
});

test('Review & Analyze holds Hizb Overview, All Hizbs Mistakes, Ayat You Mistake Most, Needs Attention in that order; Clusters & History holds All Revision Clusters then Recitation Log', () => {
  const reviewHtml = w.document.getElementById('log-subview-review').innerHTML;
  const overviewIdx = reviewHtml.indexOf('<h2>Hizb Overview');
  const allHizbsIdx = reviewHtml.indexOf('<h2>All Hizbs');
  const rankingIdx = reviewHtml.indexOf('<h2>Ayat You Mistake Most');
  // Anchored to the <h2> tag, not a bare substring search — the "Ayat You
  // Mistake Most" section's own hint text mentions "(Needs Attention)"
  // well before the real "Needs Attention" section further down.
  const attentionIdx = reviewHtml.indexOf('<h2>Needs Attention');
  assert.ok(overviewIdx >= 0 && allHizbsIdx > overviewIdx && rankingIdx > allHizbsIdx && attentionIdx > rankingIdx,
    'Hizb Overview, then All Hizbs Mistakes, then Ayat You Mistake Most, then Needs Attention');

  const historyHtml = w.document.getElementById('log-subview-history').innerHTML;
  const clustersIdx = historyHtml.indexOf('All Revision Clusters');
  const recitationLogIdx = historyHtml.indexOf('Recitation Log');
  assert.ok(clustersIdx >= 0 && recitationLogIdx > clustersIdx, 'All Revision Clusters, then Recitation Log');
});

test('"Import Mistakes" (the paste-import box) lives in the "Log a Session" sub-tab, not "Review & Analyze"', () => {
  const sessionHtml = w.document.getElementById('log-subview-session').innerHTML;
  assert.match(sessionHtml, /<h2>Import Mistakes/);
  assert.ok(sessionHtml.includes('id="mistake-import-surah"'));
  assert.ok(sessionHtml.includes('id="mistake-import-text"'));
  assert.ok(sessionHtml.includes('id="mistake-type-legend"'), 'the type-code legend moved with it, shared with the live tap flow above');

  const reviewHtml = w.document.getElementById('log-subview-review').innerHTML;
  assert.doesNotMatch(reviewHtml, /<h2>Import Mistakes/);
  assert.ok(!reviewHtml.includes('id="mistake-import-text"'), 'no leftover duplicate in Review & Analyze');
  assert.match(reviewHtml, /Edit individual ayah mistakes/, '"Edit individual ayah mistakes" stayed with "Ayat You Mistake Most"');
});

test('Ayat Ranking, All Hizbs Mistakes, All Revision Clusters, and Recitation Log all default to the "Last Session" timeframe on a fresh load', () => {
  const fresh = loadPage('review.html').window;
  assert.equal(fresh.document.querySelector('.ayah-ranking-timeframe-btn.active').dataset.tf, 'last-session');
  assert.equal(fresh.document.querySelector('.all-hizbs-mistakes-timeframe-btn.active').dataset.tf, 'last-session');
  assert.equal(fresh.document.querySelector('.all-clusters-timeframe-btn.active').dataset.tf, 'last-session');
  assert.equal(fresh.document.querySelector('.recitation-log-timeframe-btn.active').dataset.tf, 'last-session');
});

test('every timeframe toggle (Ayat Ranking, All Hizbs Mistakes, All Revision Clusters, Recitation Log) offers a "Last Session" option', () => {
  const groups = ['.ayah-ranking-timeframe-btn', '.all-hizbs-mistakes-timeframe-btn', '.all-clusters-timeframe-btn', '.recitation-log-timeframe-btn'];
  groups.forEach(cls => {
    const tfs = Array.from(w.document.querySelectorAll(cls)).map(b => b.dataset.tf);
    assert.ok(tfs.includes('last-session'), `${cls} is missing a "Last Session" button`);
  });
});

test('computeAyahMistakeRanking "last-session" pools each Hizb\'s single most recent session, not a date window', () => {
  w.localStorage.clear();
  w.localStorage.setItem('quranReviewHizbLog', JSON.stringify([
    { id: 'h1-old', hizb: 1, mistakes: 2, date: '2026-07-01T00:00:00.000Z' },
    { id: 'h1-new', hizb: 1, mistakes: 1, date: '2026-08-01T00:00:00.000Z' },
  ]));
  w.localStorage.setItem('quranReviewAyahMistakes', JSON.stringify([
    { surah: 1, ayah: 1, hizb: 1, sessionId: 'h1-old', date: '2026-07-01T00:00:00.000Z' },
    { surah: 1, ayah: 2, hizb: 1, sessionId: 'h1-new', date: '2026-08-01T00:00:00.000Z' },
  ]));

  const ranking = toPlain(w.computeAyahMistakeRanking('all', 'last-session'));
  assert.equal(ranking.length, 1, 'only the newer session\'s mistake counts');
  assert.equal(ranking[0].ayah, 2);

  w.localStorage.clear();
});

test('renderHizbLogTable "last-session" mode shows one row per Hizb, its single most recent session', () => {
  w.localStorage.clear();
  w.localStorage.setItem('quranReviewHizbLog', JSON.stringify([
    { id: 'h1-old', hizb: 1, mistakes: 3, date: '2026-07-01T00:00:00.000Z' },
    { id: 'h1-new', hizb: 1, mistakes: 1, date: '2026-08-01T00:00:00.000Z' },
    { id: 'h2-only', hizb: 2, mistakes: 2, date: '2026-07-15T00:00:00.000Z' },
  ]));

  w.setRecitationLogFilter('all');
  w.setRecitationLogTimeframe('last-session');

  const html = w.document.getElementById('hizb-log-table').innerHTML;
  assert.match(html, /1 mistake/, 'Hizb 1\'s newer session (1 mistake), not its older one (3 mistakes)');
  assert.doesNotMatch(html, /3 mistake/, 'the older Hizb 1 session is excluded');
  assert.match(html, /2 mistake/, 'Hizb 2\'s only session still shows');
  const rows = (html.match(/log-hizb-clickable/g) || []).length;
  assert.equal(rows, 2, 'one row per Hizb');

  w.localStorage.clear();
  w.clearRecitationLogFilters();
});

test('printRecitationLogMistakes "last-session" mode prints only each (filtered) Hizb\'s latest session\'s mistakes', () => {
  w.localStorage.clear();
  w.localStorage.setItem('quranReviewHizbLog', JSON.stringify([
    { id: 'h1-old', hizb: 1, mistakes: 1, date: '2026-07-01T00:00:00.000Z' },
    { id: 'h1-new', hizb: 1, mistakes: 1, date: '2026-08-01T00:00:00.000Z' },
  ]));
  w.localStorage.setItem('quranReviewAyahMistakes', JSON.stringify([
    { surah: 1, ayah: 1, hizb: 1, sessionId: 'h1-old', date: '2026-07-01T00:00:00.000Z' },
    { surah: 1, ayah: 2, hizb: 1, sessionId: 'h1-new', date: '2026-08-01T00:00:00.000Z' },
  ]));

  w.setRecitationLogFilter('all');
  w.setRecitationLogTimeframe('last-session');

  let captured = null;
  const realOpen = w.window.open;
  w.window.open = () => ({
    document: { write: (h) => { captured = h; }, close: () => {} },
    focus: () => {},
    print: () => {},
  });

  w.printRecitationLogMistakes();

  assert.match(captured, /Last Session/, 'title reflects the timeframe');
  assert.match(captured, /1:2/, 'the newer session\'s mistake is included');
  // Anchored to the table cell — a bare /1:1/ can spuriously match the
  // printed "Generated H:MM:SS" timestamp.
  assert.doesNotMatch(captured, /<td>1:1<\/td>/, 'the older session\'s mistake is excluded');

  w.window.open = realOpen;
  w.localStorage.clear();
  w.clearRecitationLogFilters();
});

test('aggregateMistakesByAyah collapses repeated taps on the same ayah into one row with a count, sorted most-mistakes-first', () => {
  const mistakes = [
    { surah: 2, ayah: 213, type: 'S', note: 'first', date: '2026-08-11T00:00:00.000Z' },
    { surah: 2, ayah: 218, type: null, note: '', date: '2026-08-13T00:00:00.000Z' },
    { surah: 2, ayah: 213, type: 'B', note: 'second', date: '2026-08-13T00:00:00.000Z' },
  ];
  const aggregated = toPlain(w.aggregateMistakesByAyah(mistakes));

  assert.equal(aggregated.length, 2, '2:213\'s two taps collapse into one row');
  assert.equal(aggregated[0].ayah, 213, 'most-mistakes-first — 2:213 has 2, 2:218 has 1');
  assert.equal(aggregated[0].count, 2);
  assert.equal(aggregated[0].latestType, 'B', 'keeps the most recently-tapped type');
  assert.equal(aggregated[0].latestNote, 'second', 'keeps the most recently-tapped note');
  assert.equal(aggregated[1].ayah, 218);
  assert.equal(aggregated[1].count, 1);
});

test('renderAllHizbsMistakes aggregates repeated ayat within a Hizb and sorts them by count, most first', () => {
  w.localStorage.clear();
  w.localStorage.setItem('quranReviewAyahMistakes', JSON.stringify([
    { surah: 2, ayah: 213, hizb: 4, type: null, note: '', date: '2026-08-11T00:00:00.000Z' },
    { surah: 2, ayah: 218, hizb: 4, type: null, note: '', date: '2026-08-13T00:00:00.000Z' },
    { surah: 2, ayah: 213, hizb: 4, type: null, note: '', date: '2026-08-13T00:00:00.000Z' },
  ]));
  w.setAllHizbsMistakesTimeframe('all');

  const html = w.document.getElementById('all-hizbs-mistakes').innerHTML;
  const idx213 = html.indexOf('2:213');
  const idx218 = html.indexOf('2:218');
  assert.ok(idx213 >= 0 && idx218 > idx213, '2:213 (2 mistakes) sorts above 2:218 (1 mistake), and each ayah appears only once');
  assert.match(html, /2 mistakes/, 'shows the aggregated count for 2:213');
  // Anchored to the visible tag content — a bare /2:213/g also matches the
  // expand toggle's onclick="toggleAllHizbsMistakeAyahExpand('2:213')" arg.
  assert.equal((html.match(/>2:213</g) || []).length, 1, '2:213 is not listed twice');

  w.localStorage.clear();
});

test('printAllHizbsMistakes aggregates repeated ayat and includes a Mistakes count column', () => {
  w.localStorage.clear();
  w.localStorage.setItem('quranReviewAyahMistakes', JSON.stringify([
    { surah: 2, ayah: 213, hizb: 4, type: null, note: '', date: '2026-08-11T00:00:00.000Z' },
    { surah: 2, ayah: 213, hizb: 4, type: null, note: '', date: '2026-08-13T00:00:00.000Z' },
  ]));
  w.setAllHizbsMistakesTimeframe('all');

  let captured = null;
  const realOpen = w.window.open;
  w.window.open = () => ({
    document: { write: (h) => { captured = h; }, close: () => {} },
    focus: () => {},
    print: () => {},
  });

  w.printAllHizbsMistakes();

  assert.equal((captured.match(/2:213/g) || []).length, 1, '2:213 is printed once, not once per tap');
  assert.match(captured, /<td>2<\/td>/, 'the aggregated count (2) appears as its own table cell');

  w.window.open = realOpen;
  w.localStorage.clear();
});

test('toggleAllHizbsMistakeAyahExpand reveals the individual taps behind an aggregated (count > 1) row, and a count-1 row has no expand toggle at all', () => {
  w.localStorage.clear();
  w.localStorage.setItem('quranReviewAyahMistakes', JSON.stringify([
    { surah: 2, ayah: 213, hizb: 4, type: 'S', note: 'first tap', date: '2026-08-11T00:00:00.000Z' },
    { surah: 2, ayah: 213, hizb: 4, type: 'B', note: 'second tap', date: '2026-08-13T00:00:00.000Z' },
    { surah: 2, ayah: 218, hizb: 4, type: null, note: '', date: '2026-08-13T00:00:00.000Z' },
  ]));
  w.setAllHizbsMistakesTimeframe('all');

  let html = w.document.getElementById('all-hizbs-mistakes').innerHTML;
  assert.doesNotMatch(html, /first tap/, 'collapsed by default — individual taps not shown yet');
  assert.doesNotMatch(html, /toggleAllHizbsMistakeAyahExpand\('2:218'\)/, 'a count-1 row (2:218) gets no expand toggle at all');
  assert.match(html, /toggleAllHizbsMistakeAyahExpand\('2:213'\)/, 'a count-2 row (2:213) does get one');

  w.toggleAllHizbsMistakeAyahExpand('2:213');
  html = w.document.getElementById('all-hizbs-mistakes').innerHTML;
  assert.match(html, /first tap/, 'expanded — both individual taps now show');
  assert.match(html, /second tap/);

  w.toggleAllHizbsMistakeAyahExpand('2:213');
  html = w.document.getElementById('all-hizbs-mistakes').innerHTML;
  assert.doesNotMatch(html, /first tap/, 'collapsed again');

  w.localStorage.clear();
});

test('toggleAyahRankingExpand reveals the individual taps behind an aggregated ranking row, and a count-1 row has no expand toggle', () => {
  w.localStorage.clear();
  w.localStorage.setItem('quranReviewAyahMistakes', JSON.stringify([
    { surah: 2, ayah: 213, hizb: 4, type: 'S', note: 'first tap', date: '2026-08-11T00:00:00.000Z' },
    { surah: 2, ayah: 213, hizb: 4, type: 'B', note: 'second tap', date: '2026-08-13T00:00:00.000Z' },
    { surah: 2, ayah: 218, hizb: 4, type: null, note: '', date: '2026-08-13T00:00:00.000Z' },
  ]));
  w.setAyahMistakeRankingTimeframe('all');

  let html = w.document.getElementById('ayah-mistake-list').innerHTML;
  assert.doesNotMatch(html, /first tap/, 'collapsed by default');
  assert.doesNotMatch(html, /toggleAyahRankingExpand\('2:218'\)/, 'a count-1 row gets no expand toggle');
  assert.match(html, /toggleAyahRankingExpand\('2:213'\)/, 'a count-2 row does');

  w.toggleAyahRankingExpand('2:213');
  html = w.document.getElementById('ayah-mistake-list').innerHTML;
  assert.match(html, /first tap/);
  assert.match(html, /second tap/);

  w.toggleAyahRankingExpand('2:213'); // leave state as found
  w.setAyahMistakeRankingTimeframe('3d'); // restore default
  w.localStorage.clear();
});

test('toggleRecitationLogSessionMistakes reveals a session\'s aggregated ayah mistakes, and notes when the session tally is higher than the ayah-tagged count', () => {
  w.localStorage.clear();
  w.localStorage.setItem('quranReviewHizbLog', JSON.stringify([
    { id: 's1', hizb: 1, mistakes: 5, date: '2026-08-01T00:00:00.000Z' },
  ]));
  w.localStorage.setItem('quranReviewAyahMistakes', JSON.stringify([
    { surah: 1, ayah: 1, hizb: 1, sessionId: 's1', type: 'S', note: '', date: '2026-08-01T00:00:00.000Z' },
    { surah: 1, ayah: 1, hizb: 1, sessionId: 's1', type: 'B', note: '', date: '2026-08-01T00:00:00.000Z' },
    // only 2 of the session's 5 tallied mistakes have an ayah attached
  ]));
  w.setRecitationLogTimeframe('all');

  let html = w.document.getElementById('hizb-log-table').innerHTML;
  assert.doesNotMatch(html, /session-mistakes/, 'collapsed by default');

  w.toggleRecitationLogSessionMistakes('s1');
  html = w.document.getElementById('hizb-log-table').innerHTML;
  assert.match(html, />1:1</, 'shows the session\'s one aggregated ayah row');
  assert.match(html, /2 mistakes/, '1:1 was tapped twice within this session');
  assert.match(html, /2 of 5 mistakes have an ayah logged/, 'flags the mismatch between the session tally and ayah-tagged count');

  w.toggleRecitationLogSessionMistakes('s1'); // collapse again
  html = w.document.getElementById('hizb-log-table').innerHTML;
  assert.doesNotMatch(html, /session-mistakes/);

  w.localStorage.clear();
  w.clearRecitationLogFilters();
});

test('toggleRecitationLogSessionMistakes shows a status message for a session with no ayah-level mistakes', () => {
  w.localStorage.clear();
  w.localStorage.setItem('quranReviewHizbLog', JSON.stringify([
    { id: 's1', hizb: 1, mistakes: 3, date: '2026-08-01T00:00:00.000Z' },
  ]));
  w.setRecitationLogTimeframe('all');

  w.toggleRecitationLogSessionMistakes('s1');
  const html = w.document.getElementById('hizb-log-table').innerHTML;
  assert.match(html, /No ayah-level mistakes logged for this session/);

  w.toggleRecitationLogSessionMistakes('s1');
  w.localStorage.clear();
  w.clearRecitationLogFilters();
});

// Hizb 5 straddles a surah boundary: Al-Baqara 253-286, then Aal-i-Imran
// 1-29 — a real-world case where one Hizb needs two separate paste-imports
// (one per surah), which importAyahMistakesFromText should merge into a
// single same-day session rather than splitting into two.
test('importAyahMistakesFromText merges into today\'s existing session for a Hizb instead of creating a second one', () => {
  w.localStorage.clear();
  const today = new Date().toISOString();
  w.localStorage.setItem('quranReviewHizbLog', JSON.stringify([
    { id: 'existing1', hizb: 5, mistakes: 3, date: today },
  ]));
  const originalConfirm = w.confirm, originalAlert = w.alert;
  let confirmMessage = null, alertMessage = null;
  w.confirm = (msg) => { confirmMessage = msg; return true; };
  w.alert = (msg) => { alertMessage = msg; };

  // Aal-i-Imran (surah 3) ayat 1 and 2 fall in Hizb 5, same as the Al-Baqara
  // ayat presumably already imported earlier (the existing session above).
  const applied = w.importAyahMistakesFromText('1\n2', 3);

  assert.equal(applied, true);
  assert.match(confirmMessage, /1 existing today's session updated \(Hizb 5\)/);
  assert.match(alertMessage, /1 existing today's session updated \(Hizb 5\)/);

  const log = w.loadHizbLog();
  assert.equal(log.length, 1, 'merged into the existing session — no second row for Hizb 5');
  assert.equal(log[0].id, 'existing1', 'the original session id is preserved');
  assert.equal(log[0].mistakes, 5, '3 existing + 2 newly-imported');

  const mistakes = w.loadAyahMistakes();
  assert.ok(mistakes.every(m => m.sessionId === 'existing1'), 'the new ayah mistakes link to the merged (existing) session');

  w.confirm = originalConfirm;
  w.alert = originalAlert;
  w.localStorage.clear();
});

test('importAyahMistakesFromText does NOT merge into a same-Hizb session from a different day — starts a new one instead', () => {
  w.localStorage.clear();
  w.localStorage.setItem('quranReviewHizbLog', JSON.stringify([
    { id: 'yesterday1', hizb: 5, mistakes: 3, date: '2026-07-01T00:00:00.000Z' },
  ]));
  const originalConfirm = w.confirm, originalAlert = w.alert;
  w.confirm = () => true;
  w.alert = () => {};

  w.importAyahMistakesFromText('1\n2', 3);

  const log = w.loadHizbLog();
  assert.equal(log.length, 2, 'the older session is untouched; a new one is created for today');
  const yesterday = log.find(e => e.id === 'yesterday1');
  assert.equal(yesterday.mistakes, 3, 'not merged into — count unchanged');
  const newSession = log.find(e => e.id !== 'yesterday1');
  assert.equal(newSession.mistakes, 2);

  w.confirm = originalConfirm;
  w.alert = originalAlert;
  w.localStorage.clear();
});

test('importAyahMistakesFromText merges into a same-day session that was created by a live Recitation Session (not just a prior paste-import)', () => {
  w.localStorage.clear();
  const today = new Date().toISOString();
  w.localStorage.setItem('quranReviewHizbLog', JSON.stringify([
    { id: 'live1', hizb: 5, mistakes: 4, date: today }, // as if logged via tapMistake()/autoSaveSession()
  ]));
  const originalConfirm = w.confirm, originalAlert = w.alert;
  w.confirm = () => true;
  w.alert = () => {};

  w.importAyahMistakesFromText('1', 3);

  const log = w.loadHizbLog();
  assert.equal(log.length, 1);
  assert.equal(log[0].id, 'live1');
  assert.equal(log[0].mistakes, 5, '4 from the live session + 1 newly-imported');

  w.confirm = originalConfirm;
  w.alert = originalAlert;
  w.localStorage.clear();
});

// "Last Session" everywhere means a whole calendar day's sittings for a
// Hizb, not one literal timestamp — e.g. 3 separate sessions logged
// yesterday for Hizb 1 should all count, not just the very last of the 3.

test('latestSessionDayEntriesForHizb returns every session from a Hizb\'s most recent day, not just the single latest entry', () => {
  // Small (1-2 minute) offsets from the same base timestamp — not hours —
  // so this can never accidentally cross a day boundary depending on what
  // time of day the test happens to run at.
  const yesterday = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000);
  const yesterdayLater = new Date(yesterday.getTime() + 1 * 60 * 1000);
  const yesterdayLatest = new Date(yesterday.getTime() + 2 * 60 * 1000);
  const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);

  const log = [
    { id: 's1', hizb: 1, mistakes: 2, date: yesterday.toISOString() },
    { id: 's2', hizb: 1, mistakes: 1, date: yesterdayLater.toISOString() },
    { id: 's3', hizb: 1, mistakes: 3, date: yesterdayLatest.toISOString() },
    { id: 'old', hizb: 1, mistakes: 5, date: twoDaysAgo.toISOString() }, // different day — excluded
    { id: 'other-hizb', hizb: 2, mistakes: 1, date: yesterday.toISOString() },
  ];

  const result = toPlain(w.latestSessionDayEntriesForHizb(1, log));
  assert.deepEqual(result.map(e => e.id).sort(), ['s1', 's2', 's3'], 'all 3 of Hizb 1\'s sessions from its most recent day, none from 2 days ago, none from Hizb 2');
});

test('latestSessionDayEntriesForHizb returns an empty array for a Hizb with no sessions', () => {
  assert.deepEqual(toPlain(w.latestSessionDayEntriesForHizb(9, [])), []);
});

test('ayahMistakesForSessions pools mistakes across several sessions (same Hizb), each mistake counted only once', () => {
  w.localStorage.clear();
  const day = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();
  const sessions = [
    { id: 's1', hizb: 1, date: day },
    { id: 's2', hizb: 1, date: day },
  ];
  w.localStorage.setItem('quranReviewAyahMistakes', JSON.stringify([
    { surah: 1, ayah: 1, hizb: 1, sessionId: 's1', date: day },
    { surah: 1, ayah: 2, hizb: 1, sessionId: 's2', date: day },
    { surah: 1, ayah: 3, hizb: 1, sessionId: null, date: day }, // legacy, same-day fallback
    { surah: 1, ayah: 4, hizb: 1, sessionId: 'unrelated-session', date: day }, // not one of ours — excluded
  ]));

  const result = toPlain(w.ayahMistakesForSessions(sessions));
  assert.deepEqual(result.map(m => m.ayah).sort(), [1, 2, 3], 's1-linked + s2-linked + the legacy same-day fallback, not the unrelated session\'s mistake');

  w.localStorage.clear();
});

test('computeAllHizbsMistakes "last-session" pools every session from a Hizb\'s most recent day, not just the single latest one', () => {
  w.localStorage.clear();
  const yesterday = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();
  const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
  w.localStorage.setItem('quranReviewHizbLog', JSON.stringify([
    { id: 's1', hizb: 1, mistakes: 1, date: yesterday },
    { id: 's2', hizb: 1, mistakes: 1, date: yesterday },
    { id: 's3', hizb: 1, mistakes: 1, date: yesterday },
    { id: 'old', hizb: 1, mistakes: 1, date: twoDaysAgo },
  ]));
  w.localStorage.setItem('quranReviewAyahMistakes', JSON.stringify([
    { surah: 1, ayah: 1, hizb: 1, sessionId: 's1', type: null, note: '', date: yesterday },
    { surah: 1, ayah: 2, hizb: 1, sessionId: 's2', type: null, note: '', date: yesterday },
    { surah: 1, ayah: 3, hizb: 1, sessionId: 's3', type: null, note: '', date: yesterday },
    { surah: 1, ayah: 7, hizb: 1, sessionId: 'old', type: null, note: '', date: twoDaysAgo },
  ]));

  const groups = toPlain(w.computeAllHizbsMistakes('last-session'));
  assert.equal(groups.length, 1);
  assert.equal(groups[0].mistakes.length, 3, 'all 3 of yesterday\'s sessions\' mistakes, not just the last one\'s');
  assert.ok(groups[0].mistakes.every(m => m.ayah !== 7), 'the 2-days-ago session is excluded');

  w.localStorage.clear();
});

test('computeLatestSessionClustersForAllHizb pools every session from a Hizb\'s most recent day before clustering', () => {
  w.localStorage.clear();
  const yesterday = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();
  w.localStorage.setItem('quranReviewHizbLog', JSON.stringify([
    { id: 's1', hizb: 1, mistakes: 1, date: yesterday },
    { id: 's2', hizb: 1, mistakes: 1, date: yesterday },
  ]));
  w.localStorage.setItem('quranReviewAyahMistakes', JSON.stringify([
    { surah: 1, ayah: 1, hizb: 1, sessionId: 's1', date: yesterday },
    { surah: 1, ayah: 2, hizb: 1, sessionId: 's2', date: yesterday }, // close to ayah 1 — pools into one cluster
  ]));

  const clusters = toPlain(w.computeLatestSessionClustersForAllHizb());
  assert.equal(clusters.length, 1, 'the two sessions\' nearby mistakes pool into one cluster instead of only one session\'s counting');
  assert.equal(clusters[0].distinctCount, 2);

  w.localStorage.clear();
});

test('renderHizbLogTable "last-session" mode shows every session from a Hizb\'s most recent day, not just the latest one', () => {
  w.localStorage.clear();
  const yesterday = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();
  const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
  w.localStorage.setItem('quranReviewHizbLog', JSON.stringify([
    { id: 's1', hizb: 1, mistakes: 2, date: yesterday },
    { id: 's2', hizb: 1, mistakes: 3, date: yesterday },
    { id: 's3', hizb: 1, mistakes: 4, date: yesterday },
    { id: 'old', hizb: 1, mistakes: 9, date: twoDaysAgo },
  ]));

  w.setRecitationLogFilter('all');
  w.setRecitationLogTimeframe('last-session');

  const html = w.document.getElementById('hizb-log-table').innerHTML;
  const rows = (html.match(/log-hizb-clickable/g) || []).length;
  assert.equal(rows, 3, 'all 3 of yesterday\'s sessions for Hizb 1, not just one');
  assert.doesNotMatch(html, /9 mistake/, 'the 2-days-ago session is excluded');

  w.localStorage.clear();
  w.clearRecitationLogFilters();
});

// Synthetic HTML mirroring the real structure of a Telegram public channel
// preview page (t.me/s/<channel>), verified against a live fetch of
// t.me/s/tasmee315: each message is a ".tgme_widget_message" div (Telegram
// tags its own service messages — "Channel created", pin notices — with an
// extra "service_message" class), text lives in ".tgme_widget_message_text"
// with <br> for line breaks (not real newlines), and the timestamp is a
// "datetime" attribute on a <time> inside ".tgme_widget_message_date".
function fakeTelegramHtml() {
  return `
    <div class="tgme_widget_message text_not_supported_wrap service_message js-widget_message" data-post="tasmee315/1">
      <div class="tgme_widget_message_bubble">
        <div class="tgme_widget_message_text js-message_text" dir="auto">Channel created</div>
        <div class="tgme_widget_message_footer"><span class="tgme_widget_message_date" href="https://t.me/tasmee315/1"><time datetime="2026-08-14T19:23:31+00:00">19:23</time></span></div>
      </div>
    </div>
    <div class="tgme_widget_message text_not_supported_wrap js-widget_message" data-post="tasmee315/2">
      <div class="tgme_widget_message_bubble">
        <div class="tgme_widget_message_text js-message_text" dir="auto">S (Stopped): Blanked mid-ayah, needed a prompt.<br>B (Beginning): Forgot how the ayah starts.<br>A (Attention): Felt shaky but no actual mistake (tracked separately).</div>
        <div class="tgme_widget_message_footer"><span class="tgme_widget_message_date" href="https://t.me/tasmee315/2"><time datetime="2026-08-14T19:24:12+00:00">19:24</time></span></div>
      </div>
    </div>
    <div class="tgme_widget_message text_not_supported_wrap js-widget_message" data-post="tasmee315/4">
      <div class="tgme_widget_message_bubble">
        <div class="tgme_widget_message_text js-message_text" dir="auto">78b<br>84a<br>86b</div>
        <div class="tgme_widget_message_footer"><span class="tgme_widget_message_date" href="https://t.me/tasmee315/4"><time datetime="2026-08-14T19:24:28+00:00">19:24</time></span></div>
      </div>
    </div>
    <div class="tgme_widget_message text_not_supported_wrap js-widget_message" data-post="tasmee315/7">
      <div class="tgme_widget_message_bubble">
        <div class="tgme_widget_message_text js-message_text" dir="auto">3:<br>15<br>16<br>22<br>24a</div>
        <div class="tgme_widget_message_footer"><span class="tgme_widget_message_date" href="https://t.me/tasmee315/7"><time datetime="2026-08-14T20:14:46+00:00">20:14</time></span></div>
      </div>
    </div>
  `;
}

test('telegramMessageText replaces <br> with real newlines instead of collapsing lines together', () => {
  const container = w.document.createElement('div');
  container.innerHTML = '78b<br>84a<br>86b';
  assert.equal(w.telegramMessageText(container), '78b\n84a\n86b');
});

test('looksLikeAyahLogMessage requires at least one line starting with a digit', () => {
  assert.equal(w.looksLikeAyahLogMessage('78b\n84a\n86b'), true, 'every line is a bare ayah');
  assert.equal(w.looksLikeAyahLogMessage('3:\n15\n16'), true, 'a surah-override line still starts with a digit');
  assert.equal(w.looksLikeAyahLogMessage('some note\n78b'), true, 'one matching line is enough');
  assert.equal(
    w.looksLikeAyahLogMessage('S (Stopped): Blanked mid-ayah, needed a prompt.\nB (Beginning): Forgot how the ayah starts.'),
    false,
    'the type-code legend has no line starting with a digit'
  );
  assert.equal(w.looksLikeAyahLogMessage('Channel created'), false);
});

test('importMistakesFromTelegram confirms which messages were excluded (and why) before downloading, then fetches via the CORS proxy and preserves <br> line breaks', async () => {
  const realFetch = w.fetch;
  const realDownload = w.downloadJsonFile;
  const realConfirm = w.confirm;
  let fetchedUrl = null, downloaded = null, confirmMessage = null;
  w.fetch = async (url) => {
    fetchedUrl = url;
    return { ok: true, status: 200, text: async () => fakeTelegramHtml() };
  };
  w.downloadJsonFile = (data, filename) => { downloaded = { data, filename }; };
  w.confirm = (msg) => { confirmMessage = msg; return true; };

  await w.importMistakesFromTelegram();

  assert.match(fetchedUrl, /api\.allorigins\.win/, 'goes through the CORS proxy, not a direct t\.me fetch');
  assert.match(fetchedUrl, /t\.me%2Fs%2Ftasmee315/, 'targets the channel\'s public preview page, URL-encoded');

  assert.match(confirmMessage, /Found 2 messages/);
  assert.match(confirmMessage, /1 other message will NOT be included/, 'only the type-code legend — "Channel created" (a Telegram service message) is dropped silently, never mentioned');
  assert.doesNotMatch(confirmMessage, /Channel created/, 'service messages are never listed in the confirm at all');
  assert.match(confirmMessage, /S \(Stopped\).*\(doesn't look like log data/);

  assert.ok(downloaded, 'downloadJsonFile was called once the confirm was accepted');
  assert.match(downloaded.filename, /telegram-tasmee315-\d{4}-\d{2}-\d{2}\.json/);
  assert.equal(
    downloaded.filename, `telegram-tasmee315-${downloaded.data.fetchedAt.slice(0, 10)}.json`,
    'the filename\'s date must match fetchedAt\'s (both local time) — using UTC for one and local for the other would make them disagree right around local midnight'
  );
  assert.equal(downloaded.data.channel, 'tasmee315');
  assert.equal(downloaded.data.messages.length, 2,
    '"Channel created" (a service message) and the type-code legend (no line starts with a digit) are both excluded — only 2 of the 4 fixture messages are real log data');
  assert.ok(!downloaded.data.messages.some(m => m.id === 'tasmee315/2'), 'the type-code legend message is not included');
  assert.equal(downloaded.data.messages[0].id, 'tasmee315/4');
  assert.equal(downloaded.data.messages[0].text, '78b\n84a\n86b', 'line breaks preserved as real newlines, not collapsed');
  assert.equal(downloaded.data.messages[0].date, '2026-08-14T19:24:28+00:00');
  assert.equal(downloaded.data.messages[1].text, '3:\n15\n16\n22\n24a', 'matches the paste-import\'s own surah-override syntax exactly');

  w.fetch = realFetch;
  w.downloadJsonFile = realDownload;
  w.confirm = realConfirm;
});

test('importMistakesFromTelegram declining the exclusions confirm downloads nothing', async () => {
  const realFetch = w.fetch, realDownload = w.downloadJsonFile, realConfirm = w.confirm;
  let downloaded = null;
  w.fetch = async () => ({ ok: true, status: 200, text: async () => fakeTelegramHtml() });
  w.downloadJsonFile = (data, filename) => { downloaded = { data, filename }; };
  w.confirm = () => false;

  await w.importMistakesFromTelegram();

  assert.equal(downloaded, null, 'declining the confirm means no file is downloaded at all');

  w.fetch = realFetch;
  w.downloadJsonFile = realDownload;
  w.confirm = realConfirm;
});

test('importMistakesFromTelegram skips the confirm entirely when every message looks like log data (nothing to exclude)', async () => {
  const realFetch = w.fetch, realDownload = w.downloadJsonFile, realConfirm = w.confirm;
  let downloaded = null, confirmCalled = false;
  w.fetch = async () => ({
    ok: true, status: 200,
    text: async () => `
      <div class="tgme_widget_message js-widget_message" data-post="tasmee315/4">
        <div class="tgme_widget_message_text js-message_text" dir="auto">78b<br>84a<br>86b</div>
        <div class="tgme_widget_message_footer"><span class="tgme_widget_message_date"><time datetime="2026-08-14T19:24:28+00:00">19:24</time></span></div>
      </div>
    `,
  });
  w.downloadJsonFile = (data, filename) => { downloaded = { data, filename }; };
  w.confirm = () => { confirmCalled = true; return true; };

  await w.importMistakesFromTelegram();

  assert.equal(confirmCalled, false, 'nothing was excluded, so there\'s nothing to confirm — it just downloads directly');
  assert.ok(downloaded);
  assert.equal(downloaded.data.messages.length, 1);

  w.fetch = realFetch;
  w.downloadJsonFile = realDownload;
  w.confirm = realConfirm;
});

test('importMistakesFromTelegram also skips the confirm when the only excluded messages are Telegram\'s own service messages', async () => {
  const realFetch = w.fetch, realDownload = w.downloadJsonFile, realConfirm = w.confirm;
  let downloaded = null, confirmCalled = false;
  w.fetch = async () => ({
    ok: true, status: 200,
    text: async () => `
      <div class="tgme_widget_message text_not_supported_wrap service_message js-widget_message" data-post="tasmee315/1">
        <div class="tgme_widget_message_text js-message_text" dir="auto">Channel created</div>
        <div class="tgme_widget_message_footer"><span class="tgme_widget_message_date"><time datetime="2026-08-14T19:23:31+00:00">19:23</time></span></div>
      </div>
      <div class="tgme_widget_message js-widget_message" data-post="tasmee315/4">
        <div class="tgme_widget_message_text js-message_text" dir="auto">78b<br>84a<br>86b</div>
        <div class="tgme_widget_message_footer"><span class="tgme_widget_message_date"><time datetime="2026-08-14T19:24:28+00:00">19:24</time></span></div>
      </div>
    `,
  });
  w.downloadJsonFile = (data, filename) => { downloaded = { data, filename }; };
  w.confirm = () => { confirmCalled = true; return true; };

  await w.importMistakesFromTelegram();

  assert.equal(confirmCalled, false, 'the excluded service message is never reported, so there\'s nothing to confirm about');
  assert.ok(downloaded, 'downloads directly');
  assert.equal(downloaded.data.messages.length, 1);

  w.fetch = realFetch;
  w.downloadJsonFile = realDownload;
  w.confirm = realConfirm;
});

test('importMistakesFromTelegram alerts (not throws) and re-enables the button when the proxy fetch fails', async () => {
  const realFetch = w.fetch, realAlert = w.alert;
  let alertMessage = null;
  w.fetch = async () => ({ ok: false, status: 522, text: async () => '' });
  w.alert = (msg) => { alertMessage = msg; };

  await w.importMistakesFromTelegram();

  assert.match(alertMessage, /Import from Telegram failed/);
  assert.match(alertMessage, /522/);
  const btn = w.document.getElementById('telegram-import-btn');
  assert.equal(btn.disabled, false, 'the button is re-enabled after failing, not left stuck');
  assert.match(btn.textContent, /Import from Telegram/, 'label restored, not left showing "Fetching…"');

  w.fetch = realFetch;
  w.alert = realAlert;
});

test('importMistakesFromTelegram alerts when the proxy returns a page with no real messages (e.g. only service messages)', async () => {
  const realFetch = w.fetch, realAlert = w.alert;
  let alertMessage = null;
  w.fetch = async () => ({
    ok: true, status: 200,
    text: async () => '<div class="tgme_widget_message service_message" data-post="x/1"><div class="tgme_widget_message_text">Channel created</div></div>',
  });
  w.alert = (msg) => { alertMessage = msg; };

  await w.importMistakesFromTelegram();

  assert.match(alertMessage, /No messages found/);

  w.fetch = realFetch;
  w.alert = realAlert;
});
