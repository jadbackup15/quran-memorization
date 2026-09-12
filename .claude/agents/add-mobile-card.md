---
name: add-mobile-card
description: Checklist skill for adding a new card to the mobile home screen in review.html. Covers card HTML placement, expand/collapse structure, ▴ Collapse button, render function wiring into mobShowHome/mobRefreshHome, mobCollapseCards integration, optional stats strip stat, and CSS. Prevents the recurring pattern where a card's collapse or render function gets missed.
user-invocable: true
allowed-tools:
  - Read
  - Bash
  - Edit
---

# /add-mobile-card — Add a Mobile Home Screen Card

Guides adding a new `.mob-action-card` to the mobile home screen (`#mobile-home`)
correctly. The home screen has accumulated bugs from missed wiring — render
functions not called on home load, collapse logic not updated, stats not
refreshing. This skill ensures every step is covered.

Arguments passed: `$ARGUMENTS`

Parse `$ARGUMENTS`:
- Card name/title (e.g. `"Practice More"`)
- `--expandable` — card has a collapsible inner panel (like Revise or Drill)
- `--static` — card shows fixed content only, no expand (like Sync card)
- `--stat` — also add a tappable stat to the stats strip

---

## Step 0 — Read current state

Read the full `#mobile-home` div (search for `<div id="mobile-home">`) to
understand the current card order and naming. Card order rule: **daily-use
cards first** (Revise, Drill, Agent), **less-frequent cards last** (Sync). A
new card goes before Sync unless it's genuinely a one-time-setup card.

Also read:
```bash
grep -n "function mobShowHome\|function mobRefreshHome\|function mobCollapseCards\|function mobCollapseRevise\|function mobCollapseDrill\|function renderMob" review.html | head -30
```

This tells you what render functions already exist and where to add new ones.

---

## Step 1 — Plan the card

Decide before writing HTML:

| Question | Answer affects |
|---|---|
| What is the card's primary tap action? | The `<button class="mob-action-btn">` `onclick` |
| Does it expand to show more content? | Whether to add `--expandable` inner div |
| What icon color? (green/orange/purple/blue) | `.mob-action-icon` class color |
| What sub-text shows by default? | Static text or a rendered `id=` element |
| Does it need a stat on the stats strip? | Whether to add a `.mob-stat-box` |

---

## Step 2 — Add the card HTML

