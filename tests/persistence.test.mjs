import test from 'node:test';
import assert from 'node:assert/strict';
import {
  choosePersistedState,
  hasMeaningfulUserData,
  pruneStateForCloud,
  selectLocalCandidateForUser
} from '../public/js/lib/persistence.js';

const uid = 'user-a';
const meaningfulLocal = { ownerUid: uid, smartGoals: [{ id: 'g1' }], updatedAt: '2026-09-23T20:00:00.000Z' };

test('selects local state for same uid', () => {
  assert.equal(selectLocalCandidateForUser(meaningfulLocal, uid), meaningfulLocal);
});

test('discards local state for different uid', () => {
  assert.deepEqual(selectLocalCandidateForUser({ ...meaningfulLocal, ownerUid: 'other' }, uid), {});
});

test('adopts legacy local state without uid once', () => {
  const legacy = { smartGoals: [{ id: 'legacy' }], updatedAt: '2026-09-23T20:00:00.000Z' };
  assert.equal(selectLocalCandidateForUser(legacy, uid), legacy);
});

test('chooses local when remote is empty', () => {
  const chosen = choosePersistedState(meaningfulLocal, {}, { uid, todayKey: '2026-09-23' });
  assert.equal(chosen, meaningfulLocal);
});

test('chooses newer local over remote', () => {
  const remote = { smartGoals: [{ id: 'old' }], updatedAt: '2026-09-22T20:00:00.000Z' };
  const chosen = choosePersistedState(meaningfulLocal, remote, { uid, todayKey: '2026-09-23' });
  assert.equal(chosen, meaningfulLocal);
});

test('chooses newer remote over local', () => {
  const remote = { smartGoals: [{ id: 'new' }], updatedAt: '2026-09-24T20:00:00.000Z' };
  const chosen = choosePersistedState(meaningfulLocal, remote, { uid, todayKey: '2026-09-23' });
  assert.equal(chosen, remote);
});

test('meaningful data detects today activity', () => {
  assert.equal(hasMeaningfulUserData({ activityLog: { '2026-09-23': 1 } }, '2026-09-23'), true);
});

test('pruneStateForCloud archives entries older than 400 days', () => {
  const input = {
    dailyTasks: {
      '2025-08-01': [{ id: 'old' }],
      '2026-09-23': [{ id: 'new' }]
    },
    activityLog: {
      '2025-08-01': 2,
      '2026-09-23': 1
    }
  };
  const result = pruneStateForCloud(input, { now: new Date(2026, 8, 23) });
  assert.equal(result.state.dailyTasks['2025-08-01'], undefined);
  assert.deepEqual(result.state.localArchive.dailyTasks['2025-08-01'], [{ id: 'old' }]);
  assert.equal(result.state.activityLog['2026-09-23'], 1);
});
