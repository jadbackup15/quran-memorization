// Shared JSON log format for every sub-webpage on this site (quran-tracker.html,
// review.html, habits.html). All pages are same-origin, so any page can read or
// write any other page's localStorage data. A file built by buildFullLogData()
// has one optional top-level key per page ("tracker", "review", "habits") — a
// section can be edited, deleted entirely, or left out of a hand-edited file
// without disturbing the others.

const LOG_KEYS = {
  tracker: { memorized: 'quran_memorized' },
  review: {
    memorizedHizbs: 'quranReviewMemorizedHizbs',
    recitationLog: 'quranReviewHizbLog',
    ayahMistakes: 'quranReviewAyahMistakes',
    mutashabihatPairs: 'quranReviewMutashabihatPairs',
  },
  habits: {
    activities: 'personalTrackerActivities',
    log: 'personalTrackerLog',
  },
};

/**
 * Formats a Date as "YYYY-MM-DD HH:MM" — unambiguous and easy to hand-edit
 * (no locale dependence, so a value the user leaves untouched always
 * re-parses cleanly via `new Date(str)`).
 * @param {Date} d
 * @returns {string}
 */
function formatLogDate(d) {
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Reads and JSON-parses a localStorage key, tolerating missing keys and
 * corrupt values.
 * @param {string} key
 * @returns {Array} The parsed array, or `[]` if missing/invalid/not an array.
 */
function readLocalJsonArray(key) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

// Accepts either the current { ayat: [...] } shape (2 or more ayat) or the
// older two-ayah-only { surahA, ayahA, surahB, ayahB } shape from before a
// mutashabihat group could hold more than a pair, so entries saved before
// that existed still load correctly.
function normalizeMutashabihatAyat(entry) {
  return Array.isArray(entry.ayat)
    ? entry.ayat
    : [{ surah: entry.surahA, ayah: entry.ayahA }, { surah: entry.surahB, ayah: entry.ayahB }];
}

/**
 * Reads every page's data straight out of localStorage (works from any page,
 * since they're same-origin) into one hand-editable JSON structure — see the
 * file header for the shape. Call this to build the object you'll download
 * (via {@link exportFullLogAsJsonFile}) or otherwise hand off as a backup.
 * @returns {object} `{ _note, exportedAt, tracker, review, habits }`
 */
function buildFullLogData() {
  const recitationLog = readLocalJsonArray(LOG_KEYS.review.recitationLog)
    .slice().sort((a, b) => new Date(a.date) - new Date(b.date))
    .map(e => ({ hizb: e.hizb, mistakes: e.mistakes, date: formatLogDate(new Date(e.date)) }));

  const ayahMistakes = readLocalJsonArray(LOG_KEYS.review.ayahMistakes)
    .slice().sort((a, b) => new Date(a.date) - new Date(b.date))
    .map(m => ({ surah: m.surah, ayah: m.ayah, hizb: m.hizb, date: formatLogDate(new Date(m.date)), note: m.note || '' }));

  const mutashabihatPairs = readLocalJsonArray(LOG_KEYS.review.mutashabihatPairs)
    .slice().sort((a, b) => new Date(a.dateAdded) - new Date(b.dateAdded))
    .map(p => ({
      ayat: normalizeMutashabihatAyat(p).map(a => ({ surah: a.surah, ayah: a.ayah })),
      note: p.note || '', dateAdded: formatLogDate(new Date(p.dateAdded)),
    }));

  // Habits log entries reference their activity by NAME rather than internal
  // id, matching the rest of this file's hand-editable style (e.g. review's
  // recitation log references a Hizb number, not an id).
  const activities = readLocalJsonArray(LOG_KEYS.habits.activities);
  const activityNameById = new Map(activities.map(a => [a.id, a.name]));
  const habitLog = readLocalJsonArray(LOG_KEYS.habits.log)
    .slice().sort((a, b) => new Date(a.date) - new Date(b.date))
    .map(e => ({ activity: activityNameById.get(e.activityId) || '(deleted activity)', date: formatLogDate(new Date(e.date)) }));

  return {
    _note: 'Edit this file directly, then re-import it — this REPLACES saved data for ' +
      'whichever section(s) are present ("tracker", "review", and/or "habits" can be ' +
      'edited or omitted independently). Delete an entry to remove it, copy one and edit ' +
      'it to add a new one. Date format: YYYY-MM-DD HH:MM.',
    exportedAt: formatLogDate(new Date()),
    tracker: {
      memorized: readLocalJsonArray(LOG_KEYS.tracker.memorized).map(Number).sort((a, b) => a - b),
    },
    review: {
      memorizedHizbs: readLocalJsonArray(LOG_KEYS.review.memorizedHizbs).map(Number).sort((a, b) => a - b),
      recitationLog,
      ayahMistakes,
      mutashabihatPairs,
    },
    habits: {
      activities: activities.map(a => ({ name: a.name, targetCount: a.targetCount, targetUnit: a.targetUnit })),
      log: habitLog,
    },
  };
}

/**
 * Normalizes a parsed import file to the current `{ tracker, review, habits }`
 * shape, accepting the older quran-tracker-only format too (a bare array of
 * surah numbers, or `{ memorized, savedAt }`) so existing saved files still
 * load. Call this on whatever `JSON.parse()` gave you before passing it to
 * {@link applyFullLogData}.
 * @param {*} raw - Parsed JSON of unknown/either shape.
 * @returns {object|null} The normalized `{ tracker?, review?, habits? }`
 *   object, or `null` if `raw` doesn't match any recognized shape.
 */
function normalizeLogData(raw) {
  if (raw && (raw.tracker || raw.review || raw.habits)) return raw;
  const list = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.memorized) ? raw.memorized : null);
  return list ? { tracker: { memorized: list } } : null;
}

