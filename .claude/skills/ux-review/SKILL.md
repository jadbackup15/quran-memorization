---
name: ux-review
description: Full UX audit of review.html — desktop and mobile. Extracts the real tab/sub-tab/section tree, inventories every feature, checks reachability at runtime in jsdom, finds naming collisions, orphaned handlers, duplicate element IDs and mobile gaps, then produces a prioritised action plan with a health score. Run every few weeks, or after a burst of UI changes. Supports --mobile and --desktop flags.
user-invocable: true
allowed-tools:
  - Read
  - Bash
---

# /ux-review — Quran Review UX audit

Audits `review.html` end to end and produces a prioritised, actionable report.

**Arguments:** `$ARGUMENTS`
- `--mobile` — lead with mobile findings, weight them heavier. Still audit desktop for context.
- `--desktop` — skip the mobile-only sections.
- none — full audit, equal weight.

## Ground rules

- **Measure, don't eyeball.** `review.html` is ~20,000 lines. Reading it top to
  bottom and forming an impression produces a vague report. Every structural
  claim below comes from a command you actually run.
- **Check at runtime, not just in the source.** Most of this app's UI is
  rendered by JS. A feature that looks absent in the markup may be injected on
  render, and a feature that looks present may never be reachable. The repo has
  a jsdom harness (`test/helpers/loadPage.js`) — use it.
- **Be specific.** "Move X from tab Y to tab Z" is a finding. "Improve
  navigation" is not. Every item needs a concrete change.
- **Severity is the point.** Not all findings matter equally. A report where
  everything is High is a report nobody acts on.
- No suggestions requiring a build step or a backend — this is a static HTML
  PWA served as-is.
- Prefer moving or renaming over deleting. Do not propose removing a feature
  that is in active use.

---

## Step 1 — Extract the real structure

Run these. Do not substitute reading the file by hand.

**Version and the tab bar:**

```bash
grep APP_VERSION version.js | head -1
grep -o 'class="view-tab[^"]*" data-view="[^"]*"[^>]*>[^<]*' review.html \
  | sed 's/.*data-view="\([^"]*\)".*>\(.*\)/\1 → \2/'
```

**Sub-tabs per view, and sections per sub-tab.** Depth-match the divs — a
naive "find the next `<div id=`" boundary bleeds across blocks and will report
sections that belong to a different sub-tab (and can pull in the passcode
overlay, which sits outside every view):

```bash
python3 - <<'PY'
import re
s = open('review.html').read()

def block_of(start):
    i = s.index('>', start) + 1
    depth, tag = 1, re.compile(r'<(/?)div\b', re.I)
    while depth and i < len(s):
        m = tag.search(s, i)
        if not m: break
        depth += -1 if m.group(1) else 1
        i = m.end()
    return s[start:i]

for m in re.finditer(r'<div id="(view-[a-z]+)"', s):
    view, block = m.group(1), block_of(m.start())
    subs = re.findall(r'class="log-subtab[^"]*"[^>]*data-subview="([^"]+)"[^>]*>([^<]*)', block)
    print(f'{view}  ({len(subs)} sub-tabs){"  ⚠ >4" if len(subs) > 4 else ""}')
    for sv, label in subs:
        sm = re.search(r'<div id="[a-z]+-subview-' + sv + r'"', s)
        hs = re.findall(r'<h2[^>]*>(.*?)</h2>', block_of(sm.start()), re.S) if sm else []
        hs = [re.sub(r'<[^>]+>', '', h).strip() for h in hs]
        print(f'   {sv:14s} {label.strip():26s} {len(hs)} sections{"  ⚠ >6" if len(hs) > 6 else ""}')
        for h in hs: print(f'        · {h[:52]}')
PY
```

**Mobile bottom bar and home cards**, including how many buttons each card
carries (a card with 3+ sub-buttons is hard to hit accurately on a phone):

```bash
python3 - <<'PY'
import re
s = open('review.html').read()
print('BOTTOM BAR')
for m in re.finditer(r'<button class="mobile-tab-btn[^"]*"([^>]*)>(.*?)</button>', s, re.S):
    dv = re.search(r'data-view="([^"]+)"', m.group(1))
    print('  ', (dv.group(1) if dv else 'home'), ' '.join(re.sub(r'<[^>]+>', ' ', m.group(2)).split()))
print('HOME CARDS (document order)')
home = s[s.index('<div id="mobile-home"'):]
for m in re.finditer(r'<div class="mob-action-card"([^>]*)>', home[:60000]):
    seg = home[m.start():m.start()+2600]
    t = re.search(r'class="mob-action-title"[^>]*>(.*?)<', seg)
    sub = re.search(r'class="mob-action-sub"[^>]*>(.*?)<', seg)
    n = len(re.findall(r'<button', seg))
    print(f'   {(t.group(1).strip() if t else "?"):22s} buttons={n}{"  ⚠ >2" if n > 2 else ""}'
          f'{"  [HIDDEN]" if "display:none" in m.group(1) else ""}  sub="{(sub.group(1).strip() if sub else "")[:38]}"')
PY
```

**Feature inventory** — every `<h2>` and card title in the file, for the
reachability comparison in Step 3.

## Step 2 — Desktop

