'use strict';

const { test, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { loadPage } = require('./helpers/loadPage.js');

// Objects/arrays returned directly from jsdom-realm functions have a
// different Array/Object prototype than Node's own realm, which trips up
// assert.deepEqual's structural check even when the data matches. Round-trip
// through JSON to normalize before comparing.
const toPlain = (value) => JSON.parse(JSON.stringify(value));

// log.js is shared by every page; loading it via review.html exercises the
// real file as actually shipped (not a re-typed copy). Every test here only
// exercises pure functions (formatLogDate/buildFullLogData/normalizeLogData/
// applyFullLogData) that read/write localStorage and nothing else — so one
// page load shared across the whole file (like review-helpers.test.js does)
// is safe, and far cheaper than reparsing+re-executing review.html's full
// inline script (a few dozen ms of real work) before every single test.
let window;
before(() => {
  window = loadPage('review.html').window;
});
beforeEach(() => {
  window.localStorage.clear();
});

test('formatLogDate produces "YYYY-MM-DD HH:MM"', () => {
  const d = new Date(2026, 7, 3, 9, 5); // months are 0-based: Aug 3, 2026, 09:05
  assert.equal(window.formatLogDate(d), '2026-08-03 09:05');
});

test('buildFullLogData reflects current localStorage across all three sections', () => {
  window.localStorage.setItem('quran_memorized', JSON.stringify([3, 1, 2]));
  window.localStorage.setItem('quranReviewMemorizedHizbs', JSON.stringify([5, 4]));
  window.localStorage.setItem('quranReviewHizbLog', JSON.stringify([
    { id: 'a', hizb: 2, mistakes: 3, date: '2026-08-01T10:00:00.000Z' },
  ]));
  window.localStorage.setItem('personalTrackerActivities', JSON.stringify([
    { id: 'act1', name: 'Workout', targetCount: 2, targetUnit: 'week' },
  ]));
  window.localStorage.setItem('personalTrackerLog', JSON.stringify([
    { id: 'log1', activityId: 'act1', date: '2026-08-02T08:00:00.000Z' },
  ]));

  const data = window.buildFullLogData();

  assert.deepEqual(toPlain(data.tracker.memorized), [1, 2, 3], 'sorted ascending');
  assert.deepEqual(toPlain(data.review.memorizedHizbs), [4, 5], 'sorted ascending');
  assert.equal(data.review.recitationLog.length, 1);
  assert.equal(data.review.recitationLog[0].hizb, 2);
  assert.equal(data.habits.activities.length, 1);
  assert.equal(data.habits.activities[0].name, 'Workout');
  assert.equal(data.habits.log[0].activity, 'Workout', 'log entries reference activity by name, not id');
});

test('buildFullLogData labels an orphaned habit log entry as deleted', () => {
  window.localStorage.setItem('personalTrackerActivities', JSON.stringify([]));
  window.localStorage.setItem('personalTrackerLog', JSON.stringify([
    { id: 'log1', activityId: 'gone', date: '2026-08-02T08:00:00.000Z' },
  ]));
  const data = window.buildFullLogData();
  assert.equal(data.habits.log[0].activity, '(deleted activity)');
});

test('normalizeLogData passes through the current shape unchanged', () => {
  const shape = { tracker: { memorized: [1] } };
  assert.equal(window.normalizeLogData(shape), shape);
});

test('normalizeLogData upgrades a legacy bare array', () => {
  assert.deepEqual(toPlain(window.normalizeLogData([5, 6, 7])), { tracker: { memorized: [5, 6, 7] } });
});

test('normalizeLogData upgrades a legacy { memorized, savedAt } object', () => {
  assert.deepEqual(
    toPlain(window.normalizeLogData({ memorized: [9], savedAt: '2026-01-01' })),
    { tracker: { memorized: [9] } }
  );
});

test('normalizeLogData rejects unrecognized shapes', () => {
  assert.equal(window.normalizeLogData({ foo: 'bar' }), null);
  assert.equal(window.normalizeLogData(null), null);
});

test('applyFullLogData writes the tracker section raw', () => {
  window.applyFullLogData({ tracker: { memorized: [3, 1, '2'] } });
  const stored = JSON.parse(window.localStorage.getItem('quran_memorized'));
  assert.deepEqual(stored, [3, 1, 2], 'coerced to numbers, not re-sorted (raw write)');
});

test('applyFullLogData filters out-of-range Hizb numbers', () => {
  window.applyFullLogData({ review: { memorizedHizbs: [1, 60, 61, 0, -5] } });
  const stored = JSON.parse(window.localStorage.getItem('quranReviewMemorizedHizbs'));
  assert.deepEqual(stored, [1, 60]);
});

test('buildFullLogData includes mutashabihatPairs as an ayat array (2 or more ayat)', () => {
  window.localStorage.setItem('quranReviewMutashabihatPairs', JSON.stringify([
    { id: 'p1', ayat: [{ surah: 2, ayah: 1 }, { surah: 3, ayah: 5 }, { surah: 4, ayah: 9 }], note: 'all open the same way', dateAdded: '2026-08-01T10:00:00.000Z' },
  ]));
  const data = window.buildFullLogData();
  assert.equal(data.review.mutashabihatPairs.length, 1);
  assert.deepEqual(toPlain(data.review.mutashabihatPairs[0].ayat), [{ surah: 2, ayah: 1 }, { surah: 3, ayah: 5 }, { surah: 4, ayah: 9 }]);
  assert.equal(data.review.mutashabihatPairs[0].note, 'all open the same way');
});

test('buildFullLogData upgrades a legacy two-ayah { surahA, ayahA, surahB, ayahB } entry to the ayat-array shape', () => {
  window.localStorage.setItem('quranReviewMutashabihatPairs', JSON.stringify([
    { id: 'old1', surahA: 2, ayahA: 1, surahB: 3, ayahB: 5, note: '', dateAdded: '2026-08-01T10:00:00.000Z' },
  ]));
  const data = window.buildFullLogData();
  assert.deepEqual(toPlain(data.review.mutashabihatPairs[0].ayat), [{ surah: 2, ayah: 1 }, { surah: 3, ayah: 5 }]);
});

test('applyFullLogData keeps a valid mutashabihat entry, generates an id, and normalizes a missing/invalid date', () => {
  window.applyFullLogData({
    review: {
      mutashabihatPairs: [
        { ayat: [{ surah: 2, ayah: 1 }, { surah: 3, ayah: 5 }], note: 'ok', dateAdded: '2026-08-01 10:00' },
      ],
    },
  });
  const stored = JSON.parse(window.localStorage.getItem('quranReviewMutashabihatPairs'));
  assert.equal(stored.length, 1);
  assert.deepEqual(stored[0].ayat, [{ surah: 2, ayah: 1 }, { surah: 3, ayah: 5 }]);
  assert.equal(stored[0].note, 'ok');
  assert.ok(stored[0].id, 'gets a freshly generated id');
});

test('applyFullLogData drops just the one malformed ayah within a group of 3+, keeping the group if 2+ remain', () => {
  window.applyFullLogData({
    review: {
      mutashabihatPairs: [
        { ayat: [{ surah: 2, ayah: 1 }, { surah: 'x', ayah: 1 }, { surah: 3, ayah: 5 }] },
      ],
    },
  });
  const stored = JSON.parse(window.localStorage.getItem('quranReviewMutashabihatPairs'));
  assert.equal(stored.length, 1, 'the group survives with its 2 remaining valid ayat');
  assert.deepEqual(stored[0].ayat, [{ surah: 2, ayah: 1 }, { surah: 3, ayah: 5 }]);
});

test('applyFullLogData keeps a group with just 1 valid ayah remaining — a group can start with (or shrink to) a single ayah', () => {
  window.applyFullLogData({
    review: {
      mutashabihatPairs: [
        { ayat: [{ surah: 'x', ayah: 1 }, { surah: 3, ayah: 5 }] },
      ],
    },
  });
  const stored = JSON.parse(window.localStorage.getItem('quranReviewMutashabihatPairs'));
  assert.equal(stored.length, 1);
  assert.deepEqual(stored[0].ayat, [{ surah: 3, ayah: 5 }]);
});

test('applyFullLogData drops a group once zero valid ayat remain', () => {
  window.applyFullLogData({
    review: {
      mutashabihatPairs: [
        { ayat: [{ surah: 'x', ayah: 1 }, { surah: 'y', ayah: 2 }] },
      ],
    },
  });
  const stored = JSON.parse(window.localStorage.getItem('quranReviewMutashabihatPairs'));
  assert.equal(stored.length, 0, 'no valid ayat remained, so the group is dropped entirely');
});

test('applyFullLogData drops malformed recitation log entries', () => {
  window.applyFullLogData({
    review: {
      recitationLog: [
        { hizb: 3, mistakes: 2, date: '2026-08-01 10:00' },
        { hizb: 'not-a-number', mistakes: 1, date: '2026-08-01 10:00' },
        { hizb: 4, mistakes: 1, date: 'not-a-date' },
      ],
    },
  });
  const stored = JSON.parse(window.localStorage.getItem('quranReviewHizbLog'));
  assert.equal(stored.length, 1);
  assert.equal(stored[0].hizb, 3);
});

test('applyFullLogData re-links habit log entries to freshly generated activity ids by name', () => {
  window.applyFullLogData({
    habits: {
      activities: [{ name: 'Reading', targetCount: 1, targetUnit: 'day' }],
      log: [
        { activity: 'Reading', date: '2026-08-01 08:00' },
        { activity: 'Nonexistent Activity', date: '2026-08-01 08:00' },
      ],
    },
  });
  const activities = JSON.parse(window.localStorage.getItem('personalTrackerActivities'));
  const log = JSON.parse(window.localStorage.getItem('personalTrackerLog'));
  assert.equal(activities.length, 1);
  assert.equal(log.length, 1, 'the entry referencing a nonexistent activity is dropped');
  assert.equal(log[0].activityId, activities[0].id);
});

test('a round trip through buildFullLogData -> applyFullLogData preserves habit log linkage', () => {
  window.localStorage.setItem('personalTrackerActivities', JSON.stringify([
    { id: 'act1', name: 'Workout', targetCount: 2, targetUnit: 'week' },
  ]));
  window.localStorage.setItem('personalTrackerLog', JSON.stringify([
    { id: 'log1', activityId: 'act1', date: '2026-08-02T08:00:00.000Z' },
  ]));

  const exported = window.buildFullLogData();
  window.localStorage.clear();
  window.applyFullLogData(exported);

  const log = JSON.parse(window.localStorage.getItem('personalTrackerLog'));
  const activities = JSON.parse(window.localStorage.getItem('personalTrackerActivities'));
  assert.equal(log.length, 1);
  assert.equal(log[0].activityId, activities[0].id);
});

test('buildFullLogData includes each ayah mistake\'s type and source (previously silently dropped)', () => {
  window.localStorage.setItem('quranReviewAyahMistakes', JSON.stringify([
    { surah: 2, ayah: 5, hizb: 1, date: '2026-08-01T10:00:00.000Z', note: 'forgot ina', type: 'BS', source: 'live' },
    { surah: 3, ayah: 10, hizb: 5, date: '2026-08-02T10:00:00.000Z', note: '', type: null, source: null },
  ]));
  const data = window.buildFullLogData();
  assert.equal(data.review.ayahMistakes[0].type, 'BS');
  assert.equal(data.review.ayahMistakes[0].source, 'live');
  assert.equal(data.review.ayahMistakes[1].type, null, 'a missing type exports as null, not undefined or dropped');
  assert.equal(data.review.ayahMistakes[1].source, null);
});

test('a round trip through buildFullLogData -> applyFullLogData preserves each ayah mistake\'s type and source', () => {
  window.localStorage.setItem('quranReviewAyahMistakes', JSON.stringify([
    { surah: 2, ayah: 5, hizb: 1, date: '2026-08-01T10:00:00.000Z', note: 'forgot ina', type: 'BS', source: 'paste' },
  ]));

  const exported = window.buildFullLogData();
  window.localStorage.clear();
  window.applyFullLogData(exported);

  const mistakes = JSON.parse(window.localStorage.getItem('quranReviewAyahMistakes'));
  assert.equal(mistakes.length, 1);
  assert.equal(mistakes[0].type, 'BS');
  assert.equal(mistakes[0].source, 'paste');
});

test('applyFullLogData imports an ayah mistake\'s type/source even from a file that never had that field (defaults to null, not a crash)', () => {
  window.applyFullLogData({
    review: {
      ayahMistakes: [
        { surah: 2, ayah: 5, hizb: 1, date: '2026-08-01 10:00', note: 'no type field at all' },
      ],
    },
  });
  const mistakes = JSON.parse(window.localStorage.getItem('quranReviewAyahMistakes'));
  assert.equal(mistakes.length, 1);
  assert.equal(mistakes[0].type, null);
  assert.equal(mistakes[0].source, null);
});

test('a round trip through buildFullLogData -> applyFullLogData preserves a Telegram-sourced mistake\'s telegramMessageId, so re-running Import from Telegram after reloading a backup still knows what\'s already logged', () => {
  window.localStorage.setItem('quranReviewAyahMistakes', JSON.stringify([
    { surah: 2, ayah: 78, hizb: 1, date: '2026-08-14T19:24:28.000Z', note: '', type: 'B', source: 'telegram', telegramMessageId: 'tasmee315/4' },
    { surah: 2, ayah: 5, hizb: 1, date: '2026-08-01T10:00:00.000Z', note: '', type: null, source: 'live' },
  ]));

  const exported = window.buildFullLogData();
  assert.equal(exported.review.ayahMistakes.find(m => m.ayah === 78).telegramMessageId, 'tasmee315/4');
  assert.equal(exported.review.ayahMistakes.find(m => m.ayah === 5).telegramMessageId, null, 'a non-Telegram mistake exports as null, not undefined or dropped');

  window.localStorage.clear();
  window.applyFullLogData(exported);

  const mistakes = JSON.parse(window.localStorage.getItem('quranReviewAyahMistakes'));
  assert.equal(mistakes.find(m => m.ayah === 78).telegramMessageId, 'tasmee315/4');
  assert.equal(mistakes.find(m => m.ayah === 5).telegramMessageId, null);
});

test('buildFullLogData includes review.pagesNeedingReview, and a round trip through applyFullLogData preserves it while dropping an out-of-range page', () => {
  window.localStorage.setItem('quranReviewPagesNeedingReview', JSON.stringify([
    { page: 15, note: 'redo this', date: '2026-08-01T10:00:00.000Z', source: 'paste' },
  ]));

  const exported = window.buildFullLogData();
  assert.equal(exported.review.pagesNeedingReview.length, 1);
  assert.equal(exported.review.pagesNeedingReview[0].page, 15);
  assert.equal(exported.review.pagesNeedingReview[0].note, 'redo this');

  window.localStorage.clear();
  window.applyFullLogData({
    review: {
      pagesNeedingReview: [
        { page: 15, note: 'redo this', date: '2026-08-01 10:00', source: 'paste' },
        { page: 999, note: '', date: '2026-08-01 10:00' }, // out of range — dropped
      ],
    },
  });

  const pages = JSON.parse(window.localStorage.getItem('quranReviewPagesNeedingReview'));
  assert.equal(pages.length, 1);
  assert.equal(pages[0].page, 15);
});
