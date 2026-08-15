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
- `quran-data.js` — `SURAHS`, `SURAH_OFFSETS`, `JUZ_RANGES`, `HIZB_RANGES`,
  and the pure ayah/Hizb/Juz geometry helpers (`globalToSurahAyah`,
  `hizbRange`, `hizbOfGlobalAyah`, `globalToJuz`, `ayahIsInHizb`,
  `ayahIsInSurah` — the latter checks the ayah number itself against the
  surah's real ayah count, distinct from `ayahIsInHizb`'s "is this ayah part
  of that Hizb" check; review.html's mistake-entry points — live "+ Mistake"
  tap, paste-import, inline edit — all reject/alert on an ayah number
  `ayahIsInSurah` says doesn't exist). `HIZB_RANGES` (60 explicit
  `[globalStart, globalEnd]` pairs, sourced from `api.alquran.cloud`'s
  `/hizbQuarter/{n}` endpoint) is what `hizbRange`/`hizbOfGlobalAyah` read —
  a real bug used to bisect each `JUZ_RANGES` entry exactly in half by ayah
  count instead, but a Hizb boundary isn't at a Juz's ayah-count midpoint
  (each Hizb further splits into 4 quarters of roughly equal *recitation
  length*, not equal ayah count) — e.g. Juz 1's real Hizb 1/Hizb 2 boundary
  is Al-Baqara 74/75 (81 vs 67 ayat), not the 74/74 even split the old code
  computed, which silently mis-Hizbed Al-Baqara 68-74 into Hizb 2.
  `review.html`'s `repairImportedMistakeHizbs()` (called once on every load,
  a no-op once already correct so no version flag needed) self-heals any
  already-stored `ayahMistakes` entry that got mis-Hizbed by the old logic —
  scoped to `source: 'paste'`/`'telegram'` only, since `hizbOfGlobalAyah()`
  is the ONLY thing that ever set those entries' `hizb`; a live tap's `hizb`
  is instead the Recitation Session's own dropdown (an explicit user
  choice `ayahIsInHizb` only warns about, never overridden here), and a
  Hizb Log session's own `mistakes` tally is deliberately left untouched
  either way — it reflects the sitting it was recited in, a separate concept
  from which Hizb an individual ayah geometrically falls in. Included by
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
  browsing everything that went wrong without opening each Hizb; takes an
  optional `includeAttention` (default `false`) that, when true, counts type
  'A' entries too instead of excluding them — see the `groupAyahMistakesByCount`
  paragraph below), plus small
  chart/text helpers
  (`timeToPositionPct`, `trendTickFractions`, `ayahBeginning`). Also defines
  the mistake-type system: `MISTAKE_TYPE_META` (codes S/B/W/M/T/E/K/A, each with
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
  feeds (ranking, clusters, mutashabihat) by default — that's the one place
  it's enforced. review.html's Review & Analyze sub-tab has an "Include
  'Needs Attention' ayat as mistakes" checkbox (`includeAttentionAsMistakes`,
  off by default, `setIncludeAttentionAsMistakes()`) that opts back in for
  exactly two views — "All Hizbs — Mistakes" (`computeAllHizbsMistakes`'s
  `includeAttention` param above) and "Ayat You Mistake Most"
  (`computeAyahMistakeRanking`'s own third param, same name, added
  independently since that function lives in review.html itself rather than
  this shared file) — plus their own 🖨️ Print output, so what prints always
  matches what's on screen. Deliberately NOT threaded into anything else
  that calls either function with no third argument (defaults to `false`):
  Hizb Overview's strength score (driven by each Recitation Log session's
  own `mistakes` tally, fixed at merge time — see "Import from Telegram"
  above — not something a later toggle can retroactively recompute), All
  Revision Clusters/Recitation Log (Clusters & History is a different
  sub-tab), Print Report's top-20-ayat, and hizb.html (`groupAyahMistakesByCount`
  itself, and `computeAyahMistakeRankingForHizb` which calls it, both keep
  their original single-argument signature — hizb.html has no such toggle).
  `computeAyatNeedingAttention`'s own "Needs Attention" list is unaffected
  either way, always showing every flagged ayah regardless of the checkbox —
  that's its whole purpose. `review.html` separately declares its own
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
recitationLog, ayahMistakes, mutashabihatPairs, pagesNeedingReview }, habits: { activities, log } }`.
Each `ayahMistakes` entry carries `type` (S/B/W/M/T/E/K/A, or `null` — see
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
five `review` fields (memorizedHizbs, recitationLog, ayahMistakes,
mutashabihatPairs, pagesNeedingReview) as independently optional — only a field that's actually
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
`"218S"` / `"3:"` / `"3:15"` shorthand).

That proxy is flaky enough in practice (slow, rate-limited, or briefly
erroring) that a single failed fetch isn't treated as final —
`fetchTelegramPageWithRetries()` retries the page fetch itself up to
`TELEGRAM_FETCH_MAX_ATTEMPTS` (4) times, `TELEGRAM_FETCH_RETRY_DELAY_MS`
(2s) apart, updating the button's own label with the current retry count so
a slow run doesn't look hung; only once every attempt has failed does it
throw and surface the "Import from Telegram failed" alert. Deliberately
scoped to just that one network call, before any surah prompts fire — a
retry never re-asks the user anything, and nothing about parsing/dedup/
prompting changes based on how many attempts the fetch itself took.

Messages are sorted chronologically
and share ONE running surah context (`activeSurah`, local to that one run)
across all of them — the same forward-carrying behavior
`parseAyahMistakesText()` already does WITHIN one paste via its own
`activeSurah`, just extended across separate messages here via
`endingSurahAfterParsing()` (mirrors that same override-tracking, kept
separate since `parseAyahMistakesText()`'s return shape is depended on
elsewhere and shouldn't change to also expose it). A message's own `"N:"`
line always updates that context going forward. The surah is NEVER
assumed, though — if a message needs one and none has been established yet
this run, `promptTelegramMessageSurah()` asks the user directly (via
`prompt()`, showing that message's own text), starting completely BLANK
every time — no pre-filled default at all, from anywhere. Once answered,
that surah carries forward automatically, so a whole leading run of
unlabeled messages (e.g. several in a row, all meant for the same surah,
before the first explicit `"N:"` one) only prompts once, not per message.
Cancelling (or leaving it blank) skips just that one message, tracked as
`skippedNoSurah` and reported in the final confirm/alert text — never
guessed and never silently dropped without saying so; `activeSurah` stays
unset afterward, so the very next still-ambiguous message prompts again
rather than silently reusing a skip.
(An earlier version used the surah `<select>` as a silent default for every
unlabeled message — dropped after it silently mis-attributed messages to
whatever surah happened to be selected, since nothing forced the user to
check first. A version after that prompted independently per message,
which correctly stopped the silent mis-attribution but was needlessly
repetitive for a long run of messages all meant for the same surah — this
carry-forward design is what replaced it. A later version reintroduced the
sub-tab's own surah `<select>` (`telegram-import-surah`, separate from the
paste-import's `mistake-import-surah`) as a pre-filled *default value* for
this prompt — meant as a mere convenience, but it reproduced the exact same
silent-mis-attribution bug the first version was already dropped for: with
the dropdown left on the wrong surah, its bare number showed up pre-filled
here with no surah NAME anywhere to flag it as wrong, easy to leave in
place while answering the rest of the prompt and get silently accepted.
The `<select>` was removed entirely for this reason — the prompt now always
starts blank, with nothing anywhere feeding it a default.)

Even with no stale `<select>` left to blame, a carried-forward surah can
still go stale on its own: a real incident had an old test message
(`"3:\n15\n16\n22\n24a"`, posted while this feature was being built) sitting
unnoticed on the channel, and because nothing ever posted a later `"2:"` to
switch back, every message posted DAYS afterward with no override of its
own kept silently resolving to that stale Surah 3 — invisibly, since most
of those ayah numbers were coincidentally also valid ayat in Surah 3 (only
some Al-Baqara-only ayah numbers, past Aal-i-Imran's own 200-ayah range,
ever surfaced as a "doesn't exist in their surah" error). `reviewTelegramSurahAssignments()`
closes this gap: every NEW candidate ayah mistake that relied on carry-
forward (`viaOwnOverride: false` — see the parsing loop's own
`hasOwnOverride` check, one `.some()` over that message's own lines) is
grouped by whichever surah it resolved to and shown to the user — surah
name, not just its number, plus every ayah about to be filed under it —
before anything is saved, once per distinct surah group rather than once
per ayah. Confirming keeps the guess; declining opens a plain `prompt()`
("2" or "2:" both parse fine, same as everywhere else a surah number is
typed) that re-tags the WHOLE group to the corrected surah; a decline with
no valid corrected surah given drops that group entirely rather than
falling back to the original guess — same "never assume" rule as
`promptTelegramMessageSurah()` itself. A candidate whose own message
declared its own `"N:"` line (`viaOwnOverride: true`) is trusted as-is and
never enters this review at all — even if it happens to share a surah with
some carry-forward candidates elsewhere in the same run — since typing
`"3:"` in the very message being logged is a deliberate, in-context choice,
not an assumption; lumping it into a carry-forward group would risk
silently re-tagging a message that was never wrong just because it shares a
surah number with one that was. Runs on `newCandidates` (after the existing
`telegramAyahMistakeExists` dedup, not before) so a message already fully
imported is never re-reviewed just because it gets reconsidered again (see
"no last-imported cursor" below); any group it drops is folded into the
final confirm/alert text alongside `noSurahNote` as `badSurahNote`.

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

Before anything is saved, the confirm dialog lists every candidate ayah
individually (`surah:ayah`, plus its type code and note if any), not just a
count — so nothing lands in `ayahMistakes` unseen. Separately,
`TELEGRAM_LAST_IMPORTED_AT_KEY` (`renderTelegramLastImportedAt()`, shown
next to the button as `#telegram-last-imported`) records the last time the
button completed a run (mistakes actually saved, or a confirmed "nothing
new") — purely informational, so don't confuse it with the removed cursor:
it has zero effect on which messages get reconsidered, and is skipped when
the user declines a confirm or the run errors out before reaching that
point.

Both `importAyahMistakesFromText()` (the manual paste-import) and
`importMistakesFromTelegram()` funnel their parsed entries through the same
shared session-merge helpers — `mergeAyahMistakesIntoSessions()`,
`buildSessionSummaryParts()`, `saveMergedHizbLog()` — so a Hizb touched by
either (or a live Recitation Session) merges into one Recitation Log entry
per Hizb *per calendar day*, keyed off each mistake's own `date` (not a
single shared "now") — necessary for Telegram, since one import run can
pull in messages spanning several distinct days at once, unlike a paste
which is always all one sitting.