For each top-level tab judge:

- **Naming.** A tab answers "what will I DO here?", not "what category is
  this?". Flag any two tabs whose labels a new user could not tell apart.
- **Default sub-tab.** Is the one that opens the one you most want after
  tapping the tab? A setup/import screen opening by default ahead of the daily
  action is a real cost, paid every day.
- **Section relevance and order.** Most actionable first, without scrolling.
  Flag anything that belongs in a different tab, and any admin/utility section
  sitting in a daily-use context.
- **Cognitive load.** >4 sub-tabs per tab, or >6 sections per sub-tab, is a
  warning sign — the extraction above flags these for you.
- **Empty states.** Sections that are empty most of the time should collapse,
  not occupy space.

## Step 3 — Mobile

**Bottom bar:** more than 5 tabs is too many. Do labels match their desktop
counterparts? Is the most-used daily action one tap from anywhere?

**Coverage — the check most worth running.** Find every top-level view with no
bottom-bar tab AND no home card. Those are reachable only via "Full App", which
in practice means not reachable:

```bash
node -e "
const { loadPage } = require('./test/helpers/loadPage.js');
(async () => {
  const w = (await loadPage('review.html')).window, D = w.document;
  const bar = new Set([...D.querySelectorAll('.mobile-tab-btn[data-view]')].map(b => b.dataset.view));
  const all = [...D.querySelectorAll('.view-tab[data-view]')].map(b => b.dataset.view);
  console.log('no mobile tab:', all.filter(v => !bar.has(v)).join(', ') || 'none');
  w.mobShowHome();
  console.log('home cards  :', [...D.querySelectorAll('#mobile-home .mob-action-title')].map(e => e.textContent.trim()).join(' | '));
})();
"
```

**Home cards:** ordered most-used first? Does each sub-text say what actually
happens on tap? Any card `display:none` or commented out — restore, or delete?

**Newest features:** for anything added since the last audit, verify it is
actually reachable on a phone by driving it in jsdom, not by assuming. Render
functions inject most controls, so static grep under-reports. Mirror this
shape:

```bash
node -e "
const { loadPage } = require('./test/helpers/loadPage.js');
(async () => {
  const w = (await loadPage('review.html')).window, D = w.document;
  w.fetchSurahData = async n => ({ surahInfo:{number:n,englishName:'S',name:'س'},
    arabicAyahs: Array.from({length:286},(_,i)=>({numberInSurah:i+1,text:'a',page:2+Math.floor(i/8)})),
    transAyahs:  Array.from({length:286},(_,i)=>({numberInSurah:i+1,text:'t'})) });
  w.localStorage.setItem('quranReviewMemorizedHizbs', JSON.stringify([1,2,3]));
  w.mobShowHome();
  await new Promise(r => setTimeout(r, 60));
  // ...drive each new feature and assert its controls exist
})();
"
```

Then list features that exist on desktop with **no mobile equivalent at all**,
and suggest mobile-native additions worth having: one-tap logging, offline
indicators, share-sheet or shortcut entry points, reminders, swipe between
related views.

## Step 4 — Cross-cutting

Run these — each has caught a real defect in this app:

**Duplicate element IDs.** Two panels can each own `#foo` safely while they are
separate sub-views, and collide the moment they are merged:

```bash
node -e "
const h = require('fs').readFileSync('review.html','utf8');
const ids = [...h.matchAll(/\sid=\"([^\"]+)\"/g)].map(m => m[1]);
const d = [...new Set(ids.filter((x,i) => ids.indexOf(x) !== i))];
console.log('duplicate ids:', d.join(', ') || 'none');
"
```

**Handlers pointing at nothing** — a rename or removal that left a caller
behind. Cross-check every `onclick=\"name(\"` against the defined functions.

**Naming collisions.** Two features sharing a word users will read as the same
thing. Compare every user-facing label — tab, sub-tab, card title, section
heading, dropdown option, print title — and flag near-synonyms, not just exact
matches.

**Terminology drift.** Is one concept called the same thing on desktop, on
mobile, on a card and in a print report?

**Destructive actions.** Is anything irreversible reachable without a
`confirm()`, or sitting where a mis-tap finds it?

**Visual weight vs. frequency.** Does a rarely-used section occupy as much
space as a daily one?

## Step 5 — Action plan

Three tiers. For each item: one sentence on **what to change**, one on **why**
(the user-facing benefit).

- 🔴 **High (this week)** — actively causes confusion or wasted taps daily.
- 🟡 **Medium (this month)** — a real improvement, not blocking anyone today.
- 🟢 **Backlog** — worth keeping, not urgent.

Prefer changes that are cheap and unambiguous. A one-string rename that removes
a genuine ambiguity outranks a restructure that might.

## Step 6 — Summary

Three to five sentences:
- What is working and should not be touched.
- The single most impactful change.
- The biggest mobile-specific gap.
- **Health: 🟢 Healthy / 🟡 Needs attention / 🔴 Needs work.**

Header the report with the app version and today's date so successive audits
can be compared.

## Tone

Plain markdown, ready to paste into an issue. Direct: "this section is
misplaced", not "you might consider potentially moving this section". Say what
you verified and how; if something could not be checked, say that rather than
implying it passed.
