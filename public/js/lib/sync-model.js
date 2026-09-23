const COLLECTION_STATE_KEYS = {
  goals: 'smartGoals',
  rituals: 'rituals',
  beliefs: 'beliefs',
  mantras: 'mantras',
  circleOfGiants: 'circleOfGiants',
  weeklyReviews: 'weeklyReviews',
  aiReports: 'aiReports'
};

const LOG_COLLECTIONS = [
  ['prideLogs', 'pride'],
  ['gratitudeLogs', 'gratitude'],
  ['victories', 'victory']
];

const EXCLUDED_SINGLETONS = new Set([
  'smartGoals',
  'rituals',
  'beliefs',
  'mantras',
  'circleOfGiants',
  'weeklyReviews',
  'aiReports',
  'dailyTasks',
  'prideLogs',
  'gratitudeLogs',
  'victories',
  'activityLog',
  'focusLog',
  'gamification',
  'pendingCloudSync',
  'lastCloudSyncError',
  'ownerUid'
]);

function clone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (!isPlainObject(value)) return JSON.stringify(value);
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function withoutSyncMeta(value) {
  if (Array.isArray(value)) return value.map(withoutSyncMeta);
  if (!isPlainObject(value)) return value;
  const next = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === '_u' || key === '_d') continue;
    next[key] = withoutSyncMeta(item);
  }
  return next;
}

function sameValue(a, b) {
  return stableStringify(withoutSyncMeta(a)) === stableStringify(withoutSyncMeta(b));
}

function stateTime(state, fallback) {
  const value = state && (state.updatedAt || state.lastSavedAt || state.savedAt);
  const parsed = value ? Date.parse(value) : 0;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function ensureModel(model = {}) {
  return {
    schema: 5,
    collections: clone(model.collections) || {},
    singletons: clone(model.singletons) || {},
    counters: clone(model.counters) || {},
    days: clone(model.days) || {}
  };
}

function stableId(prefix, item, index, used) {
  const raw = item?.id || item?._id || item?.key || item?.slug;
  let id = raw ? String(raw) : `${prefix}-${hashString(stableStringify(item || {}) || String(index))}`;
  if (!id) id = `${prefix}-${index}`;
  const base = id.replace(/[.[\]*/]/g, '-');
  id = base;
  let suffix = 2;
  while (used.has(id)) {
    id = `${base}-${suffix}`;
    suffix += 1;
  }
  used.add(id);
  return id;
}

function stampValue(payload, previous, now) {
  const prev = previous && !previous._d ? previous : null;
  const stampedAt = prev && sameValue(prev, payload) ? Number(prev._u || now) : now;
  return { ...clone(payload), _u: stampedAt };
}

function stampSingleton(value, previous, now) {
  const prev = previous && !previous._d ? previous : null;
  const stampedAt = prev && sameValue(prev.v, value) ? Number(prev._u || now) : now;
  return { v: clone(value), _u: stampedAt };
}

function tombstoneMissing(previousGroup = {}, nextGroup = {}, now) {
  for (const id of Object.keys(previousGroup || {})) {
    if (!Object.hasOwn(nextGroup, id)) nextGroup[id] = { _d: true, _u: now };
  }
}

function stripRitualCompletions(ritual) {
  const next = clone(ritual) || {};
  delete next.completions;
  return next;
}

function collectRitualCompletions(state) {
  const completions = {};
  for (const ritual of state?.rituals || []) {
    if (!ritual?.id) continue;
    for (const [date, done] of Object.entries(ritual.completions || {})) {
      if (done) {
        if (!completions[date]) completions[date] = {};
        completions[date][ritual.id] = true;
      }
    }
    for (const value of Object.values(ritual.days || {})) {
      if (typeof value === 'string' && value.startsWith('completed_')) {
        const date = value.slice('completed_'.length);
        if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
          if (!completions[date]) completions[date] = {};
          completions[date][ritual.id] = true;
        }
      }
    }
  }
  return completions;
}

