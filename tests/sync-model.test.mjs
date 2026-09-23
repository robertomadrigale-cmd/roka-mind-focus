import test from 'node:test';
import assert from 'node:assert/strict';
import {
  diffModels,
  legacyToModel,
  mergeModels,
  modelToState,
  stateToModel
} from '../public/js/lib/sync-model.js';

const NOW = 1790186400000;

function fullLegacyState() {
  return {
    stateVersion: 4,
    updatedAt: '2026-09-23T18:00:00.000Z',
    beliefs: [{ id: 'b1', belief: 'No puedo', reframe: 'Aprendo', date: '2026-09-23' }],
    mantras: [{ id: 'm1', beliefId: 'b1', text: 'Aprendo', date: '2026-09-23' }],
    victories: [{ id: 'v1', content: 'Cerré ciclo', date: '2026-09-22' }],
    prideLogs: [{ id: 'p1', content: 'Entrené', date: '2026-09-23' }],
    gratitudeLogs: [{ id: 'gr1', content: 'Mi familia', date: '2026-09-23' }],
    smartGoals: [{ id: 'g1', goal: 'Lanzar oferta', progress: 20, status: 'active', nextStep: 'Landing' }],
    rituals: [{
      id: 'r1',
      name: 'Meditar',
      days: { lun: true, mar: 'completed_2026-09-22', mie: true },
      completions: { '2026-09-23': true }
    }],
    circleOfGiants: [{ id: 'c1', name: 'Mentor', lesson: 'Claridad' }],
    weeklyReviews: [{ id: 'w1', weekKey: '2026-09-21', wins: 'Dos' }],
    aiReports: [{ id: 'a1', title: 'Informe', content: 'Contenido' }],
    userProfile: { name: 'Roka', values: 'Disciplina' },
    lifeWheel: { energy: 8, economy: 6 },
    annualBig5: ['Uno', '', '', '', ''],
    values5: ['Valor', '', '', '', ''],
    mustBecome5: ['Sereno', '', '', '', ''],
    quarterly10: ['Q1', '', '', '', '', '', '', '', '', ''],
    stopDoingList: ['Distraerme', '', '', '', '', '', '', '', '', ''],
    weeklyReflection: { well: 'Bien', adjust: 'Dormir' },
    learning: { book: 'Libro' },
    visionText: 'Visión',
    sectionDates: { weekly: '2026-09-23' },
    personalMap: { archetype: 'creator' },
    coachPreferences: { style: 'direct' },
    aiConfig: { prompt: 'Sé claro' },
    settings: { advancedTools: true },
    weekFocus: { weekKey: '2026-09-21', goalIds: ['g1'] },
    onboarding: { status: 'completed', completedAt: '2026-09-23T18:00:00.000Z', step: 3 },
    hasSeenOnboarding: true,
    reportsMigrated: false,
    gamification: { xp: 120, level: 2, badges: ['first_blood'] },
    dailyTasks: {
      '2026-09-23': [
        { id: 't1', text: 'Escribir', priority: 'high', completed: false },
        { id: 't2', text: 'Enviar', priority: 'medium', completed: true }
      ],
      '2026-09-24': [{ id: 't3', text: 'Revisar', priority: 'low', completed: false }]
    },
    activityLog: { '2026-09-23': 3 },
    focusLog: { '2026-09-23': 2 },
    customUnknown: { keep: true }
  };
}

