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
  `'7d'`, `'3d'`, per `TIMEFRAME_WINDOWS_MS`, or `'last-session'` (see
  "Merging 'Last Session' and the rolling '1d'/'Today' window" below) —
  and pool mistakes across every session). `filterMistakesByTimeframe(entries, timeframe)` only
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
  `normalizeMistakeTypeCodes`, which dedupes/sorts them into canonical order.
  'A' ("needs attention") CAN combine with a real code (e.g. "AB") — this
  isn't "no mistake AND a real mistake" (contradictory), it's a more
  specific flavor of "no actual mistake happened, but here's which aspect it
  was a near-miss on"; every exclusion site checks `type.includes('A')`, not
  `type === 'A'`, so a combo is excluded from mistake counts exactly like a
  bare 'A' and still surfaces in Needs Attention. An earlier version
  rejected any 'A'+other combo outright — dropped after a real user typed
  `"266 ab"` meaning "almost forgot the beginning" and got a genuine,
  counted mistake with note "ab" instead, since the rejected combo fell
  through to plain-note parsing silently). `mistakeTypeLabel` and
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
recitationLog, ayahMistakes, mutashabihatPairs, practiceRanges, telegramLastImportedAt },
habits: { activities, log } }`.
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
six `review` fields (memorizedHizbs, recitationLog, ayahMistakes,
mutashabihatPairs, practiceRanges, telegramLastImportedAt) as independently
optional — only a field that's actually present in the parsed file gets
parsed, confirmed, and saved; an absent one is left exactly as it was, not
wiped to empty (this is what makes review.html's own single-section
exports, e.g. "Mutashabihat: Save as JSON File", safe to re-import without
touching anything else). `habits.html` has no such side effects, so it
just calls `applyFullLogData()` on the whole parsed file directly.
`telegramLastImportedAt` (see "Cross-device sync" below for why it's
tracked at all) is the one field here that's a plain scalar date string
rather than an array — `buildFullLogData()` formats it the same
human-readable way every other date in this file is formatted (or `null`
if Import from Telegram has never run on this device),
`applyFullLogData()`/`importLogData()` both NaN-guard the parse the same
way every other date field does (an unparseable value is treated as
absent, not saved as garbage). A real check worth re-running whenever
either this shape or `buildSyncPayload()`'s shape changes: build both from
the same seeded localStorage and diff their `review`/`habits` key sets —
they should always match field-for-field (nothing silently present in one
and missing from the other), even though the VALUES legitimately differ
(this file drops ids/sessionId and formats dates for hand-editing; the
sync payload keeps raw full-fidelity data — see `buildSyncPayload()`'s own
comment for why). This is exactly the check that caught
`telegramLastImportedAt` missing from this file the first time it was
added to `buildSyncPayload()` — added there alone, without adding it here
too, so a "Save as JSON File" backup would have silently dropped it.

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

`normalizeArabicIndicDigits()` is called at the top of every one of these
parsers — `parseAyahMistakesText()`, `parsePageFlagsText()`,
`parseHizbCleanSessionFlagsText()`, `parsePracticeRangeFlagsText()`,
`looksLikeAyahLogMessage()`, `endingSurahAfterParsing()`, and the inline
`hasOwnOverride` check in `importMistakesFromTelegram()` — converting
Arabic-Indic digits (`٠-٩`) and Extended Arabic-Indic/Persian digits
(`۰-۹`) to plain ASCII 0-9, and stripping the invisible LRM/RLM/ALM bidi
control marks Telegram's RTL text rendering can interleave right next to
a number. A real message on the channel (`"‏٢٠٧"`, an RLM mark followed by
Arabic-Indic "207") used exactly this shape: every regex above is
ASCII-only `\d` (no Unicode property escapes) and `parseInt()` doesn't
understand these digits either, so the line matched NOTHING — not even
`looksLikeAyahLogMessage()` — and the whole message silently vanished
with no sign anything went wrong, the same failure mode the dash-lookalike
incident in `parsePracticeRangeFlagsText()`'s own comment already
describes, just for digits instead of a range separator. Fixed at a single
shared choke point rather than patched into each regex individually, so
no future parser added to this list has to re-derive the same fix.

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

`fetchTelegramPageWithRetries()` builds the proxied URL itself (taking the
real `https://t.me/s/<channel>` target URL as its argument, not a
pre-built proxy URL) and appends a cache-busting `&_=<timestamp>` query
param, regenerated fresh on every attempt, plus `{ cache: 'no-store' }` on
the `fetch()` call itself. A real incident: `api.allorigins.win` (and/or a
cache in front of it) kept serving the exact same response — message #46,
posted 9:08 AM — as "the latest message" for hours, well after several
genuinely new messages had been posted on the channel, so every run
correctly-but-wrongly reported "nothing new to import" against the
(silently stale) page it was actually handed. `telegramFetchLooksStale()`
can't catch this class of staleness on its own: it only flags a fetch
whose latest message goes BACKWARDS relative to one already seen, but a
cache that's simply STUCK (never advancing, never regressing) produces a
response that's indistinguishable, by content alone, from "nothing has
actually been posted since last time" — the cache-buster addresses the
cause (stop the stale response from being served in the first place)
rather than trying to detect this specific symptom after the fact.

