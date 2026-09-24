import { localDateKey } from './dates.js';

const DAY_MS = 86400000;
const DAY_KEYS = ['dom', 'lun', 'mar', 'mie', 'jue', 'vie', 'sab'];
const LIFE_AREA_KEYS = ['lifestyle', 'contribution', 'joy', 'freedom', 'mindset', 'creativity', 'energy', 'production', 'connection', 'economy'];

function clone(value) {
  return JSON.parse(JSON.stringify(value || {}));
}

function dateFromKey(key) {
  const [year, month, day] = String(key || '').split('-').map(Number);
  return new Date(year || 0, (month || 1) - 1, day || 1);
}

function toDateKey(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : localDateKey(value);
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function dayKeyFor(dateKey) {
  return DAY_KEYS[dateFromKey(dateKey).getDay()];
}

function clampProgress(value) {
  return Math.min(100, Math.max(0, Number(value || 0)));
}

function isActiveGoal(goal) {
  return goal && goal.status !== 'done' && goal.status !== 'paused' && goal.completed !== true;
}

function isRitualScheduled(ritual, dateKey) {
  return Boolean(ritual?.days?.[dayKeyFor(dateKey)] === true);
}

function isRitualCompleted(ritual, dateKey) {
  return Boolean(ritual?.completions?.[dateKey] || ritual?.days?.[dayKeyFor(dateKey)] === `completed_${dateKey}`);
}

export function weekKey(date = new Date()) {
  const value = date instanceof Date ? new Date(date) : dateFromKey(toDateKey(date));
  if (Number.isNaN(value.getTime())) return '';
  const day = value.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  value.setDate(value.getDate() + diff);
  return localDateKey(value);
}

export function ritualAdherence(state, ritualId, endDate = new Date(), days = 7) {
  const data = state || {};
  const ritual = (data.rituals || []).find(item => item.id === ritualId);
  const end = dateFromKey(toDateKey(endDate));
  let scheduled = 0;
  let completed = 0;
  for (let i = Math.max(1, Number(days || 7)) - 1; i >= 0; i--) {
    const key = localDateKey(addDays(end, -i));
    if (ritual && isRitualScheduled(ritual, key)) {
      scheduled++;
      if (isRitualCompleted(ritual, key)) completed++;
    }
  }
  return { ritualId, scheduled, completed, rate: scheduled ? Math.round((completed / scheduled) * 100) : 0 };
}

export function weekStats(state, key = weekKey(), today = localDateKey()) {
  const data = state || {};
  const start = dateFromKey(key);
  const dates = Array.from({ length: 7 }, (_, index) => localDateKey(addDays(start, index)));
  let tasksTotal = 0;
  let tasksCompleted = 0;
  let ritualsScheduled = 0;
  let ritualsCompleted = 0;
  let focusSessions = 0;
  const activeDays = new Set();

  dates.forEach(dateKey => {
    const tasks = data.dailyTasks?.[dateKey] || [];
    tasksTotal += tasks.length;
    tasksCompleted += tasks.filter(task => task.completed).length;
    if (tasks.length || data.activityLog?.[dateKey]) activeDays.add(dateKey);
    focusSessions += Number(data.focusLog?.[dateKey] || 0);
    // Los días futuros de la semana aún no pueden cumplirse: no cuentan para el % de rituales.
    if (dateKey > toDateKey(today)) return;
    (data.rituals || []).forEach(ritual => {
      if (isRitualScheduled(ritual, dateKey)) {
        ritualsScheduled++;
        if (isRitualCompleted(ritual, dateKey)) ritualsCompleted++;
      }
    });
  });

  const goalProgress = (data.smartGoals || []).filter(isActiveGoal).map(goal => {
    const history = (goal.progressHistory || []).filter(entry => dates.includes(entry.date));
    const from = history.length ? Number(history[0].progress || 0) : Number(goal.progress || 0);
    const to = history.length ? Number(history[history.length - 1].progress || 0) : Number(goal.progress || 0);
    return { goalId: goal.id, from, to, delta: to - from };
  });

  return {
    weekKey: key,
    tasksCompleted,
    tasksTotal,
    taskRate: tasksTotal ? Math.round((tasksCompleted / tasksTotal) * 100) : 0,
    ritualsCompleted,
    ritualsScheduled,
    ritualRate: ritualsScheduled ? Math.round((ritualsCompleted / ritualsScheduled) * 100) : 0,
    focusSessions,
    activeDays: activeDays.size,
    goalProgress
  };
}

export function goalNextSteps(state, today = localDateKey()) {
  const data = state || {};
  const focusIds = data.weekFocus?.goalIds || [];
  const todayTasks = data.dailyTasks?.[toDateKey(today)] || [];
  return (data.smartGoals || [])
    .filter(isActiveGoal)
    .map(goal => ({
      id: goal.id,
      goal: goal.goal || '',
      nextStep: goal.nextStep || '',
      priority: focusIds.includes(goal.id) ? 0 : 1,
      missing: !String(goal.nextStep || '').trim(),
      plannedToday: todayTasks.some(task => task.goalId === goal.id && task.text === goal.nextStep)
    }))
    .sort((a, b) => a.priority - b.priority);
}

export function overdueTasks(state, today = localDateKey(), maxDays = 14) {
  const data = state || {};
  const todayDate = dateFromKey(toDateKey(today));
  const results = [];
  for (let i = 1; i <= Number(maxDays || 14); i++) {
    const date = localDateKey(addDays(todayDate, -i));
    (data.dailyTasks?.[date] || []).forEach(task => {
      if (!task.completed) results.push({ ...task, date });
    });
  }
  return results;
}

export function carryOverTasks(state, today = localDateKey(), ids = []) {
  today = toDateKey(today);
  const next = clone(state);
  if (!next.dailyTasks) next.dailyTasks = {};
  if (!next.dailyTasks[today]) next.dailyTasks[today] = [];
  const wanted = new Set(ids);
  for (const task of overdueTasks(next, today, 14)) {
    if (wanted.size && !wanted.has(task.id)) continue;
    const source = next.dailyTasks[task.date] || [];
    const index = source.findIndex(item => item.id === task.id);
    if (index >= 0) source.splice(index, 1);
    next.dailyTasks[today].push({ ...task, id: `${task.id}-carry-${today}`, carriedFrom: task.carriedFrom || task.date, completed: false });
  }
  return next;
}

export function completeTaskEffects(state, date, taskId) {
  const next = clone(state);
  const task = (next.dailyTasks?.[date] || []).find(item => item.id === taskId);
  if (!task) return next;
  task.completed = true;
  task.completedAt = task.completedAt || new Date().toISOString();
  const goal = task.goalId ? (next.smartGoals || []).find(item => item.id === task.goalId) : null;
  if (goal && String(goal.nextStep || '').trim().toLowerCase() === String(task.text || '').trim().toLowerCase()) {
    goal.nextStep = '';
    task.needsGoalFollowUp = true;
  }
  return next;
}

export function migrateState(input = {}) {
  const next = clone(input);
  next.stateVersion = 4;
  next.smartGoals = (next.smartGoals || []).map(goal => {
    const progress = clampProgress(goal.progress);
    const status = goal.status || (goal.completed ? 'done' : 'active');
    return {
      ...goal,
      big5Index: Number.isInteger(goal.big5Index) ? goal.big5Index : null,
      lifeArea: goal.lifeArea || '',
      status,
      progress,
      progressHistory: Array.isArray(goal.progressHistory) ? goal.progressHistory : [],
      createdAt: goal.createdAt || goal.startDate || ''
    };
  });
  next.dailyTasks = next.dailyTasks || {};
  Object.keys(next.dailyTasks).forEach(date => {
    next.dailyTasks[date] = (next.dailyTasks[date] || []).map(task => ({ ...task }));
  });
  next.rituals = (next.rituals || []).map(ritual => ({
    ...ritual,
    goalId: ritual.goalId || '',
    lifeArea: ritual.lifeArea || '',
    createdAt: ritual.createdAt || ''
  }));
  next.weeklyReviews = (next.weeklyReviews || []).slice(-104);
  next.weekFocus = next.weekFocus || { weekKey: weekKey(), goalIds: [] };
  return next;
}

export function shouldPromptWeeklyReview(state, today = localDateKey()) {
  const data = state || {};
  today = toDateKey(today);
  const currentWeek = weekKey(today);
  if ((data.weeklyReviews || []).some(review => review.weekKey === currentWeek)) return false;
  const day = dateFromKey(today).getDay();
  const isReviewWindow = [0, 1, 5, 6].includes(day);
  const last = [...(data.weeklyReviews || [])].sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))[0];
  const lastDate = last?.createdAt ? localDateKey(last.createdAt) : data.sectionDates?.weekly;
  if (!lastDate) return isReviewWindow;
  const elapsed = Math.floor((dateFromKey(today) - dateFromKey(lastDate)) / DAY_MS);
  return isReviewWindow || elapsed > 7;
}

export function lowLifeAreas(state, threshold = 4) {
  const wheel = state?.lifeWheel || {};
  return LIFE_AREA_KEYS
    .filter(key => Number(wheel[key] || 0) <= Number(threshold || 4))
    .map(key => ({ key, value: Number(wheel[key] || 0) }));
}
