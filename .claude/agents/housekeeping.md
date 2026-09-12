---
name: housekeeping
description: Routine maintenance for the Quran Review app — log health, test suite health + relevance audit, stable version tracking, version consistency, quick UX structural check, and sync field audit. Produces a tiered report (Must Have / Good to Have / Need User Input) and carries unresolved items forward to the next run. Run weekly or after a burst of commits.
user-invocable: true
allowed-tools:
  - Read
  - Bash
  - Write
  - Edit
---

# /housekeeping — Quran Review App Routine Maintenance

Runs a structured set of quick checks, auto-fixes the safe ones, and produces
a tiered report. Unresolved items are written to `.claude/housekeeping-deferred.md`
and re-surfaced at the top of the next run so nothing gets dropped.

Arguments passed: `$ARGUMENTS`

Parse `$ARGUMENTS`:
- `--set-stable <version>` (e.g. `--set-stable 5.57.0`) → manually pin that
  version as stable, regardless of how many days it has been running.
- `--defer-all` → skip all auto-fixes this run; report only and defer everything.
- No args → full run with auto-fixes for safe items.

Working directory is the repo root (`/Users/jadnaja/Documents/projects/Quran_memorization`
or wherever the repo is checked out — use `git rev-parse --show-toplevel` if needed).

---

## Persistent state files

Both live inside `.claude/` which is gitignored (verify: check `.gitignore` for
`.claude/` or add it if missing). Create them on first run if absent.

- `.claude/housekeeping-stable.md` — current stable version record
- `.claude/housekeeping-deferred.md` — unresolved items from last run

`.claude/housekeeping-stable.md` format (plain key: value, one per line):
```
commit: <40-char hash>
version: <version string, e.g. 5.56.2>
pinned: <ISO date, e.g. 2026-09-13>
subject: <full git commit subject>
lines: <wc -l of review.html at pin time>
last_run: <ISO date of most recent housekeeping run>
```

---

## Step 0 — Read persistent state

1. Attempt to read `.claude/housekeeping-deferred.md`. If it exists and is non-empty,
   store its content to show in the "Carried Over" section. If absent or empty, note
   "Nothing deferred from last run."

2. Attempt to read `.claude/housekeeping-stable.md`. If it exists, parse the key:value
   pairs into a `stored_stable` object (commit hash, version, pinned date, lines count).
   If absent, `stored_stable = null`.

3. Read `version.js` to get `current_version` (the value of `APP_VERSION`).
   Read `sw.js` to get `cache_name` (the value of `CACHE_NAME`).

4. Run `git log --format='%H %ct %s' | head -1` to get the latest commit.

---

## Step 1 — Log Health Check

### Browser dev log (`logs/app.log`)

Run: `wc -l logs/app.log 2>/dev/null || echo "0 (not found)"`

Run: `grep -cE '\[WARN\s*\]|\[ERROR\s*\]' logs/app.log 2>/dev/null || echo 0`

If WARN or ERROR lines exist:
- Show the 10 most recent: `grep -E '\[WARN\s*\]|\[ERROR\s*\]' logs/app.log | tail -10`
- Any ERROR line → add to **Must Have**: "Browser log contains N error(s) — see lines above."
- Any WARN line → add to **Good to Have**: "Browser log contains N warning(s)."

If the file doesn't exist or has 0 lines: note "logs/app.log is empty or absent."

### Telegram bot logs (`telegram-bot/logs/`)

Check if `telegram-bot/logs/` exists.

If YES: check `warn.log` and `error.log` inside it:
- `wc -l telegram-bot/logs/error.log 2>/dev/null`
- `tail -10 telegram-bot/logs/error.log 2>/dev/null`
- Any error lines → **Must Have**: "Bot error log contains N error(s) — see lines above."
- Any warn lines → **Good to Have**.

If NO: note "Bot has not run on this machine — no bot logs to check."

**Auto-fix**: None for this step.

