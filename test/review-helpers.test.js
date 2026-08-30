'use strict';

const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { loadPage } = require('./helpers/loadPage.js');
const { extractConst } = require('./helpers/extractConst.js');

// Objects/arrays returned directly from jsdom-realm functions have a
// different Array/Object prototype than Node's own realm, which trips up
// assert.deepEqual's structural check even when the data matches. Round-trip
// through JSON to normalize before comparing.
const toPlain = (value) => JSON.parse(JSON.stringify(value));

// A fake window.open() stub for every print function, including
// printAllHizbsMistakes — a single plain write-and-print, same as every
// other print function (no per-page pagination, see printAllHizbsMistakes'
// own comment for why: two-column layout was tried four different ways
// and broke in real printed output every time, so it was dropped in favor
// of one plain full-width column with no measurement/pagination step).
function makeFakePrintWindow() {
  let finalHtml = null;
  const win = {
    document: {
      write: (h) => { finalHtml = h; },
      close: () => {},
    },
    focus: () => {},
    print: () => {},
  };
  return { win, getCaptured: () => finalHtml };
}

// review.html's inline script is loaded once — these are all pure functions
// with no DOM/network dependency, so a shared window is fine (no state to
// reset between tests).
let w;
before(() => {
  w = loadPage('review.html').window;
});

// The real per-preset prompt text now lives in agent-prompts/prompts.md
// (one shared file, split into "# Common"/"# General"/"# Print" sections
// by parseAgentPromptSections()), fetched at runtime (loadAgentPromptFiles()) —
// unreachable in this jsdom suite (no HTTP server backing relative
// fetch() calls here), so AGENT_PROMPT_PRESETS stays on its built-in
// AGENT_PROMPT_FALLBACK values throughout this file, UNLESS a specific
// test stubs fetch and calls loadAgentPromptFiles() itself (see the
// dedicated tests for that near the end of the Agent Chat section, kept
// last so they don't mutate AGENT_PROMPT_PRESETS out from under any
// earlier test relying on the fallback). AGENT_PROMPT_FALLBACK is a
// top-level `const` object in review.html — per this suite's own
// well-known jsdom caveat (see CLAUDE.md's Tests section), that never
// attaches to `window`, so it's extracted from the raw file instead, no
// DOM involved.
const AGENT_PROMPT_FALLBACK_TEXT = extractConst('review.html', 'AGENT_PROMPT_FALLBACK');
const AGENT_SYSTEM_PROMPT_TEXT = AGENT_PROMPT_FALLBACK_TEXT.general;
const AGENT_PRINT_SYSTEM_PROMPT_TEXT = AGENT_PROMPT_FALLBACK_TEXT.print;
// Same jsdom `const`-on-`window` caveat as above.
const AGENT_CHAT_EMPTY_MESSAGE_DEFAULT_TEXT = extractConst('review.html', 'AGENT_CHAT_EMPTY_MESSAGE_DEFAULT');

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

test('HIZB_RANGES splits a Juz into its 2 Hizbs at the real mushaf boundary, not an even ayah-count bisection', () => {
  // Regression test: hizbOfGlobalAyah used to bisect each Juz's global ayah
  // count exactly in half, but real Hizb boundaries aren't at the midpoint
  // of a Juz's ayah count (each Hizb further splits into 4 roughly-equal-
  // length quarters, not the Juz splitting into 2 equal-ayah-count Hizbs) —
  // e.g. Juz 1 (Al-Fatiha + Al-Baqara 1-141, 148 ayat) splits unevenly into
  // Hizb 1 = Al-Fatiha + Al-Baqara 1-74 (81 ayat) and Hizb 2 = Al-Baqara
  // 75-141 (67 ayat), not 74/74. The old bisection put the boundary at
  // Al-Baqara 67/68 instead, silently mis-Hizbing 2:68 through 2:74 into
  // Hizb 2.
  // Al-Fatiha (surah 1) has 7 ayat, so Al-Baqara (surah 2) ayah N is global
  // ayah (7 + N).
  assert.equal(w.hizbOfGlobalAyah(7 + 70), 1, '2:70 is Hizb 1, not Hizb 2');
  assert.equal(w.hizbOfGlobalAyah(7 + 74), 1, '2:74 (Hizb 1\'s real last ayah) is still Hizb 1');
  assert.equal(w.hizbOfGlobalAyah(7 + 75), 2, '2:75 (Hizb 2\'s real first ayah) is Hizb 2');
  assert.deepEqual(toPlain(w.hizbRange(1)), [1, 81]);
  assert.deepEqual(toPlain(w.hizbRange(2)), [82, 148]);
});

