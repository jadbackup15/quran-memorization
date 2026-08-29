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
Four tabs: Revise, Hizb Log (the default), Mutashabihat, and Agent Chat.

Revise: test yourself on random ayat from a chosen surah/juz/hizb/page range, and log each
Hizb recitation with a mistake count. Tracks which Hizb you've memorized, suggests
what to revise next (weighted by how long it's been and how many mistakes you've
made there), and can log mistakes down to the specific ayah to show "ayat you
mistake most."

Hizb Log itself has five sub-tabs, so the day-to-day task (log today's
recitation) doesn't get buried under a dozen analysis sections:

- **📝 Log a Session** — the Memorized Hizb checklist, the live Recitation
  Session logger, and "Import Mistakes" (bulk paste-import).
- **📊 Review & Analyze** — the per-Hizb/per-ayah analysis sections, in this
  order: Hizb Overview, All Hizbs — Mistakes, Ayat You Mistake Most, Needs
  Attention, Practice More.
- **📜 Clusters & History** — the longer-form browsing sections: All
  Revision Clusters, then Recitation Log.
- **💾 Backup & Import** — "📥 Import from Telegram", "Verify Telegram
  Import" (every Telegram-imported mistake grouped by message, newest
  first, to quickly cross-check against the channel), and the "Save as
  JSON File" / "Import from Local Log" backup pair.
- **🖨️ Print** — check off which sections to include (All Hizbs —
  Mistakes, Mutashabihat, Top Revision Clusters, Practice More —
  defaulting to the first three, each with its own timeframe/count
  dropdown) and print them all as one combined document instead of several
  separate ones. Every section reuses its own already-existing print
  formatting exactly — Mutashabihat prints each group's ayat with their
  opening words, Revision Clusters prints each cluster's start and end
  ayah with their opening words.

Switching to the Revise or Mutashabihat tab and back to Hizb Log remembers
whichever of the five sub-tabs you were last on. Click a Hizb — from the
Hizb Overview list, an "All Revision Clusters" list, or its row in the
Recitation Log — to open its full detail page (see `hizb.html` below).

"Hizb Overview" lists every memorized Hizb's strength, last-recited date, and
last-session mistake count directly (no click-through needed), sortable by
Hizb #, weakest-first, or most-stale-first, so the ones needing attention
surface without scanning the whole list; a "📊 Print Report" button next to
it prints a one-page summary — every memorized Hizb's strength/last-recited/
mistakes, the top 5 revision clusters, and the top 20 most-mistaken ayat.

