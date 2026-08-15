# Quran Memorization site

Standalone static HTML pages (no build step): `index.html` (home/app picker),
`quran-tracker.html` (memorization tracker), `review.html` (review/revision tool),
`hizb.html` (one Hizb's history/trend/mistake-ranking/revision-clusters —
`?hizb=N`, linked from review.html rather than embedded there), `habits.html`
(generic personal activity tracker — not Quran-specific). They share
localStorage (same origin) and link to each other by relative path.

## Shared modules

Beyond `version.js` and `log.js` (see below), three more files are shared via
plain `<script src>` includes (no ES modules anywhere in this codebase —
function *declarations* from one script are visible to, and callable from,
later inline `<script>` blocks on the same page; see the Tests section for the
`const`/`let` caveat):
- `quran-data.js` — `SURAHS`, `SURAH_OFFSETS`, `JUZ_RANGES`, and the pure
  ayah/Hizb/Juz geometry helpers (`globalToSurahAyah`, `hizbRange`,
  `hizbOfGlobalAyah`, `globalToJuz`, `ayahIsInHizb`, `ayahIsInSurah` — the
  latter checks the ayah number itself against the surah's real ayah count,
  distinct from `ayahIsInHizb`'s "is this ayah part of that Hizb" check;
  review.html's mistake-entry points — live "+ Mistake" tap, paste-import,
  inline edit — all reject/alert on an ayah number `ayahIsInSurah` says
  doesn't exist). Included by
  `quran-tracker.html`, `review.html`, and `hizb.html` — this is the single
  source of truth for Quran structure, after a real bug where review.html's
  own hand-maintained copy of `SURAHS` had a corrupted Arabic character for
  Surah 113 that silently drifted from `quran-tracker.html`'s copy.
- `quran-cache.js` — the on-device IndexedDB cache (`fetchSurahData`,
  `fetchPageData`) for ayah text fetched from `api.alquran.cloud`, so
  revisiting a surah/page (even offline) doesn't re-fetch it. Included by
  `review.html` and `hizb.html`.
- `mistake-analytics.js` — read-only ayah-mistake analytics: `loadHizbLog`,
  `loadAyahMistakes`, `computeHizbStrength`, `groupAyahMistakesByCount`,
  `ayahMistakesForSession`, `computeAyahMistakeRankingForHizb`,
  `clusterAyahMistakes` (nearby-mistake grouping, including isolated mistakes
  as their own size-1 group; capped at `REVISION_CLUSTER_MAX_SPAN` ayat total
  even when every individual gap is within `REVISION_CLUSTER_MAX_GAP`, so a
  string of small mistakes spread across many unrelated sessions can't chain
  into one sprawling, mostly-clean "cluster". Each cluster carries both
  `distinctCount` — how many of its ayat actually have a logged mistake —
  and `totalAyatInRange` — the range's real length end-to-end, since gap-
  chaining can bridge a few clean ayat in between and UI must show the
  latter next to a start–end range so the two don't look inconsistent),
  `computeRevisionClustersForHizb`
  and `computeAllRevisionClusters` (both take an optional timeframe — `'all'`,
  `'7d'`, `'3d'`, or `'1d'`, per `TIMEFRAME_WINDOWS_MS` — and pool mistakes
  across every session). `filterMistakesByTimeframe(entries, timeframe)` only
  reads `.date`, so despite the name it's reused as-is on non-mistake
  `.date`-bearing arrays too — review.html's Recitation Log timeframe filter
  (`renderHizbLogTable`/`printRecitationLogMistakes`) runs it directly over
  `loadHizbLog()` session entries, not just ayah mistakes.
  `computeSessionRevisionClusters`
  (clusters within just one recitation sitting) and `computeSessionClustersForHizb`
  (every session's clusters for a Hizb, flattened into one ranked list tagged
  by session — clusters here never merge across sessions, unlike the pooled
  `computeRevisionClustersForHizb`), `computeLatestSessionClustersForAllHizb`
  (every Hizb's most recent *day's* clusters in one flat ranked list, tagged
  by Hizb — review.html's "All Revision Clusters"/"All Hizbs — Mistakes"/
  "Ayat You Mistake Most"/Recitation Log "Last Session" mode across the
  board; unlike the timeframe param on `computeAllRevisionClusters`, this
  isn't a date window, it's "every sitting on this Hizb's most recent day,
  pooled together" — via `latestSessionDayEntriesForHizb(hizb, log)` (every
  Recitation Log entry for a Hizb sharing its latest entry's calendar day —
  so 3 separate sessions logged the same day for one Hizb all count, not
  just the very last of the three) and `ayahMistakesForSessions(sessionEntries)`
  (the multi-session generalization of `ayahMistakesForSession`, deduped so a
  legacy sessionId-less mistake matched by the same-day fallback isn't
  double-counted across several of that day's sessions) — and a day can still
  split into more than one cluster row, same as any other mode),
  `computeAllHizbsMistakes` (the flat, unclustered
  counterpart — every raw ayah mistake across every Hizb, grouped by Hizb and
  ranked most-mistakes-first, same timeframe vocabulary including
  `'last-session'` — backs review.html's "All Hizbs — Mistakes" section, for
  browsing everything that went wrong without opening each Hizb), plus small
  chart/text helpers
  (`timeToPositionPct`, `trendTickFractions`, `ayahBeginning`). Also defines
  the mistake-type system: `MISTAKE_TYPE_META` (codes S/B/W/M/T/A, each with
  a label/description — the single source of truth for the type legend and
  badges) and `splitMistakeTypeAndNote` (splits a leading run of type-code
  letters off a mistake note, e.g. `"SB forgot ina"` -> `{type: 'BS', note:
  'forgot ina'}` — a note can carry more than one code at once, via
  `normalizeMistakeTypeCodes`, which dedupes/sorts them into canonical order
  and rejects combining 'A' with a real code, since 'A' ("needs attention")
  means *no* actual mistake happened). `mistakeTypeLabel` and
  `isValidMistakeType` are the read-side counterparts (human-readable label
  for a — possibly multi-code — type string; validity check for a type
  coming from an untrusted source like a hand-edited import file).
  `groupAyahMistakesByCount` excludes type 'A' entries from every count it
  feeds (ranking, clusters, mutashabihat) — that's the one place it's
  enforced. `review.html` separately declares its own
  `saveHizbLog`/`saveAyahMistakes` (writes, with a
  Firebase sync side effect) — this module only ever reads, so hizb.html can
  include it without pulling in sync logic it has no use for.

## Versioning

`version.js` defines `APP_VERSION` (semver `v1.v2.v3`) and is included by every
page, which displays it as a small badge in its header.

Bump `APP_VERSION` in `version.js` on every commit that touches one of the
HTML pages:
- **v3 (patch)** — tiny changes: copy tweaks, styling, small bug fixes.
- **v2 (minor)** — larger changes: new features, notable UI additions.
- **v1 (major)** — main/breaking changes: architecture shifts, data-format changes.

Bumping a higher segment resets the ones to its right to 0 (e.g. 1.2.5 -> 1.3.0 for a v2 bump).

## Log format

`log.js` is shared by `quran-tracker.html`, `review.html`, and `habits.html` (all pages
are same-origin, so localStorage is already shared). It defines the JSON log schema
used for backup export/import: `{ tracker: { memorized }, review: { memorizedHizbs,
recitationLog, ayahMistakes, mutashabihatPairs }, habits: { activities, log } }`.
Each `ayahMistakes` entry carries `type` (S/B/W/M/T/A, or `null` — see
`MISTAKE_TYPE_META` in mistake-analytics.js) and `source` (`'live'`/`'paste'`/
`'telegram'`/`null` — see `MISTAKE_SOURCE` in review.html; set once at creation
by `tapMistake`/`importAyahMistakesFromText`/`importMistakesFromTelegram` and
never touched by `saveAyahMistakeEdit`, so it always reflects how the entry
was first logged). A `source: 'telegram'` entry also carries
`telegramMessageId` (that channel message's own `data-post` id, e.g.
`"tasmee315/4"` — `null` for every other source) — see "Import from
Telegram" below for why. Both `type`/`source`/`telegramMessageId` are passed
through as plain strings in `buildFullLogData()`/
`applyFullLogData()` rather than validated against `MISTAKE_TYPE_META` — this
file is also loaded by `quran-tracker.html`/`habits.html`, neither of which
loads mistake-analytics.js, so it can't depend on `normalizeMistakeTypeCodes()`
existing; whichever page actually renders a mistake already tolerates an
unrecognized type code gracefully. `mutashabihatPairs` backs review.html's Mutashabihat tab — manually-curated
`{ ayat: [{surah, ayah}, ...], note, dateAdded }` groups of 1 or more ayat
each (not just pairs — a group can start with a single ayah and grow later
via edit; not auto-detected — see below) — and, like
`ayahMistakes`, is written through review.html's own `saveMutashabihatGroups()`
so the sync push side effect still runs. `normalizeMutashabihatAyat()` in
log.js (and `normalizeMutashabihatGroup()` in review.html) upgrade the older
two-ayah-only `{ surahA, ayahA, surahB, ayahB }` shape on read, so groups
saved before more-than-2-ayat support existed still load. Each top-level section is
optional, so a hand-edited file can carry just one page's data. `buildFullLogData()`
reads current localStorage into that shape; `applyFullLogData()` writes it back raw
(habits log entries are matched back to their activity by name, not id, since ids aren't
exported — hand-editable data shouldn't expose opaque ids). A page importing its *own*
section should prefer its own setters (e.g. review.html's `saveHizbLog`) instead, so
side effects like the Firebase sync push still run — see `importLogData()` in
review.html for the pattern. Like `applyFullLogData()`, it treats each of the
four `review` fields (memorizedHizbs, recitationLog, ayahMistakes,
mutashabihatPairs) as independently optional — only a field that's actually
an array in the parsed file gets parsed, confirmed, and saved; an absent one
is left exactly as it was, not wiped to empty (this is what makes review.html's
own single-section exports, e.g. "Mutashabihat: Save as JSON File", safe to
re-import without touching anything else). `habits.html` has no such side
effects, so it just calls `applyFullLogData()` on the whole parsed file directly.

## Import from Telegram

review.html's Hizb Log has a 4th sub-tab, "💾 Backup & Import" (alongside
"📝 Log a Session", "📊 Review & Analyze", "📜 Clusters & History" —
`setLogSubview()`/`.log-subview-*`), holding "Save as JSON File"/"Import
from Local Log" (the log.js backup pair) and "📥 Import from Telegram".
`importMistakesFromTelegram()` fetches `TELEGRAM_MISTAKES_CHANNEL`'s public
preview page (`t.me/s/<channel>`, via the `api.allorigins.win` CORS proxy —
see the function's own doc comment for why) and creates real `ayahMistakes`
straight from it, reusing `parseAyahMistakesText()` (the same parser the
manual paste-import uses — Telegram messages already use its `"218"` /
`"218S"` / `"3:"` / `"3:15"` shorthand) with the "Import from Telegram"
sub-tab's own surah `<select>` (`telegram-import-surah`, separate from the
paste-import's `mistake-import-surah`) as the default surah for *every*
message independently — not carried over between messages, since a message
with no `"N:"` override has no way to say which surah it means on its own.

There is deliberately no "last imported" cursor. Every message on the page
is reconsidered on every run; dedup is existence-based instead, per
message+ayah, via `telegramAyahMistakeExists(telegramMessageId, surah,
ayah)` — true only if a mistake with that exact `telegramMessageId`+
`surah`+`ayah` is still in `loadAyahMistakes()`. That single design choice
is what makes deleting a Telegram-sourced mistake and re-running the import
bring it back: a monotonic timestamp cursor (the original v1.32.1 design)
structurally cannot do this, since a deleted mistake's source message would
already be older than the cursor and so never reconsidered. The tradeoff is
that a message which doesn't look like log data at all
(`looksLikeAyahLogMessage`) or is one of Telegram's own service messages
("Channel created", "X pinned...") is skipped silently on every run, with no
confirmation — the old cursor-based flow asked about this each time because
skipping one wrongly was a one-way door back then; it no longer is, since
every message gets reconsidered next time regardless.

Both `importAyahMistakesFromText()` (the manual paste-import) and
`importMistakesFromTelegram()` funnel their parsed entries through the same
shared session-merge helpers — `mergeAyahMistakesIntoSessions()`,
`buildSessionSummaryParts()`, `saveMergedHizbLog()` — so a Hizb touched by
either (or a live Recitation Session) merges into one Recitation Log entry
per Hizb *per calendar day*, keyed off each mistake's own `date` (not a
single shared "now") — necessary for Telegram, since one import run can
pull in messages spanning several distinct days at once, unlike a paste
which is always all one sitting.

## Cross-device sync (Firebase)

Only `review.html` loads the Firebase SDK/sync UI — `quran-tracker.html` and
`habits.html` have none of their own. `buildSyncPayload()`/`applySyncPayload()`
(review.html) mirror `buildFullLogData()`'s `{ tracker, review, habits }` shape
(same data breadth as "Save as JSON File" — nothing tracker/habits-side is
excluded from sync), but keep full-fidelity raw data (real ids, each ayah
mistake's `type`/`source`/`sessionId`, habit log entries' real `activityId`)
rather than `buildFullLogData()`'s sanitized/name-based shape meant for hand
editing — a pulled or live-updated device should end up equivalent to the
source device, not go through an id-regenerating re-import. Since
`quran-tracker.html`/`habits.html` have no sync wiring, their data only
round-trips to the cloud on review.html's *own* next push (any local save on
review.html, or "Push Now") — editing the Tracker or Habits pages directly
doesn't itself trigger a live cross-device push, but nothing is lost; it's
picked up next time review.html syncs. Deliberately excluded from sync: pure
device-local bookkeeping that isn't real user data — quran-cache.js's
IndexedDB ayah-text cache. (There is no longer a Telegram import cursor to
exclude either — see "Import from Telegram" above; that dedup is
existence-based against `ayahMistakes` itself, which already syncs.)
`normalizeSyncPayload()`
upgrades a Firestore doc saved by the old flat `{ log, memorizedHizbs,
ayahMistakes, mutashabihatPairs, updatedAt }` shape (before tracker/habits
were synced) to the current nested one on read — same idea as
`normalizeLogData()`'s legacy-shape handling for the JSON-file import path —
so an account that hasn't pushed since this shape changed still pulls its
existing review data correctly instead of losing it to an `undefined -> []`
default; the doc itself is only upgraded for real on that device's next push.

## Generated docs

`log.js`'s functions are documented with JSDoc. Run `npm install` once, then
`npm run docs` to regenerate a browsable API reference into `docs/` (gitignored,
not deployed) — open `docs/index.html` locally to view it.

## Tests

Run `npm install` once, then `npm test` (Node's built-in test runner, no
browser needed). `test/helpers/loadPage.js` loads a real HTML page into jsdom
(stripping the Firebase `<script src>` and inlining every local `<script
src="*.js">` it finds — `version.js`, `log.js`, `quran-data.js`,
`quran-cache.js`, `mistake-analytics.js`, whichever the page includes — so no
network/HTTP server is needed) and returns its `window` — function
*declarations* in the page's inline script (or any inlined shared file) end up
on `window` and are callable directly (e.g. `window.hizbOfGlobalAyah(...)`),
but top-level `const`/`let` do not, matching real browser semantics; use
`test/helpers/extractConst.js` (regex + eval, no DOM) when a test needs one of
those directly, e.g. comparing the `SURAHS` table across files. Pass `{ url:
'http://localhost/hizb.html?hizb=3' }` as `loadPage`'s second argument for a
page (like `hizb.html`) that reads `location.search` on load. Objects/arrays
returned from a jsdom-realm function need `JSON.parse(JSON.stringify(x))`
before `assert.deepEqual` — otherwise Node's assert sees a foreign
Array/Object prototype and reports "same structure but not reference-equal"
even when the data matches.

Add a test whenever you touch `log.js` or add/change a pure (DOM/network-free)
helper function in one of the pages — that's what caught two real bugs while
this suite was first written: `applyFullLogData()`/`importLogData()` crashing
on an invalid date instead of skipping that entry (`.toISOString()` throws on
an Invalid Date), and a corrupted Arabic character in review.html's `SURAHS`
copy for Surah 113 (mismatched against quran-tracker.html's copy).

## Keeping README.md in sync

`README.md` describes each page's purpose/features and the dev workflow, for
humans browsing the repo on GitHub. Unlike the version badge, it does NOT need
touching on every commit — most commits are too small to matter. Before
finishing any change that does one of the following, check whether README.md
needs a matching update:
- Adds, removes, or renames a page.
- Changes what a page is for or its main features (not just its styling).
- Changes the dev workflow (how to run locally, generate docs, etc.).
