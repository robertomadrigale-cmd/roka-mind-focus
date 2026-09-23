export function getStateTime(data) {
  const value = data && (data.updatedAt || data.lastSavedAt || data.savedAt);
  const time = value ? Date.parse(value) : 0;
  return Number.isFinite(time) ? time : 0;
}

export function hasMeaningfulUserData(data, todayKey = '') {
  if (!data || typeof data !== 'object') return false;
  return Boolean(
    (data.beliefs && data.beliefs.length) ||
    (data.mantras && data.mantras.length) ||
    (data.victories && data.victories.length) ||
    (data.prideLogs && data.prideLogs.length) ||
    (data.gratitudeLogs && data.gratitudeLogs.length) ||
    (data.smartGoals && data.smartGoals.length) ||
    (data.rituals && data.rituals.length) ||
    (data.circleOfGiants && data.circleOfGiants.length) ||
    (data.dailyTasks && Object.keys(data.dailyTasks).some(key => (data.dailyTasks[key] || []).length)) ||
    (data.userProfile && Object.values(data.userProfile).some(Boolean)) ||
    (data.personalMap && (data.personalMap.archetype || data.personalMap.enneagram || data.personalMap.productivity)) ||
    (data.weeklyReflection && (data.weeklyReflection.well || data.weeklyReflection.adjust)) ||
    (data.learning && Object.values(data.learning).some(Boolean)) ||
    (data.stopDoingList && data.stopDoingList.some(Boolean)) ||
    (data.quarterly10 && data.quarterly10.some(Boolean)) ||
    (data.annualBig5 && data.annualBig5.some(Boolean)) ||
    (data.values5 && data.values5.some(Boolean)) ||
    (data.mustBecome5 && data.mustBecome5.some(Boolean)) ||
    (todayKey && data.activityLog && data.activityLog[todayKey])
  );
}

export function selectLocalCandidateForUser(localData, uid) {
  if (!uid || !localData || typeof localData !== 'object') return {};
  if (localData.ownerUid && localData.ownerUid !== uid) return {};
  return localData;
}

export function choosePersistedState(localData, remoteData, options = {}) {
  const uid = options.uid || '';
  const todayKey = options.todayKey || '';
  const localCandidate = uid ? selectLocalCandidateForUser(localData, uid) : (localData || {});
  const remoteCandidate = remoteData || {};
  const localHasData = hasMeaningfulUserData(localCandidate, todayKey);
  const remoteHasData = hasMeaningfulUserData(remoteCandidate, todayKey);
  if (!remoteHasData && localHasData) return localCandidate;
  if (!localHasData && remoteHasData) return remoteCandidate;

  const localTime = getStateTime(localCandidate);
  const remoteTime = getStateTime(remoteCandidate);
  if (localTime || remoteTime) return localTime > remoteTime ? localCandidate : remoteCandidate;

  return localHasData ? localCandidate : remoteCandidate;
}

export function pruneStateForCloud(data, options = {}) {
  const cutoffDays = Number(options.cutoffDays || 400);
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - cutoffDays);
  const cutoffKey = options.cutoffKey || [
    cutoff.getFullYear(),
    String(cutoff.getMonth() + 1).padStart(2, '0'),
    String(cutoff.getDate()).padStart(2, '0')
  ].join('-');
  const next = JSON.parse(JSON.stringify(data || {}));
  const archive = { dailyTasks: {}, activityLog: {} };

  for (const [key, value] of Object.entries(next.dailyTasks || {})) {
    if (key < cutoffKey) {
      archive.dailyTasks[key] = value;
      delete next.dailyTasks[key];
    }
  }
  for (const [key, value] of Object.entries(next.activityLog || {})) {
    if (key < cutoffKey) {
      archive.activityLog[key] = value;
      delete next.activityLog[key];
    }
  }

  next.localArchive = {
    ...(next.localArchive || {}),
    dailyTasks: { ...(next.localArchive?.dailyTasks || {}), ...archive.dailyTasks },
    activityLog: { ...(next.localArchive?.activityLog || {}), ...archive.activityLog }
  };
  return { state: next, archive, cutoffKey };
}

export function jsonSizeBytes(data) {
  return new TextEncoder().encode(JSON.stringify(data || {})).length;
}