"All Revision Clusters" shows nearby-mistake clusters from every Hizb at once
(which Hizb each belongs to included). Clicking a cluster expands a quick
summary right there on the page — starting and ending ayah (with each one's
opening words), ayat mistaken, and mistake count — with a link to that
Hizb's full page for anyone who wants more detail. "All Hizbs — Mistakes"
lists every ayah mistake across every Hizb, grouped by Hizb — a quick "what
went wrong, and where" browse without opening each Hizb individually. Hizb
groups display in ascending order (Hizb 1, then 2, then 3...) so you can
follow along a mushaf top to bottom — though which Hizbs actually get shown
(when there are more than the on-screen cap) still prioritizes the
most-mistaken ones, only their display order changes. Within a Hizb,
repeated mistakes on the same ayah collapse into one row with a count (e.g.
three separate taps on 2:213 show as "2:213 — 2 mistakes", not three
identical rows), sorted most-mistakes-first and then by ayah order for ties,
so the ayah you keep tripping over surfaces at the top instead of getting
lost among one-off slips, while ties still read in the order you'd
encounter them reciting. Any aggregated row with more than one mistake —
here and in "Ayat You Mistake Most" — can be clicked (▸) to expand and show
each individual tap's own type/date/note, then collapsed again (▾); a row
with only one mistake has no expand toggle, since there's nothing more to
reveal — instead it gets ✎ (edit) and ✕ (delete) buttons directly, the same
inline surah/ayah/type/note edit form as "Edit individual ayah mistakes"
(and available there too for an aggregated row once expanded, on any
individual tap). Editing an ayah number here also moves the mistake to its
correct Hizb group, in case a typo (e.g. "259" meant to be "249") had it
sitting under the wrong one. If the mistake came from a Telegram import and
you change its ayah number, a reminder pops up once the edit is saved —
the fix only applies here, so the Telegram message itself still has the
old number, and re-running Import from Telegram later would otherwise
offer to add that old number back in as if it were new. Every "surah:ayah" reference on this page — here, Ayat You Mistake
Most, Needs Attention, a Recitation Log session's expanded mistake list,
Edit individual ayah mistakes, and Mutashabihat — can be clicked on its own
to reveal that ayah's full Arabic text and English translation inline (same
click-to-expand this app already had on hizb.html), independent of any
other expand behavior a row might already have; only one ayah's full text
is shown at a time across the whole page. Click a Hizb's header (or the "▾ Collapse All"/"▸ Expand
All" button to do it for every Hizb shown at once) to collapse it down to
just its "Hizb N — K mistakes" line — the "Hizb N"
link itself still navigates to that Hizb's page. Both this list and "Ayat
You Mistake Most" have a 🖨️ Print button (with a 5/10/All picker on "Ayat
You Mistake Most") that opens a plain, printer-friendly page listing the
full underlying list (always every Hizb, regardless of the collapse state
or the on-screen 10-Hizb cap on "All Hizbs — Mistakes") — each cluster's
real start–end ayat total (distinct from how many of them were actually
mistaken, since gap-chaining can bridge a few clean ayat in between) plus
the opening words of its starting and ending ayah — the same Print controls
appear on hizb.html's per-Hizb versions of both. "All Hizbs — Mistakes"'
own print output additionally shows each ayah's own opening words inline
at the end of its bullet (fetched live, same as the on-screen click-to-
expand) and a small colored badge for the type code next to the ayah
reference — one line per mistake, not two — so a whole Hizb's mistake list
reads as a dense, scannable sheet rather than a wide table, in one
full-width column, Hizb by Hizb, flowing across as many printed pages as
it needs.

"All Revision Clusters," "All Hizbs — Mistakes," "Ayat You Mistake Most,"
and the Recitation Log (a Hizb dropdown plus its own timeframe dropdown,
narrowing to just one Hizb, a recent timeframe, or both together) each have
their own Last Session/Last 7 days/Last 3 days/All-time dropdown,
defaulting to **Last Session** so every one of them opens on "what did I
just get wrong" rather than an all-time total. "Last Session" pools every
sitting from each Hizb's most recent DAY, not just one literal timestamp —
if Hizb 1's last sitting was yesterday and there were 3 separate sessions
logged that day (e.g. a live session plus two paste-imports), all 3 count
as "last session," not only the very last of the three — so a long-past bad
session can't keep dominating an otherwise clean, improving Hizb either.
The Recitation Log's
"🖨️ Print Mistakes" button prints every ayah-level mistake within its
current Hizb/timeframe filter (not just the sessions listed) — a focused
"what did I get wrong during this stretch" sheet, printing everything
logged if the filter is cleared to All-time. Click any Recitation Log row
(its own aggregated "N mistakes" tally) to expand it and see that session's
ayah-level mistakes, aggregated the same way — if the session's own tally
is higher than the number of ayah-tagged mistakes (some "➕ Mistake" taps
never got an ayah number), a note says so rather than leaving the two
counts looking inconsistent. Every logged ayah mistake can
carry a type code —
S (stopped), B (forgot the beginning), W (word slip), M (multiple mistakes),
T (mutashabihat — mixed up with a similar-sounding ayah), E (messed up the
ending), K (weak — needs more careful review), or A (needs attention: felt
shaky but nothing was actually missed, so it's tracked separately and never
counted as a mistake). Type one or more codes at the
start of a mistake's note (live "+ Mistake" tap, or "Import Mistakes" in
Log a Session), with or without a space, e.g. "S", "255S", or "255SB" for
an ayah with both an S and a B mistake — everything after the code(s)
becomes the note. "A" can combine with another code too, e.g. "255AB" —
this doesn't mean a real B mistake happened, it's a more specific flavor
of "needs attention": a near-miss on that particular thing (here, almost
forgetting the beginning) rather than an actual mistake, and still never
counted as one. "Ayat You Mistake Most" can filter to one type, and the
type legend/badges appear everywhere a mistake is shown. Every point where
an ayah mistake is entered — the live tap, the paste-import box, or editing
a logged mistake inline — checks the ayah number actually exists in that
surah and flags it instead of silently logging a bogus reference (the
paste-import skips just the bad lines, after confirming which ones, and
keeps the rest). Every mistake also silently records how it was logged
("live" tap, paste-import, or Telegram import) for backup/sync purposes —
not shown in the UI, but preserved through "Save as JSON File" and Firebase
sync so it's never lost.

