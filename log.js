// Shared JSON log format for every sub-webpage on this site (quran-tracker.html,
// review.html). All pages are same-origin, so any page can read or write any
// other page's localStorage data. A file built by buildFullLogData() has one
// optional top-level key per page ("tracker", "review") — a section can be
// edited, deleted entirely, or left out of a hand-edited file without
// disturbing the others.

const LOG_KEYS = {
  tracker: { memorized: 'quran_memorized' },
  review: {
    memorizedHizbs: 'quranReviewMemorizedHizbs',
    recitationLog: 'quranReviewHizbLog',
    ayahMistakes: 'quranReviewAyahMistakes',
  },
};

// Unambiguous, easy-to-hand-edit date format: "2026-08-02 15:04" (no locale
// dependence, so a value the user leaves untouched always re-parses cleanly).
function formatLogDate(d) {
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function readLocalJsonArray(key) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

// Reads every page's data straight out of localStorage (works from any page)
// into one hand-editable JSON structure.
function buildFullLogData() {
  const recitationLog = readLocalJsonArray(LOG_KEYS.review.recitationLog)
    .slice().sort((a, b) => new Date(a.date) - new Date(b.date))
    .map(e => ({ hizb: e.hizb, mistakes: e.mistakes, date: formatLogDate(new Date(e.date)) }));

  const ayahMistakes = readLocalJsonArray(LOG_KEYS.review.ayahMistakes)
    .slice().sort((a, b) => new Date(a.date) - new Date(b.date))
    .map(m => ({ surah: m.surah, ayah: m.ayah, hizb: m.hizb, date: formatLogDate(new Date(m.date)), note: m.note || '' }));

  return {
    _note: 'Edit this file directly, then re-import it — this REPLACES saved data for ' +
      'whichever section(s) are present ("tracker" and/or "review" can be edited or ' +
      'omitted independently). Delete an entry to remove it, copy one and edit it to ' +
      'add a new one. Date format: YYYY-MM-DD HH:MM.',
    exportedAt: formatLogDate(new Date()),
    tracker: {
      memorized: readLocalJsonArray(LOG_KEYS.tracker.memorized).map(Number).sort((a, b) => a - b),
    },
    review: {
      memorizedHizbs: readLocalJsonArray(LOG_KEYS.review.memorizedHizbs).map(Number).sort((a, b) => a - b),
      recitationLog,
      ayahMistakes,
    },
  };
}

// Accepts either the current { tracker, review } shape, or the older
// quran-tracker-only file (a bare array, or { memorized, savedAt }), so
// existing saved files still load.
function normalizeLogData(raw) {
  if (raw && (raw.tracker || raw.review)) return raw;
  const list = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.memorized) ? raw.memorized : null);
  return list ? { tracker: { memorized: list } } : null;
}

// Writes whichever section(s) are present straight to localStorage. This is
// the raw, page-agnostic path — used for a section that belongs to a page
// other than the one currently running the import (e.g. loading a combined
// file's "review" section while on quran-tracker.html). A page importing its
// own section should prefer its own setters instead, so side effects (like
// review.html's sync push) still run.
function applyFullLogData(data) {
  if (data && data.tracker && Array.isArray(data.tracker.memorized)) {
    localStorage.setItem(LOG_KEYS.tracker.memorized, JSON.stringify(data.tracker.memorized.map(Number)));
  }
  if (data && data.review) {
    if (Array.isArray(data.review.memorizedHizbs)) {
      const hizbs = data.review.memorizedHizbs.filter(h => Number.isInteger(h) && h >= 1 && h <= 60);
      localStorage.setItem(LOG_KEYS.review.memorizedHizbs, JSON.stringify(hizbs));
    }
    if (Array.isArray(data.review.recitationLog)) {
      const log = data.review.recitationLog
        .map(e => ({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          hizb: parseInt(e.hizb), mistakes: Math.max(0, parseInt(e.mistakes) || 0),
          date: new Date(e.date).toISOString(),
        }))
        .filter(e => Number.isInteger(e.hizb) && !isNaN(new Date(e.date).getTime()));
      localStorage.setItem(LOG_KEYS.review.recitationLog, JSON.stringify(log));
    }
    if (Array.isArray(data.review.ayahMistakes)) {
      const mistakes = data.review.ayahMistakes
        .map(m => ({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          surah: parseInt(m.surah), ayah: parseInt(m.ayah), hizb: parseInt(m.hizb),
          date: new Date(m.date).toISOString(), note: m.note || '',
        }))
        .filter(m => Number.isInteger(m.surah) && Number.isInteger(m.ayah) && Number.isInteger(m.hizb) && !isNaN(new Date(m.date).getTime()));
      localStorage.setItem(LOG_KEYS.review.ayahMistakes, JSON.stringify(mistakes));
    }
  }
}

function downloadJsonFile(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function exportFullLogAsJsonFile() {
  downloadJsonFile(buildFullLogData(), `quran-log-${new Date().toISOString().slice(0, 10)}.json`);
}

function readJsonFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try { resolve(JSON.parse(reader.result)); }
      catch (e) { reject(new Error('That file is not valid JSON.')); }
    };
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.readAsText(file);
  });
}
