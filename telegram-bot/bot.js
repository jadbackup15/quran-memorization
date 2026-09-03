'use strict';
require('dotenv').config();

const TelegramBot = require('node-telegram-bot-api');
const { SURAH_OFFSETS, HIZB_RANGES, SURAHS, globalToSurahAyah, hizbRange } = require('./quran-data');

// ── Firebase config (same public values already in review.html — safe to commit;
//    Firestore rules gate access by account name, not the API key itself) ───────
const FIREBASE_PROJECT_ID = 'quran-df0a2';
const FIREBASE_API_KEY    = 'AIzaSyDoaUZwwjmWmg-1PLVte6KWyUfYEEGpEUE';
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents`;

// ── Bot init ──────────────────────────────────────────────────────────────────
const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) { console.error('BOT_TOKEN is not set in .env'); process.exit(1); }
const bot = new TelegramBot(BOT_TOKEN, { polling: true });
console.log('Quran revision bot started.');

// ── In-memory user→account mapping (re-link with /link after bot restart) ────
const userAccounts = new Map(); // telegramUserId → accountName

// ── Firestore REST helpers ────────────────────────────────────────────────────
// Converts Firestore's typed value format back to a plain JS value.
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

async function loadAccountData(accountName) {
  const url = `${FIRESTORE_BASE}/syncAccounts/${encodeURIComponent(accountName)}?key=${FIREBASE_API_KEY}`;
  const resp = await fetch(url);
  if (resp.status === 404) throw new Error(`Account "${accountName}" not found. Push your data from the app first.`);
  if (!resp.ok) throw new Error(`Firestore error ${resp.status} — try again.`);
  const doc = await resp.json();
  const data = parseFirestoreDoc(doc);
  return {
    memorizedHizbs:   (data.review?.memorizedHizbs  || []).map(Number).filter(h => h >= 1 && h <= 60),
    ayahMistakes:     data.review?.ayahMistakes      || [],
    mutashabihatPairs: data.review?.mutashabihatPairs || [],
  };
}

// ── Picking logic (mirrors review.html's bucket-based pickGlobalAyahFromPool) ─
function computeTroubleWeights(ayahMistakes) {
  const weights = new Map();
  for (const m of ayahMistakes) {
    const offset = SURAH_OFFSETS[m.surah];
    if (!offset || (m.type && m.type.includes('A'))) continue; // skip Needs Attention
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

// ── Quran API helpers ─────────────────────────────────────────────────────────
const QURAN_API = 'https://api.alquran.cloud/v1';

async function fetchJson(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Quran API error ${resp.status}`);
  return resp.json();
}

async function getAyahPage(surah, ayah) {
  const data = await fetchJson(`${QURAN_API}/ayah/${surah}:${ayah}`);
  return data.data.page;
}

async function getPageFirstAyah(page) {
  if (page < 1 || page > 604) return null;
  const data = await fetchJson(`${QURAN_API}/page/${page}/quran-uthmani`);
  const ayahs = data.data?.ayahs;
  return (ayahs && ayahs.length > 0) ? ayahs[0] : null;
}

// ── Format bot response ───────────────────────────────────────────────────────
function surahLabel(num) {
  const s = SURAHS[num - 1];
  return s ? `${s[1]} — ${s[2]}` : `Surah ${num}`;
}

function formatReviseMessage(pageNum, startAyah, endAyah) {
  const startRef = `${startAyah.surah.number}:${startAyah.numberInSurah}`;
  const lines = [
    `📖 *Page ${pageNum}*`,
    ``,
    `*Start — ${startRef}*`,
    `${surahLabel(startAyah.surah.number)}`,
    ``,
    startAyah.text,
  ];

  if (endAyah) {
    const endRef = `${endAyah.surah.number}:${endAyah.numberInSurah}`;
    lines.push(``, `*Recite until — ${endRef}*`, `${surahLabel(endAyah.surah.number)}`, ``, endAyah.text);
  } else {
    lines.push(``, `*(End of Quran)*`);
  }

  return lines.join('\n');
}

