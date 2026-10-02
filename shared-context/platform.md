# Platform rules — shared across projects

Hard-won rules from building personal-data web apps that ingest from a Telegram
channel, sync through Firebase, and hand their data to an LLM. Every one of
these cost a real bug or a real regression to learn.

**What belongs here:** a rule that would still be true in a different app, about
a different subject. **What does not:** anything naming a feature, a data shape,
or a screen. Those live in the project's own `CLAUDE.md`. If a rule only makes
sense once you know what the app is about, it is not a platform rule.

Projects opt in by starting their own `CLAUDE.md` with `@~/.claude/platform.md`.
Nothing is loaded automatically, so a project that does not want these rules
simply does not import them.

---

## Versioning a no-build-step site

`version.js` holds `APP_VERSION` and, beside it, `STABLE_VERSION` plus
`STABLE_VERSION_DATE`. Every page loads it and shows the version as a badge; a
β badge lights when `APP_VERSION` is **strictly newer** than stable.

Bump `APP_VERSION` on every commit that touches a page: patch for copy/styling/
small fixes, minor for features, major for architecture or data-format changes.
Bumping a segment resets the ones to its right. **The minor rolls over at 100**
— 5.99.0 plus a minor is 6.0.0 — because this is a badge people read, and
reserving the first number for a breaking change means it may never move.
Comparison is numeric per segment, so nothing depends on the minor staying
below 100.

Three failures worth not repeating:

- **A constant that must be hand-advanced goes beside the thing it is compared
  to.** Stable once lived in a different file from the version it was checked
  against and sat unchanged for twenty-two releases — the β badge was
  permanently lit and therefore meaningless.
- **`!==` is the wrong test.** It also lights β when running something OLDER
  than stable. That is a stale cache, not a beta, and calling it β is actively
  misleading.
- **When a guard has let the same fault through twice, fix the guard.** The
  test asserted only "newer than stable", which is true whether stable is one
  release behind or fifty. It now bounds the AGE of stable via a date kept
  beside it. An earlier attempt bounded the number of RELEASES behind and cried
  wolf within the hour — sixteen shipped in three days while stable was exactly
  right. The rule was always about time, so the guard has to measure time; a
  count is a proxy that breaks precisely when the project is moving fastest.

A service worker whose `CACHE_NAME` embeds the version gets a fresh install for
free on every bump. Keep the two in the same commit.

## Ingesting from a Telegram channel

The public preview page (`t.me/s/<channel>`) through a CORS proxy is enough to
read a channel from a static site, but almost everything about it is a trap.

**Normalize digits and invisible marks at ONE choke point**, before any parser
runs: Arabic-Indic (`٠-٩`) and Persian (`۰-۹`) digits to ASCII, and strip the
LRM/RLM/ALM bidi marks an RTL client interleaves next to numbers. ASCII-only
`\d` matches none of them and `parseInt` understands none of them, so a message
matches *nothing* — not even the "does this look like data" filter — and
vanishes with no sign anything went wrong. Fix it once, at a shared entry
point, so no parser added later has to re-derive it.

**The same applies to punctuation lookalikes.** A range typed as `81-88`
arrives as `81–88` (en dash) because phone autocorrect substituted it. Accept
the hyphen, en dash, em dash and minus sign everywhere a separator is parsed.
This failure is worse than "invalid, skipped": the line looks like nothing to
any parser, so there is no candidate to reject and no dialog to mention it.

**A message-identity prefix needs a separator that cannot occur in the data.**
A double colon works where a single one is already meaningful. Do not
length-limit the hash pattern — a short hash then goes unrecognised and is left
in the text. And beware the all-numeric case: `46605::286` reads as "field
46605" to a naive `/^(\d+):/`, which then adopts a nonsense value and poisons
every following line. A hash containing letters cannot do this, which is why a
bug report saying "it only breaks when the hash is all numbers" is an
*accurate* observation worth testing directly rather than theorising about.

**A `200 OK` is not proof the response is current.** A proxy will serve a stale
snapshot without erroring, and retry logic cannot catch it because nothing
failed. Two defences, and you want both:
- a cache-busting query param regenerated per attempt plus `cache: 'no-store'`,
  which addresses the cause;
- a freshness trip-wire comparing the newest item in this fetch against the
  newest ever seen. A fetch whose latest item is OLDER than one already seen is
  stale by definition. Note this cannot catch a cache that is simply STUCK —
  never advancing, never regressing — which is indistinguishable by content
  from "nothing new was posted". Hence the cache-buster.

**Prefer existence-based dedup to a cursor.** Keying on "is this exact item
already stored" rather than "is it newer than the last import" is what lets a
user delete something and have a re-import bring it back. A monotonic timestamp
cursor structurally cannot do that, because the deleted item's source is older
than the cursor and never reconsidered.

