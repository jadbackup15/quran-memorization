---
name: add-parser
description: Checklist skill for adding a new text parser to the Quran Review app's paste/Telegram import pipeline. Covers the parser function itself, looksLikeAyahLogMessage extension, dedup function, integration into importAyahMistakesFromText and processTelegramLogMessages (which covers both live Telegram and export), the "nothing left" gate, and test cases. Prevents missing integration points that cause silent data loss.
user-invocable: true
allowed-tools:
  - Read
  - Bash
  - Edit
---

# /add-parser — Add a New Text Parser

Guides adding a new independent text parser to the paste/Telegram import
pipeline. The app currently has five parsers (`parseAyahMistakesText`,
`parsePageFlagsText`, `parseHizbCleanSessionFlagsText`,
`parsePracticeRangeFlagsText`, `parseMutashabihatFlagsText`) that each run
as a **separate, independent pass** over the same text. A sixth parser follows
the same contract. Missing any one integration point causes silent data loss —
the parser runs but nothing ever saves.

Arguments passed: `$ARGUMENTS`

Parse `$ARGUMENTS` for the parser name/feature (e.g. `"memorization progress"`
or `"homework flag"`).

---

## Step 0 — Read existing parsers for the pattern

Read the parser block to understand the structure before adding anything:

```bash
grep -n "^function parse\|^function looksLike\|^function importAyahMistakes\|^async function processTelegramLog" review.html
```

Read `looksLikeAyahLogMessage()` in full — it's the gatekeeper that filters
which Telegram messages are even parsed. Read `importAyahMistakesFromText()`
to see how parallel parse results are combined and confirmed.

---

## Step 1 — Design the line syntax

Decide the line format BEFORE writing code. Rules that have kept this codebase
safe:

1. **Never start with a digit.** `parseAyahMistakesText` owns every digit-
   leading line. A new parser with a digit-leading format would silently
   conflict. Use a single letter prefix: `h<N>`, `p<N>`, `r<M-K>`, `m<N>`.

2. **Never overlap with existing prefixes.** Check:
   ```bash
   grep -n "SURAH_CLOSE_PATTERN\|/^h\b/\|/^p\(/\|/^r\(/\|/^m\(" review.html | head -20
   ```

3. **Accept smart-punctuation and Arabic-Indic digits.** Any separator (dash,
   colon) must match ALL lookalike variants. See the en-dash incident in
   `parsePracticeRangeFlagsText`'s own comment — a message typed as `"r81–88x15"`
   with an en dash silently disappeared from every parser because the regex only
   matched ASCII `-`. Pattern for a range separator:
   ```js
   [-–—−]   // hyphen-minus, en dash, em dash, minus sign
   ```
   Call `normalizeArabicIndicDigits(text)` at the **top** of the function —
   every parser does this, never inside the per-line loop.

4. **Accept trailing notes.** Anything after the structured part is a freeform
   note: `(.*)$` at the end of the regex, trimmed.

---

## Step 2 — Write the parser function

Place it adjacent to the other parsers (after `parsePracticeRangeFlagsText`,
before `parseMutashabihatFlagsText` or wherever fits logically).

Template:
```js
// "<prefix>N" lines (case-insensitive) — <description of what this creates>.
// An "<prefix>N" line never starts with a digit, so parseAyahMistakesText
// already ignores it on its own, and this shape fits none of the other parsers.
// Uses normalizeArabicIndicDigits at the top, same as every other parser.
function parse<Feature>FlagsText(text) {
  const results = [];
  normalizeArabicIndicDigits(text).split('\n').map(l => l.trim()).forEach(line => {
    const match = line.match(/^<prefix>(\d+)(?:\s+(.*))?$/i);
    if (!match) return;
    const value = parseInt(match[1]);
    const note = (match[2] || '').trim();
    results.push({ value, note });
  });
  return results;
}
```