test('stateToModel and modelToState round-trip a complete v4 state without loss', () => {
  const state = fullLegacyState();
  const model = stateToModel(state, { now: NOW });
  const roundTrip = modelToState(model, {});

  assert.deepEqual(roundTrip.smartGoals, state.smartGoals);
  assert.deepEqual(roundTrip.beliefs, state.beliefs);
  assert.deepEqual(roundTrip.mantras, state.mantras);
  assert.deepEqual(roundTrip.circleOfGiants, state.circleOfGiants);
  assert.deepEqual(roundTrip.weeklyReviews, state.weeklyReviews);
  assert.deepEqual(roundTrip.aiReports, state.aiReports);
  assert.deepEqual(roundTrip.dailyTasks, state.dailyTasks);
  assert.deepEqual(roundTrip.activityLog, state.activityLog);
  assert.deepEqual(roundTrip.focusLog, state.focusLog);
  assert.deepEqual(roundTrip.prideLogs, state.prideLogs);
  assert.deepEqual(roundTrip.gratitudeLogs, state.gratitudeLogs);
  assert.deepEqual(roundTrip.victories, state.victories);
  assert.equal(roundTrip.rituals[0].completions['2026-09-23'], true);
  assert.equal(roundTrip.rituals[0].completions['2026-09-22'], true);
  assert.deepEqual(roundTrip.gamification, state.gamification);
  assert.deepEqual(roundTrip.customUnknown, state.customUnknown);
});

test('two devices keep different item edits: task creation and goal edit', () => {
  const base = stateToModel(fullLegacyState(), { now: 100 });
  const aState = modelToState(base, {});
  const bState = modelToState(base, {});
  aState.dailyTasks['2026-09-23'].push({ id: 't-new', text: 'Nueva tarea', priority: 'high', completed: false });
  bState.smartGoals[0].nextStep = 'Nueva meta';

  const a = stateToModel(aState, { now: 200, prevModel: base });
  const b = stateToModel(bState, { now: 300, prevModel: base });
  const merged = mergeModels(a, b);
  const result = modelToState(merged, {});

  assert.equal(result.dailyTasks['2026-09-23'].some(task => task.id === 't-new'), true);
  assert.equal(result.smartGoals[0].nextStep, 'Nueva meta');
});

test('same goal conflict uses the newest _u', () => {
  const base = stateToModel(fullLegacyState(), { now: 100 });
  const aState = modelToState(base, {});
  const bState = modelToState(base, {});
  aState.smartGoals[0].goal = 'Versión A';
  bState.smartGoals[0].goal = 'Versión B';

  const merged = mergeModels(
    stateToModel(aState, { now: 200, prevModel: base }),
    stateToModel(bState, { now: 300, prevModel: base })
  );

  assert.equal(modelToState(merged, {}).smartGoals[0].goal, 'Versión B');
});

test('ritual tombstone wins over an older edit and newer edit revives it', () => {
  const base = stateToModel(fullLegacyState(), { now: 100 });
  const deletedState = modelToState(base, {});
  deletedState.rituals = [];
  const olderEditState = modelToState(base, {});
  olderEditState.rituals[0].name = 'Respirar';

  const deleted = stateToModel(deletedState, { now: 300, prevModel: base });
  const olderEdit = stateToModel(olderEditState, { now: 200, prevModel: base });
  assert.equal(modelToState(mergeModels(deleted, olderEdit), {}).rituals.length, 0);

  const newerEdit = stateToModel(olderEditState, { now: 400, prevModel: base });
  const revived = modelToState(mergeModels(deleted, newerEdit), {});
  assert.equal(revived.rituals[0].name, 'Respirar');
});

test('different ritual completions on the same day are preserved', () => {
  const state = fullLegacyState();
  state.rituals.push({ id: 'r2', name: 'Leer', days: { mie: true }, completions: {} });
  const base = stateToModel(state, { now: 100 });
  const aState = modelToState(base, {});
  const bState = modelToState(base, {});
  aState.rituals.find(item => item.id === 'r1').completions['2026-09-24'] = true;
  bState.rituals.find(item => item.id === 'r2').completions['2026-09-24'] = true;

  const result = modelToState(mergeModels(
    stateToModel(aState, { now: 200, prevModel: base }),
    stateToModel(bState, { now: 300, prevModel: base })
  ), {});

  assert.equal(result.rituals.find(item => item.id === 'r1').completions['2026-09-24'], true);
  assert.equal(result.rituals.find(item => item.id === 'r2').completions['2026-09-24'], true);
});

