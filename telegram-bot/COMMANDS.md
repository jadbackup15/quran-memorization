# Quran Revision Bot — Commands

Bot: @tasmee315_bot

---

## Commands

### /revise
Get a random page to revise from your memorized hizbs.

```
/revise
/revise jnaja92
```

Returns the first ayah of a picked page and the first ayah of the next page. Weighted by your logged mistakes and mutashabihat (25% mistakes, 25% mutashabihat, 50% random).

**Timeout:** 20s  
**Cost per call:** ~$0.00006 | **per 10,000 calls:** ~$0.60

---

### /today
Summary of today's recitation session.

```
/today
```

Shows: hizbs recited, total mistakes, top missed ayat (up to 5).

**Timeout:** 10s  
**Cost per call:** ~$0.000011 | **per 10,000 calls:** ~$0.11

---

### /import
Import ayah mistakes from your Telegram mistakes channel.

```
/import           — fetch last ~100 channel messages (default)
/import 500       — fetch last ~500 messages (goes further back)
```

Fetches the specified number of messages via Telegram's pagination, parses them the same way the app does, deduplicates against what's already saved, and writes new mistakes to Firestore. Reports how many were imported and how many were skipped (no surah context — add a `2:` line to the channel to set it).

**Timeout:** 30s (100 msgs) – 120s (500+ msgs)  
**Cost per call:** ~$0.00008 (100 msgs) – ~$0.0004 (500 msgs, ~25 page fetches) | **per 10,000 calls:** ~$0.80 – $4.00

---

### /agent
Ask Gemini for a print sheet recommendation based on your current data.

```
/agent            — Flash model, mistakes only (excludes Needs Attention)
/agent pro        — Pro model instead of Flash
/agent m          — include mutashabihat group details in context
/agent a          — treat Needs Attention (type A) as real mistakes
/agent am         — both flags (also: /agent ma, /agent pro m, /agent pro am, etc.)
```

Calls the Gemini API with your mistakes and recitation log as context, and returns a recommendation for what to include in a print review sheet. Uses the "Print" prompt override from the app if you've set one, otherwise uses the built-in default.

**Requires:** Gemini API key saved in the app (Agent Chat tab → Settings → ☁️ Save to Firebase).