---

## Step 2 — Test Suite

Run: `npm test 2>&1`

Parse the output for:
- `ℹ pass N` → pass count
- `ℹ fail N` → fail count
- Lines starting with `✖` → list of failing test names

If **fail count = 0**: add "✅ Tests: all N pass" to the All Clear section.

If **fail count > 0**: add to **Must Have**:
```
Tests: N failing (N passing)
Failing tests:
  - <test name 1>
  - <test name 2>
  ...
```

**Important context for the first run**: 37 tests are currently failing, all in
`importMistakesFromTelegram` retry behavior. If the fail count is still exactly 37
and all failing test names contain "importMistakesFromTelegram", note:
"Pre-existing failure set (37 tests, Telegram retry behavior) — not a regression."
If the count has changed or new test names appear outside that group, flag accordingly.

**Auto-fix**: None (test failures require investigation).

---

## Step 2b — Test Relevance Audit

A deeper pass over the test files to ask: are the right things tested? This runs
after Step 2's pass/fail count is established. Read all files in `test/` and run
three checks.

### Check A — Orphaned tests (testing removed functions or pages)

First, check which HTML pages still exist: `ls *.html`

For each test file that calls `loadPage('<page>')` for a page that no longer exists:
→ flag as **Good to Have**: "Delete `test/<file>` — it loads `<page>` which no
longer exists in the project."

For remaining tests: for each `test('...', ...)` block, look at which source function
is under test (usually named in the description). Spot-check a sample of 10–15 test
descriptions against the source:
```bash
grep -n "^test(" test/review-helpers.test.js | head -20
```
For any test whose description mentions a specific function name (`functionName()`),
verify that function still exists:
```bash
grep -rn "function <name>" review.html log.js mistake-analytics.js quran-data.js
```
If the function is gone → **Need User Input**: "Test `<description>` appears to test
`<function>` which can no longer be found in source — delete or update?"

### Check B — Recently changed functions with no test coverage

Find functions added or significantly changed in the last 10 commits:
```bash
git diff HEAD~10..HEAD -- review.html log.js mistake-analytics.js \
  | grep '^+function \|^+async function ' \
  | grep -oP '(?<=function )\w+' | sort -u
```

For each function name, check if it appears in any test file:
```bash
grep -rl "<functionName>" test/
```

If a recently added function has NO test mention AND it's a pure utility (takes
arguments, returns a value, no DOM manipulation or network calls): add to
**Good to Have**: "New function `<name>` has no test — it looks testable. Consider
adding a case to `test/review-helpers.test.js`."

Limit to the last 10 commits only — this surfaces actionable new gaps, not historical
debt across the whole codebase.

### Check C — Coverage breadth overview

Print a quick coverage map:

| Source file | Test file | Status |
|---|---|---|
| `review.html` | `review-helpers.test.js` | ✅ / gaps |
| `log.js` | `log.test.js` | ✅ |
| `mistake-analytics.js` | `review-helpers.test.js` | ✅ |
| `quran-data.js` | `data-consistency.test.js` | ✅ |
| `hizb.html` | `hizb-page.test.js` | ✅ / stale if page removed |
| `habits.html` | `habits-helpers.test.js` | stale if page removed |

Flag any source file with no corresponding test as **Good to Have**.

### Output for Step 2b

```
## Test Relevance
| Finding              | Count | Detail                                  |
|---------------------|-------|-----------------------------------------|
| Orphaned test files  | N     | <file> loads <removed page>             |
| Orphaned test cases  | N     | test for <missing function>             |
| Untested new fns     | N     | <name>() added in last 10 commits       |
```

---

## Step 3 — Stable Version Tracking

A version is **stable** when its version number (the full `APP_VERSION` string,
e.g. `5.57.0`) has not changed for at least **2 days**. Only changes to
`version.js` start the stability clock — non-version commits (docs, CLAUDE.md,
skill files, bot-only changes) do not affect it.

