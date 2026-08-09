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
  `hizbOfGlobalAyah`, `globalToJuz`, `ayahIsInHizb`). Included by
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
  across every session), `computeSessionRevisionClusters`
  (clusters within just one recitation sitting) and `computeSessionClustersForHizb`
  (every session's clusters for a Hizb, flattened into one ranked list tagged
  by session — clusters here never merge across sessions, unlike the pooled
  `computeRevisionClustersForHizb`), `computeLatestSessionClustersForAllHizb`
  (every Hizb's *single most recent* session's clusters in one flat ranked
  list, tagged by Hizb — review.html's "All Revision Clusters" "Last Session"
  mode; unlike the timeframe param on `computeAllRevisionClusters`, this
  isn't a date window, it's "only this Hizb's latest sitting, whenever that
  was" — and a session can still split into more than one cluster row, same
  as any other mode), plus small chart/text helpers
  (`timeToPositionPct`, `trendTickFractions`, `ayahBeginning`). `review.html`
  separately declares its own `saveHizbLog`/`saveAyahMistakes` (writes, with a
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
`mutashabihatPairs` backs review.html's Mutashabihat tab — manually-curated
`{ ayat: [{surah, ayah}, ...], note, dateAdded }` groups of 2 or more ayat
each (not just pairs; not auto-detected — see below) — and, like
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
review.html for the pattern. `habits.html` has no such side effects, so it just calls
`applyFullLogData()` on the whole parsed file directly.

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