test('HIZB_RANGES: every Hizb pair unions exactly onto its Juz, with no gaps between consecutive Hizbs', () => {
  for (let hizb = 1; hizb < 60; hizb++) {
    const [, end] = w.hizbRange(hizb);
    const [nextStart] = w.hizbRange(hizb + 1);
    assert.equal(nextStart, end + 1, `Hizb ${hizb + 1} starts right after Hizb ${hizb} ends`);
  }
  assert.equal(w.hizbRange(1)[0], 1);
  assert.equal(w.hizbRange(60)[1], 6236);
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

test('normalizeArabicIndicDigits converts Arabic-Indic and Extended Arabic-Indic digits to ASCII, and strips LRM/RLM/ALM bidi marks', () => {
  assert.equal(w.normalizeArabicIndicDigits('٠١٢٣٤٥٦٧٨٩'), '0123456789', 'Arabic-Indic (Eastern Arabic)');
  assert.equal(w.normalizeArabicIndicDigits('۰۱۲۳۴۵۶۷۸۹'), '0123456789', 'Extended Arabic-Indic (Persian/Urdu)');
  assert.equal(w.normalizeArabicIndicDigits('‏207‎218؜'), '207218', 'RLM, LRM, ALM all stripped');
  assert.equal(w.normalizeArabicIndicDigits('218SB forgot ina'), '218SB forgot ina', 'plain ASCII text passes through unchanged');
});

test('parseAyahMistakesText accepts Arabic-Indic digits, e.g. "٢٠٧" for ayah 207 — a real Telegram message used exactly this shape', () => {
  const parsed = w.parseAyahMistakesText('٢٠٧', 2);
  assert.deepEqual(toPlain(parsed), [{ surah: 2, ayah: 207, type: null, note: '' }]);
});

test('parseAyahMistakesText accepts a Telegram RLM mark right before an Arabic-Indic number, same as the real message that prompted this fix', () => {
  const parsed = w.parseAyahMistakesText('‏٢٠٧', 2);
  assert.deepEqual(toPlain(parsed), [{ surah: 2, ayah: 207, type: null, note: '' }]);
});

test('parseAyahMistakesText accepts an Arabic-Indic "N:" surah override, e.g. "٣:١٥"', () => {
  const parsed = w.parseAyahMistakesText('٣:١٥', 2);
  assert.deepEqual(toPlain(parsed), [{ surah: 3, ayah: 15, type: null, note: '' }]);
});

test('looksLikeAyahLogMessage recognizes a message that only has an Arabic-Indic ayah number', () => {
  assert.equal(w.looksLikeAyahLogMessage('٢٠٧'), true);
  assert.equal(w.looksLikeAyahLogMessage('‏٢٠٧'), true, 'still recognized with a leading RLM mark');
});

test('parsePageFlagsText/parseHizbCleanSessionFlagsText/parsePracticeRangeFlagsText/endingSurahAfterParsing all accept Arabic-Indic digits too', () => {
  assert.deepEqual(toPlain(w.parsePageFlagsText('p١٥x٢٠')), [{ page: 15, target: 20, note: '' }]);
  assert.deepEqual(toPlain(w.parseHizbCleanSessionFlagsText('h٥')), [{ hizb: 5 }]);
  assert.deepEqual(toPlain(w.parsePracticeRangeFlagsText('r١٥-٢٣x٢٠', 2)), [{ surah: 2, ayahStart: 15, ayahEnd: 23, target: 20, note: '', completed: false }]);
  assert.equal(w.endingSurahAfterParsing('٣:١٥', 2), 3);
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

test('parsePageFlagsText picks out "pN" lines (case-insensitive, optional trailing note), defaulting the target and accepting an explicit "pNxT" override, ignoring everything else', () => {
  const parsed = w.parsePageFlagsText([
    '280',                          // an ayah line — not a page flag
    'p15',
    'P20 need to redo the whole thing',
    'p30x10',
    'p40 x25 whole page felt shaky',
    '3:',                           // a surah-override line — not a page flag either
    'please review this',           // starts with "p" but no digit right after — not a page flag
  ].join('\n'));

  assert.deepEqual(toPlain(parsed), [
    { page: 15, target: 5, note: '' },
    { page: 20, target: 5, note: 'need to redo the whole thing' },
    { page: 30, target: 10, note: '' },
    { page: 40, target: 25, note: 'whole page felt shaky' },
  ]);
});

test('parsePageFlagsText and parseAyahMistakesText are independent — each only picks out its own kind of line from the same text', () => {
  const text = '280\np15\n3:\n5';
  const pageFlags = w.parsePageFlagsText(text);
  const ayat = w.parseAyahMistakesText(text, 2);

  assert.deepEqual(toPlain(pageFlags), [{ page: 15, target: 5, note: '' }]);
  assert.deepEqual(toPlain(ayat), [
    { surah: 2, ayah: 280, type: null, note: '' },
    { surah: 3, ayah: 5, type: null, note: '' },
  ], 'the "p15" line is silently ignored by parseAyahMistakesText, same as any other non-numeric line');
});

test('parseHizbCleanSessionFlagsText picks out "hN" lines (case-insensitive, trailing text discarded), ignoring everything else', () => {
  const parsed = w.parseHizbCleanSessionFlagsText([
    '280',                     // an ayah line — not a clean-session flag
    'h5',
    'H12 alhamdulillah',
    '3:',                      // a surah-override line — not a clean-session flag either
    'have a nice day',         // starts with "h" but no digit right after — not a clean-session flag
  ].join('\n'));

  assert.deepEqual(toPlain(parsed), [{ hizb: 5 }, { hizb: 12 }]);
});

test('parseHizbCleanSessionFlagsText, parsePageFlagsText, and parseAyahMistakesText are all independent — each only picks out its own kind of line from the same text', () => {
  const text = '280\np15\nh5\n3:\n5';
  const cleanFlags = w.parseHizbCleanSessionFlagsText(text);
  const pageFlags = w.parsePageFlagsText(text);
  const ayat = w.parseAyahMistakesText(text, 2);

  assert.deepEqual(toPlain(cleanFlags), [{ hizb: 5 }]);
  assert.deepEqual(toPlain(pageFlags), [{ page: 15, target: 5, note: '' }]);
  assert.deepEqual(toPlain(ayat), [
    { surah: 2, ayah: 280, type: null, note: '' },
    { surah: 3, ayah: 5, type: null, note: '' },
  ], 'the "p15" and "h5" lines are silently ignored by parseAyahMistakesText, same as any other non-numeric line');
});

test('parsePracticeRangeFlagsText picks out "rM-Kx T" lines (case-insensitive, optional trailing note), reusing the same carry-forward surah as a bare ayah number, ignoring everything else', () => {
  const parsed = w.parsePracticeRangeFlagsText([
    '280',                        // an ayah line — not a practice range
    'r15-23x20',
    '4:',                         // surah switch — the next range picks this up
    'R1-1x5 memorize this one',
    'h5',                         // a clean-session flag — not a practice range
    'really need to redo this',   // starts with "r" but doesn't match the r<n>-<n>x<n> shape
  ].join('\n'), 2);

  assert.deepEqual(toPlain(parsed), [
    { surah: 2, ayahStart: 15, ayahEnd: 23, target: 20, note: '', completed: false },
    { surah: 4, ayahStart: 1, ayahEnd: 1, target: 5, note: 'memorize this one', completed: false },
  ]);
});

test('parsePracticeRangeFlagsText accepts an en dash, em dash, or minus sign in place of a plain hyphen — a real incident: iOS smart-punctuation silently turned "r81-88x15" into "r81–88x15" while typing in Telegram, which an ASCII-only "-" would have failed to match at all, with nothing anywhere to say so', () => {
  const enDash = w.parsePracticeRangeFlagsText('2:\nr81–88x15', null);
  const emDash = w.parsePracticeRangeFlagsText('2:\nr81—88x15', null);
  const minusSign = w.parsePracticeRangeFlagsText('2:\nr81−88x15', null);
  const plainHyphen = w.parsePracticeRangeFlagsText('2:\nr81-88x15', null);
  const expected = [{ surah: 2, ayahStart: 81, ayahEnd: 88, target: 15, note: '', completed: false }];
  assert.deepEqual(toPlain(enDash), expected);
  assert.deepEqual(toPlain(emDash), expected);
  assert.deepEqual(toPlain(minusSign), expected);
  assert.deepEqual(toPlain(plainHyphen), expected);
});

test('parsePracticeRangeFlagsText, parseHizbCleanSessionFlagsText, parsePageFlagsText, and parseAyahMistakesText are all independent — each only picks out its own kind of line from the same text', () => {
  const text = '280\np15\nh5\nr15-23x20\n3:\n5';
  const ranges = w.parsePracticeRangeFlagsText(text, 2);
  const cleanFlags = w.parseHizbCleanSessionFlagsText(text);
  const pageFlags = w.parsePageFlagsText(text);
  const ayat = w.parseAyahMistakesText(text, 2);

  assert.deepEqual(toPlain(ranges), [{ surah: 2, ayahStart: 15, ayahEnd: 23, target: 20, note: '', completed: false }]);
  assert.deepEqual(toPlain(cleanFlags), [{ hizb: 5 }]);
  assert.deepEqual(toPlain(pageFlags), [{ page: 15, target: 5, note: '' }]);
  assert.deepEqual(toPlain(ayat), [
    { surah: 2, ayah: 280, type: null, note: '' },
    { surah: 3, ayah: 5, type: null, note: '' },
  ], 'the "p15", "h5", and "r15-23x20" lines are all silently ignored by parseAyahMistakesText');
});

test('parsePracticeRangeFlagsText tracks its own "N:" surah-switch lines internally, independent of parseAyahMistakesText\'s own tracking over the same text', () => {
  const parsed = w.parsePracticeRangeFlagsText('3:\nr1-5x10', null);
  assert.deepEqual(toPlain(parsed), [{ surah: 3, ayahStart: 1, ayahEnd: 5, target: 10, note: '', completed: false }]);
});

test('parsePracticeRangeFlagsText recognizes "done", "d", and "✅" immediately after "x<count>" as a completion marker, case-insensitively, stripping it from the note', () => {
  const done = w.parsePracticeRangeFlagsText('r15-23x10 done', 2);
  const dShorthand = w.parsePracticeRangeFlagsText('r15-23x10 d', 2);
  const checkmark = w.parsePracticeRangeFlagsText('r15-23x10 ✅', 2);
  const upperDone = w.parsePracticeRangeFlagsText('r15-23x10 DONE', 2);
  const noSpace = w.parsePracticeRangeFlagsText('r15-23x10done', 2);

  [done, dShorthand, checkmark, upperDone, noSpace].forEach(parsed => {
    assert.equal(parsed[0].completed, true);
    assert.equal(parsed[0].note, '');
  });
});

test('parsePracticeRangeFlagsText keeps the rest of the line as the note after a completion marker, and requires the marker to be its own standalone word', () => {
  const withNote = w.parsePracticeRangeFlagsText('r15-23x10 done nice job', 2);
  assert.equal(withNote[0].completed, true);
  assert.equal(withNote[0].note, 'nice job');

  const emojiWithNote = w.parsePracticeRangeFlagsText('r15-23x10 ✅ nailed it', 2);
  assert.equal(emojiWithNote[0].completed, true);
  assert.equal(emojiWithNote[0].note, 'nailed it');

  // "drill this again" starts with "d" but is not the standalone word "d"
  // — must NOT be mistaken for the completion marker (a strict keyword,
  // not a fuzzy/prefix match).
  const realNoteStartingWithD = w.parsePracticeRangeFlagsText('r15-23x10 drill this again', 2);
  assert.equal(realNoteStartingWithD[0].completed, false);
  assert.equal(realNoteStartingWithD[0].note, 'drill this again');

  // Similarly "donesomething" (no separating whitespace) is one continuous
  // word, not the keyword "done" plus a note — never treated as completed.
  const gluedWord = w.parsePracticeRangeFlagsText('r15-23x10 donesomething', 2);
  assert.equal(gluedWord[0].completed, false);
  assert.equal(gluedWord[0].note, 'donesomething');
});

test('a completed "rM-Kx T done" line, pasted via Import Mistakes, seeds `practiced` at `target` (not 0)', () => {
  w.localStorage.clear();
  const realConfirm = w.confirm, realAlert = w.alert;
  w.confirm = () => true;
  w.alert = () => {};

  w.importAyahMistakesFromText('r15-23x10 done', 2);
  const saved = w.loadPracticeRanges();
  assert.equal(saved.length, 1);
  assert.equal(saved[0].kind, 'range');
  assert.equal(saved[0].target, 10);
  assert.equal(saved[0].practiced, 10, 'already fully practiced, not a fresh 0/10 goal');

  w.confirm = realConfirm;
  w.alert = realAlert;
  w.localStorage.clear();
});

test('a goal-only "rM-Kx T" line (no completion marker) still starts practiced at 0, same as before this feature existed', () => {
  w.localStorage.clear();
  const realConfirm = w.confirm, realAlert = w.alert;
  w.confirm = () => true;
  w.alert = () => {};

  w.importAyahMistakesFromText('r15-23x10', 2);
  const saved = w.loadPracticeRanges();
  assert.equal(saved.length, 1);
  assert.equal(saved[0].kind, 'range');
  assert.equal(saved[0].practiced, 0);

  w.confirm = realConfirm;
  w.alert = realAlert;
  w.localStorage.clear();
});

test('repairMissingPracticeRangeKind sets kind:"range" on a pre-fix entry (ayahStart/ayahEnd set, no kind) — a real bug in both import creation sites left every imported range without one, which also broke Telegram dedup (telegramPracticeRangeExists filters to kind === "range" first)', () => {
  w.localStorage.clear();
  w.localStorage.setItem('quranReviewPracticeRanges', JSON.stringify([
    { id: 'r1', surah: 2, ayahStart: 15, ayahEnd: 23, target: 20, practiced: 0, note: '', dateAdded: '2026-08-01T00:00:00.000Z', source: 'telegram', telegramMessageId: 'ch/1' },
    { id: 'p1', kind: 'page', page: 15, target: 5, practiced: 0, note: '', dateAdded: '2026-08-01T00:00:00.000Z', source: 'manual', telegramMessageId: null },
  ]));

  w.repairMissingPracticeRangeKind();

  const ranges = w.loadPracticeRanges();
  assert.equal(ranges.find(r => r.id === 'r1').kind, 'range');
  assert.equal(ranges.find(r => r.id === 'p1').kind, 'page', 'a real page-kind entry is left untouched');

  // Safe to call again — no-op once already fixed.
  w.repairMissingPracticeRangeKind();
  assert.equal(w.loadPracticeRanges().find(r => r.id === 'r1').kind, 'range');

  w.localStorage.clear();
});

test('addPracticeRange rejects an invalid ayah range or target, and saves a valid one with practiced starting at 0', () => {
  w.localStorage.clear();
  w.document.getElementById('practice-range-surah').value = '2';
  w.document.getElementById('practice-range-ayah-from').value = '15';
  w.document.getElementById('practice-range-ayah-to').value = '23';
  w.document.getElementById('practice-range-target').value = '20';
  w.document.getElementById('practice-range-note').value = 'tricky transition';

  const realAlert = w.alert;
  let alertMsg = null;
  w.alert = (msg) => { alertMsg = msg; };

  w.addPracticeRange();

  assert.equal(alertMsg, null, 'a valid range does not alert');
  const ranges = w.loadPracticeRanges();
  assert.equal(ranges.length, 1);
  assert.equal(ranges[0].surah, 2);
  assert.equal(ranges[0].ayahStart, 15);
  assert.equal(ranges[0].ayahEnd, 23);
  assert.equal(ranges[0].target, 20);
  assert.equal(ranges[0].practiced, 0);
  assert.equal(ranges[0].note, 'tricky transition');
  assert.equal(ranges[0].source, 'live');

  // An ayah past Al-Baqara's real range is rejected outright.
  w.document.getElementById('practice-range-ayah-to').value = '9999';
  w.addPracticeRange();
  assert.match(alertMsg, /valid ayah range/);
  assert.equal(w.loadPracticeRanges().length, 1, 'the invalid attempt was not saved');

  w.alert = realAlert;
  w.localStorage.clear();
});

test('updatePracticeRangeCount updates the practiced count, clamping a negative/invalid value to 0, and deletePracticeRange removes the entry', () => {
  w.localStorage.setItem('quranReviewPracticeRanges', JSON.stringify([
    { id: 'r1', surah: 2, ayahStart: 15, ayahEnd: 23, target: 20, practiced: 5, note: '', dateAdded: '2026-08-01T00:00:00.000Z' },
  ]));

  w.updatePracticeRangeCount('r1', '12');
  assert.equal(w.loadPracticeRanges()[0].practiced, 12);

  w.updatePracticeRangeCount('r1', '-3');
  assert.equal(w.loadPracticeRanges()[0].practiced, 0, 'a negative value clamps to 0, not a negative count');

  w.deletePracticeRange('r1');
  assert.equal(w.loadPracticeRanges().length, 0);
  w.localStorage.clear();
});

test('telegramPracticeRangeExists is existence-based on (telegramMessageId, surah, ayahStart, ayahEnd), not target/practiced/note', () => {
  w.localStorage.setItem('quranReviewPracticeRanges', JSON.stringify([
    { id: 'r1', kind: 'range', surah: 2, ayahStart: 15, ayahEnd: 23, target: 20, practiced: 5, telegramMessageId: 'ch/1', dateAdded: '2026-08-01T00:00:00.000Z' },
  ]));

  assert.ok(w.telegramPracticeRangeExists('ch/1', 2, 15, 23));
  assert.ok(!w.telegramPracticeRangeExists('ch/1', 2, 15, 24), 'a different range counts as a different candidate');
  assert.ok(!w.telegramPracticeRangeExists('ch/2', 2, 15, 23), 'a different message counts as a different candidate');
  w.localStorage.clear();
});

test('telegramPracticePageExists is existence-based on (telegramMessageId, page), separate from telegramPracticeRangeExists', () => {
  w.localStorage.setItem('quranReviewPracticeRanges', JSON.stringify([
    { id: 'p1', kind: 'page', page: 15, target: 5, practiced: 0, telegramMessageId: 'ch/1', dateAdded: '2026-08-01T00:00:00.000Z' },
  ]));

  assert.ok(w.telegramPracticePageExists('ch/1', 15));
  assert.ok(!w.telegramPracticePageExists('ch/1', 16), 'a different page counts as a different candidate');
  assert.ok(!w.telegramPracticePageExists('ch/2', 15), 'a different message counts as a different candidate');
  assert.ok(!w.telegramPracticeRangeExists('ch/1', 2, 15, 23), 'a page-kind entry never matches the range-kind check');
  w.localStorage.clear();
});

test('renderPracticeRanges shows a status message when empty, a row with an editable count once something is there, and a range-kind row shows its start/end opening words', async () => {
  w.localStorage.clear();
  await w.renderPracticeRanges();
  assert.match(w.document.getElementById('practice-ranges-list').innerHTML, /Nothing on your practice list yet/);

  w.localStorage.setItem('quranReviewPracticeRanges', JSON.stringify([
    // Surah 3, not 2 — addPracticeRange's own test (above) already added a
    // real surah-2 range earlier in this file via the production code path,
    // which fire-and-forgets renderPracticeRanges() unstubbed; that call's
    // failed (no-fetch-in-jsdom) fetchSurahData(2) permanently caches surah
    // 2 as null in allClustersSurahCache (a module-level Map that persists
    // for the whole file, same caveat printAllHizbsMistakes' own tests
    // document) before this test's stub ever gets a chance to run. Surah 3
    // is never touched by an unstubbed practice-range trigger anywhere else
    // in this file, so it's safe.
    { id: 'r1', kind: 'range', surah: 3, ayahStart: 15, ayahEnd: 23, target: 20, practiced: 5, note: 'tricky', dateAdded: '2026-08-01T00:00:00.000Z' },
  ]));
  const realFetchSurahData = w.fetchSurahData;
  w.fetchSurahData = async () => {
    // clusterAyahBeginning indexes arabicAyahs by array position (ayah - 1),
    // not by a "numberInSurah" field, so the array needs a real slot at
    // that index — a sparse array with only the two ayat we care about set.
    const arabicAyahs = [];
    arabicAyahs[14] = { numberInSurah: 15, text: 'start words' };
    arabicAyahs[22] = { numberInSurah: 23, text: 'end words' };
    return { arabicAyahs };
  };
  await w.renderPracticeRanges();
  const html = w.document.getElementById('practice-ranges-list').innerHTML;
  assert.match(html, /3:15-23/);
  assert.match(html, /20 times/);
  assert.match(html, /tricky/);
  assert.match(html, /value="5"/, 'the practiced count is pre-filled into the editable input');
  assert.match(html, /Start — 3:15/);
  assert.match(html, /start words/);
  assert.match(html, /End — 3:23/);
  assert.match(html, /end words/);

  w.fetchSurahData = realFetchSurahData;
  w.localStorage.clear();
});

test('renderPracticeRanges shows only one opening-words block for a single-ayah range (start === end)', async () => {
  w.localStorage.clear();
  w.localStorage.setItem('quranReviewPracticeRanges', JSON.stringify([
    // Surah 4, not 3 — the previous test already cached surah 3 in
    // allClustersSurahCache (a module-level Map that persists for the
    // whole file) with its own opening words at different ayah indices;
    // reusing surah 3 here would hit that stale cache instead of this
    // test's own stub, since ensureAllClustersSurahsCached only fetches
    // surahs not already cached.
    { id: 'r1', kind: 'range', surah: 4, ayahStart: 5, ayahEnd: 5, target: 10, practiced: 0, note: '', dateAdded: '2026-08-01T00:00:00.000Z' },
  ]));
  const realFetchSurahData = w.fetchSurahData;
  w.fetchSurahData = async () => {
    const arabicAyahs = [];
    arabicAyahs[4] = { numberInSurah: 5, text: 'only ayah words' };
    return { arabicAyahs };
  };

  await w.renderPracticeRanges();
  const html = w.document.getElementById('practice-ranges-list').innerHTML;

  assert.match(html, /only ayah words/);
  assert.doesNotMatch(html, /Start —/, 'no "Start"/"End" labels needed when there\'s only one ayah');
  assert.doesNotMatch(html, /End —/);
  assert.equal((html.match(/only ayah words/g) || []).length, 1, 'the single ayah\'s words are shown once, not twice');

  w.fetchSurahData = realFetchSurahData;
  w.localStorage.clear();
});

// ensureZeroMistakeHizbSessions() — the naturally-idempotent core of "hN":
// creates a session for a Hizb+day only if one doesn't already exist
// (however it originated), never bumps an existing one's tally.

test('ensureZeroMistakeHizbSessions creates a zero-mistake session when none exists for that Hizb+day', () => {
  const { newSessions } = w.ensureZeroMistakeHizbSessions([], [{ hizb: 5, date: '2026-08-15T20:00:00.000Z' }]);
  assert.equal(newSessions.length, 1);
  assert.equal(newSessions[0].hizb, 5);
  assert.equal(newSessions[0].mistakes, 0);
});

test('ensureZeroMistakeHizbSessions does nothing when a session already exists for that Hizb+day, regardless of its source or mistake count', () => {
  const effectiveLog = [{ id: 'existing', hizb: 5, mistakes: 3, date: '2026-08-15T09:00:00.000Z' }];
  const { newSessions } = w.ensureZeroMistakeHizbSessions(effectiveLog, [{ hizb: 5, date: '2026-08-15T20:00:00.000Z' }]);
  assert.equal(newSessions.length, 0, 'a session for Hizb 5 already exists that day — nothing more to add, even though it has real mistakes');
});

test('ensureZeroMistakeHizbSessions creates a session on a DIFFERENT day even if the same Hizb already has one on another day', () => {
  const effectiveLog = [{ id: 'existing', hizb: 5, mistakes: 0, date: '2026-08-14T09:00:00.000Z' }];
  const { newSessions } = w.ensureZeroMistakeHizbSessions(effectiveLog, [{ hizb: 5, date: '2026-08-15T20:00:00.000Z' }]);
  assert.equal(newSessions.length, 1);
});

test('ensureZeroMistakeHizbSessions only creates one session per Hizb+day even with duplicate flags in the same run', () => {
  const flags = [
    { hizb: 5, date: '2026-08-15T09:00:00.000Z' },
    { hizb: 5, date: '2026-08-15T20:00:00.000Z' }, // same Hizb, same day, later timestamp
  ];
  const { newSessions } = w.ensureZeroMistakeHizbSessions([], flags);
  assert.equal(newSessions.length, 1);
});

test('deletePracticeRange removes a page-kind entry by id, same as a range-kind one', () => {
  w.localStorage.setItem('quranReviewPracticeRanges', JSON.stringify([
    { id: 'p1', kind: 'page', page: 15, target: 5, practiced: 0, note: '', dateAdded: '2026-08-01T00:00:00.000Z' },
    { id: 'p2', kind: 'page', page: 20, target: 5, practiced: 0, note: '', dateAdded: '2026-08-01T00:00:00.000Z' },
  ]));

  w.deletePracticeRange('p1');

  assert.deepEqual(toPlain(w.loadPracticeRanges().map(r => r.page)), [20]);
  w.localStorage.clear();
});

test('renderPracticeRanges shows a page-kind entry (Page N, practiced/target, click-to-expand) alongside range-kind ones', async () => {
  w.localStorage.clear();
  await w.renderPracticeRanges();
  assert.match(w.document.getElementById('practice-ranges-list').innerHTML, /Nothing on your practice list yet/);

  w.localStorage.setItem('quranReviewPracticeRanges', JSON.stringify([
    { id: 'p1', kind: 'page', page: 15, target: 5, practiced: 2, note: 'redo this', dateAdded: '2026-08-01T00:00:00.000Z' },
  ]));
  await w.renderPracticeRanges();
  const html = w.document.getElementById('practice-ranges-list').innerHTML;
  assert.match(html, /Page 15/);
  assert.match(html, /redo this/);
  assert.match(html, /value="2"/, 'the practiced count is pre-filled into the editable input');
  assert.match(html, /5 times/, 'the target shows too');
  assert.match(html, /onclick="togglePageText\(15\)"/);

  w.localStorage.clear();
  await w.renderPracticeRanges();
});

test('togglePageText expands a flagged page\'s full Arabic text (fetched via fetchPageData), and collapses on a second click', async () => {
  w.localStorage.clear();
  w.localStorage.setItem('quranReviewPracticeRanges', JSON.stringify([
    { id: 'p1', kind: 'page', page: 999, target: 5, practiced: 0, note: '', dateAdded: '2026-08-01T00:00:00.000Z' }, // an unused page number so no earlier test's cache pollutes this
  ]));
  await w.renderPracticeRanges();
  const realFetchPageData = w.fetchPageData;
  w.fetchPageData = async (pageNum) => {
    if (pageNum !== 999) return [];
    return [
      { text: 'قل إن كان لكم الدار الآخرة', numberInSurah: 94, surah: { number: 2 } },
      { text: 'ولن يتمنوه أبدا', numberInSurah: 95, surah: { number: 2 } },
    ];
  };

  await w.togglePageText(999);

  let html = w.document.getElementById('practice-ranges-list').innerHTML;
  assert.match(html, /قل إن كان لكم الدار الآخرة/, 'expanded — shows the page\'s ayah text');
  assert.match(html, /2:94/, 'each ayah is labeled surah:ayah');

  await w.togglePageText(999); // collapse
  html = w.document.getElementById('practice-ranges-list').innerHTML;
  assert.doesNotMatch(html, /قل إن كان لكم الدار الآخرة/);

  w.fetchPageData = realFetchPageData;
  w.localStorage.clear();
  await w.renderPracticeRanges();
});

test('addPracticePage rejects an invalid page number or target, and saves a valid one with practiced starting at 0', () => {
  w.localStorage.clear();
  w.document.getElementById('practice-page-number').value = '15';
  w.document.getElementById('practice-page-target').value = '5';
  w.document.getElementById('practice-page-note').value = 'whole page felt shaky';

  const realAlert = w.alert;
  let alertMsg = null;
  w.alert = (msg) => { alertMsg = msg; };

  w.addPracticePage();

  assert.equal(alertMsg, null, 'a valid page does not alert');
  const ranges = w.loadPracticeRanges();
  assert.equal(ranges.length, 1);
  assert.equal(ranges[0].kind, 'page');
  assert.equal(ranges[0].page, 15);
  assert.equal(ranges[0].target, 5);
  assert.equal(ranges[0].practiced, 0);
  assert.equal(ranges[0].note, 'whole page felt shaky');
  assert.equal(ranges[0].source, 'live');

  w.document.getElementById('practice-page-number').value = '9999';
  w.addPracticePage();
  assert.match(alertMsg, /valid mushaf page number/);
  assert.equal(w.loadPracticeRanges().length, 1, 'the invalid attempt was not saved');

  w.alert = realAlert;
  w.localStorage.clear();
});

test('migrateLegacyPagesNeedingReview folds a device\'s own old-shape "quranReviewPagesNeedingReview" localStorage key into kind:"page" practiceRanges entries, then clears the old key — a no-op on a second run', () => {
  w.localStorage.clear();
  w.localStorage.setItem('quranReviewPracticeRanges', JSON.stringify([
    { id: 'r1', kind: 'range', surah: 2, ayahStart: 1, ayahEnd: 5, target: 10, practiced: 0, dateAdded: '2026-08-01T00:00:00.000Z' },
  ]));
  w.localStorage.setItem('quranReviewPagesNeedingReview', JSON.stringify([
    { id: 'p1', page: 15, note: 'redo this', date: '2026-08-01T00:00:00.000Z', source: 'paste' },
  ]));

  w.migrateLegacyPagesNeedingReview();

  const ranges = w.loadPracticeRanges();
  assert.equal(ranges.length, 2, 'the pre-existing range entry survives, plus the migrated page entry');
  assert.ok(ranges.some(r => r.kind === 'range' && r.surah === 2));
  const migratedPage = ranges.find(r => r.kind === 'page');
  assert.ok(migratedPage);
  assert.equal(migratedPage.page, 15);
  assert.equal(migratedPage.target, 5);
  assert.equal(migratedPage.note, 'redo this');
  assert.deepEqual(JSON.parse(w.localStorage.getItem('quranReviewPagesNeedingReview')), [], 'the old key is cleared once migrated');

  w.migrateLegacyPagesNeedingReview(); // no-op the second time
  assert.equal(w.loadPracticeRanges().length, 2, 'nothing duplicated on a second call');

  w.localStorage.clear();
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

test('splitMistakeTypeAndNote recognizes "E" (Ending) and "K" (Weak) as standalone type codes, and combines with other real types', () => {
  assert.deepEqual(toPlain(w.splitMistakeTypeAndNote('E')), { type: 'E', note: '' });
  assert.deepEqual(toPlain(w.splitMistakeTypeAndNote('k')), { type: 'K', note: '' });
  assert.deepEqual(toPlain(w.splitMistakeTypeAndNote('EK forgot the tail')), { type: 'EK', note: 'forgot the tail' });
});

test('splitMistakeTypeAndNote treats a combo containing "A" as a real, meaningful type — "AS" means "almost stopped" (a near-miss), not "no type"', () => {
  assert.deepEqual(toPlain(w.splitMistakeTypeAndNote('AS')), { type: 'AS', note: '' });
  assert.deepEqual(toPlain(w.splitMistakeTypeAndNote('ab')), { type: 'AB', note: '' }, 'lowercase, still canonicalized — the real incident that prompted this: "266 ab" (almost forgot the beginning) used to silently become a plain, counted mistake with note "ab"');
});

test('parseAyahMistakesText parses a combined type code with no space, e.g. "255SB" for ayah 255 with both an S and a B mistake', () => {
  const parsed = w.parseAyahMistakesText('255SB', 2);
  assert.deepEqual(toPlain(parsed), [{ surah: 2, ayah: 255, type: 'BS', note: '' }]);
});

test('parseAyahMistakesText parses "266 ab" as ayah 266 with type "AB" (a near-miss on the beginning) — not a real, counted mistake with note "ab"', () => {
  const parsed = w.parseAyahMistakesText('266 ab', 2);
  assert.deepEqual(toPlain(parsed), [{ surah: 2, ayah: 266, type: 'AB', note: '' }]);
});

test('normalizeMistakeTypeCodes dedupes, sorts, combines "A" with a real code as a meaningful near-miss type, and rejects an all-invalid input', () => {
  assert.equal(w.normalizeMistakeTypeCodes('sb'), 'BS');
  assert.equal(w.normalizeMistakeTypeCodes('SSB'), 'BS', 'duplicate letters collapse');
  assert.equal(w.normalizeMistakeTypeCodes('BA'), 'AB', '"A" + a real code is a valid combo — a near-miss on that code\'s aspect, not a real mistake');
  assert.equal(w.normalizeMistakeTypeCodes('A'), 'A', "'A' alone is still valid");
  assert.equal(w.normalizeMistakeTypeCodes('KA'), 'AK', "'K' (a real mistake type) combines with 'A' too, same as any other code");
  assert.equal(w.normalizeMistakeTypeCodes('ek'), 'EK', "'E' and 'K' combine and sort like any other real type");
  assert.equal(w.normalizeMistakeTypeCodes('xyz'), null, 'no recognized codes at all');
  assert.equal(w.normalizeMistakeTypeCodes(''), null);
});

test('isValidMistakeType is true only for an already-canonical type string, including an "A"+code combo', () => {
  assert.equal(w.isValidMistakeType('BS'), true);
  assert.equal(w.isValidMistakeType('SB'), false, 'valid codes, but not in canonical (sorted) order');
  assert.equal(w.isValidMistakeType('A'), true);
  assert.equal(w.isValidMistakeType('AB'), true, '"A" combined with another code, in canonical order, is a valid near-miss type');
  assert.equal(w.isValidMistakeType('BA'), false, 'same codes, but not canonically sorted');
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

test('computeAyahMistakeRanking counts type "A" entries too when includeAttention is true, off by default', () => {
  w.localStorage.setItem('quranReviewAyahMistakes', JSON.stringify([
    { surah: 1, ayah: 6, hizb: 1, type: 'B', note: '', date: '2026-08-01T00:00:00.000Z' },
    { surah: 1, ayah: 7, hizb: 1, type: 'A', note: 'felt shaky', date: '2026-08-01T00:00:00.000Z' },
  ]));

  const excluded = toPlain(w.computeAyahMistakeRanking('all', 'all'));
  const included = toPlain(w.computeAyahMistakeRanking('all', 'all', true));
  w.localStorage.clear();

  assert.deepEqual(excluded.map(r => r.surah + ':' + r.ayah), ['1:6'], 'default (includeAttention omitted) — "A" still excluded');
  assert.deepEqual(included.map(r => r.surah + ':' + r.ayah).sort(), ['1:6', '1:7'], 'includeAttention: true — "A" now counted too');
  const ayah7 = included.find(r => r.surah === 1 && r.ayah === 7);
  assert.equal(ayah7.latestType, 'A');
});

test('computeAyahMistakeRanking counts type "E" and "K" entries as real mistakes by default, same as S/B/W/M/T', () => {
  w.localStorage.setItem('quranReviewAyahMistakes', JSON.stringify([
    { surah: 1, ayah: 6, hizb: 1, type: 'E', note: '', date: '2026-08-01T00:00:00.000Z' },
    { surah: 1, ayah: 7, hizb: 1, type: 'K', note: '', date: '2026-08-01T00:00:00.000Z' },
  ]));

  const ranking = toPlain(w.computeAyahMistakeRanking('all', 'all'));
  w.localStorage.clear();

  assert.deepEqual(ranking.map(r => r.surah + ':' + r.ayah).sort(), ['1:6', '1:7'], 'both count, no includeAttention needed');
});

test('groupAyahMistakesByCount and computeAyahMistakeRanking also exclude a combo type containing "A" (e.g. "AB"), not just a bare "A"', () => {
  w.localStorage.setItem('quranReviewAyahMistakes', JSON.stringify([
    { surah: 1, ayah: 1, hizb: 1, type: 'S', note: '', date: '2026-08-01T00:00:00.000Z' },
    { surah: 1, ayah: 2, hizb: 1, type: 'AB', note: 'almost forgot the beginning', date: '2026-08-01T00:00:00.000Z' },
  ]));

  const grouped = toPlain(w.groupAyahMistakesByCount(w.loadAyahMistakes()));
  const ranking = toPlain(w.computeAyahMistakeRanking());
  w.localStorage.clear();

  assert.deepEqual(grouped.map(g => `${g.surah}:${g.ayah}`), ['1:1'], 'ayah 2 ("AB" — a near-miss, not a real mistake) never appears');
  assert.deepEqual(ranking.map(r => `${r.surah}:${r.ayah}`), ['1:1']);
});

test('computeAyatNeedingAttention lists a combo type containing "A" (e.g. "AB") too, not just a bare "A"', () => {
  w.localStorage.setItem('quranReviewAyahMistakes', JSON.stringify([
    { surah: 1, ayah: 1, hizb: 1, type: 'S', note: '', date: '2026-08-01T00:00:00.000Z' }, // not "A"-flavored — excluded
    { surah: 1, ayah: 2, hizb: 1, type: 'AB', note: 'almost forgot the beginning', date: '2026-08-01T00:00:00.000Z' },
  ]));
  const list = toPlain(w.computeAyatNeedingAttention());
  w.localStorage.clear();

  assert.deepEqual(list.map(r => `${r.surah}:${r.ayah}`), ['1:2']);
  assert.equal(list[0].note, 'almost forgot the beginning');
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

test('computeAllRevisionClusters also supports a "3d" timeframe', () => {
  const today = new Date(Date.now() - 2 * 3600000).toISOString();      // 2 hours ago
  const twoDaysAgo = new Date(Date.now() - 2 * 86400000).toISOString(); // 2 days ago
  const fiveDaysAgo = new Date(Date.now() - 5 * 86400000).toISOString(); // 5 days ago
  w.localStorage.setItem('quranReviewAyahMistakes', JSON.stringify([
    { surah: 1, ayah: 1, hizb: 1, date: today },
    { surah: 2, ayah: 1, hizb: 2, date: twoDaysAgo },
    { surah: 3, ayah: 1, hizb: 3, date: fiveDaysAgo },
  ]));

  const last3d = toPlain(w.computeAllRevisionClusters('3d'));
  w.localStorage.clear();

  assert.equal(last3d.length, 2, '3-day window keeps today\'s and 2-days-ago, drops 5-days-ago');
  assert.deepEqual(last3d.map(c => c.hizb).sort(), [1, 2]);
});

test('filterMistakesByTimeframe no longer recognizes "1d" — a rolling 24-hour window was dropped in favor of "last-session" (a real calendar day) everywhere it used to appear alongside it, so an unrecognized "1d" now behaves like "all" (unfiltered)', () => {
  const mistakes = [
    { surah: 1, ayah: 1, date: new Date(Date.now() - 2 * 3600000).toISOString() },     // 2 hours ago
    { surah: 2, ayah: 1, date: new Date(Date.now() - 20 * 86400000).toISOString() },   // 20 days ago
  ];
  assert.equal(w.filterMistakesByTimeframe(mistakes, '1d').length, 2, '"1d" is no longer a real window — falls through to unfiltered, same as "all"');
  assert.equal(w.filterMistakesByTimeframe(mistakes, '3d').length, 1, '"3d" still works as a real window');
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

test('importLogData imports a legacy pagesNeedingReview field into kind:"page" practiceRanges entries, dropping an out-of-range page number', () => {
  w.localStorage.clear();
  const realConfirm = w.confirm, realAlert = w.alert;
  let confirmMessage = null;
  w.confirm = (msg) => { confirmMessage = msg; return true; };
  w.alert = () => {};

  w.importLogData({
    review: {
      pagesNeedingReview: [
        { page: 15, note: 'redo this', date: '2026-08-01T00:00:00.000Z', source: 'paste' },
        { page: 999, note: '', date: '2026-08-01T00:00:00.000Z' }, // out of range — dropped
      ],
    },
  });

  assert.match(confirmMessage, /1 pages needing review/, 'the invalid page number is silently filtered before the summary/count, matching the other review fields\' validate-then-summarize pattern');
  const pages = toPlain(w.loadPracticeRanges().filter(r => r.kind === 'page'));
  assert.equal(pages.length, 1);
  assert.equal(pages[0].page, 15);
  assert.equal(pages[0].note, 'redo this');
  assert.equal(pages[0].target, 5, 'defaults to the standard page-practice target since the legacy shape had none');

  w.localStorage.clear();
  w.confirm = realConfirm;
  w.alert = realAlert;
});

test('importLogData imports review.telegramLastImportedAt through its own setter (so the sync-push side effect still runs), ignoring an unparseable value', () => {
  w.localStorage.clear();
  const realConfirm = w.confirm, realAlert = w.alert;
  let confirmMessage = null;
  w.confirm = (msg) => { confirmMessage = msg; return true; };
  w.alert = () => {};

  w.importLogData({ review: { telegramLastImportedAt: '2026-08-20T10:00:00.000Z' } });

  assert.match(confirmMessage, /Telegram last-imported timestamp/);
  assert.equal(w.localStorage.getItem('quranReviewTelegramLastImportedAt'), '2026-08-20T10:00:00.000Z');

  w.localStorage.clear();
  w.importLogData({ review: { telegramLastImportedAt: 'not a real date' } });
  assert.equal(w.localStorage.getItem('quranReviewTelegramLastImportedAt'), null, 'an unparseable value is treated as absent, not saved as garbage');

  w.localStorage.clear();
  w.confirm = realConfirm;
  w.alert = realAlert;
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

test('tapMistake tags a logged mistake with source: "live"', () => {
  w.localStorage.clear();
  w.document.getElementById('session-hizb').value = '1';
  w.document.getElementById('session-mistake-surah').value = '1';
  w.document.getElementById('session-mistake-ayah').value = '1';
  w.document.getElementById('session-mistake-note').value = '';
  w.document.getElementById('session-count').value = '0';

  w.tapMistake();

  const mistakes = w.loadAyahMistakes();
  assert.equal(mistakes.length, 1);
  assert.equal(mistakes[0].source, 'live');

  w.localStorage.clear();
});

test('repairImportedMistakeHizbs self-heals a paste/telegram-sourced mistake\'s stale hizb (from the old, buggy geometry), but leaves live-tapped and legacy source-less entries untouched', () => {
  w.localStorage.clear();
  w.localStorage.setItem('quranReviewAyahMistakes', JSON.stringify([
    // 2:70's real Hizb is 1 — this simulates an entry saved back when
    // hizbOfGlobalAyah still bisected the Juz evenly and got it wrong.
    { id: 'p1', surah: 2, ayah: 70, hizb: 2, type: null, note: '', date: '2026-08-01T00:00:00.000Z', source: 'paste' },
    { id: 't1', surah: 2, ayah: 70, hizb: 2, type: null, note: '', date: '2026-08-01T00:00:00.000Z', source: 'telegram' },
    // A live tap explicitly logged under Hizb 2 (the session's own choice)
    // is left exactly as recorded, even though 2:70 geometrically isn't
    // really Hizb 2 — that choice is the user's, not a bug to "fix".
    { id: 'l1', surah: 2, ayah: 70, hizb: 2, type: null, note: '', date: '2026-08-01T00:00:00.000Z', source: 'live' },
    // A legacy entry with no source field at all (predates the source
    // field) is treated the same as "live" — also untouched.
    { id: 'g1', surah: 2, ayah: 70, hizb: 2, type: null, note: '', date: '2026-08-01T00:00:00.000Z' },
    // Already-correct paste entry — untouched, and doesn't force a save.
    { id: 'p2', surah: 2, ayah: 5, hizb: 1, type: null, note: '', date: '2026-08-01T00:00:00.000Z', source: 'paste' },
  ]));

  w.repairImportedMistakeHizbs();

  const byId = Object.fromEntries(w.loadAyahMistakes().map(m => [m.id, m]));
  assert.equal(byId.p1.hizb, 1, 'paste-sourced entry recomputed to its real Hizb');
  assert.equal(byId.t1.hizb, 1, 'telegram-sourced entry recomputed too');
  assert.equal(byId.l1.hizb, 2, 'live tap keeps the session\'s own explicit Hizb choice');
  assert.equal(byId.g1.hizb, 2, 'source-less legacy entry (predates live tapping\'s own source field) also left alone');
  assert.equal(byId.p2.hizb, 1, 'already-correct entry stays as is');

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

test('importAyahMistakesFromText also parses "pN" page-review flags mixed into the same paste, tagged source "paste"', () => {
  w.localStorage.clear();
  const realConfirm = w.confirm, realAlert = w.alert;
  let confirmMessage = null, alertMessage = null;
  w.confirm = (msg) => { confirmMessage = msg; return true; };
  w.alert = (msg) => { alertMessage = msg; };

  const applied = w.importAyahMistakesFromText('280\np15\np20 need to redo the whole thing', 2);

  assert.equal(applied, true);
  assert.match(confirmMessage, /flag pages 15, 20 for review/);
  assert.match(alertMessage, /flag pages 15, 20 for review/);

  const pages = w.loadPracticeRanges().filter(r => r.kind === 'page');
  assert.equal(pages.length, 2);
  assert.deepEqual(toPlain(pages.map(p => p.page).sort((a, b) => a - b)), [15, 20]);
  assert.equal(pages.find(p => p.page === 20).note, 'need to redo the whole thing');
  assert.ok(pages.every(p => p.source === 'paste'));
  assert.ok(pages.every(p => p.target === 5), 'defaults to the standard page-practice target since no "x<count>" was given');
  assert.ok(pages.every(p => p.practiced === 0));

  assert.equal(w.loadAyahMistakes().length, 1, 'the ayah number (280) is still imported normally alongside the page flags');

  w.confirm = realConfirm;
  w.alert = realAlert;
  w.localStorage.clear();
});

test('importAyahMistakesFromText: a page-flags-only paste (no ayah numbers) still succeeds, without a stray "0 ayah mistakes" in the message', () => {
  w.localStorage.clear();
  const realConfirm = w.confirm, realAlert = w.alert;
  let confirmMessage = null;
  w.confirm = (msg) => { confirmMessage = msg; return true; };
  w.alert = () => {};

  const applied = w.importAyahMistakesFromText('p15', 2);

  assert.equal(applied, true);
  assert.match(confirmMessage, /Add flag page 15 for review\?/);
  assert.doesNotMatch(confirmMessage, /0 ayah mistake/);
  assert.equal(w.loadPracticeRanges().filter(r => r.kind === 'page').length, 1);
  assert.equal(w.loadAyahMistakes().length, 0);

  w.confirm = realConfirm;
  w.alert = realAlert;
  w.localStorage.clear();
});

test('importAyahMistakesFromText: an explicit "pNxT" overrides the default page-practice target', () => {
  w.localStorage.clear();
  const realConfirm = w.confirm, realAlert = w.alert;
  w.confirm = () => true;
  w.alert = () => {};

  w.importAyahMistakesFromText('p15x20 whole page felt shaky', 2);

  const page = w.loadPracticeRanges().find(r => r.kind === 'page');
  assert.ok(page);
  assert.equal(page.target, 20);
  assert.equal(page.note, 'whole page felt shaky');

  w.confirm = realConfirm;
  w.alert = realAlert;
  w.localStorage.clear();
});

test('importAyahMistakesFromText also parses "rM-Kx T" practice ranges mixed into the same paste, tagged source "paste", reusing whichever surah is active at that point (a "N:" switch, or the dropdown default)', () => {
  w.localStorage.clear();
  const realConfirm = w.confirm, realAlert = w.alert;
  let confirmMessage = null, alertMessage = null;
  w.confirm = (msg) => { confirmMessage = msg; return true; };
  w.alert = (msg) => { alertMessage = msg; };

  const applied = w.importAyahMistakesFromText('280\n4:\nr1-5x10 tricky', 2);

  assert.equal(applied, true);
  assert.match(confirmMessage, /add 1 practice range \(4:1-5\)/);
  assert.match(alertMessage, /add 1 practice range \(4:1-5\)/);

  const ranges = w.loadPracticeRanges();
  assert.equal(ranges.length, 1);
  assert.equal(ranges[0].surah, 4, 'picked up the "4:" switch, not the dropdown\'s surah 2');
  assert.equal(ranges[0].ayahStart, 1);
  assert.equal(ranges[0].ayahEnd, 5);
  assert.equal(ranges[0].target, 10);
  assert.equal(ranges[0].practiced, 0);
  assert.equal(ranges[0].note, 'tricky');
  assert.equal(ranges[0].source, 'paste');

  assert.equal(w.loadAyahMistakes().length, 1, 'the ayah number (2:280) is still imported normally alongside the practice range');

  w.confirm = realConfirm;
  w.alert = realAlert;
  w.localStorage.clear();
});

test('importAyahMistakesFromText: a practice-range-only paste (no ayah numbers) still succeeds, defaulting to the surah dropdown when there\'s no "N:" override', () => {
  w.localStorage.clear();
  const realConfirm = w.confirm, realAlert = w.alert;
  let confirmMessage = null;
  w.confirm = (msg) => { confirmMessage = msg; return true; };
  w.alert = () => {};

  const applied = w.importAyahMistakesFromText('r15-23x20', 2);

  assert.equal(applied, true);
  assert.match(confirmMessage, /add 1 practice range \(2:15-23\)/);
  assert.equal(w.loadPracticeRanges()[0].surah, 2, 'no "N:" override in the paste, so it falls back to the dropdown\'s surah');
  assert.equal(w.loadAyahMistakes().length, 0);

  w.confirm = realConfirm;
  w.alert = realAlert;
  w.localStorage.clear();
});

test('importAyahMistakesFromText skips an invalid practice range (start ayah after end ayah), after confirming, and keeps proceeding', () => {
  w.localStorage.clear();
  const realConfirm = w.confirm, realAlert = w.alert;
  const confirms = [];
  w.confirm = (msg) => { confirms.push(msg); return true; };
  w.alert = () => {};

  const applied = w.importAyahMistakesFromText('r23-15x20', 2);

  assert.equal(applied, false, 'nothing valid survives, so this reports "nothing left to add" and returns false');
  assert.ok(confirms.some(m => /practice range/i.test(m) && /skipped/.test(m)));
  assert.equal(w.loadPracticeRanges().length, 0);

  w.confirm = realConfirm;
  w.alert = realAlert;
  w.localStorage.clear();
});

test('importAyahMistakesFromText skips out-of-range page numbers (not 1-604), after confirming, and keeps the valid ones', () => {
  w.localStorage.clear();
  const realConfirm = w.confirm, realAlert = w.alert;
  const confirms = [];
  w.confirm = (msg) => { confirms.push(msg); return true; };
  w.alert = () => {};

  const applied = w.importAyahMistakesFromText('p15\np999', 2);

  assert.equal(applied, true);
  assert.ok(confirms.some(m => /isn't a real mushaf page.*999/.test(m)));
  const pages = w.loadPracticeRanges().filter(r => r.kind === 'page');
  assert.equal(pages.length, 1);
  assert.equal(pages[0].page, 15);

  w.confirm = realConfirm;
  w.alert = realAlert;
  w.localStorage.clear();
});

test('importAyahMistakesFromText: an "hN"-only paste (no ayah numbers, no page flags) logs a zero-mistake Recitation Log session for that Hizb', () => {
  w.localStorage.clear();
  const realConfirm = w.confirm, realAlert = w.alert;
  let confirmMessage = null;
  w.confirm = (msg) => { confirmMessage = msg; return true; };
  w.alert = () => {};

  const applied = w.importAyahMistakesFromText('h5', 2);

  assert.equal(applied, true);
  assert.match(confirmMessage, /Add log Hizb 5 recited with zero mistakes/);
  assert.doesNotMatch(confirmMessage, /0 ayah mistake/);
  const log = w.loadHizbLog();
  assert.equal(log.length, 1);
  assert.equal(log[0].hizb, 5);
  assert.equal(log[0].mistakes, 0);
  assert.equal(w.loadAyahMistakes().length, 0, 'a clean flag never creates an ayah mistake');

  w.confirm = realConfirm;
  w.alert = realAlert;
  w.localStorage.clear();
});

test('importAyahMistakesFromText: an out-of-range "hN" (not 1-60), alone, is confirmed then reported as nothing left to add (same invalid-range confirm as pages, but nothing survives it to actually save)', () => {
  w.localStorage.clear();
  const realConfirm = w.confirm, realAlert = w.alert;
  const confirms = [];
  let alertMessage = null;
  w.confirm = (msg) => { confirms.push(msg); return true; };
  w.alert = (msg) => { alertMessage = msg; };

  const applied = w.importAyahMistakesFromText('h99', 2);

  assert.equal(applied, false, 'nothing was actually added');
  assert.ok(confirms.some(m => /isn't a real Hizb.*99/.test(m)), 'still shown the invalid-range confirm first');
  assert.match(alertMessage, /Nothing left to add/);
  assert.equal(w.loadHizbLog().length, 0);

  w.confirm = realConfirm;
  w.alert = realAlert;
  w.localStorage.clear();
});

test('importAyahMistakesFromText: "hN" alone for an already-satisfied Hizb reports nothing left to add, without a blank "Add ?" confirm', () => {
  w.localStorage.clear();
  const today = new Date().toISOString();
  w.localStorage.setItem('quranReviewHizbLog', JSON.stringify([
    { id: 'existing', hizb: 5, mistakes: 2, date: today },
  ]));
  const realConfirm = w.confirm, realAlert = w.alert;
  let confirmCalled = false, alertMessage = null;
  w.confirm = () => { confirmCalled = true; return true; };
  w.alert = (msg) => { alertMessage = msg; };

  const applied = w.importAyahMistakesFromText('h5', 2);

  assert.equal(applied, false);
  assert.equal(confirmCalled, false, 'nothing to confirm — skips straight to telling the user there\'s nothing to add');
  assert.match(alertMessage, /Nothing left to add/);
  assert.equal(w.loadHizbLog()[0].mistakes, 2, 'the existing session is untouched');

  w.confirm = realConfirm;
  w.alert = realAlert;
  w.localStorage.clear();
});

test('importAyahMistakesFromText: real ayah mistakes and an "hN" flag for the SAME Hizb in one paste only create one session, not two', () => {
  w.localStorage.clear();
  const realConfirm = w.confirm, realAlert = w.alert;
  w.confirm = () => true;
  w.alert = () => {};

  // "1" and "2" (Al-Fatiha) both land in Hizb 1 — "h1" targets the same Hizb.
  const applied = w.importAyahMistakesFromText('1\n2\nh1', 1);

  assert.equal(applied, true);
  const log = w.loadHizbLog();
  assert.equal(log.length, 1, 'one session for Hizb 1, not two');
  assert.equal(log[0].mistakes, 2, 'the real mistakes are what the session reflects — the clean flag adds nothing on top');

  w.confirm = realConfirm;
  w.alert = realAlert;
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
  // "3:" switches to Aal-i-Imran (surah 3) for 5/6/8/10a — Hizb 5 actually
  // runs Al-Baqara 253 through Aal-i-Imran 14 (not an even ayah-count split
  // of the Juz — see quran-data.js's HIZB_RANGES comment), so these stay in
  // Hizb 5 too.
  const applied = w.importAyahMistakesFromText('280\n3:\n5\n6\n8\n10a', 2);

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
  assert.deepEqual(bySurah[3].map(m => m.ayah).sort((a, b) => a - b), [5, 6, 8, 10]);
  assert.equal(mistakes.find(m => m.ayah === 10 && m.surah === 3).type, 'A', '"10a" is a Needs-Attention flag, not a mistake');
  assert.ok(mistakes.every(m => m.source === 'paste'), 'every mistake from a paste-import is tagged source: "paste"');

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

test('saveAyahMistakeEdit leaves source untouched — editing type/note/surah/ayah doesn\'t change how the mistake was originally logged', () => {
  w.localStorage.clear();
  w.localStorage.setItem('quranReviewAyahMistakes', JSON.stringify([
    { id: 'm1', surah: 1, ayah: 3, hizb: 1, type: null, note: '', date: '2026-08-01T00:00:00.000Z', source: 'telegram' },
  ]));
  w.startAyahMistakeEdit('m1');

  w.document.getElementById('edit-mistake-surah-m1').value = '1';
  w.document.getElementById('edit-mistake-ayah-m1').value = '5';
  w.document.getElementById('edit-mistake-note-m1').value = 'updated note';

  w.saveAyahMistakeEdit('m1');

  const mistake = w.loadAyahMistakes()[0];
  assert.equal(mistake.ayah, 5, 'the edit itself did apply');
  assert.equal(mistake.source, 'telegram', 'source is untouched by the edit');

  w.localStorage.clear();
});

test('saveAyahMistakeEdit recomputes hizb when the edited surah/ayah lands in a different Hizb (e.g. fixing a typo\'d ayah number)', () => {
  w.localStorage.clear();
  const staleHizb = w.hizbOfGlobalAyah(7 + 259 - 1); // wherever "2:259" (the typo) really falls — 7 = Al-Fatiha's ayah count
  const correctHizb = w.hizbOfGlobalAyah(7 + 249 - 1); // wherever "2:249" (the intended ayah) really falls
  assert.notEqual(staleHizb, correctHizb, 'sanity check — this test only means something if the two ayat land in different Hizbs');

  w.localStorage.setItem('quranReviewAyahMistakes', JSON.stringify([
    { id: 'm1', surah: 2, ayah: 259, hizb: staleHizb, type: null, note: 'forgot fasala', date: '2026-08-15T00:00:00.000Z', source: 'telegram' },
  ]));
  w.startAyahMistakeEdit('m1');
  w.document.getElementById('edit-mistake-surah-m1').value = '2';
  w.document.getElementById('edit-mistake-ayah-m1').value = '249';
  w.saveAyahMistakeEdit('m1');

  const mistake = w.loadAyahMistakes()[0];
  assert.equal(mistake.ayah, 249);
  assert.equal(mistake.hizb, correctHizb, 'moved to the ayah\'s correct Hizb, not left on the stale one — every Hizb-grouped view reads this stored field');

  w.localStorage.clear();
});

test('saveAyahMistakeEdit re-points sessionId at the new Hizb\'s same-day session when a hizb-changing edit would otherwise orphan the mistake from every session (real bug: the entry vanished from "Last Session" views entirely, without being deleted)', () => {
  w.localStorage.clear();
  const staleHizb = w.hizbOfGlobalAyah(7 + 259 - 1);
  const correctHizb = w.hizbOfGlobalAyah(7 + 249 - 1);
  assert.notEqual(staleHizb, correctHizb, 'sanity check');

  const oldHizbSessionId = 'sess-old';
  const newHizbSessionId = 'sess-new';
  w.localStorage.setItem('quranReviewHizbLog', JSON.stringify([
    { id: oldHizbSessionId, hizb: staleHizb, mistakes: 1, date: '2026-08-15T20:46:00.000Z' },
    { id: newHizbSessionId, hizb: correctHizb, mistakes: 7, date: '2026-08-15T20:00:00.000Z' },
  ]));
  w.localStorage.setItem('quranReviewAyahMistakes', JSON.stringify([
    { id: 'm-anchor', surah: 2, ayah: 209, hizb: correctHizb, type: null, note: '', date: '2026-08-15T20:00:00.000Z', source: 'telegram', sessionId: newHizbSessionId },
    { id: 'm1', surah: 2, ayah: 259, hizb: staleHizb, type: null, note: 'forgot fasala', date: '2026-08-15T20:46:00.000Z', source: 'telegram', sessionId: oldHizbSessionId },
  ]));

  w.startAyahMistakeEdit('m1');
  w.document.getElementById('edit-mistake-surah-m1').value = '2';
  w.document.getElementById('edit-mistake-ayah-m1').value = '249';
  w.saveAyahMistakeEdit('m1');

  const edited = w.loadAyahMistakes().find(m => m.id === 'm1');
  assert.equal(edited.sessionId, newHizbSessionId, 're-linked to the new Hizb\'s own same-day session, not left pointing at the old Hizb\'s session');

  const lastSessionGroups = toPlain(w.computeAllHizbsMistakes('last-session'));
  const correctGroup = lastSessionGroups.find(g => g.hizb === correctHizb);
  assert.ok(correctGroup, 'the corrected Hizb has a "Last Session" group at all');
  assert.ok(correctGroup.mistakes.some(m => m.id === 'm1'), 'the edited mistake shows up under its new Hizb\'s Last Session view — not silently missing');
  assert.equal(lastSessionGroups.find(g => g.hizb === staleHizb), undefined, 'the old Hizb has no orphaned entry left dangling under it either');

  // Neither session's own `mistakes` tally is touched by the edit — those
  // are a fixed historical record of the sitting, same rule as
  // repairImportedMistakeHizbs already follows for geometry fixes.
  const log = w.loadHizbLog();
  assert.equal(log.find(e => e.id === oldHizbSessionId).mistakes, 1);
  assert.equal(log.find(e => e.id === newHizbSessionId).mistakes, 7);

  w.localStorage.clear();
});

test('saveAyahMistakeEdit reminds the user to fix the source Telegram message when a Telegram-sourced mistake\'s surah/ayah is edited', () => {
  w.localStorage.clear();
  const realAlert = w.alert;
  let alertMessage = null;
  w.alert = (msg) => { alertMessage = msg; };

  w.localStorage.setItem('quranReviewAyahMistakes', JSON.stringify([
    { id: 'm1', surah: 2, ayah: 259, hizb: 5, type: null, note: 'forgot fasala', date: '2026-08-15T00:00:00.000Z', source: 'telegram', telegramMessageId: 'tasmee315/11' },
  ]));
  w.startAyahMistakeEdit('m1');
  w.document.getElementById('edit-mistake-surah-m1').value = '2';
  w.document.getElementById('edit-mistake-ayah-m1').value = '249';
  w.saveAyahMistakeEdit('m1');

  assert.match(alertMessage, /Telegram message/i);
  assert.match(alertMessage, /2:259/, 'names the ORIGINAL ayah still sitting in the Telegram message');
  assert.match(alertMessage, /2:249/, 'names the corrected ayah too, for context');

  w.alert = realAlert;
  w.localStorage.clear();
});

test('saveAyahMistakeEdit does NOT show the Telegram reminder for a live/paste-sourced mistake, or when the ayah/surah didn\'t actually change', () => {
  w.localStorage.clear();
  const realAlert = w.alert;
  let alertCalled = false;
  w.alert = () => { alertCalled = true; };

  w.localStorage.setItem('quranReviewAyahMistakes', JSON.stringify([
    { id: 'm1', surah: 2, ayah: 100, hizb: 2, type: null, note: '', date: '2026-08-15T00:00:00.000Z', source: 'live' },
  ]));
  w.startAyahMistakeEdit('m1');
  w.document.getElementById('edit-mistake-surah-m1').value = '2';
  w.document.getElementById('edit-mistake-ayah-m1').value = '101'; // changed, but not Telegram-sourced
  w.saveAyahMistakeEdit('m1');
  assert.equal(alertCalled, false, 'no reminder for a non-Telegram source, no matter what changed');

  w.localStorage.setItem('quranReviewAyahMistakes', JSON.stringify([
    { id: 'm2', surah: 2, ayah: 100, hizb: 2, type: null, note: '', date: '2026-08-15T00:00:00.000Z', source: 'telegram', telegramMessageId: 'x/1' },
  ]));
  w.startAyahMistakeEdit('m2');
  w.document.getElementById('edit-mistake-surah-m2').value = '2';
  w.document.getElementById('edit-mistake-ayah-m2').value = '100'; // unchanged — only the note/type differ
  w.document.getElementById('edit-mistake-note-m2').value = 'just a note edit';
  w.saveAyahMistakeEdit('m2');
  assert.equal(alertCalled, false, 'no reminder when the ayah/surah is untouched — nothing for the Telegram message to fall out of sync with');

  w.alert = realAlert;
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

  const includedGroups = toPlain(w.computeAllHizbsMistakes('all', true));
  const hizb1 = includedGroups.find(g => g.hizb === 1);
  assert.equal(hizb1.mistakes.length, 3, 'includeAttention: true counts the type "A" entry too');

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

test('setIncludeAttentionAsMistakes toggles type "A" ayat into both "All Hizbs — Mistakes" and "Ayat You Mistake Most", off by default, and syncs every .include-attention-toggle checkbox', () => {
  w.localStorage.clear();
  w.setAllHizbsMistakesTimeframe('all');
  w.setAyahMistakeRankingTimeframe('all');
  w.localStorage.setItem('quranReviewAyahMistakes', JSON.stringify([
    { surah: 1, ayah: 6, hizb: 1, type: 'B', note: '', date: '2026-08-01T00:00:00.000Z' },
    { surah: 1, ayah: 7, hizb: 1, type: 'A', note: 'felt shaky', date: '2026-08-01T00:00:00.000Z' },
  ]));

  let allHizbsHtml = w.document.getElementById('all-hizbs-mistakes').innerHTML;
  let rankingHtml = w.document.getElementById('ayah-mistake-list').innerHTML;
  assert.doesNotMatch(allHizbsHtml, /1:7/, 'off by default');
  assert.doesNotMatch(rankingHtml, /1:7/, 'off by default');

  w.setIncludeAttentionAsMistakes(true);

  allHizbsHtml = w.document.getElementById('all-hizbs-mistakes').innerHTML;
  rankingHtml = w.document.getElementById('ayah-mistake-list').innerHTML;
  assert.match(allHizbsHtml, /1:7/, 'now counted in All Hizbs — Mistakes');
  assert.match(rankingHtml, /1:7/, 'now counted in Ayat You Mistake Most too');
  assert.ok(
    Array.from(w.document.querySelectorAll('.include-attention-toggle')).every(el => el.checked),
    'every checkbox with this class reflects the new state, not just the one that was clicked'
  );

  w.setIncludeAttentionAsMistakes(false); // leave state as found
  w.localStorage.clear();
  w.setAllHizbsMistakesTimeframe('last-session');
  w.setAyahMistakeRankingTimeframe('last-session');
});

test('printAllHizbsMistakes: bullet list (not a table), type code as a colored badge next to the ayah ref, Hizbs in ascending order, mistakes-desc/ayah-asc within each Hizb, and each ayah\'s opening words', async () => {
  // Runs FIRST among this file's printAllHizbsMistakes tests deliberately —
  // allClustersSurahCache (backing clusterAyahBeginning) is a module-level
  // Map that persists for the whole test file, keyed by surah number; once
  // a surah is cached (even with a stub returning no data), later tests
  // asking for that same surah get the stale cached value instead of
  // calling fetchSurahData again. This test is the one that actually checks
  // the real opening-words text, so it must be the first to touch surah 1/2.
  w.localStorage.clear();
  w.localStorage.setItem('quranReviewAyahMistakes', JSON.stringify([
    // Hizb 4 logged first but should print AFTER Hizb 1 (ascending order).
    { surah: 2, ayah: 220, hizb: 4, type: null, note: '', date: '2026-08-13T00:00:00.000Z' },
    { surah: 2, ayah: 218, hizb: 4, type: 'B', note: '', date: '2026-08-13T00:00:00.000Z' }, // 1 mistake, earlier ayah — should still print after 2:220's 2 mistakes
    { surah: 2, ayah: 220, hizb: 4, type: null, note: '', date: '2026-08-13T00:00:00.000Z' },
    { surah: 1, ayah: 1, hizb: 1, type: 'S', note: 'slow', date: '2026-08-01T00:00:00.000Z' },
  ]));
  w.setAllHizbsMistakesTimeframe('all');

  const realOpen = w.window.open;
  const { win: fakeWin, getCaptured } = makeFakePrintWindow();
  w.window.open = () => fakeWin;
  const realFetchSurahData = w.fetchSurahData;
  w.fetchSurahData = async (surahNum) => ({
    arabicAyahs: surahNum === 1
      ? [{ numberInSurah: 1, text: 'بسم الله الرحمن الرحيم' }]
      : Array.from({ length: 220 }, (_, i) => ({ numberInSurah: i + 1, text: i === 219 ? 'الم' : 'x' })),
  });

  await w.printAllHizbsMistakes();
  const captured = getCaptured();

  assert.doesNotMatch(captured, /<table/, 'no table — bullet points instead');
  assert.doesNotMatch(captured, /<th>Type<\/th>/, 'no separate Type column');
  assert.match(captured, /<li><span class="hizb-mistakes-print-ref">2:218<\/span><span class="print-type-badge type-B">B<\/span>/, 'the type code renders as a small colored badge right after the ayah ref');
  assert.match(captured, /<li><span class="hizb-mistakes-print-ref">1:1<\/span><span class="print-type-badge type-S">S<\/span>/);
  assert.match(captured, /بسم الله الرحمن الرحيم/, 'each ayah\'s opening words are shown');
  assert.match(
    captured,
    /<li>.*<span class="hizb-mistakes-print-beginning ayah-ar">بسم الله الرحمن الرحيم<\/span><\/li>/,
    'the opening words sit INLINE at the end of the same <li> line (not a separate <div> below it), to keep each mistake to one line'
  );

  const hizb1Idx = captured.indexOf('Hizb 1 (');
  const hizb4Idx = captured.indexOf('Hizb 4 (');
  assert.ok(hizb1Idx >= 0 && hizb4Idx > hizb1Idx, 'Hizb 1 prints before Hizb 4 — ascending order, not most-mistakes-first');

  const idx220 = captured.indexOf('2:220');
  const idx218 = captured.indexOf('2:218');
  assert.ok(idx220 >= 0 && idx220 < idx218, '2:220 (2 mistakes) prints before 2:218 (1 mistake) — mistakes descending');

  w.window.open = realOpen;
  w.fetchSurahData = realFetchSurahData;
  w.localStorage.clear();
});

test('printAllHizbsMistakes opens synchronously and includes every Hizb group', async () => {
  w.localStorage.clear();
  w.localStorage.setItem('quranReviewAyahMistakes', JSON.stringify([
    { surah: 1, ayah: 1, hizb: 1, type: 'S', note: 'slow', date: '2026-08-01T00:00:00.000Z' },
    { surah: 2, ayah: 5, hizb: 2, type: null, note: '', date: '2026-08-01T00:00:00.000Z' },
  ]));
  w.setAllHizbsMistakesTimeframe('all');

  let openCalled = false;
  const realOpen = w.window.open;
  const { win: fakeWin, getCaptured } = makeFakePrintWindow();
  w.window.open = () => { openCalled = true; return fakeWin; };
  const realFetchSurahData = w.fetchSurahData;
  w.fetchSurahData = async () => ({ arabicAyahs: [] });

  await w.printAllHizbsMistakes();
  const captured = getCaptured();

  assert.ok(openCalled, 'window.open was called synchronously');
  assert.match(captured, /Hizb 1/);
  assert.match(captured, /Hizb 2/);
  assert.match(captured, /1:1/);
  assert.match(captured, /2:5/);

  const groupCount = (captured.match(/class="hizb-mistakes-print-group"/g) || []).length;
  assert.equal(groupCount, 2, 'each Hizb still gets its own group wrapper (page-break-inside: avoid keeps it from splitting across a page boundary)');
  assert.match(captured, /Hizb 1 \(.*Hizb 2 \(/s, 'both Hizbs present, in ascending order, one plain column — no float/flex/multi-column layout to break in real print');

  w.window.open = realOpen;
  w.fetchSurahData = realFetchSurahData;
  w.localStorage.clear();
});

test('printAllHizbsMistakes does not crash when window.open is blocked (returns null) — printHtmlDocument\'s own guard covers it', async () => {
  w.localStorage.clear();
  w.localStorage.setItem('quranReviewAyahMistakes', JSON.stringify([
    { surah: 1, ayah: 1, hizb: 1, type: null, note: '', date: '2026-08-01T00:00:00.000Z' },
  ]));
  w.setAllHizbsMistakesTimeframe('all');

  const realOpen = w.window.open;
  w.window.open = () => null; // simulates a pop-up blocker
  const realFetchSurahData = w.fetchSurahData;
  w.fetchSurahData = async () => ({ arabicAyahs: [] });

  await assert.doesNotReject(() => w.printAllHizbsMistakes());

  w.window.open = realOpen;
  w.fetchSurahData = realFetchSurahData;
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

test('setAyahMistakeRankingTimeframe narrows the on-screen ranking', () => {
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

  w.setAyahMistakeRankingTimeframe('all');
  html = w.document.getElementById('ayah-mistake-list').innerHTML;
  assert.match(html, /1:1/);
  assert.match(html, /1:2/);

  w.localStorage.clear();
});

test('renderMistakeTypeFilterButtons shows a bare letter (full name in a title tooltip) rather than spelling out the label on the button — a mixed row of "All" and "B · Forgot the beginning" used to wrap every button to a different height', () => {
  w.renderMistakeTypeFilterButtons();
  const html = w.document.getElementById('ayah-mistake-type-filter').innerHTML;

  assert.match(html, />All</);
  assert.match(html, /title="Forgot the beginning"[^>]*>B</, 'the full label sits in a tooltip, not spelled out as the button\'s own visible text');
  assert.match(html, /title="Multiple mistakes"[^>]*>M</);
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

test('setLogSubview also handles the "backup" sub-tab (Import from Telegram + Save/Load Backup)', () => {
  w.setLogSubview('backup');
  assert.equal(w.document.getElementById('log-subview-session').style.display, 'none');
  assert.equal(w.document.getElementById('log-subview-history').style.display, 'none');
  assert.equal(w.document.getElementById('log-subview-backup').style.display, '');
  assert.equal(w.document.querySelector('.log-subtab.active').dataset.subview, 'backup');

  w.setLogSubview('session'); // leave global test state as found
});

test('"Save as JSON File" / "Import from Local Log" / "Import from Telegram" all live in the "Backup & Import" sub-tab, not Log a Session or Clusters & History', () => {
  const backupHtml = w.document.getElementById('log-subview-backup').innerHTML;
  assert.match(backupHtml, /Save as JSON File/);
  assert.ok(backupHtml.includes('id="import-file-input"'));
  assert.ok(backupHtml.includes('id="telegram-import-btn"'));

  const sessionHtml = w.document.getElementById('log-subview-session').innerHTML;
  assert.ok(!sessionHtml.includes('id="telegram-import-btn"'), 'moved out of Log a Session');

  const historyHtml = w.document.getElementById('log-subview-history').innerHTML;
  assert.doesNotMatch(historyHtml, /Save as JSON File/, 'moved out of Clusters & History');
  assert.ok(!historyHtml.includes('id="import-file-input"'), 'moved out of Clusters & History');
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
  assert.equal(fresh.document.getElementById('ayah-ranking-timeframe-select').value, 'last-session');
  assert.equal(fresh.document.getElementById('all-hizbs-mistakes-timeframe-select').value, 'last-session');
  assert.equal(fresh.document.getElementById('all-clusters-timeframe-select').value, 'last-session');
  assert.equal(fresh.document.getElementById('recitation-log-timeframe-select').value, 'last-session');
});

test('every timeframe dropdown (Ayat Ranking, All Hizbs Mistakes, All Revision Clusters, Recitation Log) offers a "Last Session" option but never a rolling "1d"/"Today" one — the two used to mean confusingly similar things, so the rolling window was dropped in favor of "Last Session" everywhere', () => {
  const ids = ['ayah-ranking-timeframe-select', 'all-hizbs-mistakes-timeframe-select', 'all-clusters-timeframe-select', 'recitation-log-timeframe-select'];
  ids.forEach(id => {
    const values = Array.from(w.document.getElementById(id).options).map(o => o.value);
    assert.ok(values.includes('last-session'), `#${id} is missing a "Last Session" option`);
    assert.ok(!values.includes('1d'), `#${id} should no longer offer a rolling "1d" option — merged into "last-session"`);
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

test('renderAllHizbsMistakes: Hizbs display in ascending order, even when a higher-numbered Hizb has more mistakes', () => {
  w.localStorage.clear();
  w.localStorage.setItem('quranReviewAyahMistakes', JSON.stringify([
    // Hizb 4 has more total mistakes than Hizb 1, so it'd sort first under
    // "most mistakes first" — but display order should still be ascending.
    { surah: 2, ayah: 220, hizb: 4, type: null, note: '', date: '2026-08-13T00:00:00.000Z' },
    { surah: 2, ayah: 218, hizb: 4, type: 'B', note: '', date: '2026-08-13T00:00:00.000Z' },
    { surah: 1, ayah: 1, hizb: 1, type: 'S', note: '', date: '2026-08-01T00:00:00.000Z' },
  ]));
  w.setAllHizbsMistakesTimeframe('all');

  const html = w.document.getElementById('all-hizbs-mistakes').innerHTML;
  const hizb1Idx = html.indexOf('Hizb 1<');
  const hizb4Idx = html.indexOf('Hizb 4<');
  assert.ok(hizb1Idx >= 0 && hizb4Idx > hizb1Idx, 'Hizb 1 renders before Hizb 4 on screen, even though Hizb 4 has more mistakes');

  w.localStorage.clear();
});

test('renderAllHizbsMistakes: within a Hizb, ties in mistake count break by ayah order (not insertion order)', () => {
  w.localStorage.clear();
  w.localStorage.setItem('quranReviewAyahMistakes', JSON.stringify([
    // All three are single mistakes (tied count) for Hizb 4, logged out of
    // ayah order — display should still read 2:213, 2:218, 2:230 in order.
    { surah: 2, ayah: 230, hizb: 4, type: null, note: '', date: '2026-08-13T00:00:00.000Z' },
    { surah: 2, ayah: 213, hizb: 4, type: null, note: '', date: '2026-08-11T00:00:00.000Z' },
    { surah: 2, ayah: 218, hizb: 4, type: null, note: '', date: '2026-08-12T00:00:00.000Z' },
  ]));
  w.setAllHizbsMistakesTimeframe('all');

  const html = w.document.getElementById('all-hizbs-mistakes').innerHTML;
  const idx213 = html.indexOf('2:213');
  const idx218 = html.indexOf('2:218');
  const idx230 = html.indexOf('2:230');
  assert.ok(idx213 >= 0 && idx213 < idx218 && idx218 < idx230, 'tied-count ayat read in ayah order, not the order they were logged');

  w.localStorage.clear();
});

test('All Hizbs — Mistakes: a count-1 row can be edited and deleted directly, and an edited ayah moves to its new Hizb\'s group', () => {
  w.localStorage.clear();
  const hizb5 = w.hizbOfGlobalAyah(7 + 259 - 1);
  const hizb4 = w.hizbOfGlobalAyah(7 + 249 - 1);
  assert.notEqual(hizb5, hizb4, 'sanity check');
  w.localStorage.setItem('quranReviewAyahMistakes', JSON.stringify([
    { id: 'm1', surah: 2, ayah: 259, hizb: hizb5, type: null, note: 'forgot fasala', date: '2026-08-15T00:00:00.000Z', source: 'telegram' },
  ]));
  w.setAllHizbsMistakesTimeframe('all');

  let html = w.document.getElementById('all-hizbs-mistakes').innerHTML;
  assert.match(html, new RegExp(`Hizb ${hizb5}`), 'starts out under its original (stale) Hizb');
  assert.match(html, /startAyahMistakeEdit\('m1'\)/, 'a count-1 row exposes an edit button directly, no need to expand anything first');
  assert.match(html, /deleteAyahMistake\('m1'\)/);

  w.startAyahMistakeEdit('m1');
  html = w.document.getElementById('all-hizbs-mistakes').innerHTML;
  assert.match(html, /edit-mistake-ayah-m1/, 'switches that row into the inline edit form');

  w.document.getElementById('edit-mistake-surah-m1').value = '2';
  w.document.getElementById('edit-mistake-ayah-m1').value = '249';
  w.saveAyahMistakeEdit('m1');

  html = w.document.getElementById('all-hizbs-mistakes').innerHTML;
  assert.match(html, new RegExp(`Hizb ${hizb4}`), 'now grouped under the corrected Hizb');
  assert.doesNotMatch(html, new RegExp(`Hizb ${hizb5}`), 'no longer listed under the stale Hizb at all — this is the only mistake in storage');
  assert.match(html, /2:249/);

  w.deleteAyahMistake('m1');
  html = w.document.getElementById('all-hizbs-mistakes').innerHTML;
  assert.doesNotMatch(html, /2:249/, 'delete removes it from the view too');

  w.localStorage.clear();
});

test('printAllHizbsMistakes aggregates repeated ayat into one bullet showing the mistake count', async () => {
  w.localStorage.clear();
  w.localStorage.setItem('quranReviewAyahMistakes', JSON.stringify([
    { surah: 2, ayah: 213, hizb: 4, type: null, note: '', date: '2026-08-11T00:00:00.000Z' },
    { surah: 2, ayah: 213, hizb: 4, type: null, note: '', date: '2026-08-13T00:00:00.000Z' },
  ]));
  w.setAllHizbsMistakesTimeframe('all');

  const realOpen = w.window.open;
  const { win: fakeWin, getCaptured } = makeFakePrintWindow();
  w.window.open = () => fakeWin;
  const realFetchSurahData = w.fetchSurahData;
  w.fetchSurahData = async () => ({ arabicAyahs: [] });

  await w.printAllHizbsMistakes();
  const captured = getCaptured();

  assert.equal((captured.match(/2:213/g) || []).length, 1, '2:213 is printed once, not once per tap');
  assert.match(captured, /2 mistakes/, 'the aggregated count (2) is shown inline');

  w.window.open = realOpen;
  w.fetchSurahData = realFetchSurahData;
  w.localStorage.clear();
});

test('buildMutashabihatPrintSection lists every ayah in each group (not just two), with opening words, ranked by total logged mistakes', async () => {
  w.localStorage.clear();
  w.localStorage.setItem('quranReviewMutashabihatPairs', JSON.stringify([
    { id: 'g1', ayat: [{ surah: 1, ayah: 1 }, { surah: 2, ayah: 1 }, { surah: 3, ayah: 1 }], note: 'triple confusion', dateAdded: '2026-08-01T00:00:00.000Z' },
    { id: 'g2', ayat: [{ surah: 1, ayah: 2 }], note: '', dateAdded: '2026-08-02T00:00:00.000Z' },
  ]));
  w.localStorage.setItem('quranReviewAyahMistakes', JSON.stringify([
    { surah: 1, ayah: 2, hizb: 1, type: null, note: '', date: '2026-08-01T00:00:00.000Z' }, // makes g2 outrank g1 despite fewer ayat
  ]));
  const realFetchSurahData = w.fetchSurahData;
  w.fetchSurahData = async () => ({ arabicAyahs: [{ numberInSurah: 1, text: 'بِسْمِ' }, { numberInSurah: 2, text: 'text2' }] });

  const html = await w.buildMutashabihatPrintSection();
  w.fetchSurahData = realFetchSurahData;
  w.localStorage.clear();

  assert.match(html, /<h2>Mutashabihat<\/h2>/);
  assert.match(html, /\(3 ayat\)/, 'group g1 shows all 3 ayat in its own header, not just 2');
  assert.match(html, /1:1/);
  assert.match(html, /2:1/);
  assert.match(html, /3:1/);
  assert.match(html, /"triple confusion"/);
  const g2Idx = html.indexOf('1. Mutashabihat Group (1 ayat)');
  const g1Idx = html.indexOf('2. Mutashabihat Group (3 ayat)');
  assert.ok(g2Idx >= 0 && g1Idx > g2Idx, 'g2 (1 logged mistake) ranks above g1 (0 logged mistakes) despite having fewer ayat');
});

test('buildMutashabihatPrintSection returns a "no groups yet" message when there are none', async () => {
  w.localStorage.clear();
  const html = await w.buildMutashabihatPrintSection();
  assert.match(html, /No mutashabihat groups yet/);
});

test('buildRevisionClustersPrintSection reuses renderClusterPrintItem\'s start/end + opening-words shape, limited to the requested count and timeframe', async () => {
  w.localStorage.clear();
  w.localStorage.setItem('quranReviewAyahMistakes', JSON.stringify([
    { surah: 1, ayah: 1, hizb: 1, type: null, note: '', date: new Date().toISOString() },
    { surah: 1, ayah: 2, hizb: 1, type: null, note: '', date: new Date().toISOString() },
    { surah: 2, ayah: 5, hizb: 2, type: null, note: '', date: new Date().toISOString() },
  ]));
  const realFetchSurahData = w.fetchSurahData;
  w.fetchSurahData = async () => ({ arabicAyahs: [{ numberInSurah: 1, text: 'a' }, { numberInSurah: 2, text: 'b' }, { numberInSurah: 5, text: 'c' }] });

  const html = await w.buildRevisionClustersPrintSection(1, '7d');
  w.fetchSurahData = realFetchSurahData;
  w.localStorage.clear();

  assert.match(html, /<h2>Top 1 Revision Clusters — Last 7 Days<\/h2>/);
  const itemCount = (html.match(/class="cluster-print-item"/g) || []).length;
  assert.equal(itemCount, 1, 'limited to the requested count (1), even though 2 Hizbs have clusters');
  assert.match(html, /Start —/);
  assert.match(html, /1:1/, 'the larger cluster (Hizb 1, 2 mistakes) outranks the smaller one (Hizb 2, 1 mistake)');
});

test('buildRevisionClustersPrintSection returns a "no clusters yet" message when there are none in the timeframe', async () => {
  w.localStorage.clear();
  const html = await w.buildRevisionClustersPrintSection(5, '7d');
  assert.match(html, /No revision clusters in this timeframe yet/);
});

test('buildPracticeRangesPrintSection lists range-kind and page-kind entries together, with a range\'s start/end opening words, and a "nothing yet" message when empty', async () => {
  w.localStorage.clear();
  const empty = await w.buildPracticeRangesPrintSection();
  assert.match(empty, /Nothing on your practice list yet/);

  w.localStorage.setItem('quranReviewPracticeRanges', JSON.stringify([
    { id: 'p1', kind: 'page', page: 15, target: 5, practiced: 2, note: 'redo this', dateAdded: '2026-08-01T00:00:00.000Z', source: 'manual' },
    // Surah 3, not 2 — see the identical note on renderPracticeRanges' own
    // opening-words test above: surah 2 is permanently poisoned to null in
    // allClustersSurahCache by an earlier, unstubbed addPracticeRange/
    // importAyahMistakesFromText test elsewhere in this file.
    { id: 'r1', kind: 'range', surah: 3, ayahStart: 15, ayahEnd: 23, target: 20, practiced: 0, note: '', dateAdded: '2026-08-02T00:00:00.000Z', source: 'manual' },
  ]));
  const realFetchSurahData = w.fetchSurahData;
  w.fetchSurahData = async () => {
    const arabicAyahs = [];
    arabicAyahs[14] = { numberInSurah: 15, text: 'start words' };
    arabicAyahs[22] = { numberInSurah: 23, text: 'end words' };
    return { arabicAyahs };
  };
  const withEntries = await w.buildPracticeRangesPrintSection();
  w.fetchSurahData = realFetchSurahData;
  w.localStorage.clear();

  assert.match(withEntries, /<h2>Practice More<\/h2>/);
  assert.match(withEntries, /Page 15/);
  assert.match(withEntries, /"redo this"/);
  assert.match(withEntries, /3:15-23/);
  assert.match(withEntries, /practiced 2\/5 times/);
  assert.match(withEntries, /practiced 0\/20 times/);
  assert.match(withEntries, /Start — 3:15/);
  assert.match(withEntries, /start words/);
  assert.match(withEntries, /End — 3:23/);
  assert.match(withEntries, /end words/);
});

test('printSelectedSections combines only the checked sections into one document, in the order the sub-tab lists them', async () => {
  w.localStorage.clear();
  w.localStorage.setItem('quranReviewHizbLog', JSON.stringify([
    { id: 's1', hizb: 1, mistakes: 1, date: new Date().toISOString() },
  ]));
  w.localStorage.setItem('quranReviewAyahMistakes', JSON.stringify([
    { surah: 1, ayah: 1, hizb: 1, type: null, note: '', date: new Date().toISOString(), sessionId: 's1' },
  ]));
  w.localStorage.setItem('quranReviewPracticeRanges', JSON.stringify([
    { id: 'p1', kind: 'page', page: 15, target: 5, practiced: 0, note: '', dateAdded: new Date().toISOString() },
  ]));
  w.document.getElementById('print-section-mistakes').checked = true;
  w.document.getElementById('print-section-mutashabihat').checked = false;
  w.document.getElementById('print-section-clusters').checked = false;
  w.document.getElementById('print-section-practice').checked = true;

  const realOpen = w.window.open;
  const { win: fakeWin, getCaptured } = makeFakePrintWindow();
  w.window.open = () => fakeWin;
  const realFetchSurahData = w.fetchSurahData;
  w.fetchSurahData = async () => ({ arabicAyahs: [] });

  await w.printSelectedSections();
  const captured = getCaptured();

  w.window.open = realOpen;
  w.fetchSurahData = realFetchSurahData;
  w.document.getElementById('print-section-mutashabihat').checked = true;
  w.document.getElementById('print-section-clusters').checked = true;
  w.document.getElementById('print-section-practice').checked = false;
  w.localStorage.clear();

  assert.match(captured, /All Hizbs — Mistakes/);
  assert.match(captured, /<h2>Practice More<\/h2>/);
  assert.doesNotMatch(captured, /<h2>Mutashabihat<\/h2>/, 'unchecked section is left out entirely');
  assert.doesNotMatch(captured, /Revision Clusters/, 'unchecked section is left out entirely');
  const mistakesIdx = captured.indexOf('All Hizbs — Mistakes');
  const practiceIdx = captured.indexOf('Practice More');
  assert.ok(mistakesIdx >= 0 && practiceIdx > mistakesIdx, 'sections appear in the sub-tab\'s own order');
});

test('printSelectedSections alerts and does not open a window when nothing is checked', async () => {
  w.localStorage.clear();
  w.document.getElementById('print-section-mistakes').checked = false;
  w.document.getElementById('print-section-mutashabihat').checked = false;
  w.document.getElementById('print-section-clusters').checked = false;
  w.document.getElementById('print-section-practice').checked = false;

  let openCalled = false, alertMsg = null;
  const realOpen = w.window.open, realAlert = w.alert;
  w.window.open = () => { openCalled = true; return null; };
  w.alert = (msg) => { alertMsg = msg; };

  await w.printSelectedSections();

  w.window.open = realOpen;
  w.alert = realAlert;
  w.document.getElementById('print-section-mistakes').checked = true;
  w.document.getElementById('print-section-mutashabihat').checked = true;
  w.document.getElementById('print-section-clusters').checked = true;

  assert.equal(openCalled, false, 'never opens a window if there is nothing to print');
  assert.match(alertMsg, /Pick at least one section/);
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

test('All Hizbs — Mistakes: the ayah ref\'s click-to-expand-full-text is wired with stopPropagation and independent of the row\'s own mistake-entries toggle', async () => {
  w.localStorage.clear();
  w.localStorage.setItem('quranReviewAyahMistakes', JSON.stringify([
    { surah: 113, ayah: 2, hizb: 60, type: 'S', note: 'first tap', date: '2026-08-11T00:00:00.000Z' },
    { surah: 113, ayah: 2, hizb: 60, type: 'B', note: 'second tap', date: '2026-08-13T00:00:00.000Z' },
  ]));
  w.setAllHizbsMistakesTimeframe('all');

  let html = w.document.getElementById('all-hizbs-mistakes').innerHTML;
  assert.match(
    html, /onclick="event\.stopPropagation\(\); toggleAyahText\(113, 2\)"/,
    'the ayah ref has its own stopPropagation\'d click, so it never also fires the parent row\'s toggleAllHizbsMistakeAyahExpand'
  );

  const realFetchSurahData = w.fetchSurahData;
  w.fetchSurahData = async (surahNum) => {
    if (surahNum !== 113) return { arabicAyahs: [], transAyahs: [] };
    return {
      arabicAyahs: [{ text: 'قل أعوذ برب الفلق' }, { text: 'من شر ما خلق' }],
      transAyahs: [{ text: 'Say: I seek refuge' }, { text: 'From the evil of what He created' }],
    };
  };

  await w.toggleAyahText(113, 2);

  html = w.document.getElementById('all-hizbs-mistakes').innerHTML;
  assert.match(html, /من شر ما خلق/, 'ayah text expanded');
  assert.doesNotMatch(html, /first tap/, 'the row\'s OTHER, independent expand state (mistake-entries detail) was not also toggled on');

  await w.toggleAyahText(113, 2); // leave state as found
  w.fetchSurahData = realFetchSurahData;
  w.setAllHizbsMistakesTimeframe('last-session');
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

test('toggleAyahText expands an ayah\'s full Arabic + translation, in sync across every section that lists it, and collapses on a second click', async () => {
  w.localStorage.clear();
  w.localStorage.setItem('quranReviewAyahMistakes', JSON.stringify([
    { surah: 1, ayah: 2, hizb: 1, type: 'A', note: '', date: '2026-08-11T00:00:00.000Z' }, // shows in Needs Attention
    { surah: 1, ayah: 2, hizb: 1, type: 'S', note: '', date: '2026-08-11T00:00:00.000Z' }, // shows in Ayat You Mistake Most
  ]));
  w.setAyahMistakeRankingTimeframe('all');
  const realFetchSurahData = w.fetchSurahData;
  w.fetchSurahData = async (surahNum) => {
    if (surahNum !== 1) return { arabicAyahs: [], transAyahs: [] };
    return {
      arabicAyahs: [{ text: 'الحمد لله رب العالمين' }, { text: 'الرحمن الرحيم' }],
      transAyahs: [{ text: 'Praise be to Allah' }, { text: 'The Most Gracious' }],
    };
  };

  let needsAttentionHtml = w.document.getElementById('ayah-needs-attention-list').innerHTML;
  let rankingHtml = w.document.getElementById('ayah-mistake-list').innerHTML;
  assert.doesNotMatch(needsAttentionHtml, /الرحمن الرحيم/, 'collapsed by default');
  assert.doesNotMatch(rankingHtml, /الرحمن الرحيم/, 'collapsed by default');

  await w.toggleAyahText(1, 2);

  needsAttentionHtml = w.document.getElementById('ayah-needs-attention-list').innerHTML;
  rankingHtml = w.document.getElementById('ayah-mistake-list').innerHTML;
  assert.match(needsAttentionHtml, /الرحمن الرحيم/, 'Needs Attention shows the full ayah once expanded');
  assert.match(needsAttentionHtml, /The Most Gracious/);
  assert.match(rankingHtml, /الرحمن الرحيم/, 'Ayat You Mistake Most shows the same expanded ayah in sync');
  assert.match(rankingHtml, /The Most Gracious/);

  await w.toggleAyahText(1, 2); // second click collapses it again
  needsAttentionHtml = w.document.getElementById('ayah-needs-attention-list').innerHTML;
  assert.doesNotMatch(needsAttentionHtml, /الرحمن الرحيم/);

  w.fetchSurahData = realFetchSurahData;
  w.setAyahMistakeRankingTimeframe('3d');
  w.localStorage.clear();
});

test('toggleAyahText shows a "could not load" message instead of throwing when fetchSurahData fails', async () => {
  w.localStorage.clear();
  // Surah 114 — distinct from other toggleAyahText tests, since ayahTextCache
  // persists across the whole test file and would otherwise serve this
  // surah's earlier (successful) cached result instead of re-fetching.
  w.localStorage.setItem('quranReviewAyahMistakes', JSON.stringify([
    { surah: 114, ayah: 5, hizb: 60, type: 'A', note: '', date: '2026-08-11T00:00:00.000Z' },
  ]));
  const realFetchSurahData = w.fetchSurahData;
  w.fetchSurahData = async () => { throw new Error('offline'); };

  await w.toggleAyahText(114, 5);

  const html = w.document.getElementById('ayah-needs-attention-list').innerHTML;
  assert.match(html, /Could not load this ayah/);

  await w.toggleAyahText(114, 5); // leave state as found
  w.fetchSurahData = realFetchSurahData;
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
  assert.match(confirmMessage, /1 existing session updated \(Hizb 5\)/);
  assert.match(alertMessage, /1 existing session updated \(Hizb 5\)/);

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

test('looksLikeAyahLogMessage requires at least one line starting with a digit, or a "pN" or "hN" flag line', () => {
  assert.equal(w.looksLikeAyahLogMessage('78b\n84a\n86b'), true, 'every line is a bare ayah');
  assert.equal(w.looksLikeAyahLogMessage('3:\n15\n16'), true, 'a surah-override line still starts with a digit');
  assert.equal(w.looksLikeAyahLogMessage('some note\n78b'), true, 'one matching line is enough');
  assert.equal(w.looksLikeAyahLogMessage('p15'), true, 'a page-review flag has no digit-leading line of its own, but is still real log data');
  assert.equal(w.looksLikeAyahLogMessage('h5'), true, 'same for a zero-mistake Hizb flag');
  assert.equal(w.looksLikeAyahLogMessage('H12 alhamdulillah'), true, 'case-insensitive, trailing text and all');
  assert.equal(w.looksLikeAyahLogMessage('r15-23x20'), true, 'a practice-range flag has no digit-leading line either, but is still real log data');
  assert.equal(w.looksLikeAyahLogMessage('R1-1x5 memorize this'), true, 'case-insensitive, trailing note and all');
  assert.equal(w.looksLikeAyahLogMessage('really need to redo this'), false, 'starts with "r" but doesn\'t match the r<n>-<n>x<n> shape');
  assert.equal(
    w.looksLikeAyahLogMessage('S (Stopped): Blanked mid-ayah, needed a prompt.\nB (Beginning): Forgot how the ayah starts.'),
    false,
    'the type-code legend has no line starting with a digit'
  );
  assert.equal(w.looksLikeAyahLogMessage('Channel created'), false);
  assert.equal(w.looksLikeAyahLogMessage('have a nice day'), false, 'starts with "h" but no digit right after — not a Hizb flag');
});

test('renderTelegramLastImportedAt shows "Never imported yet" with nothing stored, and a formatted date once something is', () => {
  w.localStorage.removeItem('quranReviewTelegramLastImportedAt');
  w.renderTelegramLastImportedAt();
  assert.match(w.document.getElementById('telegram-last-imported').textContent, /Never imported yet/);

  w.saveTelegramLastImportedAt('2026-08-14T20:14:46.000Z');
  assert.match(w.document.getElementById('telegram-last-imported').textContent, /Last imported/);
  assert.doesNotMatch(w.document.getElementById('telegram-last-imported').textContent, /Never imported yet/);

  w.localStorage.removeItem('quranReviewTelegramLastImportedAt');
  w.renderTelegramLastImportedAt();
});

test('saveTelegramLastImportedAt pushes its own sync update — a device that never ran Import from Telegram before should still see a fresh timestamp promptly', () => {
  w.localStorage.clear();
  const realIsSyncConnected = w.isSyncConnected;
  let pushed = null;
  w.isSyncConnected = () => true;
  w.syncDocRef = () => ({ set: async (payload) => { pushed = payload; } });

  w.saveTelegramLastImportedAt('2026-08-20T10:00:00.000Z');

  assert.ok(pushed, 'saveTelegramLastImportedAt triggers its own push, not just a localStorage write');
  assert.equal(pushed.review.telegramLastImportedAt, '2026-08-20T10:00:00.000Z');

  w.isSyncConnected = realIsSyncConnected;
  w.localStorage.clear();
});

test('telegramAyahMistakeExists is existence-based on (telegramMessageId, surah, ayah), not a "seen before" cursor', () => {
  w.localStorage.clear();
  w.localStorage.setItem('quranReviewAyahMistakes', JSON.stringify([
    { id: 'm1', surah: 2, ayah: 78, hizb: 1, type: 'B', note: '', date: '2026-08-14T19:24:28+00:00', source: 'telegram', telegramMessageId: 'tasmee315/4' },
  ]));
  assert.equal(w.telegramAyahMistakeExists('tasmee315/4', 2, 78), true);
  assert.equal(w.telegramAyahMistakeExists('tasmee315/4', 2, 84), false, 'same message but a different ayah was never logged');
  assert.equal(w.telegramAyahMistakeExists('tasmee315/999', 2, 78), false, 'a different message entirely');
  w.localStorage.clear();
});

test('importMistakesFromTelegram asks which surah a message with no "N:" override is for, starting blank every time, and creates ayah mistakes tagged source "telegram" + the originating message id', async () => {
  w.localStorage.clear();
  const realFetch = w.fetch, realConfirm = w.confirm, realAlert = w.alert, realPrompt = w.prompt;
  let fetchedUrl = null, confirmMessage = null, alertMessage = null;
  const promptCalls = [];
  w.fetch = async (url) => {
    fetchedUrl = url;
    return { ok: true, status: 200, text: async () => fakeTelegramHtml() };
  };
  w.prompt = (msg, defaultValue) => { promptCalls.push({ msg, defaultValue }); return '2'; };
  w.confirm = (msg) => { confirmMessage = msg; return true; };
  w.alert = (msg) => { alertMessage = msg; };

  await w.importMistakesFromTelegram();

  assert.match(fetchedUrl, /api\.allorigins\.win/, 'goes through the CORS proxy, not a direct t\.me fetch');
  assert.match(fetchedUrl, /t\.me%2Fs%2Ftasmee315/, 'targets the channel\'s public preview page, URL-encoded');

  assert.equal(promptCalls.length, 2, 'one to ask which surah message 4 is for, one to review that guess before saving — message 7 has its own "3:" override and is never asked about either time');
  assert.match(promptCalls[0].msg, /Which surah is this Telegram message for/);
  assert.match(promptCalls[0].msg, /78b/, 'shows the message\'s own text so the user knows what they\'re answering for');
  assert.equal(promptCalls[0].defaultValue, undefined, 'never prefilled — always starts blank so a stale/wrong value can\'t be silently accepted');
  assert.match(promptCalls[1].msg, /ayah mistakes from Telegram will be logged under this surah/, 'the surah-review step, pre-filled with the just-answered surah');
  assert.equal(promptCalls[1].defaultValue, '2');

  assert.match(confirmMessage, /Import 5 ayah mistakes/, '7 parsed ayat minus the 2 tagged "A" (needs attention)');
  assert.match(confirmMessage, /flag 2 ayahs as "Needs Attention"/);
  assert.doesNotMatch(confirmMessage, /Channel created/, 'the service message never surfaces anywhere');
  assert.match(confirmMessage, /2:78 \(B\)/, 'lists each individual ayah — not just a count — so nothing is imported unseen');
  assert.match(confirmMessage, /2:84 \(A\)/);
  assert.match(confirmMessage, /3:15/);

  const mistakes = toPlain(w.loadAyahMistakes());
  assert.equal(mistakes.length, 7, '3 from message 4 ("78b/84a/86b") + 4 from message 7 ("3:" then 15/16/22/24a) — the service message and the type-code-legend note contribute none');
  assert.ok(mistakes.every(m => m.source === 'telegram'));

  const fromMsg4 = mistakes.filter(m => m.telegramMessageId === 'tasmee315/4');
  assert.equal(fromMsg4.length, 3);
  assert.deepEqual(fromMsg4.map(m => m.ayah).sort((a, b) => a - b), [78, 84, 86]);
  assert.ok(fromMsg4.every(m => m.surah === 2), 'no override in this message — uses whatever surah was answered in the prompt');

  const fromMsg7 = mistakes.filter(m => m.telegramMessageId === 'tasmee315/7');
  assert.equal(fromMsg7.length, 4);
  assert.ok(fromMsg7.every(m => m.surah === 3), 'this message\'s own "3:" override wins — never even prompted');

  assert.match(alertMessage, /Imported 5 ayah mistakes/);
  assert.ok(w.localStorage.getItem('quranReviewTelegramLastImportedAt'), 'the "last imported" timestamp is recorded once mistakes are actually saved');
  assert.match(w.document.getElementById('telegram-last-imported').textContent, /Last imported/);

  w.fetch = realFetch;
  w.prompt = realPrompt;
  w.confirm = realConfirm;
  w.alert = realAlert;
  w.localStorage.clear();
  w.renderTelegramLastImportedAt();
});

test('importMistakesFromTelegram imports a message written entirely in Arabic-Indic digits with a leading RLM mark — a real message on the channel used exactly this shape and was previously silently dropped', async () => {
  w.localStorage.clear();
  const realFetch = w.fetch, realConfirm = w.confirm, realAlert = w.alert, realPrompt = w.prompt;
  const html = `
    <div class="tgme_widget_message js-widget_message" data-post="tasmee315/53">
      <div class="tgme_widget_message_text">&rlm;٢٠٧</div>
      <div class="tgme_widget_message_footer"><span class="tgme_widget_message_date"><time datetime="2026-08-23T19:14:20+00:00">19:14</time></span></div>
    </div>
  `;
  w.fetch = async () => ({ ok: true, status: 200, text: async () => html });
  w.prompt = () => '2';
  w.confirm = () => true;
  w.alert = () => {};

  await w.importMistakesFromTelegram();

  const mistakes = toPlain(w.loadAyahMistakes());
  assert.equal(mistakes.length, 1);
  assert.equal(mistakes[0].surah, 2);
  assert.equal(mistakes[0].ayah, 207, 'the Arabic-Indic "٢٠٧" parsed as ayah 207, not silently skipped');
  assert.equal(mistakes[0].source, 'telegram');
  assert.equal(mistakes[0].telegramMessageId, 'tasmee315/53');

  w.fetch = realFetch;
  w.prompt = realPrompt;
  w.confirm = realConfirm;
  w.alert = realAlert;
  w.localStorage.clear();
});

test('importMistakesFromTelegram does not re-prompt for a message that already has a logged mistake — it reuses that mistake\'s surah instead', async () => {
  w.localStorage.clear();
  // Message 4 ("78b/84a/86b") already contributed ayah 78 under surah 2 in
  // an earlier run — simulates re-running the import on a message that was
  // already (at least partly) handled before.
  w.saveAyahMistakes([{
    id: 'pre-existing', surah: 2, ayah: 78, type: 'B', note: '',
    date: '2026-08-14T19:24:28.000Z', source: 'telegram', telegramMessageId: 'tasmee315/4',
  }]);
  const realFetch = w.fetch, realConfirm = w.confirm, realAlert = w.alert, realPrompt = w.prompt;
  const promptCalls = [];
  w.fetch = async () => ({ ok: true, status: 200, text: async () => fakeTelegramHtml() });
  // Accepts whatever's pre-filled — the surah-review step still asks about
  // the 2 NEW ayat (84, 86) since only 78 is already logged, but the
  // "which surah is this for" prompt should never fire, since that's the
  // one thing this fix skips when the surah is already known.
  w.prompt = (msg, defaultValue) => { promptCalls.push({ msg, defaultValue }); return defaultValue; };
  w.confirm = () => true;
  w.alert = () => {};

  await w.importMistakesFromTelegram();

  assert.ok(
    !promptCalls.some(c => /Which surah is this Telegram message for/.test(c.msg)),
    'message 4\'s surah is already known from its existing mistake — never re-asked, even though message 4 itself has no "N:" override'
  );
  assert.equal(promptCalls.length, 1, 'only the surah-review step (for the 2 new ayat) prompts, pre-filled with the reused surah');
  assert.equal(promptCalls[0].defaultValue, '2');
  const mistakes = w.loadAyahMistakes();
  const fromMsg4 = mistakes.filter(m => m.telegramMessageId === 'tasmee315/4');
  assert.equal(fromMsg4.length, 3, 'ayah 78 (pre-existing) plus 84 and 86, all filled in under the reused surah');
  assert.ok(fromMsg4.every(m => m.surah === 2));

  w.fetch = realFetch;
  w.prompt = realPrompt;
  w.confirm = realConfirm;
  w.alert = realAlert;
  w.localStorage.clear();
});

test('importMistakesFromTelegram never guesses a surah — cancelling (or leaving blank) the prompt skips just that message, importing the rest', async () => {
  w.localStorage.clear();
  const realFetch = w.fetch, realConfirm = w.confirm, realAlert = w.alert, realPrompt = w.prompt;
  let confirmMessage = null, alertMessage = null;
  w.fetch = async () => ({ ok: true, status: 200, text: async () => fakeTelegramHtml() });
  w.prompt = () => null; // user cancels
  w.confirm = (msg) => { confirmMessage = msg; return true; };
  w.alert = (msg) => { alertMessage = msg; };

  await w.importMistakesFromTelegram();

  assert.match(confirmMessage, /Import 3 ayah mistakes/, 'message 7\'s 3 real mistakes (15, 16, 22) — message 4 was skipped since its surah prompt was cancelled');
  assert.match(confirmMessage, /flag 1 ayah as "Needs Attention"/, 'ayah 24 ("24a") from message 7');
  assert.match(confirmMessage, /skipping 1 message with no surah given/);

  const mistakes = w.loadAyahMistakes();
  assert.equal(mistakes.length, 4, 'all 4 of message 7\'s ayat are still saved — 3 real mistakes plus the "Needs Attention" one');
  assert.ok(!mistakes.some(m => m.telegramMessageId === 'tasmee315/4'), 'never guessed a surah for it — just left out entirely');
  assert.match(alertMessage, /skipping 1 message with no surah given/);

  w.fetch = realFetch;
  w.prompt = realPrompt;
  w.confirm = realConfirm;
  w.alert = realAlert;
  w.localStorage.clear();
});

test('importMistakesFromTelegram asks for the surah only once for a whole leading run of unlabeled messages, carrying it forward until an "N:" message updates it', async () => {
  w.localStorage.clear();
  const realFetch = w.fetch, realConfirm = w.confirm, realAlert = w.alert, realPrompt = w.prompt;
  const promptCalls = [];
  // Mirrors a real sequence: 3 unlabeled messages (all meant for the same
  // surah), then a 4th that switches surah itself via "3:".
  w.fetch = async () => ({
    ok: true, status: 200,
    text: async () => `
      <div class="tgme_widget_message js-widget_message" data-post="x/1">
        <div class="tgme_widget_message_text">78b<br>84a<br>86b</div>
        <div class="tgme_widget_message_footer"><span class="tgme_widget_message_date"><time datetime="2026-08-14T12:24:00+00:00">12:24</time></span></div>
      </div>
      <div class="tgme_widget_message js-widget_message" data-post="x/2">
        <div class="tgme_widget_message_text">85 minkom<br>90a<br>91b</div>
        <div class="tgme_widget_message_footer"><span class="tgme_widget_message_date"><time datetime="2026-08-14T12:30:00+00:00">12:30</time></span></div>
      </div>
      <div class="tgme_widget_message js-widget_message" data-post="x/3">
        <div class="tgme_widget_message_text">118<br>121B</div>
        <div class="tgme_widget_message_footer"><span class="tgme_widget_message_date"><time datetime="2026-08-14T13:09:00+00:00">13:09</time></span></div>
      </div>
      <div class="tgme_widget_message js-widget_message" data-post="x/4">
        <div class="tgme_widget_message_text">3:<br>15<br>16</div>
        <div class="tgme_widget_message_footer"><span class="tgme_widget_message_date"><time datetime="2026-08-14T13:14:00+00:00">13:14</time></span></div>
      </div>
    `,
  });
  w.prompt = (msg, defaultValue) => { promptCalls.push({ msg, defaultValue }); return '2'; };
  w.confirm = () => true;
  w.alert = () => {};

  await w.importMistakesFromTelegram();

  assert.equal(promptCalls.length, 2, 'only the first (earliest, unlabeled) message triggers a "which surah" prompt, plus one surah-review prompt for the whole carried-forward group');
  assert.match(promptCalls[0].msg, /Which surah is this Telegram message for/);
  assert.match(promptCalls[0].msg, /78b/, 'asked about the FIRST message chronologically, not a later one');
  assert.match(promptCalls[1].msg, /ayah mistakes from Telegram will be logged under this surah/, 'one combined surah-review prompt covers messages 1-3\'s carried-forward ayat together');
  assert.equal(promptCalls[1].defaultValue, '2');

  const mistakes = w.loadAyahMistakes();
  const fromMsg1 = mistakes.filter(m => m.telegramMessageId === 'x/1');
  const fromMsg2 = mistakes.filter(m => m.telegramMessageId === 'x/2');
  const fromMsg3 = mistakes.filter(m => m.telegramMessageId === 'x/3');
  const fromMsg4 = mistakes.filter(m => m.telegramMessageId === 'x/4');
  assert.equal(fromMsg1.length, 3);
  assert.equal(fromMsg2.length, 3);
  assert.equal(fromMsg3.length, 2);
  assert.equal(fromMsg4.length, 2);
  assert.ok(fromMsg1.every(m => m.surah === 2), 'answered surah carries to the message that was actually prompted for');
  assert.ok(fromMsg2.every(m => m.surah === 2), 'and to the next unlabeled message, with no further prompt');
  assert.ok(fromMsg3.every(m => m.surah === 2), 'and the one after that too');
  assert.ok(fromMsg4.every(m => m.surah === 3), 'the 4th message\'s own "3:" override wins, updating the context going forward');

  w.fetch = realFetch;
  w.prompt = realPrompt;
  w.confirm = realConfirm;
  w.alert = realAlert;
  w.localStorage.clear();
});

test('importMistakesFromTelegram: deleting a Telegram-sourced mistake and re-running the import brings it back, without duplicating the ones still present', async () => {
  w.localStorage.clear();
  const realFetch = w.fetch, realConfirm = w.confirm, realAlert = w.alert, realPrompt = w.prompt;
  w.fetch = async () => ({ ok: true, status: 200, text: async () => fakeTelegramHtml() });
  w.prompt = () => '2';
  w.confirm = () => true;
  w.alert = () => {};

  await w.importMistakesFromTelegram(); // first run — imports all 7
  assert.equal(w.loadAyahMistakes().length, 7);

  // Simulate the user deleting message 4's 3 mistakes from the app.
  w.saveAyahMistakes(w.loadAyahMistakes().filter(m => m.telegramMessageId !== 'tasmee315/4'));
  assert.equal(w.loadAyahMistakes().length, 4);

  await w.importMistakesFromTelegram(); // second run — a plain "seen before" cursor would find nothing new here

  const mistakes = w.loadAyahMistakes();
  assert.equal(mistakes.length, 7, 'message 4\'s 3 mistakes came back; message 7\'s 4 were already present and were not duplicated');
  assert.equal(mistakes.filter(m => m.telegramMessageId === 'tasmee315/4').length, 3);
  assert.equal(mistakes.filter(m => m.telegramMessageId === 'tasmee315/7').length, 4, 'still exactly 4 — not doubled to 8');

  w.fetch = realFetch;
  w.prompt = realPrompt;
  w.confirm = realConfirm;
  w.alert = realAlert;
  w.localStorage.clear();
});

test('importMistakesFromTelegram alerts "nothing new" (no confirm) once every message\'s ayat are already logged', async () => {
  w.localStorage.clear();
  const realFetch = w.fetch, realConfirm = w.confirm, realAlert = w.alert, realPrompt = w.prompt;
  let confirmCalled = false, alertMessage = null;
  w.fetch = async () => ({ ok: true, status: 200, text: async () => fakeTelegramHtml() });
  w.prompt = () => '2';
  w.confirm = () => { confirmCalled = true; return true; };
  w.alert = (msg) => { alertMessage = msg; };

  await w.importMistakesFromTelegram(); // first run imports everything
  confirmCalled = false;
  await w.importMistakesFromTelegram(); // second run — same page, nothing deleted

  assert.equal(confirmCalled, false);
  assert.match(alertMessage, /Nothing new to import/);
  assert.ok(w.localStorage.getItem('quranReviewTelegramLastImportedAt'), 'still updates the "last imported" timestamp — the channel was checked, even though nothing was new');

  w.fetch = realFetch;
  w.prompt = realPrompt;
  w.confirm = realConfirm;
  w.alert = realAlert;
  w.localStorage.clear();
  w.renderTelegramLastImportedAt();
});

test('importMistakesFromTelegram silently skips service messages and messages that don\'t look like log data — no confirm about them', async () => {
  w.localStorage.clear();
  const realFetch = w.fetch, realConfirm = w.confirm, realAlert = w.alert, realPrompt = w.prompt;
  let confirmMessage = null;
  w.fetch = async () => ({ ok: true, status: 200, text: async () => fakeTelegramHtml() });
  w.prompt = () => '2';
  w.confirm = (msg) => { confirmMessage = msg; return true; };
  w.alert = () => {};

  await w.importMistakesFromTelegram();

  assert.doesNotMatch(confirmMessage, /Channel created/, 'the service message is never mentioned');
  assert.doesNotMatch(confirmMessage, /Stopped/, 'the type-code-legend note is never mentioned — it just contributes nothing');
  const mistakes = w.loadAyahMistakes();
  assert.ok(!mistakes.some(m => m.telegramMessageId === 'tasmee315/1'), 'service message');
  assert.ok(!mistakes.some(m => m.telegramMessageId === 'tasmee315/2'), 'type-code legend, not log data');

  w.fetch = realFetch;
  w.prompt = realPrompt;
  w.confirm = realConfirm;
  w.alert = realAlert;
  w.localStorage.clear();
});

test('importMistakesFromTelegram imports "pN" page-review flags from a message, tagged source "telegram" with the message id, no surah prompt needed', async () => {
  w.localStorage.clear();
  const realFetch = w.fetch, realConfirm = w.confirm, realAlert = w.alert, realPrompt = w.prompt;
  let confirmMessage = null, promptCalled = false;
  w.fetch = async () => ({
    ok: true, status: 200,
    text: async () => `
      <div class="tgme_widget_message js-widget_message" data-post="tasmee315/9">
        <div class="tgme_widget_message_text">p15<br>p20 need to redo the whole thing</div>
        <div class="tgme_widget_message_footer"><span class="tgme_widget_message_date"><time datetime="2026-08-14T19:24:28+00:00">19:24</time></span></div>
      </div>
    `,
  });
  w.prompt = () => { promptCalled = true; return null; };
  w.confirm = (msg) => { confirmMessage = msg; return true; };
  w.alert = () => {};

  await w.importMistakesFromTelegram();

  assert.equal(promptCalled, false, 'a page-flags-only message never needs a surah, so it never triggers the surah prompt');
  assert.match(confirmMessage, /flag pages 15, 20 for review/);

  const pages = w.loadPracticeRanges().filter(r => r.kind === 'page');
  assert.equal(pages.length, 2);
  assert.deepEqual(toPlain(pages.map(p => p.page).sort((a, b) => a - b)), [15, 20]);
  assert.ok(pages.every(p => p.source === 'telegram' && p.telegramMessageId === 'tasmee315/9'));
  assert.equal(pages.find(p => p.page === 20).note, 'need to redo the whole thing');

  w.fetch = realFetch;
  w.prompt = realPrompt;
  w.confirm = realConfirm;
  w.alert = realAlert;
  w.localStorage.clear();
});

test('importMistakesFromTelegram: re-running after deleting a Telegram page flag brings it back (existence-based, same as ayah mistakes)', async () => {
  w.localStorage.clear();
  const realFetch = w.fetch, realConfirm = w.confirm, realAlert = w.alert, realPrompt = w.prompt;
  w.fetch = async () => ({
    ok: true, status: 200,
    text: async () => `
      <div class="tgme_widget_message js-widget_message" data-post="tasmee315/9">
        <div class="tgme_widget_message_text">p15</div>
        <div class="tgme_widget_message_footer"><span class="tgme_widget_message_date"><time datetime="2026-08-14T19:24:28+00:00">19:24</time></span></div>
      </div>
    `,
  });
  w.prompt = () => null;
  w.confirm = () => true;
  w.alert = () => {};

  await w.importMistakesFromTelegram();
  assert.equal(w.loadPracticeRanges().filter(r => r.kind === 'page').length, 1);

  w.deletePracticeRange(w.loadPracticeRanges().find(r => r.kind === 'page').id);
  assert.equal(w.loadPracticeRanges().filter(r => r.kind === 'page').length, 0);

  await w.importMistakesFromTelegram(); // re-run — should bring it back
  assert.equal(w.loadPracticeRanges().filter(r => r.kind === 'page').length, 1, 'existence-based dedup — the deleted flag is reconsidered, not permanently skipped');

  w.fetch = realFetch;
  w.prompt = realPrompt;
  w.confirm = realConfirm;
  w.alert = realAlert;
  w.localStorage.clear();
});

test('importMistakesFromTelegram imports a "rM-Kx T" practice range from a message, tagged source "telegram" with the message id — no surah prompt needed when the message declares its own "N:" line', async () => {
  w.localStorage.clear();
  const realFetch = w.fetch, realConfirm = w.confirm, realAlert = w.alert, realPrompt = w.prompt;
  let confirmMessage = null, promptCalled = false;
  w.fetch = async () => ({
    ok: true, status: 200,
    text: async () => `
      <div class="tgme_widget_message js-widget_message" data-post="tasmee315/10">
        <div class="tgme_widget_message_text">2:<br>r15-23x20 tricky transition</div>
        <div class="tgme_widget_message_footer"><span class="tgme_widget_message_date"><time datetime="2026-08-14T19:24:28+00:00">19:24</time></span></div>
      </div>
    `,
  });
  w.prompt = () => { promptCalled = true; return null; };
  w.confirm = (msg) => { confirmMessage = msg; return true; };
  w.alert = () => {};

  await w.importMistakesFromTelegram();

  assert.equal(promptCalled, false, 'the message\'s own "2:" line already resolves the surah, same as it would for a bare ayah number');
  assert.match(confirmMessage, /add 1 practice range \(2:15-23\)/);

  const ranges = w.loadPracticeRanges();
  assert.equal(ranges.length, 1);
  assert.equal(ranges[0].surah, 2);
  assert.equal(ranges[0].ayahStart, 15);
  assert.equal(ranges[0].ayahEnd, 23);
  assert.equal(ranges[0].target, 20);
  assert.equal(ranges[0].note, 'tricky transition');
  assert.equal(ranges[0].source, 'telegram');
  assert.equal(ranges[0].telegramMessageId, 'tasmee315/10');

  w.fetch = realFetch;
  w.prompt = realPrompt;
  w.confirm = realConfirm;
  w.alert = realAlert;
  w.localStorage.clear();
});

test('importMistakesFromTelegram imports a "rM-Kx T done" practice range as already-completed (practiced === target), same completion-marker support as the paste-import box', async () => {
  w.localStorage.clear();
  const realFetch = w.fetch, realConfirm = w.confirm, realAlert = w.alert, realPrompt = w.prompt;
  w.fetch = async () => ({
    ok: true, status: 200,
    text: async () => `
      <div class="tgme_widget_message js-widget_message" data-post="tasmee315/11">
        <div class="tgme_widget_message_text">2:<br>r15-23x20 done</div>
        <div class="tgme_widget_message_footer"><span class="tgme_widget_message_date"><time datetime="2026-08-14T19:24:28+00:00">19:24</time></span></div>
      </div>
    `,
  });
  w.prompt = () => null;
  w.confirm = () => true;
  w.alert = () => {};

  await w.importMistakesFromTelegram();

  const ranges = w.loadPracticeRanges();
  assert.equal(ranges.length, 1);
  assert.equal(ranges[0].kind, 'range');
  assert.equal(ranges[0].target, 20);
  assert.equal(ranges[0].practiced, 20, 'imported as already-completed, not a fresh 0/20 goal');
  assert.equal(ranges[0].note, '');

  w.fetch = realFetch;
  w.prompt = realPrompt;
  w.confirm = realConfirm;
  w.alert = realAlert;
  w.localStorage.clear();
});

test('importMistakesFromTelegram: a practice-range-only message with no surah anywhere yet prompts, same as a bare ayah number would', async () => {
  w.localStorage.clear();
  const realFetch = w.fetch, realConfirm = w.confirm, realAlert = w.alert, realPrompt = w.prompt;
  let promptedMsg = null;
  w.fetch = async () => ({
    ok: true, status: 200,
    text: async () => `
      <div class="tgme_widget_message js-widget_message" data-post="tasmee315/11">
        <div class="tgme_widget_message_text">r15-23x20</div>
        <div class="tgme_widget_message_footer"><span class="tgme_widget_message_date"><time datetime="2026-08-14T19:24:28+00:00">19:24</time></span></div>
      </div>
    `,
  });
  w.prompt = (msg) => { promptedMsg = msg; return '2'; };
  w.confirm = () => true;
  w.alert = () => {};

  await w.importMistakesFromTelegram();

  assert.ok(promptedMsg, 'no surah known anywhere — prompted, never guessed');
  assert.equal(w.loadPracticeRanges()[0].surah, 2, 'the prompt answer is used');

  w.fetch = realFetch;
  w.prompt = realPrompt;
  w.confirm = realConfirm;
  w.alert = realAlert;
  w.localStorage.clear();
});

test('importMistakesFromTelegram: re-running after deleting a Telegram practice range brings it back (existence-based, same as page flags)', async () => {
  w.localStorage.clear();
  const realFetch = w.fetch, realConfirm = w.confirm, realAlert = w.alert, realPrompt = w.prompt;
  w.fetch = async () => ({
    ok: true, status: 200,
    text: async () => `
      <div class="tgme_widget_message js-widget_message" data-post="tasmee315/10">
        <div class="tgme_widget_message_text">2:<br>r15-23x20</div>
        <div class="tgme_widget_message_footer"><span class="tgme_widget_message_date"><time datetime="2026-08-14T19:24:28+00:00">19:24</time></span></div>
      </div>
    `,
  });
  w.prompt = () => null;
  w.confirm = () => true;
  w.alert = () => {};

  await w.importMistakesFromTelegram();
  assert.equal(w.loadPracticeRanges().length, 1);

  w.deletePracticeRange(w.loadPracticeRanges()[0].id);
  assert.equal(w.loadPracticeRanges().length, 0);

  await w.importMistakesFromTelegram(); // re-run — should bring it back
  assert.equal(w.loadPracticeRanges().length, 1, 'existence-based dedup — the deleted range is reconsidered, not permanently skipped');

  w.fetch = realFetch;
  w.prompt = realPrompt;
  w.confirm = realConfirm;
  w.alert = realAlert;
  w.localStorage.clear();
});

test('importMistakesFromTelegram imports an "hN" zero-mistake Hizb flag, tagged as a real session, no surah prompt needed', async () => {
  w.localStorage.clear();
  const realFetch = w.fetch, realConfirm = w.confirm, realAlert = w.alert, realPrompt = w.prompt;
  let confirmMessage = null, promptCalled = false;
  w.fetch = async () => ({
    ok: true, status: 200,
    text: async () => `
      <div class="tgme_widget_message js-widget_message" data-post="tasmee315/12">
        <div class="tgme_widget_message_text">h5</div>
        <div class="tgme_widget_message_footer"><span class="tgme_widget_message_date"><time datetime="2026-08-15T20:00:00+00:00">20:00</time></span></div>
      </div>
    `,
  });
  w.prompt = () => { promptCalled = true; return null; };
  w.confirm = (msg) => { confirmMessage = msg; return true; };
  w.alert = () => {};

  await w.importMistakesFromTelegram();

  assert.equal(promptCalled, false, 'an "hN"-only message never needs a surah, so it never triggers the surah prompt');
  assert.match(confirmMessage, /log Hizb 5 recited with zero mistakes/);

  const log = w.loadHizbLog();
  assert.equal(log.length, 1);
  assert.equal(log[0].hizb, 5);
  assert.equal(log[0].mistakes, 0);
  assert.equal(w.loadAyahMistakes().length, 0);

  w.fetch = realFetch;
  w.prompt = realPrompt;
  w.confirm = realConfirm;
  w.alert = realAlert;
  w.localStorage.clear();
});

test('importMistakesFromTelegram: re-running an "hN" import is a true no-op once the session already exists (naturally idempotent, no dedup tracking needed) — but re-appears if the session is deleted', async () => {
  w.localStorage.clear();
  const realFetch = w.fetch, realConfirm = w.confirm, realAlert = w.alert, realPrompt = w.prompt;
  let alertMessage = null;
  w.fetch = async () => ({
    ok: true, status: 200,
    text: async () => `
      <div class="tgme_widget_message js-widget_message" data-post="tasmee315/12">
        <div class="tgme_widget_message_text">h5</div>
        <div class="tgme_widget_message_footer"><span class="tgme_widget_message_date"><time datetime="2026-08-15T20:00:00+00:00">20:00</time></span></div>
      </div>
    `,
  });
  w.prompt = () => null;
  w.confirm = () => true;
  w.alert = (msg) => { alertMessage = msg; };

  await w.importMistakesFromTelegram();
  assert.equal(w.loadHizbLog().length, 1);

  await w.importMistakesFromTelegram(); // re-run — session already exists
  assert.match(alertMessage, /Nothing new to import/);
  assert.equal(w.loadHizbLog().length, 1, 'still exactly one — not duplicated');

  // Delete it, then re-run — should come back, same resilience as ayah
  // mistakes/page flags (no dedup tracking needed: the check is purely
  // "does a session exist", which is now false again).
  w.saveHizbLog([]);
  await w.importMistakesFromTelegram();
  assert.equal(w.loadHizbLog().length, 1, 'deleting the session and re-running brings it back');

  w.fetch = realFetch;
  w.prompt = realPrompt;
  w.confirm = realConfirm;
  w.alert = realAlert;
  w.localStorage.clear();
});

test('importMistakesFromTelegram: an out-of-range "hN" (not 1-60) from a Telegram message is confirmed and skipped', async () => {
  w.localStorage.clear();
  const realFetch = w.fetch, realConfirm = w.confirm, realAlert = w.alert, realPrompt = w.prompt;
  const confirms = [];
  w.fetch = async () => ({
    ok: true, status: 200,
    text: async () => `
      <div class="tgme_widget_message js-widget_message" data-post="tasmee315/12">
        <div class="tgme_widget_message_text">h99</div>
        <div class="tgme_widget_message_footer"><span class="tgme_widget_message_date"><time datetime="2026-08-15T20:00:00+00:00">20:00</time></span></div>
      </div>
    `,
  });
  w.prompt = () => null;
  w.confirm = (msg) => { confirms.push(msg); return true; };
  w.alert = () => {};

  await w.importMistakesFromTelegram();

  assert.ok(confirms.some(m => /isn't a real Hizb.*99/.test(m)));
  assert.equal(w.loadHizbLog().length, 0);

  w.fetch = realFetch;
  w.prompt = realPrompt;
  w.confirm = realConfirm;
  w.alert = realAlert;
  w.localStorage.clear();
});

test('importMistakesFromTelegram alerts when no messages on the channel page look like log data at all', async () => {
  const realFetch = w.fetch, realAlert = w.alert, realConfirm = w.confirm;
  let alertMessage = null, confirmCalled = false;
  w.fetch = async () => ({
    ok: true, status: 200,
    text: async () => `
      <div class="tgme_widget_message service_message" data-post="x/1">
        <div class="tgme_widget_message_text">Channel created</div>
        <div class="tgme_widget_message_footer"><span class="tgme_widget_message_date"><time datetime="2026-08-14T19:23:31+00:00">19:23</time></span></div>
      </div>
    `,
  });
  w.alert = (msg) => { alertMessage = msg; };
  w.confirm = () => { confirmCalled = true; return true; };

  await w.importMistakesFromTelegram();

  assert.match(alertMessage, /No messages on the channel page look like log data/);
  assert.equal(confirmCalled, false);

  w.fetch = realFetch;
  w.alert = realAlert;
  w.confirm = realConfirm;
});

test('importMistakesFromTelegram never prefills the surah prompt with anything — always exactly one "message text" argument, so a stale value can\'t be silently accepted', async () => {
  w.localStorage.clear();
  const realFetch = w.fetch, realPrompt = w.prompt, realConfirm = w.confirm, realAlert = w.alert;
  let fetchCalled = false, promptArgCount = -1;
  w.fetch = async () => { fetchCalled = true; return { ok: true, status: 200, text: async () => fakeTelegramHtml() }; };
  w.prompt = (...args) => { promptArgCount = args.length; return null; };
  w.confirm = () => true;
  w.alert = () => {};

  await w.importMistakesFromTelegram();

  assert.equal(fetchCalled, true);
  assert.equal(promptArgCount, 1, 'prompt() is called with only the message text — no default-value argument at all');

  w.fetch = realFetch;
  w.prompt = realPrompt;
  w.confirm = realConfirm;
  w.alert = realAlert;
  w.localStorage.clear();
});

test('importMistakesFromTelegram cache-busts the proxied fetch — a real incident had api.allorigins.win keep serving the same stale response for hours, which telegramFetchLooksStale can\'t catch on its own since a stuck (not regressing) cache looks identical to "nothing new posted"', async () => {
  w.localStorage.clear();
  const realFetch = w.fetch, realConfirm = w.confirm, realAlert = w.alert, realPrompt = w.prompt, realSleep = w.sleep;
  const fetchedUrls = [], fetchedOptions = [];
  w.fetch = async (url, options) => {
    fetchedUrls.push(url);
    fetchedOptions.push(options);
    return { ok: true, status: 200, text: async () => fakeTelegramHtml() };
  };
  w.prompt = () => '2';
  w.confirm = () => true;
  w.alert = () => {};
  w.sleep = async () => {};

  await w.importMistakesFromTelegram();

  // 2, not 1: fakeTelegramHtml()'s oldest log-like message ("78b/84a/86b")
  // has no "N:" of its own and nothing already logged, so
  // fetchOlderTelegramMessages makes one "?before=" attempt looking for
  // earlier context before falling through to the normal surah prompt —
  // the stub returns the identical fixture regardless of URL, so that
  // attempt's own "no progress" guard stops it right there.
  assert.equal(fetchedUrls.length, 2);
  assert.match(fetchedUrls[0], /[?&]_=\d+/, 'a cache-busting timestamp param is appended to the proxied URL');
  assert.equal(fetchedOptions[0].cache, 'no-store', 'also bypasses the browser\'s own HTTP cache');

  w.fetch = realFetch;
  w.prompt = realPrompt;
  w.confirm = realConfirm;
  w.alert = realAlert;
  w.sleep = realSleep;
  w.localStorage.clear();
});

test('importMistakesFromTelegram: a retry after a failed attempt uses a freshly regenerated cache-busting param, not the exact same URL', async () => {
  w.localStorage.clear();
  const realFetch = w.fetch, realConfirm = w.confirm, realAlert = w.alert, realPrompt = w.prompt, realSleep = w.sleep;
  const realDateNow = w.Date.now;
  let fakeNow = 1000;
  w.Date.now = () => fakeNow++; // guarantees two distinct values even if the retry happens within the same real millisecond
  const fetchedUrls = [];
  let callCount = 0;
  w.fetch = async (url) => {
    fetchedUrls.push(url);
    callCount++;
    if (callCount === 1) return { ok: false, status: 522, text: async () => '' };
    return { ok: true, status: 200, text: async () => fakeTelegramHtml() };
  };
  w.prompt = () => '2';
  w.confirm = () => true;
  w.alert = () => {};
  w.sleep = async () => {};

  await w.importMistakesFromTelegram();

  // 3, not 2: the first two are the failed attempt + its successful retry
  // for the main page; the third is fetchOlderTelegramMessages' own single
  // "?before=" attempt (see the cache-busting test above for why one
  // happens at all against this fixture).
  assert.equal(fetchedUrls.length, 3);
  assert.notEqual(fetchedUrls[0], fetchedUrls[1], 'the retry hits a different URL (fresh cache-buster), not a byte-identical repeat of the failed request');

  w.Date.now = realDateNow;
  w.fetch = realFetch;
  w.prompt = realPrompt;
  w.confirm = realConfirm;
  w.alert = realAlert;
  w.sleep = realSleep;
  w.localStorage.clear();
});

test('importMistakesFromTelegram skips ayah numbers that don\'t exist in their surah, after confirming, and imports the rest', async () => {
  w.localStorage.clear();
  const realFetch = w.fetch, realConfirm = w.confirm, realAlert = w.alert, realPrompt = w.prompt;
  const confirms = [];
  w.fetch = async () => ({
    ok: true, status: 200,
    text: async () => `
      <div class="tgme_widget_message js-widget_message" data-post="x/1">
        <div class="tgme_widget_message_text">3<br>999</div>
        <div class="tgme_widget_message_footer"><span class="tgme_widget_message_date"><time datetime="2026-08-14T19:24:28+00:00">19:24</time></span></div>
      </div>
    `,
  });
  w.prompt = () => '1';
  w.confirm = (msg) => { confirms.push(msg); return true; };
  w.alert = () => {};

  await w.importMistakesFromTelegram();

  assert.equal(confirms.length, 2, 'one about the invalid ayah, one to actually import the rest (the surah review is a prompt, not a confirm)');
  assert.match(confirms[0], /don't exist.*1:999/);
  const mistakes = w.loadAyahMistakes();
  assert.equal(mistakes.length, 1);
  assert.equal(mistakes[0].ayah, 3);

  w.fetch = realFetch;
  w.prompt = realPrompt;
  w.confirm = realConfirm;
  w.alert = realAlert;
  w.localStorage.clear();
});

// reviewTelegramSurahAssignments() — every NEW candidate ayah mistake is
// grouped by its resolved surah and shown to the user (real name + every
// ayah) before saving, so a stale carried-forward surah (see
// endingSurahAfterParsing) is never silently trusted.

test('reviewTelegramSurahAssignments shows one editable prompt per surah group, pre-filled with the guessed number, and keeps the guess when left unchanged', () => {
  const realPrompt = w.prompt;
  const promptCalls = [];
  w.prompt = (msg, defaultValue) => { promptCalls.push({ msg, defaultValue }); return defaultValue; }; // OK pressed with no edit

  const candidates = [
    { surah: 2, ayah: 78, type: 'B', note: '' },
    { surah: 2, ayah: 84, type: null, note: '' },
    { surah: 3, ayah: 15, type: null, note: '' },
  ];
  const { candidates: result, dropped } = w.reviewTelegramSurahAssignments(candidates);

  assert.equal(promptCalls.length, 2, 'one prompt per distinct surah group, not per ayah');
  assert.equal(promptCalls[0].defaultValue, '2', 'pre-filled with the guessed surah number itself');
  assert.match(promptCalls[0].msg, /2 ayah mistakes from Telegram will be logged under this surah/);
  assert.match(promptCalls[0].msg, /78 \(B\)/);
  assert.match(promptCalls[0].msg, /Currently guessed: Surah 2 — Al-Baqara/);
  assert.equal(promptCalls[1].defaultValue, '3');
  assert.match(promptCalls[1].msg, /Surah 3 — Aal-i-Imran/);
  assert.equal(dropped, 0);
  assert.equal(result.length, 3);
  assert.deepEqual(toPlain(result.map(c => c.surah)), [2, 2, 3], 'nothing re-tagged since every group was left as its pre-filled guess');

  w.prompt = realPrompt;
});

test('reviewTelegramSurahAssignments re-tags a whole group when the pre-filled surah number is edited', () => {
  const realPrompt = w.prompt;
  w.prompt = () => '2:'; // edited the pre-filled "3" to "2:" — trailing colon should parse fine, same as everywhere else

  const candidates = [
    { surah: 3, ayah: 207, type: null, note: '' },
    { surah: 3, ayah: 209, type: null, note: '' },
  ];
  const { candidates: result, dropped } = w.reviewTelegramSurahAssignments(candidates);

  assert.equal(dropped, 0);
  assert.equal(result.length, 2);
  assert.ok(result.every(c => c.surah === 2), 'both re-tagged to the corrected surah, not just the first');

  w.prompt = realPrompt;
});

test('reviewTelegramSurahAssignments drops a group entirely (not falling back to the original guess) if cancelled or cleared with no valid surah left', () => {
  const realPrompt = w.prompt;
  w.prompt = () => null; // cancelled

  const candidates = [{ surah: 3, ayah: 207, type: null, note: '' }];
  const { candidates: result, dropped } = w.reviewTelegramSurahAssignments(candidates);

  assert.equal(dropped, 1);
  assert.equal(result.length, 0);

  w.prompt = realPrompt;
});

test('importMistakesFromTelegram: a stale carried-forward surah (an earlier message\'s own "3:" override, never switched back) is caught by the review step and correctable, instead of silently misattributing a later unrelated message', async () => {
  w.localStorage.clear();
  const realFetch = w.fetch, realConfirm = w.confirm, realAlert = w.alert, realPrompt = w.prompt;
  w.fetch = async () => ({
    ok: true, status: 200,
    text: async () => `
      <div class="tgme_widget_message js-widget_message" data-post="x/1">
        <div class="tgme_widget_message_text">3:<br>15</div>
        <div class="tgme_widget_message_footer"><span class="tgme_widget_message_date"><time datetime="2026-08-14T19:24:28+00:00">19:24</time></span></div>
      </div>
      <div class="tgme_widget_message js-widget_message" data-post="x/2">
        <div class="tgme_widget_message_text">207</div>
        <div class="tgme_widget_message_footer"><span class="tgme_widget_message_date"><time datetime="2026-08-15T19:24:28+00:00">19:24</time></span></div>
      </div>
    `,
  });
  w.prompt = () => '2'; // corrects the pre-filled "3" for message 2's stale carried-forward group (message 1's own "3:" override is trusted as-is and never prompts)
  w.confirm = () => true; // the final import confirm
  w.alert = () => {};

  await w.importMistakesFromTelegram();

  const mistakes = w.loadAyahMistakes();
  assert.equal(mistakes.length, 2);
  const m15 = mistakes.find(m => m.ayah === 15);
  assert.equal(m15.surah, 3, 'message 1\'s own explicit "3:" override is trusted as-is once confirmed');
  const m207 = mistakes.find(m => m.ayah === 207);
  assert.equal(m207.surah, 2, 'message 2 had no override of its own — carried forward to surah 3, caught by the review, and corrected to 2');
  assert.equal(m207.hizb, w.hizbOfGlobalAyah(7 + 207 - 1), 'hizb recomputed from the corrected surah (Al-Fatiha\'s 7 ayat offset), not the original stale guess');

  w.fetch = realFetch;
  w.prompt = realPrompt;
  w.confirm = realConfirm;
  w.alert = realAlert;
  w.localStorage.clear();
});

test('importMistakesFromTelegram: re-running the import doesn\'t duplicate an entry whose corrected surah already matches an earlier run\'s correction (a stale carried-forward surah re-guesses the SAME wrong surah every run, since nothing on the channel itself ever resets it)', async () => {
  w.localStorage.clear();
  // Simulates an earlier run: the user already corrected "207"'s
  // stale-carried-forward guess (surah 3) to surah 2, and it was saved.
  w.saveAyahMistakes([{
    id: 'existing', surah: 2, ayah: 207, type: null, note: '',
    date: '2026-08-15T19:24:28.000Z', source: 'telegram', telegramMessageId: 'x/2',
  }]);
  const realFetch = w.fetch, realConfirm = w.confirm, realAlert = w.alert, realPrompt = w.prompt;
  let alertMessage = null;
  w.fetch = async () => ({
    ok: true, status: 200,
    text: async () => `
      <div class="tgme_widget_message js-widget_message" data-post="x/1">
        <div class="tgme_widget_message_text">3:<br>15</div>
        <div class="tgme_widget_message_footer"><span class="tgme_widget_message_date"><time datetime="2026-08-14T19:24:28+00:00">19:24</time></span></div>
      </div>
      <div class="tgme_widget_message js-widget_message" data-post="x/2">
        <div class="tgme_widget_message_text">207</div>
        <div class="tgme_widget_message_footer"><span class="tgme_widget_message_date"><time datetime="2026-08-15T19:24:28+00:00">19:24</time></span></div>
      </div>
    `,
  });
  w.prompt = () => '2'; // corrects the SAME stale guess (surah 3) the SAME way as last time — every run re-derives it fresh from the channel's own still-unfixed "3:" message
  w.confirm = () => true;
  w.alert = (msg) => { alertMessage = msg; };

  await w.importMistakesFromTelegram();

  const mistakes = w.loadAyahMistakes();
  assert.equal(mistakes.filter(m => m.ayah === 207).length, 1, '207 is NOT duplicated — the pre-existing entry (surah 2) matches the corrected candidate, so it\'s recognized as already logged');
  assert.ok(mistakes.some(m => m.ayah === 15 && m.surah === 3), 'message 1\'s own genuinely-new "3:15" is still imported normally');
  assert.match(alertMessage, /skipping 1 ayah mistake already logged under the corrected surah/);

  w.fetch = realFetch;
  w.prompt = realPrompt;
  w.confirm = realConfirm;
  w.alert = realAlert;
  w.localStorage.clear();
});

test('importMistakesFromTelegram retries the proxy fetch on failure, and alerts (not throws) + re-enables the button once every attempt is exhausted', async () => {
  const realFetch = w.fetch, realAlert = w.alert, realSleep = w.sleep;
  let alertMessage = null, fetchCallCount = 0;
  w.fetch = async () => { fetchCallCount++; return { ok: false, status: 522, text: async () => '' }; };
  w.alert = (msg) => { alertMessage = msg; };
  w.sleep = async () => {}; // don't actually wait between retries in the test

  await w.importMistakesFromTelegram();

  assert.equal(fetchCallCount, 4, 'tries 4 times total (1 initial + 3 retries) before giving up');
  assert.match(alertMessage, /Import from Telegram failed/);
  assert.match(alertMessage, /522/);
  assert.match(alertMessage, /after 4 attempts/);
  const btn = w.document.getElementById('telegram-import-btn');
  assert.equal(btn.disabled, false, 'the button is re-enabled after failing, not left stuck');
  assert.match(btn.textContent, /Import from Telegram/, 'label restored, not left showing "Fetching…"');

  w.fetch = realFetch;
  w.alert = realAlert;
  w.sleep = realSleep;
});

test('importMistakesFromTelegram recovers from a transient proxy failure — succeeds once a later retry gets a good response', async () => {
  w.localStorage.clear();
  const realFetch = w.fetch, realConfirm = w.confirm, realAlert = w.alert, realPrompt = w.prompt, realSleep = w.sleep;
  let fetchCallCount = 0, alertMessage = null;
  w.fetch = async () => {
    fetchCallCount++;
    if (fetchCallCount < 3) return { ok: false, status: 522, text: async () => '' }; // fails twice, then succeeds
    return { ok: true, status: 200, text: async () => fakeTelegramHtml() };
  };
  w.prompt = () => '2';
  w.confirm = () => true;
  w.alert = (msg) => { alertMessage = msg; };
  w.sleep = async () => {};

  await w.importMistakesFromTelegram();

  // 4, not 3: the main page fails twice then succeeds on its 3rd attempt
  // (stops retrying as soon as it does); the 4th is fetchOlderTelegramMessages'
  // own single "?before=" attempt (see the cache-busting test above for why
  // one happens at all against this fixture).
  assert.equal(fetchCallCount, 4, 'stops retrying the main page as soon as it succeeds');
  assert.match(alertMessage, /Imported/, 'the import completes normally once the retry succeeds — no failure alert');
  assert.equal(w.loadAyahMistakes().length, 7);

  w.fetch = realFetch;
  w.prompt = realPrompt;
  w.confirm = realConfirm;
  w.alert = realAlert;
  w.sleep = realSleep;
  w.localStorage.clear();
});

// fetchOlderTelegramMessages()/telegramMessageNeedsOlderContext() — t.me/s/
// <channel> only ever returns the ~20 most recent messages, so once a
// channel grows past that, the oldest message in a given fetch can lack
// any surah context of its own even though real context exists further
// back (visible scrolling the real Telegram app, invisible to a single
// fetch) — a real incident: message "63m" needed a surah prompt even
// though an earlier "2:" line existed just a few messages before it, one
// page further back than the default fetch reaches.
function fakeTelegramPageHtml(messages) {
  return messages.map(m => `
    <div class="tgme_widget_message js-widget_message" data-post="${m.id}">
      <div class="tgme_widget_message_text">${m.text}</div>
      <div class="tgme_widget_message_footer"><span class="tgme_widget_message_date"><time datetime="${m.date}">t</time></span></div>
    </div>
  `).join('');
}

test('importMistakesFromTelegram fetches an earlier page when the oldest message has no surah context, finds an "N:" line there, and never asks the BLANK "which surah?" prompt — the real "63m" incident', async () => {
  w.localStorage.clear();
  const realFetch = w.fetch, realConfirm = w.confirm, realAlert = w.alert, realPrompt = w.prompt, realSleep = w.sleep;
  const fetchedUrls = [];
  const promptMessages = [];
  const recentPage = fakeTelegramPageHtml([
    { id: 'tasmee315/144', date: '2026-08-28T15:32:44+00:00', text: '63m' },
    { id: 'tasmee315/145', date: '2026-08-28T15:34:04+00:00', text: '67b' },
  ]);
  const olderPage = fakeTelegramPageHtml([
    { id: 'tasmee315/140', date: '2026-08-27T18:33:05+00:00', text: '2:11' },
    { id: 'tasmee315/141', date: '2026-08-28T15:26:59+00:00', text: '36' },
    { id: 'tasmee315/142', date: '2026-08-28T15:27:56+00:00', text: '43' },
    { id: 'tasmee315/143', date: '2026-08-28T15:29:31+00:00', text: '53b' },
  ]);
  w.fetch = async (url) => {
    fetchedUrls.push(url);
    const html = url.includes('before%3D144') ? olderPage : recentPage;
    return { ok: true, status: 200, text: async () => html };
  };
  w.prompt = (msg) => { promptMessages.push(msg); return '2'; };
  w.confirm = () => true;
  w.alert = () => {};
  w.sleep = async () => {};

  await w.importMistakesFromTelegram();

  assert.equal(fetchedUrls.length, 2, 'the main page, then one "?before=144" page for context');
  assert.match(fetchedUrls[1], /before%3D144/);
  assert.ok(
    promptMessages.every(m => !m.includes('Which surah is this Telegram message for')),
    'the "2:" line found one page back resolves it — the BLANK ambiguous-surah prompt never fires'
  );
  // The normal carry-forward REVIEW prompt still fires (as it always does
  // for candidates that relied on carry-forward, per reviewTelegramSurahAssignments)
  // — that's a separate, deliberate confirmation step, not the bug being fixed here.
  assert.equal(promptMessages.length, 1);
  assert.match(promptMessages[0], /from "63m"/);
  assert.match(promptMessages[0], /from "36"/);

  const mistakes = toPlain(w.loadAyahMistakes());
  const byId = Object.fromEntries(mistakes.map(m => [m.telegramMessageId, m]));
  assert.equal(byId['tasmee315/144'].surah, 2, '63m correctly resolves to surah 2 via the older page\'s "2:11" line');
  assert.equal(byId['tasmee315/144'].ayah, 63);
  assert.equal(byId['tasmee315/145'].surah, 2);
  assert.equal(byId['tasmee315/140'].surah, 2, 'the context-providing older message itself is also imported (self-healing)');
  assert.equal(byId['tasmee315/141'].surah, 2);

  w.fetch = realFetch;
  w.prompt = realPrompt;
  w.confirm = realConfirm;
  w.alert = realAlert;
  w.sleep = realSleep;
  w.localStorage.clear();
});

test('importMistakesFromTelegram does not fetch an older page when the oldest message already resolves on its own (its own "N:" line)', async () => {
  w.localStorage.clear();
  const realFetch = w.fetch, realConfirm = w.confirm, realAlert = w.alert, realPrompt = w.prompt, realSleep = w.sleep;
  const fetchedUrls = [];
  const recentPage = fakeTelegramPageHtml([
    { id: 'tasmee315/144', date: '2026-08-28T15:32:44+00:00', text: '2:63m' },
  ]);
  w.fetch = async (url) => { fetchedUrls.push(url); return { ok: true, status: 200, text: async () => recentPage }; };
  w.confirm = () => true;
  w.alert = () => {};
  w.sleep = async () => {};

  await w.importMistakesFromTelegram();

  assert.equal(fetchedUrls.length, 1, 'the oldest message declares its own surah — no need to look further back');

  w.fetch = realFetch;
  w.prompt = realPrompt;
  w.confirm = realConfirm;
  w.alert = realAlert;
  w.sleep = realSleep;
  w.localStorage.clear();
});

test('importMistakesFromTelegram does not fetch an older page when the oldest message is already known locally from an earlier run', async () => {
  w.localStorage.clear();
  w.localStorage.setItem('quranReviewAyahMistakes', JSON.stringify([
    { id: 'm1', surah: 2, ayah: 63, hizb: 3, type: 'M', note: '', date: '2026-08-28T15:32:44+00:00', source: 'telegram', telegramMessageId: 'tasmee315/144' },
  ]));
  const realFetch = w.fetch, realConfirm = w.confirm, realAlert = w.alert, realPrompt = w.prompt, realSleep = w.sleep;
  const fetchedUrls = [];
  const recentPage = fakeTelegramPageHtml([
    { id: 'tasmee315/144', date: '2026-08-28T15:32:44+00:00', text: '63m' },
    { id: 'tasmee315/145', date: '2026-08-28T15:34:04+00:00', text: '67b' },
  ]);
  w.fetch = async (url) => { fetchedUrls.push(url); return { ok: true, status: 200, text: async () => recentPage }; };
  w.prompt = () => '2'; // the review-and-confirm step still asks about "67b" (a genuinely new candidate) — accept the guess
  w.confirm = () => true;
  w.alert = () => {};
  w.sleep = async () => {};

  await w.importMistakesFromTelegram();

  assert.equal(fetchedUrls.length, 1, 'already known locally from an earlier run — no need to look further back');
  assert.equal(toPlain(w.loadAyahMistakes()).find(m => m.telegramMessageId === 'tasmee315/145').surah, 2, 'carries forward from the reused known surah');

  w.fetch = realFetch;
  w.prompt = realPrompt;
  w.confirm = realConfirm;
  w.alert = realAlert;
  w.sleep = realSleep;
  w.localStorage.clear();
});

test('importMistakesFromTelegram gives up on backward pagination once it reaches the beginning of the channel (an older page with no log-like messages), falling back to the normal prompt', async () => {
  w.localStorage.clear();
  const realFetch = w.fetch, realConfirm = w.confirm, realAlert = w.alert, realPrompt = w.prompt, realSleep = w.sleep;
  const fetchedUrls = [];
  let promptCalled = false;
  const recentPage = fakeTelegramPageHtml([
    { id: 'tasmee315/144', date: '2026-08-28T15:32:44+00:00', text: '63m' },
  ]);
  w.fetch = async (url) => {
    fetchedUrls.push(url);
    // The "older" page has nothing log-like at all — e.g. the channel's
    // very first messages were just chit-chat, or this is genuinely the
    // beginning of the channel.
    const html = url.includes('before%3D144') ? '<div class="tgme_widget_message" data-post="tasmee315/1">Channel created</div>' : recentPage;
    return { ok: true, status: 200, text: async () => html };
  };
  w.prompt = () => { promptCalled = true; return '2'; };
  w.confirm = () => true;
  w.alert = () => {};
  w.sleep = async () => {};

  await w.importMistakesFromTelegram();

  assert.equal(fetchedUrls.length, 2);
  assert.equal(promptCalled, true, 'no context found backward — falls back to the normal prompt, same as before this feature existed');

  w.fetch = realFetch;
  w.prompt = realPrompt;
  w.confirm = realConfirm;
  w.alert = realAlert;
  w.sleep = realSleep;
  w.localStorage.clear();
});

test('importMistakesFromTelegram stops backward pagination immediately if a fetched older page fails outright, falling back to the normal prompt instead of failing the whole import', async () => {
  w.localStorage.clear();
  const realFetch = w.fetch, realConfirm = w.confirm, realAlert = w.alert, realPrompt = w.prompt, realSleep = w.sleep;
  let promptCalled = false;
  const recentPage = fakeTelegramPageHtml([
    { id: 'tasmee315/144', date: '2026-08-28T15:32:44+00:00', text: '63m' },
  ]);
  w.fetch = async (url) => {
    if (url.includes('before%3D144')) return { ok: false, status: 522, text: async () => '' };
    return { ok: true, status: 200, text: async () => recentPage };
  };
  w.prompt = () => { promptCalled = true; return '2'; };
  w.confirm = () => true;
  w.alert = (msg) => { assert.match(msg, /Imported/, 'the import itself still succeeds — backward context is a nice-to-have, not required'); };
  w.sleep = async () => {};

  await w.importMistakesFromTelegram();

  assert.equal(promptCalled, true);

  w.fetch = realFetch;
  w.prompt = realPrompt;
  w.confirm = realConfirm;
  w.alert = realAlert;
  w.sleep = realSleep;
  w.localStorage.clear();
});

// ─── Telegram Desktop "Export chat history" JSON import ────────────────────

test('telegramExportMessageText flattens both shapes of Telegram\'s export "text" field — a plain string, or an array mixing plain strings and {type, text} formatting entities', () => {
  assert.equal(w.telegramExportMessageText('218S'), '218S');
  assert.equal(w.telegramExportMessageText([{ type: 'bold', text: '3:' }, '\n15']), '3:\n15');
  assert.equal(w.telegramExportMessageText(['plain ', { type: 'code', text: '218' }, ' more']), 'plain 218 more');
  assert.equal(w.telegramExportMessageText(null), '');
  assert.equal(w.telegramExportMessageText(undefined), '');
});

test('telegramExportMessageDate prefers date_unixtime (unambiguous UTC) over the plain "date" string, which Telegram exports with no timezone marker', () => {
  const viaUnixtime = w.telegramExportMessageDate({ date_unixtime: '1755199468', date: '2026-08-14T19:24:28' });
  assert.equal(viaUnixtime, new Date(1755199468 * 1000).toISOString());

  const viaDateOnly = w.telegramExportMessageDate({ date: '2026-08-14T19:24:28' });
  assert.equal(viaDateOnly, new Date('2026-08-14T19:24:28').toISOString());
});

test('parseTelegramExportMessages rejects a file with no top-level "messages" array', () => {
  assert.throws(() => w.parseTelegramExportMessages({ notMessages: [] }), /doesn't look like a Telegram export/);
  assert.throws(() => w.parseTelegramExportMessages({}), /doesn't look like a Telegram export/);
});

test('parseTelegramExportMessages builds telegramMessageId as "<channel>/<numericId>" — EXACTLY the same format the live HTML scrape\'s own data-post attribute produces, so dedup recognizes the same message either way', () => {
  const parsed = w.parseTelegramExportMessages({
    messages: [
      { id: 144, type: 'message', date: '2026-08-14T19:24:28', date_unixtime: '1755199468', text: '63m' },
    ],
  });
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].id, 'tasmee315/144');
});

test('parseTelegramExportMessages excludes Telegram\'s own service messages (channel created, pinned, etc.)', () => {
  const parsed = w.parseTelegramExportMessages({
    messages: [
      { id: 1, type: 'service', action: 'create_channel', date_unixtime: '1754038800' },
      { id: 2, type: 'message', date_unixtime: '1755199468', text: '218S' },
    ],
  });
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].id, 'tasmee315/2');
});

test('importMistakesFromTelegramExport imports ayah mistakes from a parsed export file, tagged source "telegram" — same as a live import', async () => {
  w.localStorage.clear();
  const realReadJsonFile = w.readJsonFile, realConfirm = w.confirm, realAlert = w.alert, realPrompt = w.prompt;
  // The message declares its own "2:" override in the same message (rather
  // than relying on carry-forward from an earlier one), so — same as the
  // live-fetch path — it skips reviewTelegramSurahAssignments' own
  // confirm-review prompt entirely (see "viaOwnOverride" in CLAUDE.md).
  w.readJsonFile = async () => ({
    messages: [
      { id: 141, type: 'message', date_unixtime: '1755000100', text: '2:\n218S forgot ending' },
    ],
  });
  w.prompt = () => { throw new Error('should not need to prompt — the message\'s own "2:" line resolves the surah'); };
  w.confirm = () => true;
  w.alert = () => {};

  await w.importMistakesFromTelegramExport({});

  const mistakes = w.loadAyahMistakes();
  assert.equal(mistakes.length, 1);
  assert.equal(mistakes[0].surah, 2);
  assert.equal(mistakes[0].ayah, 218);
  assert.equal(mistakes[0].type, 'S');
  assert.equal(mistakes[0].source, 'telegram');
  assert.equal(mistakes[0].telegramMessageId, 'tasmee315/141');

  w.readJsonFile = realReadJsonFile;
  w.confirm = realConfirm;
  w.alert = realAlert;
  w.prompt = realPrompt;
  w.localStorage.clear();
});

test('importMistakesFromTelegramExport dedups against a mistake already imported LIVE (and vice versa) — both paths build the identical telegramMessageId, so re-processing the same message via the other path never duplicates it', async () => {
  w.localStorage.clear();
  // Simulate a mistake already imported via the LIVE fetch path.
  w.localStorage.setItem('quranReviewAyahMistakes', JSON.stringify([
    { id: 'm1', surah: 2, ayah: 218, hizb: 4, type: 'S', note: '', date: '2026-08-14T19:24:28.000Z', source: 'telegram', telegramMessageId: 'tasmee315/141' },
  ]));
  const realReadJsonFile = w.readJsonFile, realAlert = w.alert;
  let alertMessage = null;
  // The export contains that EXACT same message (id 141) plus nothing else.
  w.readJsonFile = async () => ({
    messages: [{ id: 141, type: 'message', date_unixtime: '1755199468', text: '2:218S' }],
  });
  w.alert = (msg) => { alertMessage = msg; };

  await w.importMistakesFromTelegramExport({});

  assert.equal(w.loadAyahMistakes().length, 1, 'no duplicate added — the export path recognized the message as already imported live');
  assert.match(alertMessage, /Nothing new to import/);

  w.readJsonFile = realReadJsonFile;
  w.alert = realAlert;
  w.localStorage.clear();
});

test('re-running importMistakesFromTelegramExport on the exact same export file is a true no-op (idempotent), same guarantee as re-running a live import', async () => {
  w.localStorage.clear();
  const realReadJsonFile = w.readJsonFile, realConfirm = w.confirm, realAlert = w.alert;
  const exportData = { messages: [{ id: 200, type: 'message', date_unixtime: '1755199468', text: '2:218S' }] };
  w.readJsonFile = async () => exportData;
  w.confirm = () => true;
  w.alert = () => {};

  await w.importMistakesFromTelegramExport({});
  assert.equal(w.loadAyahMistakes().length, 1);

  let secondRunAlert = null;
  w.alert = (msg) => { secondRunAlert = msg; };
  await w.importMistakesFromTelegramExport({});

  assert.equal(w.loadAyahMistakes().length, 1, 'still exactly one — re-running the same export never duplicates');
  assert.match(secondRunAlert, /Nothing new to import/);

  w.readJsonFile = realReadJsonFile;
  w.confirm = realConfirm;
  w.alert = realAlert;
  w.localStorage.clear();
});

test('importMistakesFromTelegramExport alerts a clear error (not a silent failure) when the file isn\'t a real Telegram export', async () => {
  w.localStorage.clear();
  const realReadJsonFile = w.readJsonFile, realAlert = w.alert;
  w.readJsonFile = async () => ({ some: 'other json' });
  let alertMessage = null;
  w.alert = (msg) => { alertMessage = msg; };

  await w.importMistakesFromTelegramExport({});

  assert.match(alertMessage, /Import from Telegram export failed.*doesn't look like a Telegram export/);

  w.readJsonFile = realReadJsonFile;
  w.alert = realAlert;
  w.localStorage.clear();
});

test('handleTelegramExportFileSelected reads the selected file and clears the input afterward (so the same file can be re-picked later)', async () => {
  const realImport = w.importMistakesFromTelegramExport;
  let capturedFile = null;
  w.importMistakesFromTelegramExport = (file) => { capturedFile = file; return Promise.resolve(); };
  const fakeFile = { name: 'result.json' };
  const event = { target: { files: [fakeFile], value: 'result.json' } };

  w.handleTelegramExportFileSelected(event);
  await Promise.resolve(); // let the .finally() microtask run

  assert.equal(capturedFile, fakeFile);
  assert.equal(event.target.value, '');

  w.importMistakesFromTelegramExport = realImport;
});

// ─── Telegram import checkpoint ("start"/"🚩") ──────────────────────────────

test('isTelegramImportCheckpointMessage recognizes a standalone "start" or "🚩" line, case-insensitively, with optional trailing text — but not as a substring of something else', () => {
  assert.equal(w.isTelegramImportCheckpointMessage({ text: 'start' }), true);
  assert.equal(w.isTelegramImportCheckpointMessage({ text: 'START' }), true);
  assert.equal(w.isTelegramImportCheckpointMessage({ text: '🚩' }), true);
  assert.equal(w.isTelegramImportCheckpointMessage({ text: 'start new teacher' }), true);
  assert.equal(w.isTelegramImportCheckpointMessage({ text: '2:\nstart' }), true, 'matches on any line, not just the first');

  assert.equal(w.isTelegramImportCheckpointMessage({ text: 'starting fresh today' }), false, 'not a standalone "start" word');
  assert.equal(w.isTelegramImportCheckpointMessage({ text: '218 started slow' }), false);
  assert.equal(w.isTelegramImportCheckpointMessage({ text: '' }), false);
});

test('updateTelegramImportCheckpointFromMessages persists the LATEST checkpoint message found, and never lets an older one downgrade an already-newer stored checkpoint', () => {
  w.localStorage.clear();

  const first = w.updateTelegramImportCheckpointFromMessages([
    { id: 'tasmee315/10', date: '2026-08-01T00:00:00.000Z', text: 'start' },
  ]);
  assert.equal(first.telegramMessageId, 'tasmee315/10');
  assert.deepEqual(toPlain(w.loadTelegramImportCheckpoint()), { telegramMessageId: 'tasmee315/10', date: '2026-08-01T00:00:00.000Z' });

  // A NEWER checkpoint replaces it.
  const second = w.updateTelegramImportCheckpointFromMessages([
    { id: 'tasmee315/20', date: '2026-08-15T00:00:00.000Z', text: 'start again' },
  ]);
  assert.equal(second.telegramMessageId, 'tasmee315/20');

  // An OLDER one (e.g. re-scanning old history) never downgrades it.
  const third = w.updateTelegramImportCheckpointFromMessages([
    { id: 'tasmee315/5', date: '2026-07-01T00:00:00.000Z', text: '🚩' },
  ]);
  assert.equal(third.telegramMessageId, 'tasmee315/20', 'still the newer one from before');

  // No checkpoint messages in this batch at all — returns whatever's
  // already stored, unchanged.
  const fourth = w.updateTelegramImportCheckpointFromMessages([
    { id: 'tasmee315/21', date: '2026-08-16T00:00:00.000Z', text: '218S' },
  ]);
  assert.equal(fourth.telegramMessageId, 'tasmee315/20');

  w.localStorage.clear();
});

test('applyTelegramImportCheckpoint filters out messages at or before the checkpoint, keeps only strictly-after ones, and returns the checkpoint for the caller to act on', () => {
  w.localStorage.clear();
  const allMessages = [
    { id: 'tasmee315/1', date: '2026-08-01T00:00:00.000Z', text: '218S' },
    { id: 'tasmee315/2', date: '2026-08-10T00:00:00.000Z', text: 'start' },
    { id: 'tasmee315/3', date: '2026-08-11T00:00:00.000Z', text: '2:15' },
  ];
  const logMessages = [allMessages[0], allMessages[2]]; // "start" itself never survives looksLikeAyahLogMessage

  const result = w.applyTelegramImportCheckpoint(allMessages, logMessages, false);

  assert.equal(result.checkpoint.telegramMessageId, 'tasmee315/2');
  assert.equal(result.logMessages.length, 1);
  assert.equal(result.logMessages[0].id, 'tasmee315/3');

  w.localStorage.clear();
});

test('applyTelegramImportCheckpoint with bypass:true still records a new checkpoint found in this batch, but returns everything unfiltered and checkpoint:null for this run', () => {
  w.localStorage.clear();
  const allMessages = [
    { id: 'tasmee315/1', date: '2026-08-01T00:00:00.000Z', text: '218S' },
    { id: 'tasmee315/2', date: '2026-08-10T00:00:00.000Z', text: 'start' },
  ];
  const logMessages = [allMessages[0]];

  const result = w.applyTelegramImportCheckpoint(allMessages, logMessages, true);

  assert.equal(result.checkpoint, null, 'not enforced this run');
  assert.deepEqual(toPlain(result.logMessages), toPlain(logMessages), 'nothing filtered out while bypassing');
  assert.equal(w.loadTelegramImportCheckpoint().telegramMessageId, 'tasmee315/2', 'but the checkpoint itself was still recorded for future runs');

  w.localStorage.clear();
});

test('applyTelegramImportCheckpoint returns checkpoint:null and the original list unchanged when none has ever been set', () => {
  w.localStorage.clear();
  const logMessages = [{ id: 'tasmee315/1', date: '2026-08-01T00:00:00.000Z', text: '218S' }];

  const result = w.applyTelegramImportCheckpoint([logMessages[0]], logMessages, false);

  assert.equal(result.checkpoint, null);
  assert.deepEqual(toPlain(result.logMessages), toPlain(logMessages));
});

test('importMistakesFromTelegram skips everything at/before a checkpoint by default, and the "Ignore checkpoint" box includes it again', async () => {
  w.localStorage.clear();
  const realFetch = w.fetch, realConfirm = w.confirm, realAlert = w.alert, realPrompt = w.prompt;
  const page = fakeTelegramPageHtml([
    { id: 'tasmee315/1', date: '2026-08-01T00:00:00+00:00', text: '2:218S' },
    { id: 'tasmee315/2', date: '2026-08-10T00:00:00+00:00', text: 'start' },
    { id: 'tasmee315/3', date: '2026-08-15T00:00:00+00:00', text: '2:15B' },
  ]);
  w.fetch = async () => ({ ok: true, status: 200, text: async () => page });
  w.prompt = () => { throw new Error('should not need to prompt — message 3 declares its own "2:" override'); };
  w.confirm = () => true;
  w.alert = () => {};

  await w.importMistakesFromTelegram();

  let mistakes = w.loadAyahMistakes();
  assert.equal(mistakes.length, 1, 'only the post-checkpoint message (id 3) was imported');
  assert.equal(mistakes[0].telegramMessageId, 'tasmee315/3');

  // Re-run with the checkpoint bypassed — the pre-checkpoint message is
  // now considered too (and correctly recognized as brand new, since
  // nothing skipped by a checkpoint is ever marked "already imported").
  w.document.getElementById('telegram-ignore-checkpoint').checked = true;
  await w.importMistakesFromTelegram();

  mistakes = w.loadAyahMistakes();
  assert.equal(mistakes.length, 2, 'the pre-checkpoint message got imported once bypassed');
  assert.ok(mistakes.some(m => m.telegramMessageId === 'tasmee315/1'));

  w.document.getElementById('telegram-ignore-checkpoint').checked = false;
  w.fetch = realFetch;
  w.prompt = realPrompt;
  w.confirm = realConfirm;
  w.alert = realAlert;
  w.localStorage.clear();
});

test('importMistakesFromTelegramExport respects a checkpoint set via a LIVE import — the checkpoint applies regardless of which import path set or enforces it', async () => {
  w.localStorage.clear();
  w.localStorage.setItem('quranReviewTelegramImportCheckpoint', JSON.stringify({ telegramMessageId: 'tasmee315/2', date: '2026-08-10T00:00:00.000Z' }));
  const realReadJsonFile = w.readJsonFile, realConfirm = w.confirm, realAlert = w.alert;
  w.readJsonFile = async () => ({
    messages: [
      { id: 1, type: 'message', date_unixtime: String(Math.floor(new Date('2026-08-01T00:00:00.000Z').getTime() / 1000)), text: '2:218S' },
      { id: 3, type: 'message', date_unixtime: String(Math.floor(new Date('2026-08-15T00:00:00.000Z').getTime() / 1000)), text: '2:15B' },
    ],
  });
  w.confirm = () => true;
  w.alert = () => {};

  await w.importMistakesFromTelegramExport({});

  const mistakes = w.loadAyahMistakes();
  assert.equal(mistakes.length, 1, 'the export path honors the checkpoint set earlier via a live import');
  assert.equal(mistakes[0].telegramMessageId, 'tasmee315/3');

  w.readJsonFile = realReadJsonFile;
  w.confirm = realConfirm;
  w.alert = realAlert;
  w.localStorage.clear();
});

test('clearTelegramImportCheckpoint clears the checkpoint after confirming, and does nothing if declined', () => {
  w.localStorage.clear();
  w.localStorage.setItem('quranReviewTelegramImportCheckpoint', JSON.stringify({ telegramMessageId: 'tasmee315/2', date: '2026-08-10T00:00:00.000Z' }));
  const realConfirm = w.confirm;

  w.confirm = () => false;
  w.clearTelegramImportCheckpoint();
  assert.notEqual(w.loadTelegramImportCheckpoint(), null, 'declined — checkpoint kept');

  w.confirm = () => true;
  w.clearTelegramImportCheckpoint();
  assert.equal(w.loadTelegramImportCheckpoint(), null, 'confirmed — checkpoint cleared');

  w.confirm = realConfirm;
  w.localStorage.clear();
});

test('renderTelegramImportCheckpointStatus shows the checkpoint\'s date + a Clear button when one is set, and a plain "no checkpoint" message otherwise', () => {
  w.localStorage.clear();
  w.renderTelegramImportCheckpointStatus();
  assert.match(w.document.getElementById('telegram-checkpoint-status').innerHTML, /No checkpoint set/);

  w.localStorage.setItem('quranReviewTelegramImportCheckpoint', JSON.stringify({ telegramMessageId: 'tasmee315/2', date: '2026-08-10T00:00:00.000Z' }));
  w.renderTelegramImportCheckpointStatus();
  const html = w.document.getElementById('telegram-checkpoint-status').innerHTML;
  assert.match(html, /Checkpoint set/);
  assert.match(html, /clearTelegramImportCheckpoint/);

  w.localStorage.clear();
});

test('buildSyncPayload/applySyncPayload carry telegramImportCheckpoint through, and applySyncPayload falls back to no-checkpoint (not the literal string "undefined") for a doc from before this field existed', () => {
  w.localStorage.clear();
  w.localStorage.setItem('quranReviewTelegramImportCheckpoint', JSON.stringify({ telegramMessageId: 'tasmee315/2', date: '2026-08-10T00:00:00.000Z' }));
  const synced = toPlain(w.buildSyncPayload());
  assert.deepEqual(synced.review.telegramImportCheckpoint, { telegramMessageId: 'tasmee315/2', date: '2026-08-10T00:00:00.000Z' });

  w.localStorage.clear();
  w.applySyncPayload({
    tracker: { memorized: [] },
    review: {
      memorizedHizbs: [], recitationLog: [], ayahMistakes: [], mutashabihatPairs: [], practiceRanges: [],
      telegramLastImportedAt: null, agentApiKey: null, agentModel: null,
      agentPromptPreset: null, agentPromptOverrides: {},
      // no telegramImportCheckpoint field at all — an older doc
    },
    habits: { activities: [], log: [] },
    updatedAt: Date.now(),
  });
  assert.equal(w.loadTelegramImportCheckpoint(), null);
  assert.equal(w.localStorage.getItem('quranReviewTelegramImportCheckpoint'), '', 'empty string, never the literal "undefined"');

  w.localStorage.clear();
  w.applySyncPayload({
    tracker: { memorized: [] },
    review: {
      memorizedHizbs: [], recitationLog: [], ayahMistakes: [], mutashabihatPairs: [], practiceRanges: [],
      telegramLastImportedAt: null, agentApiKey: null, agentModel: null,
      agentPromptPreset: null, agentPromptOverrides: {},
      telegramImportCheckpoint: { telegramMessageId: 'tasmee315/9', date: '2026-08-20T00:00:00.000Z' },
    },
    habits: { activities: [], log: [] },
    updatedAt: Date.now(),
  });
  assert.deepEqual(toPlain(w.loadTelegramImportCheckpoint()), { telegramMessageId: 'tasmee315/9', date: '2026-08-20T00:00:00.000Z' });

  w.localStorage.clear();
});

test('reviewTelegramSurahAssignments shows each candidate\'s original Telegram message text, not just its parsed ayah reference', () => {
  const candidates = [
    { surah: 2, ayah: 63, type: 'M', note: '', viaOwnOverride: false, telegramText: '63m' },
    { surah: 2, ayah: 67, type: 'B', note: '', viaOwnOverride: false, telegramText: '67b' },
  ];
  const realPrompt = w.prompt;
  let promptMessage = null;
  w.prompt = (msg) => { promptMessage = msg; return '2'; };

  w.reviewTelegramSurahAssignments(candidates);

  assert.match(promptMessage, /from "63m"/);
  assert.match(promptMessage, /from "67b"/);

  w.prompt = realPrompt;
});

// telegramFetchLooksStale()/recordTelegramLatestSeenMessageDate() — a
// "200 OK" from the CORS proxy isn't proof the page it returned is
// current; these track the latest message datetime ever seen so a later
// fetch whose own latest message is OLDER (impossible for a real, fresh
// fetch of a channel that never loses messages) can be caught as stale.

test('telegramFetchLooksStale is false with nothing recorded yet, then true once a fetch with an OLDER latest message is checked against a newer one already recorded', () => {
  w.localStorage.clear();
  const older = [{ date: '2026-08-14T10:00:00.000Z' }, { date: '2026-08-14T12:00:00.000Z' }];
  const newer = [{ date: '2026-08-15T09:00:00.000Z' }];

  assert.equal(w.telegramFetchLooksStale(newer), false, 'nothing recorded yet — no baseline to compare against');
  w.recordTelegramLatestSeenMessageDate(newer);

  assert.equal(w.telegramFetchLooksStale(older), true, 'this fetch\'s latest message (Aug 14) is older than one already seen (Aug 15) — a real channel never loses messages');
  assert.equal(w.telegramFetchLooksStale(newer), false, 'the same latest date as what\'s recorded is not stale');

  const evenNewer = [{ date: '2026-08-16T09:00:00.000Z' }];
  assert.equal(w.telegramFetchLooksStale(evenNewer), false);

  w.localStorage.clear();
});

test('recordTelegramLatestSeenMessageDate only ever moves the baseline forward, never backward', () => {
  w.localStorage.clear();
  w.recordTelegramLatestSeenMessageDate([{ date: '2026-08-15T09:00:00.000Z' }]);
  w.recordTelegramLatestSeenMessageDate([{ date: '2026-08-14T09:00:00.000Z' }]); // older — should not overwrite
  assert.equal(w.localStorage.getItem('quranReviewTelegramLatestSeenMessageDate'), '2026-08-15T09:00:00.000Z');

  w.localStorage.clear();
});

test('importMistakesFromTelegram refuses to trust a fetch whose latest message is older than one already seen — aborts with a clear error instead of claiming "nothing new" or silently missing something new', async () => {
  w.localStorage.clear();
  const realFetch = w.fetch, realAlert = w.alert;
  let alertMessage = null;

  // First run: establishes the baseline via a normal, fresh fetch.
  w.fetch = async () => ({ ok: true, status: 200, text: async () => fakeTelegramHtml() }); // latest message 2026-08-14T20:14:46
  w.prompt = () => '2';
  w.confirm = () => true;
  w.alert = () => {};
  await w.importMistakesFromTelegram();
  assert.equal(w.localStorage.getItem('quranReviewTelegramLatestSeenMessageDate'), '2026-08-14T20:14:46+00:00');

  // Second run: the proxy serves a page whose newest message is OLDER —
  // simulates a stale/truncated fetch that still returned HTTP 200.
  w.fetch = async () => ({
    ok: true, status: 200,
    text: async () => `
      <div class="tgme_widget_message js-widget_message" data-post="tasmee315/1">
        <div class="tgme_widget_message_text">78b</div>
        <div class="tgme_widget_message_footer"><span class="tgme_widget_message_date"><time datetime="2026-08-10T10:00:00+00:00">10:00</time></span></div>
      </div>
    `,
  });
  w.alert = (msg) => { alertMessage = msg; };
  const beforeMistakes = w.loadAyahMistakes().length;

  await w.importMistakesFromTelegram();

  assert.match(alertMessage, /stale or incomplete/);
  assert.equal(w.loadAyahMistakes().length, beforeMistakes, 'nothing added or changed — the run is aborted before touching any data');

  w.fetch = realFetch;
  w.alert = realAlert;
  w.localStorage.clear();
});

test('computeTelegramImportVerification groups Telegram-sourced mistakes by message, newest message first, and ignores non-Telegram sources', () => {
  w.localStorage.clear();
  w.localStorage.setItem('quranReviewAyahMistakes', JSON.stringify([
    { id: 'm1', surah: 2, ayah: 5, hizb: 1, type: null, note: '', date: '2026-08-10T10:00:00.000Z', source: 'telegram', telegramMessageId: 'ch/1' },
    { id: 'm2', surah: 2, ayah: 6, hizb: 1, type: 'S', note: '', date: '2026-08-10T10:00:00.000Z', source: 'telegram', telegramMessageId: 'ch/1' },
    { id: 'm3', surah: 3, ayah: 1, hizb: 5, type: null, note: '', date: '2026-08-15T09:00:00.000Z', source: 'telegram', telegramMessageId: 'ch/12' },
    { id: 'm4', surah: 1, ayah: 1, hizb: 1, type: null, note: '', date: '2026-08-16T09:00:00.000Z', source: 'live' },
    { id: 'm5', surah: 1, ayah: 2, hizb: 1, type: null, note: '', date: '2026-08-16T09:00:00.000Z', source: 'paste' },
  ]));

  const groups = toPlain(w.computeTelegramImportVerification());

  assert.equal(groups.length, 2, 'only the two distinct Telegram messages — live/paste entries excluded');
  assert.equal(groups[0].telegramMessageId, 'ch/12', 'the higher (more recent) message id comes first');
  assert.equal(groups[0].mistakes.length, 1);
  assert.equal(groups[1].telegramMessageId, 'ch/1');
  assert.equal(groups[1].mistakes.length, 2);
  assert.equal(groups[1].mistakes[0].ayah, 5, 'mistakes within a message keep their original (line) order, not re-sorted by ayah');
  assert.equal(groups[1].mistakes[1].ayah, 6);

  w.localStorage.clear();
});

test('renderTelegramImportVerification shows a status message when empty, and one group per Telegram message once there\'s data', () => {
  w.localStorage.clear();
  w.renderTelegramImportVerification();
  assert.match(w.document.getElementById('telegram-import-verification').innerHTML, /No Telegram-imported mistakes yet/);

  w.localStorage.setItem('quranReviewAyahMistakes', JSON.stringify([
    { id: 'm1', surah: 2, ayah: 5, hizb: 1, type: 'S', note: 'forgot ina', date: '2026-08-10T10:00:00.000Z', source: 'telegram', telegramMessageId: 'ch/1' },
    { id: 'm2', surah: 3, ayah: 1, hizb: 5, type: null, note: '', date: '2026-08-15T09:00:00.000Z', source: 'telegram', telegramMessageId: 'ch/12' },
  ]));
  w.renderTelegramImportVerification();
  const html = w.document.getElementById('telegram-import-verification').innerHTML;

  assert.match(html, /2 mistakes across 2 messages/);
  assert.match(html, /ch\/1\b/);
  assert.match(html, /ch\/12\b/);
  assert.match(html, /2:5/);
  assert.match(html, /3:1/);
  assert.match(html, /forgot ina/);
  // ch/12 (the more recent message) renders before ch/1 in the actual HTML
  // output — matched with a trailing " —" since "ch/1" is otherwise a
  // substring of "ch/12" and would always "find" itself first.
  assert.ok(html.indexOf('ch/12 —') < html.indexOf('ch/1 —'), 'newest message renders first');

  w.localStorage.clear();
});

test('renderTelegramImportVerification caps the list at the most recent 15 messages by default, with a toggle to show all', () => {
  w.localStorage.clear();
  const mistakes = [];
  for (let i = 1; i <= 20; i++) {
    mistakes.push({ id: `m${i}`, surah: 1, ayah: 1, hizb: 1, type: null, note: '', date: '2026-08-15T09:00:00.000Z', source: 'telegram', telegramMessageId: `ch/${i}` });
  }
  w.localStorage.setItem('quranReviewAyahMistakes', JSON.stringify(mistakes));

  w.renderTelegramImportVerification();
  let html = w.document.getElementById('telegram-import-verification').innerHTML;
  assert.match(html, /Show all 20 messages/);
  assert.match(html, /ch\/20\b/, 'the most recent messages are the ones shown by default');
  assert.doesNotMatch(html, /ch\/1\b/, 'the oldest message (ch/1) is outside the default cap of 15');

  w.toggleShowAllTelegramImportVerification();
  html = w.document.getElementById('telegram-import-verification').innerHTML;
  assert.match(html, /Show most recent 15 only/);
  assert.match(html, /ch\/1\b/, 'now visible once "Show all" is toggled on');

  w.toggleShowAllTelegramImportVerification(); // reset global state for later tests
  w.localStorage.clear();
});

test('renderTelegramImportVerification stays in sync after a Telegram import — importMistakesFromTelegram\'s own re-render list includes it', async () => {
  w.localStorage.clear();
  const html = `
    <div class="tgme_widget_message js-widget_message" data-post="tasmee315/1">
      <div class="tgme_widget_message_text">2:<br>5</div>
      <div class="tgme_widget_message_footer"><span class="tgme_widget_message_date"><time datetime="2026-08-14T20:14:46+00:00">20:14</time></span></div>
    </div>
  `;
  const realFetch = w.fetch, realAlert = w.alert, realConfirm = w.confirm;
  w.fetch = async () => ({ ok: true, status: 200, text: async () => html });
  w.confirm = () => true;
  w.alert = () => {};

  await w.importMistakesFromTelegram();

  assert.match(w.document.getElementById('telegram-import-verification').innerHTML, /tasmee315\/1/);

  w.fetch = realFetch;
  w.alert = realAlert;
  w.confirm = realConfirm;
  w.localStorage.clear();
});

// buildSyncPayload()/applySyncPayload() (review.html) mirror
// buildFullLogData()'s { tracker, review, habits } shape (log.js) — same
// data breadth as "Save as JSON File", but with raw/full-fidelity data
// (real ids, ayah mistakes' type/source/sessionId, habit log entries'
// activityId) rather than the hand-editable sanitized shape.

test('buildSyncPayload includes tracker.memorized and habits (activities + log), not just review data', () => {
  w.localStorage.clear();
  w.localStorage.setItem('quran_memorized', JSON.stringify([1, 2, 3]));
  w.localStorage.setItem('personalTrackerActivities', JSON.stringify([
    { id: 'act1', name: 'Workout', targetCount: 2, targetUnit: 'week' },
  ]));
  w.localStorage.setItem('personalTrackerLog', JSON.stringify([
    { id: 'log1', activityId: 'act1', date: '2026-08-02T08:00:00.000Z' },
  ]));
  w.localStorage.setItem('quranReviewAyahMistakes', JSON.stringify([
    { id: 'm1', surah: 1, ayah: 1, hizb: 1, type: 'S', note: '', date: '2026-08-01T00:00:00.000Z', source: 'live' },
  ]));
  w.localStorage.setItem('quranReviewPracticeRanges', JSON.stringify([
    { id: 'p1', kind: 'page', page: 15, target: 5, practiced: 0, note: '', dateAdded: '2026-08-01T00:00:00.000Z', source: 'paste' },
    { id: 'r1', kind: 'range', surah: 2, ayahStart: 15, ayahEnd: 23, target: 20, practiced: 5, note: '', dateAdded: '2026-08-01T00:00:00.000Z', source: 'manual' },
  ]));

  const payload = toPlain(w.buildSyncPayload());

  assert.deepEqual(payload.tracker.memorized, [1, 2, 3]);
  assert.equal(payload.habits.activities.length, 1);
  assert.equal(payload.habits.activities[0].name, 'Workout');
  assert.equal(payload.habits.log.length, 1);
  assert.equal(payload.habits.log[0].activityId, 'act1', 'raw activityId, not the name-based hand-editable shape');
  assert.equal(payload.review.ayahMistakes[0].source, 'live', 'full-fidelity raw mistake, including source');
  assert.equal(payload.review.ayahMistakes[0].id, 'm1', 'real id preserved, unlike the sanitized JSON-file export');
  assert.equal(payload.review.pagesNeedingReview, undefined, 'retired field — a page goal lives in practiceRanges now');
  assert.equal(payload.review.practiceRanges.length, 2);
  assert.ok(payload.review.practiceRanges.some(r => r.kind === 'page' && r.page === 15));
  assert.ok(payload.review.practiceRanges.some(r => r.kind === 'range' && r.practiced === 5), 'full-fidelity raw practiced count');

  w.localStorage.clear();
});

test('buildSyncPayload includes telegramLastImportedAt (null when never imported), so a second device can show it too', () => {
  w.localStorage.clear();
  assert.equal(w.buildSyncPayload().review.telegramLastImportedAt, null, 'never imported on this device yet');

  w.localStorage.setItem('quranReviewTelegramLastImportedAt', '2026-08-20T10:00:00.000Z');
  assert.equal(w.buildSyncPayload().review.telegramLastImportedAt, '2026-08-20T10:00:00.000Z');

  w.localStorage.clear();
});

test('normalizeSyncPayload passes through the current { tracker, review, habits } shape unchanged when it has no legacy pagesNeedingReview to fold in', () => {
  const shape = { tracker: { memorized: [1] }, review: { ayahMistakes: [] }, habits: { activities: [] }, updatedAt: 5 };
  assert.equal(w.normalizeSyncPayload(shape), shape);
});

test('normalizeSyncPayload folds a still-separate review.pagesNeedingReview (a doc pushed before it merged into Practice More) into practiceRanges as kind:"page" entries', () => {
  const remote = {
    review: {
      practiceRanges: [{ kind: 'range', surah: 2, ayahStart: 1, ayahEnd: 5, target: 10, practiced: 0, dateAdded: '2026-08-01T00:00:00.000Z' }],
      pagesNeedingReview: [{ page: 15, note: 'redo', date: '2026-08-01T00:00:00.000Z', source: 'paste' }],
    },
  };
  const normalized = toPlain(w.normalizeSyncPayload(remote));

  assert.equal(normalized.review.practiceRanges.length, 2);
  assert.ok(normalized.review.practiceRanges.some(r => r.kind === 'range' && r.surah === 2));
  const migratedPage = normalized.review.practiceRanges.find(r => r.kind === 'page');
  assert.ok(migratedPage);
  assert.equal(migratedPage.page, 15);
  assert.equal(migratedPage.target, 5, 'defaults to the standard page-practice target since the old shape had none');
  assert.equal(migratedPage.note, 'redo');
});

test('normalizeSyncPayload folds a still-single-string review.agentPromptOverride (a doc pushed before prompt presets existed) into agentPromptOverrides.general', () => {
  const remote = {
    review: { agentPromptOverride: 'Old single-override text.' },
  };
  const normalized = toPlain(w.normalizeSyncPayload(remote));
  assert.deepEqual(normalized.review.agentPromptOverrides, { general: 'Old single-override text.' });
});

test('normalizeSyncPayload never lets a stale legacy agentPromptOverride clobber an already-current agentPromptOverrides.general', () => {
  const remote = {
    review: { agentPromptOverride: 'Stale.', agentPromptOverrides: { general: 'Current.' } },
  };
  const normalized = toPlain(w.normalizeSyncPayload(remote));
  assert.deepEqual(normalized.review.agentPromptOverrides, { general: 'Current.' });
});

test('normalizeSyncPayload upgrades a legacy flat { log, memorizedHizbs, ayahMistakes, mutashabihatPairs } doc (from before tracker/habits were synced)', () => {
  const legacy = {
    log: [{ id: 's1', hizb: 3, mistakes: 2, date: '2026-08-01T00:00:00.000Z' }],
    memorizedHizbs: [1, 2],
    ayahMistakes: [{ id: 'm1', surah: 1, ayah: 1, hizb: 1, date: '2026-08-01T00:00:00.000Z' }],
    mutashabihatPairs: [],
    updatedAt: 12345,
  };
  const normalized = toPlain(w.normalizeSyncPayload(legacy));

  assert.deepEqual(normalized.review.recitationLog, legacy.log, 'old "log" field becomes review.recitationLog');
  assert.deepEqual(normalized.review.memorizedHizbs, [1, 2]);
  assert.equal(normalized.review.ayahMistakes.length, 1);
  assert.deepEqual(normalized.tracker.memorized, [], 'a legacy doc never had tracker data — defaults to empty, not lost/undefined');
  assert.deepEqual(normalized.habits.activities, []);
  assert.deepEqual(normalized.review.practiceRanges, [], 'a legacy doc never had practice ranges (or page flags) either — defaults to empty');
  assert.equal(normalized.updatedAt, 12345);
});

test('applySyncPayload writes every section — tracker, all review fields, and habits — into localStorage', () => {
  w.localStorage.clear();
  const remote = {
    tracker: { memorized: [4, 5] },
    review: {
      memorizedHizbs: [4, 5],
      recitationLog: [{ id: 's1', hizb: 4, mistakes: 1, date: '2026-08-01T00:00:00.000Z' }],
      ayahMistakes: [{ id: 'm1', surah: 1, ayah: 1, hizb: 4, date: '2026-08-01T00:00:00.000Z', source: 'paste' }],
      mutashabihatPairs: [{ id: 'g1', ayat: [{ surah: 1, ayah: 1 }], note: '', dateAdded: '2026-08-01T00:00:00.000Z' }],
      practiceRanges: [
        { id: 'r1', kind: 'range', surah: 2, ayahStart: 15, ayahEnd: 23, target: 20, practiced: 5, note: '', dateAdded: '2026-08-01T00:00:00.000Z', source: 'manual' },
        { id: 'p1', kind: 'page', page: 15, target: 5, practiced: 0, note: '', dateAdded: '2026-08-01T00:00:00.000Z', source: 'telegram' },
      ],
    },
    habits: {
      activities: [{ id: 'act1', name: 'Reading', targetCount: 1, targetUnit: 'day' }],
      log: [{ id: 'log1', activityId: 'act1', date: '2026-08-01T00:00:00.000Z' }],
    },
    updatedAt: 999,
  };

  w.applySyncPayload(remote);

  assert.deepEqual(JSON.parse(w.localStorage.getItem('quran_memorized')), [4, 5]);
  assert.equal(JSON.parse(w.localStorage.getItem('quranReviewHizbLog')).length, 1);
  assert.deepEqual(JSON.parse(w.localStorage.getItem('quranReviewMemorizedHizbs')), [4, 5]);
  assert.equal(JSON.parse(w.localStorage.getItem('quranReviewAyahMistakes'))[0].source, 'paste');
  assert.equal(JSON.parse(w.localStorage.getItem('quranReviewMutashabihatPairs')).length, 1);
  const savedPracticeRanges = JSON.parse(w.localStorage.getItem('quranReviewPracticeRanges'));
  assert.equal(savedPracticeRanges.length, 2);
  assert.ok(savedPracticeRanges.some(r => r.kind === 'range' && r.practiced === 5));
  assert.ok(savedPracticeRanges.some(r => r.kind === 'page' && r.page === 15));
  assert.equal(JSON.parse(w.localStorage.getItem('personalTrackerActivities')).length, 1);
  assert.equal(JSON.parse(w.localStorage.getItem('personalTrackerLog'))[0].activityId, 'act1');
  assert.equal(w.localStorage.getItem('quranReviewSyncUpdatedAt'), '999');
  assert.equal(w.localStorage.getItem('quranReviewTelegramLastImportedAt'), remote.review.telegramLastImportedAt || '');

  w.localStorage.clear();
});

test('applySyncPayload pulls telegramLastImportedAt from another device, so a device that never ran Import from Telegram itself still shows when it last happened', () => {
  w.localStorage.clear();
  const remote = {
    tracker: { memorized: [] },
    review: {
      memorizedHizbs: [], recitationLog: [], ayahMistakes: [], mutashabihatPairs: [], practiceRanges: [],
      telegramLastImportedAt: '2026-08-20T10:00:00.000Z',
    },
    habits: { activities: [], log: [] },
    updatedAt: 1,
  };

  w.applySyncPayload(remote);

  assert.equal(w.localStorage.getItem('quranReviewTelegramLastImportedAt'), '2026-08-20T10:00:00.000Z');
  w.localStorage.clear();
});

test('applySyncPayload falls back to empty (not the literal string "undefined") for a doc pushed before telegramLastImportedAt was synced', () => {
  w.localStorage.clear();
  const remote = {
    tracker: { memorized: [] },
    review: { memorizedHizbs: [], recitationLog: [], ayahMistakes: [], mutashabihatPairs: [], practiceRanges: [] },
    habits: { activities: [], log: [] },
    updatedAt: 1,
  };

  w.applySyncPayload(remote);

  assert.equal(w.localStorage.getItem('quranReviewTelegramLastImportedAt'), '');
  w.localStorage.clear();
});

test('applySyncPayload on a legacy flat doc doesn\'t wipe tracker/habits — it correctly has none to restore, not "loses" them', () => {
  w.localStorage.clear();
  // Simulates pulling a doc pushed before this device's next push upgrades it.
  const legacy = {
    log: [{ id: 's1', hizb: 2, mistakes: 3, date: '2026-08-01T00:00:00.000Z' }],
    memorizedHizbs: [2],
    ayahMistakes: [],
    mutashabihatPairs: [],
    updatedAt: 42,
  };

  w.applySyncPayload(legacy);

  assert.equal(JSON.parse(w.localStorage.getItem('quranReviewHizbLog')).length, 1, 'review data still comes through via normalizeSyncPayload');
  assert.deepEqual(JSON.parse(w.localStorage.getItem('quran_memorized')), [], 'no tracker data in a legacy doc — empty, not an error');

  w.localStorage.clear();
});

test('updateSyncIndicator shows only the Connect form when disconnected, and only Push/Pull/Disconnect once connected — each set of controls has nothing useful to do in the other state', () => {
  const realIsSyncConnected = w.isSyncConnected;

  w.isSyncConnected = () => false;
  w.updateSyncIndicator();
  assert.notEqual(w.document.getElementById('sync-account-field').style.display, 'none', 'Account Name field shown when there\'s nothing connected yet');
  assert.notEqual(w.document.getElementById('sync-connect-btn').style.display, 'none');
  assert.equal(w.document.getElementById('sync-push-btn').style.display, 'none', 'Push Now has nothing to push to without a connection');
  assert.equal(w.document.getElementById('sync-pull-btn').style.display, 'none');
  assert.equal(w.document.getElementById('sync-disconnect-btn').style.display, 'none', 'nothing to disconnect from');

  w.isSyncConnected = () => true;
  w.updateSyncIndicator();
  assert.equal(w.document.getElementById('sync-account-field').style.display, 'none', 'nothing left to type once already connected');
  assert.equal(w.document.getElementById('sync-connect-btn').style.display, 'none');
  assert.notEqual(w.document.getElementById('sync-push-btn').style.display, 'none');
  assert.notEqual(w.document.getElementById('sync-pull-btn').style.display, 'none');
  assert.notEqual(w.document.getElementById('sync-disconnect-btn').style.display, 'none');

  w.isSyncConnected = realIsSyncConnected;
  w.updateSyncIndicator();
});

// buildSyncPayload() (Firebase) and buildFullLogData() (log.js, "Save as
// JSON File") are deliberately NOT byte-identical — the JSON export drops
// ids/sessionId and hand-editably formats dates, while the sync payload
// keeps raw full-fidelity data (see buildSyncPayload's own comment for
// why). But they must always cover the exact same FIELDS and the exact
// same real user data — a field added to only one of them is a silent
// data-loss bug (this caught a real one: telegramLastImportedAt was added
// to buildSyncPayload alone at first, so a "Save as JSON File" backup
// would have silently dropped it).
function seedEverySyncedField(w) {
  w.localStorage.clear();
  w.localStorage.setItem('quran_memorized', JSON.stringify([1, 2, 3]));
  w.localStorage.setItem('quranReviewMemorizedHizbs', JSON.stringify([1, 2]));
  w.localStorage.setItem('quranReviewHizbLog', JSON.stringify([
    { id: 's1', hizb: 1, mistakes: 2, date: '2026-08-15T10:00:00.000Z' },
  ]));
  w.localStorage.setItem('quranReviewAyahMistakes', JSON.stringify([
    { id: 'm1', surah: 2, ayah: 81, hizb: 2, type: null, note: '', date: '2026-08-15T10:00:00.000Z', source: 'telegram', telegramMessageId: 'ch/1', sessionId: 's1' },
  ]));
  w.localStorage.setItem('quranReviewMutashabihatPairs', JSON.stringify([
    { id: 'g1', ayat: [{ surah: 2, ayah: 62 }, { surah: 5, ayah: 69 }], note: 'famous one', dateAdded: '2026-08-15T10:00:00.000Z' },
  ]));
  w.localStorage.setItem('quranReviewPracticeRanges', JSON.stringify([
    { id: 'p1', kind: 'page', page: 15, target: 5, practiced: 2, note: '', dateAdded: '2026-08-15T10:00:00.000Z', source: 'manual', telegramMessageId: null },
    { id: 'r1', kind: 'range', surah: 2, ayahStart: 81, ayahEnd: 88, target: 15, practiced: 0, note: '', dateAdded: '2026-08-15T10:00:00.000Z', source: 'telegram', telegramMessageId: 'ch/2' },
  ]));
  w.localStorage.setItem('quranReviewTelegramLastImportedAt', '2026-08-15T09:30:00.000Z');
  w.localStorage.setItem('personalTrackerActivities', JSON.stringify([
    { id: 'act1', name: 'Workout', targetCount: 2, targetUnit: 'week' },
  ]));
  w.localStorage.setItem('personalTrackerLog', JSON.stringify([
    { id: 'log1', activityId: 'act1', date: '2026-08-15T08:00:00.000Z' },
  ]));
}

test('buildSyncPayload and buildFullLogData cover the exact same top-level and review/habits fields — nothing present in one and silently missing from the other, aside from the deliberate agent-settings exception', () => {
  seedEverySyncedField(w);
  const sync = w.buildSyncPayload();
  const json = w.buildFullLogData();

  // agentApiKey/agentModel are excluded from the JSON backup for secrecy
  // (see AGENT_API_KEY_KEY's own comment — that channel is far more likely
  // to leak by accident than a Firestore doc gated by a private account
  // name); the rest (including telegramImportCheckpoint) aren't sensitive,
  // but are excluded for scope — app configuration, not core review data.
  const AGENT_SYNC_ONLY_FIELDS = [
    'agentApiKey', 'agentModel', 'agentPromptPreset', 'agentPromptOverrides',
    'agentIncludeAyahMistakes', 'agentIncludeRecitationLog', 'agentIncludePracticeRanges', 'agentIncludeMutashabihat',
    'telegramImportCheckpoint',
  ];

  assert.deepEqual(Object.keys(sync).filter(k => k !== 'updatedAt').sort(), Object.keys(json).filter(k => k !== '_note' && k !== 'exportedAt').sort(),
    'same top-level sections, ignoring each format\'s own bookkeeping (updatedAt / _note+exportedAt)');
  assert.deepEqual(Object.keys(sync.tracker).sort(), Object.keys(json.tracker).sort());
  assert.deepEqual(
    Object.keys(sync.review).filter(k => !AGENT_SYNC_ONLY_FIELDS.includes(k)).sort(),
    Object.keys(json.review).sort()
  );
  assert.deepEqual(Object.keys(sync.habits).sort(), Object.keys(json.habits).sort());

  w.localStorage.clear();
});

test('buildSyncPayload and buildFullLogData agree on how many entries each review/habits array field has, given the same underlying data', () => {
  seedEverySyncedField(w);
  const sync = w.buildSyncPayload();
  const json = w.buildFullLogData();

  for (const key of ['memorizedHizbs', 'recitationLog', 'ayahMistakes', 'mutashabihatPairs', 'practiceRanges']) {
    assert.equal(sync.review[key].length, json.review[key].length, `review.${key} count should match`);
  }
  assert.equal(sync.habits.activities.length, json.habits.activities.length);
  assert.equal(sync.habits.log.length, json.habits.log.length);
  assert.deepEqual(toPlain(sync.tracker.memorized), toPlain(json.tracker.memorized));

  w.localStorage.clear();
});

test('buildSyncPayload and buildFullLogData agree on the actual mistake/practice-range content, aside from the deliberate id/date-format differences', () => {
  seedEverySyncedField(w);
  const sync = toPlain(w.buildSyncPayload());
  const json = toPlain(w.buildFullLogData());

  const syncMistake = sync.review.ayahMistakes[0];
  const jsonMistake = json.review.ayahMistakes[0];
  assert.equal(syncMistake.surah, jsonMistake.surah);
  assert.equal(syncMistake.ayah, jsonMistake.ayah);
  assert.equal(syncMistake.hizb, jsonMistake.hizb);
  assert.equal(syncMistake.type, jsonMistake.type);
  assert.equal(syncMistake.source, jsonMistake.source);
  assert.equal(syncMistake.telegramMessageId, jsonMistake.telegramMessageId);
  assert.equal(new Date(syncMistake.date).getTime(), new Date(jsonMistake.date).getTime(), 'same moment, even though the JSON export reformats it for hand-editing');

  const syncRange = sync.review.practiceRanges.find(r => r.kind === 'range');
  const jsonRange = json.review.practiceRanges.find(r => r.kind === 'range');
  assert.equal(syncRange.surah, jsonRange.surah);
  assert.equal(syncRange.ayahStart, jsonRange.ayahStart);
  assert.equal(syncRange.ayahEnd, jsonRange.ayahEnd);
  assert.equal(syncRange.target, jsonRange.target);
  assert.equal(syncRange.practiced, jsonRange.practiced);
  assert.equal(syncRange.telegramMessageId, jsonRange.telegramMessageId);

  assert.equal(new Date(sync.review.telegramLastImportedAt).getTime(), new Date(json.review.telegramLastImportedAt).getTime(),
    'same moment for telegramLastImportedAt too, despite the different string format');

  w.localStorage.clear();
});

test('a full round trip — buildFullLogData ("Save as JSON File") -> applyFullLogData -> buildSyncPayload — preserves every field, including telegramLastImportedAt', () => {
  seedEverySyncedField(w);
  const exported = w.buildFullLogData();

  w.localStorage.clear();
  w.applyFullLogData(exported);
  const resynced = toPlain(w.buildSyncPayload());

  assert.equal(resynced.review.ayahMistakes.length, 1);
  assert.equal(resynced.review.ayahMistakes[0].surah, 2);
  assert.equal(resynced.review.ayahMistakes[0].source, 'telegram');
  assert.equal(resynced.review.practiceRanges.length, 2);
  assert.ok(resynced.review.practiceRanges.some(r => r.kind === 'page' && r.page === 15));
  assert.ok(resynced.review.practiceRanges.some(r => r.kind === 'range' && r.surah === 2));
  assert.equal(resynced.review.mutashabihatPairs.length, 1);
  assert.equal(new Date(resynced.review.telegramLastImportedAt).getTime(), new Date('2026-08-15T09:30:00.000Z').getTime());

  w.localStorage.clear();
});

test('a full round trip — buildSyncPayload (Firebase) -> applySyncPayload -> buildFullLogData ("Save as JSON File") — preserves every field, including telegramLastImportedAt', () => {
  seedEverySyncedField(w);
  const synced = w.buildSyncPayload();

  w.localStorage.clear();
  w.applySyncPayload(synced);
  const reexported = w.buildFullLogData();

  assert.equal(reexported.review.ayahMistakes.length, 1);
  assert.equal(reexported.review.ayahMistakes[0].surah, 2);
  assert.equal(reexported.review.ayahMistakes[0].source, 'telegram');
  assert.equal(reexported.review.practiceRanges.length, 2);
  assert.ok(reexported.review.practiceRanges.some(r => r.kind === 'page' && r.page === 15));
  assert.ok(reexported.review.practiceRanges.some(r => r.kind === 'range' && r.surah === 2));
  assert.equal(reexported.review.mutashabihatPairs.length, 1);
  assert.ok(reexported.review.telegramLastImportedAt, 'not silently dropped on the sync -> JSON-export path either');
  assert.equal(new Date(reexported.review.telegramLastImportedAt).getTime(), new Date('2026-08-15T09:30:00.000Z').getTime());

  w.localStorage.clear();
});

// ─── Agent Chat (Gemini) ────────────────────────────────────────────────────

test('buildAgentContext returns a compact TEXT block (not JSON), with each ayah\'s line reduced to "surah:ayah MM-DD[:typeCode] ..." and no repeated field-name overhead', () => {
  w.localStorage.clear();
  const currentYear = new Date().getFullYear();
  w.localStorage.setItem('quranReviewAyahMistakes', JSON.stringify([
    { id: 'm1', surah: 2, ayah: 255, hizb: 5, type: 'B', note: 'forgot the start', date: `${currentYear}-08-10T00:00:00.000Z`, source: 'live' },
    { id: 'm2', surah: 3, ayah: 15, hizb: 6, type: null, note: '', date: `${currentYear}-08-12T09:00:00.000Z`, source: 'live' },
  ]));
  w.localStorage.setItem('quranReviewHizbLog', JSON.stringify([
    { id: 's1', hizb: 5, date: `${currentYear}-08-10T00:00:00.000Z`, mistakes: 1 },
  ]));
  w.localStorage.setItem('quranReviewMemorizedHizbs', JSON.stringify([1, 2, 5]));

  const ctx = w.buildAgentContext();

  assert.equal(typeof ctx, 'string');
  assert.match(ctx, /^TODAY: \d{4}-\d{2}-\d{2}/);
  assert.match(ctx, /MEMORIZED HIZBS: 1,2,5/);
  assert.match(ctx, /2:255 08-10:B$/m, 'a typed mistake keeps its type code as a suffix, and the year is dropped since it matches TODAY\'s');
  assert.match(ctx, /3:15 08-12$/m, 'an untyped mistake has no trailing type code');
  assert.match(ctx, /5 08-10 1$/m, 'recitation log line is "hizb date mistakeCount", year also dropped');
  assert.ok(!ctx.includes('{'), 'no JSON object syntax at all');
  assert.ok(!ctx.includes('Al-Baqara'), 'the full SURAHS table is not included — the model already knows standard surah names');
  assert.ok(!ctx.includes('Forgot the beginning'), 'mistake-type definitions are not sent as data — they live in the prompt text instead');

  w.localStorage.clear();
});

test('shortenAgentDate drops the year when it matches currentYear (leaving just "MM-DD"), but keeps a different year in full ("YYYY-MM-DD")', () => {
  assert.equal(w.shortenAgentDate('2026-08-10T00:00:00.000Z', 2026), '08-10');
  assert.equal(w.shortenAgentDate('2025-12-31', 2026), '2025-12-31');
  assert.equal(w.shortenAgentDate('2027-01-05', 2026), '2027-01-05');
});

test('buildAgentContext groups every mistake for the SAME ayah onto one line ("surah:ayah date date ..."), oldest date first, instead of repeating the ref per mistake', () => {
  w.localStorage.clear();
  const y = new Date().getFullYear();
  w.localStorage.setItem('quranReviewAyahMistakes', JSON.stringify([
    { id: 'm1', surah: 2, ayah: 23, hizb: 1, type: null, note: '', date: `${y}-08-12T00:00:00.000Z`, source: 'live' },
    { id: 'm2', surah: 2, ayah: 23, hizb: 1, type: null, note: '', date: `${y}-08-10T00:00:00.000Z`, source: 'live' },
    { id: 'm3', surah: 5, ayah: 3, hizb: 9, type: 'S', note: '', date: `${y}-08-11T00:00:00.000Z`, source: 'live' },
  ]));

  const ctx = w.buildAgentContext();

  assert.match(ctx, /^2:23 08-10 08-12$/m, 'both dates for 2:23 on one line, oldest (08-10) first even though it was logged second');
  assert.match(ctx, /^5:3 08-11:S$/m, 'a distinct ayah still gets its own line, with its own type code');
  assert.ok(ctx.includes('across 2 ayat'), 'the summary count reflects distinct ayat, not raw mistake count');

  w.localStorage.clear();
});

test('buildAgentContext never collapses a mistake from a genuinely different year into this year\'s "MM-DD" — multi-year history stays unambiguous', () => {
  w.localStorage.clear();
  const y = new Date().getFullYear();
  w.localStorage.setItem('quranReviewAyahMistakes', JSON.stringify([
    { id: 'm1', surah: 2, ayah: 23, hizb: 1, type: null, note: '', date: '2020-01-15T00:00:00.000Z', source: 'live' },
    { id: 'm2', surah: 2, ayah: 23, hizb: 1, type: null, note: '', date: `${y}-08-10T00:00:00.000Z`, source: 'live' },
  ]));

  const ctx = w.buildAgentContext();

  assert.match(ctx, /^2:23 2020-01-15 08-10$/m, 'the old-year date stays in full; only the current-year one is shortened');

  w.localStorage.clear();
});

test('buildAgentContext only includes each data category when its own AGENT_INCLUDE_KEYS flag is on — most questions only need ayah mistakes, so the others default off', () => {
  w.localStorage.clear();
  w.localStorage.setItem('quranReviewAyahMistakes', JSON.stringify([
    { id: 'm1', surah: 2, ayah: 255, hizb: 5, type: null, note: '', date: '2026-08-10T00:00:00.000Z', source: 'live' },
  ]));
  w.localStorage.setItem('quranReviewHizbLog', JSON.stringify([{ id: 's1', hizb: 5, date: '2026-08-10T00:00:00.000Z', mistakes: 1 }]));
  w.localStorage.setItem('quranReviewPracticeRanges', JSON.stringify([
    { id: 'p1', kind: 'page', page: 15, target: 5, practiced: 2, note: '' },
  ]));
  w.localStorage.setItem('quranReviewMutashabihatPairs', JSON.stringify([
    { ayat: [{ surah: 2, ayah: 1 }, { surah: 3, ayah: 1 }], note: '', dateAdded: '2026-08-01T00:00:00.000Z' },
  ]));

  // Defaults: ayahMistakes/recitationLog on, practiceRanges/mutashabihat off.
  let ctx = w.buildAgentContext();
  assert.ok(ctx.includes('AYAH MISTAKES'));
  assert.ok(ctx.includes('RECITATION LOG'));
  assert.ok(!ctx.includes('PRACTICE GOALS'));
  assert.ok(!ctx.includes('MUTASHABIHAT GROUPS'));

  w.saveAgentIncludeFlag('ayahMistakes', false);
  w.saveAgentIncludeFlag('recitationLog', false);
  w.saveAgentIncludeFlag('practiceRanges', true);
  w.saveAgentIncludeFlag('mutashabihat', true);
  ctx = w.buildAgentContext();
  assert.ok(!ctx.includes('AYAH MISTAKES'));
  assert.ok(!ctx.includes('RECITATION LOG'));
  assert.ok(ctx.includes('PRACTICE GOALS'));
  assert.ok(ctx.includes('Page 15 2/5'));
  assert.ok(ctx.includes('MUTASHABIHAT GROUPS'));
  assert.ok(ctx.includes('2:1, 3:1'));

  w.localStorage.clear();
});

test('saveAgentSettings pushes with manual:true (an explicit, confirmed "upload to Firebase" — not the silent fire-and-forget most other saves use)', async () => {
  w.localStorage.clear();
  w.document.getElementById('agent-api-key').value = 'a-key';
  w.document.getElementById('agent-model').value = 'gemini-2.5-flash';
  const realSyncPush = w.syncPush;
  let capturedOpts = null;
  w.syncPush = async (opts) => { capturedOpts = opts; };

  await w.saveAgentSettings();

  assert.deepEqual(toPlain(capturedOpts), { manual: true });
  assert.equal(w.localStorage.getItem('quranReviewAgentApiKey'), 'a-key');

  w.syncPush = realSyncPush;
  w.document.getElementById('agent-api-key').value = '';
  w.localStorage.clear();
});

test('the Gemini API key and model DO travel through Firebase sync (entered once, on any device), but never through a JSON backup file, and chat history travels through neither', () => {
  w.localStorage.clear();
  w.localStorage.setItem('quranReviewAgentApiKey', 'SECRET-KEY-DO-NOT-LEAK');
  w.localStorage.setItem('quranReviewAgentModel', 'gemini-2.5-flash');
  w.localStorage.setItem('quranReviewAgentChatHistory', JSON.stringify([{ role: 'user', text: 'hi' }]));

  const synced = w.buildSyncPayload();
  assert.equal(synced.review.agentApiKey, 'SECRET-KEY-DO-NOT-LEAK');
  assert.equal(synced.review.agentModel, 'gemini-2.5-flash');
  assert.equal(synced.review.agentChatHistory, undefined, 'chat history itself never syncs');

  const exported = JSON.stringify(w.buildFullLogData());
  assert.ok(!exported.includes('SECRET-KEY-DO-NOT-LEAK'), 'JSON backup must never carry the API key — a downloaded file is far more exposed than a Firestore doc gated by a private account name');
  assert.ok(!exported.includes('"hi"'), 'JSON backup must never carry chat history either');

  w.localStorage.clear();
});

test('applySyncPayload pulls the Gemini API key/model from another device that already set them, so a device that never entered its own key still gets one', () => {
  w.localStorage.clear();
  w.applySyncPayload({
    tracker: { memorized: [] },
    review: {
      memorizedHizbs: [], recitationLog: [], ayahMistakes: [], mutashabihatPairs: [], practiceRanges: [],
      telegramLastImportedAt: null, agentApiKey: 'KEY-FROM-OTHER-DEVICE', agentModel: 'gemini-2.5-flash',
    },
    habits: { activities: [], log: [] },
    updatedAt: Date.now(),
  });

  assert.equal(w.localStorage.getItem('quranReviewAgentApiKey'), 'KEY-FROM-OTHER-DEVICE');
  assert.equal(w.localStorage.getItem('quranReviewAgentModel'), 'gemini-2.5-flash');

  w.localStorage.clear();
});

test('applySyncPayload falls back to empty (not "undefined") for a doc pushed before agentApiKey/agentModel were synced, same rule as telegramLastImportedAt', () => {
  w.localStorage.clear();
  w.applySyncPayload({
    tracker: { memorized: [] },
    review: {
      memorizedHizbs: [], recitationLog: [], ayahMistakes: [], mutashabihatPairs: [], practiceRanges: [],
      telegramLastImportedAt: null,
    },
    habits: { activities: [], log: [] },
    updatedAt: Date.now(),
  });

  assert.equal(w.localStorage.getItem('quranReviewAgentApiKey'), '');
  assert.equal(w.localStorage.getItem('quranReviewAgentModel'), '');

  w.localStorage.clear();
});

test('sendAgentChatMessage sends AGENT_CHAT_EMPTY_MESSAGE_DEFAULT (not a no-op) when the input box is left empty — some prompts (e.g. Print Suggestions) are a complete instruction on their own, with nothing left to type', async () => {
  w.localStorage.clear();
  w.localStorage.setItem('quranReviewAgentApiKey', 'test-key');
  const input = w.document.getElementById('agent-chat-input');
  input.value = '   '; // whitespace-only counts as empty
  const realFetch = w.fetch;
  let capturedBody = null;
  w.fetch = async (url, opts) => {
    capturedBody = JSON.parse(opts.body);
    return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }) };
  };

  await w.sendAgentChatMessage();

  assert.deepEqual(toPlain(capturedBody.contents), [{ role: 'user', parts: [{ text: AGENT_CHAT_EMPTY_MESSAGE_DEFAULT_TEXT }] }]);
  const history = w.loadAgentChatHistory();
  assert.equal(history[0].text, AGENT_CHAT_EMPTY_MESSAGE_DEFAULT_TEXT, 'shown in the transcript like a real message, never hidden');
  assert.equal(input.value, '', 'input still clears, same as a real message');

  w.fetch = realFetch;
  w.localStorage.clear();
});

test('sendAgentChatMessage sends the user\'s own typed text as-is when the input box is not empty', async () => {
  w.localStorage.clear();
  w.localStorage.setItem('quranReviewAgentApiKey', 'test-key');
  const input = w.document.getElementById('agent-chat-input');
  input.value = 'What should I review today?';
  const realFetch = w.fetch;
  let capturedBody = null;
  w.fetch = async (url, opts) => {
    capturedBody = JSON.parse(opts.body);
    return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }) };
  };

  await w.sendAgentChatMessage();

  assert.deepEqual(toPlain(capturedBody.contents), [{ role: 'user', parts: [{ text: 'What should I review today?' }] }]);

  w.fetch = realFetch;
  w.localStorage.clear();
});

test('callGeminiAgent sends the system prompt + user data + full chat history to Gemini\'s REST endpoint, and returns the model\'s reply text', async () => {
  w.localStorage.clear();
  const realFetch = w.fetch;
  let capturedUrl = null, capturedBody = null;
  w.fetch = async (url, opts) => {
    capturedUrl = url;
    capturedBody = JSON.parse(opts.body);
    return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: 'Review 2:255 and 2:284-286 first.' }] } }] }) };
  };

  const history = [{ role: 'user', text: 'What should I review?' }];
  const reply = await w.callGeminiAgent(history, 'test-key', 'gemini-2.5-flash');

  assert.equal(reply, 'Review 2:255 and 2:284-286 first.');
  assert.ok(capturedUrl.includes('gemini-2.5-flash'));
  assert.ok(capturedUrl.includes('key=test-key'));
  assert.ok(capturedBody.systemInstruction.parts[0].text.includes('personal Quran memorization'), 'includes the "general" preset prompt by default');
  assert.ok(capturedBody.systemInstruction.parts[0].text.includes('MEMORIZED HIZBS'), 'includes the compact review-data text block');
  assert.deepEqual(capturedBody.contents, [{ role: 'user', parts: [{ text: 'What should I review?' }] }]);

  w.fetch = realFetch;
  w.localStorage.clear();
});

test('buildFullAgentPayloadText labels the currently active preset and includes both its prompt text and the live compact data block', () => {
  w.localStorage.clear();
  w.localStorage.setItem('quranReviewAgentPromptPreset', 'print');
  w.localStorage.setItem('quranReviewMemorizedHizbs', JSON.stringify([1, 2]));

  const text = w.buildFullAgentPayloadText();

  assert.ok(text.startsWith('Prompt: Print Suggestions'));
  assert.ok(text.includes(AGENT_PRINT_SYSTEM_PROMPT_TEXT), 'includes the print preset\'s own (fallback) prompt text');
  assert.ok(text.includes('MEMORIZED HIZBS: 1,2'), 'includes the live compact data block');

  w.localStorage.clear();
});

test('copyAgentPayloadToClipboard writes the exact same text buildFullAgentPayloadText produces onto the clipboard, and confirms via alert', async () => {
  w.localStorage.clear();
  const realClipboard = w.navigator.clipboard;
  let copiedText = null;
  w.navigator.clipboard = { writeText: async (text) => { copiedText = text; } };
  const realAlert = w.alert;
  let alertMessage = null;
  w.alert = (msg) => { alertMessage = msg; };

  await w.copyAgentPayloadToClipboard();

  assert.equal(copiedText, w.buildFullAgentPayloadText());
  assert.match(alertMessage, /Copied/);

  w.navigator.clipboard = realClipboard;
  w.alert = realAlert;
  w.localStorage.clear();
});

test('copyAgentPayloadToClipboard alerts with the error instead of throwing when the clipboard write fails', async () => {
  const realClipboard = w.navigator.clipboard;
  w.navigator.clipboard = { writeText: async () => { throw new Error('permission denied'); } };
  const realAlert = w.alert;
  let alertMessage = null;
  w.alert = (msg) => { alertMessage = msg; };

  await w.copyAgentPayloadToClipboard();

  assert.match(alertMessage, /Couldn't copy.*permission denied/);

  w.navigator.clipboard = realClipboard;
  w.alert = realAlert;
});

test('saveAgentDataToFirebase reports there\'s nothing to save to when sync isn\'t connected, without calling syncPush', async () => {
  const realIsSyncConnected = w.isSyncConnected, realSyncPush = w.syncPush;
  w.isSyncConnected = () => false;
  let syncPushCalled = false;
  w.syncPush = async () => { syncPushCalled = true; };

  await w.saveAgentDataToFirebase();

  assert.equal(syncPushCalled, false);
  assert.match(w.document.getElementById('agent-save-status').textContent, /Connect to sync first/);

  w.isSyncConnected = realIsSyncConnected;
  w.syncPush = realSyncPush;
});

test('saveAgentDataToFirebase pushes with manual:true and confirms once connected', async () => {
  const realIsSyncConnected = w.isSyncConnected, realSyncPush = w.syncPush;
  w.isSyncConnected = () => true;
  let capturedOpts = null;
  w.syncPush = async (opts) => { capturedOpts = opts; };

  await w.saveAgentDataToFirebase();

  assert.deepEqual(toPlain(capturedOpts), { manual: true });
  assert.match(w.document.getElementById('agent-save-status').textContent, /Saved to your synced account/);

  w.isSyncConnected = realIsSyncConnected;
  w.syncPush = realSyncPush;
});

test('printLastAgentResponse alerts instead of opening a print window when there is no agent response yet', () => {
  w.saveAgentChatHistory([{ role: 'user', text: 'hi' }]); // a question with no reply yet
  const realAlert = w.alert;
  let alertMessage = null;
  w.alert = (msg) => { alertMessage = msg; };

  w.printLastAgentResponse();

  assert.match(alertMessage, /No agent response yet/);

  w.alert = realAlert;
  w.saveAgentChatHistory([]);
});

test('printLastAgentResponse prints only the MOST RECENT agent reply (with its own preceding question for context), not the whole conversation', () => {
  w.saveAgentChatHistory([
    { role: 'user', text: 'First question' },
    { role: 'agent', text: 'First answer' },
    { role: 'user', text: 'Second question' },
    { role: 'agent', text: 'Second answer' },
  ]);
  const realOpen = w.window.open;
  const { win: fakeWin, getCaptured } = makeFakePrintWindow();
  w.window.open = () => fakeWin;

  w.printLastAgentResponse();

  const html = getCaptured();
  assert.ok(html.includes('Second answer'), 'prints the LAST reply');
  assert.ok(html.includes('Second question'), 'shows the question that prompted it');
  assert.ok(!html.includes('First answer'), 'does not print the earlier reply');
  assert.ok(!html.includes('First question'), 'does not print the earlier question');

  w.window.open = realOpen;
  w.saveAgentChatHistory([]);
});

test('callGeminiAgent maps this app\'s "agent" role to Gemini\'s "model" role in the conversation history', async () => {
  w.localStorage.clear();
  const realFetch = w.fetch;
  let capturedBody = null;
  w.fetch = async (url, opts) => {
    capturedBody = JSON.parse(opts.body);
    return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }) };
  };

  const history = [
    { role: 'user', text: 'hi' },
    { role: 'agent', text: 'hello, how can I help?' },
    { role: 'user', text: 'what next' },
  ];
  await w.callGeminiAgent(history, 'test-key', 'gemini-2.5-flash');

  assert.deepEqual(capturedBody.contents, [
    { role: 'user', parts: [{ text: 'hi' }] },
    { role: 'model', parts: [{ text: 'hello, how can I help?' }] },
    { role: 'user', parts: [{ text: 'what next' }] },
  ]);

  w.fetch = realFetch;
  w.localStorage.clear();
});

test('callGeminiAgent throws a clear error when Gemini returns a non-OK response', async () => {
  w.localStorage.clear();
  const realFetch = w.fetch;
  w.fetch = async () => ({ ok: false, status: 400, json: async () => ({ error: { message: 'API key not valid' } }) });

  await assert.rejects(
    () => w.callGeminiAgent([{ role: 'user', text: 'hi' }], 'bad-key', 'gemini-2.5-flash'),
    /API key not valid/
  );

  w.fetch = realFetch;
  w.localStorage.clear();
});

test('the Model dropdown lists Gemini 2.5 Pro alongside Flash/Flash-Lite, and defaults to Flash', () => {
  const select = w.document.getElementById('agent-model');
  const values = Array.from(select.options).map(o => o.value);
  assert.ok(values.includes('gemini-2.5-pro'));
  assert.ok(values.includes('gemini-2.5-flash'));
  assert.ok(values.includes('gemini-2.5-flash-lite'));
  assert.equal(select.options[0].value, 'gemini-2.5-flash', 'Flash is the first (default-selected) option');
});

test('populateAgentModelSelect selects a listed model directly, and injects a one-off option to preserve a value from before the dropdown existed (or not yet listed here) instead of silently switching models', () => {
  const select = w.document.getElementById('agent-model');

  w.populateAgentModelSelect('gemini-2.5-pro');
  assert.equal(select.value, 'gemini-2.5-pro');
  assert.equal(select.querySelectorAll('option[data-custom]').length, 0);

  w.populateAgentModelSelect('gemini-1.5-flash-legacy');
  assert.equal(select.value, 'gemini-1.5-flash-legacy');
  assert.equal(select.querySelectorAll('option[data-custom]').length, 1);

  // Re-populating with a listed model again cleans up the injected option
  // rather than leaving a stale one behind.
  w.populateAgentModelSelect('gemini-2.5-flash');
  assert.equal(select.value, 'gemini-2.5-flash');
  assert.equal(select.querySelectorAll('option[data-custom]').length, 0);
});

test('fetchAvailableGeminiModels returns only models that support generateContent, with the "models/" prefix stripped', async () => {
  const realFetch = w.fetch;
  let capturedUrl = null;
  w.fetch = async (url) => {
    capturedUrl = url;
    return {
      ok: true, status: 200,
      json: async () => ({
        models: [
          { name: 'models/gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', supportedGenerationMethods: ['generateContent'] },
          { name: 'models/gemini-3.6-flash', displayName: 'Gemini 3.6 Flash', supportedGenerationMethods: ['generateContent'] },
          { name: 'models/embedding-001', displayName: 'Embedding 001', supportedGenerationMethods: ['embedContent'] },
        ],
      }),
    };
  };

  const models = toPlain(await w.fetchAvailableGeminiModels('test-key'));

  assert.ok(capturedUrl.includes('key=test-key'));
  assert.deepEqual(models, [
    { id: 'gemini-2.5-flash', displayName: 'Gemini 2.5 Flash' },
    { id: 'gemini-3.6-flash', displayName: 'Gemini 3.6 Flash' },
  ]);

  w.fetch = realFetch;
});

test('fetchAvailableGeminiModels throws a clear error on a non-OK response (e.g. a bad key)', async () => {
  const realFetch = w.fetch;
  w.fetch = async () => ({ ok: false, status: 400, json: async () => ({ error: { message: 'API key not valid' } }) });

  await assert.rejects(() => w.fetchAvailableGeminiModels('bad-key'), /API key not valid/);

  w.fetch = realFetch;
});

test('refreshAgentModels replaces the dropdown with the real fetched list, so a deprecated hardcoded model can never strand the dropdown on a model Gemini no longer serves', async () => {
  w.localStorage.clear();
  // Already on one of the models the fetch below returns, so nothing gets
  // preserved via the "unknown value" injection — this test is purely
  // about the fetched list replacing the dropdown's options.
  w.localStorage.setItem('quranReviewAgentModel', 'gemini-3.6-flash');
  const realFetch = w.fetch;
  w.document.getElementById('agent-api-key').value = 'test-key';
  w.fetch = async () => ({
    ok: true, status: 200,
    json: async () => ({
      models: [
        { name: 'models/gemini-3.6-flash', displayName: 'Gemini 3.6 Flash', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/gemini-3.6-pro', displayName: 'Gemini 3.6 Pro', supportedGenerationMethods: ['generateContent'] },
      ],
    }),
  });

  await w.refreshAgentModels();

  const select = w.document.getElementById('agent-model');
  const values = Array.from(select.options).map(o => o.value);
  assert.deepEqual(values, ['gemini-3.6-flash', 'gemini-3.6-pro']);
  assert.match(w.document.getElementById('agent-model-refresh-status').textContent, /Loaded 2 available models/);

  w.fetch = realFetch;
  w.document.getElementById('agent-api-key').value = '';
  w.localStorage.clear();
});

test('refreshAgentModels leaves the dropdown untouched and reports the error when the fetch fails, instead of clearing it out', async () => {
  w.localStorage.clear();
  const realFetch = w.fetch;
  w.document.getElementById('agent-api-key').value = 'bad-key';
  w.fetch = async () => ({ ok: false, status: 403, json: async () => ({ error: { message: 'API key not valid' } }) });

  const before = Array.from(w.document.getElementById('agent-model').options).map(o => o.value);
  await w.refreshAgentModels();
  const after = Array.from(w.document.getElementById('agent-model').options).map(o => o.value);

  assert.deepEqual(after, before);
  assert.match(w.document.getElementById('agent-model-refresh-status').textContent, /Couldn't refresh models: API key not valid/);

  w.fetch = realFetch;
  w.document.getElementById('agent-api-key').value = '';
  w.localStorage.clear();
});

test('getAgentPromptPreset defaults to "general" and falls back to it for an unrecognized/legacy value', () => {
  w.localStorage.clear();
  assert.equal(w.getAgentPromptPreset(), 'general');

  w.localStorage.setItem('quranReviewAgentPromptPreset', 'print');
  assert.equal(w.getAgentPromptPreset(), 'print');

  w.localStorage.setItem('quranReviewAgentPromptPreset', 'some-old-unknown-id');
  assert.equal(w.getAgentPromptPreset(), 'general');

  w.localStorage.clear();
});

test('getEffectiveAgentPrompt returns the currently active preset\'s own default text, or that preset\'s own saved override if one exists — never the OTHER preset\'s text or override', () => {
  w.localStorage.clear();
  assert.equal(w.getEffectiveAgentPrompt(), AGENT_SYSTEM_PROMPT_TEXT);

  w.localStorage.setItem('quranReviewAgentPromptOverrides', JSON.stringify({ general: 'Custom general instructions.' }));
  assert.equal(w.getEffectiveAgentPrompt(), 'Custom general instructions.');

  w.localStorage.setItem('quranReviewAgentPromptPreset', 'print');
  assert.equal(w.getEffectiveAgentPrompt(), AGENT_PRINT_SYSTEM_PROMPT_TEXT, 'switching preset falls back to THAT preset\'s own default, not the general override');

  w.localStorage.setItem('quranReviewAgentPromptOverrides', JSON.stringify({ general: 'Custom general instructions.', print: 'Custom print instructions.' }));
  assert.equal(w.getEffectiveAgentPrompt(), 'Custom print instructions.');

  w.localStorage.clear();
});

test('setAgentPromptPreset ignores an unrecognized id (stores "general" instead) and refreshes the open editor to the newly-active preset\'s text', () => {
  w.localStorage.clear();
  w.toggleAgentPromptEditor(); // open it
  w.setAgentPromptPreset('print');
  assert.equal(w.localStorage.getItem('quranReviewAgentPromptPreset'), 'print');
  assert.equal(w.document.getElementById('agent-prompt-textarea').value, AGENT_PRINT_SYSTEM_PROMPT_TEXT);

  w.setAgentPromptPreset('not-a-real-preset');
  assert.equal(w.localStorage.getItem('quranReviewAgentPromptPreset'), 'general');
  assert.equal(w.document.getElementById('agent-prompt-textarea').value, AGENT_SYSTEM_PROMPT_TEXT);

  w.toggleAgentPromptEditor(); // close it again for later tests
  w.localStorage.clear();
});

test('migrateLegacyAgentPromptOverride folds a single-override doc from before presets existed into agentPromptOverrides.general exactly once, then removes the old key', () => {
  w.localStorage.clear();
  w.localStorage.setItem('quranReviewAgentPromptOverride', 'Old-style single override.');

  w.migrateLegacyAgentPromptOverride();

  assert.equal(w.localStorage.getItem('quranReviewAgentPromptOverride'), null);
  assert.deepEqual(JSON.parse(w.localStorage.getItem('quranReviewAgentPromptOverrides')), { general: 'Old-style single override.' });

  // Safe to call again — no-op once already migrated.
  w.migrateLegacyAgentPromptOverride();
  assert.deepEqual(JSON.parse(w.localStorage.getItem('quranReviewAgentPromptOverrides')), { general: 'Old-style single override.' });

  w.localStorage.clear();
});

test('migrateLegacyAgentPromptOverride never overwrites an already-migrated/newer general override with the stale legacy value', () => {
  w.localStorage.clear();
  w.localStorage.setItem('quranReviewAgentPromptOverride', 'Stale legacy text.');
  w.localStorage.setItem('quranReviewAgentPromptOverrides', JSON.stringify({ general: 'Already-current text.' }));

  w.migrateLegacyAgentPromptOverride();

  assert.deepEqual(JSON.parse(w.localStorage.getItem('quranReviewAgentPromptOverrides')), { general: 'Already-current text.' });
  assert.equal(w.localStorage.getItem('quranReviewAgentPromptOverride'), null);

  w.localStorage.clear();
});

test('saveAgentPromptOverride stores a genuinely-edited prompt under the CURRENTLY ACTIVE preset only, but drops it entirely (falling back to that preset\'s default again) once the textarea matches the default verbatim', () => {
  w.localStorage.clear();
  const textarea = w.document.getElementById('agent-prompt-textarea');

  textarea.value = 'A totally different set of instructions.';
  w.saveAgentPromptOverride();
  assert.deepEqual(JSON.parse(w.localStorage.getItem('quranReviewAgentPromptOverrides')), { general: 'A totally different set of instructions.' });
  assert.equal(w.getEffectiveAgentPrompt(), 'A totally different set of instructions.');

  textarea.value = AGENT_SYSTEM_PROMPT_TEXT;
  w.saveAgentPromptOverride();
  assert.deepEqual(JSON.parse(w.localStorage.getItem('quranReviewAgentPromptOverrides')), {});
  assert.equal(w.getEffectiveAgentPrompt(), AGENT_SYSTEM_PROMPT_TEXT);

  // Switching to "print" and saving there must not touch "general" at all.
  w.setAgentPromptPreset('print');
  textarea.value = 'Custom print-only instructions.';
  w.saveAgentPromptOverride();
  assert.deepEqual(JSON.parse(w.localStorage.getItem('quranReviewAgentPromptOverrides')), { print: 'Custom print-only instructions.' });

  w.setAgentPromptPreset('general');
  w.localStorage.clear();
});

test('resetAgentPromptToDefault clears only the active preset\'s own override and restores the textarea to that preset\'s default, after confirming', () => {
  w.localStorage.clear();
  const realConfirm = w.confirm;
  w.localStorage.setItem('quranReviewAgentPromptOverrides', JSON.stringify({ general: 'Something custom.', print: 'Print override kept as-is.' }));
  w.confirm = () => true;

  w.resetAgentPromptToDefault();

  assert.deepEqual(JSON.parse(w.localStorage.getItem('quranReviewAgentPromptOverrides')), { print: 'Print override kept as-is.' });
  assert.equal(w.document.getElementById('agent-prompt-textarea').value, AGENT_SYSTEM_PROMPT_TEXT);

  w.confirm = realConfirm;
  w.localStorage.clear();
});

test('resetAgentPromptToDefault does nothing if the confirm is declined', () => {
  w.localStorage.clear();
  const realConfirm = w.confirm;
  w.localStorage.setItem('quranReviewAgentPromptOverrides', JSON.stringify({ general: 'Something custom.' }));
  w.confirm = () => false;

  w.resetAgentPromptToDefault();

  assert.deepEqual(JSON.parse(w.localStorage.getItem('quranReviewAgentPromptOverrides')), { general: 'Something custom.' });

  w.confirm = realConfirm;
  w.localStorage.clear();
});

test('callGeminiAgent sends the user\'s saved prompt override instead of the default, once one is saved', async () => {
  w.localStorage.clear();
  w.localStorage.setItem('quranReviewAgentPromptOverrides', JSON.stringify({ general: 'MY CUSTOM OVERRIDE TEXT' }));
  const realFetch = w.fetch;
  let capturedBody = null;
  w.fetch = async (url, opts) => {
    capturedBody = JSON.parse(opts.body);
    return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }) };
  };

  await w.callGeminiAgent([{ role: 'user', text: 'hi' }], 'test-key', 'gemini-2.5-flash');

  assert.ok(capturedBody.systemInstruction.parts[0].text.startsWith('MY CUSTOM OVERRIDE TEXT'));
  assert.ok(!capturedBody.systemInstruction.parts[0].text.includes('personal Quran memorization'), 'the default prompt text is NOT also included');

  w.fetch = realFetch;
  w.localStorage.clear();
});

test('updateAgentKeyStatus\'s message reflects whether sync is actually connected, instead of always claiming "this device only" even after the key started syncing', () => {
  w.localStorage.clear();
  w.localStorage.setItem('quranReviewAgentApiKey', 'some-key');
  const realIsSyncConnected = w.isSyncConnected;

  w.isSyncConnected = () => false;
  w.updateAgentKeyStatus();
  assert.match(w.document.getElementById('agent-key-status').textContent, /this device\. Connect to sync/);

  w.isSyncConnected = () => true;
  w.updateAgentKeyStatus();
  assert.match(w.document.getElementById('agent-key-status').textContent, /synced to your account/);

  w.isSyncConnected = realIsSyncConnected;
  w.localStorage.clear();
});

test('applySyncPayload pulls a synced prompt preset choice + per-preset overrides + data-include flags from another device, and updates the visible controls', () => {
  w.localStorage.clear();
  w.applySyncPayload({
    tracker: { memorized: [] },
    review: {
      memorizedHizbs: [], recitationLog: [], ayahMistakes: [], mutashabihatPairs: [], practiceRanges: [],
      telegramLastImportedAt: null, agentApiKey: null, agentModel: null,
      agentPromptPreset: 'print',
      agentPromptOverrides: { print: 'SYNCED PRINT PROMPT' },
      agentIncludeAyahMistakes: 'false', agentIncludeRecitationLog: 'false',
      agentIncludePracticeRanges: 'true', agentIncludeMutashabihat: 'true',
    },
    habits: { activities: [], log: [] },
    updatedAt: Date.now(),
  });

  assert.equal(w.localStorage.getItem('quranReviewAgentPromptPreset'), 'print');
  assert.equal(w.document.getElementById('agent-prompt-preset').value, 'print');
  assert.equal(w.document.getElementById('agent-prompt-textarea').value, 'SYNCED PRINT PROMPT');
  assert.equal(w.getAgentIncludeFlag('ayahMistakes'), false);
  assert.equal(w.getAgentIncludeFlag('recitationLog'), false);
  assert.equal(w.getAgentIncludeFlag('practiceRanges'), true);
  assert.equal(w.getAgentIncludeFlag('mutashabihat'), true);
  assert.equal(w.document.getElementById('agent-include-practiceRanges').checked, true);

  w.localStorage.clear();
});

test('applySyncPayload removes (not blanks) an include-flag key when the incoming doc never set it, so getAgentIncludeFlag falls back to its own default instead of reading as "off"', () => {
  w.localStorage.clear();
  w.saveAgentIncludeFlag('practiceRanges', true); // locally on, before pulling a doc that never mentions it

  w.applySyncPayload({
    tracker: { memorized: [] },
    review: {
      memorizedHizbs: [], recitationLog: [], ayahMistakes: [], mutashabihatPairs: [], practiceRanges: [],
      telegramLastImportedAt: null, agentApiKey: null, agentModel: null,
      agentPromptPreset: null, agentPromptOverrides: {},
    },
    habits: { activities: [], log: [] },
    updatedAt: Date.now(),
  });

  assert.equal(w.localStorage.getItem('quranReviewAgentIncludePracticeRanges'), null, 'key removed, not set to an empty string');
  assert.equal(w.getAgentIncludeFlag('practiceRanges'), false, 'falls back to this flag\'s own default');

  w.localStorage.clear();
});

// ─── parseAgentPromptSections / loadAgentPromptFiles ───────────────────────
// Deliberately placed LAST in this file: the loadAgentPromptFiles tests
// below stub fetch and call the real function, which mutates the shared
// window's AGENT_PROMPT_PRESETS object IN PLACE (there's no way to reset it
// from a test — it's a top-level `let`, invisible to `window`, per this
// suite's own jsdom caveat) — running these after every other test that
// relies on AGENT_PROMPT_FALLBACK being the active text avoids
// contaminating them.

test('parseAgentPromptSections splits on top-level "# Name" headings, case-insensitively by name, ignoring "##" sub-headings inside a section', () => {
  const text = '# Common\n\nshared stuff\n\n# General\n\n## Task\n\ngeneral stuff\n\n# Print\n\nprint stuff\n';
  assert.deepEqual(toPlain(w.parseAgentPromptSections(text)), {
    common: 'shared stuff',
    general: '## Task\n\ngeneral stuff',
    print: 'print stuff',
  });
});

test('parseAgentPromptSections returns an empty object for text with no top-level heading at all', () => {
  assert.deepEqual(toPlain(w.parseAgentPromptSections('just some text, no headings')), {});
});

function stubPromptsMdFetch(text) {
  return async (url) => {
    if (!url.startsWith('agent-prompts/prompts.md')) throw new Error(`unexpected fetch: ${url}`);
    return { ok: true, text: async () => text };
  };
}

test('loadAgentPromptFiles fetches the single prompts.md file and prepends its Common section to both presets', async () => {
  w.localStorage.clear();
  const realFetch = w.fetch;
  w.fetch = stubPromptsMdFetch('# Common\n\n  Shared data format.  \n\n# General\n\nReal general prompt from disk.\n\n# Print\n\nReal print prompt from disk.\n');

  await w.loadAgentPromptFiles();

  assert.equal(w.getEffectiveAgentPrompt(), 'Shared data format.\n\nReal general prompt from disk.', 'trimmed, Common section prepended, and the "general" preset is active by default');
  w.setAgentPromptPreset('print');
  assert.equal(w.getEffectiveAgentPrompt(), 'Shared data format.\n\nReal print prompt from disk.');

  w.setAgentPromptPreset('general');
  w.fetch = realFetch;
  w.localStorage.clear();
});

test('loadAgentPromptFiles leaves a preset untouched if the file has no section for it, without affecting the other preset', async () => {
  w.localStorage.clear();
  const realFetch = w.fetch;
  // Establish a known baseline for "print" first (a previous test in this
  // file may have already mutated it via its own successful fetch —
  // AGENT_PROMPT_PRESETS is shared, mutated-in-place state with no way to
  // reset it from a test) so this test doesn't depend on what ran before it.
  w.fetch = stubPromptsMdFetch('# Common\n\nShared.\n\n# General\n\nOld general.\n\n# Print\n\nKnown baseline print prompt.\n');
  await w.loadAgentPromptFiles();
  w.setAgentPromptPreset('print');
  assert.equal(w.getEffectiveAgentPrompt(), 'Shared.\n\nKnown baseline print prompt.');

  // This "edit" only has a General section — a typo'd/removed "# Print"
  // heading should never blank out the print preset.
  w.fetch = stubPromptsMdFetch('# Common\n\nShared.\n\n# General\n\nFreshly loaded general prompt.\n');
  await w.loadAgentPromptFiles();

  assert.equal(w.getEffectiveAgentPrompt(), 'Shared.\n\nKnown baseline print prompt.', 'print keeps its last known-good value since this fetch had no Print section');
  w.setAgentPromptPreset('general');
  assert.equal(w.getEffectiveAgentPrompt(), 'Shared.\n\nFreshly loaded general prompt.');

  w.fetch = realFetch;
  w.localStorage.clear();
});

test('loadAgentPromptFiles leaves both presets untouched when the fetch itself fails outright (network error or non-OK), instead of erasing a working prompt', async () => {
  w.localStorage.clear();
  const realFetch = w.fetch;
  w.fetch = stubPromptsMdFetch('# Common\n\nShared.\n\n# General\n\nKnown baseline general prompt.\n\n# Print\n\nKnown baseline print prompt.\n');
  await w.loadAgentPromptFiles();
  assert.equal(w.getEffectiveAgentPrompt(), 'Shared.\n\nKnown baseline general prompt.');

  w.fetch = async () => { throw new Error('network error'); };
  await w.loadAgentPromptFiles();
  assert.equal(w.getEffectiveAgentPrompt(), 'Shared.\n\nKnown baseline general prompt.', 'a thrown network error leaves the last known-good text in place');

  // A non-OK response (e.g. a 404 for a typo'd filename) is treated the
  // same as a thrown network error — left untouched, not blanked.
  w.fetch = async () => ({ ok: false, status: 404, text: async () => '' });
  await w.loadAgentPromptFiles();
  assert.equal(w.getEffectiveAgentPrompt(), 'Shared.\n\nKnown baseline general prompt.', 'a 404 does not erase the last successfully-loaded text');

  w.fetch = realFetch;
  w.localStorage.clear();
});

test('loadAgentPromptFiles cache-busts its fetch — a real report had an edited prompt file not show up on the live site, indistinguishable from a browser/CDN serving a stale cached copy', async () => {
  w.localStorage.clear();
  const realFetch = w.fetch;
  const fetchedUrls = [], fetchedOptions = [];
  w.fetch = async (url, options) => {
    fetchedUrls.push(url);
    fetchedOptions.push(options);
    return { ok: true, text: async () => '# Common\n\nx\n\n# General\n\ny\n\n# Print\n\nz\n' };
  };

  await w.loadAgentPromptFiles();

  assert.equal(fetchedUrls.length, 1, 'a single fetch for the one shared file');
  assert.match(fetchedUrls[0], /^agent-prompts\/prompts\.md\?_=\d+$/, 'a fresh cache-busting query param');
  assert.deepEqual(toPlain(fetchedOptions[0]), { cache: 'no-store' });

  w.fetch = realFetch;
  w.localStorage.clear();
});
