import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import firebase from 'firebase/compat/app';
import 'firebase/compat/firestore';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment
} from '@firebase/rules-unit-testing';
import {
  diffModels,
  isRemoteResetNewer,
  legacyToModel,
  mergeModels,
  modelToState,
  stateToModel
} from '../public/js/lib/sync-model.js';

const PROJECT_ID = 'demo-roka-sync';
const UID = 'user-a';

let testEnv;

function fixtureState() {
  return {
    stateVersion: 4,
    updatedAt: '2026-09-23T18:00:00.000Z',
    smartGoals: [{ id: 'g1', goal: 'Lanzar oferta', nextStep: 'Landing', progress: 10, status: 'active' }],
    rituals: [{ id: 'r1', name: 'Meditar', days: { mie: true }, completions: { '2026-09-23': true } }],
    beliefs: [],
    mantras: [],
    circleOfGiants: [],
    weeklyReviews: [],
    aiReports: [],
    userProfile: { name: 'Roka' },
    lifeWheel: { energy: 6 },
    gamification: { xp: 100, level: 2, badges: ['first_blood'] },
    dailyTasks: { '2026-09-23': [{ id: 't1', text: 'Escribir', priority: 'high', completed: false }] },
    prideLogs: [],
    gratitudeLogs: [],
    victories: [],
    activityLog: { '2026-09-23': 1 },
    focusLog: { '2026-09-23': 1 },
    onboarding: { status: 'completed' },
    hasSeenOnboarding: true
  };
}

function expandFieldMap(fields) {
  const root = {};
  for (const [path, value] of Object.entries(fields || {})) {
    const parts = path.split('.');
    let cursor = root;
    while (parts.length > 1) {
      const part = parts.shift();
      cursor[part] = cursor[part] || {};
      cursor = cursor[part];
    }
    cursor[parts[0]] = value && Object.hasOwn(value, '__increment')
      ? firebase.firestore.FieldValue.increment(value.__increment)
      : value;
  }
  return root;
}

function flattenStampedFields(data = {}, prefix = '') {
  const result = {};
  for (const [key, value] of Object.entries(data || {})) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && (Object.hasOwn(value, 'v') || Object.hasOwn(value, '_d'))) {
      result[path] = value;
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(result, flattenStampedFields(value, path));
    } else {
      result[path] = value;
    }
  }
  return result;
}

async function applyWrites(db, uid, writes) {
  const batch = db.batch();
  for (const write of writes) {
    batch.set(db.doc(`users/${uid}/${write.path}`), expandFieldMap(write.fields), { merge: true });
  }
  await batch.commit();
}

async function writeFullModel(db, uid, model) {
  await applyWrites(db, uid, diffModels({ schema: 5, collections: {}, singletons: {}, counters: {}, days: {} }, model));
}

async function readRemoteModel(db, uid) {
  const [collectionsSnap, singletonsSnap, countersSnap, daysSnap] = await Promise.all([
    db.doc(`users/${uid}/sync/collections`).get(),
    db.doc(`users/${uid}/sync/singletons`).get(),
    db.doc(`users/${uid}/sync/counters`).get(),
    db.collection(`users/${uid}/days`).get()
  ]);
  const days = {};
  daysSnap.forEach(docSnap => {
    days[docSnap.id] = docSnap.data();
  });
  return {
    schema: 5,
    collections: collectionsSnap.exists ? collectionsSnap.data() : {},
    singletons: singletonsSnap.exists ? flattenStampedFields(singletonsSnap.data()) : {},
    counters: countersSnap.exists ? countersSnap.data() : {},
    days
  };
}

test.before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      host: '127.0.0.1',
      port: 8080,
      rules: await readFile('firestore.rules', 'utf8')
    }
  });
});

test.after(async () => {
  await testEnv.cleanup();
});

test.beforeEach(async () => {
  await testEnv.clearFirestore();
});