**Never guess missing context — ask, carry forward, and let the answer be
reviewed.** Where messages share a running context (a heading that applies
until the next one), ask once when it is genuinely unknown and carry the answer
forward. Do not pre-fill the prompt from an unrelated UI control: a stale
dropdown value silently mis-files everything. Then show the user what was
inferred, grouped, with the ORIGINAL message text beside each inference — a
parsed reference alone gives no way to sanity-check an attribution.

**"What to import" and "what to read for context" are different questions.** A
checkpoint meaning "only import what comes after this" must not also make the
app forget the context established before it. Conflating them produced a
long-standing bug that survived two misdiagnoses, because the code being
"fixed" was never reached. Likewise, paging back far enough to resolve context
is a different walk from paging back far enough to cover a backlog: the first
stops as soon as context resolves, so it can never guarantee the second.

**Anything that must survive the user walking away needs `keepalive: true` and
an `await`.** A fire-and-forget `fetch(...).catch(() => {})` fired after a
success dialog works on desktop and routinely fails on mobile — the natural
next action is switching apps, and a backgrounded page has its in-flight
requests killed. A swallowed `.catch()` on a call whose failure changes future
behaviour is a bug waiting to be reported as something else entirely.

**A page-size limit becomes data loss the moment a backlog exceeds it.** If the
feed hands back N items per fetch and everything downstream operates on those
N, a run with more than N pending imports exactly N, reports success, and
advances the marker past what it never fetched. The tell in the report is the
count matching the page size exactly.

## Syncing to a cloud document

**Build the backup file and the sync payload from the same seeded state and
diff their key sets.** They legitimately differ in VALUES — a hand-editable
backup drops ids and formats dates; a sync payload keeps full fidelity — but a
field present in one and missing from the other is always a bug. This exact
check caught a field added to the push shape and not to the backup, which would
have silently dropped it from every exported file.

**Normalize legacy shapes on READ, never with a migration pass.** A document
written by an older version is upgraded as it is parsed, and only rewritten on
that device's next real save. Normalising on read costs nothing and cannot
half-finish.

**`''` is not the same as absent.** Writing an empty string for a field a
document never carried reads back as neither true nor false and gets silently
treated as the wrong default. Remove the key instead, so the default applies.
Never write the literal string `"undefined"`.

**Decide per field whether it is user DATA or device STATE.** A fetch-freshness
trip-wire is meaningless on another device; a display preference pushed to
every device is an annoyance. Both belong out of the payload — and a parity
test will tell you so, correctly, if you add them.

**Fire-and-forget is fine for a tap and wrong for a completion.** Any flow that
ends in a dialog the user dismisses before navigating away should `await` one
final push, so "a request was sent" becomes "the round trip completed". And if
sync is not connected at all, say so in that dialog rather than completing
silently — the work is real but stranded.

## Prompts and agent context

**Keep prompts in plain Markdown, not in code.** Editing wording should not
mean thinking about backticks and escaping. Fetch them with a cache-busting
param and `cache: 'no-store'` — a static file served through a CDN will keep
serving a stale copy well after it changed, which is indistinguishable from "my
edit did not deploy". Check `git status` and the live file before suspecting
the fetch.

**Compose `common + delta`. Never restate in a delta what the common section
already says.** Every preset gets the common part, so a restatement is two
authorities for one decision — and when they drift, the model picks.

**`override || default` is a SILENT SHADOW.** If a user can save their own copy
of something that also ships and gets updated, every later update is a no-op on
that device, forever, with nothing on screen saying so. The self-clean that
fires when the text matches the current default does not help after a rollback,
because it no longer matches. The UI has to say it out loud and offer one click
back to the shipped version. Generalise it: any `user || shipped` read needs to
declare when the user side is winning.

**Editor-facing and wire-facing resolution are different jobs.** If a prompt
takes a runtime parameter, append it at send time in a separate function.
Appending it in the function the editor loads puts a concrete value into the
textarea, and saving stores it as a permanent override with a stale value baked
in. Append rather than substituting into a placeholder, too — a placeholder
disappears the moment someone edits their copy, and fails silently.

**A parser that reads the model's output must ignore its working-out.** Models
reason before answering, and some prompts ask for it explicitly. That reasoning
repeats the very markers the parser keys off, so every item is counted twice.
Strip `<analysis>`/`<thinking>`/`<scratchpad>` blocks, start from the LAST
occurrence of the output heading, and drop exact repeats within one section.

**Offer only options that actually resolve.** A dropdown listing presets that
have not loaded yet will silently snap back to a fallback the moment one is
picked. Build the list from what is really available, and refresh it when the
load completes.

**Compact the context, in this order:** plain text over JSON (no repeated keys,
braces and quotes per entry); group repeated identifiers onto one line; strip a
redundant year when it is unambiguous, never when it is not; and leave out
lookup tables the model already knows rather than resending them every message.

**A count you print must equal what can be counted below it.** If the renderer
deduplicates, the header cannot report the raw total — someone will count the
lines, and a model is being told a figure its own data does not support. State
what is shown, and say plainly what was collapsed.

