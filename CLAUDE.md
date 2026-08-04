# Quran Memorization site

Standalone static HTML pages (no build step): `index.html` (home/app picker),
`quran-tracker.html` (memorization tracker), `review.html` (review/revision tool),
`habits.html` (generic personal activity tracker — not Quran-specific). They share
localStorage (same origin) and link to each other by relative path.

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
recitationLog, ayahMistakes }, habits: { activities, log } }`. Each top-level section is
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
(stripping the Firebase `<script src>` and inlining `version.js`/`log.js` so
no network/HTTP server is needed) and returns its `window` — function
*declarations* in the page's inline script end up on `window` and are
callable directly (e.g. `window.hizbOfGlobalAyah(...)`), but top-level
`const`/`let` do not, matching real browser semantics; use
`test/helpers/extractConst.js` (regex + eval, no DOM) when a test needs one of
those directly, e.g. comparing the `SURAHS` table across files. Objects/arrays
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