A "Count 'Needs Attention' ayat as mistakes" checkbox sits between Hizb
Overview and "All Hizbs — Mistakes" — off by default, so type-A ayat stay
out of "All Hizbs — Mistakes" and "Ayat You Mistake Most" (and their own
Print output) exactly as described above. Turn it on to count them as
mistakes in those two views too, if a "felt shaky" flag should still pull
its weight in the rankings; "Needs Attention" itself always keeps listing
every flagged ayah either way, and nothing about how the mistake was
actually logged changes — just how these two views count it. Hizb
Overview's own strength scores are untouched by this checkbox (they come
from each session's own already-logged mistake tally, fixed at the time it
was recited), and so is anything in Clusters & History.

In Log a Session, "Import Mistakes" (right below the live Recitation
Session logger, sharing its type-code legend) bulk-imports ayah mistakes:
pick a starting surah, then paste one ayah number per line (an optional
type code and note can follow) — handy for pasting in a running list kept
in a notes app. A line can also switch which surah the following lines
belong to, for a sitting that spans more than one surah in a single paste
(e.g. Hizb 5, which ends Al-Baqara and starts Aal-i-Imran) — a line like
"3:" on its own switches to surah 3 for every bare ayah number after it,
until the next such line; "3:15" switches AND logs ayah 15 as a mistake in
that one line. Real example, pasted as-is:

```
3:
15
16
22
24a
```

which logs Aal-i-Imran 15, 16, 22 as mistakes and 24 as "Needs Attention"
("24a"). The import also adds one Recitation Log session per Hizb the
pasted ayat fall in (grouped by Hizb regardless of which surah(s) they came
from) — merging into that Hizb's existing session for today (bumping its
mistake count) if it's already got one logged, whether from an earlier
paste, a surah switch within the same paste, or a live Recitation Session,
rather than splitting into two same-day rows for what was really one
sitting; a Hizb with no session yet today still gets a new one.

