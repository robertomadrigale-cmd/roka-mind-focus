import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRemindersICS, dueReminder, markReminderShown, normalizeReminders } from '../public/js/lib/reminders.js';

test('normalizeReminders falls back to defaults on invalid input', () => {
  assert.deepEqual(normalizeReminders({ dailyTime: '25:00', weeklyDay: 'XX', weeklyTime: 'abc' }), {
    dailyTime: '08:00', weeklyDay: 'SU', weeklyTime: '18:00', notifications: false
  });
});

test('buildRemindersICS creates a daily and a weekly recurring event with alarms', () => {
  const now = new Date(2026, 8, 23, 10, 0); // miércoles 23/09/2026
  const ics = buildRemindersICS({ dailyTime: '07:30', weeklyDay: 'SU', weeklyTime: '19:00' }, { url: 'https://roka-zen-full.web.app/', now });
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /DTSTART:20260923T073000/);
  assert.match(ics, /RRULE:FREQ=DAILY/);
  assert.match(ics, /DTSTART:20260927T190000/); // próximo domingo
  assert.match(ics, /RRULE:FREQ=WEEKLY;BYDAY=SU/);
  assert.equal((ics.match(/BEGIN:VALARM/g) || []).length, 2);
  assert.match(ics, /URL:https:\/\/roka-zen-full\.web\.app\/#\/semana\/revision/);
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
});

test('dueReminder returns daily after its time once per day', () => {
  const r = { dailyTime: '08:00', weeklyDay: 'SU', weeklyTime: '18:00' };
  assert.equal(dueReminder(r, {}, new Date(2026, 8, 23, 7, 59)), null);
  const due = dueReminder(r, {}, new Date(2026, 8, 23, 8, 1));
  assert.equal(due.kind, 'daily');
  const shown = markReminderShown({}, 'daily', new Date(2026, 8, 23, 8, 1));
  assert.equal(dueReminder(r, shown, new Date(2026, 8, 23, 20, 0)), null);
});

test('dueReminder prioritizes the weekly review on its day and time', () => {
  const r = { dailyTime: '08:00', weeklyDay: 'SU', weeklyTime: '18:00' };
  const sunday = new Date(2026, 8, 27, 18, 30);
  assert.equal(dueReminder(r, {}, sunday).kind, 'weekly');
  const shown = markReminderShown({}, 'weekly', sunday);
  assert.equal(dueReminder(r, shown, sunday).kind, 'daily');
});
