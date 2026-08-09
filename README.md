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
mistake most." Click a Hizb — from "Suggested for Revision," the Hizb Overview
chips, an "All Revision Clusters" list, or its row in the Recitation Log — to open
its full detail page (see `hizb.html` below). An "All Revision Clusters" section
next to "Suggested for Revision" shows nearby-mistake clusters from every Hizb at
once (which Hizb each belongs to included, an All-time/7-day/3-day/1-day toggle
to see recent progress, plus a "Last Session" mode restricted to just each
Hizb's single most recent sitting instead of pooling every session ever
logged — so a long-past bad sitting can't keep dominating an otherwise
clean, improving Hizb), so you don't have to open each Hizb to find them.
Clicking a cluster expands a quick summary right there on the page —
starting and ending ayah (with each one's opening words), ayat mistaken,
and mistake count — with a link to that Hizb's full page for anyone who
wants more detail. Both this list and "Ayat You Mistake Most" have a
🖨️ Print button (with a 5/10/All picker for how many to include) that
opens a plain, printer-friendly page listing the full underlying list —
each cluster's real start–end ayat total (distinct from how many of them
were actually mistaken, since gap-chaining can bridge a few clean ayat in
between) plus the opening words of its starting and ending ayah — the same
Print controls appear on hizb.html's per-Hizb versions of both. Ayah mistakes
can also be bulk-imported: pick a surah, then paste one ayah number per line (an
optional note can follow, e.g. "218 mutashabihat") — handy for pasting in a running
list kept in a notes app. The import also adds one Recitation Log session per Hizb
the pasted ayat fall in (a surah's ayat often span several Hizbs), so it feeds the
revision suggestions the same way a live recitation session would. Supports
optional cross-device sync via Firebase, gated only by an account name/passphrase
you choose (no login).

### `hizb.html` — Hizb Detail
One Hizb's full picture, opened via `?hizb=N` from anywhere in `review.html` that
links to a Hizb (never a raw modal, since this page keeps growing). Shows a
strength badge and last-recited date, a "Mistakes Over Time" trend chart (one bar
per recitation, positioned along a real date axis), a "Recitation History" log,
a "Mistakes by Session" section where every past sitting's ayah mistakes are
individually browsable (click a session to expand it), an "Ayat You Mistake Most"
ranking, and two "Revision Clusters" sections — nearby mistaken ayat grouped
into passages worth revising as a block, including isolated mistakes as their
own entry, sharing an All-time/7-day/3-day/1-day toggle. "By Session" keeps each
sitting's clusters separate and grouped under its own date sub-header (most
recent session first), so a specific day's — e.g. today's — weak passages are
easy to find as a group instead of scattered through a flat, mistake-count-ranked
list; "All Sessions" pools every sitting together into one ranked list —
a cluster clicked from review.html's "All Revision Clusters" deep-links here,
pre-expanded via `&cluster=`. Either way, a cluster stops growing past 15 ayat
even if the next mistake is technically "nearby," so a handful of small,
unrelated slips spread across many separate sessions can't chain into one
sprawling passage that's mostly clean ayat. Ayah text (for the opening-words
preview shown under every mistake, and the full Arabic + translation on click)
is fetched from a public Quran API and cached on-device per surah after the
first request, so revisiting one — even offline — doesn't re-fetch it.

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
- `quran-data.js` — Quran structure (`SURAHS`, `SURAH_OFFSETS`, `JUZ_RANGES`)
  and ayah/Hizb/Juz geometry helpers, shared by `quran-tracker.html`,
  `review.html`, and `hizb.html`.
- `quran-cache.js` — the on-device IndexedDB cache for ayah text, shared by
  `review.html` and `hizb.html`.
- `mistake-analytics.js` — ayah-mistake analytics and revision clustering
  (strength scoring, ranking, nearby-mistake clustering with a timeframe
  filter), shared by `review.html` and `hizb.html`. See `CLAUDE.md` for the
  full breakdown of what lives in each shared file.
- `test/` — automated tests (Node's built-in test runner + jsdom, no browser
  needed). Run `npm install` once, then `npm test`. Covers `log.js`'s
  export/import logic, the pure Hizb/ayah math and mistake-paste parsing in
  `review.html`, the mistake-analytics/revision-clustering logic and
  `hizb.html`'s own URL-param handling, `habits.html`'s period math, and
  cross-file data consistency (e.g. every page pulling `SURAHS` from the same
  `quran-data.js` instead of hand-maintaining its own copy).
- `surah_stats.py` — one-off Python helper used during development to pull
  per-surah ayah/page/letter counts from an external API; not part of the site.

See `CLAUDE.md` for more implementation detail (log schema, versioning rules).