function buildCollectionModel(state, prevModel, now) {
  const collections = {};
  for (const [remoteKey, stateKey] of Object.entries(COLLECTION_STATE_KEYS)) {
    const previousGroup = prevModel.collections?.[remoteKey] || {};
    const group = {};
    const used = new Set();
    (state?.[stateKey] || []).forEach((item, index) => {
      const id = stableId(remoteKey, item, index, used);
      const payload = remoteKey === 'rituals' ? stripRitualCompletions(item) : clone(item);
      if (!payload.id) payload.id = id;
      group[id] = stampValue(payload, previousGroup[id], now);
    });
    tombstoneMissing(previousGroup, group, now);
    collections[remoteKey] = group;
  }
  return collections;
}

function buildSingletonModel(state, prevModel, now) {
  const singletons = {};
  for (const [key, value] of Object.entries(state || {})) {
    if (EXCLUDED_SINGLETONS.has(key)) continue;
    singletons[key] = stampSingleton(value, prevModel.singletons?.[key], now);
  }
  const gamification = state?.gamification || {};
  singletons['gamification.level'] = stampSingleton(Number(gamification.level || 1), prevModel.singletons?.['gamification.level'], now);
  singletons['gamification.badges'] = stampSingleton(Array.isArray(gamification.badges) ? gamification.badges : [], prevModel.singletons?.['gamification.badges'], now);
  tombstoneMissing(prevModel.singletons, singletons, now);
  return singletons;
}

function buildDaysModel(state, prevModel, now) {
  const days = {};
  const dates = new Set([
    ...Object.keys(prevModel.days || {}),
    ...Object.keys(state?.dailyTasks || {}),
    ...Object.keys(state?.activityLog || {}),
    ...Object.keys(state?.focusLog || {})
  ]);

  const ritualCompletions = collectRitualCompletions(state);
  Object.keys(ritualCompletions).forEach(date => dates.add(date));
  for (const [stateKey] of LOG_COLLECTIONS) {
    for (const item of state?.[stateKey] || []) {
      if (item?.date) dates.add(item.date);
    }
  }

  for (const date of [...dates].filter(key => /^\d{4}-\d{2}-\d{2}$/.test(key))) {
    const previous = prevModel.days?.[date] || {};
    const day = { tasks: {}, logs: {}, ritualDone: {} };
    const usedTasks = new Set();
    (state?.dailyTasks?.[date] || []).forEach((task, index) => {
      const id = stableId('task', task, index, usedTasks);
      const payload = { ...clone(task), id, order: index };
      day.tasks[id] = stampValue(payload, previous.tasks?.[id], now);
    });
    tombstoneMissing(previous.tasks, day.tasks, now);

    const usedLogs = new Set();
    for (const [stateKey, kind] of LOG_COLLECTIONS) {
      (state?.[stateKey] || []).filter(item => item?.date === date).forEach((item, index) => {
        const id = stableId(kind, item, index, usedLogs);
        const payload = { ...clone(item), id, kind };
        day.logs[id] = stampValue(payload, previous.logs?.[id], now);
      });
    }
    tombstoneMissing(previous.logs, day.logs, now);

    for (const [ritualId, value] of Object.entries(ritualCompletions[date] || {})) {
      day.ritualDone[ritualId] = stampSingleton(Boolean(value), previous.ritualDone?.[ritualId], now);
    }
    tombstoneMissing(previous.ritualDone, day.ritualDone, now);

    day.activity = Number(state?.activityLog?.[date] || 0);
    day.focus = Number(state?.focusLog?.[date] || 0);
    days[date] = day;
  }
  return days;
}

export function stateToModel(state = {}, options = {}) {
  const now = Number(options.now || Date.now());
  const prevModel = ensureModel(options.prevModel || {});
  return {
    schema: 5,
    collections: buildCollectionModel(state, prevModel, now),
    singletons: buildSingletonModel(state, prevModel, now),
    counters: { xp: Number(state?.gamification?.xp || 0) },
    days: buildDaysModel(state, prevModel, now)
  };
}