If the parser is surah-contextual (needs to track an active surah across
lines, like `parsePracticeRangeFlagsText`):
```js
function parse<Feature>FlagsText(text, initialSurah) {
  let activeSurah = initialSurah || null;
  const results = [];
  normalizeArabicIndicDigits(text).split('\n').map(l => l.trim()).forEach(line => {
    if (SURAH_CLOSE_PATTERN.test(line)) { activeSurah = null; return; }
    const overrideMatch = line.match(/^(\d+):/);
    if (overrideMatch) { activeSurah = parseInt(overrideMatch[1]); return; }
    const match = line.match(/^<prefix>(\d+)(?:\s+(.*))?$/i);
    if (!match) return;
    results.push({ surah: activeSurah, value: parseInt(match[1]), note: (match[2] || '').trim() });
  });
  return results;
}
```

---

## Step 3 — Extend `looksLikeAyahLogMessage()`

Find `function looksLikeAyahLogMessage(text)` and add recognition of the new
line format. This function is the gatekeeper for which Telegram messages are
treated as log data at all — a message that only contains your new line type
would otherwise be silently skipped on every import run.

```js
function looksLikeAyahLogMessage(text) {
  const normalized = normalizeArabicIndicDigits(text);
  return (
    // ... existing checks ...
    /^<prefix>\d+/im.test(normalized)   // ← add your new prefix here
  );
}
```

---

## Step 4 — Write the dedup function

Every parser needs a dedup function that checks whether a candidate already
exists in localStorage, so re-running import never creates duplicates but
deleting an entry and re-running DOES bring it back (existence-based, not
cursor-based).

```js
function telegram<Feature>Exists(telegramMessageId, value) {
  return load<Feature>s().some(x =>
    x.telegramMessageId === telegramMessageId && x.value === value
  );
}
```

Key fields for the identity check: `telegramMessageId` (always) + whatever
uniquely identifies this candidate within a message (the value, ayah number,
range, etc.). Do NOT include mutable fields (note, target, practiced count).

---

## Step 5 — Wire into `importAyahMistakesFromText()`

Find `function importAyahMistakesFromText(text, surah)`. This handles the
manual paste-import textarea. Add your parser as a **parallel, independent
pass**:

**Parse (near the top of the function, after existing parse calls):**
```js
const all<Feature>Candidates = parse<Feature>FlagsText(text);
const new<Feature>s = all<Feature>Candidates.filter(c => /* not already saved */);
```

**"Nothing left" gate** — find the condition that alerts "Nothing left to add"
and extend it:
```js
if (newMistakes.length === 0 && newPageFlags.length === 0 &&
    cleanNewSessions.length === 0 && newPracticeRanges.length === 0 &&
    validMutashabihat.length === 0 && new<Feature>s.length === 0) {  // ← add
  alert('Nothing left to add...');
  return false;
}
```

**Confirm dialog summary** — add a line summarising what will be added:
```js
if (new<Feature>s.length > 0) summaryParts.push(`add ${new<Feature>s.length} <feature>(s)`);
```

**Save (after the confirm):**
```js
if (new<Feature>s.length > 0) {
  save<Feature>s([...load<Feature>s(), ...new<Feature>s.map(c => ({
    id: generateId(),
    ...c,
    source: MISTAKE_SOURCE.PASTE,
    dateAdded: today.toISOString(),
  }))]);
}
```

---

## Step 6 — Wire into `processTelegramLogMessages()`

Find `async function processTelegramLogMessages(logMessages, emptyMessage)`.
This single function is used by BOTH the live Telegram fetch AND the JSON
export import — wiring it here covers both paths automatically.

**Parse (near the top of the per-message loop):**
```js
const all<Feature>Candidates = [];
// ... per-message loop ...
  const msgCandidates = parse<Feature>FlagsText(msg.text);
  msgCandidates.forEach(c => all<Feature>Candidates.push({
    ...c,
    telegramMessageId: msg.id,
    telegramDate: new Date(msg.date * 1000),
  }));
```

**Dedup:**
```js
const new<Feature>Candidates = all<Feature>Candidates.filter(c =>
  !telegram<Feature>Exists(c.telegramMessageId, c.value)
);
```

