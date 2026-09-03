Paste this straight into Telegram as the pinned message — the *bold* and
`code` formatting below converts automatically when you send it (or use
the app's own formatting menu on the selected text if it doesn't).

📖 *Mistake Log Format*
One line per item — mix freely in a message.

*Ayah mistake*
• `218` — just the number
• `218S` or `218 S` — with a type code
• `218 B forgot ina` — type + note
• `218SB` — more than one type (S and B)

*Type codes*
• `S` stopped
• `B` forgot beginning
• `W` word slip
• `M` multiple mistakes
• `T` mutashabihat
• `E` ending
• `K` weak
• `A` needs attention — not a mistake
• combine A with another code for a near-miss, e.g. `218 AB` — almost forgot the beginning (still not a mistake)

*Switch surah*
• `3:` — everything below is Surah 3 until the next N:
• `3:15` — switch AND log ayah 15 in one line

*Hizb recited with zero mistakes*
• `h5`

*Practice more* — not a mistake, just a drill goal
• `r15-23x20` — current surah, ayat 15-23, 20 times
• `r2:158-163x20` — explicit surah inline (no preceding `2:` line needed)
• `r15x30` — single ayah (no range needed), 30 times
• put it after a `3:` line to target a different surah, or use the `S:` prefix inline
• `r15-23x20 done` — already completed, not a fresh goal (also accepts `d` or `✅` in place of `done`)
• `r15x30 d` — same, for a single ayah
• `p15` — revisit page 15 (defaults to 5 times)
• `p15x20` or `p15 x20` — page 15, 20 times instead of the default
• `p15x20 done` — page 15 already reviewed 20 times (also accepts `d` or `✅`)

*Mutashabihat* — ayat you find easy to confuse with each other
• `m15` — anchor ayah 15 (current surah), no confusable yet (add later via Edit)
• `m15,23` — anchor 15, confused with ayah 23 (both in current surah)
• `m15,23,25` — anchor 15, confused with 23 and 25
• `m2:15,3:23` — explicit surahs for any/all refs
• put it after a `3:` line to target a different surah for bare numbers
• re-importing the same line is always safe — new confusables are merged in, never duplicated

*Agent context note* — qualitative input fed to the AI agent
• `note: hizb 4 and 5 seem weak, especially the start of hizb 4` — any free-text note prefixed with `note:`
• the agent sees this alongside your mistake data and weighs your own judgement

*Close surah context* — post at the end of each sitting
• `//` — resets the carry-forward surah; the next import must have an explicit `2:` or `3:` line to know which surah it's for
• good practice: post `//` after every sitting to prevent a stale surah from silently attributing future messages to the wrong surah

*Import checkpoint* — a message on its own
• `start` (or just `🚩`) — everything at or before this message is skipped on every future import (the app has an "ignore checkpoint" option for a one-off import of everything anyway)
• posting a newer one later moves the checkpoint forward

—
Case-insensitive. Post one message per sitting.
Re-importing is always safe — nothing is ever duplicated.
No surah given anywhere? You'll be asked — never guessed.
Arabic-Indic numerals (٢١٨) work anywhere a number does, same as 218.

📱 *Agent Prompts — when to use each*

*General* — open questions about your data
• "What went wrong in the last week?"
• "Which ayat should I focus on in hizb 3?"
• "Which 2 clusters do you suggest for hizb 1 and 2?"
• "Why do I keep making type B mistakes?"

*Print* — generate a ready-to-print review plan
• Run after a session to get a structured ☐ checklist
• Includes cluster categories (Very Weak / Weak / OK / review)
• Hizb-level run suggestions when several clusters fall in one Hizb
• Mutashabihat warnings inline with each cluster
• Output is formatted to hand to a teacher or print before revision
