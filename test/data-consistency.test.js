'use strict';

const fs = require('fs');
const path = require('path');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { extractConst } = require('./helpers/extractConst.js');

const ROOT = path.join(__dirname, '..');

test('the SURAHS table is identical in quran-tracker.html and review.html', () => {
  // Both files hand-maintain their own copy (see CLAUDE.md) — this is the
  // guard against them silently drifting apart.
  const trackerSurahs = extractConst('quran-tracker.html', 'SURAHS');
  const reviewSurahs = extractConst('review.html', 'SURAHS');
  assert.equal(trackerSurahs.length, 114);
  assert.equal(reviewSurahs.length, 114);
  assert.deepEqual(reviewSurahs, trackerSurahs);
});

test('SURAHS entries are numbered 1-114 in order with non-empty names', () => {
  const surahs = extractConst('quran-tracker.html', 'SURAHS');
  surahs.forEach(([num, en, ar], idx) => {
    assert.equal(num, idx + 1, `entry ${idx} should be surah ${idx + 1}`);
    assert.ok(en && en.length > 0, `surah ${num} missing an English name`);
    assert.ok(ar && ar.length > 0, `surah ${num} missing an Arabic name`);
  });
});

test('version.js exports a valid semver-shaped APP_VERSION', () => {
  const source = fs.readFileSync(path.join(ROOT, 'version.js'), 'utf8');
  const match = source.match(/const APP_VERSION = "([^"]+)"/);
  assert.ok(match, 'APP_VERSION not found in version.js');
  assert.match(match[1], /^\d+\.\d+\.\d+$/, `"${match[1]}" is not v1.v2.v3 shaped`);
});

test('every page includes version.js and log.js (except index.html, which has no log data)', () => {
  const pagesNeedingLog = ['quran-tracker.html', 'review.html', 'habits.html'];
  for (const page of pagesNeedingLog) {
    const html = fs.readFileSync(path.join(ROOT, page), 'utf8');
    assert.match(html, /<script src="version\.js">/, `${page} should include version.js`);
    assert.match(html, /<script src="log\.js">/, `${page} should include log.js`);
  }
});

test('LOG_KEYS in log.js covers tracker, review, and habits sections', () => {
  const source = fs.readFileSync(path.join(ROOT, 'log.js'), 'utf8');
  assert.match(source, /tracker:\s*{\s*memorized:/);
  assert.match(source, /review:\s*{/);
  assert.match(source, /habits:\s*{/);
});
