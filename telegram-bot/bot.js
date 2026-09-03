'use strict';
require('dotenv').config();

const TelegramBot = require('node-telegram-bot-api');
const admin = require('firebase-admin');
const { SURAH_OFFSETS, HIZB_RANGES, SURAHS, globalToSurahAyah, hizbRange } = require('./quran-data');

// ── Firebase Admin init ───────────────────────────────────────────────────────
admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  projectId: process.env.FIREBASE_PROJECT_ID || 'quran-df0a2',
});
const db = admin.firestore();

// ── Bot init ──────────────────────────────────────────────────────────────────
const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) { console.error('BOT_TOKEN is not set in .env'); process.exit(1); }
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

console.log('Quran revision bot started.');

// ── In-memory user→account mapping (re-link with /link after bot restart) ────
const userAccounts = new Map(); // telegramUserId → accountName

// ── Firestore helpers ─────────────────────────────────────────────────────────
async function loadAccountData(accountName) {
  const doc = await db.collection('syncAccounts').doc(accountName).get();
  if (!doc.exists) throw new Error(`Account "${accountName}" not found. Make sure you have pushed data from the app first.`);
  const data = doc.data();
  return {
    memorizedHizbs: (data.review?.memorizedHizbs || []).map(Number).filter(h => h >= 1 && h <= 60),
    ayahMistakes: data.review?.ayahMistakes || [],
    mutashabihatPairs: data.review?.mutashabihatPairs || [],
  };
}

// ── Picking logic (mirrors review.html's pickGlobalAyahFromPool) ──────────────
const MISTAKE_WEIGHT_BOOST = 8;

function computeTroubleWeights(ayahMistakes) {
  const weights = new Map();
  for (const m of ayahMistakes) {
    const offset = SURAH_OFFSETS[m.surah];
    if (!offset || m.type === 'A') continue; // skip type A (Needs Attention, not a real mistake)
    const g = offset + m.ayah - 1;
    weights.set(g, (weights.get(g) || 0) + 1);
  }
  return weights;
}

function computeMutashabihatSet(mutashabihatPairs) {
  const s = new Set();
  for (const g of mutashabihatPairs) {
    const all = [g.anchor, ...(g.confusables || [])];
    for (const a of all) {
      if (a && SURAH_OFFSETS[a.surah]) s.add(SURAH_OFFSETS[a.surah] + a.ayah - 1);
    }
  }
  return s;
}

// mistakePct + mutashabihatPct should sum to ≤ 100 (remainder = random)
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
  if (!resp.ok) throw new Error(`API error ${resp.status}: ${url}`);
  return resp.json();
}

// Returns the mushaf page number for a given surah:ayah.
async function getAyahPage(surah, ayah) {
  const data = await fetchJson(`${QURAN_API}/ayah/${surah}:${ayah}`);
  return data.data.page;
}

// Returns the first ayah on the given page (Arabic text + surah + numberInSurah).
// Returns null if page is out of range (>604).
async function getPageFirstAyah(page) {
  if (page < 1 || page > 604) return null;
  const data = await fetchJson(`${QURAN_API}/page/${page}/quran-uthmani`);
  const ayahs = data.data?.ayahs;
  if (!ayahs || ayahs.length === 0) return null;
  return ayahs[0]; // { text, surah: { number, englishName, name }, numberInSurah, page }
}

// ── Format the bot's response ──────────────────────────────────────────────────
function surahLabel(surahNum) {
  const s = SURAHS[surahNum - 1];
  return s ? `${s[1]} (${s[2]})` : `Surah ${surahNum}`;
}

function formatReviseMessage(pageNum, startAyah, endAyah) {
  const startRef = `${startAyah.surah.number}:${startAyah.numberInSurah}`;
  const endRef   = endAyah ? `${endAyah.surah.number}:${endAyah.numberInSurah}` : null;

  const lines = [
    `📖 *Page ${pageNum}*`,
    ``,
    `*Start at:* ${startRef} — ${surahLabel(startAyah.surah.number)}`,
    `\`\`\``,
    startAyah.text,
    `\`\`\``,
  ];

  if (endAyah) {
    lines.push(
      ``,
      `*Recite until:* ${endRef} — ${surahLabel(endAyah.surah.number)}`,
      `\`\`\``,
      endAyah.text,
      `\`\`\``,
    );
  } else {
    lines.push(``, `*(End of Quran)*`);
  }

  return lines.join('\n');
}

