'use strict';

const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { loadPage } = require('./helpers/loadPage.js');

let w;
before(() => {
  w = loadPage('habits.html').window;
});

test('periodStart for "day" zeroes the time of day', () => {
  const d = new Date(2026, 7, 3, 15, 42); // Aug 3, 2026, 3:42pm — a Monday
  const start = w.periodStart('day', d);
  assert.equal(start.getFullYear(), 2026);
  assert.equal(start.getMonth(), 7);
  assert.equal(start.getDate(), 3);
  assert.equal(start.getHours(), 0);
  assert.equal(start.getMinutes(), 0);
});

test('periodStart for "week" always lands on Monday', () => {
  // Aug 3, 2026 is a Monday; Aug 6 is a Thursday in the same week.
  const monday = w.periodStart('week', new Date(2026, 7, 3));
  const thursday = w.periodStart('week', new Date(2026, 7, 6));
  assert.equal(monday.getDay(), 1, 'Monday has getDay() === 1');
  assert.equal(monday.getTime(), thursday.getTime(), 'same week -> same period start');
});

test('periodStart for "week" handles Sunday correctly (end of week, not start of a new one)', () => {
  // Aug 9, 2026 is the Sunday closing the week that started Monday Aug 3.
  const sunday = w.periodStart('week', new Date(2026, 7, 9));
  const monday = w.periodStart('week', new Date(2026, 7, 3));
  assert.equal(sunday.getTime(), monday.getTime());
});

test('periodStart for "month" lands on the 1st', () => {
  const start = w.periodStart('month', new Date(2026, 7, 17));
  assert.equal(start.getDate(), 1);
  assert.equal(start.getMonth(), 7);
});

test('periodEnd is exactly one unit after periodStart', () => {
  const dayStart = w.periodStart('day', new Date(2026, 7, 3));
  const dayEnd = w.periodEnd('day', dayStart);
  assert.equal((dayEnd - dayStart) / (1000 * 60 * 60 * 24), 1);

  const weekStart = w.periodStart('week', new Date(2026, 7, 3));
  const weekEnd = w.periodEnd('week', weekStart);
  assert.equal((weekEnd - weekStart) / (1000 * 60 * 60 * 24), 7);

  const monthStart = w.periodStart('month', new Date(2026, 7, 3)); // August, 31 days
  const monthEnd = w.periodEnd('month', monthStart);
  assert.equal(monthEnd.getMonth(), 8); // September
  assert.equal(monthEnd.getDate(), 1);
});

test('escapeHtml neutralizes markup so a user-typed activity name can\'t inject HTML', () => {
  assert.equal(w.escapeHtml('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
  assert.equal(w.escapeHtml('Workout & Reading'), 'Workout &amp; Reading');
});

test('periodLabel returns a human string for each unit', () => {
  assert.equal(w.periodLabel('day'), 'today');
  assert.equal(w.periodLabel('week'), 'this week');
  assert.equal(w.periodLabel('month'), 'this month');
});
