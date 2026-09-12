---
name: add-bot-command
description: Checklist skill for adding a new command to the Quran Review Telegram bot (telegram-bot/bot.js). Covers command registration, source gating, help text, Firebase data access pattern, optional Gemini call, logging, and manual testing steps.
user-invocable: true
allowed-tools:
  - Read
  - Bash
  - Edit
---

# /add-bot-command — Add a Telegram Bot Command

Guides adding a new command to `telegram-bot/bot.js`. The bot uses
`node-telegram-bot-api` with `bot.onText(CMD(...), handler)`. Commands follow
a consistent pattern: source gate → fetch data from Firebase → optional Gemini
call → format and send reply.

Arguments passed: `$ARGUMENTS`

Parse `$ARGUMENTS` for the command name (e.g. `"clusters"` or `"streak"`).

---

## Step 0 — Read the bot file

Read the full command list and helper functions before adding anything:

```bash
grep -n "^bot\.onText\|^bot\.on\b\|^async function\|^function " telegram-bot/bot.js | head -50
```

Also read one existing command in full — `/status` (around line 1037) or
`/today` (around line 1106) — to see the structure: `CMD()` wrapper,
`isFromAllowedSource()` gate, Firebase read, message send.

---

## Step 1 — Decide the command's scope

Answer before writing code:

| Question | Affects |
|---|---|
| Private (user DM only) or also allowed in channel? | `isFromAllowedSource()` gate |
| Does it read Firebase data? | Which `syncDocRef().get()` fields to read |
| Does it call Gemini? | Whether to use `callGemini()` helper |
| Does it need quran-data.js functions? | Already available via `require('./quran-data')` |
| Does it accept optional arguments? | Capture group in regex |

**Source gating rules:**
- DM-only: `if (!isFromAllowedSource(msg)) return;` at the top of the handler.
- Channel-allowed: channel posts are routed separately via `bot.on('channel_post')`.
  A command meant for the channel goes inside that handler's own routing, not
  in a `bot.onText()`.

---

## Step 2 — Register the command

Find the block of `bot.onText(CMD(...))` calls and add the new one in a logical
position (group related commands together):

```js
bot.onText(CMD(/\/(?:<name>|<short>)(?:\s+(.+))?/), async (msg, match) => {
  if (!isFromAllowedSource(msg)) return;
  const arg = match?.[1]?.trim() || null;

  try {
    // ... implementation ...
    await bot.sendMessage(msg.chat.id, reply, { parse_mode: 'HTML' });
  } catch (err) {
    logError('/<name> error:', err.message);
    await bot.sendMessage(msg.chat.id, '❌ Something went wrong.');
  }
});
```

**`CMD()` wrapper** applies the `isFromAllowedSource` channel-prefix filter and
handles `@BotName` suffixes — always use it instead of a bare regex.

**`parse_mode: 'HTML'`** — use HTML for formatting (`<b>`, `<i>`, `<code>`),
not Markdown. Telegram's MarkdownV2 requires escaping every special character;
HTML is safer for dynamic content.

---

## Step 3 — Read Firebase data (if needed)

The standard pattern for reading the sync account's data:

```js
const accountName = getLinkedAccount(msg.chat.id);
if (!accountName) {
  await bot.sendMessage(msg.chat.id, 'No account linked. Use /link <account>.');
  return;
}
const doc = await syncDocRef(accountName).get();
if (!doc.exists) {
  await bot.sendMessage(msg.chat.id, 'No data found for this account.');
  return;
}
const data = doc.data();
```

Access review data via `data.review.*` — same field names as `buildSyncPayload()`
in `review.html`. The full shape is in `review.html`'s `buildSyncPayload()`
function (read it to know what's available).

---

## Step 4 — Call Gemini (if needed)

For AI-powered commands, use the `callGemini()` helper already in the file:

```js
const apiKey = data.review?.agentApiKey || process.env.GEMINI_API_KEY;
if (!apiKey) {
  await bot.sendMessage(msg.chat.id, '⚠️ No API key configured.');
  return;
}
const model = data.review?.agentModel || DEFAULT_GEMINI_MODEL;
const response = await callGemini(systemPrompt, userMessage, apiKey, model);
```

Send long responses in chunks — Telegram's message limit is 4096 characters:
```js
const MAX = 4000;
for (let i = 0; i < response.length; i += MAX) {
  await bot.sendMessage(msg.chat.id, response.slice(i, i + MAX), { parse_mode: 'HTML' });
}
```

---

## Step 5 — Add to the help text

Find the `/help` handler (search `CMD(/\/(?:commands|help|h)/)`). Add one line
for the new command:

```js
/<name>|/<short>  — <one-line description>
```

Keep help lines short — they're sent as one message and shouldn't overflow.

---

## Step 6 — Add logging

Use the existing `logInfo`/`logError` helpers (defined near the top of bot.js)
rather than `console.log`:

```js
logInfo(`/<name> called by chat ${msg.chat.id}`);
logError('/<name> error:', err.message);
```

The bot runs as a daemon in production; its logs go to `telegram-bot/logs/`
and are checked by `/housekeeping`.

---

## Step 7 — Manual test

Start the bot locally and test before committing:

```bash
cd telegram-bot && node bot.js
```

Test cases to cover manually:
1. Happy path — send the command, confirm expected reply.
2. No account linked — confirm graceful error message.
3. Optional arg — send with and without the argument, confirm both work.
4. Long output — if the response could exceed 4096 chars, test with a large
   dataset.

The bot reads `.env` for `BOT_TOKEN` — make sure `.env` exists locally:
```bash
ls telegram-bot/.env
```

---

## Step 8 — Commit

Commit only `telegram-bot/bot.js` (and `.env.example` if you added a new
env var). Never commit `.env` itself — it's gitignored and contains the bot
token.

```bash
git add telegram-bot/bot.js
git commit -m "Bot: add /<name> command — <one-line description>"
```

No version bump needed for bot-only changes (version.js tracks the web app).

---

## Quick checklist

```
[ ] bot.onText() registered with CMD() wrapper
[ ] isFromAllowedSource() gate at top of handler
[ ] try/catch with logError + user-facing error message
[ ] Firebase read follows getLinkedAccount → syncDocRef → doc.exists pattern
[ ] Gemini call uses callGemini() helper (if AI response needed)
[ ] Long responses chunked at 4000 chars (if output could be long)
[ ] parse_mode: 'HTML' on all sendMessage calls with formatting
[ ] /help text updated with new command
[ ] logInfo at start of handler
[ ] Manual test: happy path, no account, with/without arg
[ ] .env present locally, NOT committed
```
