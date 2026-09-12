---
name: ux-review
description: Audit the Quran Review app's UX — tab names, section order, section relevance, mobile home cards, bottom nav, and missing mobile features. Run every few weeks to keep the app sharp. Supports --mobile flag to focus on mobile-specific analysis.
user-invocable: true
allowed-tools:
  - Read
  - Bash
---

# /ux-review — Quran Review App UX Audit

Performs a thorough UX review of `review.html` and produces a structured,
prioritised improvement plan. Covers desktop navigation, mobile navigation,
section relevance and ordering, and missing features. Culminates in a concrete
**Action Plan** the developer can work through over the next few weeks.

Arguments passed: `$ARGUMENTS`

Parse `$ARGUMENTS`:
- If `--mobile` or `mobile` is present → **Mobile-focused mode**: weight the
  mobile home screen, bottom bar, and missing mobile features more heavily;
  still audit desktop for context but lead with mobile findings.
- If `--desktop` or `desktop` is present → **Desktop-focused mode**: skip the
  mobile missing-features section.
- Default (no flag) → **Full audit**: both desktop and mobile, equal weight.

---

## Step 1 — Read the source

Read the following files before starting any analysis. Do not skip any:

1. `review.html` — the main app (large file; read in sections as needed)
2. `version.js` — current version number (to include in the report header)

From `review.html`, extract:

**Desktop navigation:**
- The desktop tab bar (`#desktop-tab-bar` / `.view-tab` buttons): all `data-view`
  values and their visible labels.
- For each top-level view (`#view-*`), list:
  - Its sub-tabs (`.log-subtab` buttons inside that view) and their labels.
  - Every `<h2>` heading inside each sub-tab div, in document order.
  - Whether the view/sub-tab is marked `active` (i.e. the default).

**Mobile navigation:**
- The mobile bottom bar (`#mobile-tab-bar` / `.mobile-tab-btn` buttons).
- The mobile home screen (`#mobile-home`):
  - All `.mob-action-card` divs — their title (`.mob-action-title`) and
    sub-text (`.mob-action-sub`), and document order.
  - Whether any card is commented out or `display:none`.
- The mobile overlay menu (`#agent-mobile-menu` or similar), if present.

**Feature inventory:**
- List every distinct user-facing feature found as an `<h2>` or card title
  anywhere in the file.

---

## Step 2 — Analyse desktop UX

For each top-level tab, evaluate:

**Naming** — Does the tab label clearly describe the primary action or content?
Tabs are navigation, not categories — they should answer "what will I DO here?"

**Default sub-tab** — Is the first/default sub-tab the one a user is most
likely to want immediately after tapping the tab?

**Section relevance** — Do all sections inside a sub-tab belong there? Flag
any section that feels misplaced (belongs in a different tab/sub-tab), or
that is clearly a utility/admin item placed in a daily-use context.

**Section order** — Within a sub-tab, are sections ordered most-important-first?
The user should see the most actionable information without scrolling.

**Empty or redundant sections** — Are there sections with no data most of the
time that could be collapsed or removed?

**Cognitive load** — Count the sub-tabs per tab. More than 4 sub-tabs is a
warning sign. More than 6 sections per sub-tab is a warning sign.

Produce findings as a table:

| Tab | Sub-tab | Finding | Severity (High/Med/Low) | Suggestion |
|-----|---------|---------|------------------------|------------|

---

## Step 3 — Analyse mobile UX

### Bottom bar

- Are there more than 5 tabs? (5 is the safe maximum for a bottom bar.)
- Do the tab labels match their desktop counterparts? Inconsistent naming
  between desktop and mobile is confusing.
- Is the most-used daily tab reachable in one tap from anywhere?

### Home screen cards

Evaluate each card in document order:

**Relevance** — Does this card represent something the user does daily, weekly,
or occasionally? A daily action should be a card; an occasional utility should
not.

**Order** — Cards should be ordered: most-used daily action first, least-used
last. Flag any card that appears above a more-frequently-used one.

**Card content** — Does the card's sub-text accurately describe what happens
when you tap it? Is it actionable or vague?

**Removed cards** — Check if any card is `display:none` or commented out.
Explain whether it should be restored, kept hidden, or permanently deleted.

**Sub-buttons on cards** — Cards with more than 2 sub-action buttons are hard
to tap accurately on a phone. Flag any card with 3+ sub-buttons and suggest
collapsing or moving them.

### Missing mobile features

Compare the full feature inventory (Step 1) against what is reachable from
the mobile home screen and bottom bar. For each feature only reachable via
the full-app view (not from the home or bottom bar), categorise it:

| Feature | Currently reachable via | Worth a mobile shortcut? | Suggestion |
|---------|------------------------|--------------------------|------------|

Then identify features that exist on desktop but have **no mobile equivalent
at all** — not even accessible via full-app — and list them as gaps.

Finally, suggest **new features** that would be high-value on mobile given
how the app is used (daily recitation logging, quick mistake entry, quick
revision). Consider:
- Quick-log shortcuts (e.g. "log 0 mistakes for today's Hizb" in one tap)
- Offline-first indicators
- Widget or share-sheet integration ideas
- Voice/dictation entry for mistakes
- Push notification for daily review reminders
- Swipe gestures between related views
- Any pattern common in Quran/Islamic apps that is missing here

---

## Step 4 — Cross-cutting findings

- **Terminology consistency**: Are the same concepts called the same thing
  everywhere (desktop tab, mobile tab, card title, section heading, print
  report)?
- **Feature discoverability**: Are there powerful features buried so deep that
  a new user would never find them?
- **Dangerous or destructive actions**: Are any irreversible actions (delete,
  import-replaces-all) placed where they could be triggered accidentally?
- **Visual weight vs. usage frequency**: Do rarely-used sections take up as
  much space as daily-use ones?

---

## Step 5 — Action Plan

Produce a prioritised action plan with three tiers:

### 🔴 High priority (do within 1 week)
Changes where the current UX actively causes confusion or wasted taps on a
daily basis.

### 🟡 Medium priority (do within 1 month)
Improvements that would meaningfully improve the experience but aren't
blocking anyone today.

### 🟢 Nice to have (backlog)
Ideas worth keeping but not urgent — new features, polish, explorations.

For each item, write one sentence on **what to change** and one on **why**
(the user-facing benefit). Keep suggestions specific enough to act on:
"Move X from tab Y to tab Z" is good; "improve navigation" is not.

---

## Step 6 — Summary

End with a 3–5 sentence executive summary:
- What is working well and should not change.
- The single most impactful change to make.
- The biggest gap for mobile users specifically.
- Overall UX health score: 🟢 Healthy / 🟡 Needs attention / 🔴 Needs work.

Include the app version and today's date in the report header so this can be
filed and compared against a future audit.

---

## Tone and format

- Write the report in plain markdown, ready to paste into a GitHub issue or
  share with a collaborator.
- Be direct — say "this section is misplaced" not "you might consider
  potentially moving this section".
- Severity ratings matter: not every finding is equal. Focus the developer's
  attention on the high-priority items.
- Do not suggest changes that require a backend or a build step — this is a
  static HTML PWA, no build pipeline.
- Do not suggest removing features that are actively used — prefer moving or
  hiding over deleting.