**"Nothing new" gate** — add to both empty-result conditions in the function:
```js
if (newCandidatesBeforeReview.length === 0 && newPageCandidates.length === 0 &&
    potentialCleanNewSessions.length === 0 && newPracticeRangeCandidates.length === 0 &&
    new<Feature>Candidates.length === 0) {   // ← add
  // nothing new
}
```

**Confirm dialog summary:**
```js
if (new<Feature>Candidates.length > 0)
  importSummaryParts.push(`add ${new<Feature>Candidates.length} <feature>(s)`);
```

**Save:**
```js
if (new<Feature>Candidates.length > 0) {
  save<Feature>s([...load<Feature>s(), ...new<Feature>Candidates.map(c => ({
    id: generateId(),
    ...c,
    source: MISTAKE_SOURCE.TELEGRAM,
    telegramMessageId: c.telegramMessageId,
    dateAdded: new Date(c.telegramDate).toISOString(),
  }))]);
}
```

---

## Step 7 — Verify `importMistakesFromTelegramExport()` is covered

Check that it calls `processTelegramLogMessages` (not a parallel implementation):
```bash
grep -n "processTelegramLogMessages" review.html
```

If the export function calls `processTelegramLogMessages`, step 6 already
covers it — no extra work needed. If it has its own separate save logic,
replicate the wiring there too.

---

## Step 8 — Handle surah prompts (if surah-contextual)

If the new parser is surah-contextual (needs an active surah), extend the
`needsSurah` check inside `processTelegramLogMessages`'s per-message loop:

```js
const needsSurah = parseAyahMistakesText(msg.text, trialSurah).some(e => !e.surah)
  || parsePracticeRangeFlagsText(msg.text, trialSurah).some(r => !r.surah)
  || parse<Feature>FlagsText(msg.text, trialSurah).some(c => !c.surah);  // ← add
```

And extend `knownSurahForMessage()` to also check the new data store for a
prior entry from this `telegramMessageId`, so already-answered messages don't
re-prompt:
```js
// check practiceRanges, then check <Feature>s
|| load<Feature>s().find(x => x.telegramMessageId === messageId)?.surah
```

---

## Step 9 — Write tests

In `test/review-helpers.test.js`, add:

1. **Happy path** — parse a correctly-formatted line, confirm the output shape.
2. **Smart-punctuation dash** (if the parser uses a separator) — the en-dash
   incident was real; test `"<prefix>15–20"` alongside `"<prefix>15-20"`.
3. **Arabic-Indic digits** — test `"<prefix>١٥"` produces `value: 15`.
4. **Dedup** — confirm `telegram<Feature>Exists()` returns true after saving
   one candidate, false for a different messageId.
5. **Nothing-left gate** — confirm `importAyahMistakesFromText()` returns false
   (no alert/save) when the only input is a line that already exists.

---

## Step 10 — Bump version and commit

A new parser changes parsing behaviour — bump `version.js` and `sw.js` to the
next patch, commit `review.html` plus the test file.

---

## Quick checklist

```
[ ] Line syntax chosen — letter prefix, no digit start, no overlap with existing
[ ] normalizeArabicIndicDigits called at top of parser
[ ] Smart-punctuation separator variants in regex ([-–—−])
[ ] Trailing note captured (.*)
[ ] looksLikeAyahLogMessage() extended
[ ] Dedup function written (telegramMessageId + identity fields only)
[ ] importAyahMistakesFromText() wired (parse + dedup + nothing-left gate + confirm + save)
[ ] processTelegramLogMessages() wired (parse + dedup + nothing-new gate + confirm + save)
[ ] importMistakesFromTelegramExport() covered (via processTelegramLogMessages, verified)
[ ] Surah prompt extended (if surah-contextual)
[ ] knownSurahForMessage extended (if surah-contextual)
[ ] Tests: happy path, en-dash, Arabic-Indic, dedup, nothing-left gate
[ ] Version bumped
```
