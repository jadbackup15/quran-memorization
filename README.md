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
Three tabs: Revise, Hizb Log (the default), and Mutashabihat.

Revise: test yourself on random ayat from a chosen surah/juz/hizb/page range, and log each
Hizb recitation with a mistake count. Tracks which Hizb you've memorized, suggests
what to revise next (weighted by how long it's been and how many mistakes you've
made there), and can log mistakes down to the specific ayah to show "ayat you
mistake most." Click a Hizb — from "Suggested for Revision," the Hizb Overview
list, an "All Revision Clusters" list, or its row in the Recitation Log — to open
its full detail page (see `hizb.html` below). "Hizb Overview" lists every
memorized Hizb's strength, last-recited date, and last-session mistake count
directly (no click-through needed), sortable by Hizb #, weakest-first, or
most-stale-first, so the ones needing attention surface without scanning the
whole list; a "📊 Print Report" button next to it prints a one-page summary —
every memorized Hizb's strength/last-recited/mistakes, the top 5 revision
clusters, and the top 20 most-mistaken ayat. The Recitation Log has a
Hizb dropdown plus a From/To date range above it for narrowing to just one
Hizb, a date range, or both together, and a "🖨️ Print Mistakes" button that
prints every ayah-level mistake within that same Hizb/date filter (not just
the sessions listed) — a focused "what did I get wrong during this stretch"
sheet, printing everything logged if no filter is set.
An "All Revision Clusters" section
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
Print controls appear on hizb.html's per-Hizb versions of both. Every logged
ayah mistake can carry a type code — S (stopped), B (forgot the beginning),
W (word slip), M (multiple mistakes), T (mutashabihat — mixed up with a
similar-sounding ayah), or A (needs attention: felt shaky but nothing was
actually missed, so it's tracked separately and never counted as a mistake).
Type one or more codes at the start of a mistake's note (live "+ Mistake" tap
or the paste-import box below), with or without a space, e.g. "S", "255S", or
"255SB" for an ayah with both an S and a B mistake — everything after the
code(s) becomes the note. "Ayat You Mistake Most" can filter to one type, and
the type legend/badges appear everywhere a mistake is shown. Ayah mistakes
can also be bulk-imported: pick a surah, then paste one ayah number per line
(an optional type code and note can follow) — handy for pasting in a running
list kept in a notes app. The import also adds one Recitation Log session per
Hizb the pasted ayat fall in (a surah's ayat often span several Hizbs), so it
feeds the revision suggestions the same way a live recitation session would.

Mutashabihat Finder: a text-similarity search (word-level overlap
coefficient — intersection over the *shorter* ayah's word count, not
Jaccard's union, since a real mutashabihat pair is often a short phrase
echoed inside a much longer, differently-elaborated ayah elsewhere — on
normalized Arabic; not a scholarly classification, just a heuristic to help
find candidates faster than reading by eye) for discovering mutashabihat
instead of already having to know them. "By Ayah" mode takes one ayah plus a
surah to search within, and returns every ayah in that surah ranked
most-similar first (a "Strictness" picker — Loose/Moderate/Strict — controls
the similarity cutoff). "By Range" mode takes a page/juz/hizb/surah From/To
range (reusing the same range pickers as the Revise tab) and returns every
similar-ayah *pair* found within it — capped at 400 ayat total, since it's
comparing every ayah in the range against every other one. Either mode's
results have a "+ Save as Mutashabihat" button per match that saves it
straight into the group list below (skipped/greyed out once already saved,
so there's no risk of duplicates), plus an "⤢ Expand All" toggle to swap
every result's truncated opening-words preview for its full ayah text at
once.

Mutashabihat: a manually-curated list of ayah groups (1 or more ayat each,
not just pairs — three or more ayat can genuinely be mutual mutashabihat) you
personally find easy to mix up, from any surahs. A group can start with just
one ayah — jot it down before you've pinned down what it's confused with —
and grow later via "✎ Edit". Add a group with a surah+ayah picker per ayah (a
"+ Add Another Ayah" button appends more rows) and an optional note; each
saved group is ranked by how many ayah-mistakes you've logged (via the
Recitation Session or the paste-import above) against any of its ayat — type
T is the shorthand for logging one of these — so the mutashabihat that
actually trip you up in practice, not just the ones that sound alike, rise to
the top. A "Compare" button per group (once it has 2+ ayat) expands all its
ayat side by side, each with 2 ayat of surrounding context, so you can study
exactly where they diverge. Edit a group at any time to add/remove ayat or
change its note, or delete it outright. A "💾 Save as JSON File" button
downloads just the mutashabihat groups (not the whole app's data, unlike
Recitation Log's own Save button) as a small, hand-editable file — it can be
loaded back in via Recitation Log's "Import from Local Log" without
affecting your memorized Hizbs, recitation log, or ayah mistakes, since each
of those is only ever replaced when the imported file actually mentions it.

Supports optional cross-device sync via Firebase, gated only by an account
name/passphrase you choose (no login).

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