// ── Core: pick and return a random ayah ───────────────────────────────────────
async function pickRevisionAyah(accountName) {
  const { memorizedHizbs, ayahMistakes, mutashabihatPairs } = await loadAccountData(accountName);

  if (memorizedHizbs.length === 0) {
    throw new Error('No hizbs marked as memorized in this account. Mark them in the Tracker tab first.');
  }

  // Build pool of global ayah indices from all memorized hizbs
  const pool = [];
  for (const hizb of memorizedHizbs) {
    const range = hizbRange(hizb);
    if (!range) continue;
    const [hStart, hEnd] = range;
    for (let g = hStart; g <= hEnd; g++) pool.push(g);
  }

  const troubleWeights  = computeTroubleWeights(ayahMistakes);
  const mutashabihatSet = computeMutashabihatSet(mutashabihatPairs);

  // Pick a global ayah using the same bucket logic as the app (25/25/50 default)
  const pickedG = pickGlobalAyahFromPool(pool, troubleWeights, mutashabihatSet);
  const { surah, ayah } = globalToSurahAyah(pickedG);

  // Find the mushaf page this ayah is on, then fetch first ayah of that page
  // and first ayah of the next page (the "recite until" landmark).
  const pageNum = await getAyahPage(surah, ayah);
  const [startAyah, endAyah] = await Promise.all([
    getPageFirstAyah(pageNum),
    getPageFirstAyah(pageNum + 1),
  ]);

  if (!startAyah) throw new Error('Could not fetch ayah data from the Quran API. Try again.');

  return { pageNum, startAyah, endAyah };
}

// ── Bot commands ──────────────────────────────────────────────────────────────
bot.onText(/\/start/, (msg) => {
  const name = msg.from.first_name || 'there';
  bot.sendMessage(msg.chat.id, [
    `السلام عليكم ${name}! 🕌`,
    ``,
    `*Quran Revision Bot*`,
    ``,
    `Commands:`,
    `/link <accountname> — link your sync account`,
    `/revise — get a random page to revise`,
    `/status — show your linked account and memorized hizbs`,
    ``,
    `Your account name is the one you use in the review app's sync sidebar.`,
  ].join('\n'), { parse_mode: 'Markdown' });
});

bot.onText(/\/link (.+)/, async (msg, match) => {
  const accountName = (match[1] || '').trim();
  if (!accountName) {
    bot.sendMessage(msg.chat.id, 'Usage: /link your-account-name');
    return;
  }
  try {
    const { memorizedHizbs } = await loadAccountData(accountName);
    userAccounts.set(msg.from.id, accountName);
    bot.sendMessage(msg.chat.id,
      `✅ Linked to account *${accountName}*\n${memorizedHizbs.length} memorized hizb${memorizedHizbs.length !== 1 ? 's' : ''} found.`,
      { parse_mode: 'Markdown' }
    );
  } catch (e) {
    bot.sendMessage(msg.chat.id, `❌ ${e.message}`);
  }
});

bot.onText(/\/status/, async (msg) => {
  const accountName = userAccounts.get(msg.from.id);
  if (!accountName) {
    bot.sendMessage(msg.chat.id, 'No account linked yet. Use /link <accountname> first.');
    return;
  }
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
  if (!accountName) {
    bot.sendMessage(msg.chat.id, 'Link your account first: /link <accountname>');
    return;
  }

  const thinking = await bot.sendMessage(msg.chat.id, '⏳ Picking a page…');

  try {
    const { pageNum, startAyah, endAyah } = await pickRevisionAyah(accountName);
    await bot.deleteMessage(msg.chat.id, thinking.message_id).catch(() => {});
    await bot.sendMessage(
      msg.chat.id,
      formatReviseMessage(pageNum, startAyah, endAyah),
      { parse_mode: 'Markdown' }
    );
  } catch (e) {
    await bot.deleteMessage(msg.chat.id, thinking.message_id).catch(() => {});
    bot.sendMessage(msg.chat.id, `❌ ${e.message}`);
  }
});

// Handle unknown commands
bot.on('message', (msg) => {
  if (msg.text && msg.text.startsWith('/') &&
      !['/start', '/link', '/revise', '/status'].some(c => msg.text.startsWith(c))) {
    bot.sendMessage(msg.chat.id, 'Unknown command. Try /revise or /status.');
  }
});

bot.on('polling_error', (err) => {
  console.error('Polling error:', err.message);
});