## Pages Needing Review (review.html)

A separate, page-granularity counterpart to ayah mistakes: a `"pN"` line
(case-insensitive, e.g. `"p15"` or `"P15 messed up the whole page"`) in the
paste-import textarea or a Telegram message flags an entire mushaf page
(1-604) for a full re-review, stored in its own `pagesNeedingReview` array
(`{ id, page, note, date, source }`, `LOG_KEYS.review.pagesNeedingReview` /
`quranReviewPagesNeedingReview`) — never mixed into `ayahMistakes`, never
counted as a mistake anywhere, and (unlike ayah mistakes) never tied to any
Hizb Log session, since a page flag isn't something recited in a sitting.

`parsePageFlagsText(text)` is a fully independent second pass over the same
text `parseAyahMistakesText()` already scans — deliberately not folded into
it, since a `"pN"` line never starts with a digit and so `parseAyahMistakesText`
already ignores it on its own (same as any other non-numeric line), and the
two parsers' return shapes (page numbers vs. surah/ayah/hizb) are different
enough that merging them would force every existing `parseAyahMistakesText`
call site to handle a new shape. `importAyahMistakesFromText()` and
`importMistakesFromTelegram()` both call `parsePageFlagsText()` alongside
their existing ayah parsing and merge the results into one shared confirm/
success message — a paste or Telegram message can be all ayat, all page
flags, or a mix of both; either kind alone is enough to proceed (a
page-flags-only paste needs no valid ayah numbers, and skips the "Pick a
surah first" ayah-specific requirement's *effect*, though the paste-import
box's own surah dropdown is still always required up front, same as
before). For Telegram specifically, `looksLikeAyahLogMessage()` was
extended to also recognize a `"pN"` line as real log data (it previously
only checked for a digit-leading line), and page flags never trigger the
per-message surah-prompt logic (`parseAyahMistakesText(msg.text, null)` on
page-flag-only text returns no entries needing a surah) — a page-flags-only
Telegram message is imported with zero prompts.

