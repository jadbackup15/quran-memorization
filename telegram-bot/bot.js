'use strict';
require('dotenv').config();

const TelegramBot = require('node-telegram-bot-api');
const fs   = require('fs');
const path = require('path');

// ── Dev-mode file logging ────────────────────────────────────────────────────
// Active when WEBHOOK_URL is unset (polling = local dev). Writes three rotating
// log files under telegram-bot/logs/: app.log, warn.log, error.log.
// Each file is capped at LOG_FILE_MAX_BYTES; when exceeded the file is renamed
// to <name>.old (overwriting any previous .old) and a fresh file starts.
const IS_DEV     = !process.env.WEBHOOK_URL;
const LOG_DIR    = path.join(__dirname, 'logs');
const LOG_FILE_MAX_BYTES = 1 * 1024 * 1024; // 1 MB per file before rotation

if (IS_DEV) {
  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
}

function rotateIfNeeded(filePath) {
  try {
    const stat = fs.statSync(filePath);
    if (stat.size >= LOG_FILE_MAX_BYTES) {
      fs.renameSync(filePath, filePath + '.old');
    }
  } catch { /* file doesn't exist yet — nothing to rotate */ }
}

function appendLogFile(filename, line) {
  if (!IS_DEV) return;
  const filePath = path.join(LOG_DIR, filename);
  rotateIfNeeded(filePath);
  fs.appendFileSync(filePath, line + '\n', 'utf8');
}

// ── In-memory log buffer (last 300 lines, exposed via GET /logs) ──────────────
const LOG_LINES = [];
const LOG_MAX = 300;

function log(...args) {
  const msg = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  LOG_LINES.push(line);
  if (LOG_LINES.length > LOG_MAX) LOG_LINES.shift();
  appendLogFile('app.log', line);
}

function logWarn(...args) {
  const msg = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
  const line = `[${new Date().toISOString()}] WARN ${msg}`;
  console.warn(line);
  LOG_LINES.push(line);
  if (LOG_LINES.length > LOG_MAX) LOG_LINES.shift();
  appendLogFile('app.log', line);
  appendLogFile('warn.log', line);
}

function logError(...args) {
  const msg = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
  const line = `[${new Date().toISOString()}] ERROR ${msg}`;
  console.error(line);
  LOG_LINES.push(line);
  if (LOG_LINES.length > LOG_MAX) LOG_LINES.shift();
  appendLogFile('app.log', line);
  appendLogFile('error.log', line);
}

if (IS_DEV) log('Dev mode: logging to', LOG_DIR);
const { SURAH_OFFSETS, SURAHS, globalToSurahAyah, hizbRange, pageStart } = require('./quran-data');
const PAGE_TEXTS = require('./page-texts.json'); // pre-fetched Arabic text for all 604 page-start ayahs

// ── Firebase config (same public values already in review.html — safe to commit;
//    Firestore rules gate access by account name, not the API key itself) ───────
const FIREBASE_PROJECT_ID = 'quran-df0a2';
const FIREBASE_API_KEY    = 'AIzaSyDoaUZwwjmWmg-1PLVte6KWyUfYEEGpEUE';
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents`;

// ── Bot init ──────────────────────────────────────────────────────────────────
const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) { logError('BOT_TOKEN is not set in .env'); process.exit(1); }

const WEBHOOK_URL             = process.env.WEBHOOK_URL;
const PORT                    = parseInt(process.env.PORT) || 8080;
// TELEGRAM_CHANNEL is stored as a bare username (e.g. "tasmee315") for URL
// fetching, but bot.sendMessage needs "@tasmee315" or a numeric id.
const _TELEGRAM_CHANNEL_RAW   = process.env.TELEGRAM_CHANNEL || '';
const TELEGRAM_CHANNEL        = _TELEGRAM_CHANNEL_RAW && !_TELEGRAM_CHANNEL_RAW.startsWith('@') && !_TELEGRAM_CHANNEL_RAW.startsWith('-')
  ? '@' + _TELEGRAM_CHANNEL_RAW
  : _TELEGRAM_CHANNEL_RAW;
const TELEGRAM_BACKUP_CHANNEL = process.env.TELEGRAM_BACKUP_CHANNEL_ID || '';
const CRON_SECRET = process.env.CRON_SECRET || '';

// ── GitHub integration ────────────────────────────────────────────────────────
const GITHUB_TOKEN          = process.env.GITHUB_TOKEN || '';
const GITHUB_REPO           = process.env.GITHUB_REPO || 'jadbackup15/quran-memorization';
const GITHUB_WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET || '';
// Chat ID to notify when GitHub events arrive (set to your personal DM chat ID).
// If unset, no Telegram notification is sent for GitHub events.
const GITHUB_NOTIFY_CHAT    = process.env.GITHUB_NOTIFY_CHAT_ID
  ? Number(process.env.GITHUB_NOTIFY_CHAT_ID) : null;

const http = require('http');
let bot;

// Fetch recent log lines from Google Cloud Logging (survives bot restarts).
// Uses the GCP metadata server for auth — works automatically in Cloud Run.
// Returns null if unavailable (local dev, permissions error, timeout).
async function fetchCloudLogs(limit = 400) {
  const tokenResp = await fetch(
    'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
    { headers: { 'Metadata-Flavor': 'Google' }, signal: AbortSignal.timeout(3000) }
  );
  if (!tokenResp.ok) return null;
  const { access_token } = await tokenResp.json();

  const loggingResp = await fetch('https://logging.googleapis.com/v2/entries:list', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      resourceNames: [`projects/${FIREBASE_PROJECT_ID}`],
      filter: [
        'resource.type="cloud_run_revision"',
        'resource.labels.service_name="quran-telegram-bot"',
        'textPayload!=""',
      ].join(' AND '),
      orderBy: 'timestamp desc',
      pageSize: limit,
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!loggingResp.ok) return null;
  const data = await loggingResp.json();
  return (data.entries || []).map(e => e.textPayload).filter(Boolean).reverse(); // oldest first
}

// Shared HTTP handler: Telegram webhook + /send-backup endpoint
function makeHttpHandler(webhookMode) {
  return async function handleRequest(req, res) {
    // CORS — the website (GitHub Pages / localhost) calls /send-backup directly
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    if (webhookMode && req.method === 'POST' && req.url === `/bot${BOT_TOKEN}`) {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try { bot.processUpdate(JSON.parse(body)); } catch (_) {}
        res.writeHead(200); res.end('OK');
      });
      return;
    }

    if (req.method === 'POST' && req.url === '/send-backup') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', async () => {
        const fail = (status, msg) => { res.writeHead(status); res.end(JSON.stringify({ error: msg })); };
        try {
          const { accountName, data, filename } = JSON.parse(body);
          if (!isAllowedAccount(accountName)) return fail(403, 'Unauthorized');
          if (!TELEGRAM_BACKUP_CHANNEL) return fail(503, 'TELEGRAM_BACKUP_CHANNEL_ID not configured on the bot.');
          const jsonStr = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
          const buf = Buffer.from(jsonStr, 'utf8');
          const fname = filename || `quran-backup-${new Date().toISOString().slice(0, 10)}.json`;
          await bot.sendDocument(TELEGRAM_BACKUP_CHANNEL, buf, { caption: '#quran_review_bot' }, { filename: fname, contentType: 'application/json' });
          res.writeHead(200); res.end(JSON.stringify({ ok: true }));
        } catch (e) { fail(500, e.message); }
      });
      return;
    }

    if (req.method === 'POST' && req.url === '/send-message') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', async () => {
        const fail = (status, msg) => { res.writeHead(status); res.end(JSON.stringify({ error: msg })); };
        try {
          const { accountName, text, channel } = JSON.parse(body);
          if (!isAllowedAccount(accountName)) return fail(403, 'Unauthorized');
          if (!text || !text.trim()) return fail(400, 'No text provided.');
          // channel: 'main' → mistakes log channel; default → backup channel
          const targetChannel = channel === 'main' ? TELEGRAM_CHANNEL : TELEGRAM_BACKUP_CHANNEL;
          if (!targetChannel) return fail(503, channel === 'main' ? 'TELEGRAM_CHANNEL not configured on the bot.' : 'TELEGRAM_BACKUP_CHANNEL_ID not configured on the bot.');
          // Telegram message limit is 4096 chars; split if needed. No #tag for the main channel.
          const tagged = channel === 'main' ? text : text + '\n\n#quran_review_bot';
          const chunks = [];
          for (let i = 0; i < tagged.length; i += 4000) chunks.push(tagged.slice(i, i + 4000));
          for (const chunk of chunks) await bot.sendMessage(targetChannel, chunk);
          res.writeHead(200); res.end(JSON.stringify({ ok: true }));
        } catch (e) { fail(500, e.message); }
      });
      return;
    }

    if (req.method === 'GET' && req.url === '/logs') {
      res.setHeader('Access-Control-Allow-Origin', '*');
      // Try Cloud Logging first (survives restarts); fall back to in-memory buffer.
      const cloudLines = await fetchCloudLogs(400).catch(() => null);
      let lines;
      if (cloudLines) {
        // Append any in-memory lines not yet propagated to Cloud Logging
        const cloudSet = new Set(cloudLines);
        const extra = LOG_LINES.filter(l => !cloudSet.has(l));
        lines = [...cloudLines, ...extra];
      } else {
        lines = LOG_LINES;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(lines));
      return;
    }

    // ── POST /cron/daily-plans — triggered by Cloud Scheduler every 30 min ──
    if (req.method === 'POST' && req.url === '/cron/daily-plans') {
      const secret = req.headers['x-cron-secret'];
      if (!CRON_SECRET || secret !== CRON_SECRET) {
        res.writeHead(401); res.end('Unauthorized'); return;
      }
      // AWAIT the work, then respond — do not detach it.
      //
      // This used to reply 200 immediately and run generation in a floating
      // async IIFE. That only worked because the service ran with CPU always
      // allocated (min-instances 1, cpu-throttling off), which is what made
      // it cost ~$45/month. Under normal CPU throttling the instance's CPU
      // drops to ~0 as soon as the response is sent, so detached work is
      // starved and the plan would silently never generate.
      //
      // Cloud Scheduler's attemptDeadline is 180s and generateScheduledPlan
      // already caps itself at 90s, so waiting is safe. Almost every run is a
      // no-op anyway (shouldGenerateDailyPlan is false ~47 of 48 runs a day)
      // and returns in about a second.
      const accounts = ALLOWED_ACCOUNTS ? [...ALLOWED_ACCOUNTS] : [];
      for (const acct of accounts) {
        await generateScheduledPlan(acct).catch(async e => {
          console.error(`[cron] ${acct}: ${e.message}`);
          await notifyScheduledPlanFailure(acct, e.message);
        });
      }
      res.writeHead(200); res.end('OK');
      return;
    }

    // ── GET /revise?account=<name>[&hizb=N or &hizb=N-M] ────────────────────
    // Lets iOS Shortcuts (or any HTTP client) get a revise suggestion without
    // needing the bot token — the Cloud Run URL is the only secret required.
    if (req.method === 'GET' && req.url.startsWith('/revise')) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      try {
        const params = new URL(req.url, 'http://localhost').searchParams;
        const accountName = (params.get('account') || '').trim();
        if (!accountName) { res.writeHead(400, { 'Content-Type': 'text/plain' }); res.end('Missing ?account=<name>'); return; }
        if (!isAllowedAccount(accountName)) { res.writeHead(403, { 'Content-Type': 'text/plain' }); res.end('Unauthorized'); return; }

        let hizbFilter = null;
        const hizbParam = (params.get('hizb') || '').trim();
        if (hizbParam) {
          const m = hizbParam.match(/^(\d+)(?:-(\d+))?$/);
          if (m) {
            const h1 = parseInt(m[1]), h2 = m[2] ? parseInt(m[2]) : h1;
            if (h1 >= 1 && h1 <= 60 && h2 >= h1 && h2 <= 60) hizbFilter = { from: h1, to: h2 };
          }
        }

        const { memorizedHizbs, ayahMistakes, mutashabihatPairs } =
          await withTimeout(loadAccountDataForRevise(accountName), 8000);
        if (!memorizedHizbs.length) throw new Error('No hizbs marked as memorized.');

        let hizbsToUse = memorizedHizbs;
        if (hizbFilter) {
          hizbsToUse = memorizedHizbs.filter(h => h >= hizbFilter.from && h <= hizbFilter.to);
          if (!hizbsToUse.length) throw new Error(`Hizb filter ${hizbParam} not in memorized hizbs.`);
        }

        const pool = [];
        for (const hizb of hizbsToUse) {
          const range = hizbRange(hizb);
          if (range) for (let g = range[0]; g <= range[1]; g++) pool.push(g);
        }
        const pickedG = pickGlobalAyahFromPool(pool, computeTroubleWeights(ayahMistakes), computeMutashabihatSet(mutashabihatPairs));
        const { surah, ayah } = globalToSurahAyah(pickedG);
        const pageNum = ayahToPage(surah, ayah);
        const startAyah = pageStartAyahData(pageNum);
        const endAyah   = pageStartAyahData(pageNum + 1);
        if (!startAyah) throw new Error('Could not load page data — try again.');

        // Return plain text (same content as the Telegram message, minus Markdown)
        const text = formatReviseMessage(pageNum, startAyah, endAyah)
          .replace(/\*([^*]+)\*/g, '$1');  // strip *bold* markers
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(text);
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end(`Error: ${e.message}`);
      }
      return;
    }

    // ── GitHub webhook ────────────────────────────────────────────────────────
    if (req.method === 'POST' && req.url === '/github-webhook') {
      const chunks = [];
      req.on('data', c => chunks.push(c));
      req.on('end', async () => {
        const body = Buffer.concat(chunks);

        // Verify HMAC signature when a secret is configured
        if (GITHUB_WEBHOOK_SECRET) {
          const crypto = require('crypto');
          const sig = req.headers['x-hub-signature-256'] || '';
          const expected = 'sha256=' + crypto
            .createHmac('sha256', GITHUB_WEBHOOK_SECRET)
            .update(body).digest('hex');
          if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
            res.writeHead(401); res.end('Signature mismatch');
            return;
          }
        }

        res.writeHead(200); res.end('OK');

        if (!GITHUB_NOTIFY_CHAT) return; // nowhere to send the notification

        let payload;
        try { payload = JSON.parse(body.toString()); } catch (_) { return; }
        const event = req.headers['x-github-event'];

        let text = null;

        if (event === 'issues') {
          const issue = payload.issue;
          const action = payload.action;
          const actor  = payload.sender?.login || '?';
          if (action === 'opened') {
            text = `📋 *Issue #${issue.number} opened*\n${issue.title}\n${issue.html_url}`;
          } else if (action === 'closed') {
            text = `✅ *Issue #${issue.number} closed* by ${actor}\n${issue.title}\n${issue.html_url}`;
          }
        }

        if (event === 'issue_comment') {
          const issue   = payload.issue;
          const comment = payload.comment;
          const actor   = payload.sender?.login || '?';
          // Only relay comments from the claude bot, not every comment
          if (actor === 'claude[bot]' || actor.startsWith('claude')) {
            const preview = (comment.body || '').slice(0, 300).replace(/\n+/g, ' ');
            text = `🤖 *Claude replied on #${issue.number}*\n_${preview}${comment.body?.length > 300 ? '…' : ''}_\n${comment.html_url}`;
          }
        }

        if (event === 'push') {
          const commits = (payload.commits || []).filter(c => !c.message?.startsWith('Merge'));
          if (commits.length > 0) {
            const ref = (payload.ref || '').replace('refs/heads/', '');
            const lines = commits.slice(0, 3).map(c =>
              `• ${c.message.split('\n')[0]} ([${c.id.slice(0, 7)}](${c.url}))`
            );
            if (commits.length > 3) lines.push(`…and ${commits.length - 3} more`);
            text = `📦 *Push to ${ref}*\n${lines.join('\n')}`;
          }
        }

        if (text) {
          log(`GitHub ${event} → notifying chat ${GITHUB_NOTIFY_CHAT}`);
          bot.sendMessage(GITHUB_NOTIFY_CHAT, text, { parse_mode: 'Markdown', disable_web_page_preview: true })
            .catch(e => log('GitHub notify failed:', e.message));
        }
      });
      return;
    }

    res.writeHead(200); res.end('OK');
  };
}