function liveItems(group = {}) {
  return Object.values(group || {}).filter(item => item && !item._d).map(item => withoutSyncMeta(item));
}

function sortByOrderThenDate(items) {
  return items.sort((a, b) => Number(a.order ?? 999999) - Number(b.order ?? 999999) || String(a.date || a.createdAt || '').localeCompare(String(b.date || b.createdAt || '')));
}

export function modelToState(model = {}, baseState = {}) {
  const data = ensureModel(model);
  const state = clone(baseState) || {};
  for (const [remoteKey, stateKey] of Object.entries(COLLECTION_STATE_KEYS)) {
    state[stateKey] = liveItems(data.collections[remoteKey]);
  }
  state.smartGoals = state.smartGoals || [];
  state.rituals = (state.rituals || []).map(ritual => ({ ...ritual, completions: {} }));

  for (const [key, entry] of Object.entries(data.singletons || {})) {
    if (!entry || entry._d) continue;
    if (key === 'gamification.level' || key === 'gamification.badges') continue;
    state[key] = clone(entry.v);
  }

  const gamification = { ...(state.gamification || {}) };
  gamification.xp = Number(data.counters?.xp || 0);
  gamification.level = Number(data.singletons?.['gamification.level']?.v || gamification.level || 1);
  gamification.badges = clone(data.singletons?.['gamification.badges']?.v || gamification.badges || []);
  state.gamification = gamification;

  state.dailyTasks = {};
  state.prideLogs = [];
  state.gratitudeLogs = [];
  state.victories = [];
  state.activityLog = {};
  state.focusLog = {};

  for (const [date, day] of Object.entries(data.days || {})) {
    const tasks = sortByOrderThenDate(liveItems(day.tasks)).map(task => {
      const next = { ...task };
      delete next.order;
      return next;
    });
    if (tasks.length) state.dailyTasks[date] = tasks;

    for (const log of sortByOrderThenDate(liveItems(day.logs))) {
      const next = { ...log };
      const kind = next.kind;
      delete next.kind;
      if (kind === 'gratitude') state.gratitudeLogs.push(next);
      else if (kind === 'victory') state.victories.push(next);
      else state.prideLogs.push(next);
    }

    for (const [ritualId, entry] of Object.entries(day.ritualDone || {})) {
      if (!entry || entry._d || !entry.v) continue;
      const ritual = state.rituals.find(item => item.id === ritualId);
      if (ritual) {
        if (!ritual.completions) ritual.completions = {};
        ritual.completions[date] = true;
      }
    }

    if (Number(day.activity || 0) !== 0) state.activityLog[date] = Number(day.activity || 0);
    if (Number(day.focus || 0) !== 0) state.focusLog[date] = Number(day.focus || 0);
  }

  return state;
}

function pickLww(localItem, remoteItem) {
  if (localItem === undefined) return clone(remoteItem);
  if (remoteItem === undefined) return clone(localItem);
  const localTime = Number(localItem?._u || 0);
  const remoteTime = Number(remoteItem?._u || 0);
  return clone(remoteTime >= localTime ? remoteItem : localItem);
}

function mergeStampedGroups(localGroup = {}, remoteGroup = {}) {
  const merged = {};
  for (const id of new Set([...Object.keys(localGroup || {}), ...Object.keys(remoteGroup || {})])) {
    merged[id] = pickLww(localGroup?.[id], remoteGroup?.[id]);
  }
  return merged;
}

