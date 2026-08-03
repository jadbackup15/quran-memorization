# Quran Memorization site

Standalone static HTML pages (no build step): `index.html` (home/app picker),
`quran-tracker.html` (memorization tracker), `review.html` (review/revision tool),
`habits.html` (generic personal activity tracker — not Quran-specific). They share
localStorage (same origin) and link to each other by relative path.

## Versioning

`version.js` defines `APP_VERSION` (semver `v1.v2.v3`) and is included by all three
pages, which display it as a small badge in their header.

Bump `APP_VERSION` in `version.js` on every commit that touches one of the three
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