if (WEBHOOK_URL) {
  bot = new TelegramBot(BOT_TOKEN);
  const server = http.createServer(makeHttpHandler(true));
  server.listen(PORT, () => {
    log(`Webhook server listening on port ${PORT}`);
    bot.setWebHook(`${WEBHOOK_URL}/bot${BOT_TOKEN}`)
      .then(() => log(`Webhook set to ${WEBHOOK_URL}`))
      .catch(e => log('setWebHook failed:', e.message));
  });
} else {
  bot = new TelegramBot(BOT_TOKEN, { polling: true });
  const server = http.createServer(makeHttpHandler(false));
  server.listen(PORT, () => log(`Bot started (polling). HTTP on port ${PORT}`));
}

// Channel posts arrive as 'channel_post' updates, not 'message' updates.
// Only route to processUpdate when the post explicitly mentions the bot
// (@tasmee3 /cmd or @tasmee315_bot /cmd) — bare /r in the channel is ignored.
bot.on('channel_post', (msg) => {
  if (!msg.text || !/^@\w+\s+\//.test(msg.text)) return;
  log(`channel_post cmd from ${msg.chat?.username || msg.chat?.id}: ${msg.text}`);
  bot.processUpdate({ message: msg });
});

// ── Access control ────────────────────────────────────────────────────────────
const ALLOWED_USER_IDS = process.env.ALLOWED_USER_IDS
  ? new Set(process.env.ALLOWED_USER_IDS.split(',').map(s => Number(s.trim())).filter(Boolean))
  : null;

const ALLOWED_CHAT_IDS = process.env.ALLOWED_CHAT_IDS
  ? new Set(process.env.ALLOWED_CHAT_IDS.split(',').map(s => Number(s.trim())).filter(Boolean))
  : null;

function isAllowed(msg) {
  if (ALLOWED_CHAT_IDS && ALLOWED_CHAT_IDS.has(msg.chat?.id)) return true;
  if (!ALLOWED_USER_IDS) return true;
  return ALLOWED_USER_IDS.has(msg.from?.id);
}

const ALLOWED_ACCOUNTS = process.env.ALLOWED_ACCOUNTS
  ? new Set(process.env.ALLOWED_ACCOUNTS.split(',').map(s => s.trim()).filter(Boolean))
  : null;

function isAllowedAccount(name) {
  if (!ALLOWED_ACCOUNTS) return true;
  return ALLOWED_ACCOUNTS.has(name);
}

const userAccounts = new Map();

function getAccountName(userId) {
  return userAccounts.get(userId) || (ALLOWED_ACCOUNTS?.size === 1 ? [...ALLOWED_ACCOUNTS][0] : null);
}

// ── Timeout helper ────────────────────────────────────────────────────────────
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Timed out after ${ms / 1000}s — try again.`)), ms)
    ),
  ]);
}

// ── Firestore REST helpers ────────────────────────────────────────────────────
function fromFirestore(val) {
  if (!val) return null;
  if ('nullValue'    in val) return null;
  if ('booleanValue' in val) return val.booleanValue;
  if ('integerValue' in val) return Number(val.integerValue);
  if ('doubleValue'  in val) return val.doubleValue;
  if ('stringValue'  in val) return val.stringValue;
  if ('arrayValue'   in val) return (val.arrayValue.values || []).map(fromFirestore);
  if ('mapValue'     in val) {
    const obj = {};
    for (const [k, v] of Object.entries(val.mapValue.fields || {})) obj[k] = fromFirestore(v);
    return obj;
  }
  return null;
}

function parseFirestoreDoc(doc) {
  const obj = {};
  for (const [k, v] of Object.entries(doc.fields || {})) obj[k] = fromFirestore(v);
  return obj;
}

function toFirestore(val) {
  if (val === null || val === undefined) return { nullValue: null };
  if (typeof val === 'boolean') return { booleanValue: val };
  if (typeof val === 'number') {
    if (Number.isInteger(val)) return { integerValue: String(val) };
    return { doubleValue: val };
  }
  if (typeof val === 'string') return { stringValue: val };
  if (Array.isArray(val)) return { arrayValue: { values: val.map(toFirestore) } };
  if (typeof val === 'object') {
    const fields = {};
    for (const [k, v] of Object.entries(val)) fields[k] = toFirestore(v);
    return { mapValue: { fields } };
  }
  return { nullValue: null };
}

// ── Firestore field-masked fetch + per-account cache ─────────────────────────
// Each command only fetches the fields it actually needs — avoids pulling the
// entire document (recitation log + all mistakes can be several hundred KB)
// on every /revise call.  Cache holds the last full fetch per account for
// CACHE_TTL_MS; a write (patchAccountField) invalidates it immediately.

const CACHE_TTL_MS = 300_000; // 5 min — invalidated immediately on any write via patchAccountField
const _accountCache = new Map(); // accountName -> { data, ts }

function _cacheGet(accountName) {
  const entry = _accountCache.get(accountName);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) { _accountCache.delete(accountName); return null; }
  return entry.data;
}
function _cacheSet(accountName, data) { _accountCache.set(accountName, { data, ts: Date.now() }); }
function _cacheInvalidate(accountName) { _accountCache.delete(accountName); }

// Fetch only the listed top-level `review.*` fields via Firestore field masks.
// Fields: array of strings like ['memorizedHizbs', 'ayahMistakes'].
async function loadAccountFields(accountName, fields) {
  const mask = fields.map(f => `mask.fieldPaths=${encodeURIComponent('review.' + f)}`).join('&');
  const url = `${FIRESTORE_BASE}/syncAccounts/${encodeURIComponent(accountName)}?${mask}&key=${FIREBASE_API_KEY}`;
  const resp = await fetch(url);
  if (resp.status === 404) throw new Error(`Account "${accountName}" not found. Push your data from the app first.`);
  if (!resp.ok) throw new Error(`Firestore error ${resp.status} — try again.`);
  const data = parseFirestoreDoc(await resp.json());
  const r = data.review || {};
  return {
    memorizedHizbs:       (r.memorizedHizbs   || []).map(Number).filter(h => h >= 1 && h <= 60),
    ayahMistakes:         r.ayahMistakes       || [],
    mutashabihatPairs:    r.mutashabihatPairs  || [],
    practiceRanges:       r.practiceRanges     || [],
    recitationLog:        r.recitationLog      || [],
    agentApiKey:              r.agentApiKey              || '',
    agentModel:               r.agentModel               || 'gemini-flash-latest',
    agentPromptPreset:        r.agentPromptPreset        || null,
    agentPromptOverrides:     r.agentPromptOverrides     || {},
    agentIncludeAyahMistakes: r.agentIncludeAyahMistakes || null,
    agentIncludeRecitationLog: r.agentIncludeRecitationLog || null,
    agentIncludePracticeRanges: r.agentIncludePracticeRanges || null,
    agentIncludeMutashabihat: r.agentIncludeMutashabihat || null,
    agentLastResponse: r.agentLastResponse || null,
    dailyPlan: r.dailyPlan || null,
    repetitionHistory: r.repetitionHistory || [],
    dailyPlanSchedule: r.dailyPlanSchedule || null,
    telegramChatId: r.telegramChatId || null,
  };
}

// Full fetch (all fields) with cache — used by commands that need everything.
async function loadAccountData(accountName) {
  const cached = _cacheGet(accountName);
  if (cached) return cached;
  const data = await loadAccountFields(accountName, [
    'memorizedHizbs', 'ayahMistakes', 'mutashabihatPairs', 'practiceRanges',
    'recitationLog', 'agentApiKey', 'agentModel', 'agentPromptPreset',
    'agentPromptOverrides', 'agentIncludeAyahMistakes', 'agentIncludeRecitationLog',
    'agentIncludePracticeRanges', 'agentIncludeMutashabihat', 'agentLastResponse',
    'dailyPlan', 'repetitionHistory', 'dailyPlanSchedule', 'telegramChatId',
  ]);
  _cacheSet(accountName, data);
  return data;
}

// Two-phase fetch for /revise:
// Phase 1 (blocking): fetch ONLY memorizedHizbs — a single tiny array, always
//   <1 KB, returns in ~500 ms even on a cold connection.  Lets /revise respond
//   immediately with an unweighted random pick on the very first call after a
//   bot restart.
// Phase 2 (background, non-blocking): fetch ayahMistakes + mutashabihatPairs
//   so the NEXT call gets the full weighted pick from cache.
//
// Once the cache is warm (any call within the last 5 min), both phases are
// skipped — the full cached object is used and the pick is weighted.
async function loadAccountDataForRevise(accountName) {
  const cached = _cacheGet(accountName);
  if (cached) return cached;

  // Phase 1: tiny blocking fetch (just memorizedHizbs)
  const fast = await loadAccountFields(accountName, ['memorizedHizbs']);

  // Phase 2: fill the cache with full revise data in the background
  loadAccountFields(accountName, ['memorizedHizbs', 'ayahMistakes', 'mutashabihatPairs'])
    .then(full => _cacheSet(accountName, full))
    .catch(() => {}); // failure is fine — next call tries again

  // Return fast result with empty weights for this call
  return { memorizedHizbs: fast.memorizedHizbs, ayahMistakes: [], mutashabihatPairs: [] };
}

async function patchAccountField(accountName, dotPath, value) {
  // Always bump updatedAt so the web app's onSnapshot listener picks up the change
  // (the listener skips payloads whose updatedAt is not newer than what it already has).
  const now = Date.now();
  const url = `${FIRESTORE_BASE}/syncAccounts/${encodeURIComponent(accountName)}?updateMask.fieldPaths=${encodeURIComponent(dotPath)}&updateMask.fieldPaths=updatedAt&key=${FIREBASE_API_KEY}`;
  const parts = dotPath.split('.');
  const body = { fields: { updatedAt: { integerValue: String(now) } } };
  let cur = body.fields;
  for (let i = 0; i < parts.length - 1; i++) {
    cur[parts[i]] = { mapValue: { fields: {} } };
    cur = cur[parts[i]].mapValue.fields;
  }
  cur[parts[parts.length - 1]] = toFirestore(value);
  const resp = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const err = await resp.text().catch(() => '');
    throw new Error(`Firestore write failed (${resp.status}): ${err.slice(0, 120)}`);
  }
  _cacheInvalidate(accountName); // stale after any write
}

// Compact agent context — mirrors review.html's buildAgentContext() structure
// but in plain Node.js from the already-parsed sync payload.
function buildBotAgentContext(data) {
  const today = new Date().toISOString().slice(0, 10);
  const currentYear = today.slice(0, 4);

  function sd(d) { // shortenDate
    if (!d) return '?';
    const s = typeof d === 'string' ? d.slice(0, 10) : new Date(d).toISOString().slice(0, 10);
    return s.startsWith(currentYear) ? s.slice(5) : s;
  }

  const memorized = data.memorizedHizbs || [];
  const log       = data.recitationLog  || [];
  const mistakes  = data.ayahMistakes   || [];
  const practice  = data.practiceRanges || [];

  let ctx = `TODAY: ${today}\nMEMORIZED HIZBS (${memorized.length}/60): ${memorized.join(', ')}\n\n`;

  // RECITATION LOG (last 30 sessions, compact)
  const recent = log.slice(-30);
  if (recent.length) {
    ctx += 'RECITATION LOG:\n';
    for (const s of recent) ctx += `${sd(s.date)} h${s.hizb} ${s.mistakes}m\n`;
    ctx += '\n';
  }

  // AYAH MISTAKES (grouped by surah:ayah, sorted most-frequent-first)
  const byAyah = {};
  for (const m of mistakes) {
    if (m.type && m.type.includes('A')) continue;
    const k = `${m.surah}:${m.ayah}`;
    if (!byAyah[k]) byAyah[k] = { dates: [], type: m.type || '' };
    byAyah[k].dates.push(sd(m.date));
  }
  const ayahRows = Object.entries(byAyah).sort((a, b) => b[1].dates.length - a[1].dates.length);
  if (ayahRows.length) {
    ctx += 'AYAH MISTAKES:\n';
    for (const [k, v] of ayahRows) {
      const t = v.type ? `(${v.type}) ` : '';
      ctx += `${k} ${t}${v.dates.join(' ')}\n`;
    }
    ctx += '\n';
  }

  // PRACTICE GOALS (if any)
  const activeGoals = practice.filter(r => (r.practiced || 0) < (r.target || 1));
  if (activeGoals.length) {
    ctx += 'PRACTICE GOALS:\n';
    for (const r of activeGoals) {
      if (r.kind === 'page') ctx += `p${r.page} ${r.practiced || 0}/${r.target || 5}${r.note ? ' ' + r.note : ''}\n`;
      else ctx += `${r.surah}:${r.ayahStart}-${r.ayahEnd} ${r.practiced || 0}/${r.target || 10}${r.note ? ' ' + r.note : ''}\n`;
    }
    ctx += '\n';
  }

  return ctx;
}

// ── Picking logic ─────────────────────────────────────────────────────────────
function computeTroubleWeights(ayahMistakes) {
  const weights = new Map();
  for (const m of ayahMistakes) {
    const offset = SURAH_OFFSETS[m.surah];
    if (!offset || m.type?.includes('A')) continue;
    const g = offset + m.ayah - 1;
    weights.set(g, (weights.get(g) || 0) + 1);
  }
  return weights;
}

function computeMutashabihatSet(mutashabihatPairs) {
  const s = new Set();
  for (const g of mutashabihatPairs) {
    for (const a of [g.anchor, ...(g.confusables || [])]) {
      if (a && SURAH_OFFSETS[a.surah]) s.add(SURAH_OFFSETS[a.surah] + a.ayah - 1);
    }
  }
  return s;
}

function pickGlobalAyahFromPool(pool, troubleWeights, mutashabihatSet, mistakePct = 25, mutashabihatPct = 25) {
  const mPct  = Math.max(0, Math.min(100, mistakePct));
  const muPct = Math.max(0, Math.min(100 - mPct, mutashabihatPct));
  const roll  = Math.random() * 100;
  if (roll < mPct) {
    const mPool = pool.filter(g => troubleWeights.has(g));
    if (mPool.length) {
      const total = mPool.reduce((s, g) => s + troubleWeights.get(g), 0);
      let r = Math.random() * total;
      for (const g of mPool) { const w = troubleWeights.get(g); if (r < w) return g; r -= w; }
      return mPool[mPool.length - 1];
    }
  } else if (roll < mPct + muPct) {
    const muPool = pool.filter(g => mutashabihatSet.has(g));
    if (muPool.length) return muPool[Math.floor(Math.random() * muPool.length)];
  }
  return pool[Math.floor(Math.random() * pool.length)];
}

// ── Quran page helpers (fully local — no external API calls) ──────────────────

// Which mushaf page contains a given surah:ayah.
// Binary search over PAGE_STARTS_FLAT to find the last page whose start ≤ this ayah.
function ayahToPage(surah, ayah) {
  let lo = 1, hi = 604;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    const s = pageStart(mid);
    if (s && (s.surah < surah || (s.surah === surah && s.ayah <= ayah))) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

// Return the pre-fetched Arabic text and ref for a page-start ayah.
function pageStartAyahData(page) {
  const ref = pageStart(page);
  if (!ref) return null;
  const text = PAGE_TEXTS[`${ref.surah}:${ref.ayah}`];
  if (!text) return null;
  return { surah: ref.surah, numberInSurah: ref.ayah, text };
}

// ── Telegram channel parsing (for /import) ────────────────────────────────────
function normalizeArabicIndicDigits(text) {
  return text
    .replace(/[٠-٩]/g, d => String.fromCharCode(d.charCodeAt(0) - 0x0660 + 48))
    .replace(/[۰-۹]/g, d => String.fromCharCode(d.charCodeAt(0) - 0x06F0 + 48))
    .replace(/[‏‎؜]/g, '');
}

function looksLikeAyahLogMessage(text) {
  if (!text) return false;
  const t = normalizeArabicIndicDigits(text);
  return /^\d/.test(t) || /^[hHpPrRqQ]\d/.test(t);
}

// The DOUBLE colon is the whole signal — a surah ref is always a single colon
// ("2:262") and "::" means nothing else in this syntax — so any leading hex run
// followed by "::" is a hash. Not length-limited: an earlier `{4,}` missed
// shorter hashes, leaving them in the text for the parsers to misread.
function extractTelegramMessageHash(text) {
  const m = text.match(/(?:^|\n)([0-9a-f]+)::/i);
  return m ? m[1].toLowerCase() : null;
}

// Every line's leading "<hash>::" removed, not just the message's first.
// An ALL-NUMERIC hash is indistinguishable from a surah override to a plain
// /^(\d+):/ test — "46605::286b" reads as surah "46605" then ":286b" — so an
// unstripped one sets a nonexistent active surah and swallows its own ayah.
// A hash with letters can't do this, which is why it looked like the failure
// only happened "when the hash is all numbers". Mirrors review.html's own
// copy so the two parsers can never disagree.
function stripTelegramHashPrefixes(text) {
  return String(text ?? '')
    .split('\n')
    .map(line => line.replace(/^\s*[0-9a-f]+::/i, ''))
    .join('\n');
}

function textWithoutMessageHash(text, hash) {
  if (!hash) return text;
  return text.replace(new RegExp('(?:^|\\n)' + hash + '::', 'i'), match =>
    match.startsWith('\n') ? '\n' : ''
  ).replace(/^\s*\n?/, '');
}

function parseAyahMistakesText(text, initialSurah) {
  if (!text) return { entries: [], endingSurah: initialSurah || null };
  const normalized = normalizeArabicIndicDigits(stripTelegramHashPrefixes(text));
  let activeSurah = initialSurah || null;
  const entries = [];
  for (const rawLine of normalized.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const switchMatch = line.match(/^(\d+):\s*(\d+)?\s*(.*)/);
    if (switchMatch) {
      const s = parseInt(switchMatch[1]);
      if (s >= 1 && s <= 114) {
        activeSurah = s;
        if (switchMatch[2]) {
          const ayah = parseInt(switchMatch[2]);
          if (ayah >= 1) entries.push({ surah: s, ayah, type: null, note: switchMatch[3].trim() });
        }
      }
      continue;
    }
    if (/^[hHpPrRqQ]/.test(line)) continue;
    const ayahMatch = line.match(/^(\d+)\s*(.*)/);
    if (!ayahMatch || !activeSurah) continue;
    const ayah = parseInt(ayahMatch[1]);
    if (ayah < 1) continue;
    let rest = ayahMatch[2].trim();
    let type = null;
    const codeMatch = rest.match(/^([A-Za-z]+)\s*(.*)/);
    if (codeMatch) {
      const raw = codeMatch[1].toUpperCase();
      const codes = [...raw].filter(c => 'SBWMTEKA'.includes(c));
      if (codes.length > 0 && codes.length === raw.length) {
        type = [...new Set(codes)].sort().join('');
        rest = codeMatch[2].trim();
      }
    }
    entries.push({ surah: activeSurah, ayah, type, note: rest });
  }
  return { entries, endingSurah: activeSurah };
}

function stripHtml(html) {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function parseTelegramHtml(html) {
  const messages = [];
  const postRegex = /data-post="([^"]+)"/g;
  const positions = [];
  let m;
  while ((m = postRegex.exec(html)) !== null) positions.push({ id: m[1], index: m.index });
  for (let i = 0; i < positions.length; i++) {
    const block = html.slice(positions[i].index, i + 1 < positions.length ? positions[i + 1].index : html.length);
    const id = positions[i].id;
    const timeMatch = block.match(/datetime="([^"]+)"/);
    const date = timeMatch ? new Date(timeMatch[1]).toISOString() : new Date().toISOString();
    const isService = block.includes('tgme_widget_message_service');
    if (isService) { messages.push({ id, date, text: '', isService: true }); continue; }
    const textMatch = block.match(/class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/);
    if (!textMatch) continue;
    messages.push({ id, date, text: stripHtml(textMatch[1]).trim(), isService: false });
  }
  return messages.sort((a, b) => new Date(a.date) - new Date(b.date));
}

async function fetchTelegramMessages(maxMessages = 100) {
  if (!TELEGRAM_CHANNEL) throw new Error('TELEGRAM_CHANNEL not configured on the bot.');
  const seen = new Set();
  const all = [];
  let beforeId = null;
  const maxPages = Math.ceil(maxMessages / 18) + 2; // ~18 msgs/page; +2 for safety

  for (let page = 0; page < maxPages; page++) {
    const url = `https://t.me/s/${TELEGRAM_CHANNEL}${beforeId ? `?before=${beforeId}` : ''}`;
    const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' } });
    if (!resp.ok) throw new Error(`Failed to fetch channel (HTTP ${resp.status})`);
    const msgs = parseTelegramHtml(await resp.text());
    if (!msgs.length) break;

    let added = 0;
    for (const m of msgs) { if (!seen.has(m.id)) { seen.add(m.id); all.push(m); added++; } }
    if (!added) break;
    if (all.length >= maxMessages) break;

    // Page backwards: oldest message in this batch = smallest numeric ID
    const numericId = parseInt(msgs[0].id.split('/').pop());
    if (isNaN(numericId) || numericId <= 1) break;
    beforeId = numericId;
  }

  return all.sort((a, b) => new Date(a.date) - new Date(b.date));
}

