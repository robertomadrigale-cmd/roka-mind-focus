import test from 'node:test';
import assert from 'node:assert/strict';
import { localDateKey } from '../public/js/lib/dates.js';

test('localDateKey uses local calendar date at 23:30 edge', () => {
  const date = new Date(2026, 8, 23, 23, 30, 0);
  assert.equal(localDateKey(date), '2026-09-23');
});

test('localDateKey pads month and day', () => {
  const date = new Date(2026, 0, 5, 8, 0, 0);
  assert.equal(localDateKey(date), '2026-01-05');
});
