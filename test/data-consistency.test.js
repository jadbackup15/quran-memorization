'use strict';

const fs = require('fs');
const path = require('path');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { extractConst } = require('./helpers/extractConst.js');

const ROOT = path.join(__dirname, '..');

test('quran-tracker.html, review.html, and hizb.html all use the shared quran-data.js instead of their own SURAHS copy', () => {
  for (const page of ['quran-tracker.html', 'review.html', 'hizb.html']) {
    const html = fs.readFileSync(path.join(ROOT, page), 'utf8');
    assert.match(html, /<script src="quran-data\.js">/, `${page} should include quran-data.js`);
    assert.doesNotMatch(html, /const SURAHS = /, `${page} should not have its own SURAHS copy`);
  }
});

test('SURAHS entries are numbered 1-114 in order with non-empty names', () => {
  const surahs = extractConst('quran-data.js', 'SURAHS');
  assert.equal(surahs.length, 114);
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
  const pagesNeedingLog = ['quran-tracker.html', 'review.html', 'habits.html', 'hizb.html'];
  for (const page of pagesNeedingLog) {
    const html = fs.readFileSync(path.join(ROOT, page), 'utf8');
    assert.match(html, /<script src="version\.js">/, `${page} should include version.js`);
    assert.match(html, /<script src="log\.js">/, `${page} should include log.js`);
  }
});

test('review.html and hizb.html both include quran-cache.js and mistake-analytics.js', () => {
  for (const page of ['review.html', 'hizb.html']) {
    const html = fs.readFileSync(path.join(ROOT, page), 'utf8');
    assert.match(html, /<script src="quran-cache\.js">/, `${page} should include quran-cache.js`);
    assert.match(html, /<script src="mistake-analytics\.js">/, `${page} should include mistake-analytics.js`);
  }
});

test('LOG_KEYS in log.js covers tracker, review, and habits sections', () => {
  const source = fs.readFileSync(path.join(ROOT, 'log.js'), 'utf8');
  assert.match(source, /tracker:\s*{\s*memorized:/);
  assert.match(source, /review:\s*{/);
  assert.match(source, /habits:\s*{/);
});