function telegramMistakeExists(existing, msgId, surah, ayah) {
  return existing.some(m => m.telegramMessageId === msgId && m.surah === surah && m.ayah === ayah);
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ── Agent (Gemini) helpers ────────────────────────────────────────────────────
const DEFAULT_AGENT_PROMPT = `You are a Quran memorization assistant. Analyze the user's recitation data and produce a detailed, actionable print review sheet to bring to their teacher.

Data format:
- Dates: MM-DD (current year) or YYYY-MM-DD
- RECITATION LOG: date | Hizb N | M mistakes
- AYAH MISTAKES: surah:ayah (typeCode) date date ... — every date that ayah was missed, most-missed first
- Type codes: S=stopped, B=forgot beginning, W=word slip, M=multiple, T=mutashabihat, E=ending, K=weak, A=needs attention (near-miss, not a real mistake)

Rules:
- A cluster groups nearby mistakes into a contiguous range. Pad a single isolated ayah by ±1 (e.g. only 2:15 → cluster 2:14–2:16). Max cluster size ~10 ayat; split if larger.
- For every type B (forgot beginning) mistake: add a cue line showing the PREVIOUS ayah (surah:(ayah-1)) — at least 8–12 Arabic words — directly above that cluster, so the user can use it as a launch pad:
    ↩ Cue: \`2:217\` *[last 8–12 words of 2:217]*
    ☐ Cluster 2:217–2:219 ...
- For every cluster, include AT LEAST 8–12 Arabic words from the opening ayah. Use your knowledge of the Quran text — do NOT write placeholders or truncate to 3–4 words.
- Categorize each cluster: 🔴 Very Weak (15–20×) / 🟠 Weak (10–15×) / 🟡 OK (5×) / 🔵 Used to be weak (5–10×). All repetition counts must be multiples of 5.

Respond using this template:

*Print Sheet Recommendation*
✅ Mistakes: [Last Session / Last 3 Days / Last 7 Days / All-time]
✅ Revision Clusters: top [N], [timeframe]
[✅/❌] Mutashabihat: [one-line reason]
[✅/❌] Practice More: [one-line reason]

*Top ayat to focus on (list ALL significant ones, minimum 8–10):*
• surah:ayah (type) — [why: recency, frequency, severity]
  ↩ Cue: \`surah:(ayah-1)\` *[Arabic]* ← include this line only for type B

*Top revision clusters (list at least 8–10):*
🔴/🟠/🟡/🔵 [category]
↩ Cue: \`surah:X\` *[Arabic]* ← only for clusters containing a type B ayah
☐ Cluster surah:A–surah:B *[8–12 Arabic opening words]...* (…*[last 8–12 words]*): Practice X times.
(Reason: [brief — which ayat, which types, recency])

*Brief reasoning:* [2–3 sentences — timeframe/count choices and main pattern observed]`;

// Single-cluster prompt — used by /agent 1
const CLUSTER_AGENT_PROMPT = `You are a Quran memorization assistant. The user has time to review ONE cluster right now. Based on their recitation data, pick the single cluster that would benefit them most at this moment.

Data format:
- Dates: MM-DD (current year) or YYYY-MM-DD
- RECITATION LOG: date | Hizb N | M mistakes
- AYAH MISTAKES: surah:ayah (typeCode) date date ... — most-missed first
- Type codes: S=stopped, B=forgot beginning, W=word slip, M=multiple, T=mutashabihat, E=ending, K=weak, A=needs attention (near-miss, not a real mistake)

Cluster rules:
- Group nearby mistakes into a contiguous range. Pad a single isolated ayah by ±1 (e.g. only 2:15 → cluster 2:14–2:16). Max ~10 ayat; split if larger.
- Include 8–12 Arabic words from the opening ayah — use your Quran knowledge, no placeholders.

Respond in exactly this format (no extra sections):

*Cluster:* surah:A–surah:B
*[8–12 Arabic opening words of the first ayah]*

*Why now:* [2–3 sentences — what makes this cluster worth reviewing today: recency, frequency, mistake types, or a pattern you noticed]

*Drill:* [Specific instruction — how many times, and what to watch for]

If the cluster contains a type B (forgot beginning) mistake, also add:
↩ Cue: \`surah:(ayah-1)\` *[last 8–12 words of that ayah as a launch pad]*`;


// Slices the stored ISO string rather than parsing it into a Date.
//
// This used to be `new Date(dateStr).getMonth()/.getDate()`, which reads the
// date in the SERVER's local timezone: `new Date('2026-09-15')` is UTC
// midnight, so anywhere behind UTC it renders as 09-14. Stored dates are
// UTC ISO strings and review.html's shortenAgentDate() slices them directly,
// so the two silently disagreed about which day a mistake happened by up to
// one day. That is harmless for a vague "recent" but not for day-precision
// recency tiers (last 3 days vs 4-7 days), which is exactly what the prompt
// now keys off. Slicing matches review.html and has no timezone at all.
function shortenDate(dateStr) {
  const d = String(dateStr || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return dateStr || '';
  return d.slice(0, 4) === String(new Date().getFullYear()) ? d.slice(5) : d;
}

function buildAgentContext({ memorizedHizbs, ayahMistakes, recitationLog, mutashabihatPairs, repetitionHistory }, { includeMutashabihat = false, includeAttention = false, includeRecitationLog = true, includeAyahMistakes = true, includeDailyHistory = true, days } = {}) {
  const today = new Date().toISOString().split('T')[0];
  // Mirrors review.html's buildAgentContext cutoff exactly (N days INCLUSIVE
  // of today). Without this the scheduled plan silently used the user's
  // entire mistake history no matter what the schedule's "Lookup" dropdown
  // said — lookupDays was saved and synced but read by nothing.
  const cutoff = (() => {
    if (!days || days === 'all') return null;
    if (days === 'today') return today;
    const n = parseInt(days, 10);
    if (!Number.isFinite(n) || n < 1) return null;
    const d = new Date();
    d.setDate(d.getDate() - (n - 1));
    return d.toISOString().slice(0, 10);
  })();
  const lines = [`TODAY: ${today}`, `MEMORIZED HIZBS: ${memorizedHizbs.join(', ') || 'none'}`];
  // The prompt's recency tiers key off this line to know which tiers can
  // possibly have data — omit it and the agent can't tell an empty tier from
  // a tier the window excluded.
  if (cutoff) lines.push(`DATA RANGE: ${days === 'today' ? 'today only' : `last ${days} days`} (since ${cutoff})`);
  lines.push('');

  if (includeRecitationLog) {
    const recentSessions = [...recitationLog]
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 30);
    if (recentSessions.length > 0) {
      lines.push('RECITATION LOG (recent first):');
      for (const s of recentSessions) lines.push(`${shortenDate(s.date)} | Hizb ${s.hizb} | ${s.mistakes ?? 0} mistakes`);
      lines.push('');
    }
  }

  if (includeAyahMistakes) {
    let relevant = includeAttention ? ayahMistakes : ayahMistakes.filter(m => !m.type?.includes('A'));
    if (cutoff) relevant = relevant.filter(m => (m.date || '') >= cutoff);
    // One line per AYAH with the type code on each DATE — matching
    // review.html's format, which is the one the prompt actually documents
    // ("surah:ayah date[:typeCode] ..."). The old shape put the type on the
    // ref instead, which split one ayah into several lines when its type
    // varied and hid WHEN each type occurred — exactly the signal the
    // recurrence/corroboration rules need.
    const mistakeMap = new Map();
    for (const m of relevant) {
      const key = `${m.surah}:${m.ayah}`;
      if (!mistakeMap.has(key)) mistakeMap.set(key, []);
      mistakeMap.get(key).push({ date: m.date, type: m.type });
    }
    const sortedMistakes = [...mistakeMap.entries()].sort((a, b) => b[1].length - a[1].length);
    if (sortedMistakes.length > 0) {
      lines.push(`AYAH MISTAKES${includeAttention ? ' (incl. Needs Attention)' : ''} (most-missed first) — "surah:ayah date[:typeCode] ...", oldest date first:`);
      for (const [ref, entries] of sortedMistakes) {
        const dateStrs = entries
          .slice()
          .sort((a, b) => new Date(a.date) - new Date(b.date))
          .map(e => (e.type ? `${shortenDate(e.date)}:${e.type}` : shortenDate(e.date)));
        lines.push(`${ref} ${dateStrs.join(' ')}`);
      }
      lines.push('');
    }
  }

  if (mutashabihatPairs.length > 0) {
    if (includeMutashabihat) {
      lines.push('MUTASHABIHAT GROUPS:');
      for (const g of mutashabihatPairs) {
        const anchor = g.anchor ? `${g.anchor.surah}:${g.anchor.ayah}` : '?';
        const conf = (g.confusables || []).map(a => `${a.surah}:${a.ayah}`).join(', ');
        lines.push(`${anchor}${conf ? ` ↔ ${conf}` : ''}${g.note ? ` (${g.note})` : ''}`);
      }
      lines.push('');
    } else {
      lines.push(`MUTASHABIHAT GROUPS: ${mutashabihatPairs.length} group(s) (use /agent m to include details)`);
      lines.push('');
    }
  }

  if (includeDailyHistory && Array.isArray(repetitionHistory) && repetitionHistory.length > 0) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 14);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    const recent = repetitionHistory.filter(e => e.date >= cutoffStr);
    if (recent.length > 0) {
      lines.push('REPETITION HISTORY (last 14 days):');
      for (const e of recent) lines.push(`${e.ref} ${shortenDate(e.date)} ${e.strength} ${e.reps}x`);
      lines.push('');
    }
  }

  return lines.join('\n');
}