Dedup for Telegram-sourced page flags mirrors `telegramAyahMistakeExists()`
exactly: `telegramPageFlagExists(telegramMessageId, page)` is existence-
based against current `pagesNeedingReview` (not a cursor), so deleting a
flag and re-running Import from Telegram brings it back, same reasoning as
ayah mistakes.

review.html's Review & Analyze sub-tab has a "Pages Needing Review" section
(`renderPagesNeedingReview()`, most-recently-flagged first via
`computePagesNeedingReview()` — one row per page, keeping only its latest
note/date if flagged more than once, same collapsing idea as
`computeAyatNeedingAttention()` for ayat) with its own click-to-expand:
`expandedPageKey`/`pageTextCache`/`ensurePageTextCached()`/
`togglePageText()`/`pageTextExpandHtml()` mirror the ayah-text click-to-
expand mechanism one-for-one, just keyed by page number and backed by
`quran-cache.js`'s `fetchPageData()` (a whole page's ayahs, Arabic only)
instead of `fetchSurahData()` — a deliberately separate cache/state, not a
reuse of the ayah-text one, since a page's fetch shape (many ayahs, possibly
spanning two surahs) is different enough to want its own. Since there's no
"Edit individual..." list for page flags the way ayah mistakes have one,
each row also gets its own `deletePageNeedingReview(page)` (a plain 🗑/✕
button) as the only way to remove a flag.