/**
 * Writes whichever top-level section(s) are present in `data` straight to
 * localStorage, validating/coercing each field and regenerating ids. This is
 * the raw, page-agnostic path — used for a section that belongs to a page
 * other than the one currently running the import (e.g. loading a combined
 * file's "review" section while on quran-tracker.html). A page importing its
 * *own* section should prefer its own setters instead, so side effects (like
 * review.html's sync push) still run — see `importLogData()` in review.html.
 * @param {object} data - Typically the output of {@link normalizeLogData}.
 * @returns {void}
 */
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
        .map(e => {
          const d = new Date(e.date); // NaN-guarded below — toISOString() throws on an invalid date
          return {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            hizb: parseInt(e.hizb), mistakes: Math.max(0, parseInt(e.mistakes) || 0),
            date: isNaN(d.getTime()) ? null : d.toISOString(),
          };
        })
        .filter(e => Number.isInteger(e.hizb) && e.date !== null);
      localStorage.setItem(LOG_KEYS.review.recitationLog, JSON.stringify(log));
    }
    if (Array.isArray(data.review.ayahMistakes)) {
      const mistakes = data.review.ayahMistakes
        .map(m => {
          const d = new Date(m.date); // NaN-guarded below — toISOString() throws on an invalid date
          return {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            surah: parseInt(m.surah), ayah: parseInt(m.ayah), hizb: parseInt(m.hizb),
            date: isNaN(d.getTime()) ? null : d.toISOString(), note: m.note || '',
          };
        })
        .filter(m => Number.isInteger(m.surah) && Number.isInteger(m.ayah) && Number.isInteger(m.hizb) && m.date !== null);
      localStorage.setItem(LOG_KEYS.review.ayahMistakes, JSON.stringify(mistakes));
    }
    if (Array.isArray(data.review.mutashabihatPairs)) {
      const pairs = data.review.mutashabihatPairs
        .map(p => {
          const d = new Date(p.dateAdded); // NaN-guarded below — toISOString() throws on an invalid date
          const ayat = normalizeMutashabihatAyat(p)
            .map(a => ({ surah: parseInt(a.surah), ayah: parseInt(a.ayah) }))
            .filter(a => Number.isInteger(a.surah) && Number.isInteger(a.ayah));
          return {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            ayat,
            note: p.note || '',
            dateAdded: isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString(),
          };
        })
        .filter(p => p.ayat.length >= 2);
      localStorage.setItem(LOG_KEYS.review.mutashabihatPairs, JSON.stringify(pairs));
    }
  }
  if (data && data.habits) {
    const activities = Array.isArray(data.habits.activities)
      ? data.habits.activities
          .map(a => ({
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            name: String(a.name || '').trim(),
            targetCount: parseInt(a.targetCount),
            targetUnit: ['day', 'week', 'month'].includes(a.targetUnit) ? a.targetUnit : 'week',
          }))
          .filter(a => a.name && Number.isInteger(a.targetCount) && a.targetCount >= 1)
      : [];
    // Log entries reference their activity by name (see buildFullLogData); look
    // that back up against the freshly-generated ids above.
    const idByName = new Map(activities.map(a => [a.name, a.id]));
    const log = Array.isArray(data.habits.log)
      ? data.habits.log
          .map(e => {
            const d = new Date(e.date); // NaN-guarded below — toISOString() throws on an invalid date
            return {
              id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              activityId: idByName.get(e.activity),
              date: isNaN(d.getTime()) ? null : d.toISOString(),
            };
          })
          .filter(e => e.activityId && e.date !== null)
      : [];
    localStorage.setItem(LOG_KEYS.habits.activities, JSON.stringify(activities));
    localStorage.setItem(LOG_KEYS.habits.log, JSON.stringify(log));
  }
}

// Internal helper for exportFullLogAsJsonFile() — triggers a browser download
// of `data` as pretty-printed JSON.
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

/**
 * Builds the full site log via {@link buildFullLogData} and downloads it as
 * `quran-log-YYYY-MM-DD.json`. Wire this up to a page's "Save"/"Export"
 * button — no arguments needed, everything comes from localStorage.
 * @returns {void}
 */
function exportFullLogAsJsonFile() {
  downloadJsonFile(buildFullLogData(), `quran-log-${new Date().toISOString().slice(0, 10)}.json`);
}

/**
 * Reads a `File` (e.g. from a file `<input>`'s `change` event) and resolves
 * with its parsed JSON. Pair with {@link normalizeLogData} and
 * {@link applyFullLogData} to implement an "Import" button.
 * @param {File} file
 * @returns {Promise<object>} Resolves with the parsed JSON; rejects with an
 *   `Error` (unreadable file, or invalid JSON) suitable for showing directly
 *   to the user.
 */
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