test('focus counter diffs add up through increments', () => {
  const base = stateToModel(fullLegacyState(), { now: 100 });
  const aState = modelToState(base, {});
  const bState = modelToState(base, {});
  aState.focusLog['2026-09-23'] += 1;
  bState.focusLog['2026-09-23'] += 2;

  const aWrites = diffModels(base, stateToModel(aState, { now: 200, prevModel: base }));
  const bWrites = diffModels(base, stateToModel(bState, { now: 300, prevModel: base }));
  const aDelta = aWrites.find(write => write.path === 'days/2026-09-23').fields.focus.__increment;
  const bDelta = bWrites.find(write => write.path === 'days/2026-09-23').fields.focus.__increment;

  assert.equal(base.days['2026-09-23'].focus + aDelta + bDelta, 5);
});

test('different singleton edits are both kept', () => {
  const base = stateToModel(fullLegacyState(), { now: 100 });
  const aState = modelToState(base, {});
  const bState = modelToState(base, {});
  aState.lifeWheel.energy = 9;
  bState.userProfile.name = 'Nuevo nombre';

  const result = modelToState(mergeModels(
    stateToModel(aState, { now: 200, prevModel: base }),
    stateToModel(bState, { now: 300, prevModel: base })
  ), {});

  assert.equal(result.lifeWheel.energy, 9);
  assert.equal(result.userProfile.name, 'Nuevo nombre');
});

test('diffModels is empty with no changes and groups writes by document', () => {
  const base = stateToModel(fullLegacyState(), { now: 100 });
  assert.deepEqual(diffModels(base, base), []);

  const nextState = modelToState(base, {});
  nextState.smartGoals[0].goal = 'Actualizada';
  nextState.dailyTasks['2026-09-23'][0].text = 'Actualizada';
  nextState.gamification.xp += 10;
  const writes = diffModels(base, stateToModel(nextState, { now: 200, prevModel: base }));

  assert.deepEqual(writes.map(write => write.path).sort(), ['days/2026-09-23', 'sync/collections', 'sync/counters']);
});

test('legacyToModel stamps a v3/v4 fixture based on realistic default state', () => {
  const legacy = fullLegacyState();
  legacy.stateVersion = 3;
  const model = legacyToModel(legacy, NOW);
  assert.equal(model.schema, 5);
  assert.equal(model.collections.goals.g1._u, Date.parse(legacy.updatedAt));
  assert.equal(model.counters.xp, 120);
  assert.equal(model.days['2026-09-23'].tasks.t1.text, 'Escribir');
  assert.equal(model.days['2026-09-23'].ritualDone.r1.v, true);
});


test('re-migration after a stale legacy overwrite never beats newer v5 edits or tombstones', () => {
  const legacy = {
    updatedAt: '2026-09-20T10:00:00.000Z',
    smartGoals: [
      { id: 'g1', goal: 'Meta vieja', progress: 10, status: 'active' },
      { id: 'g2', goal: 'Borrada en v5', progress: 0, status: 'active' }
    ]
  };
  const base = legacyToModel(legacy, Date.parse('2026-09-20T10:00:00.000Z'));
  const later = Date.parse('2026-09-23T10:00:00.000Z');
  const v5State = modelToState(base, {});
  v5State.smartGoals = v5State.smartGoals.filter(goal => goal.id !== 'g2');
  v5State.smartGoals[0].goal = 'Meta nueva';
  const v5 = stateToModel(v5State, { now: later, prevModel: base });

  const merged = modelToState(mergeModels(legacyToModel(legacy, Date.now()), v5), {});
  assert.equal(merged.smartGoals.length, 1);
  assert.equal(merged.smartGoals[0].goal, 'Meta nueva');
});