**A prompt change cannot be unit-tested.** Tests can prove the file is what it
should be; only a real generated output can show the result improved. Pin the
known-good state by MARKER so a regression is visible, and say in the test that
re-adding a removed rule needs evidence from a real run, not a theory.

## Testing a page in jsdom

- Function *declarations* in a page's inline script land on `window` and are
  callable. Top-level `const`/`let` do NOT, matching real browser semantics —
  extract them separately when a test needs one.
- Objects and arrays returned from the page realm need a
  `JSON.parse(JSON.stringify(x))` round-trip before `deepEqual`, or assert
  reports "same structure but not reference-equal". The same cross-realm trap
  makes `instanceof` fail: duck-type (`typeof x.has === 'function'`) instead,
  or a filter silently does nothing while production works fine.
- **Stub the browser APIs the page touches during evaluation.** An unstubbed
  `matchMedia` throws, which SILENTLY HALTS the rest of the script — every
  top-level `const` after that point stays in TDZ and anything touching one
  fails with "cannot access before initialization". Hoisted function
  declarations keep working, which is exactly why it hides: only late consts
  break, so most tests still pass.
- The same hazard from the other side: **anything reachable from an `async`
  function called at top level must not touch a later top-level `const`.** When
  `fetch` throws *synchronously*, the `catch` and everything after it run
  inline during evaluation, where that const is still in TDZ.
- A module-level cache that never clears persists for a whole test FILE. Two
  tests asserting on the same cached key will silently share the first one's
  result.
- `npm test | grep ...` reports grep's exit code, not the suite's. Check the
  suite's own status before pushing.

**When a constant describes the physical world, pin the test to a measurement
of it — never to a restatement of the constant.** A test that asserts arithmetic
against its own formula is self-consistent and wrong, and will pass happily
while the output is nearly a full line out.

## Printing from a web page

**The page cannot know how tall a printed page will be.** Paper size, margins,
scale and the browser's own injected header/footer are all invisible to it. Any
design that needs that number to decide where content goes is unreliable by
construction — four separate two-column techniques (CSS multi-column, flex,
floats with a global split, floats with real measurement) each failed in real
print in a different way before this was understood.

So: **one full-width column in ordinary document flow.** It is the single thing
browsers have paginated correctly since the web began. Use
`page-break-inside: avoid` on groups that should not split. Accept more physical
pages than a perfectly packed layout; the alternative is a layout that breaks
unpredictably on someone else's printer.

A print window is a fresh document with no access to the opener's CSS custom
properties — hardcode the colours it needs.

And note that neither jsdom nor a real-browser iframe check can validate print
pagination. Only actual print preview can.

## CSS and DOM traps

- **`:not(.x)` matches EVERYTHING when nothing has `.x`.** Styling that only
  makes sense relative to a sibling needs a positive class emitted by the code
  that knows, not a negative selector. This dimmed an entire two-page spread to
  55% whenever neither page was marked active.
- **`JSON.stringify` inside a double-quoted inline handler is malformed.** Its
  quotes close the attribute early and the click silently does nothing — and
  jsdom parses it without complaint, so only actually clicking the element in a
  test catches it. Emit bare identifiers and numbers instead.
- **A second copy of a control is how two copies drift.** Address them by class
  and write to every match; never by id. A test asserting no duplicate ids
  exist is the cheap guard.
- **A control that disappears when you turn it off leaves no way back.** Keep it
  rendered and reflect its state.
- **Reserve space symmetrically when two things must look the same size.** An
  optional sibling given to one of a pair makes that one's content narrower —
  and at a fixed aspect ratio, visibly shorter. Reserve for both or neither, and
  make the declared width match what is actually drawn.
- For a fixed-aspect image, **a height budget and a width budget are the same
  constraint expressed differently**; whichever the layout does not state is the
  one that overflows. On a short screen the chrome is the only lever — measure
  its real box model rather than guessing, and shrink every row the allowance is
  made of, or the number is a lie.
- A "last N days" control: the naive `getDate() - N` is **off by one** against
  how people read the label. Seven days means seven, including today.

## How to work

- **Test the user's own hypothesis first.** When someone reports a specific
  correlation — "it only breaks when X" — reproduce THAT directly before
  theorising. A report that precise is usually right, and twice here a
  confident diagnosis of "stale cache" was wrong while the reported correlation
  was exact.
- **A trend running alongside a regression is not evidence it caused it.** A
  measurable, tidy story (a file growing monotonically) was confidently blamed
  for a quality regression that turned out to be one specific commit. The user
  had the output in front of them; the git log only had a line count. When the
  rollback did not help, the theory was wrong — not the rollback.
- **When a fix does not take, check the code is reached at all** before assuming
  the logic inside it is wrong.
- **Measure rather than assume.** Decode the image, drive the real parser, scan
  every page, run production code over the real export. Repeatedly here the
  reported symptom had a different cause than the obvious one.
- **Correct your own errors plainly and move on.** Say what was wrong, what is
  right, and keep working.
