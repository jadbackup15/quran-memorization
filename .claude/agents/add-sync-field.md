---
name: add-sync-field
description: Checklist skill for adding a new data field to the Quran Review app that persists in localStorage and syncs across devices via Firebase. Covers all required touchpoints — localStorage key, getter/setter, buildSyncPayload, applySyncPayload, normalizeSyncPayload, buildFullLogData/applyFullLogData in log.js, migration function, and tests. Prevents the recurring bug where a field gets added to sync but silently dropped from JSON backup or vice versa.
user-invocable: true
allowed-tools:
  - Read
  - Bash
  - Edit
---

# /add-sync-field — Add a Synced Data Field

Guides adding a new persistent field to the review.html ecosystem correctly. The
most common source of bugs in this codebase is adding a field to ONE of the
required touchpoints but not the others — e.g. adding it to Firebase sync but
forgetting the JSON backup, causing silent data loss on backup/restore. This
skill ensures all touchpoints are hit in the right order.

Arguments passed: `$ARGUMENTS`

Parse `$ARGUMENTS` for the field name (e.g. `practiceStreakCount`) and any
flags:
- `--firebase-only` — field is a credential or non-portable setting (API key,
  model choice); include in Firebase sync but NOT in the JSON backup file.
- `--backup-only` — field is pure user data with no real-time sync value; include
  in JSON backup but NOT in Firebase. (Rare — most fields belong in both.)
- Default (no flag): include in both Firebase sync AND the JSON backup.

---

## Step 0 — Read current state

Read these sections before making any changes:

1. `review.html` lines 4570–4900: the sync constants block, `buildSyncPayload()`,
   `normalizeSyncPayload()`, and `applySyncPayload()`.
2. `log.js` lines 87–300: `buildFullLogData()` and `applyFullLogData()`.
3. Search for existing localStorage keys to understand the naming convention:
   ```bash
   grep -n "const .*_KEY = 'quranReview" review.html | head -30
   ```
4. Search for any EXISTING usage of the field name to understand its current state:
   ```bash
   grep -n "<fieldName>" review.html log.js
   ```

---

## Step 1 — Decide the field's category

Answer these questions before writing any code:

**Is it user data** (mistakes, sessions, practice ranges, mutashabihat,
memorized Hizbs, habits, tracker data)?
→ Include in **both** Firebase sync AND `buildFullLogData()`/`applyFullLogData()`.

**Is it a credential** (Gemini API key, passcode)?
→ Firebase sync **only** — never in the JSON backup file. A downloaded file is
far more likely to be shared/committed by accident than a Firestore doc gated
behind a private account name.

**Is it a device-agnostic setting** (prompt override, model choice, preset
selection, data-include toggles)?
→ Firebase sync **only** — it's real convenience to sync settings across devices,
but the JSON backup is scoped to recitation data, not app configuration.

**Is it device-local bookkeeping** (quran-cache IndexedDB, Telegram fetch
staleness trip-wire)?
→ **Neither** — don't add it to either sync path.

The check that caught `telegramLastImportedAt` missing from the JSON backup the
first time: after implementing, run
`buildFullLogData()` and `buildSyncPayload()` from the same seeded localStorage
and diff their `review` key sets — they must match field-for-field for every
user-data field.

---

## Step 2 — Add the localStorage key constant

In `review.html`, in the block of `const *_KEY` constants near the relevant
feature (search for nearby constants), add:

```js
const <FEATURE_NAME>_KEY = 'quranReview<FeatureName>';
```

Naming convention: always `quranReview` prefix + PascalCase feature name.
Examples: `quranReviewAgentLastResponse`, `quranReviewTelegramLastImportedAt`.

---

## Step 3 — Add getter and setter functions

**Getter** (if the field needs computed access beyond raw localStorage):
```js
function get<FeatureName>() {
  return localStorage.getItem(<FEATURE_NAME>_KEY) || null;
}
```

**Setter** — always bump sync and push after writing:
```js
function save<FeatureName>(value) {
  localStorage.setItem(<FEATURE_NAME>_KEY, value);
  bumpSyncUpdatedAt();
  syncPush();
}
```

If the setter is `async` (e.g. it awaits `syncPush()` to confirm the round-trip
before showing a success message), mark it `async` and `await syncPush()`. Most
setters are fire-and-forget (`syncPush()` without await).

---

## Step 4 — Add to `buildSyncPayload()` (Firebase sync, write side)

In `review.html`, find `function buildSyncPayload()` and add the field to the
correct section (`review`, `tracker`, or `habits`):

```js
review: {
  // ... existing fields ...
  <fieldName>: localStorage.getItem(<FEATURE_NAME>_KEY) || null,
}
```

Use `|| null` (not `|| ''`) unless the empty-string distinction matters. Null
is the canonical "never set" sentinel.

**If the field is an object/array** (e.g. `agentPromptOverrides`):
```js
<fieldName>: JSON.parse(localStorage.getItem(<FEATURE_NAME>_KEY) || 'null'),
```

---

## Step 5 — Add to `normalizeSyncPayload()` (legacy shape upgrade)

In `review.html`, find `function normalizeSyncPayload(remote)`. This function
upgrades old Firestore docs (pushed before the current schema) to the current
shape, so a pull from an old doc doesn't wipe a field that simply didn't exist
yet.

Add a fallback so a missing field never lands as `undefined`:
```js
review: {
  // ... existing fields ...
  <fieldName>: remote.review?.<fieldName> ?? null,
}
```