`t.me/s/<channel>` itself — separately from any of the above proxy
flakiness — only ever returns the ~20 most recent messages; it's a preview
widget, not a full-archive endpoint. Once a channel grows past that, the
OLDEST message in a given fetch can genuinely have no surah context of its
own even though real context exists — an explicit `"N:"` line, visible
scrolling the real Telegram app — just further back than this one fetch
reaches. A real incident: a bare `"63m"` line needed a blank
"Which surah is this Telegram message for?" prompt even though a `"2:"`
line existed only a few messages earlier, one page further back than the
default fetch goes — correct per the "never guess" rule given only what
was fetched, but avoidable, since the context genuinely exists on the
channel. `telegramMessageNeedsOlderContext(msg, ...)` (true when a message
has no `"N:"` of its own, nothing already logged locally from it, AND
actually needs a surah at all — a page/`"hN"`-only message doesn't) is
checked against just the chronologically OLDEST message in the fetched
batch before the main per-message loop even starts — if that one message
resolves, everything after it will too, via ordinary forward carrying, so
there's nothing to gain checking any other message here.

When it doesn't resolve, `fetchOlderTelegramMessages()` fetches earlier
pages via Telegram's own `?before=<id>` pagination (the same mechanism the
page's own "load more" link at the bottom uses) — each still going through
`fetchTelegramPageWithRetries()`'s normal retry logic — prepending
whatever it finds to the working message list, until: the new oldest
message resolves on its own (most real cases need at most one extra page,
per the incident above), a fetched page comes back with no log-like
messages at all (the beginning of the channel, or a long non-log stretch),
a fetched page makes no real progress (its own oldest id isn't actually
older than what was asked for — a defensive guard against a misbehaving
proxy serving the same page regardless of the query string, which would
otherwise silently burn through every remaining attempt for nothing), a
page fetch fails outright after its own retries (backward context is a
nice-to-have, not worth failing the whole import over — falls back to
prompting instead, exactly as before this existed), or
`TELEGRAM_BACKWARD_PAGE_FETCH_MAX` (10) is reached (a hard stop against an
unbounded fetch chain if a channel genuinely has no surah context anywhere
in its own history). Deliberately does NOT touch
`telegramFetchLooksStale()`/`recordTelegramLatestSeenMessageDate()` at
all — that staleness check is specifically about the freshness of the
LATEST page, orthogonal to paging backward into history. Whatever extra
messages this finds are merged into the normal working list and flow
through the exact same per-message loop as everything else — including
their own ayat, which get existence-deduped like any other reconsidered
message (so no special-casing needed for "was this older message already
imported"), and self-healingly pulling in anything from them that
genuinely wasn't imported yet.

A carried-forward surah — whether from a nearby message or one recovered
via backward pagination — is never silently trusted just because it now
resolves without a blank prompt: it still goes through
`reviewTelegramSurahAssignments()` like any other carry-forward candidate
(see below), which shows the user each candidate's own ORIGINAL Telegram
message text (`telegramText`, carried on each candidate alongside its
parsed ayah/type/note) next to its guessed surah, not just the parsed
`"63 (M)"` reference alone — added directly because of the incident above:
a bare parsed ref gives no way to sanity-check the attribution against
what was actually typed, especially once the surah-establishing message
could be several messages away from the one being reviewed.

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

Since every message is reparsed on every run regardless of dedup (see "no
last-imported cursor" below), a message with no override of its own would
otherwise be re-prompted about its surah on EVERY future run too, even once
everything in it is already logged — the prompt has to fire before dedup
can even run, since dedup's key includes `surah`, which the prompt is what
determines in the first place. `knownSurahForMessage` closes that gap: if a
message has no override AND nothing this run has established a surah yet
(`activeSurah` still `null`) AND that exact `telegramMessageId` already has
at least one logged mistake from an earlier run, that mistake's own
`.surah` is reused directly — no prompt at all — and adopted as `activeSurah`
going forward, same as a real answer would be. A message only partially
imported before (e.g. one of its ayat was later deleted) still resolves
correctly this way, since the reused surah applies to the whole message,
filling in whatever's missing once dedup runs; a message with NOTHING left
logged for it (e.g. every mistake from it was deleted as part of a cleanup)
finds no match and falls back to the normal prompt, exactly as before.
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
grouped by whichever surah it resolved to and shown to the user in ONE
editable `prompt()` — surah name, not just its number, every ayah about to
be filed under it (each line also showing that candidate's own ORIGINAL
Telegram message text, e.g. `"63 (M) — from \"63m\""`, not just the parsed
ref alone — see "backward pagination" above for why), and the guessed
surah number itself pre-filled in the input — once per distinct surah
group rather than once per ayah. Pressing
OK unchanged keeps the guess; editing the number and pressing OK re-tags
the WHOLE group to it ("2" or "2:" both parse fine, same as everywhere else
a surah number is typed); cancelling, or clearing the field to something
invalid, drops that group entirely rather than falling back to the
original guess — same "never assume" rule as `promptTelegramMessageSurah()`
itself. (An earlier version used a `confirm()` — "Is that the right
surah?" — followed by a SEPARATE blank `prompt()` only on decline; collapsed
into one editable prompt since confirm()/prompt()'s generic "Cancel"/"OK"
labels didn't make clear that Cancel meant "let me type the correct one,"
not "abort the whole import," and a real user hit exactly that confusion.
Pre-filling here is safe in a way pre-filling `promptTelegramMessageSurah()`
never was: this value is a fresh, transparent guess computed for and shown
alongside THIS run's own actual ayat, not a stale leftover from an
unrelated UI element with no visible connection to what's being imported.)
A candidate whose own message
declared its own `"N:"` line (`viaOwnOverride: true`) is trusted as-is and
never enters this review at all — even if it happens to share a surah with
some carry-forward candidates elsewhere in the same run — since typing
`"3:"` in the very message being logged is a deliberate, in-context choice,
not an assumption; lumping it into a carry-forward group would risk
silently re-tagging a message that was never wrong just because it shares a
surah number with one that was. Runs on `newCandidatesBeforeReview` (after
an initial `telegramAyahMistakeExists` dedup against each candidate's
ORIGINAL guessed surah, not before) so a message already fully imported
under its current guess is never re-reviewed just because it gets
reconsidered again (see "no last-imported cursor" below); any group it
drops for lack of a valid corrected surah is folded into the final
confirm/alert text alongside `noSurahNote` as `badSurahNote`.

That first dedup pass can't catch everything, though: it checks each
candidate's surah BEFORE correction, so it can never match something
already saved under a DIFFERENT (corrected) surah. A stale carried-forward
surah (the Aal-i-Imran incident above) re-derives the exact same wrong
guess on every future run too, since nothing on the channel itself ever
resets it — so re-running the import always re-shows the same review
prompt, and correcting it the same way as last time produces a candidate
that now matches something already imported. `importMistakesFromTelegram()`
runs `telegramAyahMistakeExists` a SECOND time, on `reviewedCandidates`
(the review step's output, after any corrections), to catch exactly this —
without it, every re-import of a stale-carry-forward-affected message
would add a fresh duplicate on top of whatever a previous run's correction
already saved. Anything this second pass filters out is reported as
`alreadyImportedNote` (`reviewedCandidates.length - newCandidates.length`),
alongside `noSurahNote`/`badSurahNote` in the final confirm/alert text.

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
new") — purely informational as far as dedup goes, so don't confuse it
with the removed cursor: it has zero effect on which messages get
reconsidered, and is skipped when the user declines a confirm or the run
errors out before reaching that point. It DOES sync across devices via
Firebase, though — see "Cross-device sync" below for why that was added.

`TELEGRAM_LATEST_SEEN_MESSAGE_DATE_KEY` is a DIFFERENT thing entirely and
doesn't contradict "no cursor" above — it never gates which messages get
parsed (every message is still always fully reconsidered), it's a pure
freshness sanity check on the FETCH itself, run once at the very top of
`importMistakesFromTelegram()` before any parsing. A `200 OK` from the CORS
proxy isn't proof the page it returned is actually current — the proxy has
been observed to serve a stale/truncated snapshot without erroring, which
the retry logic (`fetchTelegramPageWithRetries`) can't catch, since it only
retries on an actual failure, not on stale-but-successful-looking content.
A real incident: the user posted a new Telegram message, ran the import,
got "Nothing new to import," and the message genuinely wasn't in
`ayahMistakes` — the fetch had silently returned an outdated page.
`telegramFetchLooksStale(messages)` compares the newest message's datetime
in THIS fetch against `TELEGRAM_LATEST_SEEN_MESSAGE_DATE_KEY` (the newest
ever seen across any past successful run, updated by
`recordTelegramLatestSeenMessageDate()` after every fetch that passes this
check) — a channel's messages never get less recent over time, so a fetch
whose own latest message is OLDER than one already seen is essentially
proof the page is stale/incomplete. When that happens,
`importMistakesFromTelegram()` throws immediately (surfaced as the normal
"Import from Telegram failed: ..." alert) before touching anything —
`allMessages`, `logMessages`, dedup, and every downstream step are never
reached, so a stale fetch can never wrongly claim "nothing new," never mind
silently missing something new too. No baseline yet (first-ever run) always
passes the check, same "never assume" spirit as elsewhere in this flow —
there's nothing to compare against yet, not a reason to block.

Both `importAyahMistakesFromText()` (the manual paste-import) and
`importMistakesFromTelegram()` funnel their parsed entries through the same
shared session-merge helpers — `mergeAyahMistakesIntoSessions()`,
`buildSessionSummaryParts()`, `saveMergedHizbLog()` — so a Hizb touched by
either (or a live Recitation Session) merges into one Recitation Log entry
per Hizb *per calendar day*, keyed off each mistake's own `date` (not a
single shared "now") — necessary for Telegram, since one import run can
pull in messages spanning several distinct days at once, unlike a paste
which is always all one sitting.

### Verify Telegram Import

A `.mode-wrap` right under "Import from Telegram" in the same "💾 Backup &
Import" sub-tab — a quick side-by-side check against the channel itself,
for exactly the failure mode a "no last-imported cursor, re-run any time"
design invites: silently trusting an import ran cleanly rather than
actually confirming it. `computeTelegramImportVerification()` groups every
`ayahMistakes` entry with `source === MISTAKE_SOURCE.TELEGRAM` by its own
`telegramMessageId`, sorted by that id's own numeric suffix (`"tasmee315/315"`
-> `315`) DESCENDING — the newest message first, the reverse of Telegram's
own oldest-first feed, matching how someone would actually re-check a
recent batch by scrolling the channel from the bottom up. Deliberately
scoped to Telegram-sourced entries only: a live tap or a manual paste has
no originating "message" to group by, and isn't what this view exists to
double-check. Mistakes within one message group are left in their current
array order rather than re-sorted by ayah number — the whole point is
reading the list the same way you'd read the original message, not a
Quran-order rearrangement of it that would make the two harder to compare
line-by-line. `renderTelegramImportVerificationGroup()` reuses
`.all-hizbs-mistakes-group`/`.all-hizbs-mistakes-group-title`/`.log-row`/
`.log-hizb`/`.log-mistakes`, `renderMistakeTypeBadge()`, and
`ayahTextExpandHtml()`/`toggleAyahText()` (the shared click-to-expand ayah
feature) — the exact same building blocks "All Hizbs — Mistakes" already
uses, rather than inventing parallel markup/state for what's structurally
the same kind of grouped list.

Caps the default view at the most recent `TELEGRAM_IMPORT_VERIFICATION_DEFAULT_COUNT`
(15) messages with a "Show all N messages" toggle
(`showAllTelegramImportVerification`/`toggleShowAllTelegramImportVerification()`)
— same "most-recent-first, capped by default" shape as All Revision
Clusters' own `showAllRevisionClusters`, rather than a separate
show/hide-the-whole-section switch, since a long list here is exactly as
normal as a long revision-cluster list and the section is always rendered
(just possibly showing a "Nothing yet" status message), never hidden
behind an extra click to reveal in the first place.

`renderTelegramImportVerification()` is called from every single place
`renderAllHizbsMistakes()` already is (paired identically, same as
`renderAllRevisionClusters(); renderAllHizbsMistakes();` already appears
together everywhere) — anywhere `ayahMistakes` might have changed is
exactly the same set of places this view needs to refresh too, so
piggy-backing on that existing, already-correct call list was more
reliable than trying to enumerate a new one from scratch.

## Zero-mistake Hizb sessions ("hN" flags, review.html)

A whole Hizb recited with ZERO mistakes had no way to leave a Recitation
Log record before this: both `importAyahMistakesFromText()` (paste-import)
and `importMistakesFromTelegram()` only ever create/merge a session as a
side effect of `mergeAyahMistakesIntoSessions(newMistakes)` — no mistakes
means nothing to merge, means no session, means the sitting itself goes
unrecorded even though it happened.

`parseHizbCleanSessionFlagsText(text)` is a THIRD independent pass over the
same pasted/Telegram text (alongside `parseAyahMistakesText` and
`parsePageFlagsText`), picking out `/^h(\d+)\b/i` lines — e.g. `"h5"` or
`"H5 alhamdulillah"` (trailing text accepted, discarded — Recitation Log
sessions have no note field, unlike a page flag's own note). Deliberately
a Hizb number, not a surah: an earlier proposal was `"3::"` (a surah
number, double colon) but was dropped before implementation once it became
clear a surah can span several Hizbs — Al-Baqara, the user's main surah,
spans Hizb 1-5 — so a surah-only flag couldn't say which one was actually
clean; a Hizb number has no such ambiguity.

`ensureZeroMistakeHizbSessions(effectiveLog, flags)` is the naturally-
idempotent core: for each `{hizb, date}` flag, creates a
`{id, hizb, mistakes: 0, date}` session only if none already exists for
that Hizb+day in `effectiveLog` — however that existing session
originated (live, paste, Telegram, or a duplicate/repeated clean flag),
there's nothing left for a clean flag to add once a sitting is already on
record. Deliberately produces no "merged" outcome the way
`mergeAyahMistakesIntoSessions()` does — a clean flag never bumps an
existing session's tally, only ever creates one if none exists. This is
also what makes the whole feature safe to re-run with NO per-message dedup
tracking at all (no Telegram-specific `telegramHizbCleanExists()` — unlike
`telegramAyahMistakeExists()`/`telegramPracticePageExists()`): the only
observable effect is "a session exists for this Hizb+day", so deleting
that session and re-running the import correctly recreates it, and running
it again while the session still exists is a true no-op — same
existence-based resilience as ayah mistakes/page flags, achieved without
needing to remember *which* message contributed the flag.

`effectiveLog` matters: both callers pass `existingLog.concat(newSessions)`
(this run's own about-to-be-created ayah-mistake sessions), not just
`loadHizbLog()`, so a message with both real mistakes AND an `"hN"` flag
for the same Hizb+day creates exactly one session, not two.
`importMistakesFromTelegram()` additionally computes a throwaway
`potentialCleanNewSessions` EARLY (before the surah-review/validity steps,
using unfiltered `allCleanFlagCandidates` mapped to `{hizb, date}` — note
`.telegramDate`, not `.date`, is what gets attached when building
candidates, so every call site has to map it explicitly) purely so the
existing "nothing found"/"nothing new" gates don't fire wrongly just
because an `"hN"` flag is present — mirrors how `newPageCandidates` also
isn't range-filtered until its own later invalid-range confirm, so an
out-of-range Hizb (not 1-60) still counts as "something to look at" at the
gate stage, reaching its own confirm later exactly like an out-of-range
page number does.

Both callers also handle the "everything got filtered out" case
uniformly, regardless of *why*: `importAyahMistakesFromText()` checks
`newMistakes.length === 0 && newPageFlags.length === 0 &&
cleanNewSessions.length === 0` right before building the confirm dialog
and, if true, alerts "Nothing left to add..." and returns `false` instead
of proceeding to a confirm built from an empty summary (a real bug caught
before shipping: an `"hN"`-only paste for an already-satisfied Hizb used
to fall through to a blank `"Add ?"` confirm and `"Added ."` alert, since
nothing in the pre-existing code anticipated a paste that's entirely a
no-op). `importMistakesFromTelegram()`'s existing "Nothing new to
import"/"Nothing left to import" gates were extended the same way, folding
`cleanNewSessions.length` into their conditions rather than adding a
fourth, separate empty-state alert.

## Practice More (review.html)

A self-set drill goal — an ayah RANGE ("practice 2:15-23 twenty times") OR
a whole mushaf PAGE ("revisit page 15 five times") — that isn't a mistake
or a flag at all, just a target the user picks for themselves (e.g.
because they keep tripping on a transition, even without a specific
logged mistake there). Stored in ONE array, `practiceRanges`
(`{ id, kind, surah?, ayahStart?, ayahEnd?, page?, target, practiced,
note, dateAdded, source, telegramMessageId }`,
`LOG_KEYS.review.practiceRanges` / `quranReviewPracticeRanges`) — `kind`
is `'range'` (`surah`/`ayahStart`/`ayahEnd` set, `page` absent) or
`'page'` (`page` set, the ayah fields absent). Never mixed into
`ayahMistakes`, never tied to a Hizb Log session, since neither a page
flag nor an ayah-range goal is something recited in a sitting. `practiced`
is a plain count the user updates themselves — nothing else in the app
ever increments it; logging a mistake on one of those ayat/that page, or
reciting through it in a live Recitation Session, has zero effect on this
count, since the two concepts are unrelated. `target` is a reference
number, not an enforced cap — there's no auto-complete-and-remove at
`practiced === target`; the only way to remove an entry is the user's own
🗑 button, since they may want to keep going past the target or stop
early.

**This used to be two separate features** — this list, and a standalone
"Pages Needing Review" section whose flags had no repeat-count at all,
just a bare note. A real user asked for them to merge: a whole-page goal
and an ayah-range goal are really the same idea at two different scopes,
not two different features, especially once page flags needed their own
target/practiced tracking too (a "pN" flag used to just mean "look at
this again sometime," with no way to say how many times). `"pN"` (e.g.
`"p15"`, case-insensitive, in the paste-import textarea or a Telegram
message) now creates a `kind: 'page'` Practice More entry instead of a
separate page-flag record — `PAGE_PRACTICE_DEFAULT_TARGET` (5) is
assumed when the line gives no explicit count, since flagging a page has
always implicitly meant "come back to this a few times"; `"pNxT"` (e.g.
`"p15x20"` or `"p15 x20"`, mirroring the `"rM-Kx T"` range syntax below)
sets a specific target instead. `parsePageFlagsText(text)` remains a
fully independent second pass over the same text `parseAyahMistakesText()`
already scans — a `"pN"` line never starts with a digit, so
`parseAyahMistakesText` already ignores it on its own, and this shape
(page/target/note) fits none of the other parsers.

Data-model migration for existing users: three read paths all still
accept the OLD standalone shape (`{ page, note, date, source,
telegramMessageId }`, no target/practiced) and fold it into a `kind:
'page'` Practice More entry via a shared `migrateLegacyPageEntries()`
helper (or an inline equivalent in log.js, which can't import
review.html's own function) — `normalizeSyncPayload()` for a Firestore
doc pushed by a device before this merge shipped, `applyFullLogData()`/
`importLogData()` for a hand-edited backup file exported before it, and
(the one NOT read-only) `migrateLegacyPagesNeedingReview()` — called
once on every page load, alongside `repairImportedMistakeHizbs()` — for a
device's own `quranReviewPagesNeedingReview` localStorage key, migrating
whatever's there into `practiceRanges` and clearing the old key (no-op,
safe to call every load, once already migrated — same "self-heal" pattern
`repairImportedMistakeHizbs()` established). `buildFullLogData()`/
`buildSyncPayload()` never WRITE the old separate field anymore, only
`practiceRanges` — going forward there's exactly one place page goals
live.

review.html's Review & Analyze sub-tab has one merged "Practice More"
section (next to "Needs Attention", per the same reasoning that both are
self-curated lists layered on top of the ayah-mistake data, not mistake
counts themselves) with TWO add forms — ayah range (surah `<select>`,
from/to ayah `<input>`s, target `<input>`, optional note) feeding
`addPracticeRange()`, validated with `ayahIsInSurah()` (both ends) plus
`ayahStart <= ayahEnd` and `target >= 1`; and whole page (page number
`<input>`, target `<input>`, optional note) feeding `addPracticePage()`,
validated as `1-604` plus `target >= 1` — both alert rather than silently
clamping/rejecting, same "never silently guess" spirit as the rest of
this app. `renderPracticeRanges()` lists BOTH kinds together,
most-recently-added first; each row's `practiced` count is a plain
editable `<input type="number">` wired to `onchange` (fires on
blur/Enter, not per keystroke — an `oninput`-triggered re-render would
fight the user mid-edit) calling `updatePracticeRangeCount(id, value)`,
which clamps a negative or non-numeric value to 0 rather than rejecting
it outright — unlike the add forms' validation, there's no realistic way
to "mistype" a practiced count into something worth alerting about, so
this one just corrects silently. A `kind: 'range'` row also shows the
opening words of its FIRST and LAST ayah underneath (the second one
skipped when the range is a single ayah, so `2:15` doesn't show the same
words twice) — reuses `allClustersSurahCache`/`clusterAyahBeginning`, the
exact same on-device cache "All Hizbs — Mistakes" and "All Revision
Clusters" already populate for their own opening-words previews, rather
than a new one, and (unlike those two) shows it unconditionally rather
than gating it behind an expand click, since a practice range's whole
point is recognizing what you're about to drill without extra taps. This
makes `renderPracticeRanges()` (and `buildPracticeRangesPrintSection()`
below) `async` — every caller already fire-and-forgets both (same as
`renderAllRevisionClusters()` elsewhere), so no production caller needed
to change, but every test call site does need an `await` now, since even
the "nothing to fetch" path still defers past a microtask once the
function signature is async. A `kind: 'page'` row is ALSO
click-to-expand (tap to fetch and reveal that page's full text, same as
the removed "Pages Needing Review" section used to do) —
`expandedPageKey`/`pageTextCache`/`ensurePageTextCached()`/
`togglePageText()`/`pageTextExpandHtml()` (backed by `quran-cache.js`'s
`fetchPageData()`, a deliberately separate cache/state from the ayah-text
one since a page's fetch shape — many ayahs, possibly spanning two
surahs — is different enough to want its own) are unchanged from before
the merge, just now called from the merged render function instead of a
dedicated one; `event.stopPropagation()` on the row's count input and 🗑
button keeps interacting with either of those from also toggling the
expand.

Also enterable via a `"rM-Kx T"` line (case-insensitive,
`"r15-23x20"` or `"R1-1x5 memorize this one"`) in the paste-import
textarea or a Telegram message — `parsePracticeRangeFlagsText(text,
initialSurah)`, a fully independent fourth pass over the same text
alongside `parseAyahMistakesText`/`parsePageFlagsText`/
`parseHizbCleanSessionFlagsText`, same reasoning as those: an `"rM-..."`
line never starts with a digit, so the ayah parser already ignores it on
its own, and this shape (ayah-range/target) fits none of the others.

An earlier version put the surah IN the line (`"rN:M-Kx T"`, e.g.
`"r2:15-23x20"`), requiring it explicitly rather than reusing whichever
surah a bare ayah-mistake line would fall under — deliberately, to
sidestep ever needing the carry-forward/stale-surah/surah-review problem
class `"Import from Telegram"` above spent so much effort solving for
ayah mistakes. In practice this made the line MORE confusing, not less:
stacking a second surah number onto the existing colon/dash/`x`
punctuation (`r2:15-23x20`) was harder to read and type than the ayah
mistakes the user already logs daily right above it. The current design
drops the inline surah entirely and reuses whichever surah is already
active from an earlier `"N:"` override — exactly the same carry-forward a
bare ayah-mistake line already uses — so `"r15-23x20"` right after a
`"2:"` line means Surah 2, ayat 15-23, same as a bare ayah number would.
`parsePracticeRangeFlagsText` does its OWN internal `"N:"`-line tracking
over the given text (mirroring `parseAyahMistakesText`'s own
`activeSurah` tracking, kept as a second small implementation rather than
merged into that function since its return shape is depended on
elsewhere and shouldn't change — same reasoning `endingSurahAfterParsing`
gives for staying separate) — `initialSurah` seeds it, matching
`parseAyahMistakesText`'s own second argument (the paste-import
dropdown's value, or the Telegram loop's own `activeSurah` before this
message). This means a practice-range candidate CAN still need a surah
prompt, exactly like an ayah mistake: `importMistakesFromTelegram()`'s
per-message `needsSurah` check now runs BOTH
`parseAyahMistakesText(msg.text, trialSurah).some(e => !e.surah)` and
`parsePracticeRangeFlagsText(msg.text, trialSurah).some(r => !r.surah)`,
so a message that's ONLY a practice range with no surah established yet
prompts exactly like a bare ayah-mistake-only message would — never
guessed. The `knownSurahForMessage` re-prompt-avoidance lookup (skip
asking again for a message already answered once) was widened the same
way: it now also checks `practiceRanges` for a prior entry from this
`telegramMessageId`, not just `ayahMistakes` — otherwise a message that
only ever contributed a practice range would re-prompt on every future
run even once fully imported, since dedup only skips CREATING the
duplicate, not the surah question asked before dedup runs.
`looksLikeAyahLogMessage()` was extended to recognize an `"rM-..."` line
as real log data alongside `"pN"`/`"hN"`.

The range separator itself accepts a plain hyphen OR any of the dash
lookalikes phone-keyboard autocorrect/smart-punctuation is known to
silently substitute while typing (en dash `–`, em dash `—`, minus sign
`−`) — a real incident: a message typed as `"r81-88x15"` arrived on the
channel as `"r81–88x15"` (en dash), which an ASCII-only `-` in the regex
failed to match at all. This failure mode is worse than an "invalid,
skipped" case: the line doesn't look like anything to ANY parser (same as
a blank line or a title), so it silently contributes nothing — no
candidate to reject, no confirm dialog to mention it, nothing in
`skippedNoSurah` either, since surah resolution never even got as far as
noticing a practice-range line was there. It just vanishes, and unless
the rest of the same message/run happens to fail too (making the whole
run visibly produce nothing), there's no signal anywhere that anything
went wrong.

Dedup for Telegram-sourced practice ranges is `telegramPracticeRangeExists(
telegramMessageId, surah, ayahStart, ayahEnd)`, existence-based against
current `practiceRanges` filtered to `kind === 'range'`, keyed on the
IDENTITY fields only (message + surah + range), not `target`/`note`/
`practiced` — so deleting a range and re-running Import from Telegram
brings it back (same reasoning as every other existence-based dedup in
this app), but a re-import also never overwrites a target the user has
since edited or a count they've since updated on the page; a re-import
only ever adds what's missing, never syncs mutable fields back from the
source message. `telegramPracticePageExists(telegramMessageId, page)` is
the `kind === 'page'` counterpart, same reasoning.

`buildPracticeRangesPrintSection()`'s 🖨️ Print output shows the same
start/end opening words as the on-screen list, reusing the exact
`.cluster-print-item`/`.cluster-print-head`/`.cluster-print-ref`/
`.cluster-print-stats`/`.cluster-print-ayah`/`.cluster-print-ayah-label`/
`.ayah-ar` markup revision-cluster print rows already use (via
`clusterAyahBeginning(..., PRINT_AYAH_PREVIEW_WORD_LIMIT)` for print's
longer preview), rather than inventing parallel print-only classes — a
`kind: 'page'` entry gets just the head (ref + practiced/target stats, no
ayah blocks), since a page flag has no single "opening ayah" to preview.

Since `allClustersSurahCache` is a module-level `Map` that never clears
and persists for a WHOLE test file run (same caveat `printAllHizbsMistakes`'s
own tests document), any test asserting on a specific surah's opening
words must use a surah number no OTHER test in the file has already
triggered an unstubbed `fetchSurahData` call for — once a surah is cached
(even as `null`, from a failed real fetch), it's never re-fetched, so a
later test's own `w.fetchSurahData` stub for that same surah is silently
never consulted. `addPracticeRange`'s own test (surah 2, via the real
production code path, which fire-and-forgets `renderPracticeRanges()`
unstubbed) is one such trigger already in this file — the beginning-words
tests use surah 3 and 4 instead specifically to avoid it, and avoid each
other in turn (the single-ayah-range test can't reuse surah 3 either,
since the row-rendering test right before it already cached it).

`buildSyncPayload()`/`applySyncPayload()`/`normalizeSyncPayload()`,
`buildFullLogData()`/`applyFullLogData()` (log.js), and review.html's own
`importLogData()` all carry `practiceRanges` through exactly like the
other four `review` fields — a fifth independently-optional one, same
"defaults to empty, never `undefined`" rule the others already followed.

## Print reports (review.html)

`printHtmlDocument(win, title, bodyHtml)` is the one shared print-window
shell — `<style>` block, `.print-header` (title + "Generated ..." timestamp,
underlined with a green accent rule), `<body>` — behind every 🖨️ Print
button on the page (`printAllHizbsMistakes`, `printAyahMistakeRanking`,
`printRecitationLogMistakes`, `printAllRevisionClusters`,
`printProgressReport`, `printSelectedSections` — see "Print sub-tab"
below — hizb.html's own). A change to this shared shell
(e.g. the header styling) affects every one of them; a class scoped to one
report's own body markup (e.g. `.hizb-mistakes-print-*`) only affects that
one, even though the `<style>` block itself is shared and always fully
present regardless of which report is open. A single one-shot
write-and-print, no options — every caller including
`printAllHizbsMistakes` (see below) uses it exactly the same way now.

The shared `<style>` block's plain `h2` rule is every top-level SECTION
heading's only styling (e.g. "Practice More", "Mutashabihat", "Top N
Revision Clusters — timeframe") — deliberately distinct from
`.hizb-mistakes-print-group h2`'s green accent-band, which marks a
per-Hizb GROUP heading nested one level down inside the Mistakes section
(conflating the two would blur that hierarchy, so the group rule
explicitly resets `border-bottom: none` rather than inheriting the plain
rule's bottom rule). A real user complaint: at the original 0.95rem with
only a 3px bottom margin, a section title was barely distinguishable from
the item refs (e.g. "1. 2:81-88 — Al-Baqara") printed directly under it,
especially once several sections were combined via the Print sub-tab and
their headings all ran together with no visible separation. The current
rule (1.05rem, bold, a subtle bottom rule, real top margin, `:first-of-type`
zeroing the top margin on the very first heading right under
`.print-header`) gives each section a clear boundary without touching the
per-Hizb group styling. Since this rule lives in `<head>`, ahead of every
section's own body text, its own explanatory comment deliberately avoids
spelling out a real section title (e.g. writing "Practice More" verbatim)
— a real bug caught before shipping: `printSelectedSections`' own test
asserts section ORDER via a plain `captured.indexOf('Practice More')`
string search over the whole document, and the comment's own occurrence
of that exact phrase (sitting in `<head>`, before any section's real body
text) was found first, making the order assertion fail even though the
actual printed content was in the correct order.

`printAllHizbsMistakes()`'s own output has gone through seven real designs.
Originally a single narrow column of bullets — dense but left roughly half
the page blank on the right, since Latin/Arabic list lines rarely reach
full page width even though the container did. A second attempt fixed
that with CSS multi-column (`column-count: 2` on a wrapper around every
Hizb group) — looked correct in an on-screen preview, but a real user's
actual printed/print-previewed output came back single-column anyway:
multi-column reflow's per-page fragmentation behavior is a well-known
cross-browser/print-engine weak spot, and it can silently fall back to one
column with no visible error, which is exactly what happened. A third
attempt (still wrong) replaced that with an EXPLICIT split in JS instead
of CSS reflow — two literal `<div class="hizb-mistakes-print-col">`
siblings in a `display: flex` row, weight-balanced by approximating each
group's height from its own mistake count — which fixed the "silently one
column" failure but exposed a DIFFERENT real bug: with only ONE global
left/right split and no concept of a PAGE at all, a long column's overflow
just spilled onto a later printed page on its own, with nothing beside it,
while the other (shorter) column sat mostly blank on the first page —
exactly the "wasted whitespace, misaligned columns" a real user hit and
reported.

A fourth attempt tried to fix that properly by actually PAGINATING —
writing the document twice (once flat, to measure each Hizb group's real
`offsetHeight` in this browser's own rendering, then again with groups
assigned to explicit per-page left/right slots based on those
measurements and an estimated page-height budget) rather than doing one
global column split and hoping print pagination sorted out the rest. This
verified as correct on-screen and in an iframe-based automated check, but
FAILED in the same real user's actual printed output, worse than before:
a 16-item Hizb group split mid-list across two pages, with the leftover
tail landing in what looked like the LEFT column position on page 2 while
the right column sat completely empty. The root cause was deeper than
mismeasured heights — it turned out **`display: flex` itself does not
reliably fragment a row across multiple PRINTED pages**, the same
fundamental class of problem CSS multi-column already had, just
manifesting differently (a flex row can split its items apart across a
page boundary in ways that detach one column's overflow from the other,
rather than collapsing to one column outright). No amount of more
accurate height measurement could fix a technique that doesn't fragment
predictably to begin with. This was also the point at which it became
clear that even genuine real-browser/iframe verification — as opposed to
jsdom — is NOT sufficient to catch print-specific pagination bugs; only
actual print/print-preview output can fully validate this, and that isn't
something browser automation in this environment can drive directly.

A fifth attempt abandoned per-page pagination arithmetic entirely and
switched the container from flex to plain **CSS floats**, but kept the
FOURTH design's other simplification of doing one global weight-balanced
left/right split of the whole Hizb-ascending list (by mistake count, not
measured pixels) rather than deciding real page breaks — reasoning that
floats fragment reliably across pages regardless, so a global split plus
"let each column paginate on its own across however many physical pages it
needs" should be enough. This verified fine on-screen (two evenly-loaded
columns for a small dataset), shipped, and then FAILED in the same real
user's next actual printed output — not with misaligned/split content this
time, but with exactly the wasted-whitespace problem the whole saga
started from: a real Hizb 1/2/3/4/6 dataset split into one huge left
column (Hizb 1+2+3, 33 mistakes) and one short right column (Hizb 4+6, 8
mistakes); the left column alone needed 3 physical pages, so pages 2 and 3
each showed a lone left column with the ENTIRE right column blank — a
worse whitespace waste than any earlier design. The bug wasn't
misalignment (floats did fragment the oversized left column cleanly, as
expected) — it was that a single global split can only ever balance the
TOTAL content between two columns, not how it lands page by page; nothing
about "fragments reliably" changes that a whole-document split with no
page awareness will starve every page after the first of the shorter
column's content once that column runs out.

A sixth attempt combined the fourth and fifth designs' correct halves
instead of either one alone: PAGINATE for real (measure each Hizb group's
actual `offsetHeight`, decide real per-page column assignments via a
restored `paginateGroupsIntoColumns`) but render each page's two-column
pair with CSS floats instead of flex, reasoning that once real measurement
sizes each page's own column pair to fit within ONE physical page, the
floats would never need to fragment across a page boundary in the normal
case. This verified correctly in an automated real-browser iframe check
(a page-1/page-2 split with well-balanced columns on a synthetic dataset)
and STILL FAILED on the same real user's next actual printed output: a
16-item Hizb group again split across two pages with its tail landing in
the wrong column position, functionally the same failure as the fourth
design's. The root cause turned out to be one level deeper than "flex vs.
float" or "measure vs. don't measure": **the page-height budget itself
can't be computed reliably from `@page` margins in CSS at all**, because
Chrome's own print output adds its own header/footer (the URL/date/
page-number lines visible in every screenshot of this bug) that consumes
real content height in a way nothing on this page can see or measure in
advance — so the "real measurement" was measuring the right thing (each
group's rendered height) against the wrong, silently-too-generous budget,
and once a page's actual content slightly exceeds what Chrome could really
fit, the float pair fragments across that unplanned page boundary, and
float fragmentation across a *forced* page break does not reliably
preserve which side is "left" and which is "right" — the same class of
misalignment as the third design's flex bug, just triggered by a different
mechanism. Four independent two-column techniques (multi-column, flex,
floats-with-global-split, floats-with-real-measurement) had now each
failed in real print in a different way, which was the point at which it
became clear the actual invariant to design around isn't "which CSS
layout technique" but "this page cannot know how tall a printed page
really will be" — no CSS or JS on this page can see the user's chosen
paper size, margins, scale, or Chrome's own header/footer reservation
ahead of time, so ANY design that needs that number to decide where
content goes is, by construction, unreliable.

The current (seventh) design sidesteps that unknowable number entirely by
never needing it: **one plain, full-width column, no float, no flex, no
CSS multi-column, and no page-height measurement/pagination step at all**.
`printAllHizbsMistakes()` is back to a single `printHtmlDocument()` call —
Hizb groups rendered Hizb-ascending, one after another, in ordinary
top-to-bottom document flow. This is the one case that doesn't need to
know how tall a page is, because it never has to decide what goes in a
"second column" — the browser just keeps flowing content down the page and
starts a fresh page when it runs out of room, which is the single thing
browsers have paginated correctly and consistently since the web began
(every long article anyone has ever printed relies on exactly this). The
`PRINT_PAGE_HEIGHT_BUDGET_PX`/`PRINT_COLUMN_MEASURE_WIDTH_PX` constants,
`paginateGroupsIntoColumns`, the `hizb-mistakes-print-col(umns)` classes,
and `printHtmlDocument()`'s two-phase `options.skipPrint`/
`#print-body-content` machinery (all specific to measuring/pausing for a
rebuild before the real print) were removed along with it — there is
nothing left to measure or paginate in JS. The tradeoff, accepted
deliberately after four straight real-print failures of the two-column
alternative: a long list now takes more physical pages than a perfectly
packed two-column layout would in the best case, in exchange for a design
that structurally cannot reproduce any of the six bugs above, because none
of their preconditions (a column split, a page-height guess, a
cross-page-fragmenting layout primitive) exist anymore.

Each Hizb group (`<div class="hizb-mistakes-print-group">`, a `<h2>` + `<ul
class="hizb-mistakes-print-list">`) still gets `page-break-inside: avoid`
so it doesn't split across a page boundary; a Hizb long enough to exceed a
full page on its own can still be forced to split — an unavoidable
tradeoff of any print layout, same as before.

Each mistake's own opening words (`clusterAyahBeginning`) render INLINE at
the end of the same `<li>` — `<span class="hizb-mistakes-print-beginning
ayah-ar">`, not the block-level `<div>` it used to be — rather than on
their own line below the ref/date/note. This was the OTHER real lever on
page count: one line per mistake instead of two roughly halves how much
vertical space (and therefore how many printed pages) a long list takes.
Safe to inline despite mixing an LTR line (ref, surah name, date, English
note) with an RTL span (the Arabic opening words) — this is the same kind
of mixed-direction text as quoting Arabic mid-sentence in an English
document, which the browser's own Unicode bidi algorithm already handles
correctly on its own; no special escaping or reordering needed. (The
block-level version's own `width: fit-content` — needed there specifically
because `.ayah-ar`'s `direction: rtl` + `text-align: right` would otherwise
right-align a block against the FULL column width, stranding it far from
its bullet — has no equivalent problem as an inline span, since inline
elements never take a block's full width to begin with.)

Each mistake's type code(s) render as small colored chips (`printMistakeTypeBadgeHtml()`,
mirroring `renderMistakeTypeBadge()`'s S/B/W/M/T/E/K/A → `MISTAKE_TYPE_META`
splitting) instead of a bare letter appended to the ref — a print window is
a fresh document with no access to this page's CSS custom properties, so
`.print-type-badge.type-*` hardcodes each type's LIGHT-mode hex pair
(`--type-e-bg`/`--type-e-text` etc.) rather than referencing the vars
themselves. Each Hizb's own `<h2>` gets a light green left-accent band
(same accent as the header rule) instead of a bare heading, both to break
up the page visually and to make each Hizb's boundary easy to spot at a
glance when scanning two columns instead of one.

## Print sub-tab (review.html)

Hizb Log's 5th sub-tab, "🖨️ Print" (alongside "📝 Log a Session",
"📊 Review & Analyze", "📜 Clusters & History", "💾 Backup & Import" —
`setLogSubview()`/`.log-subview-*`), builds ONE combined printable
document from whichever of four sections are checked — a single page to
hand a teacher/reviewer instead of printing several separate reports.
Defaults to All Hizbs — Mistakes (Last Session) + Mutashabihat + Top 5
Revision Clusters (Last 7 Days) checked, Practice More unchecked — the
three checked-by-default ones are what's most useful after a typical
sitting, the fourth a less routine, occasional thing to share. Each
section has its own dropdown(s) (timeframe for Mistakes; count + timeframe
for Clusters) that override the defaults; Mutashabihat and Practice More
have none, since neither has anything meaningful to filter by.

Every section's content is built by its own dedicated function, and
`printSelectedSections()` (the "🖨️ Print Selected" button) just calls
whichever are checked and joins their returned HTML:

- **All Hizbs — Mistakes**: `buildAllHizbsMistakesPrintBody(timeframe,
  includeAttention)` — extracted from `printAllHizbsMistakes()` itself
  (which now just calls this and wraps it in `printHtmlDocument()`), so the
  combined report is GUARANTEED to match that section's own standalone
  print exactly, not a re-derived approximation of it — the one explicit
  requirement this feature was built to satisfy. Returns `{ timeframeLabel,
  body }`, `body` empty when there are no mistakes in the timeframe (the
  caller — either `printAllHizbsMistakes()` or the composer — decides what
  an empty section looks like, since a standalone print's empty state and a
  combined report's empty state read differently).
- **Mutashabihat**: `buildMutashabihatPrintSection()`, entirely new — no
  existing print covered this. Unlike a revision cluster, a mutashabihat
  group has no "start/end" (it's a curated list of ayat the user finds easy
  to confuse, not a contiguous range), so every ayah in a group prints,
  each with its own opening words via `clusterAyahBeginning` — not just
  two of them. Reuses the `.cluster-print-item`/`-head`/`-ref`/`-stats`/
  `-ayah` CSS classes rather than inventing parallel ones, since the shape
  (a heading line + a list of ref+opening-words blocks) is exactly the
  same. Ranked via `rankMutashabihatGroups()`, the same function the
  on-screen "Your Mutashabihat Groups" list already ranks by (most
  logged-mistake-count first), so the print order matches what's shown on
  the page.
- **Top Revision Clusters**: `buildRevisionClustersPrintSection(count,
  timeframe)` — reuses `renderClusterPrintItem()` (the shared "Start —
  ref + opening words" / "End — ref + opening words" item both "All
  Revision Clusters" and the Hizb Overview "📊 Print Report" already use),
  same reasoning as the Mistakes section: never a different rendering just
  for this composer. `timeframe === 'last-session'` reuses
  `computeLatestSessionClustersForAllHizb()` (same as "All Revision
  Clusters" does for that mode); every other timeframe reuses
  `computeAllRevisionClusters(timeframe)`. Both are already sorted
  most-mistakes-first, so `.slice(0, count)` is a genuine "top N", not an
  arbitrary prefix.
- **Practice More**: `buildPracticeRangesPrintSection()` — a plain list
  covering BOTH kinds of entry (see "Practice More" above for why they're
  one merged concept): a range shows its ref + practiced/target counts,
  a page shows "Page N" + the same counts, both with their note. Replaced
  a `buildPagesNeedingReviewPrintSection()` that predates the Pages
  Needing Review/Practice More merge. No full ayah/page text either way:
  that's a click-to-expand affordance on-screen, backed by a live
  `fetchSurahData()`/`fetchPageData()` call, which isn't something a
  multi-section batch print needs by default.

`printSelectedSections()` alerts "Pick at least one section to print" and
returns before opening a window if all four checkboxes are unchecked —
same reasoning as `importAyahMistakesFromText()`'s own "nothing left to
add" gate elsewhere in this file: never show a blank/near-blank print
window when there's structurally nothing to show. Otherwise `window.open()`
happens synchronously (before any `await`, same reason every other print
function's own comment gives — a blocked pop-up otherwise), then each
checked section's builder runs in the sub-tab's own display order
(Mistakes, Mutashabihat, Clusters, Practice More) and the results are
joined and handed to `printHtmlDocument()` once, under the plain title
"Print" (each section supplies its own `<h2>` — using the page's normal
`h2` styling, not `.hizb-mistakes-print-group h2`'s green accent band,
which visually distinguishes a top-level SECTION heading from a per-Hizb
GROUP heading within the Mistakes section).

## Editing an ayah mistake in place (review.html)

`ayahMistakeEditRowHtml(m)` is the one shared inline edit form (surah
`<select>`, ayah number `<input>`, `MISTAKE_TYPE_META` checkboxes, note
text) for an ayah mistake — used by "Edit individual ayah mistakes" (its
original home), and also by All Hizbs — Mistakes and Ayat You Mistake Most
for any row that maps 1:1 to a single mistake (`count === 1` — its
`.entries[0]` is that one real entry with a real `id`; a `count > 1`
aggregated row has no single entry to point the form at, so editing there
only happens per-tap after expanding, via `renderMistakeEntriesDetail`,
which now also renders this same form in place of a tap's row when that
tap's own `id` is being edited). `editingAyahMistakeId` (a single global —
only one row can be mid-edit anywhere on the page at once) is checked by
all of these render functions, so `startAyahMistakeEdit()`/
`cancelAyahMistakeEdit()`/`saveAyahMistakeEdit()`/`deleteAyahMistake()` all
re-render `renderAyahMistakeLog()`, `renderAyahMistakeRanking()`, AND
`renderAllHizbsMistakes()` together — whichever section the edit was
started from, and any other section currently showing that same mistake,
both update in sync.

`saveAyahMistakeEdit()` recomputes `hizb` (via `hizbOfGlobalAyah`, same
call as `repairImportedMistakeHizbs()` uses) whenever it saves, since
every Hizb-grouped view (All Hizbs — Mistakes, Hizb Overview, revision
clusters, hizb.html) reads a mistake's stored `hizb` field rather than
recomputing it from `surah`/`ayah` live — fixing a mis-typed ayah number
(e.g. a Telegram typo, "259" meant to be "249") through this form is what
actually moves it into its correct Hizb's group everywhere, not just what
updates the ayah number shown. (A real gap before this: the edit form
already let you change surah/ayah, but `hizb` was silently left stale,
so a "fixed" mistake kept showing up under its old, wrong Hizb until this
was caught.)

Recomputing `hizb` alone surfaced a second, subtler real bug:
`ayahMistakesForSession()`/`ayahMistakesForSessions()` (mistake-analytics.js)
match a mistake to a Recitation Log session by BOTH `hizb` AND `sessionId`
together (`sameHizb.filter(m => m.sessionId === sessionEntry.id)`) — a
hizb-changing edit left `sessionId` still pointing at a session for the OLD
Hizb, so the entry matched neither the old Hizb's session (wrong `hizb`
now) nor the new Hizb's session (wrong `sessionId`) and silently vanished
from every "Last Session" view (All Hizbs — Mistakes, Ayat You Mistake
Most, Recitation Log all default to "Last Session" — see below) without
being deleted; it was still findable under "All-time", just
orphaned from every session. `saveAyahMistakeEdit()` now also re-points
`sessionId` at whatever session already exists for the NEW hizb on the
mistake's own day, if any (`null` if none exists yet — a session
represents a real recitation sitting, not something an edit should
manufacture). Deliberately does NOT adjust either session's own `mistakes`
tally in the process — same "session tallies are a fixed historical
record" rule `repairImportedMistakeHizbs()` already follows for geometry
fixes, so an edit doesn't retroactively inflate or shrink what a past
sitting's tally says happened.

Editing an ayah mistake this way only changes the LOCAL entry — if it
originally came from Telegram (`source: 'telegram'`), the Telegram message
itself still has the original typo. Since `telegramAyahMistakeExists()`
dedups on the exact `(telegramMessageId, surah, ayah)` triple, an edited
entry no longer matches what that message will produce on a future Import
from Telegram run — so re-running the import will treat the ORIGINAL
(un-fixed) ayah number as a new, not-yet-imported candidate and offer to
add it again, alongside the locally-corrected one. Fixing the typo in the
Telegram message itself (not just the local entry) is what prevents that
from recurring on every future run. `saveAyahMistakeEdit()` surfaces this
directly rather than relying on the user to remember it: whenever a
`source: MISTAKE_SOURCE.TELEGRAM` entry's `surah` or `ayah` actually
changes (checked BEFORE overwriting them, so the alert can still name the
original — a note/type-only edit, or a no-op resave of the same numbers,
triggers nothing, since there's nothing for the Telegram message to have
fallen out of sync with), an `alert()` names both the original ayah still
sitting in the message and the corrected one, once the edit has actually
saved — informational, not a confirmation gate, so it never blocks the
save itself.

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

## Merging "Last Session" and the rolling "1d"/"Today" window

review.html had FOUR timeframe selectors (All Hizbs — Mistakes, Ayat You
Mistake Most, All Revision Clusters, Recitation Log) each offering BOTH
`'last-session'` (every sitting on a Hizb's most recent real calendar day —
see `latestSessionDayEntriesForHizb` in mistake-analytics.js — however long
ago that was) AND a rolling `'1d'` window (`Date.now()` minus exactly 24
hours, labeled "Today" or "Last 1 day" depending on the section). A real
user found these confusingly similar — both nominally answer "what did I
just do" — and asked for them to mean the same thing. `'1d'` is gone
entirely now: removed from `TIMEFRAME_WINDOWS_MS`, from every selector,
and from `TIMEFRAME_LABELS` (the merger of what used to be two separate,
now-identical label maps — `CLUSTER_TIMEFRAME_LABELS`/`TODAY_TIMEFRAME_LABELS`,
which differed only in the now-deleted `'1d'` entry's own label). This is
a real, deliberate behavior narrowing, not just a rename: `'last-session'`
is the one that survived, since it's strictly more useful — a rolling
24-hour window goes empty the moment a full day passes with no session
(even if yesterday's sitting is exactly what you'd want to review), and
can split one late-night sitting across "today" and "yesterday" at
midnight; a real calendar day never does either.

While doing this, the same four review.html selectors (plus hizb.html's
two Revision Clusters cards, which didn't offer `'last-session'` at all
before this) were converted from a row of toggle buttons to a single
`<select>` (reusing `.log-edit-select`, the same class the Print sub-tab's
own dropdowns already use) — a row of 4-5 buttons repeated per section
was a lot of visual weight for "pick one of these," and removing a button
outright (rather than just hiding it) is a one-line diff in a `<select>`
versus juggling CSS/`.active`-class bookkeeping across possibly-multiple
synced copies (see hizb.html's own `.clusters-timeframe-select` class and
its `setClustersTimeframe()`, which explicitly keeps both cluster cards'
independent `<select>` elements in sync with each other, mirroring what
the old shared `.active`-toggle-on-every-matching-button did).

A real, distinct bug surfaced while auditing this: hizb.html's "Revision
Clusters (By Session)" view (`computeSessionClustersForHizb` +
`groupClustersBySession`) computed clusters per LITERAL `sessionId` and
grouped its display the same way — so a Hizb recited twice on the same
real day (two separate Log a Session submissions) showed as two entirely
separate, never-merged cluster groups under two identical date headers,
contradicting the "a whole day's sitting, not one literal timestamp"
meaning `latestSessionDayEntriesForHizb`'s own doc comment already
established for "last session" everywhere else in the app. Fixed at the
data layer, not just display: `computeSessionClustersForHizb` now groups
`loadHizbLog()` entries by calendar day FIRST (for any timeframe, not only
`'last-session'`) and pools each day's mistakes together (via
`ayahMistakesForSessions`) before clustering — same pooling
`computeLatestSessionClustersForAllHizb` already does for the all-Hizb
view — tagging the result with that day's LATEST session's id/date.
`groupClustersBySession` was also switched from keying its Map by
`sessionId` to keying by `new Date(c.sessionDate).toDateString()`, so it
stays correct even if the upstream pooling ever changes — belt and
suspenders, not strictly required once the data itself is already
day-pooled, but cheap insurance against the exact bug it replaces.
`computeRevisionClustersForHizb` (the OTHER, fully-pooled-across-the-whole-timeframe
cluster view on that page) gained `'last-session'` support the same way
`computeAllHizbsMistakes`'s own special case already worked: read
`latestSessionDayEntriesForHizb`'s sessions and pool their mistakes,
rather than falling through to `filterMistakesByTimeframe` (which doesn't
recognize `'last-session'` as a real window at all, and would have
silently treated it as unfiltered — i.e. "All-time" — same as any other
unrecognized string).

Deliberately UNCHANGED, since they're genuinely raw historical logs, not
"last session" SUMMARY views: hizb.html's own "Recitation History" (a
"Plain (non-interactive) log of every recitation," per its own comment)
and "Mistakes by Session" (browsing "each individual sitting" on purpose)
both still show one row per literal session even when two fall on the
same day — collapsing those would destroy real information (e.g. "I did
two short sittings" vs. "one long one") that a log is supposed to
preserve, unlike a "what's the state of things right now" summary.

## Agent Chat (review.html)

A fourth top-level tab (`data-view="agent"`, alongside Revise/Hizb Log/
Mutashabihat — `setView()`) — a conversational assistant, grounded in the
user's own review data, for open-ended questions a fixed report/ranking
view can't answer (e.g. "Which ayat should I review in the first 100 ayat
of Al-Baqara, based on the last few weeks?"). Calls Google's Gemini API
(free tier) directly via `fetch()` — no SDK, no extra CDN script — matching
the rest of this no-build-step site.

`agent-prompt.js` is a new, deliberately separate shared file (`<script
src="agent-prompt.js">`, loaded only by review.html — not really "shared"
across pages the way `quran-data.js` etc. are, just factored out the same
way for the same reason: a top-level `const AGENT_SYSTEM_PROMPT` in its own
file is easy to keep growing over time without touching app code). It's
QUALITATIVE, user-editable context for the assistant — who the user is,
what a Hizb/mistake-type/practice-range means, what a good answer looks
like — never the user's actual data itself, which would go stale the
moment it was hardcoded; that part is always rebuilt fresh from
localStorage instead, by `buildAgentContext()` in review.html, on every
single message (never cached), so it reflects even a mistake logged
earlier in the very same chat session. `buildAgentContext()` returns raw
arrays (today's date, the `SURAHS` table's numbers/names/ayah-counts,
`MISTAKE_TYPE_META`'s codes/labels/descriptions, `memorizedHizbs`,
`ayahMistakes`, `recitationLog`, `practiceRanges`, `mutashabihatGroups`) —
not a pre-aggregated digest, since Gemini's context window is large enough
to hold a personal mistake log in full and is better at picking out what's
relevant to one specific question than a fixed summarization decided ahead
of time here, and it can never drift out of sync with this app's own
analytics as they evolve, since it's just reading the same source data
they do.

`callGeminiAgent(history, apiKey, model)` sends `AGENT_SYSTEM_PROMPT` plus
the JSON-stringified `buildAgentContext()` as the request's
`systemInstruction`, and this chat's own prior turns (mapped from this
app's `{role: 'user'|'agent'}` shape to Gemini's `{role: 'user'|'model'}`)
as `contents`. The API key is a real per-user billing credential — unlike
the Firebase client config key already embedded in this file (safe to
publish, since Firestore SECURITY RULES gate access, not the key itself),
this site's source is public on GitHub Pages, so the Gemini key is NEVER
hardcoded anywhere in it (never pasted into review.html's own source even
if the user offers to hand it over for that purpose — it must only ever be
entered into the tab's own `#agent-api-key` field, which keeps it out of
version control entirely). Entered via `saveAgentSettings()`, which writes
it to `localStorage` (`quranReviewAgentApiKey`) same as any other setting
here.

Unlike most per-device credentials, this one DOES travel through
`buildSyncPayload()`/`applySyncPayload()` (Firebase) — `review.agentApiKey`/
`review.agentModel`, written by `saveAgentSettings()` bumping
`bumpSyncUpdatedAt()` + `syncPush()` exactly like every other saved field.
This was a deliberate, explicitly-requested exception to "never sync a
secret," made only after stating the real tradeoff: the sync doc is only
as private as the account name (itself just "a passphrase, not a real
name" per "Cross-device sync" below), so anyone who guesses/learns that
name gets the key too — accepted because the account name is already
meant to be kept as private as a real password, and the payoff (entering
the key once, on whichever device is most convenient, rather than
re-pasting it on every device) was worth that to the user. It is
SPECIFICALLY still excluded from `buildFullLogData()`/`applyFullLogData()`
(the JSON backup file) — a downloaded file is far likelier to end up
shared, emailed, or committed somewhere by accident than a Firestore doc
gated by a private account name, so that channel keeps the strict "never"
rule `AGENT_API_KEY_KEY`'s own comment describes. `applySyncPayload()`
falls back to `''` (never the literal string `"undefined"`) for a doc
pushed before this synced — same rule, and same one-time transitional
tradeoff (a locally-set key can be wiped by pulling such an old doc, until
this device's own next push carries it forward), as
`telegramLastImportedAt`'s own migration. The model name
(`quranReviewAgentModel`, defaulting to `AGENT_DEFAULT_MODEL`) syncs the
same way, for the same reason, though it's not sensitive on its own — kept
alongside the key mostly so a device that picks up a synced key also picks
up whichever model the account is actually configured to use. The chat
history itself (`quranReviewAgentChatHistory`) stays local-only either way
— it's a scratchpad, not data worth syncing.

## Cross-device sync (Firebase)

The sidebar's own controls change shape with connection state, via
`updateSyncIndicator()`: disconnected, only the Account Name field and
Connect button show (`#sync-account-field`/`#sync-connect-btn`); connected,
only Push Now/Pull Now/Disconnect show (`#sync-push-btn`/`#sync-pull-btn`/
`#sync-disconnect-btn`) and the Account field hides — Push/Pull/Disconnect
have nothing to act on before a connection exists, and the field has
nothing left to type once one does (switching accounts means disconnecting
first, which brings the field back). Previously all seven controls showed
unconditionally regardless of state, which was this card's own biggest
contributor to "the sidebar takes real space even when there's nothing to
do here yet" — most sessions are "Not Connected" and never intend to
connect, so a permanently-full card was mostly wasted space, especially on
the mobile layout where this sidebar stacks ABOVE the actual page content
rather than beside it.

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
IndexedDB ayah-text cache, and `TELEGRAM_LATEST_SEEN_MESSAGE_DATE_KEY` (the
Telegram fetch staleness trip-wire — only sanity-checks a device's own
fetches against what it has personally seen, so a synced value from a
different device would be meaningless).

`TELEGRAM_LAST_IMPORTED_AT_KEY` (the "last imported" display next to the
Import from Telegram button — see "Import from Telegram" above) is NOT in
that excluded list — it's part of `review.telegramLastImportedAt` in
`buildSyncPayload()`/`applySyncPayload()`, same as any other review field.
It used to be excluded as "purely informational," on the reasoning that it
has no bearing on dedup (still true — dedup is existence-based against
`ayahMistakes` itself) — but a real user connected a second device to an
existing account and saw "Never imported yet" even though the first device
had been importing from Telegram all along, since the display genuinely
never left that first device. `saveTelegramLastImportedAt()` bumps and
pushes its own sync update (mirroring `saveAyahMistakes()`) rather than
relying on being swept up by some other save in the same import run —
`importMistakesFromTelegram()`'s "nothing new to import, but re-confirm the
timestamp" branch calls it with nothing else to save at all, so without its
own push that branch's update would sit local-only until some unrelated
future save. `applySyncPayload()` falls back to `''` (never the literal
string `"undefined"`) when pulling a doc pushed by a device running an
older version that didn't sync this field yet — `renderTelegramLastImportedAt()`
already treats an empty value the same as a device that's never run the
button itself.
`normalizeSyncPayload()`
upgrades a Firestore doc saved by the old flat `{ log, memorizedHizbs,
ayahMistakes, mutashabihatPairs, updatedAt }` shape (before tracker/habits
were synced) to the current nested one on read — same idea as
`normalizeLogData()`'s legacy-shape handling for the JSON-file import path —
so an account that hasn't pushed since this shape changed still pulls its
existing review data correctly instead of losing it to an `undefined -> []`
default; the doc itself is only upgraded for real on that device's next push.

### Import from Telegram only ever needs to run on ONE device

Import from Telegram (see its own section above) is not meant to be run
independently on every device — the CORS-proxied fetch+parse+prompt flow is
inherently the flakier, more interactive part of this app (proxy
reliability, `prompt()`-based surah questions), so it should only ever
happen once per new batch of Telegram messages, on whichever device is most
convenient. Every OTHER device connected to the same sync account is meant
to receive that result automatically — the same `saveAyahMistakes()`/
`saveHizbLog()`/`savePracticeRanges()`/`saveTelegramLastImportedAt()` calls
this feature already goes through for any other write push to Firestore
exactly like a live tap does, and a connected device picks that up via its
own `onSnapshot` live-sync listener (or "Pull Now") with no special
Telegram-specific handling needed on the receiving end.

Two gaps closed after a real report that "Telegram import doesn't work well
on other phones and laptops": every one of those saves' own `syncPush()` is
fire-and-forget (see `saveAyahMistakes()`'s own comment) — fine for a live
tap, but `importMistakesFromTelegram()`'s own success paths used to return
(and let the user dismiss the completion `alert()` and potentially close
the tab) without ever confirming any of those in-flight pushes actually
reached Firestore. Both the main "Imported ..." success path and the
"nothing new to import, but re-confirm the timestamp" branch now `await
syncPush()` once more, right after their own saves and before their own
`alert()` — since `buildSyncPayload()` reads current localStorage fresh,
this one extra push already reflects everything just saved, and awaiting
it turns "a request was sent" into "the round trip actually completed"
before the user can navigate away. Separately, if sync isn't connected on
this device at all, the import is real but permanently stuck there — the
success alert now says so explicitly (`⚠️ Sync isn't connected on this
device...`) rather than silently completing with no indication that
nothing will reach any other device; the fix is connecting to the sync
account, not re-running the import elsewhere.

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