// ── Core: pick and return a random revision ayah ──────────────────────────────
async function pickRevisionAyah(accountName) {
  const { memorizedHizbs, ayahMistakes, mutashabihatPairs } = await loadAccountData(accountName);

  if (!memorizedHizbs.length) {
    throw new Error('No hizbs marked as memorized. Mark them in the Tracker tab of the app first.');
  }

  const pool = [];
  for (const hizb of memorizedHizbs) {
    const range = hizbRange(hizb);
    if (!range) continue;
    for (let g = range[0]; g <= range[1]; g++) pool.push(g);
  }

  const troubleWeights  = computeTroubleWeights(ayahMistakes);
  const mutashabihatSet = computeMutashabihatSet(mutashabihatPairs);
  const pickedG         = pickGlobalAyahFromPool(pool, troubleWeights, mutashabihatSet);
  const { surah, ayah } = globalToSurahAyah(pickedG);

  // Find the page, then fetch start of that page and start of next page in parallel.
  const pageNum = await getAyahPage(surah, ayah);
  const [startAyah, endAyah] = await Promise.all([
    getPageFirstAyah(pageNum),
    getPageFirstAyah(pageNum + 1),
  ]);

  if (!startAyah) throw new Error('Could not fetch ayah data — try again.');
  return { pageNum, startAyah, endAyah };
}

// ── Bot commands ──────────────────────────────────────────────────────────────
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, [
    `السلام عليكم! 🕌`,
    ``,
    `*Quran Revision Bot*`,
    ``,
    `/link <accountname> — connect to your sync account`,
    `/revise — get a random page to revise`,
    `/status — show your linked account info`,
    ``,
    `Use the same account name as in the review app's sync sidebar.`,
  ].join('\n'), { parse_mode: 'Markdown' });
});

bot.onText(/\/link (.+)/, async (msg, match) => {
  const accountName = (match[1] || '').trim();
  if (!accountName) { bot.sendMessage(msg.chat.id, 'Usage: /link your-account-name'); return; }
  try {
    const { memorizedHizbs } = await loadAccountData(accountName);
    userAccounts.set(msg.from.id, accountName);
    bot.sendMessage(msg.chat.id,
      `✅ Linked to *${accountName}*\n${memorizedHizbs.length} memorized hizb${memorizedHizbs.length !== 1 ? 's' : ''} found.`,
      { parse_mode: 'Markdown' });
  } catch (e) {
    bot.sendMessage(msg.chat.id, `❌ ${e.message}`);
  }
});

bot.onText(/\/status/, async (msg) => {
  const accountName = userAccounts.get(msg.from.id);
  if (!accountName) { bot.sendMessage(msg.chat.id, 'No account linked. Use /link <accountname> first.'); return; }
  try {
    const { memorizedHizbs, ayahMistakes, mutashabihatPairs } = await loadAccountData(accountName);
    bot.sendMessage(msg.chat.id, [
      `📋 *Account:* ${accountName}`,
      `📚 Memorized hizbs: ${memorizedHizbs.length} (${memorizedHizbs.join(', ')})`,
      `⚠️ Logged mistakes: ${ayahMistakes.length}`,
      `🔀 Mutashabihat groups: ${mutashabihatPairs.length}`,
    ].join('\n'), { parse_mode: 'Markdown' });
  } catch (e) {
    bot.sendMessage(msg.chat.id, `❌ ${e.message}`);
  }
});

bot.onText(/\/revise/, async (msg) => {
  const accountName = userAccounts.get(msg.from.id);
  if (!accountName) { bot.sendMessage(msg.chat.id, 'Link your account first: /link <accountname>'); return; }

  const thinking = await bot.sendMessage(msg.chat.id, '⏳ Picking a page…');
  try {
    const { pageNum, startAyah, endAyah } = await pickRevisionAyah(accountName);
    await bot.deleteMessage(msg.chat.id, thinking.message_id).catch(() => {});
    await bot.sendMessage(msg.chat.id, formatReviseMessage(pageNum, startAyah, endAyah), { parse_mode: 'Markdown' });
  } catch (e) {
    await bot.deleteMessage(msg.chat.id, thinking.message_id).catch(() => {});
    bot.sendMessage(msg.chat.id, `❌ ${e.message}`);
  }
});

bot.on('message', (msg) => {
  if (msg.text && msg.text.startsWith('/') &&
      !['/start', '/link', '/revise', '/status'].some(c => msg.text.startsWith(c))) {
    bot.sendMessage(msg.chat.id, 'Unknown command. Try /revise, /status, or /link.');
  }
});

bot.on('polling_error', (err) => console.error('Polling error:', err.message));
