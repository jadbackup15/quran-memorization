# Quran Memorization

A small set of standalone, no-build-step HTML pages for tracking Quran memorization,
revision, and (optionally) other personal habits. Everything runs client-side and
saves to the browser's `localStorage`; nothing requires a server. Follows your
system's light/dark appearance automatically, and every page shares a consistent
nav bar (Home / Tracker / Review / Habits) plus a version badge in the header.

**Live site:** https://jadbackup15.github.io/quran-memorization/

## Pages

### `index.html` — Home
Landing page and app picker. Also hosts the "Account Name" control for cross-device
sync (see below) — connecting here applies to every page on the site, since they
share the same `localStorage`.

### `quran-tracker.html` — Quran Memorization Tracker
Check off which surahs/pages/ayat you've memorized. Shows overall progress (by
surah, page, and ayah) and a simple milestone planner that projects a finish date
from a memorization rate you set (e.g. "1 page per day"). Can save/load its data
to a local JSON file via the File System Access API, so progress can live in a file
you control instead of just the browser.

### `review.html` — Quran Review
Test yourself on random ayat from a chosen surah/juz/hizb/page range, and log each
Hizb recitation with a mistake count. Tracks which Hizb you've memorized, suggests
what to revise next (weighted by how long it's been and how many mistakes you've
made there), and can log mistakes down to the specific ayah to show "ayat you
mistake most" — click a Hizb (from "Suggested for Revision," the Hizb Overview
chips, or its row in the Recitation Log) to see its full history and every
ayah you've mistaken there, and click a mistake to reveal that ayah's Arabic
text and translation inline. Ayah mistakes can also be bulk-imported: pick a surah, then paste
one ayah number per line (an optional note can follow, e.g. "218 mutashabihat")
— handy for pasting in a running list kept in a notes app. The import also adds
one Recitation Log session per Hizb the pasted ayat fall in (a surah's ayat
often span several Hizbs), so it feeds the revision suggestions the same way a
live recitation session would. Supports optional cross-device sync via
Firebase, gated only by an account name/passphrase you choose (no login).
Ayah text is fetched from a public Quran API and cached on-device per surah/page
after the first request, so revisiting a surah — even offline — doesn't
re-fetch it.

### `habits.html` — Personal Tracker
A generic activity tracker, not specific to Quran work — e.g. "Workout, 2x per
week." Add an activity with a target frequency (per day/week/month), tap "Log Now"
each time you do it, and see progress against the current period plus a history of
past log entries.

## Data & backups

Every page's data lives in `localStorage`, shared across all of them since they're
served from the same origin. `review.html` and `habits.html` have "Save as JSON
File" / "Import from Local Log" buttons that export **all** pages' data into one
JSON file (via the shared `log.js`) — it's plain, indented JSON meant to be
hand-edited if needed (change a value, delete an entry, copy one to add a new one).
Importing replaces whichever section(s) are present in the file; a file can contain
just one page's data without touching the others.

## Development

No build step — open any HTML file directly, or serve the folder locally:

```
python3 -m http.server 8000
```

- `log.js` — shared JSON export/import logic used by `quran-tracker.html`,
  `review.html`, and `habits.html`. Its functions are documented with JSDoc; run
  `npm install` once, then `npm run docs` to generate a browsable API reference
  into `docs/` (open `docs/index.html`).
- `version.js` — defines the `v1.v2.v3` version badge shown on every page. See
  `CLAUDE.md` for the bump convention.
- `test/` — automated tests (Node's built-in test runner + jsdom, no browser
  needed). Run `npm install` once, then `npm test`. Covers `log.js`'s
  export/import logic, the pure Hizb/ayah math and mistake-paste parsing in
  `review.html`, `habits.html`'s period math, and cross-file data consistency
  (e.g. the two independently-maintained copies of the `SURAHS` table staying
  in sync).
- `surah_stats.py` — one-off Python helper used during development to pull
  per-surah ayah/page/letter counts from an external API; not part of the site.

See `CLAUDE.md` for more implementation detail (log schema, versioning rules).