// Mirrors geminiErrorIsZeroQuota() in review.html — keep the two identical.
//
// Google reports a tier with NO allowance for a model as "limit: 0" inside a
// 429 whose text opens "You exceeded your current quota". That reads like a
// used-up quota but never refills, so retrying the same model fails forever.
// This is not hypothetical here: the nightly cron failed on exactly this for
// days against `gemini-3.1-pro`, and because the failure was only ever
// console.error'd, nobody found out until the plan was noticed to be stale.
function geminiErrorIsZeroQuota(message) {
  return /limit:\s*0\b/.test(String(message || ''));
}

// A 503 "overloaded / high demand" is the OPPOSITE of a zero quota: purely
// transient, and the correct response is to retry the SAME model. Mirrors
// geminiErrorIsOverloaded() in review.html — keep the two identical.
function geminiErrorIsOverloaded(message) {
  return /overloaded|high demand|UNAVAILABLE|\b503\b/i.test(String(message || ''));
}

const GEMINI_OVERLOAD_MAX_ATTEMPTS = 3;

const GEMINI_FALLBACK_MODEL = 'gemini-flash-latest';

// callGemini, but a model with no allowance at all falls back to Flash once.
// Returns { text, usedFallback, originalModel } so the caller can tell the
// user which model actually produced the result. Deliberately narrow: a REAL
// rate limit (non-zero quota, temporarily exhausted) still throws, because
// there retrying the same model shortly is the correct response and a silent
// downgrade would hide it.
async function callGeminiWithTierFallback(apiKey, model, systemPrompt, userMessage) {
  for (let attempt = 1; attempt <= GEMINI_OVERLOAD_MAX_ATTEMPTS; attempt++) {
    try {
      return { text: await callGemini(apiKey, model, systemPrompt, userMessage), usedFallback: false };
    } catch (e) {
      // Transient overload — wait and retry the same model rather than
      // failing the whole nightly run over a few seconds of Google-side load.
      if (geminiErrorIsOverloaded(e.message) && attempt < GEMINI_OVERLOAD_MAX_ATTEMPTS) {
        await new Promise(r => setTimeout(r, 3000 * attempt));
        continue;
      }
      if (!geminiErrorIsZeroQuota(e.message) || model === GEMINI_FALLBACK_MODEL) throw e;
      const text = await callGemini(apiKey, GEMINI_FALLBACK_MODEL, systemPrompt, userMessage);
      return { text, usedFallback: true, originalModel: model };
    }
  }
}

async function callGemini(apiKey, model, systemPrompt, userMessage) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: userMessage }] }],
      // Raised from 8192 when the daily-plan prompt stopped capping how many
      // clusters it lists. A plan with many clusters — each carrying Arabic
      // opening/closing words — can run long, and hitting the ceiling
      // truncates the response mid-list, which parseBotDailyPlan would
      // happily turn into a silently-incomplete plan.
      generationConfig: { maxOutputTokens: 16384 },
    }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error?.message || `Gemini API error ${resp.status}`);
  }
  const data = await resp.json();
  const candidate = data.candidates?.[0];
  const text = candidate?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini returned an empty response.');
  // A truncated response still parses into a plausible-looking plan, just
  // one that quietly stops partway through the cluster list. Fail loudly
  // instead — a partial plan the user can't distinguish from a complete one
  // is worse than no plan.
  if (candidate.finishReason === 'MAX_TOKENS') {
    throw new Error('Gemini hit its output limit, so the plan would have been cut off partway through. Try a shorter lookup window.');
  }
  return text;
}

// ── Format helpers ────────────────────────────────────────────────────────────
function surahLabel(num) {
  const s = SURAHS[num - 1];
  return s ? `${s[1]} — ${s[2]}` : `Surah ${num}`;
}

function formatReviseMessage(pageNum, startAyah, endAyah) {
  const startSurah = startAyah.surah?.number ?? startAyah.surah;
  const startRef = `${startSurah}:${startAyah.numberInSurah}`;
  const lines = [
    `📖 *Page ${pageNum}*`, ``,
    `*Start — ${startRef}*`, `${surahLabel(startSurah)}`, ``, startAyah.text,
  ];
  if (endAyah) {
    const endSurah = endAyah.surah?.number ?? endAyah.surah;
    const endRef = `${endSurah}:${endAyah.numberInSurah}`;
    lines.push(``, `*Recite until — ${endRef}*`, `${surahLabel(endSurah)}`, ``, endAyah.text);
  } else {
    lines.push(``, `*(End of Quran)*`);
  }
  return lines.join('\n');
}