test('two devices interleave writes and converge without lost changes', async () => {
  const ownerA = testEnv.authenticatedContext(UID).firestore();
  const ownerB = testEnv.authenticatedContext(UID).firestore();
  const baseState = fixtureState();
  const baseModel = stateToModel(baseState, { now: 100 });

  await testEnv.withSecurityRulesDisabled(async context => {
    await writeFullModel(context.firestore(), UID, baseModel);
    await context.firestore().doc(`users/${UID}`).set({ schema: 5, migratedAt: '2026-09-23T18:00:00.000Z' });
  });

  const aState = modelToState(baseModel, {});
  const bState = modelToState(baseModel, {});
  aState.dailyTasks['2026-09-23'].push({ id: 't-a', text: 'Llamar', priority: 'high', completed: false });
  aState.rituals[0].completions['2026-09-24'] = true;
  aState.focusLog['2026-09-23'] += 1;
  bState.smartGoals[0].nextStep = 'Propuesta';
  bState.lifeWheel.energy = 9;
  bState.focusLog['2026-09-23'] += 2;

  const aModel = stateToModel(aState, { now: 200, prevModel: baseModel });
  const bModel = stateToModel(bState, { now: 300, prevModel: baseModel });
  await Promise.all([
    applyWrites(ownerA, UID, diffModels(baseModel, aModel)),
    applyWrites(ownerB, UID, diffModels(baseModel, bModel))
  ]);

  const remote = await readRemoteModel(ownerA, UID);
  const finalA = modelToState(mergeModels(aModel, remote), {});
  const finalB = modelToState(mergeModels(bModel, remote), {});

  assert.deepEqual(finalA, finalB);
  assert.equal(finalA.dailyTasks['2026-09-23'].some(task => task.id === 't-a'), true);
  assert.equal(finalA.smartGoals[0].nextStep, 'Propuesta');
  assert.equal(finalA.lifeWheel.energy, 9);
  assert.equal(finalA.rituals[0].completions['2026-09-24'], true);
  assert.equal(finalA.focusLog['2026-09-23'], 4);
});

test('migration from a legacy v4 root creates a backup and equivalent v5 model', async () => {
  const legacy = fixtureState();
  const owner = testEnv.authenticatedContext(UID).firestore();

  await testEnv.withSecurityRulesDisabled(async context => {
    await context.firestore().doc(`users/${UID}`).set(legacy);
  });

  const model = legacyToModel(legacy, Date.parse(legacy.updatedAt));
  await owner.doc(`users/${UID}/backups/legacy-test`).set({ ...legacy, backedUpAt: '2026-09-23T18:01:00.000Z' });
  await writeFullModel(owner, UID, model);
  await owner.doc(`users/${UID}`).set({ schema: 5, migratedAt: '2026-09-23T18:02:00.000Z' }, { merge: true });

  const [backup, root, remote] = await Promise.all([
    owner.doc(`users/${UID}/backups/legacy-test`).get(),
    owner.doc(`users/${UID}`).get(),
    readRemoteModel(owner, UID)
  ]);
  const migratedState = modelToState(remote, {});

  assert.equal(backup.exists, true);
  assert.equal(root.data().schema, 5);
  assert.deepEqual(migratedState.smartGoals, legacy.smartGoals);
  assert.deepEqual(migratedState.dailyTasks, legacy.dailyTasks);
  assert.equal(migratedState.gamification.xp, legacy.gamification.xp);
  assert.equal(migratedState.rituals[0].completions['2026-09-23'], true);
});

test('rules isolate owner data and protect backups from update/delete', async () => {
  const owner = testEnv.authenticatedContext(UID).firestore();
  const other = testEnv.authenticatedContext('other-user').firestore();

  await assertSucceeds(owner.doc(`users/${UID}/sync/collections`).set({ goals: {} }));
  await assertSucceeds(owner.doc(`users/${UID}/days/2026-09-23`).set({ focus: 1 }));
  await assertSucceeds(owner.doc(`users/${UID}/backups/b1`).set({ stateVersion: 4 }));

  await assertFails(other.doc(`users/${UID}/sync/collections`).get());
  await assertFails(other.doc(`users/${UID}/sync/collections`).set({ goals: {} }));
  await assertFails(other.doc(`users/${UID}/days/2026-09-23`).get());
  await assertFails(other.doc(`users/${UID}/days/2026-09-23`).set({ focus: 2 }));
  await assertFails(other.doc(`users/${UID}/backups/b1`).get());
  await assertFails(other.doc(`users/${UID}/backups/b2`).set({ stateVersion: 4 }));
  await assertFails(owner.doc(`users/${UID}/backups/b1`).update({ touched: true }));
  await assertFails(owner.doc(`users/${UID}/backups/b1`).delete());
});

// ─── "Empezar de cero" — dispositivo B no resucita datos tras el reinicio de A ───