In `review.html`, find `<!-- Sync account card -->` and insert the new card
**above** it (unless it's a sync/account card itself). Use this template:

**Static card (no expand):**
```html
<!-- <CardTitle> card -->
<div class="mob-action-card">
  <button class="mob-action-btn" onclick="<primaryAction>()">
    <div class="mob-action-icon <color>">🔖</div>
    <div>
      <div class="mob-action-title"><CardTitle></div>
      <div class="mob-action-sub" id="mob-<slug>-sub"><default sub-text></div>
    </div>
  </button>
  <div style="border-top:1.5px solid var(--card-border);padding:10px 14px 14px;display:flex;flex-wrap:wrap;gap:8px;">
    <button class="mob-hizb-action-btn" style="flex:1;min-width:90px" onclick="<action1>()">Action 1</button>
    <button class="mob-hizb-action-btn" style="flex:1;min-width:90px" onclick="<action2>()">Action 2</button>
  </div>
</div>
```

**Expandable card (`--expandable`):**
```html
<!-- <CardTitle> card -->
<div class="mob-action-card">
  <button class="mob-action-btn" onclick="mobToggle<Slug>()">
    <div class="mob-action-icon <color>">🔖</div>
    <div>
      <div class="mob-action-title"><CardTitle></div>
      <div class="mob-action-sub" id="mob-<slug>-sub"><default sub-text></div>
    </div>
  </button>
  <div class="mob-<slug>-inner" id="mob-<slug>-inner" style="display:none">
    <!-- inner content here -->
    <div style="display:flex;gap:8px;padding:0 14px 14px;flex-wrap:wrap;">
      <button class="mob-hizb-action-btn" onclick="...">Action</button>
    </div>
    <button class="mob-collapse-btn" onclick="mobCollapse<Slug>()">▴ Collapse</button>
  </div>
</div>
```

Collapse button rule: always the **last element** inside the expandable inner
div, always calls a dedicated `mobCollapse<Slug>()` function.

---

## Step 3 — Add CSS for the inner panel (if expandable)

Inside the `@media (max-width: 600px)` block (or the existing mobile CSS
section), add styles for the inner div. Find `.mob-drill-inner` as reference:

```css
.mob-<slug>-inner { border-top: 1.5px solid var(--card-border); }
```

If the inner needs to start `display: none` and be toggled via a class instead
of inline style, use the `.visible` pattern:

```css
.mob-<slug>-inner { display: none; }
.mob-<slug>-inner.visible { display: flex; flex-direction: column; ... }
```

---

## Step 4 — Add the JS functions

**Render function** — called every time the home screen loads or refreshes:
```js
function renderMob<Slug>Card() {
  const el = document.getElementById('mob-<slug>-sub');
  if (!el) return;
  // compute sub-text from localStorage / current state
  el.textContent = '<computed sub-text>';
}
```

**Collapse function** (if expandable):
```js
function mobCollapse<Slug>() {
  const inner = document.getElementById('mob-<slug>-inner');
  if (inner) inner.style.display = 'none';
  // If using .visible class instead:
  // if (inner) inner.classList.remove('visible');
}
```

**Toggle/expand function** (if expandable):
```js
async function mobToggle<Slug>() {
  const inner = document.getElementById('mob-<slug>-inner');
  if (!inner) return;
  const isOpen = inner.style.display !== 'none';
  if (isOpen) { mobCollapse<Slug>(); return; }
  inner.style.display = 'block';
  // load content async if needed
}
```

---

## Step 5 — Wire render function into `mobShowHome()` and `mobRefreshHome()`

**This is the step most commonly missed.** Find both functions and add the
render call to each:

```js
function mobShowHome() {
  // ... existing calls ...
  renderMobStats();
  renderMob<Slug>Card();   // ← add here
}
function mobRefreshHome() {
  // ... existing calls ...
  renderMobStats();
  renderMob<Slug>Card();   // ← add here
}
```

Also call it from any setter that changes the displayed data. For example, if
the sub-text shows the active preset, call `renderMob<Slug>Card()` at the end
of `setAgentPromptPreset()`.

---

## Step 6 — Wire collapse into `mobCollapseCards()` (if expandable)

Find `function mobCollapseCards()` and add:

```js
function mobCollapseCards() {
  mobCollapseRevise();
  mobCollapseDrill();
  mobCollapse<Slug>();   // ← add here
  // ... existing collapses ...
}
```

This ensures the card collapses automatically when the user swipe-lefts (the
existing gesture handler calls `mobCollapseCards()`), navigates away, or
refreshes the home screen.

---

## Step 7 — Add a stats strip stat (if `--stat`)

In the `#mob-stats-strip` div, add a new `.mob-stat-box`:

```html
<button class="mob-stat-box mob-stat-btn" id="mob-stat-<slug>" onclick="mobShow<Slug>Detail()">
  <div class="mob-stat-value" id="mob-stat-<slug>-val">–</div>
  <div class="mob-stat-label"><Label></div>
</button>
```

Then in `computeMobStats()` (find it by searching for `computeMobStats`) or
`renderMobStats()`, set the value:

```js
const el = document.getElementById('mob-stat-<slug>-val');
if (el) el.textContent = String(computedValue);
```

Stats strip rule: ≤ 3 stats are safe; 4+ makes each chip too narrow to read
on a phone. Only add a stat if it answers "what should I do right now?" — a
count the user checks before every session.

---

## Step 8 — Check tab bar (no action usually needed)

The mobile tab bar should stay at 5 tabs maximum:
```bash
grep -c "mobile-tab-btn" review.html
```
Count should be ≤ 5. If a new card makes a **new dedicated tab necessary**,
first ask whether the card's home-screen presence + full-app route is enough
before adding a 6th tab.

---

## Step 9 — Bump version and commit

Mobile home changes are user-visible: bump `version.js` and `sw.js` to the
next patch or minor, commit `review.html` + both version files.

---

## Quick checklist

```
[ ] Card HTML added in right order (daily-use before Sync)
[ ] Inner div + ▴ Collapse button (if expandable)
[ ] CSS for inner panel (if expandable)
[ ] renderMob<Slug>Card() implemented
[ ] renderMob<Slug>Card() wired into mobShowHome()
[ ] renderMob<Slug>Card() wired into mobRefreshHome()
[ ] mobCollapse<Slug>() implemented (if expandable)
[ ] mobCollapse<Slug>() wired into mobCollapseCards() (if expandable)
[ ] Stat added to strip (if --stat)
[ ] Tab count still ≤ 5
[ ] Version bumped
```
