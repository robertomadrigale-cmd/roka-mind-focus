import test from 'node:test';
import assert from 'node:assert/strict';
import {
  carryOverTasks,
  completeTaskEffects,
  goalNextSteps,
  lowLifeAreas,
  migrateState,
  overdueTasks,
  ritualAdherence,
  shouldPromptWeeklyReview,
  weekKey,
  weekStats
} from '../public/js/lib/system.js';

test('weekKey returns the local Monday for the given week', () => {
  assert.equal(weekKey('2026-09-23'), '2026-09-21');
  assert.equal(weekKey('2026-09-27'), '2026-09-21');
});

test('migrateState applies v4 defaults without deleting existing fields', () => {
  const migrated = migrateState({
    stateVersion: 3,
    customField: 'keep-me',
    smartGoals: [{ id: 'g1', goal: 'Meta', completed: true, progress: 120 }],
    rituals: [{ id: 'r1', name: 'Meditar' }],
    // Los campos viejos de herramientas eliminadas (mapa personal, etc.) se ignoran, no se borran.
    personalMap: { archetype: 'creator' }
  });
  assert.equal(migrated.stateVersion, 4);
  assert.equal(migrated.customField, 'keep-me');
  assert.equal(migrated.smartGoals[0].status, 'done');
  assert.equal(migrated.smartGoals[0].progress, 100);
  assert.equal(migrated.smartGoals[0].big5Index, null);
  assert.equal(migrated.rituals[0].goalId, '');
  assert.deepEqual(migrated.personalMap, { archetype: 'creator' });
});

test('weekStats counts tasks, rituals, focus sessions and active days', () => {
  const state = {
    dailyTasks: {
      '2026-09-21': [{ completed: true }, { completed: false }],
      '2026-09-22': [{ completed: true }]
    },
    rituals: [{ id: 'r1', days: { lun: true, mar: true }, completions: { '2026-09-21': true } }],
    activityLog: { '2026-09-22': 5 },
    focusLog: { '2026-09-22': 2 }
  };
  const stats = weekStats(state, '2026-09-21', '2026-09-27');
  assert.equal(stats.tasksCompleted, 2);
  assert.equal(stats.tasksTotal, 3);
  assert.equal(stats.ritualsScheduled, 2);
  assert.equal(stats.ritualsCompleted, 1);
  assert.equal(stats.focusSessions, 2);
  assert.equal(stats.activeDays, 2);
});

test('ritualAdherence reports scheduled versus completed days', () => {
  const state = {
    rituals: [{ id: 'r1', days: { lun: true, mar: true, mie: true }, completions: { '2026-09-21': true, '2026-09-23': true } }]
  };
  assert.deepEqual(ritualAdherence(state, 'r1', '2026-09-23', 3), { ritualId: 'r1', scheduled: 3, completed: 2, rate: 67 });
});

test('goalNextSteps prioritizes week focus goals', () => {
  const result = goalNextSteps({
    weekFocus: { goalIds: ['g2'] },
    smartGoals: [
      { id: 'g1', goal: 'Uno', status: 'active', nextStep: 'A' },
      { id: 'g2', goal: 'Dos', status: 'active', nextStep: '' },
      { id: 'g3', goal: 'Tres', status: 'done', nextStep: 'C' }
    ]
  });
  assert.equal(result[0].id, 'g2');
  assert.equal(result[0].missing, true);
  assert.equal(result.length, 2);
});

test('overdueTasks returns incomplete tasks from the previous max days', () => {
  const result = overdueTasks({
    dailyTasks: {
      '2026-09-20': [{ id: 'old', completed: false }],
      '2026-09-22': [{ id: 'done', completed: true }, { id: 'open', completed: false }]
    }
  }, '2026-09-23', 3);
  assert.deepEqual(result.map(task => task.id), ['open', 'old']);
});

test('carryOverTasks moves selected overdue tasks into today', () => {
  const next = carryOverTasks({
    dailyTasks: { '2026-09-22': [{ id: 'open', text: 'Llamar', completed: false }] }
  }, '2026-09-23', ['open']);
  assert.equal(next.dailyTasks['2026-09-22'].length, 0);
  assert.equal(next.dailyTasks['2026-09-23'][0].carriedFrom, '2026-09-22');
});

test('completeTaskEffects clears matching goal next step and marks follow-up', () => {
  const next = completeTaskEffects({
    smartGoals: [{ id: 'g1', nextStep: 'Enviar propuesta', status: 'active' }],
    dailyTasks: { '2026-09-23': [{ id: 't1', text: 'Enviar propuesta', goalId: 'g1', completed: false }] }
  }, '2026-09-23', 't1');
  assert.equal(next.smartGoals[0].nextStep, '');
  assert.equal(next.dailyTasks['2026-09-23'][0].needsGoalFollowUp, true);
  assert.equal(next.dailyTasks['2026-09-23'][0].completed, true);
});

test('shouldPromptWeeklyReview prompts in review window when current week has no review', () => {
  assert.equal(shouldPromptWeeklyReview({ weeklyReviews: [] }, '2026-09-25'), true);
  assert.equal(shouldPromptWeeklyReview({ weeklyReviews: [{ weekKey: '2026-09-21' }] }, '2026-09-25'), false);
});

test('lowLifeAreas returns areas at or below threshold', () => {
  const result = lowLifeAreas({ lifeWheel: { energy: 3, economy: 4, joy: 8 } });
  assert.deepEqual(result.map(area => area.key), ['lifestyle', 'contribution', 'freedom', 'mindset', 'creativity', 'energy', 'production', 'connection', 'economy']);
});

test('weekStats ignores future days for ritual rate and counts only timer sessions as focus', () => {
  const everyDay = { lun: true, mar: true, mie: true, jue: true, vie: true, sab: true, dom: true };
  const state = {
    rituals: [{ id: 'r1', days: everyDay, completions: { '2026-09-21': true, '2026-09-22': true, '2026-09-23': true } }],
    activityLog: { '2026-09-22': 9 },
    focusLog: { '2026-09-22': 2 }
  };
  const stats = weekStats(state, '2026-09-21', '2026-09-23');
  assert.equal(stats.ritualsScheduled, 3);
  assert.equal(stats.ritualRate, 100);
  assert.equal(stats.focusSessions, 2);
});

test('goalNextSteps marks a step already planned for today', () => {
  const state = {
    smartGoals: [{ id: 'g1', goal: 'Meta', nextStep: 'Paso', status: 'active' }],
    dailyTasks: { '2026-09-23': [{ id: 't1', text: 'Paso', goalId: 'g1', completed: false }] }
  };
  assert.equal(goalNextSteps(state, '2026-09-23')[0].plannedToday, true);
  assert.equal(goalNextSteps(state, '2026-09-24')[0].plannedToday, false);
});
