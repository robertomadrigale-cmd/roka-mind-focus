import {
  collection,
  doc,
  documentId,
  getDoc,
  getDocs,
  increment,
  limit,
  onSnapshot,
  query,
  setDoc,
  where,
  writeBatch
} from "https://www.gstatic.com/firebasejs/12.14.0/firebase-firestore.js";
import {
  diffModels,
  emptySyncModel,
  isRemoteResetNewer,
  legacyToModel,
  mergeModels,
  modelToState,
  stateToModel
} from "../lib/sync-model.js?v=42-reset";

const SYNC_BASE_KEY = 'rokaMindSyncBase';
const MAX_BATCH_OPS = 400;
const DAY_MS = 86400000;

let db = null;
let uid = '';
let callbacks = {};
let unsubscribeFns = [];
let lastSyncedModel = null;
let pushPromise = null;
let remoteRefreshPromise = null;
let lastKnownResetAt = '';
let resetGuard = false;
// Cambia en cada reinicio o stopSync: los refrescos en vuelo de una época anterior se descartan.
let syncEpoch = 0;

function clone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function emptyModel() {
  return emptySyncModel();
}

function storage() {
  return callbacks.storage || window.localStorage;
}

function localDateKey(date = new Date()) {
  const value = date instanceof Date ? date : new Date(date);
  return [
    value.getFullYear(),
    String(value.getMonth() + 1).padStart(2, '0'),
    String(value.getDate()).padStart(2, '0')
  ].join('-');
}

function daysAgoKey(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return localDateKey(date);
}

function readCachedBase(ownerUid) {
  try {
    const parsed = JSON.parse(storage().getItem(SYNC_BASE_KEY) || '{}');
    if (parsed?.ownerUid !== ownerUid) return null;
    return parsed.model || null;
  } catch {
    return null;
  }
}

function readCachedResetAt(ownerUid) {
  try {
    const parsed = JSON.parse(storage().getItem(SYNC_BASE_KEY) || '{}');
    if (parsed?.ownerUid !== ownerUid) return '';
    return parsed.resetAt || '';
  } catch {
    return '';
  }
}

function writeCachedBase(ownerUid, model, resetAt = lastKnownResetAt) {
  lastKnownResetAt = resetAt || '';
  storage().setItem(SYNC_BASE_KEY, JSON.stringify({
    ownerUid,
    savedAt: new Date().toISOString(),
    resetAt: lastKnownResetAt,
    model
  }));
}

export function clearSyncBase() {
  storage().removeItem(SYNC_BASE_KEY);
}

export function configureSyncService(options = {}) {
  db = options.db || db;
  callbacks = { ...callbacks, ...options };
}

function userDocRef(...parts) {
  return doc(db, 'users', uid, ...parts);
}

function removeUndefined(value) {
  if (Array.isArray(value)) return value.map(removeUndefined);
  if (!value || typeof value !== 'object') return value;
  const next = {};
  for (const [key, item] of Object.entries(value)) {
    if (item !== undefined) next[key] = removeUndefined(item);
  }
  return next;
}