Flags:
- `pro` — use Gemini 2.5 Pro instead of Flash (slower, smarter, ~5× more expensive)
- `m` — adds full mutashabihat group details (anchor ↔ confusables + note) to the context Gemini sees
- `a` — counts Needs Attention ayat as mistakes in the context (useful if you want those included in Gemini's prioritisation)
- Flags can be combined in any order: `am`, `pro m`, `pro am`, etc.

**Timeout:** 90s  
**Cost per call:** ~$0.0002 (Flash) / ~$0.001 (Pro) | **per 10,000 calls:** ~$2 (Flash) / ~$10 (Pro)

---

### /reviewed
Log that you reviewed a hizb without tracking mistakes (records `mistakes: null` session).

```
/reviewed 3
/reviewed 3,4,5
/reviewed 3 4 5
```

Writes a N/A session to `review.recitationLog` directly in Firebase. Idempotent — if you already logged that hizb today, it skips it. Shows up in the Overview tab's Review Schedule section and in `/status`.

**Timeout:** 10s  
**Cost per call:** ~$0.000011 | **per 10,000 calls:** ~$0.11

---

### /status
Show your linked account info and review schedule.

```
/status
```

Shows: account name, memorized hizbs (count + list), total logged mistakes, mutashabihat group count, and a per-hizb review schedule sorted by most-overdue first.

**Timeout:** 10s  
**Cost per call:** ~$0.000011 | **per 10,000 calls:** ~$0.11

---

### /link
Connect to a sync account. Only needed once per bot session (link clears on bot restart).

```
/link jnaja92
```

**Timeout:** 10s  
**Cost per call:** ~$0.000011 | **per 10,000 calls:** ~$0.11

---

### /whoami
Find your Telegram user ID (to add to ALLOWED_USER_IDS in .env to lock the bot to yourself).

```
/whoami
```

Always works — no account needed, not gated by ALLOWED_USER_IDS.

---

## Deploy to Cloud Run

**Normal deploy — do NOT pass env vars at all.** They already live on the
service and are preserved automatically:

```sh
cd telegram-bot
gcloud run deploy quran-telegram-bot \
  --source . \
  --region=us-central1 \
  --project=quran-df0a2 \
  --allow-unauthenticated
```

`--allow-unauthenticated` is required — without it, Cloud Run resets the IAM policy and the `/revise` endpoint returns 403.

### Never use `--set-env-vars`

`--set-env-vars` **replaces the entire environment**: every variable missing
from that one flag is deleted. A real incident — the deploy command documented
here used it with a partial list sourced from `.env`, which only holds
`BOT_TOKEN`, `ALLOWED_ACCOUNTS` and `TELEGRAM_CHANNEL`. Everything else
resolved to empty and was silently wiped:

- `WEBHOOK_URL` empty → the bot fell back to **polling**, which needs
  `--min-instances=1` and CPU-always-on to stay alive. That is roughly
  **$45/month** of Cloud Run billing, and it also caused hundreds of
  `409 Conflict: terminated by other getUpdates request` errors as several
  instances polled at once.
- `CRON_SECRET` empty → `/cron/daily-plans` returned 401 before it logged
  anything, so the nightly plan died silently and Cloud Scheduler just showed
  `code: 2`.
- `GITHUB_TOKEN` empty → `/code` stopped working.

To change ONE variable, use `--update-env-vars`, which leaves the rest alone:

```sh
gcloud run services update quran-telegram-bot \
  --region=us-central1 --project=quran-df0a2 \
  --update-env-vars KEY=value
```

### Webhook vs polling (this is the cost lever)

The bot picks its mode from `WEBHOOK_URL` alone (`bot.js`): set → webhook,
unset → polling. Webhook mode is what allows `--min-instances=0`, so the
service scales to zero and bills only while handling a request. Keep it set.

`bot.js` registers the webhook itself on startup (`setWebHook` to
`<WEBHOOK_URL>/bot<BOT_TOKEN>`) — there is no separate curl step. Verify with:

```sh
curl -s "https://api.telegram.org/bot<BOT_TOKEN>/getWebhookInfo"
```

There is no longer a cron endpoint: auto-generate and its `quran-daily-plan`
Cloud Scheduler job were removed in v5.82.0. `CRON_SECRET` is therefore unused
and can be dropped from the service's env vars whenever convenient.

---

## Setup (env vars)

| Variable | Required | Description |
|---|---|---|
| `BOT_TOKEN` | ✅ | From @BotFather |
| `ALLOWED_ACCOUNTS` | Recommended | Comma-separated account names allowed (e.g. `jnaja92`) |
| `ALLOWED_USER_IDS` | Optional | Comma-separated Telegram user IDs; if unset any user can try |
| `TELEGRAM_CHANNEL` | For `/import` | Channel username without @ (e.g. `tasmee315`) |
| `WEBHOOK_URL` | Cloud Run only | Set after first deploy |

---

## Full cost summary

| Command | Per call | Per 1,000 | Per 10,000 |
|---|---|---|---|
| /revise | $0.000060 | $0.06 | $0.60 |
| /today | $0.000011 | $0.011 | $0.11 |
| /import (100) | $0.000080 | $0.08 | $0.80 |
| /import (500) | $0.000400 | $0.40 | $4.00 |
| /agent (Flash) | $0.000200 | $0.20 | $2.00 |
| /agent (Pro) | $0.001000 | $1.00 | $10.00 |
| /status | $0.000011 | $0.011 | $0.11 |

At 50 commands/day (heavy personal use): ~$0.01–$0.10/month.  
The $300 Google Cloud credit covers roughly 5–15 years at this rate (Cloud Run costs only — Gemini billed separately via your API key).

Note: Gemini API costs are billed to your own API key, not to the Google Cloud project.
