@~/.claude/platform.md

# <Project name>

<One paragraph: what this app is, what pages/services it has, and how they
relate. Keep it to what someone needs before reading any code.>

The import above carries the rules that are NOT about this app — versioning a
no-build-step site, the Telegram-ingest traps, cloud-sync parity, prompt and
agent-context design, the jsdom testing caveats, print pagination, the CSS/DOM
traps, and how to work. Keep that file domain-neutral: **a rule that names a
feature, a data shape or a screen in THIS app belongs here, not there.**

---

## Copy this file to `<project>/CLAUDE.md` and then delete everything below.

### What the shared file already covers, so you don't re-derive it

Before writing a section here, check whether the platform file has it:

- **Versioning** — `APP_VERSION`/`STABLE_VERSION`/`STABLE_VERSION_DATE`, the β
  badge, the minor rolling over at 100, and why the staleness guard measures
  age rather than release count.
- **Telegram ingest** — digit/bidi normalisation at one choke point, dash
  lookalikes, `<hash>::` prefixes and the all-numeric collision, the
  stale-proxy cache-buster and freshness trip-wire, existence-based dedup over
  a cursor, never guessing missing context, checkpoint vs backlog as two
  different walks, `keepalive` + `await`, and page-size limits becoming data
  loss.
- **Cloud sync** — payload/backup parity, normalising legacy shapes on read,
  `''` not meaning absent, data vs device state, and awaiting the final push.
- **Prompts and agent context** — prompts as plain Markdown fetched with a
  cache-buster, `common + delta` with no restatement, the `override || default`
  silent shadow, editor-facing vs wire-facing resolution, ignoring the model's
  scratchpad when parsing, offering only options that resolve, context
  compaction, and headers that must match what is countable below them.
- **jsdom testing** — what reaches `window`, cross-realm traps, stubbing
  browser APIs before evaluation, and pinning tests to measurements.
- **Printing** — why a page cannot know how tall a printed page is, and the one
  layout that always works.
- **CSS/DOM traps** — `:not(.x)` matching everything, `JSON.stringify` in an
  inline handler, duplicated controls drifting, controls that vanish when off,
  symmetric space reservation, fixed-aspect height vs width budgets, and the
  off-by-one in "last N days".
- **How to work** — test the user's hypothesis first, a trend is not a cause,
  check the code is reached before blaming its logic, measure rather than
  assume.

### What to write here instead

Only what is true of this app and nothing else: its data shapes and storage
keys, its screens and what each is for, its own domain rules, and the specific
incidents that explain why a piece of code looks the way it does. Write the
incident, not just the rule — "this failed, here is how it looked from the
outside, here is what it actually was" is what stops the same fix being tried
twice.

### Infrastructure to reuse rather than fork

- **The Telegram bot is account-keyed.** Add a channel to the existing Cloud
  Run service rather than deploying a second one — two services means two
  deploys, two copies of the token, and two copies of the message-parsing
  helpers to keep in step. Those helpers already exist in two places and the
  notes say they must never diverge; do not make it three.
- **Portable client files**: `version.js`, `sw.js`, `log.js`, the IndexedDB
  fetch cache, and the shared print-window shell. Copy them; do not abstract
  them until a second project has actually shown which seams it needs.