// ── Split a long string into ≤4000-char chunks, breaking at newlines ─────────
function splitMessage(text, maxLen = 4000) {
  const parts = [];
  while (text.length > maxLen) {
    let cut = text.lastIndexOf('\n', maxLen);
    if (cut <= 0) cut = maxLen;
    parts.push(text.slice(0, cut));
    text = text.slice(cut).replace(/^\n+/, '');
  }
  if (text.length) parts.push(text);
  return parts;
}

// Append the bot hashtag to the last chunk of a response and send all parts.
// Underscores are escaped when Markdown parse mode is active so Telegram doesn't
// strip them as italic markers (#quran_review_bot → #quran\_review\_bot).
const BOT_HASHTAG_PLAIN    = '#quran_review_bot';
const BOT_HASHTAG_MARKDOWN = '#quran\\_review\\_bot';
async function sendTagged(chatId, text, opts = {}) {
  const tag = opts.parse_mode ? BOT_HASHTAG_MARKDOWN : BOT_HASHTAG_PLAIN;
  const parts = splitMessage(text + '\n\n' + tag);
  for (const part of parts) {
    // Fallback strips Markdown escape sequences (e.g. \_ → _) so they don't
    // appear literally when Telegram rejects the Markdown parse.
    await bot.sendMessage(chatId, part, opts).catch(() =>
      bot.sendMessage(chatId, part.replace(/\\([_*[\]`])/g, '$1'))
    );
  }
}

// ── Ayah text fetch (first N words of Arabic text from alquran.cloud) ────────
const _ayahTextCache = new Map(); // "surah:ayah" -> text | null, process-lifetime

async function fetchAyahText(surah, ayah) {
  const key = `${surah}:${ayah}`;
  if (_ayahTextCache.has(key)) return _ayahTextCache.get(key);
  try {
    const resp = await fetch(`https://api.alquran.cloud/v1/ayah/${surah}:${ayah}/ar`,
      { signal: AbortSignal.timeout(5000) });
    const text = resp.ok ? ((await resp.json())?.data?.text || null) : null;
    _ayahTextCache.set(key, text);
    return text;
  } catch { _ayahTextCache.set(key, null); return null; }
}

function firstWords(text, n = 6) {
  if (!text) return '';
  return text.split(/\s+/).slice(0, n).join(' ') + '…';
}

// ── Shared command runner: show thinking → run with timeout → reply or error ──
async function runCommand(chatId, thinkingText, timeoutMs, fn) {
  const thinking = await bot.sendMessage(chatId, thinkingText);
  try {
    const result = await withTimeout(fn(), timeoutMs);
    await bot.deleteMessage(chatId, thinking.message_id).catch(() => {});
    return result;
  } catch (e) {
    await bot.deleteMessage(chatId, thinking.message_id).catch(() => {});
    throw e;
  }
}

// ── Bot commands ──────────────────────────────────────────────────────────────
// In groups users can prefix commands with the bot mention: "@tasmee3 /r".
// CMD() wraps a pattern so it matches both "/cmd" and "@mention /cmd".
// Capture group indices are unchanged — the prefix uses only non-capturing groups.
const CMD = (re) => new RegExp(`(?:@\\w+\\s+)?${re.source}`, re.flags);

bot.onText(CMD(/\/whoami/), (msg) => {
  bot.sendMessage(msg.chat.id,
    `Your Telegram user ID is: \`${msg.from?.id}\`\nAdd it to ALLOWED_USER_IDS in .env to restrict the bot to yourself.`,
    { parse_mode: 'Markdown' });
});

const COMMANDS_TEXT = [
  `📖 *Commands*`,
  `_In groups, prefix with_ @tasmee3 _(e.g._ @tasmee3 /r_)_`, ``,
  `*Revision*`,
  `/revise (/r) [hizb] — random page from memorized hizbs`,
  `/today (/t) — today's session summary`,
  `/log (/lo) <N>d [surah:] — sessions + mistakes (e.g. /lo 3d 2:)`,
  ``,
  `*Data*`,
  `/practice (/p) — Practice More entries with opening words`,
  `/mutashabihat (/mu) — saved mutashabihat groups`,
  ``,
  `*Daily Review*`,
  `/daily (/da) — today's plan (generates if needed)`,
  `/daily vw — list Very Weak clusters`,
  `/daily vw 1 10 — mark VW #1 done (10 reps)`,
  ``,
  `*Analysis*`,
  `/agent (/a) — full print sheet recommendation (Gemini)`,
  `/agent 1 (/a 1) — one cluster to review right now`,
  ``,
  `*Import*`,
  `/import (/i) — import mistakes from Telegram channel`,
  `/reviewed <N> — log Hizb N as reviewed (N/A mistakes)`,
  ``,
  `*Account*`,
  `/status (/s) — account info + review schedule`,
  `/link (/li) <name> — connect to your sync account`,
  ``,
  `*Code*`,
  `/code (/c) <description> — ask Claude Code to make a change on GitHub`,
  ``,
  `*Help*`,
  `/commands (/h) — show this list`,
].join('\n');

bot.onText(CMD(/\/(?:commands|help|h)/), (msg) => {
  if (!isAllowed(msg)) return;
  bot.sendMessage(msg.chat.id, COMMANDS_TEXT, { parse_mode: 'Markdown' });
});

bot.onText(CMD(/\/start/), (msg) => {
  if (!isAllowed(msg)) return;
  bot.sendMessage(msg.chat.id,
    `السلام عليكم! 🕌\n\n*Quran Revision Bot*\n\nType /commands for the full command list.`,
    { parse_mode: 'Markdown' });
});

bot.onText(CMD(/\/(?:link|li) (.+)/), async (msg, match) => {
  if (!isAllowed(msg)) return;
  const accountName = (match[1] || '').trim();
  if (!accountName) { bot.sendMessage(msg.chat.id, 'Usage: /link your-account-name'); return; }
  if (!isAllowedAccount(accountName)) { bot.sendMessage(msg.chat.id, `❌ Account "${accountName}" is not permitted.`); return; }
  try {
    const { memorizedHizbs } = await withTimeout(loadAccountData(accountName), 10000);
    userAccounts.set(msg.from?.id, accountName);
    patchAccountField(accountName, 'review.telegramChatId', msg.chat.id).catch(() => {});
    bot.sendMessage(msg.chat.id,
      `✅ Linked to *${accountName}*\n${memorizedHizbs.length} memorized hizb${memorizedHizbs.length !== 1 ? 's' : ''} found.`,
      { parse_mode: 'Markdown' });
  } catch (e) { bot.sendMessage(msg.chat.id, `❌ ${e.message}`); }
});

bot.onText(CMD(/\/(?:status|s)(?:\s|$)/), async (msg) => {
  if (!isAllowed(msg)) return;
  const accountName = getAccountName(msg.from?.id);
  if (!accountName) { bot.sendMessage(msg.chat.id, 'No account linked. Use /link <accountname> first.'); return; }
  try {
    const { memorizedHizbs, ayahMistakes, mutashabihatPairs, recitationLog } = await withTimeout(loadAccountData(accountName), 10000);
    const lines = [
      `📋 *Account:* ${accountName}`,
      `📚 Memorized hizbs: ${memorizedHizbs.length} (${memorizedHizbs.join(', ')})`,
      `⚠️ Logged mistakes: ${ayahMistakes.length}`,
      `🔀 Mutashabihat groups: ${mutashabihatPairs.length}`,
    ];
    if (memorizedHizbs.length > 0) {
      const today = new Date().toISOString().slice(0, 10);
      // For each hizb, find most recent session date
      const lastByHizb = new Map();
      for (const s of (recitationLog || [])) {
        const d = (s.date || '').slice(0, 10);
        if (!d) continue;
        if (!lastByHizb.has(s.hizb) || d > lastByHizb.get(s.hizb)) lastByHizb.set(s.hizb, d);
      }
      const schedRows = memorizedHizbs.map(hizb => {
        const last = lastByHizb.get(hizb);
        if (!last) return { hizb, days: null };
        const msAgo = Date.now() - new Date(last).getTime();
        const days = Math.floor(msAgo / 86400000);
        return { hizb, days, last };
      });
      schedRows.sort((a, b) => {
        if (a.days === null && b.days === null) return a.hizb - b.hizb;
        if (a.days === null) return -1;
        if (b.days === null) return 1;
        return b.days - a.days;
      });
      lines.push('', '📅 *Review Schedule* (most overdue first)');
      for (const { hizb, days, last } of schedRows) {
        const icon = days === null || days >= 6 ? '❌' : days >= 4 ? '⚠️' : '✓';
        const dateStr = last ? new Date(last).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'Never';
        const daysStr = days !== null ? ` (${days}d)` : '';
        lines.push(`Hizb ${hizb}: ${dateStr}${daysStr} ${icon}`);
      }
    }
    bot.sendMessage(msg.chat.id, lines.join('\n'), { parse_mode: 'Markdown' });
  } catch (e) { bot.sendMessage(msg.chat.id, `❌ ${e.message}`); }
});

bot.onText(CMD(/\/(?:revise|r)(?:\s+(\S+))?/), async (msg, match) => {
  if (!isAllowed(msg)) return;
  const arg = ((match && match[1]) || '').trim();

  // Arg is a hizb spec ("5" or "1-5") when it's purely numeric/range.
  // Otherwise treat it as an account name (existing behaviour).
  let hizbFilter = null;
  let accountName = '';
  const hizbArgMatch = arg.match(/^(\d+)(?:-(\d+))?$/);
  if (hizbArgMatch) {
    const h1 = parseInt(hizbArgMatch[1]);
    const h2 = hizbArgMatch[2] ? parseInt(hizbArgMatch[2]) : h1;
    if (h1 >= 1 && h1 <= 60 && h2 >= h1 && h2 <= 60) hizbFilter = { from: h1, to: h2 };
    accountName = getAccountName(msg.from?.id);
  } else {
    accountName = arg || getAccountName(msg.from?.id);
  }

  if (!accountName) { bot.sendMessage(msg.chat.id, 'Usage: /revise [hizb or range, e.g. 5 or 1-5]\nLink first with /link <accountname>'); return; }
  if (!isAllowedAccount(accountName)) { bot.sendMessage(msg.chat.id, `❌ Account "${accountName}" is not permitted.`); return; }
  try {
    bot.sendChatAction(msg.chat.id, 'typing').catch(() => {});
    const { memorizedHizbs, ayahMistakes, mutashabihatPairs } =
      await withTimeout(loadAccountDataForRevise(accountName), 8000);
    if (!memorizedHizbs.length) throw new Error('No hizbs marked as memorized. Mark them in the Tracker tab first.');

    let hizbsToUse = memorizedHizbs;
    if (hizbFilter) {
      hizbsToUse = memorizedHizbs.filter(h => h >= hizbFilter.from && h <= hizbFilter.to);
      if (!hizbsToUse.length) {
        const label = hizbFilter.from === hizbFilter.to
          ? `Hizb ${hizbFilter.from}` : `Hizbs ${hizbFilter.from}–${hizbFilter.to}`;
        throw new Error(`${label} not in your memorized hizbs (${memorizedHizbs.join(', ')}).`);
      }
    }

    const pool = [];
    for (const hizb of hizbsToUse) {
      const range = hizbRange(hizb);
      if (range) for (let g = range[0]; g <= range[1]; g++) pool.push(g);
    }
    const pickedG = pickGlobalAyahFromPool(pool, computeTroubleWeights(ayahMistakes), computeMutashabihatSet(mutashabihatPairs));
    const { surah, ayah } = globalToSurahAyah(pickedG);
    const pageNum = ayahToPage(surah, ayah);
    const startAyah = pageStartAyahData(pageNum);
    const endAyah   = pageStartAyahData(pageNum + 1);
    if (!startAyah) throw new Error('Could not load page data — try again.');
    const hizbNote = hizbFilter
      ? ` _(Hizb ${hizbFilter.from === hizbFilter.to ? hizbFilter.from : `${hizbFilter.from}–${hizbFilter.to}`})_`
      : '';
    const reviseText = formatReviseMessage(pageNum, startAyah, endAyah) + hizbNote;
    await sendTagged(msg.chat.id, reviseText, { parse_mode: 'Markdown' });
    // Also forward to jadn_channel (backup channel) so there's a log of every
    // revise session, regardless of where the command was invoked from.
    if (TELEGRAM_BACKUP_CHANNEL && msg.chat.id.toString() !== TELEGRAM_BACKUP_CHANNEL.toString()) {
      bot.sendMessage(TELEGRAM_BACKUP_CHANNEL, reviseText + '\n\n#quran_review_bot', { parse_mode: 'Markdown' }).catch(() => {});
    }
  } catch (e) { bot.sendMessage(msg.chat.id, `❌ ${e.message}`); }
});

bot.onText(CMD(/\/(?:today|t)(?:\s|$)/), async (msg) => {
  if (!isAllowed(msg)) return;
  const accountName = getAccountName(msg.from?.id);
  if (!accountName) { bot.sendMessage(msg.chat.id, 'Link first: /link <accountname>'); return; }
  try {
    const text = await runCommand(msg.chat.id, '⏳ Loading…', 10000, async () => {
      const { recitationLog, ayahMistakes } = await loadAccountData(accountName);
      const todayStr = new Date().toDateString();
      const todaySessions = recitationLog.filter(s => new Date(s.date).toDateString() === todayStr);
      const todayMistakes = ayahMistakes.filter(m =>
        new Date(m.date).toDateString() === todayStr && !m.type?.includes('A')
      );
      const lines = [`📅 *Today*`, ``];
      if (todaySessions.length === 0 && todayMistakes.length === 0) {
        lines.push('No sessions logged today yet.');
      } else {
        const hizbs = [...new Set(todaySessions.map(s => s.hizb))].sort((a, b) => a - b);
        const total = todaySessions.reduce((s, r) => s + (r.mistakes || 0), 0);
        if (hizbs.length > 0) { lines.push(`📚 Hizbs: ${hizbs.join(', ')}`); lines.push(`⚠️ Mistakes: ${total}`); }
        const mm = new Map();
        for (const m of todayMistakes) mm.set(`${m.surah}:${m.ayah}`, (mm.get(`${m.surah}:${m.ayah}`) || 0) + 1);
        const top = [...mm.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
        if (top.length > 0) {
          lines.push(``, `*Most missed:*`);
          for (const [ref, cnt] of top) lines.push(`• ${ref}${cnt > 1 ? ` ×${cnt}` : ''}`);
        }
      }
      return lines.join('\n');
    });
    await sendTagged(msg.chat.id, text, { parse_mode: 'Markdown' });
  } catch (e) { bot.sendMessage(msg.chat.id, `❌ ${e.message}`); }
});

let importRunning = false;

bot.onText(CMD(/\/(?:import|i)(?:\s+(\d+))?/), async (msg, match) => {
  if (!isAllowed(msg)) return;
  const accountName = getAccountName(msg.from?.id);
  if (!accountName) { bot.sendMessage(msg.chat.id, 'Link first: /link <accountname>'); return; }
  if (!TELEGRAM_CHANNEL) { bot.sendMessage(msg.chat.id, '❌ TELEGRAM_CHANNEL not configured on the bot.'); return; }
  if (importRunning) { bot.sendMessage(msg.chat.id, '⏳ Import already in progress — please wait.'); return; }
  const maxMessages = Math.min(1000, Math.max(20, parseInt((match && match[1]) || '100')));
  const timeoutMs = Math.min(120000, 30000 + Math.ceil(maxMessages / 20) * 5000);
  importRunning = true;
  try {
    const text = await runCommand(msg.chat.id, `⏳ Importing from Telegram (last ~${maxMessages} messages)…`, timeoutMs, async () => {
      const [messages, { ayahMistakes: existing }] = await Promise.all([
        fetchTelegramMessages(maxMessages),
        loadAccountData(accountName),
      ]);
      const logMessages = messages.filter(m => !m.isService && looksLikeAyahLogMessage(m.text));
      if (!logMessages.length) return '✅ No log messages found in channel.';
      let activeSurah = null;
      const candidates = [];
      let skippedNoSurah = 0;
      for (const lm of logMessages) {
        const msgHash = extractTelegramMessageHash(lm.text);
        const msgText = textWithoutMessageHash(lm.text, msgHash);
        const { entries, endingSurah } = parseAyahMistakesText(msgText, activeSurah);
        activeSurah = endingSurah;
        if (!entries.length && !endingSurah) { skippedNoSurah++; continue; }
        for (const e of entries) candidates.push({ ...e, telegramMessageId: lm.id, date: lm.date, source: 'telegram' });
      }
      const newMistakes = candidates.filter(c => !telegramMistakeExists(existing, c.telegramMessageId, c.surah, c.ayah));
      if (!newMistakes.length) {
        return `✅ Nothing new to import.${skippedNoSurah ? `\n⚠️ ${skippedNoSurah} message(s) skipped — no surah context.` : ''}`;
      }
      const toSave = newMistakes.map(m => ({ id: generateId(), ...m }));
      await patchAccountField(accountName, 'review.ayahMistakes', [...existing, ...toSave]);
      return `✅ Imported *${toSave.length}* new mistake${toSave.length !== 1 ? 's' : ''} from ${logMessages.length} messages.` +
        (skippedNoSurah ? `\n⚠️ ${skippedNoSurah} message(s) skipped — no surah context (add a \`2:\` line).` : '');
    });
    await sendTagged(msg.chat.id, text, { parse_mode: 'Markdown' });
  } catch (e) { bot.sendMessage(msg.chat.id, `❌ ${e.message}`); }
  finally { importRunning = false; }
});

// Parse a synced include-flag string ('true'/'false'/null) with a fallback default.
function agentIncludeFlag(val, defaultVal) {
  if (val === null || val === undefined) return defaultVal;
  return val === 'true';
}

// /agent — return the last response saved to Firebase from the web app.
// /agent refresh — re-run Gemini fresh and save the result back to Firebase.
bot.onText(CMD(/\/(?:agent|a)(?:\s+(.+))?/), async (msg, match) => {
  if (!isAllowed(msg)) return;
  const accountName = getAccountName(msg.from?.id);
  if (!accountName) { bot.sendMessage(msg.chat.id, 'Link first: /link <accountname>'); return; }
  const flags = ((match && match[1]) || '').toLowerCase().replace(/\s+/g, '');
  const forceRefresh = flags.includes('refresh');

  try {
    const data = await loadAccountData(accountName);

    // Default: return the last response the web app saved to Firebase.
    if (!forceRefresh) {
      if (!data.agentLastResponse) {
        bot.sendMessage(msg.chat.id,
          'No saved agent response yet.\n\nRun the agent in the web app (Agent Chat tab → Send), then push to Firebase.\nOr use /agent refresh to run a fresh analysis here.');
        return;
      }
      await sendTagged(msg.chat.id, data.agentLastResponse, { parse_mode: 'Markdown' });
      return;
    }

    // refresh: re-run Gemini and save the result back to Firebase.
    bot.sendChatAction(msg.chat.id, 'typing').catch(() => {});
    const typingInterval = setInterval(() =>
      bot.sendChatAction(msg.chat.id, 'typing').catch(() => {}), 4000);
    let text;
    try {
      text = await withTimeout((async () => {
        const apiKey = data.agentApiKey || process.env.GEMINI_API_KEY || '';
        if (!apiKey) throw new Error('No Gemini API key set. Add it in the app\'s Agent Chat tab → Settings → Save to Firebase, or set GEMINI_API_KEY in Cloud Run env vars.');
        const model = data.agentModel || 'gemini-flash-latest';
        const promptPreset = data.agentPromptPreset || 'print';
        const prompt = data.agentPromptOverrides?.[promptPreset] || DEFAULT_AGENT_PROMPT;
        const includeAyahMistakes  = agentIncludeFlag(data.agentIncludeAyahMistakes,  true);
        const includeRecitationLog = agentIncludeFlag(data.agentIncludeRecitationLog, true);
        const includeMutashabihat  = agentIncludeFlag(data.agentIncludeMutashabihat,  false);
        const context = buildAgentContext(data, { includeMutashabihat, includeRecitationLog, includeAyahMistakes });
        return await callGemini(apiKey, model, prompt, context);
      })(), 90000);
    } finally {
      clearInterval(typingInterval);
    }
    // Save to Firebase so future /agent calls (and the web app) see this result.
    patchAccountField(accountName, 'review.agentLastResponse', text).catch(e =>
      logError('[agent] Failed to save response to Firebase:', e.message));
    await sendTagged(msg.chat.id, text, { parse_mode: 'Markdown' });
  } catch (e) { bot.sendMessage(msg.chat.id, `❌ ${e.message}`); }
});

bot.onText(CMD(/\/(?:practice|p)(?:\s|$)/), async (msg) => {
  if (!isAllowed(msg)) return;
  const accountName = getAccountName(msg.from?.id);
  if (!accountName) { bot.sendMessage(msg.chat.id, 'Link first: /link <accountname>'); return; }
  try {
    const { practiceRanges } = await withTimeout(loadAccountData(accountName), 10000);
    if (!practiceRanges.length) {
      bot.sendMessage(msg.chat.id, '📋 No practice entries saved yet.\n\nAdd them in the app\'s Review & Analyze tab → Practice More.');
      return;
    }
    // Pre-fetch start/end ayah texts for all ranges in parallel
    const toFetch = [];
    for (const r of practiceRanges) {
      if (r.kind !== 'page' && !(r.page != null && !r.ayahStart)) {
        toFetch.push(fetchAyahText(r.surah, r.ayahStart));
        if (r.ayahEnd !== r.ayahStart) toFetch.push(fetchAyahText(r.surah, r.ayahEnd));
      }
    }
    await Promise.all(toFetch);

    const lines = ['📋 *Practice More*', ''];
    for (const r of practiceRanges) {
      const done = `${r.practiced ?? 0}/${r.target ?? 0}×`;
      if (r.kind === 'page' || (!r.kind && r.page != null)) {
        lines.push(`• Page ${r.page} — ${done}${r.note ? ` — ${r.note}` : ''}`);
      } else {
        const s = SURAHS[r.surah - 1];
        const name = s ? s[2] : `Surah ${r.surah}`;
        const ref = r.ayahStart === r.ayahEnd
          ? `${r.surah}:${r.ayahStart}` : `${r.surah}:${r.ayahStart}–${r.ayahEnd}`;
        lines.push(`• ${ref} (${name}) — ${done}${r.note ? ` — ${r.note}` : ''}`);
        const startText = _ayahTextCache.get(`${r.surah}:${r.ayahStart}`);
        if (startText) lines.push(`  ↳ *${firstWords(startText)}*`);
        if (r.ayahEnd !== r.ayahStart) {
          const endText = _ayahTextCache.get(`${r.surah}:${r.ayahEnd}`);
          if (endText) lines.push(`  ↳ … *${firstWords(endText)}*`);
        }
      }
    }
    await sendTagged(msg.chat.id, lines.join('\n'), { parse_mode: 'Markdown' });
  } catch (e) { bot.sendMessage(msg.chat.id, `❌ ${e.message}`); }
});

bot.onText(CMD(/\/reviewed(?:\s|$)(.*)/), async (msg, match) => {
  if (!isAllowed(msg)) return;
  const accountName = getAccountName(msg.from?.id);
  if (!accountName) { bot.sendMessage(msg.chat.id, 'Link first with /link <account>'); return; }
  const parts = ((match && match[1]) || '').trim().split(/[\s,]+/).filter(Boolean);
  const hizbNums = [...new Set(parts.map(Number).filter(n => Number.isInteger(n) && n >= 1 && n <= 60))];
  if (hizbNums.length === 0) {
    bot.sendMessage(msg.chat.id, 'Usage: /reviewed 3\nOr multiple: /reviewed 3,4,5');
    return;
  }
  try {
    const { recitationLog } = await withTimeout(loadAccountData(accountName), 10000);
    const today = new Date().toISOString().slice(0, 10);
    const newSessions = [];
    for (const hizb of hizbNums) {
      if (!recitationLog.some(s => s.hizb === hizb && (s.date || '').slice(0, 10) === today)) {
        newSessions.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, hizb, mistakes: null, date: new Date().toISOString() });
      }
    }
    if (newSessions.length === 0) {
      bot.sendMessage(msg.chat.id, 'Already logged today for those hizbs.');
      return;
    }
    await patchAccountField(accountName, 'review.recitationLog', [...recitationLog, ...newSessions]);
    const names = newSessions.map(s => `Hizb ${s.hizb}`).join(', ');
    bot.sendMessage(msg.chat.id, `✅ Logged review for ${names} (mistakes: N/A)`);
  } catch (e) { bot.sendMessage(msg.chat.id, `❌ ${e.message}`); }
});

bot.onText(CMD(/\/(?:mutashabihat|mu)(?:\s|$)/), async (msg) => {
  if (!isAllowed(msg)) return;
  const accountName = getAccountName(msg.from?.id);
  if (!accountName) { bot.sendMessage(msg.chat.id, 'Link first: /link <accountname>'); return; }
  try {
    const { mutashabihatPairs } = await withTimeout(loadAccountData(accountName), 10000);
    if (!mutashabihatPairs.length) {
      bot.sendMessage(msg.chat.id, '🔁 No mutashabihat saved yet.\n\nAdd them in the app\'s Mutashabihat tab.');
      return;
    }
    // Normalize each group to a flat [{surah,ayah},...] list and pre-fetch all texts
    function groupAyat(g) {
      if (g.anchor) return [g.anchor, ...(g.confusables || [])];
      if (g.ayat)   return g.ayat;
      return [{ surah: g.surahA, ayah: g.ayahA }, { surah: g.surahB, ayah: g.ayahB }];
    }
    await Promise.all(mutashabihatPairs.flatMap(g => groupAyat(g).map(a => fetchAyahText(a.surah, a.ayah))));

    const lines = ['🔁 *Mutashabihat*', ''];
    for (const g of mutashabihatPairs) {
      const ayat = groupAyat(g);
      const refs = ayat.map(a => `${a.surah}:${a.ayah}`).join(' ↔ ');
      lines.push(`• ${refs}${g.note ? ` — ${g.note}` : ''}`);
      for (const a of ayat) {
        const text = _ayahTextCache.get(`${a.surah}:${a.ayah}`);
        if (text) lines.push(`  ${a.surah}:${a.ayah} — *${firstWords(text)}*`);
      }
    }
    await sendTagged(msg.chat.id, lines.join('\n'), { parse_mode: 'Markdown' });
  } catch (e) { bot.sendMessage(msg.chat.id, `❌ ${e.message}`); }
});

bot.onText(CMD(/\/(?:log|lo)(?:\s+(.+))?/), async (msg, match) => {
  if (!isAllowed(msg)) return;
  const accountName = getAccountName(msg.from?.id);
  if (!accountName) { bot.sendMessage(msg.chat.id, 'Link first: /link <accountname>'); return; }

  // Parse args — Nd = day window, N: = surah filter, both optional, any order.
  // No Nd arg → show ALL time (n = null).
  const argStr = ((match && match[1]) || '').trim();
  const nMatch     = argStr.match(/(\d+)d/i);
  const surahMatch = argStr.match(/(\d+):/);
  const n          = nMatch ? parseInt(nMatch[1]) : null;   // null = all-time
  const surahFilter = surahMatch ? parseInt(surahMatch[1]) : null;
  if (n !== null && (n < 1 || n > 90)) { bot.sendMessage(msg.chat.id, '❌ Days must be 1–90, e.g. /lo 3d'); return; }
  if (surahFilter !== null && (surahFilter < 1 || surahFilter > 114)) {
    bot.sendMessage(msg.chat.id, '❌ Surah must be 1–114, e.g. /lo 3d 2:'); return;
  }

  try {
    const { recitationLog, ayahMistakes } = await withTimeout(loadAccountData(accountName), 10000);

    // Build valid-day set only when a day window is requested
    const todayStr = new Date().toDateString();
    let validDays = null;
    if (n !== null) {
      validDays = new Set();
      for (let i = 0; i < n; i++) {
        const d = new Date(); d.setDate(d.getDate() - i); validDays.add(d.toDateString());
      }
    }

    const sessions = validDays
      ? recitationLog.filter(s => validDays.has(new Date(s.date).toDateString()))
                     .sort((a, b) => new Date(a.date) - new Date(b.date))
      : [];   // sessions only shown when a day window is given

    const allMistakes = ayahMistakes.filter(m => {
      if (m.type?.includes('A')) return false;
      if (validDays && !validDays.has(new Date(m.date).toDateString())) return false;
      return true;
    });

    const shownMistakes = surahFilter ? allMistakes.filter(m => m.surah === surahFilter) : allMistakes;

    if (!sessions.length && !allMistakes.length) {
      await sendTagged(msg.chat.id, n === null ? '📜 No mistakes logged yet.' :
        n === 1 ? '📜 Nothing logged today yet.' : `📜 Nothing in last ${n} days.`);
      return;
    }

    function fmtDay(dateStr) {
      const d = new Date(dateStr);
      return d.toDateString() === todayStr ? 'Today'
        : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }

    function surahName(num) {
      const s = SURAHS[num - 1];
      return s ? s[1] : `Surah ${num}`;
    }

    // Header
    const periodLabel = n === null ? 'All' : n === 1 ? 'Today' : `${n}d`;
    const filterSurahName = surahFilter ? surahName(surahFilter) : null;
    const filterLabel = surahFilter ? ` · ${surahFilter}: ${filterSurahName}` : '';
    const lines = [`📜 *${periodLabel}${filterLabel}* — ${shownMistakes.length}✗`, ''];

    // Sessions (only when day window given) — one line each
    if (sessions.length) {
      for (const s of sessions) {
        const m = s.mistakes ?? 0;
        lines.push(`${fmtDay(s.date)}  H${s.hizb}  ${m}✗`);
      }
      lines.push('');
    }

    // Mistakes — grouped by surah, each surah on one compact line
    if (shownMistakes.length) {
      // Group by ayah key → {type, dates[]}
      const byAyah = new Map();
      for (const m of shownMistakes) {
        const key = `${m.surah}:${m.ayah}`;
        if (!byAyah.has(key)) byAyah.set(key, { surah: m.surah, ayah: m.ayah, type: m.type || '', dates: [] });
        byAyah.get(key).dates.push(m.date);
      }

      // Group ayah entries by surah, sort surah asc, ayat asc within surah
      const bySurah = new Map();
      for (const [, entry] of byAyah) {
        if (!bySurah.has(entry.surah)) bySurah.set(entry.surah, []);
        bySurah.get(entry.surah).push(entry);
      }
      const sortedSurahs = [...bySurah.keys()].sort((a, b) => a - b);

      const surahLabels = [];   // for legend
      for (const s of sortedSurahs) {
        const sName = surahName(s);
        surahLabels.push(`${s}:=${sName}`);
        const entries = bySurah.get(s).sort((a, b) => a.ayah - b.ayah);
        const parts = entries.map(e => {
          const t = e.type ? ` ${e.type}` : '';
          const x = `×${e.dates.length}`;
          return `${s}:${e.ayah}${t}${x}`;
        });
        lines.push(`*${s}: ${sName}*`);
        lines.push(parts.join('  '));
        lines.push('');
      }

      // Legend — surah names + type codes
      if (surahLabels.length > 0) {
        lines.push(`_${surahLabels.join('  ')}_`);
      }
    } else if (surahFilter) {
      lines.push(`_No mistakes for ${surahFilter}: in this period._`);
    }

    lines.push(`_S=stopped B=forgot-begin W=word-slip M=multi T=similar E=ending K=weak_`);

    await sendTagged(msg.chat.id, lines.join('\n'), { parse_mode: 'Markdown' });
  } catch (e) { bot.sendMessage(msg.chat.id, `❌ ${e.message}`); }
});

// ── /daily — daily revision plan ─────────────────────────────────────────────

// Parses Print Suggestions AI response into a structured plan.
// Mirrors parseDailyPlanFromAiResponse() in review.html.
function parseBotDailyPlan(text) {
  const lines = text.split('\n');
  const clusters = [];
  let strength = null;
  let id = 0;
  const CLUSTER_RE = /☐\s*Cluster\s+([\d]+:[\d]+(?:[–—−\-][\d:]+)?)\b.*?:?\s*Practice\s+(\d+)\s*times?/i;
  const PAGE_RE = /☐\s*Page\s+(\d+)\b.*?:?\s*Practice\s+(\d+)\s*times?/i;
  for (const line of lines) {
    const t = line.trim();
    if (/🔴/.test(t)) { strength = 'vw'; continue; }
    if (/🟠/.test(t)) { strength = 'w'; continue; }
    if (/🟡/.test(t)) { strength = 'o'; continue; }
    if (/🔵/.test(t)) { strength = 'g'; continue; }
    if (/🏃|🔀/.test(t)) { strength = null; continue; }
    if (!strength) continue;
    let m = CLUSTER_RE.exec(t);
    if (m) { clusters.push({ id: String(++id), strength, ref: m[1], targetReps: parseInt(m[2], 10), done: false, reps: null }); continue; }
    m = PAGE_RE.exec(t);
    if (m) clusters.push({ id: String(++id), strength, ref: `p${m[1]}`, targetReps: parseInt(m[2], 10), done: false, reps: null });
  }
  if (clusters.length === 0) throw new Error('No clusters parsed — use the Print Suggestions prompt.');
  const today = new Date().toISOString().slice(0, 10);
  return { date: today, generatedAt: new Date().toISOString(), clusters };
}

const DAILY_STRENGTH_LABELS = { vw: '🔴 Very Weak', w: '🟠 Weak', o: '🟡 Okay', g: '🔵 Good' };
const DAILY_STRENGTH_ORDER = ['vw', 'w', 'o', 'g'];

function parseDailyClusterRef(ref) {
  // Handles "2:40–48" or "2:40–2:48" formats
  const m = /^(\d+):(\d+)(?:[–—−\-](?:\d+:)?(\d+))?$/.exec(ref);
  if (!m) return null;
  return { surah: parseInt(m[1], 10), start: parseInt(m[2], 10), end: m[3] ? parseInt(m[3], 10) : parseInt(m[2], 10) };
}

bot.onText(CMD(/\/(?:daily|da)(?:\s+(vw|w|o|g))?(?:\s+(\d+))?(?:\s+(\d+))?/i), async (msg, match) => {
  if (!isAllowed(msg)) return;
  const accountName = getAccountName(msg.from?.id);
  if (!accountName) { bot.sendMessage(msg.chat.id, 'Link first: /link <accountname>'); return; }

  const filter   = match && match[1] ? match[1].toLowerCase() : null; // vw|w|o|g
  const clusterNum = match && match[2] ? parseInt(match[2], 10) : null;
  const reps       = match && match[3] ? parseInt(match[3], 10) : null;

  try {
    bot.sendChatAction(msg.chat.id, 'typing').catch(() => {});
    const data = await withTimeout(loadAccountData(accountName), 15000);
    const today = new Date().toISOString().slice(0, 10);

    // ── Mark done: /daily vw 1 10 ─────────────────────────────────────────
    if (filter && clusterNum !== null && reps !== null) {
      const plan = data.dailyPlan;
      if (!plan || plan.date !== today) {
        bot.sendMessage(msg.chat.id, 'No plan for today yet. Run /daily first.'); return;
      }
      const group = plan.clusters.filter(c => c.strength === filter);
      const cluster = group[clusterNum - 1];
      if (!cluster) {
        bot.sendMessage(msg.chat.id, `No ${filter.toUpperCase()} cluster #${clusterNum}. Use /daily ${filter} to see the list.`); return;
      }
      if (cluster.done) {
        bot.sendMessage(msg.chat.id, `✓ ${cluster.ref} was already marked done (${cluster.reps} reps).`); return;
      }
      cluster.done = true;
      cluster.reps = reps;
      const newHistory = [...(data.repetitionHistory || []), { date: today, ref: cluster.ref, strength: cluster.strength, reps }];
      await Promise.all([
        patchAccountField(accountName, 'review.dailyPlan', plan),
        patchAccountField(accountName, 'review.repetitionHistory', newHistory),
      ]);
      bot.sendMessage(msg.chat.id, `✅ *${cluster.ref}* — ${reps} reps recorded`, { parse_mode: 'Markdown' });
      return;
    }

    // ── List by strength: /daily vw ───────────────────────────────────────
    if (filter && clusterNum === null) {
      const plan = data.dailyPlan;
      if (!plan || plan.date !== today) {
        bot.sendMessage(msg.chat.id, 'No plan for today yet. Run /daily to generate one.'); return;
      }
      const group = plan.clusters.filter(c => c.strength === filter);
      if (!group.length) {
        bot.sendMessage(msg.chat.id, `No ${DAILY_STRENGTH_LABELS[filter]} clusters in today's plan.`); return;
      }
      const toFetch = [];
      for (const c of group) {
        const p = parseDailyClusterRef(c.ref);
        if (p) {
          toFetch.push(fetchAyahText(p.surah, p.start));
          if (p.end !== p.start) toFetch.push(fetchAyahText(p.surah, p.end));
        }
      }
      await Promise.all(toFetch);
      const lines = [`*${DAILY_STRENGTH_LABELS[filter]} Clusters*\n`];
      group.forEach((c, i) => {
        const p = parseDailyClusterRef(c.ref);
        const status = c.done ? ` ✓ done (${c.reps})` : ` → ${c.targetReps} reps`;
        lines.push(`${i + 1}. ${c.ref}${status}`);
        if (p) {
          const startText = _ayahTextCache.get(`${p.surah}:${p.start}`);
          if (startText) lines.push(`   ↳ _${firstWords(startText)}_`);
          if (p.end !== p.start) {
            const endText = _ayahTextCache.get(`${p.surah}:${p.end}`);
            if (endText) lines.push(`   ↳ … _${firstWords(endText)}_`);
          }
        }
      });
      lines.push('', `Mark done: /daily ${filter} <num> <reps>`);
      await sendTagged(msg.chat.id, lines.join('\n'), { parse_mode: 'Markdown' });
      return;
    }

    // ── Summary / generate: /daily ────────────────────────────────────────
    let plan = data.dailyPlan;
    const needsGeneration = !plan || plan.date !== today;
    if (needsGeneration) {
      const apiKey = data.agentApiKey || process.env.GEMINI_API_KEY || '';
      if (!apiKey) {
        bot.sendMessage(msg.chat.id, '❌ No Gemini API key. Add it in the app\'s Agent tab → Settings → Save to Firebase, or set GEMINI_API_KEY in Cloud Run env vars.'); return;
      }
      bot.sendMessage(msg.chat.id, '⏳ Generating daily plan…');
      const typingInterval = setInterval(() => bot.sendChatAction(msg.chat.id, 'typing').catch(() => {}), 4000);
      try {
        const model = data.agentModel || 'gemini-flash-latest';
        const prompt = data.agentPromptOverrides?.['print'] || DEFAULT_AGENT_PROMPT;
        const context = buildAgentContext(data, { includeRecitationLog: true, includeAyahMistakes: true, includeDailyHistory: true });
        const raw = await withTimeout(callGemini(apiKey, model, prompt, context), 90000);
        plan = parseBotDailyPlan(raw);
        await patchAccountField(accountName, 'review.dailyPlan', plan);
        _cacheInvalidate(accountName);
      } finally {
        clearInterval(typingInterval);
      }
    }

    // Pre-fetch ayah texts for all clusters
    await Promise.all(plan.clusters.flatMap(c => {
      const p = parseDailyClusterRef(c.ref);
      if (!p) return [];
      const fetches = [fetchAyahText(p.surah, p.start)];
      if (p.end !== p.start) fetches.push(fetchAyahText(p.surah, p.end));
      return fetches;
    }));

    const doneCount = plan.clusters.filter(c => c.done).length;
    const lines = [`📅 *Daily Review — ${plan.date}*\n`];
    for (const s of DAILY_STRENGTH_ORDER) {
      const group = plan.clusters.filter(c => c.strength === s);
      if (!group.length) continue;
      const doneInGroup = group.filter(c => c.done).length;
      lines.push(`*${DAILY_STRENGTH_LABELS[s]}* (${doneInGroup}/${group.length} done)`);
      group.forEach((c, i) => {
        const p = parseDailyClusterRef(c.ref);
        const status = c.done ? ` ✓` : ` → ${c.targetReps}×`;
        lines.push(`  ${i + 1}. ${c.ref}${status}`);
        if (p) {
          const startText = _ayahTextCache.get(`${p.surah}:${p.start}`);
          if (startText) lines.push(`     ↳ _${firstWords(startText)}_`);
          if (p.end !== p.start) {
            const endText = _ayahTextCache.get(`${p.surah}:${p.end}`);
            if (endText) lines.push(`     ↳ … _${firstWords(endText)}_`);
          }
        }
      });
    }
    lines.push('', `${doneCount}/${plan.clusters.length} done`);
    lines.push('', '/daily vw 1 10 → mark VW #1 done (10 reps)');
    await sendTagged(msg.chat.id, lines.join('\n'), { parse_mode: 'Markdown' });
  } catch (e) { bot.sendMessage(msg.chat.id, `❌ ${e.message}`); }
});

// ── Scheduled daily plan generation ──────────────────────────────────────────

function shouldGenerateDailyPlan(schedule, existingPlan) {
  if (!schedule || !schedule.enabled) return false;
  const today = new Date().toISOString().slice(0, 10);
  if (existingPlan && existingPlan.date === today) return false;
  const nowUtcHour = new Date().getUTCHours();
  return nowUtcHour >= (schedule.utcHour ?? 0);
}

// Import recent Telegram channel mistakes into an account's Firestore data.
// Returns the number of newly saved mistakes (0 if nothing new or channel not configured).
async function importChannelMistakesForAccount(accountName) {
  if (!TELEGRAM_CHANNEL) return 0;
  const [messages, existing] = await Promise.all([
    fetchTelegramMessages(100),
    loadAccountFields(accountName, ['ayahMistakes']).then(d => d.ayahMistakes || []),
  ]);
  const logMessages = messages.filter(m => !m.isService && looksLikeAyahLogMessage(m.text));
  if (!logMessages.length) return 0;
  let activeSurah = null;
  const candidates = [];
  for (const lm of logMessages) {
    const msgHash = extractTelegramMessageHash(lm.text);
    const msgText = textWithoutMessageHash(lm.text, msgHash);
    const { entries, endingSurah } = parseAyahMistakesText(msgText, activeSurah);
    activeSurah = endingSurah;
    for (const e of entries) candidates.push({ ...e, telegramMessageId: lm.id, date: lm.date, source: 'telegram' });
  }
  const newMistakes = candidates.filter(c => !telegramMistakeExists(existing, c.telegramMessageId, c.surah, c.ayah));
  if (!newMistakes.length) return 0;
  const toSave = newMistakes.map(m => ({ id: generateId(), ...m }));
  await patchAccountField(accountName, 'review.ayahMistakes', [...existing, ...toSave]);
  return toSave.length;
}

async function generateScheduledPlan(accountName) {
  // First check schedule/dedup before doing any expensive work
  const schedData = await loadAccountFields(accountName, ['dailyPlan', 'dailyPlanSchedule']);
  const schedule = schedData.dailyPlanSchedule;
  if (!shouldGenerateDailyPlan(schedule, schedData.dailyPlan)) return;

  // Import any new Telegram channel mistakes so the plan uses up-to-date data
  const newMistakeCount = await importChannelMistakesForAccount(accountName).catch(e => {
    console.error(`[cron] ${accountName}: channel import failed: ${e.message}`);
    return 0;
  });
  if (newMistakeCount > 0) {
    log(`[cron] ${accountName}: imported ${newMistakeCount} new mistakes from channel`);
    _cacheInvalidate(accountName);
  }

  // Reload full data (includes freshly imported mistakes)
  const data = await loadAccountFields(accountName, [
    'agentApiKey', 'agentModel', 'agentPromptOverrides', 'dailyPlan',
    'dailyPlanSchedule', 'telegramChatId',
    'memorizedHizbs', 'ayahMistakes', 'recitationLog', 'repetitionHistory',
    'mutashabihatPairs',
  ]);
  const apiKey = data.agentApiKey || process.env.GEMINI_API_KEY || '';
  if (!apiKey) return;
  const model = schedule.model || data.agentModel || 'gemini-flash-latest';
  const extraContext = schedule.extraContext || '';
  const prompt = data.agentPromptOverrides?.['print'] || DEFAULT_AGENT_PROMPT;
  const contextText = buildAgentContext(data, {
    includeRecitationLog: true, includeAyahMistakes: true, includeDailyHistory: true,
    // Type-A ("needs attention") entries are REQUIRED here: the prompt counts
    // them for clustering, and the corroboration rule works by pairing a
    // recent near-miss with an older real mistake. Excluding them (the
    // default) made that rule impossible in the scheduled path.
    includeAttention: true,
    days: schedule.lookupDays,
  }) + (extraContext ? `\n\nExtra context: ${extraContext}` : '');
  const result = await withTimeout(callGeminiWithTierFallback(apiKey, model, prompt, contextText), 90000);
  const plan = parseBotDailyPlan(result.text);
  await patchAccountField(accountName, 'review.dailyPlan', plan);
  _cacheInvalidate(accountName);
  if (data.telegramChatId) {
    const vwCount = plan.clusters.filter(c => c.strength === 'vw').length;
    const fallbackNote = result.usedFallback
      ? `\n\n⚠️ ${result.originalModel} has no quota on your API key, so this was generated with ${GEMINI_FALLBACK_MODEL} instead. Add billing to that key to use Pro.`
      : '';
    await bot.sendMessage(data.telegramChatId,
      `📅 *Daily plan ready* — ${plan.clusters.length} clusters (${vwCount} VW)\nOpen the app to start reviewing.${fallbackNote}`,
      { parse_mode: 'Markdown' }).catch(() => {});
  }
}

// A scheduled plan that fails must SAY so. It previously only reached
// console.error, which is why a model with zero quota silently stopped the
// nightly plan for days — the app just kept showing an increasingly old plan
// with nothing anywhere indicating why.
async function notifyScheduledPlanFailure(accountName, message) {
  try {
    const { telegramChatId } = await loadAccountFields(accountName, ['telegramChatId']);
    if (!telegramChatId) return;
    const hint = geminiErrorIsZeroQuota(message)
      ? '\n\nThat model has no quota on your API key at all (Google reports a limit of 0, which never refills). Switch the schedule to Flash, or add billing to the key.'
      : geminiErrorIsOverloaded(message)
      ? '\n\nThe model was overloaded Google-side and was already retried several times. This one usually clears on its own — the next scheduled run should succeed.'
      : '';
    await bot.sendMessage(telegramChatId,
      `⚠️ Daily plan couldn't be generated.\n\n${message}${hint}`).catch(() => {});
  } catch (_) { /* notification is best-effort — never mask the original error */ }
}

// ── /code — create a GitHub issue for Claude Code to work on ─────────────────
bot.onText(/^\/(code|c)(?:@\w+)?\s+([\s\S]+)$/i, async (msg, match) => {
  if (!isAllowed(msg)) return;
  const description = match[2].trim();
  if (!description) {
    bot.sendMessage(msg.chat.id, 'Usage: /code <description of what to fix or add>');
    return;
  }
  if (!GITHUB_TOKEN) {
    bot.sendMessage(msg.chat.id, '❌ GITHUB_TOKEN is not configured on the bot. Add it to your Cloud Run env vars.');
    return;
  }

  const issueBody = [
    description,
    '',
    '---',
    `_Requested via Telegram by ${msg.from?.username ? '@' + msg.from.username : msg.from?.first_name || 'user'}_`,
  ].join('\n');

  const ghHeaders = {
    'Authorization': `Bearer ${GITHUB_TOKEN}`,
    'Content-Type': 'application/json',
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  try {
    // Create issue WITHOUT @claude so no branch is auto-created
    const issueResp = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/issues`, {
      method: 'POST',
      headers: ghHeaders,
      body: JSON.stringify({ title: description, body: issueBody, labels: ['claude'] }),
    });
    if (!issueResp.ok) {
      const err = await issueResp.json().catch(() => ({}));
      throw new Error(err.message || `GitHub API error ${issueResp.status}`);
    }
    const issue = await issueResp.json();

    // Post @claude as a comment — triggers issue_comment event (no branch created)
    const commentResp = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/issues/${issue.number}/comments`, {
      method: 'POST',
      headers: ghHeaders,
      body: JSON.stringify({ body: `@claude ${description}` }),
    });
    if (!commentResp.ok) {
      const err = await commentResp.json().catch(() => ({}));
      throw new Error(`Issue created but comment failed: ${err.message || commentResp.status}`);
    }

    log(`/code: created issue #${issue.number} — ${issue.html_url}`);
    bot.sendMessage(msg.chat.id,
      `✅ *Issue #${issue.number} created* — Claude Code will pick it up shortly.\n${issue.html_url}`,
      { parse_mode: 'Markdown', disable_web_page_preview: false }
    );
  } catch (e) {
    log('/code error:', e.message);
    bot.sendMessage(msg.chat.id, `❌ Failed to create issue: ${e.message}`);
  }
});

bot.on('message', (msg) => {
  if (!msg.text || !msg.text.startsWith('/')) return;
  if (msg.text.startsWith('/whoami')) return;
  if (!isAllowed(msg)) return;
  // Strip @botname suffix and arguments to get the bare command
  const cmd = msg.text.split(/[\s@]/)[0];
  const known = ['/start', '/link', '/li', '/revise', '/r', '/status', '/s', '/today', '/t', '/import', '/i', '/agent', '/a', '/whoami', '/practice', '/p', '/mutashabihat', '/mu', '/log', '/lo', '/daily', '/da', '/reviewed', '/re', '/commands', '/help', '/h', '/code', '/c'];
  if (!known.includes(cmd)) {
    bot.sendMessage(msg.chat.id, 'Unknown command. Type /commands for the full list.');
  }
});

// When added to a channel: if TELEGRAM_BACKUP_CHANNEL_ID isn't set yet,
// post the chat ID into the channel so the admin can copy it for setup.
bot.on('channel_post', async (post) => {
  if (!TELEGRAM_BACKUP_CHANNEL) {
    try {
      await bot.sendMessage(post.chat.id,
        `🔧 *Backup channel setup*\nChat ID: \`${post.chat.id}\`\nSet \`TELEGRAM_BACKUP_CHANNEL_ID=${post.chat.id}\` in your Cloud Run env vars, then redeploy.`,
        { parse_mode: 'Markdown' });
    } catch (_) {}
  }
});

bot.on('polling_error', (err) => logError('Polling error:', err.message));
