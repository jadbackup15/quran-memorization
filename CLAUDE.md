# Quran Memorization site

Three standalone static HTML pages (no build step): `index.html` (home/app picker),
`quran-tracker.html` (memorization tracker), `review.html` (review/revision tool).
They share sync/localStorage keys and link to each other by relative path.

## Versioning

`version.js` defines `APP_VERSION` (semver `v1.v2.v3`) and is included by all three
pages, which display it as a small badge in their header.

Bump `APP_VERSION` in `version.js` on every commit that touches one of the three
HTML pages:
- **v3 (patch)** — tiny changes: copy tweaks, styling, small bug fixes.
- **v2 (minor)** — larger changes: new features, notable UI additions.
- **v1 (major)** — main/breaking changes: architecture shifts, data-format changes.

Bumping a higher segment resets the ones to its right to 0 (e.g. 1.2.5 -> 1.3.0 for a v2 bump).
