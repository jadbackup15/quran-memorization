'use strict';
require('dotenv').config();

const TelegramBot = require('node-telegram-bot-api');

// ── In-memory log buffer (last 300 lines, exposed via GET /logs) ──────────────
const LOG_LINES = [];
const LOG_MAX = 300;
function log(...args) {
  const msg = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  LOG_LINES.push(line);
  if (LOG_LINES.length > LOG_MAX) LOG_LINES.shift();
}
const { SURAH_OFFSETS, SURAHS, globalToSurahAyah, hizbRange, pageStart } = require('./quran-data');
const PAGE_TEXTS = require('./page-texts.json'); // pre-fetched Arabic text for all 604 page-start ayahs

// ── Firebase config (same public values already in review.html — safe to commit;
//    Firestore rules gate access by account name, not the API key itself) ───────
const FIREBASE_PROJECT_ID = 'quran-df0a2';
const FIREBASE_API_KEY    = 'AIzaSyDoaUZwwjmWmg-1PLVte6KWyUfYEEGpEUE';
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents`;

// ── Bot init ──────────────────────────────────────────────────────────────────
const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) { console.error('BOT_TOKEN is not set in .env'); process.exit(1); }

const WEBHOOK_URL             = process.env.WEBHOOK_URL;
const PORT                    = parseInt(process.env.PORT) || 8080;
const TELEGRAM_CHANNEL        = process.env.TELEGRAM_CHANNEL || '';
const TELEGRAM_BACKUP_CHANNEL = process.env.TELEGRAM_BACKUP_CHANNEL_ID || '';

const http = require('http');
let bot;

// Shared HTTP handler: Telegram webhook + /send-backup endpoint
function makeHttpHandler(webhookMode) {
  return function handleRequest(req, res) {
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
          const { accountName, text } = JSON.parse(body);
          if (!isAllowedAccount(accountName)) return fail(403, 'Unauthorized');
          if (!TELEGRAM_BACKUP_CHANNEL) return fail(503, 'TELEGRAM_BACKUP_CHANNEL_ID not configured on the bot.');
          if (!text || !text.trim()) return fail(400, 'No text provided.');
          // Telegram message limit is 4096 chars; split if needed
          const tagged = text + '\n\n#quran_review_bot';
          const chunks = [];
          for (let i = 0; i < tagged.length; i += 4000) chunks.push(tagged.slice(i, i + 4000));
          for (const chunk of chunks) await bot.sendMessage(TELEGRAM_BACKUP_CHANNEL, chunk);
          res.writeHead(200); res.end(JSON.stringify({ ok: true }));
        } catch (e) { fail(500, e.message); }
      });
      return;
    }

    if (req.method === 'GET' && req.url === '/logs') {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(LOG_LINES));
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
    agentModel:               r.agentModel               || 'gemini-3.6-flash',
    agentPromptPreset:        r.agentPromptPreset        || null,
    agentPromptOverrides:     r.agentPromptOverrides     || {},
    agentIncludeAyahMistakes: r.agentIncludeAyahMistakes || null,
    agentIncludeRecitationLog: r.agentIncludeRecitationLog || null,
    agentIncludePracticeRanges: r.agentIncludePracticeRanges || null,
    agentIncludeMutashabihat: r.agentIncludeMutashabihat || null,
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
    'agentIncludePracticeRanges', 'agentIncludeMutashabihat',
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
  const url = `${FIRESTORE_BASE}/syncAccounts/${encodeURIComponent(accountName)}?updateMask.fieldPaths=${encodeURIComponent(dotPath)}&key=${FIREBASE_API_KEY}`;
  const parts = dotPath.split('.');
  const body = { fields: {} };
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

// ── Agent schedule (Daily Digest) ─────────────────────────────────────────────
// Reads review.agentSchedule from the syncAccounts collection (same doc that
// buildSyncPayload() writes), so the schedule saved from the webpage is always
// found here without needing a separate collection or security-rule change.

async function loadAgentSchedule(accountName) {
  try {
    const fields = await loadAccountFields(accountName, ['review.agentSchedule']);
    const sched = fields && fields['review.agentSchedule'];
    if (!sched || typeof sched !== 'object') return null;
    return sched;
  } catch (_) { return null; }
}

async function patchAgentScheduleField(accountName, field, value) {
  // field is e.g. 'lastRanDate' — patch it nested under review.agentSchedule
  await patchAccountField(accountName, `review.agentSchedule.${field}`, value);
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

async function callGeminiScheduled(apiKey, model, promptText, contextText) {
  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: promptText + '\n\n' + contextText }] },
        contents: [{ role: 'user', parts: [{ text: 'Please analyze the data and respond according to the current prompt.' }] }],
      }),
    }
  );
  const json = await resp.json();
  if (!resp.ok) throw new Error(json.error?.message || `Gemini ${resp.status}`);
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini returned empty response');
  return text;
}

async function runScheduledAgent(accountName, schedule) {
  console.log(`[schedule] Running Daily Digest for "${accountName}" (preset: ${schedule.promptPreset})`);
  const data = await loadAccountData(accountName);
  const apiKey = data.agentApiKey;
  const model  = data.agentModel || 'gemini-3.6-flash';
  if (!apiKey) { console.warn(`[schedule] No Gemini API key for "${accountName}" — skipping`); return; }

  const contextText = buildBotAgentContext(data);
  const promptText  = schedule.promptText || 'Analyze the user\'s Quran review data and give a concise daily summary.';

  const response = await callGeminiScheduled(apiKey, model, promptText, contextText);

  if (!TELEGRAM_BACKUP_CHANNEL) { console.warn('[schedule] TELEGRAM_BACKUP_CHANNEL_ID not set — cannot send'); return; }

  const header = `📅 *Daily Digest* — ${new Date().toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })}\n\n`;
  const footer = '\n\n' + BOT_HASHTAG_MARKDOWN;
  const full   = header + response + footer;
  // Split at 4000 chars to respect Telegram limits
  for (let i = 0; i < full.length; i += 4000) {
    await bot.sendMessage(TELEGRAM_BACKUP_CHANNEL, full.slice(i, i + 4000), { parse_mode: 'Markdown' }).catch(() =>
      bot.sendMessage(TELEGRAM_BACKUP_CHANNEL, full.slice(i, i + 4000)) // retry without markdown if it fails
    );
  }

  // Record lastRanDate so we don't double-run today
  const todayUtc = new Date().toISOString().slice(0, 10);
  await patchAgentScheduleField(accountName, 'lastRanDate', todayUtc).catch(() => {});
  console.log(`[schedule] Done for "${accountName}"`);
}

// Check every minute; only fire at the top of the hour
setInterval(async () => {
  const now = new Date();
  if (now.getUTCMinutes() !== 0) return;
  const utcHour    = now.getUTCHours();
  const todayUtc   = now.toISOString().slice(0, 10);
  const accounts   = ALLOWED_ACCOUNTS ? [...ALLOWED_ACCOUNTS] : [];
  if (!accounts.length) return;

  for (const accountName of accounts) {
    try {
      const sched = await loadAgentSchedule(accountName);
      if (!sched?.enabled) continue;
      if (sched.utcHour !== utcHour) continue;
      if (sched.lastRanDate === todayUtc) continue; // already ran today
      await runScheduledAgent(accountName, sched);
    } catch (e) {
      console.error(`[schedule] Error for "${accountName}":`, e.message);
    }
  }
}, 60_000);

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
  return /^\d/.test(t) || /^[hHpPrR]\d/.test(t);
}

function parseAyahMistakesText(text, initialSurah) {
  if (!text) return { entries: [], endingSurah: initialSurah || null };
  const normalized = normalizeArabicIndicDigits(text);
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
    if (/^[hHpPrR]/.test(line)) continue;
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


function shortenDate(dateStr) {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr || '';
  const currentYear = new Date().getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return d.getFullYear() === currentYear ? `${mm}-${dd}` : `${d.getFullYear()}-${mm}-${dd}`;
}

function buildAgentContext({ memorizedHizbs, ayahMistakes, recitationLog, mutashabihatPairs }, { includeMutashabihat = false, includeAttention = false, includeRecitationLog = true, includeAyahMistakes = true } = {}) {
  const today = new Date().toISOString().split('T')[0];
  const lines = [`TODAY: ${today}`, `MEMORIZED HIZBS: ${memorizedHizbs.join(', ') || 'none'}`, ''];

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
    const relevant = includeAttention ? ayahMistakes : ayahMistakes.filter(m => !m.type?.includes('A'));
    const mistakeMap = new Map();
    for (const m of relevant) {
      const key = `${m.surah}:${m.ayah}${m.type ? ` (${m.type})` : ''}`;
      if (!mistakeMap.has(key)) mistakeMap.set(key, []);
      mistakeMap.get(key).push(m.date);
    }
    const sortedMistakes = [...mistakeMap.entries()].sort((a, b) => b[1].length - a[1].length);
    if (sortedMistakes.length > 0) {
      lines.push(`AYAH MISTAKES${includeAttention ? ' (incl. Needs Attention)' : ''} (most-missed first):`);
      for (const [ref, dates] of sortedMistakes) lines.push(`${ref} ${dates.map(shortenDate).join(' ')}`);
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

  return lines.join('\n');
}

async function callGemini(apiKey, model, systemPrompt, userMessage) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: userMessage }] }],
      generationConfig: { maxOutputTokens: 8192 },
    }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error?.message || `Gemini API error ${resp.status}`);
  }
  const data = await resp.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini returned an empty response.');
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
    await bot.sendMessage(chatId, part, opts).catch(() => bot.sendMessage(chatId, part));
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
  `*Analysis*`,
  `/agent (/a) — full print sheet recommendation (Gemini)`,
  `/agent 1 (/a 1) — one cluster to review right now`,
  ``,
  `*Import*`,
  `/import (/i) — import mistakes from Telegram channel`,
  ``,
  `*Account*`,
  `/status (/s) — account info`,
  `/link (/li) <name> — connect to your sync account`,
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
    const { memorizedHizbs, ayahMistakes, mutashabihatPairs } = await withTimeout(loadAccountData(accountName), 10000);
    bot.sendMessage(msg.chat.id, [
      `📋 *Account:* ${accountName}`,
      `📚 Memorized hizbs: ${memorizedHizbs.length} (${memorizedHizbs.join(', ')})`,
      `⚠️ Logged mistakes: ${ayahMistakes.length}`,
      `🔀 Mutashabihat groups: ${mutashabihatPairs.length}`,
    ].join('\n'), { parse_mode: 'Markdown' });
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
    await sendTagged(msg.chat.id, formatReviseMessage(pageNum, startAyah, endAyah) + hizbNote, { parse_mode: 'Markdown' });
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
        const { entries, endingSurah } = parseAyahMistakesText(lm.text, activeSurah);
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

const agentCache = new Map(); // key -> { date, text }

// Parse a synced include-flag string ('true'/'false'/null) with a fallback default.
function agentIncludeFlag(val, defaultVal) {
  if (val === null || val === undefined) return defaultVal;
  return val === 'true';
}

bot.onText(CMD(/\/(?:agent|a)(?:\s+(.+))?/), async (msg, match) => {
  if (!isAllowed(msg)) return;
  const accountName = getAccountName(msg.from?.id);
  if (!accountName) { bot.sendMessage(msg.chat.id, 'Link first: /link <accountname>'); return; }
  const flags = ((match && match[1]) || '').toLowerCase().replace(/\s+/g, '');
  const clusterMode    = flags.includes('1');
  const mutashabihatFlag = flags.includes('m');  // /agent m forces mutashabihat on
  const includeAttention = flags.includes('a');
  const usePro         = flags.includes('pro');
  const forceRefresh   = flags.includes('refresh');
  const cacheKey = `${clusterMode ? '1-' : ''}${usePro ? 'pro' : 'flash'}-${mutashabihatFlag ? 'm' : ''}-${includeAttention ? 'a' : ''}`;
  const today = new Date().toDateString();
  const cached = agentCache.get(cacheKey);
  if (!forceRefresh && cached && cached.date === today) {
    await sendTagged(msg.chat.id, `_Cached from earlier today:_\n\n${cached.text}`, { parse_mode: 'Markdown' });
    return;
  }
  try {
    // typing indicator refreshed every 4 s — Gemini can take 10-90 s, and
    // Telegram's "typing" action expires after ~5 s without a repeat.
    bot.sendChatAction(msg.chat.id, 'typing').catch(() => {});
    const typingInterval = setInterval(() =>
      bot.sendChatAction(msg.chat.id, 'typing').catch(() => {}), 4000);
    let text;
    try {
      text = await withTimeout((async () => {
        const data = await loadAccountData(accountName);
        if (!data.agentApiKey) throw new Error('No Gemini API key saved. Add it in the app\'s Agent Chat tab → Settings → Save to Firebase.');

        // Model: /agent pro overrides; otherwise use the account's saved model.
        const model = usePro ? 'gemini-2.5-pro' : (data.agentModel || 'gemini-3.6-flash');

        // Prompt: cluster mode uses the cluster prompt; otherwise read the
        // account's saved preset ('print' or 'general', defaulting to 'print').
        const promptPreset = clusterMode ? 'cluster' : (data.agentPromptPreset || 'print');
        const prompt = promptPreset === 'cluster'
          ? (data.agentPromptOverrides?.cluster || CLUSTER_AGENT_PROMPT)
          : (data.agentPromptOverrides?.[promptPreset] || DEFAULT_AGENT_PROMPT);

        // Data-include flags: /agent m forces mutashabihat on; all others read
        // from the account's saved settings (same checkboxes as the app's Agent
        // Chat tab), with review.html's own defaults as the fallback.
        const includeAyahMistakes  = agentIncludeFlag(data.agentIncludeAyahMistakes,  true);
        const includeRecitationLog = agentIncludeFlag(data.agentIncludeRecitationLog, true);
        const includeMutashabihat  = mutashabihatFlag || agentIncludeFlag(data.agentIncludeMutashabihat, false);

        const context = buildAgentContext(data, { includeMutashabihat, includeAttention, includeRecitationLog, includeAyahMistakes });
        return await callGemini(data.agentApiKey, model, prompt, context);
      })(), 90000);
    } finally {
      clearInterval(typingInterval);
    }
    agentCache.set(cacheKey, { date: today, text });
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

bot.on('message', (msg) => {
  if (!msg.text || !msg.text.startsWith('/')) return;
  if (msg.text.startsWith('/whoami')) return;
  if (!isAllowed(msg)) return;
  // Strip @botname suffix and arguments to get the bare command
  const cmd = msg.text.split(/[\s@]/)[0];
  const known = ['/start', '/link', '/li', '/revise', '/r', '/status', '/s', '/today', '/t', '/import', '/i', '/agent', '/a', '/whoami', '/practice', '/p', '/mutashabihat', '/mu', '/log', '/lo', '/commands', '/help', '/h'];
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

bot.on('polling_error', (err) => console.error('Polling error:', err.message));