function expandFieldMap(fields) {
  const root = {};
  for (const [path, value] of Object.entries(fields || {})) {
    const parts = path.split('.');
    let cursor = root;
    while (parts.length > 1) {
      const part = parts.shift();
      if (!cursor[part] || typeof cursor[part] !== 'object') cursor[part] = {};
      cursor = cursor[part];
    }
    const finalValue = value && typeof value === 'object' && Object.hasOwn(value, '__increment')
      ? increment(value.__increment)
      : removeUndefined(value);
    cursor[parts[0]] = finalValue;
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

function docPathRef(relativePath) {
  const parts = relativePath.split('/').filter(Boolean);
  return doc(db, 'users', uid, ...parts);
}

async function commitWrites(writes) {
  for (let index = 0; index < writes.length; index += MAX_BATCH_OPS) {
    const batch = writeBatch(db);
    writes.slice(index, index + MAX_BATCH_OPS).forEach(write => {
      batch.set(docPathRef(write.path), expandFieldMap(write.fields), { merge: true });
    });
    await batch.commit();
  }
}

async function writeFullModel(model) {
  const writes = diffModels(emptyModel(), model);
  if (writes.length) await commitWrites(writes);
}

async function readRemoteModel(daysBack = 400) {
  const [collectionsSnap, singletonsSnap, countersSnap, daysSnap] = await Promise.all([
    getDoc(userDocRef('sync', 'collections')),
    getDoc(userDocRef('sync', 'singletons')),
    getDoc(userDocRef('sync', 'counters')),
    getDocs(query(collection(db, 'users', uid, 'days'), where(documentId(), '>=', daysAgoKey(daysBack))))
  ]);
  const days = {};
  daysSnap.forEach(dayDoc => {
    days[dayDoc.id] = dayDoc.data();
  });
  return {
    schema: 5,
    collections: collectionsSnap.exists() ? collectionsSnap.data() : {},
    singletons: singletonsSnap.exists() ? flattenStampedFields(singletonsSnap.data()) : {},
    counters: countersSnap.exists() ? countersSnap.data() : {},
    days
  };
}

async function ensureBackup(rootData) {
  if (!rootData || !Object.keys(rootData).length) return;
  const existing = await getDocs(query(collection(db, 'users', uid, 'backups'), limit(1)));
  if (!existing.empty) return;
  const backupId = `legacy-${Date.now()}`;
  await setDoc(userDocRef('backups', backupId), {
    ...clone(rootData),
    backedUpAt: new Date().toISOString()
  });
}

async function runMigrationIfNeeded(rootSnap) {
  const rootData = rootSnap.exists() ? rootSnap.data() : {};
  if (rootData.schema !== 5) {
    const localState = callbacks.getLocalState ? callbacks.getLocalState() : callbacks.getState?.();
    const source = callbacks.choosePersistedState
      ? callbacks.choosePersistedState(localState || {}, rootData || {})
      : (Object.keys(rootData || {}).length ? rootData : localState || {});
    await ensureBackup(rootData);
    const legacyModel = legacyToModel(source || {}, Date.now());
    // Un cliente viejo puede sobrescribir el documento raíz (y perder `schema`) después de migrar.
    // Si ya existen datos v5, se fusionan por marca de tiempo en vez de sobrescribirlos.
    const existingV5 = await getDoc(userDocRef('sync', 'collections'));
    const model = existingV5.exists() ? mergeModels(legacyModel, await readRemoteModel(400)) : legacyModel;
    await writeFullModel(model);
    await setDoc(userDocRef(), { schema: 5, migratedAt: new Date().toISOString() }, { merge: true });
    return model;
  }

  const updatedAt = Date.parse(rootData.updatedAt || '');
  const migratedAt = Date.parse(rootData.migratedAt || '');
  if (Number.isFinite(updatedAt) && Number.isFinite(migratedAt) && updatedAt > migratedAt) {
    const remote = await readRemoteModel(400);
    const staleLegacyModel = legacyToModel(rootData, updatedAt);
    const merged = mergeModels(staleLegacyModel, remote);
    await writeFullModel(merged);
    await setDoc(userDocRef(), { migratedAt: new Date().toISOString() }, { merge: true });
    return merged;
  }

  return null;
}

function notifyStatus(status) {
  callbacks.onStatus?.(status);
}

export function hasPendingChanges() {
  if (!uid || !lastSyncedModel || !callbacks.getState) return false;
  const current = stateToModel(callbacks.getState(), { now: Date.now(), prevModel: lastSyncedModel });
  return diffModels(lastSyncedModel, current).length > 0;
}

async function refreshFromRemote() {
  if (!uid || resetGuard || remoteRefreshPromise) return remoteRefreshPromise;
  const epoch = syncEpoch;
  remoteRefreshPromise = (async () => {
    notifyStatus('applying');
    const remote = await readRemoteModel(400);
    if (epoch !== syncEpoch || resetGuard) return;
    const local = stateToModel(callbacks.getState?.() || {}, { now: Date.now(), prevModel: lastSyncedModel || remote });
    const merged = mergeModels(local, remote);
    lastSyncedModel = remote;
    writeCachedBase(uid, lastSyncedModel);
    callbacks.onRemoteChange?.(modelToState(merged, callbacks.baseState || {}));
    notifyStatus(hasPendingChanges() ? 'pending' : 'synced');
  })().catch(error => {
    console.warn('No se pudieron aplicar cambios remotos.', error);
    notifyStatus('pending');
  }).finally(() => {
    remoteRefreshPromise = null;
  });
  return remoteRefreshPromise;
}

function handleRootSnapshot(snapshot) {
  if (!snapshot.exists() || snapshot.metadata?.hasPendingWrites) return;
  const remoteResetAt = snapshot.data()?.resetAt || '';
  if (isRemoteResetNewer(lastKnownResetAt, remoteResetAt)) applyRemoteReset(remoteResetAt);
}

// Otro dispositivo ejecutó "Empezar de cero": se descarta el estado local y la base cacheada
// SIN subir nada, para no resucitar datos que ya fueron borrados en la nube (§D del plan).
function applyRemoteReset(remoteResetAt) {
  resetGuard = true;
  unsubscribeFns.forEach(unsubscribe => unsubscribe());
  unsubscribeFns = [];
  pushPromise = null;
  remoteRefreshPromise = null;
  lastSyncedModel = emptyModel();
  writeCachedBase(uid, lastSyncedModel, remoteResetAt);
  try {
    callbacks.onReset?.();
  } finally {
    resetGuard = false;
    if (uid) subscribeToRemoteChanges();
  }
}

function subscribeToRemoteChanges() {
  const handleSnapshot = snapshot => {
    if (snapshot.metadata?.hasPendingWrites) return;
    refreshFromRemote();
  };
  unsubscribeFns = [
    onSnapshot(userDocRef(), handleRootSnapshot),
    onSnapshot(userDocRef('sync', 'collections'), handleSnapshot),
    onSnapshot(userDocRef('sync', 'singletons'), handleSnapshot),
    onSnapshot(userDocRef('sync', 'counters'), handleSnapshot),
    onSnapshot(query(collection(db, 'users', uid, 'days'), where(documentId(), '>=', daysAgoKey(60))), handleSnapshot)
  ];
}

export async function startSync(ownerUid, options = {}) {
  if (!db && !options.db) throw new Error('syncService requiere una instancia de Firestore.');
  configureSyncService(options);
  stopSync({ keepBase: true });
  uid = ownerUid;
  notifyStatus(navigator.onLine === false ? 'offline' : 'saving');

  const rootSnap = await getDoc(userDocRef());
  const rootData = rootSnap.exists() ? rootSnap.data() : {};
  const remoteResetAt = rootData.resetAt || '';
  const knownResetAt = readCachedResetAt(ownerUid);

  if (isRemoteResetNewer(knownResetAt, remoteResetAt)) {
    // Otro dispositivo reinició la cuenta antes de que este dispositivo se conectara:
    // se descarta cualquier estado local pendiente y se arranca vacío, sin subir nada.
    lastSyncedModel = emptyModel();
    writeCachedBase(uid, lastSyncedModel, remoteResetAt);
    callbacks.onInitialState?.(modelToState(lastSyncedModel, callbacks.baseState || {}));
    subscribeToRemoteChanges();
    notifyStatus('synced');
    return;
  }
  lastKnownResetAt = remoteResetAt || knownResetAt || '';

  const migratedModel = await runMigrationIfNeeded(rootSnap);
  const remote = migratedModel || await readRemoteModel(400);
  const cachedBase = readCachedBase(uid);
  lastSyncedModel = cachedBase || remote;
  const local = stateToModel(callbacks.getState?.() || callbacks.getLocalState?.() || {}, {
    now: Date.now(),
    prevModel: lastSyncedModel
  });
  const merged = mergeModels(local, remote);
  lastSyncedModel = remote;
  writeCachedBase(uid, lastSyncedModel, lastKnownResetAt);
  callbacks.onInitialState?.(modelToState(merged, callbacks.baseState || {}));
  subscribeToRemoteChanges();
  if (hasPendingChanges()) await pushChanges(true);
  notifyStatus(hasPendingChanges() ? 'pending' : 'synced');
}

export async function pushChanges(quiet = false) {
  if (!uid || !callbacks.getState || resetGuard) return;
  if (pushPromise) return pushPromise;
  pushPromise = (async () => {
    if (navigator.onLine === false) {
      notifyStatus('offline');
      return;
    }
    if (!quiet) notifyStatus('saving');
    const next = stateToModel(callbacks.getState(), { now: Date.now(), prevModel: lastSyncedModel || emptyModel() });
    const writes = diffModels(lastSyncedModel || emptyModel(), next);
    if (!writes.length) {
      notifyStatus('synced');
      return;
    }
    await commitWrites(writes);
    lastSyncedModel = next;
    writeCachedBase(uid, lastSyncedModel);
    notifyStatus('synced');
  })().catch(error => {
    console.warn('Sincronización pendiente; se intentará de nuevo.', error);
    notifyStatus(navigator.onLine === false ? 'offline' : 'pending');
    throw error;
  }).finally(() => {
    pushPromise = null;
  });
  return pushPromise;
}

export function stopSync(options = {}) {
  syncEpoch++;
  unsubscribeFns.forEach(unsubscribe => unsubscribe());
  unsubscribeFns = [];
  uid = '';
  pushPromise = null;
  remoteRefreshPromise = null;
  resetGuard = false;
  lastSyncedModel = null;
  if (!options.keepBase) {
    clearSyncBase();
    lastKnownResetAt = '';
  }
}

// "Empezar de cero": borra todo el estado en la nube del usuario (colecciones sync, días,
// hilos de coach con sus mensajes e informes) en batches de máx. 400 operaciones, y luego
// reemplaza el documento raíz SIN merge para no conservar campos heredados del estado viejo.
// Los respaldos de migración (`users/{uid}/backups/*`) son inmutables por reglas y no se tocan.
export async function resetCloudData() {
  if (!uid) throw new Error('syncService no está iniciado.');
  const currentUid = uid;
  // Mientras se borra, este mismo dispositivo no debe refrescar ni subir nada: sus listeners
  // verían los borrados y podrían reponer el estado viejo.
  const inflightPush = pushPromise;
  resetGuard = true;
  syncEpoch++;
  unsubscribeFns.forEach(unsubscribe => unsubscribe());
  unsubscribeFns = [];
  remoteRefreshPromise = null;
  try {
  // Una subida que ya estaba en curso debe terminar ANTES de borrar; si no, podría aterrizar después.
  if (inflightPush) await inflightPush.catch(() => {});
  pushPromise = null;
  const rootSnap = await getDoc(userDocRef());
  const existingMigratedAt = rootSnap.exists() ? (rootSnap.data().migratedAt || '') : '';

  const refsToDelete = [
    docPathRef('sync/collections'),
    docPathRef('sync/singletons'),
    docPathRef('sync/counters')
  ];

  const daysSnap = await getDocs(collection(db, 'users', currentUid, 'days'));
  daysSnap.forEach(dayDoc => refsToDelete.push(dayDoc.ref));

  const threadsSnap = await getDocs(collection(db, 'users', currentUid, 'chatThreads'));
  for (const threadDoc of threadsSnap.docs) {
    const messagesSnap = await getDocs(collection(db, 'users', currentUid, 'chatThreads', threadDoc.id, 'messages'));
    messagesSnap.forEach(messageDoc => refsToDelete.push(messageDoc.ref));
    refsToDelete.push(threadDoc.ref);
  }

  const reportsSnap = await getDocs(collection(db, 'users', currentUid, 'reports'));
  reportsSnap.forEach(reportDoc => refsToDelete.push(reportDoc.ref));

  for (let index = 0; index < refsToDelete.length; index += MAX_BATCH_OPS) {
    const batch = writeBatch(db);
    refsToDelete.slice(index, index + MAX_BATCH_OPS).forEach(ref => batch.delete(ref));
    await batch.commit();
  }

  const resetAt = new Date().toISOString();
  await setDoc(userDocRef(), { schema: 5, migratedAt: existingMigratedAt || resetAt, resetAt });

  lastSyncedModel = emptyModel();
  writeCachedBase(currentUid, lastSyncedModel, resetAt);
  return resetAt;
  } finally {
    resetGuard = false;
  }
}