export function mergeModels(local = {}, remote = {}, options = {}) {
  const left = ensureModel(local);
  const right = ensureModel(remote);
  const merged = { schema: 5, collections: {}, singletons: {}, counters: {}, days: {} };

  for (const key of new Set([...Object.keys(left.collections), ...Object.keys(right.collections)])) {
    merged.collections[key] = mergeStampedGroups(left.collections[key], right.collections[key]);
  }
  merged.singletons = mergeStampedGroups(left.singletons, right.singletons);

  const pending = options.pendingCounterDeltas || {};
  merged.counters.xp = Number(right.counters?.xp || 0) + Number(pending.xp || 0);

  for (const date of new Set([...Object.keys(left.days), ...Object.keys(right.days)])) {
    const localDay = left.days[date] || {};
    const remoteDay = right.days[date] || {};
    merged.days[date] = {
      tasks: mergeStampedGroups(localDay.tasks, remoteDay.tasks),
      logs: mergeStampedGroups(localDay.logs, remoteDay.logs),
      ritualDone: mergeStampedGroups(localDay.ritualDone, remoteDay.ritualDone),
      activity: Number(remoteDay.activity || 0) + Number(pending.days?.[date]?.activity || 0),
      focus: Number(remoteDay.focus || 0) + Number(pending.days?.[date]?.focus || 0)
    };
  }
  return merged;
}

function setField(writeMap, docPath, fieldPath, value) {
  if (!writeMap.has(docPath)) writeMap.set(docPath, {});
  writeMap.get(docPath)[fieldPath] = value;
}

function diffStampedGroup(writeMap, docPath, prefix, prevGroup = {}, nextGroup = {}) {
  for (const id of new Set([...Object.keys(prevGroup || {}), ...Object.keys(nextGroup || {})])) {
    const previous = prevGroup?.[id];
    const next = nextGroup?.[id];
    if (next === undefined) continue;
    if (stableStringify(previous) !== stableStringify(next)) setField(writeMap, docPath, `${prefix}.${id}`, clone(next));
  }
}

export function diffModels(prev = {}, next = {}) {
  const before = ensureModel(prev);
  const after = ensureModel(next);
  const writeMap = new Map();

  for (const key of new Set([...Object.keys(before.collections), ...Object.keys(after.collections)])) {
    diffStampedGroup(writeMap, 'sync/collections', key, before.collections[key], after.collections[key]);
  }

  for (const key of new Set([...Object.keys(before.singletons), ...Object.keys(after.singletons)])) {
    const previous = before.singletons[key];
    const value = after.singletons[key];
    if (value !== undefined && stableStringify(previous) !== stableStringify(value)) setField(writeMap, 'sync/singletons', key, clone(value));
  }

  const xpDelta = Number(after.counters?.xp || 0) - Number(before.counters?.xp || 0);
  if (xpDelta !== 0) setField(writeMap, 'sync/counters', 'xp', { __increment: xpDelta });

  for (const date of new Set([...Object.keys(before.days), ...Object.keys(after.days)])) {
    const previous = before.days[date] || {};
    const value = after.days[date] || {};
    diffStampedGroup(writeMap, `days/${date}`, 'tasks', previous.tasks, value.tasks);
    diffStampedGroup(writeMap, `days/${date}`, 'logs', previous.logs, value.logs);
    diffStampedGroup(writeMap, `days/${date}`, 'ritualDone', previous.ritualDone, value.ritualDone);
    const activityDelta = Number(value.activity || 0) - Number(previous.activity || 0);
    const focusDelta = Number(value.focus || 0) - Number(previous.focus || 0);
    if (activityDelta !== 0) setField(writeMap, `days/${date}`, 'activity', { __increment: activityDelta });
    if (focusDelta !== 0) setField(writeMap, `days/${date}`, 'focus', { __increment: focusDelta });
  }

  return [...writeMap.entries()]
    .filter(([, fields]) => Object.keys(fields).length)
    .map(([path, fields]) => ({ path, fields }));
}

export function legacyToModel(legacyState = {}, now = Date.now()) {
  const stampedAt = stateTime(legacyState, Number(now || Date.now()));
  return stateToModel(legacyState, { now: stampedAt });
}