A line can also flag a whole mushaf page instead of a single ayah — "p15"
(case-insensitive, an optional note can follow, e.g. "p15 redo the whole
page") means "revisit page 15," completely separate from ayah mistakes: it
needs no surah, never counts toward any mistake total or Hizb session, and
adds it to your "Practice More" list in Review & Analyze with a default
target of 5 times — "p15x20" (or "p15 x20") sets a specific target instead
of the default. A paste can mix page flags with ordinary ayah mistakes
freely, or be page-flags-only.

A line like "h5" (case-insensitive) means "Hizb 5, recited with zero
mistakes" — for a sitting that went perfectly, so there's nothing to log as
an ayah mistake but you still want a Recitation Log record that it
happened. It needs no surah, and does nothing at all if Hizb 5 already has
a session logged today (from any source) — so pasting it more than once is
harmless. A paste that's entirely "hN" flags for Hizbs already logged today
tells you there's nothing left to add rather than showing an empty confirm.

A line like "r15-23x20" adds ayat 15-23 (of whichever surah is currently
active — same "3:" carry-forward a bare ayah number uses) to your
"Practice More" list (in Review & Analyze) with a target of 20 times — a
self-set drill goal, not a mistake at all: an ayah range you want to
deliberately repeat, whether or not you've actually mistaken it. Practice
More holds whole-page goals (from "pN") and ayah-range goals (from "rM-Kx")
side by side, since they're really the same idea at two different scopes —
each entry (a page or a range) shows a plain editable "practiced X / Y
times" count on the page that you update yourself as you go; nothing else
in the app ever changes it automatically, and there's no auto-removal once
you hit the target — delete it (✕) yourself whenever you're done. A page
entry is also click-to-expand — tap it to fetch and read that page's full
text.

In the "💾 Backup & Import" sub-tab, "📥 Import from Telegram" imports
mistakes jotted down in a personal Telegram channel used as a notes app
directly into your logged mistakes — no intermediate file. It fetches
messages from that channel's public preview page and parses each one with
the exact same one-ayah-per-line format the paste-import above uses
(including "N:"/"N:ayah" surah switches, "p15" page-review flags, and "h5"
zero-mistake Hizb flags, none of which need a surah or trigger the surah
prompt below). Messages are read in
chronological order and share one surah context across all of them: a
message's own surah switch always wins and carries forward to the ones
after it, and for a message with no switch at all, the surah is never
guessed — you're asked directly the first time it's actually needed, with
that message's own text shown alongside the question, starting completely
blank every time (nothing is ever pre-filled). That
answer then carries forward too, so a whole run of unlabeled messages
before the next "N:" one only asks once, not per message. Cancelling or
leaving that prompt blank just skips that one message — it's never dropped
without saying so; the final summary calls out how many were skipped this
way. Since every message on the channel is re-checked on every run (see
below), a message with no switch of its own that's already fully imported
won't ask again either — it just reuses whatever surah its existing
mistake was logged under, so re-running the import doesn't mean re-answering
questions you've already answered. Carrying a surah forward across messages this way means a message with
no switch of its own could still end up under the wrong surah if something
posted earlier — even days earlier — set the wrong one and nothing since
switched it back, so before anything is saved you also get a second check:
every batch of new ayat that relied on a carried-forward surah (rather than
a switch line in that exact message) is grouped by whichever surah it
resolved to and shown to you in one box, by name, with every ayah in it and
the guessed surah number already filled in — leave it as-is and press OK to
keep it, or edit the number to correct it. A message's own
explicit switch is never second-guessed this way. Telegram's own service messages ("Channel created", "X
pinned...") and any message that doesn't look like log data at all (no line
starting with a number) are skipped automatically, no prompt needed for
those. Before anything is added, a confirm dialog lists every ayah it
found — not just a count — so you can check exactly what's about to be
logged; a "Last imported ..." (or "Never imported yet") note next to the
button shows when it last ran. It's safe to click any time:
a mistake already imported from a given Telegram message is never
duplicated, but if you delete a mistake that came from Telegram, running
this again brings it back — nothing is treated as "done forever," only
"still present or not" (there's deliberately no "last imported" cursor, so
that deleted mistakes aren't skipped forever just because their message was
seen before). Telegram's own page sets no CORS headers, so a direct fetch
from the site would be blocked by the browser; this goes through a public
CORS proxy (`api.allorigins.win`) instead, which means it depends on that
third-party proxy being up and not rate-limited — a failed fetch is retried
automatically a few times before giving up, and only then does an alert
explain why, so a brief proxy hiccup usually resolves on its own without
needing to click the button again. The proxy can also return a page that
LOOKS successful but is actually stale or cut short, without erroring at
all — a stale page's own newest message is checked against the newest
message ever seen on a past run, and if it's older (a channel's messages
never get less recent), the import is aborted with an error instead of
risking a wrong "nothing new" or silently missing something you just
posted; just try again. Each message's own line
breaks (Telegram renders them as `<br>`) are preserved as real newlines
before parsing, so a message like the one in the paste-import example above
imports exactly as typed. Just below it, "Save as JSON File" / "Import from
Local Log" back up (or restore) everything across all three pages in one
file — see "Data & backups" below.

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
Recitation Session or Log a Session's "Import Mistakes") against any of its ayat — type
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
name/passphrase you choose (no login). Sync covers everything "Save as JSON
File" does — the Tracker page's memorized surahs and the Habits page's
activities/log too, not just this page's own data — kept in sync whenever
review.html itself saves something or you hit "Push Now" (editing the
Tracker or Habits pages directly doesn't push immediately on its own, since
only this page has the sync wiring, but nothing is lost — it's included
next time review.html syncs). Import from Telegram only ever needs to run
on one device — the result reaches every other device connected to the
same sync account through this same mechanism, with no need to re-run the
import elsewhere.

