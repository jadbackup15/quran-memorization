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
    // Legacy-only, read via a one-time migration (review.html's
    // migrateLegacyPagesNeedingReview) into practiceRanges' own page-kind
    // entries — nothing writes this key anymore. Kept here (rather than
    // deleted outright) purely so that migration and this file's own
    // legacy-shape handling in applyFullLogData still have a name for it.
    pagesNeedingReview: 'quranReviewPagesNeedingReview',
    practiceRanges: 'quranReviewPracticeRanges',
    telegramLastImportedAt: 'quranReviewTelegramLastImportedAt',
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

  // `type` (S/B/W/M/T/A — see mistake-analytics.js's MISTAKE_TYPE_META) and
  // `source` (how the mistake was logged — 'live' tap, 'paste' import, or a
  // future 'telegram' import) are passed through as plain strings rather
  // than validated/canonicalized here, since this file is also loaded by
  // quran-tracker.html and habits.html, neither of which loads
  // mistake-analytics.js — the page that actually renders a mistake already
  // tolerates/filters an unrecognized type code gracefully.
  const ayahMistakes = readLocalJsonArray(LOG_KEYS.review.ayahMistakes)
    .slice().sort((a, b) => new Date(a.date) - new Date(b.date))
    .map(m => ({
      surah: m.surah, ayah: m.ayah, hizb: m.hizb, date: formatLogDate(new Date(m.date)),
      note: m.note || '', type: m.type || null, source: m.source || null,
      telegramMessageId: m.telegramMessageId || null,
    }));

  const mutashabihatPairs = readLocalJsonArray(LOG_KEYS.review.mutashabihatPairs)
    .slice().sort((a, b) => new Date(a.dateAdded) - new Date(b.dateAdded))
    .map(p => ({
      ayat: normalizeMutashabihatAyat(p).map(a => ({ surah: a.surah, ayah: a.ayah })),
      note: p.note || '', dateAdded: formatLogDate(new Date(p.dateAdded)),
    }));

  // practiceRanges holds BOTH ayah-range goals (kind: 'range') and whole-
  // page goals (kind: 'page') — the old, standalone "pagesNeedingReview"
  // field is never written here anymore (see LOG_KEYS.review.pagesNeedingReview's
  // own comment); applyFullLogData still ACCEPTS it on read, for a file
  // exported before this merge.
  const practiceRanges = readLocalJsonArray(LOG_KEYS.review.practiceRanges)
    .slice().sort((a, b) => new Date(a.dateAdded) - new Date(b.dateAdded))
    .map(r => {
      const common = {
        target: r.target, practiced: r.practiced || 0, note: r.note || '',
        dateAdded: formatLogDate(new Date(r.dateAdded)), source: r.source || null,
        telegramMessageId: r.telegramMessageId || null,
      };
      return r.kind === 'page'
        ? { kind: 'page', page: r.page, ...common }
        : { kind: 'range', surah: r.surah, ayahStart: r.ayahStart, ayahEnd: r.ayahEnd, ...common };
    });

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
      'it to add a new one. Date format: YYYY-MM-DD HH:MM. Each review.ayahMistakes entry\'s ' +
      '"type" is one of S/B/W/M/T/E/K/A (or null); "source" says how it was logged — "live" ' +
      '(tapped during a Recitation Session), "paste" (the bulk paste-import box), or ' +
      '"telegram" (imported from a Telegram channel) — and can be left out or set to null ' +
      'for an entry logged before this field existed. "telegramMessageId" (source: ' +
      '"telegram" only) is which channel message it came from — kept so re-running ' +
      'Import from Telegram after loading this file still knows what\'s already logged. ' +
      'review.practiceRanges is a self-set practice goal (not necessarily mistakes) with a ' +
      'target repeat count and how many times you\'ve practiced it so far — either an ayah ' +
      'range ("kind": "range", with "surah"/"ayahStart"/"ayahEnd", e.g. from a "r15-23x20" ' +
      'line) or a whole mushaf page ("kind": "page", with "page", 1-604, e.g. from a "p15" ' +
      'or "p15x20" line) in a paste/Telegram import. review.telegramLastImportedAt is when ' +
      'the Import from Telegram button last ran (null if never) — purely informational, ' +
      'safe to leave out.',
    exportedAt: formatLogDate(new Date()),
    tracker: {
      memorized: readLocalJsonArray(LOG_KEYS.tracker.memorized).map(Number).sort((a, b) => a - b),
    },
    review: {
      memorizedHizbs: readLocalJsonArray(LOG_KEYS.review.memorizedHizbs).map(Number).sort((a, b) => a - b),
      recitationLog,
      ayahMistakes,
      mutashabihatPairs,
      practiceRanges,
      // The "Last imported ..." label next to review.html's Import from
      // Telegram button — also synced via Firebase (buildSyncPayload), so
      // included here too for the same reason: a JSON export/re-import
      // shouldn't silently lose state that cross-device sync already
      // treats as real user data. null when Import from Telegram has never
      // run on this device.
      telegramLastImportedAt: (() => {
        const iso = localStorage.getItem(LOG_KEYS.review.telegramLastImportedAt);
        return iso ? formatLogDate(new Date(iso)) : null;
      })(),
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
            // Passed through as plain strings, not validated against
            // MISTAKE_TYPE_META — see buildFullLogData()'s comment on why
            // this file can't depend on mistake-analytics.js.
            type: m.type || null, source: m.source || null,
            // Which Telegram message this mistake came from, if any — kept
            // through a re-import so review.html's existence-based Telegram
            // dedup (telegramAyahMistakeExists) still works afterward
            // instead of re-importing everything as if from scratch.
            telegramMessageId: m.telegramMessageId || null,
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
        // A group needs at least one ayah (matches review.html's
        // MUTASHABIHAT_MIN_AYAT — a group can start with just one ayah and
        // grow later via edit, not a fixed pair).
        .filter(p => p.ayat.length >= 1);
      localStorage.setItem(LOG_KEYS.review.mutashabihatPairs, JSON.stringify(pairs));
    }
    // practiceRanges holds both ayah-range ("kind": "range") and whole-page
    // ("kind": "page") goals — see LOG_KEYS.review.pagesNeedingReview's own
    // comment. A file exported before that merge still has its pages under
    // the old, separate "pagesNeedingReview" field instead — migrated into
    // page-kind practiceRanges entries here (5 — matching review.html's own
    // PAGE_PRACTICE_DEFAULT_TARGET, duplicated rather than imported since
    // this file is also loaded by pages that don't load review.html's own
    // script — is the default target a bare page flag never carried).
    const migratedPageEntries = Array.isArray(data.review.pagesNeedingReview)
      ? data.review.pagesNeedingReview
          .map(p => {
            const d = new Date(p.date); // NaN-guarded below — toISOString() throws on an invalid date
            return {
              id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              kind: 'page', page: parseInt(p.page), target: 5, practiced: 0,
              note: p.note || '',
              dateAdded: isNaN(d.getTime()) ? null : d.toISOString(),
              source: p.source || null, telegramMessageId: null,
            };
          })
          .filter(p => Number.isInteger(p.page) && p.page >= 1 && p.page <= 604 && p.dateAdded !== null)
      : [];
    if (Array.isArray(data.review.practiceRanges) || migratedPageEntries.length > 0) {
      const parsedRanges = (data.review.practiceRanges || [])
        .map(r => {
          const d = new Date(r.dateAdded); // NaN-guarded below — toISOString() throws on an invalid date
          const common = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            target: parseInt(r.target), practiced: Math.max(0, parseInt(r.practiced) || 0),
            note: r.note || '',
            dateAdded: isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString(),
            source: r.source || null, telegramMessageId: r.telegramMessageId || null,
          };
          // "kind" may be missing on a file exported before whole-page
          // goals existed at all — every entry was necessarily a range
          // back then, so default to that rather than dropping it.
          return r.kind === 'page'
            ? { ...common, kind: 'page', page: parseInt(r.page) }
            : { ...common, kind: 'range', surah: parseInt(r.surah), ayahStart: parseInt(r.ayahStart), ayahEnd: parseInt(r.ayahEnd) };
        })
        .filter(r => r.kind === 'page'
          ? Number.isInteger(r.page) && r.page >= 1 && r.page <= 604 && Number.isInteger(r.target) && r.target >= 1
          : Number.isInteger(r.surah) && Number.isInteger(r.ayahStart) && Number.isInteger(r.ayahEnd) &&
            r.ayahStart <= r.ayahEnd && Number.isInteger(r.target) && r.target >= 1);
      localStorage.setItem(LOG_KEYS.review.practiceRanges, JSON.stringify(parsedRanges.concat(migratedPageEntries)));
    }
    if (data.review.telegramLastImportedAt) {
      const d = new Date(data.review.telegramLastImportedAt); // NaN-guarded below — toISOString() throws on an invalid date
      if (!isNaN(d.getTime())) {
        localStorage.setItem(LOG_KEYS.review.telegramLastImportedAt, d.toISOString());
      }
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