The threshold is 2 days because patch bumps (the most frequent change, the
last field in v1.v2.v3) are small; 2 days of no further bumps is enough to call
a version settled. A major or minor bump uses the same threshold — those just
happen less often.

### Find the current version's age

`current_version` is already read from `version.js` in Step 0.

Find the commit that last touched `version.js`:
```bash
read VERSION_HASH VERSION_CT VERSION_SUBJECT \
  <<< $(git log --format='%H %ct %s' -- version.js | head -1)
```

Compute age in whole days:
```bash
now=$(date +%s)
age_days=$(( (now - VERSION_CT) / 86400 ))
```

### Determine stability

**Stable threshold**: `age_days >= 2`

If `--set-stable <version>` was passed:
- Find the commit where `version.js` was set to that version:
  ```bash
  git log --format='%H %ct %s' -- version.js | grep "<version>" | head -1
  ```
- Use that commit regardless of age.
- Note: "Stable version manually pinned to `<version>` as requested."

Otherwise:

- If `age_days < 2`: note "`<current_version>` is `age_days` day(s) old — not
  yet stable (threshold: 2 days). Stable version unchanged: `<stored_version>`."
  Skip writing the stable file.

- If `age_days >= 2`:
  - If `stored_stable` is null OR `stored_stable.version ≠ current_version`:
    - `new_stable = current_version`, `new_stable_hash = VERSION_HASH`
    - Report: "Stable version **advanced**: `<old>` → `<current_version>`
      (version has been at `<current_version>` for `age_days` days)"
    - (Or "Stable version **set for the first time**: `<current_version>`".)
  - If `stored_stable.version = current_version`: report "Stable version
    **unchanged**: `<current_version>` (stable for `age_days` days)."

### Show commits after stable

Run: `git log --oneline <stable_hash>..HEAD` to list commits since stable.

Show:
```
Commits since stable (<version>): N total
  - <hash> <subject>
  ...
```

If any of these commits bumped `version.js` to a NEW version that is itself
≥2 days old (i.e. the latest `version.js` change isn't the one that set
`current_version`), flag **Good to Have**: "A newer version exists that is
already ≥2 days old — run `/housekeeping` again or use `--set-stable <version>`
to advance stable."

### Write stable file

Write `.claude/housekeeping-stable.md` with the current (possibly updated) values.
Get the current review.html line count: `wc -l review.html | awk '{print $1}'`

---

## Step 4 — Version Consistency Check

`current_version` is from Step 0 (e.g. `5.56.2`).
`cache_name` is from Step 0 (e.g. `quran-review-5.56.2`).

Expected: `cache_name === 'quran-review-' + current_version`

If they **match**: add "✅ Version consistent: `APP_VERSION` and `CACHE_NAME` both at
`<version>`" to All Clear.

If they **don't match** and `--defer-all` is NOT set:
- Add to **Must Have**: "Version mismatch: `version.js` says `<X>` but `sw.js`
  `CACHE_NAME` says `<Y>`."
- **Auto-fix**: use `version.js` as the source of truth. Update `sw.js` `CACHE_NAME`
  to `'quran-review-<current_version>'` using Edit.
- Report: "Auto-fixed: `sw.js` `CACHE_NAME` updated to `'quran-review-<version>'`."

Also check the latest git commit subject:
- Run: `git log --format='%s' -1`
- If the commit subject does NOT mention the current version string, add to **Good to Have**:
  "Latest commit doesn't reference the current version (`<version>`) — verify the
  version was bumped before the last commit."

---

## Step 5 — Quick UX Structural Health Check