Agent Chat: a conversational assistant grounded in your own review data —
ask something like "Which ayat should I review in the first 100 ayat of
Al-Baqara, based on the last few weeks?" and it answers from a compact,
token-light summary of your actual logged mistakes (rebuilt fresh from
this device on every message). A "Data to Include" checklist lets you
choose which categories get sent at all — Ayah Mistakes and Recitation Log
are on by default (what most questions need), Practice Ranges and
Mutashabihat are off by default (real data, just less often relevant, so
they aren't sent — and don't cost tokens — unless you turn them on). A
"Prompt" dropdown picks between two built-in prompts: "General" for
open-ended coaching questions, and "Print Suggestions" for deciding what
to include in a printed review sheet (see the Hizb Log Print sub-tab
above). Uses Google's Gemini API free tier — paste your own API key in
(from [aistudio.google.com/apikey](https://aistudio.google.com/apikey));
if you're connected to cross-device sync, everything on this screen only
needs entering once, since it travels to your other devices the same way
everything else does (the API key itself is never included in a "Save as
JSON File" backup, since a downloaded file is a much easier way for a key
to leak than the sync doc). The Model dropdown lists whichever models your
own key can actually use right now (fetched live from Google, with a
"🔄 Refresh Available Models" button) rather than a fixed list that can go
stale as models are added or retired. Each prompt's own instructions start
from its own plain-text file (`agent-prompt-general.txt` /
`agent-prompt-print.txt` — no JS, just edit the wording directly), but can
also be viewed and overridden directly in the app via the tab's own
"📄 Agent Prompt" section — handy from a phone, where editing a file
isn't practical — and that override syncs to your other devices too,
without affecting the other prompt. A "📋 Copy Prompt +
Data" button copies the exact text this app would send — handy for
pasting straight into Gemini's own web UI, ChatGPT, or any other AI chat
instead of using this app's own API call; "☁️ Save to Firebase" pushes
your current data to your synced account right away (the same action as
the sidebar's "Push Now"), so another device is guaranteed to have the
latest copy before you rely on it. "🖨️ Print Last Response" prints just
the most recent reply (with the question that prompted it), not the whole
conversation.

### `hizb.html` — Hizb Detail
One Hizb's full picture, opened via `?hizb=N` from anywhere in `review.html` that
links to a Hizb (never a raw modal, since this page keeps growing). Shows a
strength badge and last-recited date, a "Mistakes Over Time" trend chart (one bar
per recitation, positioned along a real date axis), a "Recitation History" log,
a "Mistakes by Session" section where every past sitting's ayah mistakes are
individually browsable (click a session to expand it), an "Ayat You Mistake Most"
ranking, and two "Revision Clusters" sections — nearby mistaken ayat grouped
into passages worth revising as a block, including isolated mistakes as their
own entry, sharing an All-time/7-day/3-day/Last-Session dropdown. "By Session"
pools each calendar day's sittings together (so two sessions logged the same
day count as one) and groups the result under its own date sub-header (most
recent day first), so a specific day's — e.g. today's — weak passages are
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
- `agent-prompt-general.txt` / `agent-prompt-print.txt` — plain-text
  default prompts for the Agent Chat tab's two selectable AI assistant
  modes (who the user is, what the app's terms mean, and — for the
  "print" one — what a good Print-sub-tab recommendation looks like);
  fetched by `review.html` only, no JS involved so they're easy to
  hand-edit. Your actual review data is never hardcoded here — it's sent
  fresh from `localStorage` alongside whichever file's content on every
  chat message. Needs the page served over http(s) (see "Development"
  below) — opened directly via `file://`, the fetch can't succeed and the
  tab falls back to a short built-in default instead.
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