async function deleteAllUserData(db, uid) {
  const refs = [
    db.doc(`users/${uid}/sync/collections`),
    db.doc(`users/${uid}/sync/singletons`),
    db.doc(`users/${uid}/sync/counters`)
  ];
  const daysSnap = await db.collection(`users/${uid}/days`).get();
  daysSnap.forEach(docSnap => refs.push(docSnap.ref));
  const threadsSnap = await db.collection(`users/${uid}/chatThreads`).get();
  for (const threadDoc of threadsSnap.docs) {
    const messagesSnap = await threadDoc.ref.collection('messages').get();
    messagesSnap.forEach(messageDoc => refs.push(messageDoc.ref));
    refs.push(threadDoc.ref);
  }
  const reportsSnap = await db.collection(`users/${uid}/reports`).get();
  reportsSnap.forEach(docSnap => refs.push(docSnap.ref));

  const batch = db.batch();
  refs.forEach(ref => batch.delete(ref));
  await batch.commit();
}

test('device A resets the account; device B never re-uploads its stale pending edits and ends up empty', async () => {
  const deviceA = testEnv.authenticatedContext(UID).firestore();
  const deviceB = testEnv.authenticatedContext(UID).firestore();
  const baseState = fixtureState();
  const baseModel = stateToModel(baseState, { now: 100 });

  await testEnv.withSecurityRulesDisabled(async context => {
    await writeFullModel(context.firestore(), UID, baseModel);
    await context.firestore().doc(`users/${UID}`).set({ schema: 5, migratedAt: '2026-09-23T18:00:00.000Z' });
    await context.firestore().doc(`users/${UID}/chatThreads/t1`).set({ id: 't1', title: 'Hola' });
    await context.firestore().doc(`users/${UID}/chatThreads/t1/messages/m1`).set({ id: 'm1', role: 'user', content: 'hola' });
    await context.firestore().doc(`users/${UID}/reports/r1`).set({ id: 'r1', title: 'Informe' });
  });

  // Ambos dispositivos parten con la misma base cacheada y ningún resetAt conocido todavía.
  let knownResetAtB = '';

  // Device B edita localmente (por ejemplo, cambia una meta) pero SU push todavía no se ha
  // enviado (debounce en curso) cuando llega el reinicio de A.
  const bState = modelToState(baseModel, {});
  bState.smartGoals[0].nextStep = 'Cambio local de B, nunca debe llegar a la nube';
  const bPendingModel = stateToModel(bState, { now: 250, prevModel: baseModel });
  const bPendingWrites = diffModels(baseModel, bPendingModel);
  assert.ok(bPendingWrites.length > 0, 'debe haber cambios locales pendientes en B antes del reinicio');

  // Device A ejecuta "Empezar de cero": borra todo y reemplaza el documento raíz SIN merge.
  await deleteAllUserData(deviceA, UID);
  const resetAt = new Date().toISOString();
  await deviceA.doc(`users/${UID}`).set({ schema: 5, migratedAt: '2026-09-23T18:00:00.000Z', resetAt });

  // Device B se reconecta: lee el documento raíz y decide, con la misma lógica pura que usa
  // syncService.startSync, si debe descartar su estado y su base sin subir nada.
  const rootSnap = await deviceB.doc(`users/${UID}`).get();
  const remoteResetAt = rootSnap.data()?.resetAt || '';
  const mustDiscard = isRemoteResetNewer(knownResetAtB, remoteResetAt);
  assert.equal(mustDiscard, true);

  // Si mustDiscard es true, syncService NUNCA llama a pushChanges: B no debe escribir sus
  // bPendingWrites. Simplemente actualiza su base cacheada y arranca vacío.
  knownResetAtB = remoteResetAt;
  if (!mustDiscard) {
    await applyWrites(deviceB, UID, bPendingWrites); // esto NO debe ejecutarse en este escenario
  }

  const remoteAfter = await readRemoteModel(deviceA, UID);
  const finalB = modelToState(remoteAfter, {});

  assert.deepEqual(remoteAfter.collections, {});
  assert.deepEqual(remoteAfter.singletons, {});
  assert.deepEqual(remoteAfter.days, {});
  assert.equal(finalB.smartGoals.length, 0);
  assert.notEqual(
    JSON.stringify(finalB.smartGoals),
    JSON.stringify([{ ...baseState.smartGoals[0], nextStep: 'Cambio local de B, nunca debe llegar a la nube' }])
  );

  const threadsAfter = await deviceA.collection(`users/${UID}/chatThreads`).get();
  const reportsAfter = await deviceA.collection(`users/${UID}/reports`).get();
  assert.equal(threadsAfter.size, 0);
  assert.equal(reportsAfter.size, 0);

  const rootAfter = await deviceA.doc(`users/${UID}`).get();
  assert.equal(rootAfter.data().schema, 5);
  assert.equal(rootAfter.data().resetAt, resetAt);
  assert.equal(rootAfter.data().migratedAt, '2026-09-23T18:00:00.000Z');
});