Read the relevant sections of `review.html`. This is a structural check only —
not a full UX audit (that's `/ux-review`).

### 5a. Desktop tab count
Count `.view-tab` buttons in the desktop tab bar.
Rule: ≤6. Flag ⚠️ if more.

### 5b. Mobile bottom bar count
Count `.mobile-tab-btn` buttons in `#mobile-tab-bar`.
Rule: ≤5. Flag ⚠️ if more.

### 5c. Sub-tab count per view
For each `#view-*` div, count `.log-subtab` buttons inside it.
Rule: ≤4 per view. Flag ⚠️ any view with more.

### 5d. Orphaned getElementById calls (recent commits)
Run: `git diff HEAD~5..HEAD -- review.html | grep '+.*getElementById(' | grep -oP "getElementById\('\K[^']+" | sort -u`

For each ID found: check if it appears in the HTML (`grep -c 'id="<id>"' review.html`).
Any ID called in JS but absent from HTML → flag ⚠️ **Need User Input**: "JS references
`#<id>` but no element with that id found in HTML — removed accidentally?"

### 5e. Mobile card count
Count `.mob-action-card` divs in `#mobile-home`.
Rule: ≤5 visible cards (don't count hidden/display:none ones). Flag ⚠️ if more.

### 5f. Stats strips present
Check `grep -c 'id="desktop-stats-bar"' review.html` — should be 1.
Check `grep -c 'id="mob-stats-strip"' review.html` — should be 1.
Either missing → flag ⚠️ **Must Have**.

### 5g. Print function intact
Check `grep -c 'function printHtmlDocument' review.html` — should be ≥1.
Missing → flag **Must Have**.

Produce a summary table:
```
| Check                          | Status | Notes                          |
|-------------------------------|--------|--------------------------------|
| Desktop tabs (≤6)             | ✅/⚠️  | N tabs found                   |
| Mobile bottom bar (≤5)        | ✅/⚠️  | N tabs found                   |
| Sub-tab counts (≤4/view)      | ✅/⚠️  | All within limit / View X has N|
| Orphaned element IDs (recent) | ✅/⚠️  | None / #id missing             |
| Mobile home cards (≤5)        | ✅/⚠️  | N cards                        |
| Stats strips present          | ✅/⚠️  | Both present / MISSING         |
| printHtmlDocument defined     | ✅/⚠️  | Found / MISSING                |
```

---

## Step 6 — Additional Checks

### 6a. README staleness
Run:
```bash
git log --format='%ct' -- README.md | head -1   # last README commit timestamp
git log --format='%ct' -- review.html | head -1  # last review.html commit timestamp
```

If `review.html` was updated more than 7 days after README: add to **Good to Have**:
"README.md was last updated <N> days before the most recent review.html change —
check if any new pages or major features should be documented."

List the review.html commits since README was last updated:
`git log --oneline <readme_hash>..HEAD -- review.html`

### 6b. Sync field consistency
Extract all `review.*:` field names from `buildSyncPayload()`:
```bash
grep -A200 'function buildSyncPayload' review.html | grep -oP '^\s+\K\w+(?=:)' | head -30
```

Extract all `review.*:` field names from `buildFullLogData()`:
```bash
grep -A100 'review:' review.html | grep -oP '^\s+\K\w+(?=:)' | head -30
```

(These regexes are approximate — adjust based on actual indentation structure.)
Compare the two sets. Any field present in `buildSyncPayload` but absent from
`buildFullLogData` (or vice versa) → add to **Good to Have**:
"Field `<name>` in `buildSyncPayload` but not `buildFullLogData` (or vice versa).
This is the same class of bug that caught `telegramLastImportedAt` missing — verify
intentional."

### 6c. Code size check
Run: `wc -l review.html | awk '{print $1}'` → `current_lines`

If `stored_stable.lines` exists:
- `delta = current_lines - stored_stable.lines`
- If `delta > 200`: add to **Good to Have**: "`review.html` grew by N lines since
  stable `<version>` — if a refactor or new feature was added, this is expected;
  otherwise consider extracting some logic to a shared .js file."
- Otherwise: note "✅ Code size: `review.html` is N lines (+M since stable)."

If no stored baseline: note current line count as the new baseline (it'll be saved
in the stable file at end of Step 3).

### 6d. Orphaned localStorage keys (static scan)
```bash
# Keys that are set
grep -oP "localStorage\.setItem\('\K[^']+" review.html | sort -u > /tmp/hk_set_keys.txt
# Keys that are gotten
grep -oP "localStorage\.getItem\('\K[^']+" review.html | sort -u > /tmp/hk_get_keys.txt
# Keys that are removed
grep -oP "localStorage\.removeItem\('\K[^']+" review.html | sort -u > /tmp/hk_remove_keys.txt
# Set-only (never gotten or removed) — likely write-only / orphaned write
comm -23 <(sort /tmp/hk_set_keys.txt) <(sort /tmp/hk_get_keys.txt /tmp/hk_remove_keys.txt | sort -u)
# Get-only (never set) — likely orphaned read or set elsewhere
comm -23 <(sort /tmp/hk_get_keys.txt) <(sort /tmp/hk_set_keys.txt)
```

List any found set-only or get-only keys. Add to **Need User Input** if any are
found (they may be intentional one-way migration writes or set by a different page):
"LocalStorage key `<name>` is set but never gotten (or vice versa) — verify
intentional or remove."

### 6e. CDN version inventory
```bash
grep -oP 'cdnjs\.cloudflare\.com/ajax/libs/[^"]+' review.html
```

List every CDN URL found. Don't flag any as outdated (CDN bumps require testing),
but present the list so the user can eyeball it. Format:
```
CDN libraries in use:
  - <library>@<version> — <url>
```

If no CDN libraries found: note "No CDN libraries — all JS/CSS is inline."

---

## Step 7 — Produce the Report

Assemble the full report in this exact order. Be concise — each item is one to three
sentences max. Skip empty sections (e.g. if nothing is deferred, omit the Carried Over
section).

```markdown
# 🧹 Housekeeping Report — <YYYY-MM-DD> (v<current_version>)

## ⏮️ Carried Over From Last Run
<content of housekeeping-deferred.md, or omit this section entirely if nothing>

## 🔴 Must Have
<numbered list — items that should be fixed before the next push>

## 🟡 Good to Have
<numbered list — address within a week>

## 🔵 Need More User Input
<numbered list — decisions required before acting>

## ✅ All Clear
<bullet list — one line per check that passed cleanly>

## 📊 Stable Version
<one paragraph: current stable, commits since stable, next eligible version>

## 📚 CDN Inventory
<CDN list from 6e, or "No external CDN libraries.">

## ⏭️ Deferred to Next Run
<all unresolved Good-to-Have + Need-Input items, formatted identically to how
they appear above so next run can re-present them in the Carried Over section>
```

---

## Step 8 — Write persistent state

1. Write `.claude/housekeeping-deferred.md` with the content of the
   "⏭️ Deferred to Next Run" section (just the items, no header needed in the file).

2. Update `.claude/housekeeping-stable.md` — write the stable record (from Step 3)
   plus update the `last_run:` line to today's ISO date and `lines:` to current count.

3. Check `.gitignore` for `.claude/`:
   ```bash
   grep -F '.claude/' .gitignore 2>/dev/null
   ```
   If `.claude/` is not ignored: add to **Need User Input**:
   "`.claude/` is not in `.gitignore` — the housekeeping state files and any session
   settings will be committed. Add `.claude/` to `.gitignore` if you don't want that."

---

## Tone and format

- Be direct and factual. "Test suite: 37 failures in importMistakesFromTelegram"
  not "there appear to be some issues with the test suite."
- Each Must Have item names the file and what to look for.
- Prefer specific commit hashes and line counts over vague descriptions.
- If the run is clean (no Must Have, no Good to Have), say so clearly:
  "All checks passed — nothing to act on." Don't pad the report.
- This is a maintenance tool, not an audit. Don't deep-dive into UX or architecture
  here — save that for `/ux-review`.