If migrating from an old flat shape (old docs had `remote.<fieldName>` at the
top level instead of `remote.review.<fieldName>`), handle both:
```js
<fieldName>: remote.review?.<fieldName> ?? remote.<fieldName> ?? null,
```

---

## Step 6 — Add to `applySyncPayload()` (Firebase sync, read side)

In `review.html`, find `function applySyncPayload(rawRemote)` and add the
localStorage write for the field:

```js
if (remote.review.<fieldName> != null) {
  localStorage.setItem(<FEATURE_NAME>_KEY, remote.review.<fieldName>);
} else {
  localStorage.removeItem(<FEATURE_NAME>_KEY);
}
```

**Never write `|| ''` here** — writing an empty string for a field that simply
wasn't in the remote doc would cause `getAgentIncludeFlag()`-style readers that
treat absent vs. `''` differently to break. Use `removeItem` for absent, so the
local code falls through to its own default correctly.

**For object/array fields:**
```js
if (remote.review.<fieldName> != null) {
  localStorage.setItem(<FEATURE_NAME>_KEY, JSON.stringify(remote.review.<fieldName>));
} else {
  localStorage.removeItem(<FEATURE_NAME>_KEY);
}
```

---

## Step 7 — Add to `buildFullLogData()` in `log.js` (JSON backup, write side)

**Skip this step if `--firebase-only` was passed.**

In `log.js`, find `function buildFullLogData()` and add to the `review` object:

```js
review: {
  // ... existing fields ...
  <fieldName>: localStorage.getItem(<FEATURE_NAME>_KEY) || null,
}
```

Format dates the same human-readable way as other dates in this file (`new
Date(x).toISOString()` or a pre-formatted string). Never store raw epoch
integers in the JSON backup — it's meant to be hand-editable.

---

## Step 8 — Add to `applyFullLogData()` in `log.js` (JSON backup, read side)

**Skip this step if `--firebase-only` was passed.**

In `log.js`, find `function applyFullLogData(data)` and add the localStorage
write, following the same guard pattern as other fields there:

```js
if (data.review?.<fieldName] != null) {
  const parsed = new Date(data.review.<fieldName>);
  if (!isNaN(parsed)) {
    localStorage.setItem(<FEATURE_NAME>_KEY, parsed.toISOString());
  }
}
```

For non-date fields, skip the parse/NaN guard:
```js
if (data.review?.<fieldName> != null) {
  localStorage.setItem(<FEATURE_NAME>_KEY, String(data.review.<fieldName>));
}
```

The independence of each field ("only present fields get written, absent ones
left untouched") is what makes single-section exports (e.g. "Save Mutashabihat
as JSON") safe to re-import without wiping other data.

---

## Step 9 — Write a migration function (if replacing a legacy key)

If the field was previously stored under a different localStorage key (e.g.
renaming from `quranReviewOldKey` to the new name), write a one-time migration:

```js
function migrateLegacy<FeatureName>() {
  const old = localStorage.getItem('quranReviewOldKey');
  if (!old) return;
  if (!localStorage.getItem(<FEATURE_NAME>_KEY)) {
    localStorage.setItem(<FEATURE_NAME>_KEY, old);
  }
  localStorage.removeItem('quranReviewOldKey');
}
```

Call it from the existing on-load migration block (search for
`repairImportedMistakeHizbs()` to find where migrations run). Always safe to
call every page load — a no-op once already migrated.

---

## Step 10 — Verify field parity

After all edits, run this check to confirm the `review` key sets match between
both output shapes:

```bash
grep -A 40 "function buildSyncPayload" review.html | grep -E "^\s+\w+:"
grep -A 40 "function buildFullLogData" log.js | grep -E "^\s+\w+:"
```

The two lists must contain the same field names for every user-data field. Any
field in one but not the other is a bug. (Credentials and settings are
intentionally only in the Firebase path — those are the expected exceptions.)

---

## Step 11 — Add a test

In `test/review-helpers.test.js` or `test/log.test.js`, add at minimum:

1. **Round-trip test**: call the setter, then `buildSyncPayload()`, confirm the
   field appears with the right value; then `applySyncPayload()` (after wiping
   localStorage) and confirm the value is restored.
2. **Missing-field safety**: call `applySyncPayload()` with a doc that lacks
   the field; confirm the local key is removed (not set to `undefined` or `''`).
3. **JSON backup round-trip** (if included): call `buildFullLogData()`, then
   `applyFullLogData()` on a fresh window, confirm the value survives.

---

## Step 12 — Bump version and commit

This is a behaviour change — bump `version.js` and `sw.js` to the next patch
(`v3` segment), commit both files plus `review.html` and `log.js`.

---

## Common mistakes to avoid

| Mistake | Consequence |
|---|---|
| Writing `|| ''` in `applySyncPayload` for an absent field | Callers that distinguish absent vs. `''` get a wrong `false`/default |
| Adding to `buildSyncPayload` but not `buildFullLogData` | Field silently missing from JSON backup |
| Adding to `buildFullLogData` but not `normalizeSyncPayload` | Old Firestore docs wipe the field on pull |
| Forgetting `bumpSyncUpdatedAt()` in the setter | Firebase push happens but the `updatedAt` timestamp doesn't advance, so conflict detection breaks |
| Storing epoch int in JSON backup | Not hand-editable; different from every other date in the file |