`buildSyncPayload()`/`applySyncPayload()`/`normalizeSyncPayload()`,
`buildFullLogData()`/`applyFullLogData()` (log.js), and review.html's own
`importLogData()` all carry `pagesNeedingReview` through exactly like the
other three `review` fields (memorizedHizbs/recitationLog/ayahMistakes/
mutashabihatPairs already had this shape; `pagesNeedingReview` is simply a
fifth independently-optional one) — a legacy sync doc or hand-edited file
missing this field defaults to empty, never `undefined`.

## Click-to-expand ayah text (review.html)

Every place review.html lists individual `surah:ayah` mistake refs — Needs
Attention, Ayat You Mistake Most, All Hizbs — Mistakes, a Recitation Log
session's expanded mistake list, Edit individual ayah mistakes, and (for a
group's individual ayat) Mutashabihat — can be clicked to reveal that ayah's
full Arabic text + English translation inline, fetched via `quran-cache.js`'s
`fetchSurahData()` and cached on-device the same way hizb.html's own
`expandedMistakeKey`/`surahCache`/`ensureSurahsCached`/`toggleMistakeAyah`
already do (this feature mirrors that exact pattern, just centralized in
review.html since it has several independent lists that can all show the
same ayah rather than hizb.html's four). `expandedAyahTextKey` (`"surah:ayah"`
or `null`) is the single shared "which ayah is expanded" state for the whole
page — expanding one collapses whatever else was expanded, and every
consuming section re-renders in sync via `toggleAyahText(surah, ayah)`.
`ayahTextCache` (surah number -> `fetchSurahData()`'s result, or `null` on a
failed fetch) backs `ayahTextExpandHtml(surah, ayah)`, which renders the
`.mistake-ayah-preview` block (Arabic + translation, or a "Could not load
this ayah." fallback) only when that ayah is the currently-expanded one.

This is deliberately a NEW, separate cache/state from two other,
already-working per-ayah-preview mechanisms already on this page — left
untouched rather than risk unifying them:
- All Revision Clusters' `allClustersSurahCache`/`clusterAyahBeginning`,
  which backs its ALWAYS-shown opening-words preview under a cluster's
  start/end ayah (not a click). That cluster's "Starts at"/"Ends at" lines
  are ALSO individually click-to-expand via this new mechanism, once the
  cluster itself is already expanded — a second, independent affordance
  layered on top of the existing opening-words one, not a replacement.
- Mutashabihat's `mutashabihatSurahCache`/`toggleMutashabihatCompare`,
  which shows full Arabic (no translation) for every ayah in a 2+-ayah
  group side by side with surrounding context. A group's ref text there is
  now also individually clickable per ayah: for 2+ ayat it opens that same
  Compare view (a second entry point into it, not a new one); for a lone,
  not-yet-completed group (nothing to compare yet) it falls back to this
  page's own `toggleAyahText`/`ayahTextExpandHtml`.

Any row whose click ALREADY does something else (Ayat You Mistake Most and
All Hizbs — Mistakes both toggle a mistake-entries history on click when a
row's `count > 1`) gets its ayah ref wrapped in its own
`onclick="event.stopPropagation(); toggleAyahText(...)"` element instead of
making the whole row do double duty — so the two behaviors never fire
together from one click.

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
IndexedDB ayah-text cache, and `TELEGRAM_LAST_IMPORTED_AT_KEY` (the
"last imported" display next to the Import from Telegram button — see
"Import from Telegram" above; it's purely informational and has no bearing
on dedup, which is existence-based against `ayahMistakes` itself, so
excluding it costs nothing — a device that's never clicked the button just
shows "Never imported yet" instead of a synced value that wasn't really
true for it).
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
