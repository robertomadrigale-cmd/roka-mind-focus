import { initializeApp } from "https://www.gstatic.com/firebasejs/12.14.0/firebase-app.js";
import { getAuth, GoogleAuthProvider, browserLocalPersistence, getRedirectResult, setPersistence, signInWithPopup, signInWithRedirect, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.14.0/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, deleteDoc, collection, getDocs, query, orderBy, limit } from "https://www.gstatic.com/firebasejs/12.14.0/firebase-firestore.js";
import { Timer } from "./components/Timer.js";
import { LifeWheel, LIFE_WHEEL_AXES } from "./components/LifeWheel.js";
import { localDateKey } from "./lib/dates.js";
import { choosePersistedState, hasMeaningfulUserData, jsonSizeBytes, pruneStateForCloud, selectLocalCandidateForUser } from "./lib/persistence.js";
import { carryOverTasks, completeTaskEffects, goalNextSteps, lowLifeAreas, migrateState as migrateSystemState, overdueTasks, ritualAdherence, shouldPromptWeeklyReview, weekKey, weekStats } from "./lib/system.js";
import { callAIGateway } from "./services/aiGateway.js?v=10.8";
import { renderSafeMarkdown, reportPreview } from "./services/markdown.js";

// ==========================================
// ROKA MIND FOCUS — Application Core v2.0
// Firebase PWA Edition
// ==========================================

const firebaseConfig = {
  apiKey: "AIzaSyAUf2LBni-orPdWJgrxFdeVx2RmP3od-5w",
  authDomain: "roka-zen-full.firebaseapp.com",
  projectId: "roka-zen-full",
  storageBucket: "roka-zen-full.firebasestorage.app",
  messagingSenderId: "586484543470",
  appId: "1:586484543470:web:4c666f06aad3762929e8ff",
  measurementId: "G-4STJCFDQ6F"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app, "rokazenfull");
let currentUser = null;
let timerComponent = null;
let lifeWheelComponent = null;
let selectedCalendarDate = todayStr();

// ─── DEFAULT STATE ───
const DEFAULT_STATE = {
  stateVersion: 4,
  updatedAt: '',
  pendingCloudSync: false,
  beliefs: [], mantras: [], victories: [], prideLogs: [], gratitudeLogs: [],
  smartGoals: [], rituals: [], circleOfGiants: [],
  userProfile: { name: '', archetype: '', vision: '', fears: '', values: '', learning: '', lifeHistory: '', enneagram: '', birthDate: '', birthTime: '', birthPlace: '' },
  aiConfig: { prompt: '' },
  coachPreferences: { style: 'direct', useCoreContext: true, useSensitiveContext: false },
  aiReports: [],
  reportsMigrated: false,
  personalMap: {
    archetypeAnswers: {},
    enneagramAnswers: {},
    productivityAnswers: {},
    archetype: '',
    enneagram: '',
    productivity: '',
    summary: ''
  },
  gamification: { xp: 0, level: 1, badges: [] },
  lifeWheel: { lifestyle:5,contribution:5,joy:5,freedom:5,mindset:5,creativity:5,energy:5,production:5,connection:5,economy:5 },
  annualBig5: ['','','','',''], values5: ['','','','',''], mustBecome5: ['','','','',''],
  quarterly10: ['','','','','','','','','',''],
  weeklyReflection: { well:'', adjust:'' },
  weeklyReviews: [],
  weekFocus: { weekKey: '', goalIds: [] },
  settings: { advancedTools: false },
  learning: { book:'', course:'', conference:'', mastermind:'' },
  visionText: '',
  sectionDates: { weekly:'', learning:'', stopDoing:'', quarterly:'', annual:'' },
  dailyTasks: {},
  stopDoingList: ['','','','','','','','','',''],
  activityLog: {},
  focusLog: {},
  hasSeenOnboarding: false,
  onboarding: { status: 'not_started', completedAt: '', step: 0 }
};

const AI_PROVIDER_DEFAULTS = {
  openai: 'gpt-4o',
  google: 'gemini-2.5-flash',
  deepseek: 'deepseek-chat'
};
const AI_PROVIDER_KEY = 'rokaMindAIProvider';
const AI_MODEL_KEY = 'rokaMindAIModel';
const AI_SESSION_KEY = 'rokaMindAIKey';
const CLOUD_SAVE_DEBOUNCE_MS = 1500;
const CLOUD_STATE_WARN_BYTES = 800 * 1024;
const THEME_PRESET_KEY = 'rokaMindThemePreset';
const THEME_PRESETS = [
  { code: 'zen-garden', name: 'Zen', description: 'Niebla, piedra y calma profunda', swatches: ['#07120e', '#163226', '#8fcfba', '#d8c08a'] },
  { code: 'paper', name: 'Papel', description: 'Claro y descansado', swatches: ['#EFE8DA', '#FFF9EF', '#8E6A3C'] },
  { code: 'graphite', name: 'Grafito', description: 'Oscuro de alto contraste', swatches: ['#080A0D', '#171C24', '#78B7FF'] }
];
const THEME_CLASS_NAMES = THEME_PRESETS.map(preset => `theme-${preset.code}`);
const THEME_AUTO_LIGHT = 'paper';
const THEME_AUTO_DARK = 'zen-garden';

const STORAGE_KEY = 'rokaMindState';
let state = JSON.parse(JSON.stringify(DEFAULT_STATE));
let appInitialized = false;
let calDate = new Date();
let coachThreads = [];
let activeCoachThreadId = '';
let activeCoachMessages = [];
let reportCache = [];
let lastAuthUid = '';
let cloudSaveTimer = null;
let pendingCloudSavePromise = null;

function deepMerge(t, s) {
  const r = { ...t };
  for (const k in s) {
    if (s[k] && typeof s[k]==='object' && !Array.isArray(s[k])) r[k] = deepMerge(t[k]||{}, s[k]);
    else if (s[k] !== undefined) r[k] = s[k];
  }
  return r;
}

function normalizeState() {
  state = migrateSystemState(state);
  state.stateVersion = Number(state.stateVersion || 1);
  if (!state.updatedAt) state.updatedAt = '';
  if (!state.gratitudeLogs) state.gratitudeLogs = [];
  if (!state.activityLog) state.activityLog = {};
  if (!state.dailyTasks) state.dailyTasks = {};
  if (!state.ritualCompletions) state.ritualCompletions = {};
  if (!state.sectionDates) state.sectionDates = { weekly:'', learning:'', stopDoing:'', quarterly:'', annual:'' };
  if (!state.rituals) state.rituals = [];
  state.rituals.forEach(ritual => {
    if (!ritual.completions) ritual.completions = {};
    if (!ritual.days) ritual.days = { lun:false, mar:false, mie:false, jue:false, vie:false, sab:false, dom:false };
  });
  if (!state.smartGoals) state.smartGoals = [];
  if (!state.personalMap) state.personalMap = JSON.parse(JSON.stringify(DEFAULT_STATE.personalMap));
  state.personalMap = deepMerge(DEFAULT_STATE.personalMap, state.personalMap);
  if (!state.aiReports) state.aiReports = [];
  if (!state.userProfile) state.userProfile = JSON.parse(JSON.stringify(DEFAULT_STATE.userProfile));
  if (!state.aiConfig) state.aiConfig = JSON.parse(JSON.stringify(DEFAULT_STATE.aiConfig));
  delete state.aiConfig.apiKey;
  delete state.aiConfig.provider;
  delete state.aiConfig.model;
  state.coachPreferences = deepMerge(DEFAULT_STATE.coachPreferences, state.coachPreferences || {});
  state.onboarding = deepMerge(DEFAULT_STATE.onboarding, state.onboarding || {});
  state.settings = deepMerge(DEFAULT_STATE.settings, state.settings || {});
  if (!state.weeklyReviews) state.weeklyReviews = [];
  if (!state.weekFocus) state.weekFocus = { weekKey: weekKey(), goalIds: [] };
  if (!state.weekFocus.weekKey) state.weekFocus.weekKey = weekKey();
  if (!Array.isArray(state.weekFocus.goalIds)) state.weekFocus.goalIds = [];
  if (state.hasSeenOnboarding && state.onboarding.status === 'not_started') state.onboarding.status = 'completed';
  state.smartGoals = state.smartGoals.map(goal => ({
    progress: 0,
    nextStep: '',
    status: goal.completed ? 'done' : 'active',
    big5Index: null,
    lifeArea: '',
    progressHistory: [],
    createdAt: goal.startDate || '',
    ...goal,
    progress: Math.min(100, Math.max(0, Number(goal.progress || 0))),
    status: goal.status || (goal.completed ? 'done' : 'active')
  }));
  state.stateVersion = DEFAULT_STATE.stateVersion;
  if (currentUser) state.ownerUid = currentUser.uid;
}

function parseStoredState(raw) {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch(e) {
    return {};
  }
}

const FETCH_TIMEOUT_MS = 12000;
function withTimeout(promise) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Firebase timeout')), FETCH_TIMEOUT_MS))
  ]);
}

function getCloudSafeState() {
  const { state: prunedState, archive } = pruneStateForCloud(state);
  if (Object.keys(archive.dailyTasks).length || Object.keys(archive.activityLog).length) {
    state.localArchive = prunedState.localArchive;
    state.dailyTasks = prunedState.dailyTasks || {};
    state.activityLog = prunedState.activityLog || {};
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }
  const cloudState = JSON.parse(JSON.stringify(prunedState));
  cloudState.pendingCloudSync = false;
  delete cloudState.lastCloudSyncError;
  delete cloudState.ownerUid;
  delete cloudState.localArchive;
  if (cloudState.aiConfig) {
    delete cloudState.aiConfig.apiKey;
    delete cloudState.aiConfig.provider;
    delete cloudState.aiConfig.model;
  }
  return cloudState;
}

function getLocalCandidateForCurrentUser() {
  const localData = parseStoredState(localStorage.getItem(STORAGE_KEY));
  return currentUser ? selectLocalCandidateForUser(localData, currentUser.uid) : localData;
}

function loadLocalState() {
  const localData = getLocalCandidateForCurrentUser();
  state = deepMerge(DEFAULT_STATE, localData);
  normalizeState();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function applyFirstRunDefaultsIfNeeded() {
  if (!currentUser || state.onboarding.status !== 'not_started' || hasMeaningfulUserData(state, todayStr())) return false;
  setTimeout(() => startOnboardingTour(), 700);
  return true;
}

async function reconcileCloudStateInBackground() {
  if (!currentUser) return;
  updateAccountSyncStatus('saving');
  const beforeUpdatedAt = state.updatedAt;
  const localData = getLocalCandidateForCurrentUser();
  let shouldSyncLocalToCloud = false;
  try {
    const docRef = doc(db, "users", currentUser.uid);
    const docSnap = await withTimeout(getDoc(docRef));
    if (docSnap.exists()) {
      const remoteData = docSnap.data();
      const chosen = choosePersistedState(localData, remoteData, { uid: currentUser.uid, todayKey: todayStr() });
      shouldSyncLocalToCloud = chosen === localData && hasMeaningfulUserData(localData, todayStr());
      state = deepMerge(DEFAULT_STATE, chosen);
    } else {
      state = deepMerge(DEFAULT_STATE, localData);
      shouldSyncLocalToCloud = hasMeaningfulUserData(localData, todayStr());
    }
    normalizeState();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    if (shouldSyncLocalToCloud) {
      await saveState(true);
      await flushCloudSave();
    }
    else {
      state.pendingCloudSync = false;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      updateAccountSyncStatus('synced');
    }
    if (beforeUpdatedAt !== state.updatedAt) renderAll();
  } catch(e) {
    console.warn('No se pudo sincronizar Firebase al inicio; la app queda usable con datos locales.', e);
    updateAccountSyncStatus(state.pendingCloudSync ? 'pending' : 'synced');
  }
}

async function saveState(quiet = false) {
  if (!quiet) showSaveStatus('saving');
  state.updatedAt = new Date().toISOString();
  state.pendingCloudSync = !!currentUser;
  if (currentUser) state.ownerUid = currentUser.uid;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  if (currentUser) updateAccountSyncStatus('saving');

  if (!currentUser) {
    state.pendingCloudSync = false;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    if (!quiet) showSaveStatus('saved', 'Guardado en este dispositivo');
    return;
  }

  scheduleCloudSave(quiet);
}

function scheduleCloudSave(quiet = false) {
  clearTimeout(cloudSaveTimer);
  cloudSaveTimer = setTimeout(() => {
    pendingCloudSavePromise = writeCloudState(quiet).finally(() => {
      pendingCloudSavePromise = null;
    });
  }, CLOUD_SAVE_DEBOUNCE_MS);
}

async function flushCloudSave(quiet = true) {
  if (!currentUser) return;
  if (cloudSaveTimer) {
    clearTimeout(cloudSaveTimer);
    cloudSaveTimer = null;
    pendingCloudSavePromise = writeCloudState(quiet).finally(() => {
      pendingCloudSavePromise = null;
    });
  }
  if (pendingCloudSavePromise) await pendingCloudSavePromise;
}

async function writeCloudState(quiet = false) {
  if (!currentUser) return;
  const cloudState = getCloudSafeState();
  const cloudSize = jsonSizeBytes(cloudState);
  if (cloudSize > CLOUD_STATE_WARN_BYTES) {
    state.pendingCloudSync = true;
    state.lastCloudSyncError = 'El documento local supera el tamaño recomendado para sincronizar.';
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    console.warn(`Estado no sincronizado: ${cloudSize} bytes supera el umbral de ${CLOUD_STATE_WARN_BYTES}.`);
    updateAccountSyncStatus('pending');
    if (!quiet) showSaveStatus('warning', 'Guardado local. Reduce historial antes de sincronizar.');
    return;
  }
  try {
    await withTimeout(setDoc(doc(db, "users", currentUser.uid), cloudState));
    state.pendingCloudSync = false;
    delete state.lastCloudSyncError;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    if (!quiet) showSaveStatus('saved', 'Guardado y sincronizado');
    updateAccountSyncStatus('synced');
  } catch(e) {
    state.pendingCloudSync = true;
    state.lastCloudSyncError = e.message || String(e);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    console.error("Guardado local correcto; Firebase quedó pendiente.", e);
    if (!quiet) showSaveStatus('warning', 'Guardado en este dispositivo. Nube pendiente.');
    updateAccountSyncStatus('pending');
  }
}

async function syncPendingState() {
  if (!currentUser) return;
  const localData = parseStoredState(localStorage.getItem(STORAGE_KEY));
  if (!localData.pendingCloudSync) {
    updateAccountSyncStatus('synced');
    return;
  }
  try {
    await withTimeout(setDoc(doc(db, "users", currentUser.uid), getCloudSafeState()));
    state.pendingCloudSync = false;
    delete state.lastCloudSyncError;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    showSaveStatus('saved', 'Sincronizado con la nube');
    updateAccountSyncStatus('synced');
  } catch(e) {
    console.warn('Sincronización pendiente; se intentará de nuevo.', e);
    updateAccountSyncStatus('pending');
  }
}

// ─── UTILITIES ───
function gid() { return Date.now().toString(36)+Math.random().toString(36).substr(2,5); }
function fmtDate(d) { const x=d instanceof Date?d:new Date(d); return `${String(x.getDate()).padStart(2,'0')}/${String(x.getMonth()+1).padStart(2,'0')}/${x.getFullYear()}`; }
function todayStr(date = new Date()) { return localDateKey(date); }
const $=s=>document.querySelector(s), $$=s=>document.querySelectorAll(s);
function esc(s) { const d=document.createElement('div'); d.textContent=s; return d.innerHTML; }
function showToast(m) { const t=$('#toast'); t.textContent=m; t.classList.add('show'); setTimeout(()=>t.classList.remove('show'),2800); }
function showSaveStatus(status, message = '') {
  const labels = {
    saving: 'Guardando...',
    saved: 'Guardado',
    error: 'Guardado local. Revisa conexión.',
    warning: 'Guardado en este dispositivo. Nube pendiente.',
    ai: 'IA pensando...',
    empty: 'Faltan datos para una lectura profunda.'
  };
  const text = message || labels[status] || status;
  const t = $('#toast');
  if (!t) return;
  t.textContent = text;
  t.dataset.status = status;
  t.classList.add('show');
  clearTimeout(showSaveStatus._timer);
  showSaveStatus._timer = setTimeout(() => t.classList.remove('show'), status === 'saving' ? 1200 : 2600);
}
function logActivity(date) { if(!state.activityLog) state.activityLog={}; state.activityLog[date]=(state.activityLog[date]||0)+1; saveState(); }

function getGoalTitle(goalId) {
  const goal = (state.smartGoals || []).find(item => item.id === goalId);
  return goal?.goal || '';
}

function getLifeAreaLabel(key) {
  return LIFE_WHEEL_AXES.find(axis => axis.key === key)?.label || key || '';
}

function activeGoals() {
  return (state.smartGoals || []).filter(goal => goal.status !== 'done' && goal.status !== 'paused' && goal.completed !== true);
}

function recordGoalProgress(goal, progress) {
  const value = Math.min(100, Math.max(0, Number(progress || 0)));
  if (Number(goal.progress || 0) !== value) {
    if (!goal.progressHistory) goal.progressHistory = [];
    goal.progressHistory.push({ date: todayStr(), progress: value });
  }
  goal.progress = value;
  goal.completed = value >= 100;
  goal.status = value >= 100 ? 'done' : (goal.status === 'done' ? 'active' : goal.status || 'active');
}

const SYNC_DOT_LABELS = {
  synced: 'Nube sincronizada',
  pending: 'Nube pendiente',
  saving: 'Sincronizando...',
  idle: 'Cuenta conectada',
  offline: 'Sin sesión'
};

function updateAccountSyncStatus(status = 'idle') {
  const el = document.querySelector('#account-sync-status');
  const dot = document.querySelector('#avatar-sync-dot');
  const effectiveStatus = currentUser ? status : 'offline';
  const label = SYNC_DOT_LABELS[effectiveStatus] || SYNC_DOT_LABELS.idle;
  if (el) {
    el.dataset.status = effectiveStatus;
    el.textContent = currentUser ? `${currentUser.email || 'Cuenta Google'} · ${label}` : label;
  }
  if (dot) {
    dot.dataset.status = effectiveStatus;
    dot.title = label;
    dot.setAttribute('aria-label', `Estado de sincronización: ${label}`);
  }
}

function updateMobileViewportVars() {
  const viewport = window.visualViewport;
  const width = Math.round(viewport?.width || window.innerWidth || document.documentElement.clientWidth);
  const left = Math.round(viewport?.offsetLeft || 0);
  document.documentElement.style.setProperty('--roka-visual-width', `${width}px`);
  document.documentElement.style.setProperty('--roka-visual-left', `${left}px`);
}

function hardenTouchTarget(el) {
  if (!el || el.dataset.touchHardened) return;
  el.dataset.touchHardened = 'true';
  if (el.tagName === 'BUTTON' && !el.getAttribute('type')) el.setAttribute('type', 'button');
  el.addEventListener('contextmenu', event => event.preventDefault());
  el.addEventListener('selectstart', event => event.preventDefault());
  el.addEventListener('pointerdown', clearAccidentalSelection);
  el.addEventListener('pointerup', clearAccidentalSelection);
  el.addEventListener('click', clearAccidentalSelection);
}

function hardenInteractiveTouchTargets() {
  $$('button, [role="button"], .nav-item, .bottom-nav-item, .sub-nav-tabs .zen-btn, .sub-nav-pills .zen-btn, .theme-preset-card').forEach(hardenTouchTarget);
}

function isEditableSelectionTarget(node) {
  const el = node?.nodeType === Node.TEXT_NODE ? node.parentElement : node;
  return Boolean(el?.closest?.('input, textarea, select, [contenteditable="true"]'));
}

function clearAccidentalSelection(event) {
  if (isEditableSelectionTarget(event?.target)) return;
  const selection = window.getSelection && window.getSelection();
  if (selection && !selection.isCollapsed) selection.removeAllRanges();
}

function clearLocalSession({ render = true } = {}) {
  clearTimeout(cloudSaveTimer);
  cloudSaveTimer = null;
  localStorage.removeItem(STORAGE_KEY);
  clearStoredAIKey();
  state = JSON.parse(JSON.stringify(DEFAULT_STATE));
  coachThreads = [];
  activeCoachThreadId = '';
  activeCoachMessages = [];
  reportCache = [];
  if (render && appInitialized) renderAll();
}

// ─── AUTHENTICATION ───
function initAuth() {
  setPersistence(auth, browserLocalPersistence).catch(error => {
    console.warn('No se pudo fijar persistencia local de sesión.', error);
  });

  getRedirectResult(auth).then(result => {
    if (result?.user) {
      const loading = $('#auth-loading');
      if (loading) {
        loading.style.display = 'block';
        loading.textContent = 'Sesión conectada. Cargando datos...';
      }
    }
  }).catch(error => {
    console.error('Error regresando del inicio de sesión.', error);
    const loading = $('#auth-loading');
    if (loading) {
      loading.style.display = 'block';
      loading.textContent = 'Google no devolvió sesión. Prueba otra vez.';
    }
  });

  onAuthStateChanged(auth, async (user) => {
    if (user) {
      currentUser = user;
      lastAuthUid = user.uid;
      $('#auth-overlay').style.display = 'none';
      $('#app').style.display = 'grid';
      const avatarLetter = $('.profile-avatar-letter');
      if (avatarLetter) avatarLetter.textContent = (user.displayName || user.email || 'R').trim().charAt(0).toUpperCase();
      updateAccountSyncStatus('saving');

      loadLocalState();
      applyFirstRunDefaultsIfNeeded();

      if(!appInitialized) {
        initApp();
        appInitialized = true;
      } else {
        renderAll();
      }
      updateAccountSyncStatus(state.pendingCloudSync ? 'pending' : 'synced');
      reconcileCloudStateInBackground().then(async () => {
        await syncPendingState();
        await Promise.all([loadCoachThreads(), loadReports(), migrateLegacyReports()]);
      });
    } else {
      if (lastAuthUid) clearLocalSession({ render: false });
      currentUser = null;
      lastAuthUid = '';
      $('#auth-overlay').style.display = 'flex';
      $('#app').style.display = 'none';
      updateAccountSyncStatus('offline');
    }
  });

  $('#google-login-btn').addEventListener('click', async () => {
    $('#auth-loading').style.display = 'block';
    $('#auth-loading').textContent = 'Conectando...';
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    try {
      await setPersistence(auth, browserLocalPersistence);
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error(error);
      const code = error?.code || '';
      const canRedirectFallback = [
        'auth/popup-blocked',
        'auth/popup-closed-by-user',
        'auth/cancelled-popup-request',
        'auth/operation-not-supported-in-this-environment'
      ].includes(code);
      if (canRedirectFallback) {
        try {
          $('#auth-loading').textContent = 'Abriendo Google...';
          await signInWithRedirect(auth, provider);
          return;
        } catch (redirectError) {
          console.error(redirectError);
        }
      }
      $('#auth-loading').textContent = 'No se pudo iniciar con Google: ' + (error.message || code);
      alert("Error: " + error.message);
      $('#auth-loading').style.display = 'none';
    }
  });

  window.addEventListener('online', () => syncPendingState());
  setInterval(() => syncPendingState(), 45000);

  const logoutBtn = $('#logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      logoutBtn.disabled = true;
      await withTimeout(flushCloudSave(true)).catch(error => console.warn('No se pudo completar el guardado antes de cerrar sesión.', error));
      clearLocalSession({ render: false });
      await signOut(auth);
      logoutBtn.disabled = false;
    });
  }
}

// ─── MOTIVATIONAL QUOTES ───
const QUOTES = [
  { text: "No te rindas nunca. Abre tu corazón y tu mente y verás que llegas a donde quieres llegar.", author: "Roberto Iván Madrigal Espinoza" },
  { text: "El único límite para nuestra realización de mañana serán nuestras dudas de hoy.", author: "Franklin D. Roosevelt" },
  { text: "Soy muy seguro de mí mismo. Me he demostrado toda mi vida que soy seguro y confiable.", author: "Tu Mantra Personal" },
  { text: "La disciplina es el puente entre las metas y los logros.", author: "Jim Rohn" },
  { text: "Tu mente es un jardín, tus pensamientos son las semillas. Puedes cultivar flores o maleza.", author: "Robin Sharma" },
  { text: "Creo mucho en mí. Por primera vez sé que soy capaz de muchas cosas.", author: "Tu Claridad Mental" },
  { text: "El éxito no es definitivo, el fracaso no es fatal: lo que cuenta es el coraje de continuar.", author: "Winston Churchill" },
  { text: "Me quiero mucho y confío en mí como hombre sano e inteligente que soy.", author: "Tu Verdad Interior" },
  { text: "Los campeones no se hacen en los gimnasios. Se hacen de algo que llevan muy dentro.", author: "Muhammad Ali" },
  { text: "Cada mañana nacemos de nuevo. Lo que hacemos hoy es lo que más importa.", author: "Buda" },
  { text: "La mejor inversión que puedes hacer es en ti mismo.", author: "Warren Buffett" },
  { text: "Busca adentro de tu corazón. Ahí está la respuesta.", author: "Tu Sabiduría Interior" }
];

function renderQuote() {
  const idx = Math.floor((Date.now()/86400000)) % QUOTES.length;
  const q = QUOTES[idx];
  $('#quote-text').textContent = `"${q.text}"`;
  $('#quote-author').textContent = `— ${q.author}`;
}

// ─── GAMIFICATION ───
const LEVELS = [0, 100, 250, 500, 1000, 2000, 3500, 5000, 7500, 10000];
const BADGES = [
  { id: 'first_blood', name: 'Primer Paso', icon: 'I', desc: 'Ganaste tus primeros XP' },
  { id: 'focus_master', name: 'Mente Láser', icon: 'F', desc: 'Completaste una sesión de foco' },
  { id: 'grateful', name: 'Corazón Agradecido', icon: 'G', desc: 'Registraste gratitud' },
  { id: 'zen_master', name: 'Maestro Zen', icon: 'Z', desc: 'Alcanzaste el Nivel 5' }
];

function addXP(amount, reason) {
  if (!state.gamification) state.gamification = { xp: 0, level: 1, badges: [] };
  state.gamification.xp += amount;
  let newLevel = 1;
  for (let i = 0; i < LEVELS.length; i++) {
    if (state.gamification.xp >= LEVELS[i]) newLevel = i + 1;
  }
  if (newLevel > state.gamification.level) {
    state.gamification.level = newLevel;
    showToast(`Subiste de nivel. Eres Nivel ${newLevel}`);
  } else {
    showToast(`+${amount} XP: ${reason}`);
  }
  checkBadges();
  saveState();
  updateXPDisplay();
  if ($('#tab-identity') && $('#tab-identity').classList.contains('active')) renderProfile();
}

function updateXPDisplay() {
  if (!state.gamification) return;
  const xp = state.gamification.xp;
  const level = state.gamification.level;
  
  $$('#user-level-display').forEach(el => el.textContent = `Nvl ${level}`);
  
  const currentLevelXP = LEVELS[level - 1] || 0;
  const nextLevelXP = LEVELS[level] || (currentLevelXP + 1000);
  const progress = Math.min(100, Math.max(0, ((xp - currentLevelXP) / (nextLevelXP - currentLevelXP)) * 100));
  
  $$('#xp-fill').forEach(el => el.style.width = `${progress}%`);
}

function checkBadges() {
  if (!state.gamification.badges) state.gamification.badges = [];
  const b = state.gamification.badges;
  const xp = state.gamification.xp;
  
  if (xp >= 50 && !b.includes('first_blood')) unlockBadge('first_blood');
  if (state.gamification.level >= 5 && !b.includes('zen_master')) unlockBadge('zen_master');
  if (state.gratitudeLogs && state.gratitudeLogs.length > 0 && !b.includes('grateful')) unlockBadge('grateful');
}

function unlockBadge(id) {
  state.gamification.badges.push(id);
  const badgeDef = BADGES.find(x => x.id === id);
  if (badgeDef) showToast(`Insignia desbloqueada: ${badgeDef.name}`);
}

// ─── TAB NAVIGATION ───
const ROUTES = {
  hoy: { section: 'daily', label: 'Hoy' },
  metas: { section: 'strategy', label: 'Metas' },
  semana: { section: 'reflection', label: 'Semana' },
  mente: { section: 'mindset', label: 'Mente' },
  coach: { section: 'coach', label: 'Coach' },
  perfil: { section: 'identity', label: 'Perfil' }
};
const ROUTE_ALIASES = { today: 'hoy', daily: 'hoy', ai: 'coach', mindset: 'mente', strategy: 'metas', progreso: 'semana', reflection: 'semana', identity: 'perfil', profile: 'perfil' };
const ROUTE_ORDER = ['hoy', 'metas', 'semana', 'mente', 'coach'];
let activeRoute = 'hoy';
let coachOriginRoute = 'hoy';

function normalizeRoute(route) {
  const value = String(route || '').replace(/^#\/?/, '').split('/')[0].toLowerCase();
  return ROUTES[value] ? value : (ROUTE_ALIASES[value] || 'hoy');
}

function routeFromHash() { return normalizeRoute(location.hash); }

function activateHashSubroute(route) {
  const subroute = location.hash.replace(/^#\//, '').split('/')[1] || '';
  if (route === 'coach') {
    showCoachView(subroute === 'informes' ? 'reports' : 'chat', false);
  }
  if (route === 'metas' && subroute) {
    const map = { trimestre: 'strat-quarterly', anio: 'strat-year', vision: 'strat-vision', habitos: 'strat-habits' };
    activateSubtab('metas', map[subroute] || map.trimestre, false);
  }
  if (route === 'semana' && subroute) {
    const map = { revision: 'reflection-weekly', calendario: 'reflection-calendar', resumen: 'reflection-progress', semana: 'reflection-weekly' };
    activateSubtab('semana', map[subroute] || map.revision, false);
  }
}

function setRouteHash(route, subroute = '', replace = false) {
  const nextHash = `#/${route}${subroute ? `/${subroute}` : ''}`;
  if (location.hash === nextHash) return;
  if (replace) history.replaceState({ route }, '', nextHash);
  else history.pushState({ route }, '', nextHash);
}

function initTabs() {
  updateMobileViewportVars();
  window.addEventListener('resize', updateMobileViewportVars);
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', updateMobileViewportVars);
    window.visualViewport.addEventListener('scroll', updateMobileViewportVars);
  }
  hardenInteractiveTouchTargets();
  $$('.nav-item, .bottom-nav-item').forEach(b => {
    b.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      switchTab(b.dataset.route || b.dataset.tab, { focus: true });
    });
  });
  $$('.route-link-btn').forEach(b => {
    b.addEventListener('click', () => {
      const target = b.dataset.routeTarget;
      switchTab(target === 'ai' ? 'coach' : target, { focus: true });
    });
  });
  if ($('#generate-daily-route-btn')) $('#generate-daily-route-btn').addEventListener('click', generateDailyAIRoute);
  $('#coach-fab')?.addEventListener('click', () => switchTab('coach', { focus: true }));
  $('#profile-avatar-btn')?.addEventListener('click', () => switchTab('perfil', { focus: true }));
  window.addEventListener('hashchange', () => switchTab(routeFromHash(), { updateHash: false }));

  $$('[data-subtab-group][data-subtab-target]').forEach(button => {
    button.addEventListener('click', () => activateSubtab(button.dataset.subtabGroup, button.dataset.subtabTarget, true));
  });
}

function activateSubtab(group, target, updateHash = true) {
  const buttons = $$(`[data-subtab-group="${group}"]`);
  buttons.forEach(button => {
    const active = button.dataset.subtabTarget === target;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
    button.style.color = active ? 'var(--accent-gold)' : 'var(--text-secondary)';
    button.style.fontWeight = active ? 'bold' : 'normal';
  });
  $$(`[data-subtab-content="${group}"]`).forEach(content => {
    const active = content.id === target;
    content.classList.toggle('active', active);
    content.style.display = active ? 'block' : 'none';
  });
  if (updateHash) {
    const activeButton = Array.from(buttons).find(button => button.dataset.subtabTarget === target);
    setRouteHash(group, activeButton?.dataset.subroute || '');
  }
}

function updateClarityPanel() {
  const mantraEl = $('#active-mantra-display');
  const visionEl = $('#active-vision-display');
  if (mantraEl) {
    const mantras = state.mantras || [];
    // Show most recent mantra (last saved)
    const lastMantra = mantras.length ? mantras[mantras.length - 1] : null;
    mantraEl.textContent = lastMantra ? lastMantra.text : 'Sin mantra aún. Reconfigura una creencia en Mentalidad.';
  }
  if (visionEl) {
    const topGoals = (state.annualBig5 || []).filter(Boolean);
    visionEl.innerHTML = topGoals.length
      ? topGoals.slice(0, 3).map(g => `<li>${esc(g)}</li>`).join('')
      : '<li style="opacity:0.5; list-style:none;">Define tu Big 5 en Mi Base &#8594; Visión Anual</li>';
  }
}

function switchTab(t, options = {}) {
  const route = normalizeRoute(t);
  const config = ROUTES[route];
  if (route === 'coach' && activeRoute !== 'coach') coachOriginRoute = activeRoute;
  activeRoute = route;
  $$('.nav-item, .bottom-nav-item').forEach(b => b.classList.remove('active'));
  $$('.tab-content').forEach(c => c.classList.remove('active'));
  const btns = $$(`[data-route="${route}"]`);
  btns.forEach(b => {
    b.classList.add('active');
    b.setAttribute('aria-current', 'page');
  });
  $$('[data-route]').forEach(b => { if (!b.classList.contains('active')) b.removeAttribute('aria-current'); });
  const section = $(`#tab-${config.section}`);
  if (section) section.classList.add('active');
  document.title = `${config.label} — ROKA Mind Focus`;
  // Las vistas calculadas (estadísticas, pasos de metas) se refrescan al entrar para no mostrar datos viejos.
  if (appInitialized) {
    if (route === 'hoy') safeInit(renderTodaySystem, 'renderTodaySystem');
    if (route === 'semana') {
      safeInit(renderWeeklyReviewWizard, 'renderWeeklyReviewWizard');
      safeInit(renderWeeklyReviewTrend, 'renderWeeklyReviewTrend');
      safeInit(renderCalendar, 'renderCalendar');
    }
  }
  if (options.updateHash !== false) {
    setRouteHash(route, '', options.replace === true);
    activateHashSubroute(route);
  } else activateHashSubroute(route);
  window.scrollTo({ top: 0 });
  if (options.focus) {
    const heading = section?.querySelector('h1');
    if (heading) { heading.setAttribute('tabindex', '-1'); heading.focus({ preventScroll: true }); }
  }
}

function updateHeaderDate() {
  const now=new Date(), opts={weekday:'long',year:'numeric',month:'long',day:'numeric'};
  const s=now.toLocaleDateString('es-MX',opts);
  const el = $('#hoy-today-date');
  if (el) el.textContent=s.charAt(0).toUpperCase()+s.slice(1);
}

// ─── STREAK CALCULATOR ───
function hasCompletedRitual(dateStr) {
  if (!state.rituals) return false;
  return state.rituals.some(r => isRitualCompleted(r, dateStr));
}

function isRitualCompleted(ritual, dateStr) {
  if (!ritual) return false;
  const d = new Date(dateStr + 'T00:00:00');
  const dk = ['dom','lun','mar','mie','jue','vie','sab'][d.getDay()];
  const marker = 'completed_' + dateStr;
  return !!(ritual.completions && ritual.completions[dateStr]) || (ritual.days && ritual.days[dk] === marker);
}

function setRitualCompleted(ritual, dateStr, completed) {
  if (!ritual.completions) ritual.completions = {};
  if (completed) ritual.completions[dateStr] = true;
  else delete ritual.completions[dateStr];
  const d = new Date(dateStr + 'T00:00:00');
  const dk = ['dom','lun','mar','mie','jue','vie','sab'][d.getDay()];
  if (ritual.days && ritual.days[dk] === 'completed_' + dateStr) ritual.days[dk] = false;
}

function isRitualScheduled(ritual, dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const dk = ['dom','lun','mar','mie','jue','vie','sab'][d.getDay()];
  return !!(ritual.days && ritual.days[dk] === true);
}

function calcStreak() {
  let streak=0, d=new Date();
  for(let i=0;i<365;i++) {
    const key = localDateKey(d);
    const hasVictory=state.victories.some(v=>v.date===key);
    const hasPride=state.prideLogs.some(p=>p.date===key);
    const hasGratitude=state.gratitudeLogs && state.gratitudeLogs.some(g=>g.date===key);
    const hasTasks=state.dailyTasks[key]&&state.dailyTasks[key].length>0;
    const hasActivity=state.activityLog&&state.activityLog[key];
    const hasRitual=hasCompletedRitual(key);
    
    if(hasVictory||hasPride||hasGratitude||hasTasks||hasActivity||hasRitual) { streak++; d.setDate(d.getDate()-1); }
    else { if(i===0) { d.setDate(d.getDate()-1); continue; } break; }
  }
  $$('#streak-count').forEach(el => el.textContent=streak);
}

function initTimer() {
  if (timerComponent) return;
  timerComponent = new Timer({
    $,
    $$,
    onComplete: () => {
      const today = todayStr();
      if (!state.focusLog) state.focusLog = {};
      state.focusLog[today] = (state.focusLog[today] || 0) + 1;
      logActivity(today);
      if(!state.gamification.badges.includes('focus_master')) unlockBadge('focus_master');
      addXP(50, 'Sesión de Foco');
    }
  });
  timerComponent.init();
}

// ─── BELIEF REFRAMER ───
function initReframer() { 
  $('#reframe-btn').addEventListener('click',triggerReframe); 
  $('#save-reframe-btn').addEventListener('click',saveReframe); 
  if($('#ai-reframe-btn')) {
    $('#ai-reframe-btn').addEventListener('click', async () => {
      const b=$('#belief-input').value.trim();
      if(!b) { showToast('Escribe tu creencia limitante primero'); return; }
      try {
        const prompt = `La creencia limitante del usuario es: "${b}". \nTransforma esta creencia en un Mantra poderoso, positivo, empezando con "YO SOY" o similar, que sea directo y reprogramador. Devuelve SOLO el Mantra, nada más.`;
        const result = await callAI(prompt, 'Eres un reprogramador mental experto. Da respuestas extremadamente concisas, de una sola oración poderosa.');
        $('#reframe-input').value = result.trim().replace(/^["']/, '').replace(/["']$/, '');
        triggerReframe();
        showToast('Mantra generado por IA');
      } catch (e) {
        showToast(e.message);
      }
    });
  }
}
function triggerReframe() {
  const txt=$('#belief-input').value.trim(); if(!txt){showToast('Escribe tu creencia limitante');return;}
  const box=$('#reframer-box'), ba=$('#belief-area'), r=ba.getBoundingClientRect(), br=box.getBoundingClientRect();
  for(let i=0;i<50;i++){const p=document.createElement('div');p.className='particle';p.style.left=(Math.random()*r.width+(r.left-br.left))+'px';p.style.top=(Math.random()*r.height+(r.top-br.top))+'px';p.style.setProperty('--tx',(Math.random()*400-200)+'px');p.style.setProperty('--ty',(Math.random()*400-200)+'px');p.style.background=Math.random()>0.5?'var(--accent-gold)':'var(--accent-orange)';p.style.width=(Math.random()*4+2)+'px';p.style.height=p.style.width;box.appendChild(p);setTimeout(()=>p.classList.add('animate'),i*15);setTimeout(()=>p.remove(),1500);}
  ba.style.transition='opacity 0.5s ease,transform 0.5s ease';ba.style.opacity='0';ba.style.transform='scale(0.95)';
  setTimeout(()=>{ba.style.display='none';$('#reframe-area').classList.add('visible');$('#reframe-input').focus();},800);
}
function saveReframe() {
  const b=$('#belief-input').value.trim(), r=$('#reframe-input').value.trim(); if(!r){showToast('Escribe tu afirmación');return;}
  const beliefId = gid();
  state.beliefs.push({id:beliefId,belief:b,reframe:r,date:todayStr()});
  state.mantras.push({id:gid(),beliefId,text:r,date:todayStr()});
  saveState(); logActivity(todayStr());
  $('#belief-input').value='';$('#reframe-input').value='';$('#reframe-area').classList.remove('visible');
  const ba=$('#belief-area');ba.style.display='';ba.style.opacity='1';ba.style.transform='';
  addXP(30, 'Creencia reconfigurada'); renderMantras(); renderBeliefsLibrary(); calcStreak();
}

// ─── MANTRAS ───
function renderMantras() {
  const c=$('#mantras-grid'); if(!c)return;
  if(!state.mantras.length){c.innerHTML='<div class="empty-state empty-state-span"><div class="empty-state-icon"><svg class="icon" aria-hidden="true"><use href="#i-feather"/></svg></div><div class="empty-state-text">Reconfigura una creencia para crear tu primer mantra.</div><button class="zen-btn zen-btn-primary" id="empty-mantras-btn">Reconfigurar una creencia</button></div>';c.querySelector('#empty-mantras-btn')?.addEventListener('click',()=>$('#belief-input')?.focus());return;}
  c.innerHTML=state.mantras.map(m=>`<div class="mantra-card" data-id="${m.id}"><div class="mantra-text">"${esc(m.text)}"</div><div class="mantra-date">${fmtDate(m.date)}</div><button class="btn-delete mantra-delete" data-id="${m.id}" aria-label="Eliminar"><svg class="icon" aria-hidden="true"><use href="#i-x"/></svg></button></div>`).join('');
  c.querySelectorAll('.mantra-delete').forEach(b=>b.addEventListener('click',e=>{e.stopPropagation();state.mantras=state.mantras.filter(m=>m.id!==b.dataset.id);saveState();renderMantras();}));
}

function renderBeliefsLibrary() {
  const c = $('#beliefs-library');
  const count = $('#beliefs-count');
  if (!c) return;
  const beliefs = state.beliefs || [];
  if (count) count.textContent = `${beliefs.length} ${beliefs.length === 1 ? 'registro' : 'registros'}`;
  if (!beliefs.length) {
    c.innerHTML = '<div class="empty-state"><div class="empty-state-icon"><svg class="icon" aria-hidden="true"><use href="#i-feather"/></svg></div><div class="empty-state-text">Aún no has guardado creencias. Escribe una arriba para crear tu primer registro.</div><button class="zen-btn zen-btn-primary" id="empty-beliefs-btn">Escribir mi primera creencia</button></div>';c.querySelector('#empty-beliefs-btn')?.addEventListener('click',()=>$('#belief-input')?.focus());
    return;
  }
  c.innerHTML = beliefs.slice().reverse().map(item => {
    const linked = (state.mantras || []).find(m => m.beliefId === item.id || m.text === item.reframe);
    return `
      <article class="belief-record">
        <div class="belief-record-meta">${fmtDate(item.date)}${linked ? ' · mantra activo' : ''}</div>
        <div class="belief-record-grid">
          <div>
            <span class="belief-record-label">Creencia limitante</span>
            <p>${esc(item.belief || 'Sin texto original')}</p>
          </div>
          <div>
            <span class="belief-record-label">Nueva verdad</span>
            <p>${esc(item.reframe || 'Sin reconfiguración')}</p>
          </div>
        </div>
        <div class="belief-record-actions">
          <button class="zen-btn zen-btn-ghost" data-copy-belief="${item.id}">Usar de nuevo</button>
          <button class="zen-btn zen-btn-ghost danger-soft" data-delete-belief="${item.id}">Eliminar</button>
        </div>
      </article>
    `;
  }).join('');
  c.querySelectorAll('[data-copy-belief]').forEach(btn => btn.addEventListener('click', () => {
    const item = state.beliefs.find(b => b.id === btn.dataset.copyBelief);
    if (!item) return;
    $('#belief-input').value = item.belief || '';
    $('#reframe-input').value = item.reframe || '';
    $('#reframe-area').classList.add('visible');
    $('#belief-area').style.display = '';
    $('#belief-input').focus();
  }));
  c.querySelectorAll('[data-delete-belief]').forEach(btn => btn.addEventListener('click', () => {
    const id = btn.dataset.deleteBelief;
    const item = state.beliefs.find(b => b.id === id);
    state.beliefs = state.beliefs.filter(b => b.id !== id);
    state.mantras = (state.mantras || []).filter(m => m.beliefId !== id && (!item || m.text !== item.reframe));
    saveState();
    renderBeliefsLibrary();
    renderMantras();
    if ($('#tab-reflection') && $('#tab-reflection').classList.contains('active')) renderProgress();
  }));
}
function initMantraSlide() {
  $('#mantra-slide-btn').addEventListener('click',openSlide); $('#mantra-slide-close').addEventListener('click',closeSlide);
  document.addEventListener('keydown',e=>{if(e.key==='Escape')closeSlide();});
}
let slideInt=null,slideIdx=0;
function openSlide() { if(!state.mantras.length){showToast('No tienes mantras');return;} $('#mantra-slide-overlay').style.display='flex'; slideIdx=0; showSlide(); slideInt=setInterval(()=>{slideIdx=(slideIdx+1)%state.mantras.length;showSlide();},6000); }
function showSlide() { const t=$('#mantra-slide-text'),c=$('#mantra-slide-counter'); t.style.animation='none';t.offsetHeight;t.style.animation='manthaFadeIn 2s ease forwards'; t.textContent=`"${state.mantras[slideIdx].text}"`; c.textContent=`${slideIdx+1} / ${state.mantras.length}`; c.style.cssText='margin-top:32px;font-size:0.75rem;color:var(--text-muted);letter-spacing:2px;'; }
function closeSlide() { $('#mantra-slide-overlay').style.display='none'; if(slideInt)clearInterval(slideInt); slideInt=null; }

// ─── PERSONAL MAP / DIAGNOSIS ───

const ARCHETYPE_QUESTIONS = [
  {
    id: 'crisis',
    question: 'Frente a una crisis profunda, tu primer impulso subconsciente es:',
    options: [
      { value: 'creator', label: 'Imaginar una solución radicalmente nueva y reconstruir desde cero.' },
      { value: 'sage', label: 'Aislarme para analizar la estructura del problema y entender su raíz lógica.' },
      { value: 'hero', label: 'Asumir la carga, resistir la presión extrema y liderar mediante disciplina pura.' },
      { value: 'explorer', label: 'Buscar vías de escape o alternativas inexploradas fuera de la norma.' },
      { value: 'ruler', label: 'Imponer orden autoritario, delegar roles y estabilizar el sistema de inmediato.' }
    ]
  },
  {
    id: 'shadow',
    question: 'La mayor sombra o miedo que sabotea tu crecimiento suele ser:',
    options: [
      { value: 'creator', label: 'Sentir que mis obras son mediocres, derivadas o carentes de alma.' },
      { value: 'sage', label: 'Actuar desde la ignorancia, la impulsividad o la desinformación.' },
      { value: 'hero', label: 'Rendirme, mostrar vulnerabilidad o fallar a quienes dependen de mí.' },
      { value: 'explorer', label: 'Quedarme atrapado en una rutina predecible que asfixie mi libertad.' },
      { value: 'ruler', label: 'Perder el control del entorno o que el caos destruya lo que he construido.' }
    ]
  },
  {
    id: 'flow',
    question: 'Alcanzas tu estado de "flow" (fluidez absoluta) cuando:',
    options: [
      { value: 'creator', label: 'Estoy traduciendo mi mundo interior en algo tangible y estético.' },
      { value: 'sage', label: 'Conecto conceptos complejos y descubro verdades sistémicas ocultas.' },
      { value: 'hero', label: 'Atravieso la fricción y supero mis propios límites físicos o mentales.' },
      { value: 'explorer', label: 'Me expongo a lo desconocido, sin un mapa predefinido.' },
      { value: 'ruler', label: 'Orquesto recursos y personas para materializar una visión a gran escala.' }
    ]
  },
  {
    id: 'legacy',
    question: 'Si tuvieras que elegir tu legado definitivo, sería:',
    options: [
      { value: 'creator', label: 'Una obra de arte, producto o invención que cambie la cultura.' },
      { value: 'sage', label: 'Un sistema de pensamiento o teoría que eleve la consciencia colectiva.' },
      { value: 'hero', label: 'El ejemplo de un espíritu inquebrantable que inspiró a otros a no rendirse.' },
      { value: 'explorer', label: 'Abrir caminos y descubrir territorios que otros temían pisar.' },
      { value: 'ruler', label: 'Un imperio, empresa o estructura autosustentable que perdure en el tiempo.' }
    ]
  },
  {
    id: 'conflict',
    question: 'En un conflicto interpersonal crítico, tu arma principal es:',
    options: [
      { value: 'creator', label: 'Rediseñar las reglas del juego para hacer el conflicto irrelevante.' },
      { value: 'sage', label: 'Desarticular los argumentos del otro con lógica irrefutable y objetividad.' },
      { value: 'hero', label: 'Afrontarlo de frente, soportar el embate y exigir resolución directa.' },
      { value: 'explorer', label: 'Desvincularme emocionalmente y cambiar de entorno si no tiene sentido.' },
      { value: 'ruler', label: 'Usar mi influencia, jerarquía o recursos para forzar un acuerdo estructural.' }
    ]
  }
];

const ENNEAGRAM_QUESTIONS = [
  ['1', 'El Reformador: Siento una tensión constante entre la perfección ideal y la realidad; el error (ajeno o propio) me resulta físicamente incómodo.'],
  ['2', 'El Ayudador: Mi valor personal está secretamente ligado a cuán indispensable soy para los demás; sufro cuando no reconocen mi sacrificio.'],
  ['3', 'El Triunfador: Evalúo mi valía a través de métricas de éxito y eficiencia; me aterra el fracaso o ser percibido como irrelevante.'],
  ['4', 'El Individualista: Siento una melancolía subyacente y necesito profunda autenticidad; odio lo ordinario y temo ser uno más del montón.'],
  ['5', 'El Investigador: Mi energía es limitada; tiendo a aislarme en mi mente para acumular conocimiento y evitar que el mundo drene mis recursos.'],
  ['6', 'El Leal: Mi mente escanea constantemente el horizonte buscando amenazas; la duda y la necesidad de certezas gobiernan mis decisiones.'],
  ['7', 'El Entusiasta: Huyo del dolor emocional o el aburrimiento llenando mi agenda de estímulos, planes futuros y múltiples opciones.'],
  ['8', 'El Desafiador: El mundo se divide entre fuertes y débiles; mi instinto primario es tomar el control absoluto para no ser dominado ni traicionado.'],
  ['9', 'El Pacificador: Minimizo mis propios deseos y me fusiono con el entorno para evitar la fricción; el conflicto abierto me drena y paraliza.']
];

const PRODUCTIVITY_QUESTIONS = [
  ['visual', 'Pensamiento Visual: Necesito exteriorizar mis ideas en lienzos, pizarras o diagramas; mi mente se ahoga en listas de texto plano.'],
  ['analytical', 'Ejecución Analítica: Mi progreso depende de desfragmentar metas en sistemas algorítmicos, métricas frías y secuencias inquebrantables.'],
  ['kinesthetic', 'Tracción Kinestésica: Pienso mientras actúo. El "parálisis por análisis" me destruye; necesito ensuciarme las manos e iterar en movimiento.'],
  ['relational', 'Impulso Relacional: Mi disciplina se fractura en aislamiento. Necesito espejos sociales, mentores o presión externa para sostener el momentum.'],
  ['ritual', 'Anclaje Ritualista: Mi poder reside en la repetición implacable. Prefiero un horario sagrado y metódico sobre ráfagas erráticas de inspiración.']
];

const ARCHETYPE_LABELS = {
  creator: 'Creador',
  sage: 'Sabio',
  hero: 'Héroe',
  explorer: 'Explorador',
  ruler: 'Gobernante'
};

const PRODUCTIVITY_LABELS = {
  visual: 'Visual',
  analytical: 'Analítico',
  kinesthetic: 'Práctico',
  relational: 'Relacional',
  ritual: 'Ritualista'
};

function initPersonalMap() {
  if ($('#save-archetype-test-btn')) $('#save-archetype-test-btn').addEventListener('click', saveArchetypeTest);
  if ($('#save-enneagram-test-btn')) $('#save-enneagram-test-btn').addEventListener('click', saveEnneagramTest);
  if ($('#save-productivity-test-btn')) $('#save-productivity-test-btn').addEventListener('click', saveProductivityTest);
  if ($('#ai-daily-route-btn')) $('#ai-daily-route-btn').addEventListener('click', generateDailyAIRoute);
  if ($('#ai-weekly-review-btn')) $('#ai-weekly-review-btn').addEventListener('click', generateWeeklyReview);
  $$('.map-report-btn').forEach(btn => btn.addEventListener('click', () => generateMapReport(btn.dataset.report)));
}

function renderPersonalMap() {
  renderArchetypeQuiz();
  renderEnneagramQuiz();
  renderProductivityQuiz();
  renderDiagnosisResults();
  updateStatusIndicators();
  renderAIReportsList();
}

function renderArchetypeQuiz() {
  const c = $('#archetype-quiz'); if(!c) return;
  const answers = state.personalMap.archetypeAnswers || {};
  c.innerHTML = ARCHETYPE_QUESTIONS.map((q) => `
    <div class="quiz-question">
      <label>${q.question}</label>
      <select class="zen-input" data-archetype-q="${q.id}">
        <option value="">Seleccionar respuesta...</option>
        ${q.options.map((opt) => `<option value="${opt.value}" ${answers[q.id]===opt.value?'selected':''}>${opt.label}</option>`).join('')}
      </select>
    </div>
  `).join('');
}

function renderEnneagramQuiz() {
  const c = $('#enneagram-quiz'); if(!c) return;
  const answers = state.personalMap.enneagramAnswers || {};
  c.innerHTML = ENNEAGRAM_QUESTIONS.map(([type, question]) => `
    <div class="quiz-question range-question">
      <label>${question}</label>
      <div class="range-row">
        <span>Bajo</span>
        <input type="range" min="1" max="5" value="${answers[type] || 3}" data-enneagram-q="${type}">
        <strong>${answers[type] || 3}</strong>
      </div>
    </div>
  `).join('');
  c.querySelectorAll('[data-enneagram-q]').forEach(input => input.addEventListener('input', () => {
    input.parentElement.querySelector('strong').textContent = input.value;
  }));
}

function renderProductivityQuiz() {
  const c = $('#productivity-quiz'); if(!c) return;
  const answers = state.personalMap.productivityAnswers || {};
  c.innerHTML = PRODUCTIVITY_QUESTIONS.map(([type, question]) => `
    <div class="quiz-question range-question">
      <label>${question}</label>
      <div class="range-row">
        <span>Bajo</span>
        <input type="range" min="1" max="5" value="${answers[type] || 3}" data-productivity-q="${type}">
        <strong>${answers[type] || 3}</strong>
      </div>
    </div>
  `).join('');
  c.querySelectorAll('[data-productivity-q]').forEach(input => input.addEventListener('input', () => {
    input.parentElement.querySelector('strong').textContent = input.value;
  }));
}

function saveArchetypeTest() {
  const answers = {};
  $('#archetype-quiz').querySelectorAll('select').forEach(sel => answers[sel.dataset.archetypeQ] = sel.value);
  if (Object.values(answers).some(v => !v)) { showToast('Responde todas las preguntas de Arquetipo'); return; }
  state.personalMap.archetypeAnswers = answers;
  const counts = Object.values(answers).reduce((acc, val) => { acc[val] = (acc[val] || 0) + 1; return acc; }, {});
  let max = 0, winner = '';
  for (const [k, v] of Object.entries(counts)) { if (v > max) { max = v; winner = k; } }
  state.personalMap.archetype = winner;
  saveState();
  renderDiagnosisResults();
  updateStatusIndicators();
  showToast('Test de Arquetipo guardado');
}

function saveEnneagramTest() {
  const answers = {};
  $$('[data-enneagram-q]').forEach(input => answers[input.dataset.enneagramQ] = +input.value);
  state.personalMap.enneagramAnswers = answers;
  state.personalMap.enneagram = topKey(answers) || '';
  if (state.personalMap.enneagram) state.userProfile.enneagram = state.personalMap.enneagram;
  saveState(); renderDiagnosisResults(); updateStatusIndicators(); showToast('Eneagrama sugerido');
}

function saveProductivityTest() {
  const answers = {};
  $$('[data-productivity-q]').forEach(input => answers[input.dataset.productivityQ] = +input.value);
  state.personalMap.productivityAnswers = answers;
  state.personalMap.productivity = topKey(answers) || '';
  if (state.personalMap.productivity) state.userProfile.learning = state.personalMap.productivity;
  saveState(); renderDiagnosisResults(); updateStatusIndicators(); showToast('Perfil de productividad calculado');
}

function topKey(scores) {
  return Object.entries(scores || {}).sort((a,b) => b[1] - a[1])[0]?.[0] || '';
}

function renderDiagnosisResults() {
  if(!state.personalMap) state.personalMap = {};
  const archetype = state.personalMap.archetype;
  const enneagram = state.personalMap.enneagram;
  const productivity = state.personalMap.productivity;
  
  if($('#archetype-result')) $('#archetype-result').innerHTML = archetype ? `<strong>${ARCHETYPE_LABELS[archetype]}</strong><span>Resultado sugerido por tus respuestas. Genera un informe IA para matizarlo.</span>` : '<span>Completa el test para ver tu arquetipo base.</span>';
  if($('#enneagram-result')) $('#enneagram-result').innerHTML = enneagram ? `<strong>Tipo ${enneagram}</strong><span>Eneatipo probable. La IA evaluará tus alas y niveles de integración.</span>` : '<span>Completa el test para ver tu eneatipo probable.</span>';
  if($('#productivity-result')) $('#productivity-result').innerHTML = productivity ? `<strong>${PRODUCTIVITY_LABELS[productivity]}</strong><span>Tu sistema neuro-cognitivo dominante para la ejecución.</span>` : '<span>Completa el test para detectar tu estilo neuro-productivo.</span>';
  
  const summary = $('#diagnosis-summary');
  if(summary) {
    summary.innerHTML = `
      <div class="summary-line"><span>Arquetipo Base</span><strong>${archetype ? ARCHETYPE_LABELS[archetype] : 'Pendiente'}</strong></div>
      <div class="summary-line"><span>Eneagrama</span><strong>${enneagram ? 'Tipo ' + enneagram : 'Pendiente'}</strong></div>
      <div class="summary-line"><span>Estilo Ejecutivo</span><strong>${productivity ? PRODUCTIVITY_LABELS[productivity] : 'Pendiente'}</strong></div>
    `;
  }
}

function updateStatusIndicators() {
  const map = state.personalMap || {};
  if($('#archetype-status')) {
    $('#archetype-status').textContent = map.archetype ? 'Completado' : 'Pendiente';
    $('#archetype-status').style.color = map.archetype ? 'var(--accent-green)' : 'var(--text-muted)';
  }
  if($('#enneagram-status')) {
    $('#enneagram-status').textContent = map.enneagram ? 'Completado' : 'Pendiente';
    $('#enneagram-status').style.color = map.enneagram ? 'var(--accent-green)' : 'var(--text-muted)';
  }
  if($('#productivity-status')) {
    $('#productivity-status').textContent = map.productivity ? 'Completado' : 'Pendiente';
    $('#productivity-status').style.color = map.productivity ? 'var(--accent-green)' : 'var(--text-muted)';
  }
}

// ─── PRIDE & GRATITUDE ───
function initPride() { $('#add-pride-btn').addEventListener('click',addPride); }
function addPride() {
  const t=$('#pride-input').value.trim(); if(!t)return;
  state.prideLogs.push({id:gid(),content:t,date:todayStr()});
  saveState(); $('#pride-input').value='';
  addXP(20, 'Orgullo registrado 🏆'); renderPride(); calcStreak();
}
function renderPride() {
  const c=$('#pride-list'); if(!c)return;
  const tod=state.prideLogs.filter(p=>p.date===todayStr());
  c.innerHTML = tod.map(p=>`<div class="victory-item"><div class="victory-text">${esc(p.content)}</div></div>`).join('');
}

function initGratitude() { 
  const btn = $('#add-gratitude-btn');
  if(btn) btn.addEventListener('click',addGratitude); 
}
function addGratitude() {
  if (!state.gratitudeLogs) state.gratitudeLogs = [];
  const t=$('#gratitude-input').value.trim(); if(!t)return;
  state.gratitudeLogs.push({id:gid(),content:t,date:todayStr()});
  saveState(); $('#gratitude-input').value='';
  addXP(20, 'Gratitud registrada'); renderGratitude(); calcStreak();
}
function renderGratitude() {
  const c=$('#gratitude-list'); if(!c)return;
  if (!state.gratitudeLogs) state.gratitudeLogs = [];
  const tod=state.gratitudeLogs.filter(p=>p.date===todayStr());
  c.innerHTML = tod.map(p=>`<div class="victory-item"><div class="victory-text" style="color: var(--accent-green);">${esc(p.content)}</div></div>`).join('');
}



// ─── DAILY PLANNER ───
function initPlanner() {
  $('#add-task-btn').addEventListener('click',addTask);
  $('#task-input').addEventListener('keydown',e=>{if(e.key==='Enter')addTask();});
  $('#planner-date-label').textContent=fmtDate(new Date());
}
function addTask() {
  const i=$('#task-input'),txt=i.value.trim(); if(!txt)return;
  const pr=$('#task-priority').value, today=todayStr();
  if(!state.dailyTasks[today]) state.dailyTasks[today]=[];
  state.dailyTasks[today].push({id:gid(),text:txt,priority:pr,completed:false});
  saveState(); logActivity(today); i.value=''; renderPlanner(); calcStreak();
}
function renderPlanner() {
  const today=todayStr(), tasks=state.dailyTasks[today]||[], c=$('#planner-tasks');
  if(!tasks.length){c.innerHTML='<div class="empty-state empty-state-compact"><div class="empty-state-icon"><svg class="icon" aria-hidden="true"><use href="#i-list"/></svg></div><div class="empty-state-text">Agrega tareas para planificar tu día</div><button class="zen-btn zen-btn-primary" id="empty-tasks-btn">Agregar mi primera tarea</button></div>';c.querySelector('#empty-tasks-btn')?.addEventListener('click',()=>$('#task-input')?.focus());updatePlannerProgress([]);return;}
  const prOrder={high:0,medium:1,low:2};
  const sorted=[...tasks].sort((a,b)=>(a.completed?1:0)-(b.completed?1:0)||(prOrder[a.priority]||1)-(prOrder[b.priority]||1));
  c.innerHTML=sorted.map(t=>{
    const prLabels={high:'Alta',medium:'Media',low:'Baja'};
    const goalLabel = t.goalId ? getGoalTitle(t.goalId) : '';
    return `<div class="planner-task ${t.completed?'completed':''}"><button class="task-check ${t.completed?'done':''}" data-tid="${esc(t.id)}"></button><span class="task-text">${esc(t.text)}</span>${goalLabel?`<span class="task-goal-tag">${esc(goalLabel.slice(0,32))}</span>`:''}<span class="task-priority-tag ${t.priority}">${prLabels[t.priority]}</span><button class="btn-delete" data-del-task="${esc(t.id)}" style="opacity:0.5;" aria-label="Eliminar"><svg class="icon" aria-hidden="true"><use href="#i-x"/></svg></button>${t.needsGoalFollowUp?`<div class="goal-followup-form"><input class="zen-input" data-follow-step="${esc(t.id)}" placeholder="Siguiente paso"><input class="zen-input" type="number" min="0" max="100" data-follow-progress="${esc(t.id)}" placeholder="Avance %"><button class="zen-btn zen-btn-primary" data-save-followup="${esc(t.id)}">Guardar</button></div>`:''}</div>`;
  }).join('');
  c.querySelectorAll('.task-check').forEach(b=>b.addEventListener('click',()=>{const tk=tasks.find(t=>t.id===b.dataset.tid);if(tk){if(!tk.completed){state=completeTaskEffects(state,today,tk.id);}else{tk.completed=false;delete tk.completedAt;delete tk.needsGoalFollowUp;}saveState();renderPlanner();renderTodaySystem();renderSmartGoals();}}));
  c.querySelectorAll('[data-del-task]').forEach(b=>b.addEventListener('click',()=>{state.dailyTasks[today]=tasks.filter(t=>t.id!==b.dataset.delTask);saveState();renderPlanner();}));
  c.querySelectorAll('[data-save-followup]').forEach(b=>b.addEventListener('click',()=>saveGoalFollowup(b.dataset.saveFollowup)));
  updatePlannerProgress(tasks);
}

function saveGoalFollowup(taskId) {
  const task = (state.dailyTasks[todayStr()] || []).find(item => item.id === taskId);
  const goal = task?.goalId ? state.smartGoals.find(item => item.id === task.goalId) : null;
  if (!goal) return;
  const step = $(`[data-follow-step="${CSS.escape(taskId)}"]`)?.value.trim();
  const progress = $(`[data-follow-progress="${CSS.escape(taskId)}"]`)?.value;
  if (step) goal.nextStep = step;
  if (progress !== '') recordGoalProgress(goal, progress);
  delete task.needsGoalFollowUp;
  saveState(); renderPlanner(); renderTodaySystem(); renderSmartGoals(); renderProgress(); showToast('Meta actualizada');
}

function renderTodaySystem() {
  renderWeeklyPrompt();
  renderOverdueTasksCard();
  renderGoalNextStepsCard();
  renderLowLifeAreasCard();
}

function renderWeeklyPrompt() {
  const c = $('#weekly-review-prompt');
  if (!c) return;
  if (!shouldPromptWeeklyReview(state, todayStr())) { c.innerHTML = ''; return; }
  c.innerHTML = `<div class="glass-card today-alert-card"><div><span class="page-eyebrow">Revisión semanal</span><h2>Cierra tu semana en 10 minutos</h2><p>Revisa qué funcionó, ajusta metas y elige hasta 3 focos para la próxima semana.</p></div><button class="zen-btn zen-btn-primary" id="start-weekly-review-btn">Empezar revisión</button></div>`;
  c.querySelector('#start-weekly-review-btn')?.addEventListener('click', () => { switchTab('semana', { focus: true }); activateSubtab('semana', 'reflection-weekly', true); });
}

function renderOverdueTasksCard() {
  const c = $('#overdue-tasks-card');
  if (!c) return;
  const tasks = overdueTasks(state, todayStr(), 14);
  if (!tasks.length) { c.innerHTML = ''; return; }
  c.innerHTML = `<div class="glass-card today-alert-card"><div><span class="page-eyebrow">Pendientes</span><h2>${tasks.length === 1 ? 'Tienes 1 pendiente de días anteriores' : `Tienes ${tasks.length} pendientes de días anteriores`}</h2><p>${tasks.slice(0, 3).map(task => `${esc(task.text)} (${esc(fmtDate(task.date + 'T00:00:00'))})`).join(' · ')}</p></div><div class="today-card-actions"><button class="zen-btn zen-btn-primary" id="carry-over-tasks-btn">Pasar a hoy</button><button class="zen-btn zen-btn-ghost" id="discard-overdue-tasks-btn">Descartar</button></div></div>`;
  c.querySelector('#carry-over-tasks-btn')?.addEventListener('click', () => {
    state = carryOverTasks(state, todayStr(), tasks.map(task => task.id));
    saveState(); renderPlanner(); renderTodaySystem(); showToast('Pendientes movidos a hoy');
  });
  c.querySelector('#discard-overdue-tasks-btn')?.addEventListener('click', () => {
    tasks.forEach(task => { state.dailyTasks[task.date] = (state.dailyTasks[task.date] || []).filter(item => item.id !== task.id); });
    saveState(); renderTodaySystem(); renderCalendar(); showToast('Pendientes descartados');
  });
}

function renderGoalNextStepsCard() {
  const c = $('#goal-next-steps-card');
  if (!c) return;
  const steps = goalNextSteps(state, todayStr());
  if (!steps.length) {
    c.innerHTML = '<div class="glass-card today-system-card"><div class="card-header"><div class="card-title-group"><div class="card-icon orange"><svg class="icon" aria-hidden="true"><use href="#i-target"/></svg></div><h2 class="card-title">Siguientes pasos de tus metas</h2></div></div><p class="card-subtitle">Crea una meta activa para convertirla en tareas de hoy.</p></div>';
    return;
  }
  c.innerHTML = `<div class="glass-card today-system-card"><div class="card-header"><div class="card-title-group"><div class="card-icon orange"><svg class="icon" aria-hidden="true"><use href="#i-target"/></svg></div><h2 class="card-title">Siguientes pasos de tus metas</h2></div></div><div class="goal-next-list">${steps.map(item => item.nextStep ? `<div class="goal-next-item"><div><strong>${esc(item.goal)}</strong><p>${esc(item.nextStep)}</p></div>${item.plannedToday ? '<span class="cal-status-pill">En tu plan de hoy</span>' : `<button class="zen-btn zen-btn-primary" data-goal-today="${esc(item.id)}">Hacer hoy</button>`}</div>` : `<div class="goal-next-item"><div><strong>${esc(item.goal)}</strong><p>Define el siguiente paso para desbloquear Hoy.</p><input class="zen-input" data-next-inline="${esc(item.id)}" placeholder="Siguiente paso de esta meta"></div><button class="zen-btn zen-btn-ghost" data-save-next-inline="${esc(item.id)}">Guardar</button></div>`).join('')}</div></div>`;
  c.querySelectorAll('[data-goal-today]').forEach(button => button.addEventListener('click', () => addGoalStepTask(button.dataset.goalToday)));
  c.querySelectorAll('[data-save-next-inline]').forEach(button => button.addEventListener('click', () => {
    const goal = state.smartGoals.find(item => item.id === button.dataset.saveNextInline);
    const input = c.querySelector(`[data-next-inline="${CSS.escape(button.dataset.saveNextInline)}"]`);
    if (goal && input?.value.trim()) {
      goal.nextStep = input.value.trim();
      saveState(); renderTodaySystem(); renderSmartGoals(); showToast('Siguiente paso guardado');
    }
  }));
}

function renderLowLifeAreasCard() {
  const c = $('#low-life-areas-card');
  if (!c) return;
  const areas = lowLifeAreas(state, 4);
  if (!areas.length) { c.innerHTML = ''; return; }
  c.innerHTML = `<div class="glass-card today-system-card"><div class="card-header"><div class="card-title-group"><div class="card-icon green"><svg class="icon" aria-hidden="true"><use href="#i-target"/></svg></div><h2 class="card-title">Áreas bajas de la Rueda</h2></div></div><div class="low-area-list">${areas.slice(0, 4).map(area => `<div class="low-area-item"><div><strong>${esc(getLifeAreaLabel(area.key))}</strong><span>${area.value}/10</span></div><button class="zen-btn zen-btn-primary" data-life-goal="${esc(area.key)}">Crear meta</button><button class="zen-btn zen-btn-ghost" data-life-ritual="${esc(area.key)}">Crear ritual</button></div>`).join('')}</div></div>`;
  c.querySelectorAll('[data-life-goal]').forEach(button => button.addEventListener('click', () => openSmartForm({ lifeArea: button.dataset.lifeGoal })));
  c.querySelectorAll('[data-life-ritual]').forEach(button => button.addEventListener('click', () => {
    switchTab('metas', { focus: true });
    activateSubtab('metas', 'strat-habits', true);
    $('#ritual-input')?.focus();
    $('#ritual-life-area') && ($('#ritual-life-area').value = button.dataset.lifeRitual);
  }));
}

function addGoalStepTask(goalId) {
  const goal = state.smartGoals.find(item => item.id === goalId);
  if (!goal?.nextStep) return;
  const today = todayStr();
  if (!state.dailyTasks[today]) state.dailyTasks[today] = [];
  if (state.dailyTasks[today].some(task => task.goalId === goalId && task.text === goal.nextStep)) { showToast('Ese paso ya está en tu plan de hoy'); return; }
  state.dailyTasks[today].push({ id: gid(), text: goal.nextStep, priority: 'high', completed: false, goalId });
  saveState(); renderPlanner(); renderTodaySystem(); showToast('Siguiente paso agregado a Hoy');
}
function updatePlannerProgress(tasks) {
  const total=tasks.length, done=tasks.filter(t=>t.completed).length;
  const pct=total>0?Math.round(done/total*100):0;
  $('#planner-progress-fill').style.width=pct+'%';
  $('#planner-progress-text').textContent=`${done}/${total} tareas`;
}

// ─── DAILY RITUALS QUICK ───
function renderDailyRitualsQuick() {
  const c=$('#daily-rituals-quick'); if(!c)return;
  renderRitualSelectors();
  if(!state.rituals.length){c.innerHTML='<div class="empty-state empty-state-compact"><div class="empty-state-icon"><svg class="icon" aria-hidden="true"><use href="#i-repeat"/></svg></div><div class="empty-state-text">Escribe arriba tu primer ritual diario. Para elegir días específicos usa "Editar días".</div><button class="zen-btn zen-btn-primary" id="empty-daily-ritual-btn">Agregar mi primer ritual</button></div>';c.querySelector('#empty-daily-ritual-btn')?.addEventListener('click',()=>$('#daily-ritual-input')?.focus());return;}
  const date = todayStr();
  const scheduled = state.rituals.filter(r => isRitualScheduled(r, date));
  const list = scheduled.length ? scheduled : state.rituals;
  c.innerHTML=(scheduled.length?'':'<div class="calendar-save-hint">No hay rituales programados para hoy; mostrando todos.</div>') + list.map(r=>{const done=isRitualCompleted(r,date); return `<div style="display:flex;align-items:center;gap:12px;padding:8px 0;border-bottom:1px solid var(--border-subtle);"><button class="ritual-check ${done?'completed':''}" data-rid="${r.id}"></button><span style="font-size:0.85rem;${done?'text-decoration:line-through;color:var(--text-muted);':''}">${esc(r.name)}</span></div>`;}).join('');
  c.querySelectorAll('.ritual-check').forEach(b=>b.addEventListener('click',()=>{const r=state.rituals.find(x=>x.id===b.dataset.rid);if(r){setRitualCompleted(r,date,!isRitualCompleted(r,date));saveState();renderDailyRitualsQuick();renderRituals();if($('#tab-reflection')&&$('#tab-reflection').classList.contains('active'))renderCalendar();calcStreak();}}));
}

function renderRitualSelectors() {
  const goalOptions = '<option value="">Sin meta</option>' + activeGoals().map(goal => `<option value="${esc(goal.id)}">${esc(goal.goal)}</option>`).join('');
  ['#daily-ritual-goal', '#ritual-goal'].forEach(selector => { const el = $(selector); if (el) el.innerHTML = goalOptions; });
  const area = $('#ritual-life-area');
  if (area) area.innerHTML = '<option value="">Sin área</option>' + LIFE_WHEEL_AXES.map(axis => `<option value="${esc(axis.key)}">${esc(axis.label)}</option>`).join('');
}

// ─── RITUALS (Weekly) ───
function initRituals() {
  $('#add-ritual-btn').addEventListener('click',()=>addRitual('#ritual-input',false));
  $('#ritual-input').addEventListener('keydown',e=>{if(e.key==='Enter')addRitual('#ritual-input',false);});
  $('#add-daily-ritual-btn')?.addEventListener('click',()=>addRitual('#daily-ritual-input',true));
  $('#daily-ritual-input')?.addEventListener('keydown',e=>{if(e.key==='Enter')addRitual('#daily-ritual-input',true);});
  $('#edit-ritual-days-btn')?.addEventListener('click',()=>{switchTab('metas',{focus:true});activateSubtab('metas','strat-habits',true);});
}
// Desde "Hoy" el ritual se crea programado todos los días; desde "Semanal" se eligen los días en la tabla.
function addRitual(inputSelector='#ritual-input', everyDay=false) { const i=$(inputSelector),n=i?.value.trim(); if(!n)return; if(state.rituals.length>=10){showToast('Máximo 10 rituales');return;} const goalId=(everyDay?$('#daily-ritual-goal'):$('#ritual-goal'))?.value||''; const lifeArea=$('#ritual-life-area')?.value||''; state.rituals.push({id:gid(),name:n,goalId,lifeArea,createdAt:new Date().toISOString(),days:{lun:everyDay,mar:everyDay,mie:everyDay,jue:everyDay,vie:everyDay,sab:everyDay,dom:everyDay},completions:{}}); saveState();i.value='';renderRituals();renderDailyRitualsQuick();renderSmartGoals();showToast(everyDay?'Ritual diario agregado':'Ritual agregado'); }
function renderRituals() {
  const c=$('#rituals-container'); if(!c)return;
  if(!state.rituals.length){c.innerHTML='<div class="empty-state"><div class="empty-state-icon"><svg class="icon" aria-hidden="true"><use href="#i-repeat"/></svg></div><div class="empty-state-text">Agrega tu primer ritual</div><button class="zen-btn zen-btn-primary" id="empty-rituals-btn">Agregar mi primer ritual</button></div>';c.querySelector('#empty-rituals-btn')?.addEventListener('click',()=>$('#ritual-input')?.focus());return;}
  const dl=['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'], dk=['lun','mar','mie','jue','vie','sab','dom'];
  let h=`<table class="rituals-grid"><thead><tr><th style="text-align:left;padding-left:12px;">Ritual</th>${dl.map(d=>`<th>${d}</th>`).join('')}<th></th></tr></thead><tbody>`;
  state.rituals.forEach(r=>{h+=`<tr><td class="ritual-name">${esc(r.name)}</td>${dk.map(d=>{const scheduled=r.days&&r.days[d]===true;return`<td><button class="ritual-check ${scheduled?'completed':''}" title="Programar este ritual" data-rid="${r.id}" data-day="${d}"></button></td>`;}).join('')}<td><button class="btn-delete" data-del-rit="${r.id}" style="opacity:0.5;" aria-label="Eliminar"><svg class="icon" aria-hidden="true"><use href="#i-x"/></svg></button></td></tr>`;});
  h+='</tbody></table>'; c.innerHTML=h;
  c.querySelectorAll('.ritual-check').forEach(b=>b.addEventListener('click',()=>{const r=state.rituals.find(x=>x.id===b.dataset.rid);if(r){if(!r.days)r.days={};r.days[b.dataset.day]=r.days[b.dataset.day]===true?false:true;saveState();renderRituals();renderDailyRitualsQuick();if($('#tab-reflection')&&$('#tab-reflection').classList.contains('active'))renderCalendar();showToast('Rutina semanal guardada');}}));
  c.querySelectorAll('[data-del-rit]').forEach(b=>b.addEventListener('click',()=>{state.rituals=state.rituals.filter(r=>r.id!==b.dataset.delRit);saveState();renderRituals();renderDailyRitualsQuick();}));
}
function initWeeklyReflection() {
  const w=$('#weekly-well'),a=$('#weekly-adjust');
  if(w){w.value=state.weeklyReflection.well||'';w.addEventListener('blur',()=>{state.weeklyReflection.well=w.value;saveState();});}
  if(a){a.value=state.weeklyReflection.adjust||'';a.addEventListener('blur',()=>{state.weeklyReflection.adjust=a.value;saveState();});}
  if($('#save-weekly-btn')) $('#save-weekly-btn').addEventListener('click', saveWeeklyReflection);
  if($('#ai-weekly-btn')) {
    $('#ai-weekly-btn').addEventListener('click', async () => {
      const w=$('#weekly-well').value;
      const a=$('#weekly-adjust').value;
      if(!w && !a) { showToast('Escribe tu reflexión primero'); return; }
      try {
        const prompt = `Reflexión semanal del usuario:\nSalió bien: ${w}\nAjustará: ${a}\nComo su coach de alto rendimiento, dale un feedback directo, desafiante y empoderador (máximo 2 párrafos).`;
        const result = await callAI(prompt, 'Eres un coach estricto pero empático que exige la excelencia.');
        let feedbackBox = $('#ai-weekly-btn')?.parentNode?.querySelector('[data-ai-weekly-feedback]');
        if(!feedbackBox) {
          feedbackBox = document.createElement('div');
          feedbackBox.dataset.aiWeeklyFeedback = 'true';
          feedbackBox.style.cssText = 'margin-top: 16px; padding: 16px; background: rgba(74, 127, 181, 0.1); border-left: 3px solid var(--accent-blue); border-radius: var(--radius-sm); font-size: 0.9rem; color: var(--text-primary); white-space: pre-wrap; line-height: 1.5;';
          $('#ai-weekly-btn').parentNode.appendChild(feedbackBox);
        }
        feedbackBox.textContent = 'Coach:\n' + result;
        showToast('Análisis completado');
      } catch (e) {
        showToast(e.message);
      }
    });
  }
}

let weeklyWizardStep = 1;
const WEEKLY_WIZARD_STEPS = 5;

function goToWeeklyWizardStep(step) {
  weeklyWizardStep = Math.min(Math.max(1, step), WEEKLY_WIZARD_STEPS);
  const wizard = $('#weekly-wizard');
  if (!wizard) return;
  wizard.querySelectorAll('[data-wizard-panel]').forEach(panel => {
    const active = Number(panel.dataset.wizardPanel) === weeklyWizardStep;
    panel.hidden = !active;
  });
  wizard.querySelectorAll('.wizard-step-pill').forEach(pill => {
    const active = Number(pill.dataset.wizardStep) === weeklyWizardStep;
    pill.classList.toggle('active', active);
    pill.setAttribute('aria-selected', String(active));
  });
  const backBtn = $('#weekly-wizard-back-btn');
  const nextBtn = $('#weekly-wizard-next-btn');
  const saveBtn = $('#save-weekly-btn');
  if (backBtn) backBtn.hidden = weeklyWizardStep === 1;
  if (nextBtn) nextBtn.hidden = weeklyWizardStep === WEEKLY_WIZARD_STEPS;
  if (saveBtn) saveBtn.hidden = weeklyWizardStep !== WEEKLY_WIZARD_STEPS;
}

function initWeeklyWizard() {
  const wizard = $('#weekly-wizard');
  if (!wizard) return;
  wizard.querySelectorAll('.wizard-step-pill').forEach(pill => {
    pill.addEventListener('click', () => goToWeeklyWizardStep(Number(pill.dataset.wizardStep)));
  });
  $('#weekly-wizard-back-btn')?.addEventListener('click', () => goToWeeklyWizardStep(weeklyWizardStep - 1));
  $('#weekly-wizard-next-btn')?.addEventListener('click', () => goToWeeklyWizardStep(weeklyWizardStep + 1));
  wizard.addEventListener('keydown', event => {
    if (event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
    if (event.key === 'ArrowRight') { goToWeeklyWizardStep(weeklyWizardStep + 1); event.preventDefault(); }
    else if (event.key === 'ArrowLeft') { goToWeeklyWizardStep(weeklyWizardStep - 1); event.preventDefault(); }
  });
  goToWeeklyWizardStep(1);
}

function saveWeeklyReflection() {
  const w=$('#weekly-well'),a=$('#weekly-adjust');
  if(w) state.weeklyReflection.well=w.value;
  if(a) state.weeklyReflection.adjust=a.value;
  const goalUpdates = [];
  $$('[data-week-goal-progress]').forEach(input => {
    const goal = state.smartGoals.find(item => item.id === input.dataset.weekGoalProgress);
    if (!goal) return;
    const from = Number(goal.progress || 0);
    const to = Number(input.value || 0);
    recordGoalProgress(goal, to);
    const step = $(`[data-week-goal-step="${CSS.escape(goal.id)}"]`)?.value.trim();
    if (step !== undefined) goal.nextStep = step;
    const status = $(`[data-week-goal-status="${CSS.escape(goal.id)}"]`)?.value;
    if (status) { goal.status = status; goal.completed = status === 'done' || Number(goal.progress || 0) >= 100; }
    goalUpdates.push({ goalId: goal.id, from, to, nextStep: goal.nextStep || '' });
  });
  const focusGoalIds = Array.from($$('[data-week-focus-goal]')).filter(input => input.checked).slice(0, 3).map(input => input.dataset.weekFocusGoal);
  state.weekFocus = { weekKey: weekKey(todayStr()), goalIds: focusGoalIds };
  $$('[data-week-ritual-keep]').forEach(input => {
    if (!input.checked) state.rituals = state.rituals.filter(ritual => ritual.id !== input.dataset.weekRitualKeep);
  });
  if (!state.weeklyReviews) state.weeklyReviews = [];
  const currentWeek = weekKey(todayStr());
  const review = {
    id: gid(),
    weekKey: currentWeek,
    createdAt: new Date().toISOString(),
    stats: weekStats(state, currentWeek, todayStr()),
    well: state.weeklyReflection.well || '',
    adjust: state.weeklyReflection.adjust || '',
    goalUpdates,
    focusGoalIds,
    lifeWheel: JSON.parse(JSON.stringify(state.lifeWheel || {}))
  };
  state.weeklyReviews = [...state.weeklyReviews.filter(item => item.weekKey !== currentWeek), review].slice(-104);
  state.sectionDates.weekly = todayStr();
  saveState();
  logActivity(todayStr());
  showToast('Revisión semanal guardada');
  renderWeeklyReviewWizard(); renderSmartGoals(); renderDailyRitualsQuick(); renderRituals();
  goToWeeklyWizardStep(1);
  if($('#tab-reflection')&&$('#tab-reflection').classList.contains('active'))renderCalendar();
}

function renderWeeklyReflection() {
  const w=$('#weekly-well'),a=$('#weekly-adjust');
  if(w && document.activeElement !== w) w.value=state.weeklyReflection.well||'';
  if(a && document.activeElement !== a) a.value=state.weeklyReflection.adjust||'';
}

function renderWeeklyReviewWizard() {
  const currentWeek = weekKey(todayStr());
  const stats = weekStats(state, currentWeek, todayStr());
  const statsEl = $('#weekly-review-stats');
  if (statsEl) {
    statsEl.innerHTML = [
      ['Tareas', `${stats.tasksCompleted}/${stats.tasksTotal}`],
      ['Rituales', `${stats.ritualRate}%`],
      ['Foco', stats.focusSessions],
      ['Días activos', stats.activeDays]
    ].map(([label, value]) => `<div class="weekly-stat"><span>${esc(label)}</span><strong>${esc(String(value))}</strong></div>`).join('');
  }
  const goalsEl = $('#weekly-review-goals');
  if (goalsEl) {
    const goals = activeGoals();
    goalsEl.innerHTML = goals.length ? goals.map(goal => `<div class="weekly-goal-row"><strong>${esc(goal.goal)}</strong><div class="grid-2"><input class="zen-input" type="number" min="0" max="100" value="${Number(goal.progress || 0)}" data-week-goal-progress="${esc(goal.id)}"><input class="zen-input" value="${esc(goal.nextStep || '')}" data-week-goal-step="${esc(goal.id)}" placeholder="Siguiente paso"></div><select class="zen-input" data-week-goal-status="${esc(goal.id)}"><option value="active" ${goal.status==='active'?'selected':''}>Activa</option><option value="paused" ${goal.status==='paused'?'selected':''}>Pausar</option><option value="done" ${goal.status==='done'?'selected':''}>Lograda</option></select></div>`).join('') : '<p class="card-subtitle">No hay metas activas todavía.</p>';
  }
  const focusEl = $('#weekly-review-focus');
  if (focusEl) {
    const selected = new Set(state.weekFocus?.goalIds || []);
    focusEl.innerHTML = activeGoals().map(goal => `<label class="weekly-focus-row"><input type="checkbox" data-week-focus-goal="${esc(goal.id)}" ${selected.has(goal.id)?'checked':''}> <span>${esc(goal.goal)}</span></label>`).join('') || '<p class="card-subtitle">Crea una meta para elegir foco semanal.</p>';
  }
  const systemEl = $('#weekly-review-system');
  if (systemEl) {
    const rituals = (state.rituals || []).map(ritual => `<label class="weekly-focus-row"><input type="checkbox" data-week-ritual-keep="${esc(ritual.id)}" checked> <span>${esc(ritual.name)}</span></label>`).join('');
    systemEl.innerHTML = `<div><span class="smart-label">Rituales</span>${rituals || '<p class="card-subtitle">Sin rituales todavía.</p>'}</div><div style="margin-top:14px;"><span class="smart-label">Dejar de hacer</span><div id="weekly-stop-doing-preview">${(state.stopDoingList||[]).filter(Boolean).map(item => `<span class="task-goal-tag">${esc(item)}</span>`).join('') || '<p class="card-subtitle">Sin lista todavía.</p>'}</div></div>`;
  }
}

function renderAdvancedTools() {
  const slot = $('#mind-advanced-tools');
  const section = $('.profile-assessments-section');
  if (slot && section && section.parentElement !== slot) slot.appendChild(section);
  if (section) section.hidden = state.settings?.advancedTools !== true;
}

function renderLifeWheel() {
  if (!lifeWheelComponent) lifeWheelComponent = new LifeWheel({ $, getState: () => state, saveState });
  lifeWheelComponent.render();
}

// ─── SMART GOALS ───
let smartAch=false;
function initSmartGoals() {
  $('#add-smart-btn').addEventListener('click',()=>openSmartForm());
  $('#cancel-smart-btn').addEventListener('click',()=>{$('#smart-form').style.display='none';$('#add-smart-btn').style.display='';clearSmart();});
  $('#smart-achievable').addEventListener('click',()=>{smartAch=!smartAch;$('#smart-achievable').classList.toggle('on',smartAch);});
  $('#smart-duration').addEventListener('input',()=>{$('#smart-duration-label').textContent=$('#smart-duration').value;});
  $('#smart-progress').addEventListener('input',()=>{$('#smart-progress-label').textContent=$('#smart-progress').value;});
  $('#save-smart-btn').addEventListener('click',saveSmart);
}
function openSmartForm(prefill = {}) {
  renderSmartSelectors();
  $('#smart-form').style.display='block';
  $('#add-smart-btn').style.display='none';
  if (prefill.goal) $('#smart-goal-input').value = prefill.goal;
  if (prefill.nextStep) $('#smart-next-step').value = prefill.nextStep;
  if (prefill.lifeArea && $('#smart-life-area')) $('#smart-life-area').value = prefill.lifeArea;
  if (prefill.big5Index !== undefined && $('#smart-big5')) $('#smart-big5').value = String(prefill.big5Index);
  switchTab('metas', { focus: true });
  activateSubtab('metas', 'strat-quarterly', true);
  $('#smart-goal-input')?.focus();
}
function renderSmartSelectors() {
  const big5 = $('#smart-big5');
  if (big5) {
    const options = (state.annualBig5 || []).map((item, index) => ({ item, index })).filter(entry => entry.item);
    big5.innerHTML = '<option value="">Sin vínculo</option>' + options.map(entry => `<option value="${entry.index}">${entry.index + 1}. ${esc(entry.item)}</option>`).join('');
  }
  const area = $('#smart-life-area');
  if (area) area.innerHTML = '<option value="">Sin área</option>' + LIFE_WHEEL_AXES.map(axis => `<option value="${esc(axis.key)}">${esc(axis.label)}</option>`).join('');
}
function clearSmart(){
  $('#smart-goal-input').value='';
  $('#smart-measurable').value='';
  $('#smart-relevance').value='';
  $('#smart-duration').value=30;
  $('#smart-duration-label').textContent='30';
  $('#smart-progress').value=0;
  $('#smart-progress-label').textContent='0';
  $('#smart-next-step').value='';
  if($('#smart-big5')) $('#smart-big5').value='';
  if($('#smart-life-area')) $('#smart-life-area').value='';
  smartAch=false;
  $('#smart-achievable').classList.remove('on');
}
function saveSmart(){
  const g=$('#smart-goal-input').value.trim();
  if(!g){showToast('Define tu meta');return;}
  state.smartGoals.push({
    id:gid(),
    goal:g,
    measurable:$('#smart-measurable').value.trim(),
    achievable:smartAch,
    relevance:$('#smart-relevance').value.trim(),
    duration:+$('#smart-duration').value,
    progress:+$('#smart-progress').value,
    nextStep:$('#smart-next-step').value.trim(),
    big5Index: $('#smart-big5')?.value === '' ? null : Number($('#smart-big5')?.value),
    lifeArea: $('#smart-life-area')?.value || '',
    status: +$('#smart-progress').value>=100 ? 'done' : 'active',
    progressHistory: [{ date: todayStr(), progress: +$('#smart-progress').value }],
    createdAt: new Date().toISOString(),
    startDate:todayStr(),
    completed:+$('#smart-progress').value>=100
  });
  saveState();clearSmart();$('#smart-form').style.display='none';$('#add-smart-btn').style.display='';renderSmartGoals();showToast('Objetivo SMART guardado');
}
function renderSmartGoals(){
  const c=$('#smart-goals-container');if(!c)return;
  if(!state.smartGoals.length){c.innerHTML='<div class="empty-state"><div class="empty-state-icon"><svg class="icon" aria-hidden="true"><use href="#i-target"/></svg></div><div class="empty-state-text">Crea tu primer objetivo SMART</div><button class="zen-btn zen-btn-primary" id="empty-smart-btn">Crear mi primera meta</button></div>';c.querySelector('#empty-smart-btn')?.addEventListener('click',()=>$('#add-smart-btn')?.click());return;}
  const focusIds = new Set(state.weekFocus?.goalIds || []);
  c.innerHTML=state.smartGoals.map(g=>{const st=new Date(g.startDate),now=new Date(),el=Math.floor((now-st)/864e5),pr=Math.min(100,Math.round(el/g.duration*100)),dl=Math.max(0,g.duration-el);
    const real=Math.min(100,Math.max(0,Number(g.progress||0)));
    const focusBadge = focusIds.has(g.id) ? '<span class="focus-badge">En foco</span>' : '';
    return`<div class="smart-card" style="margin-top:16px;"><div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;"><div><div style="font-family:'Playfair Display',serif;font-size:1.1rem;font-weight:600;margin-bottom:8px;">${esc(g.goal)} ${focusBadge}</div><div style="display:flex;gap:16px;flex-wrap:wrap;margin-top:12px;"><div class="smart-field"><span class="smart-label">Medible</span><div style="font-size:0.9rem;">${esc(g.measurable||'—')}</div></div><div class="smart-field"><span class="smart-label">Relevancia</span><div style="font-size:0.9rem;">${esc(g.relevance||'—')}</div></div><div class="smart-field"><span class="smart-label">Alcanzable</span><div style="font-size:0.9rem;">${g.achievable?'Si':'No definido'}</div></div><div class="smart-field"><span class="smart-label">Plazo</span><div style="font-size:0.9rem;">${g.duration} dias (quedan ${dl})</div></div></div></div><button class="btn-delete" data-del-sm="${g.id}" style="opacity:0.6;" aria-label="Eliminar"><svg class="icon" aria-hidden="true"><use href="#i-x"/></svg></button></div><div class="smart-progress-panel"><div class="smart-progress-row"><span class="smart-label">Avance real</span><strong>${real}%</strong></div><input type="range" class="timeline-slider smart-progress-input" min="0" max="100" value="${real}" data-progress-sm="${g.id}"><div class="smart-progress-track"><div style="width:${real}%"></div></div><label class="smart-label" style="margin-top:12px;">Siguiente avance visible</label><input class="zen-input smart-next-step-input" value="${esc(g.nextStep||'')}" data-next-sm="${g.id}" placeholder="Define el siguiente paso medible..."><div class="smart-time-progress"><span>Progreso temporal</span><span>${pr}%</span></div></div></div>`;}).join('');
  c.querySelectorAll('[data-del-sm]').forEach(b=>b.addEventListener('click',()=>{state.smartGoals=state.smartGoals.filter(g=>g.id!==b.dataset.delSm);saveState();renderSmartGoals();}));
  c.querySelectorAll('[data-progress-sm]').forEach(inp=>{
    const updateSmartProgressUI = () => {
      const card = inp.closest('.smart-card');
      const value = +inp.value;
      const strong = card?.querySelector('.smart-progress-row strong');
      const bar = card?.querySelector('.smart-progress-track > div');
      if (strong) strong.textContent = `${value}%`;
      if (bar) bar.style.width = `${value}%`;
    };
    inp.addEventListener('input', updateSmartProgressUI);
    inp.addEventListener('change',()=>{const g=state.smartGoals.find(x=>x.id===inp.dataset.progressSm);if(g){recordGoalProgress(g,+inp.value);saveState();if($('#tab-reflection')&&$('#tab-reflection').classList.contains('active'))renderProgress();}});
  });
  c.querySelectorAll('[data-next-sm]').forEach(inp=>inp.addEventListener('blur',()=>{const g=state.smartGoals.find(x=>x.id===inp.dataset.nextSm);if(g){g.nextStep=inp.value.trim();saveState();}}));
}

// ─── LEARNING ───
function initLearning(){['book','course','conference','mastermind'].forEach(f=>{const el=$(`#learning-${f}`);if(el){el.value=state.learning[f]||'';el.addEventListener('blur',()=>{state.learning[f]=el.value;saveState();});}});if($('#save-learning-btn'))$('#save-learning-btn').addEventListener('click',saveLearning);}
function renderLearning(){['book','course','conference','mastermind'].forEach(f=>{const el=$(`#learning-${f}`);if(el&&document.activeElement!==el)el.value=state.learning[f]||'';});}
function saveLearning(){['book','course','conference','mastermind'].forEach(f=>{const el=$(`#learning-${f}`);if(el)state.learning[f]=el.value;});state.sectionDates.learning=todayStr();saveState();logActivity(todayStr());showToast('Aprendizaje guardado');}

// ─── STOP DOING LIST ───
function renderStopDoing() {
  const c=$('#stop-doing-list'); if(!c)return;
  if(!state.stopDoingList) state.stopDoingList=['','','','','','','','','',''];
  c.innerHTML=state.stopDoingList.map((item,i)=>`<div class="stop-doing-item"><span class="stop-doing-number">${i+1}</span><input class="zen-input" value="${esc(item)}" data-stop-idx="${i}" placeholder="Dejaré de..."></div>`).join('');
  c.querySelectorAll('[data-stop-idx]').forEach(inp=>inp.addEventListener('blur',()=>{state.stopDoingList[+inp.dataset.stopIdx]=inp.value;saveState();}));
}
function initStopDoing(){if($('#save-stop-doing-btn'))$('#save-stop-doing-btn').addEventListener('click',saveStopDoing);}
function saveStopDoing(){const inputs=$$('[data-stop-idx]');inputs.forEach(inp=>{state.stopDoingList[+inp.dataset.stopIdx]=inp.value;});state.sectionDates.stopDoing=todayStr();saveState();logActivity(todayStr());showToast('Lista guardada');}

// ─── CIRCLE OF GIANTS ───
function initGiants(){$('#add-giant-btn').addEventListener('click',()=>{if(state.circleOfGiants.length>=5){showToast('Máximo 5 gigantes');return;}$('#giant-form').style.display='block';$('#add-giant-btn').style.display='none';});$('#cancel-giant-btn').addEventListener('click',()=>{$('#giant-form').style.display='none';$('#add-giant-btn').style.display='';});$('#save-giant-btn').addEventListener('click',saveGiant);}
function saveGiant(){const n=$('#giant-name').value.trim();if(!n){showToast('Escribe el nombre');return;}state.circleOfGiants.push({id:gid(),name:n,role:$('#giant-role').value.trim(),action:$('#giant-action').value.trim(),status:$('#giant-status').value,lastContact:todayStr()});saveState();$('#giant-name').value='';$('#giant-role').value='';$('#giant-action').value='';$('#giant-form').style.display='none';$('#add-giant-btn').style.display='';renderGiants();showToast('Gigante agregado');}
function renderGiants(){const c=$('#giants-container');if(!c)return;if(!state.circleOfGiants.length){c.innerHTML='<div class="empty-state"><div class="empty-state-icon"><svg class="icon" aria-hidden="true"><use href="#i-users"/></svg></div><div class="empty-state-text">Agrega a las 5 personas que más impulsan tu crecimiento</div></div>';return;}c.innerHTML=state.circleOfGiants.map(g=>{const i=g.name.charAt(0).toUpperCase(),sc=g.status==='connected'?'connected':'to-reach',st=g.status==='connected'?'Conectado':'Por Contactar';return`<div class="giant-card"><div class="giant-avatar">${i}</div><div class="giant-info"><span class="giant-name">${esc(g.name)}</span><span class="giant-role">${esc(g.role||'Sin rol')}</span>${g.action?`<span style="font-size:0.7rem;color:var(--accent-orange);margin-top:2px;">→ ${esc(g.action)}</span>`:''}</div><div style="display:flex;align-items:center;gap:8px;"><span class="giant-status ${sc}">${st}</span><button class="btn-delete" data-del-gi="${g.id}" style="opacity:0.5;" aria-label="Eliminar"><svg class="icon" aria-hidden="true"><use href="#i-x"/></svg></button></div></div>`;}).join('');c.querySelectorAll('[data-del-gi]').forEach(b=>b.addEventListener('click',()=>{state.circleOfGiants=state.circleOfGiants.filter(g=>g.id!==b.dataset.delGi);saveState();renderGiants();}));}

// ─── QUARTERLY 10 ───
function initQuarterly(){if($('#save-quarterly-btn'))$('#save-quarterly-btn').addEventListener('click',saveQuarterly);}
function renderQuarterly10(){const c=$('#quarterly10-container');if(!c)return;c.innerHTML=state.quarterly10.map((item,i)=>`<div class="big5-item quarterly-idea-item"><span class="big5-number" style="color:var(--accent-orange);">${i+1}</span><input class="zen-input" value="${esc(item)}" data-q10="${i}" placeholder="Idea ${i+1}...">${item?`<button class="zen-btn zen-btn-ghost" data-convert-q10="${i}">Convertir en meta</button>`:''}</div>`).join('');c.querySelectorAll('[data-q10]').forEach(inp=>inp.addEventListener('blur',()=>{state.quarterly10[+inp.dataset.q10]=inp.value;saveState();renderQuarterly10();}));c.querySelectorAll('[data-convert-q10]').forEach(btn=>btn.addEventListener('click',()=>{const idea=state.quarterly10[+btn.dataset.convertQ10]||'';if(idea)openSmartForm({goal:idea});}));}
function saveQuarterly(){ $$('[data-q10]').forEach(inp=>{state.quarterly10[+inp.dataset.q10]=inp.value;}); state.sectionDates.quarterly=todayStr(); saveState(); logActivity(todayStr()); showToast('Prioridades trimestrales guardadas');}

// ─── ANNUAL ───
function initAnnual() {
  if($('#save-annual-btn'))$('#save-annual-btn').addEventListener('click',saveAnnual);

  const editVisionBtn = $('#edit-vision-btn');
  const visionCard = $('#vision-card');
  const saveVisionBtn = $('#save-annual-btn');
  if(editVisionBtn && visionCard) {
    editVisionBtn.addEventListener('click', () => {
      visionCard.classList.remove('view-mode');
      editVisionBtn.style.display = 'none';
      if(saveVisionBtn) saveVisionBtn.style.display = 'block';
    });
  }
}
function renderAnnual(){renderB5('annual-big5',state.annualBig5,'big5');renderB5('annual-values',state.values5,'values');renderB5('annual-become',state.mustBecome5,'become');const v=$('#vision-text');if(v&&document.activeElement!==v){v.value=state.visionText||'';}}
function renderB5(cid,data,sk){const c=$(`#${cid}`);if(!c)return;const ph={big5:['Meta anual principal...','Segunda gran meta...','Tercer objetivo...','Cuarta prioridad...','Quinta meta...'],values:['Primer valor...','Segundo valor...','Tercer valor...','Cuarto valor...','Quinto valor...'],become:['¿En quién me convertiré?','Segunda identidad...','Tercer aspecto...','Cuarta cualidad...','Quinta transformación...']};c.innerHTML=data.map((item,i)=>{const activeCount=sk==='big5'?(state.smartGoals||[]).filter(goal=>goal.big5Index===i&&goal.status!=='done'&&goal.status!=='paused'&&!goal.completed).length:0;return`<div class="big5-item"><span class="big5-number">${i+1}</span><input class="zen-input" value="${esc(item)}" data-lk="${sk}" data-li="${i}" placeholder="${esc((ph[sk]&&ph[sk][i])||'')}">${sk==='big5'&&item?`<span class="task-goal-tag">${activeCount} metas activas</span>${activeCount===0?`<button class="zen-btn zen-btn-ghost" data-create-big5="${i}">Crear</button>`:''}`:''}</div>`;}).join('');c.querySelectorAll(`[data-lk="${sk}"]`).forEach(inp=>inp.addEventListener('blur',()=>{const idx=+inp.dataset.li;if(sk==='big5')state.annualBig5[idx]=inp.value;else if(sk==='values')state.values5[idx]=inp.value;else state.mustBecome5[idx]=inp.value;saveState();renderSmartSelectors();}));c.querySelectorAll('[data-create-big5]').forEach(btn=>btn.addEventListener('click',()=>openSmartForm({big5Index:+btn.dataset.createBig5})));}
function saveAnnual(){
  const v=$('#vision-text');if(v)state.visionText=v.value;$$('[data-lk]').forEach(inp=>{const idx=+inp.dataset.li;if(inp.dataset.lk==='big5')state.annualBig5[idx]=inp.value;else if(inp.dataset.lk==='values')state.values5[idx]=inp.value;else if(inp.dataset.lk==='become')state.mustBecome5[idx]=inp.value;});state.sectionDates.annual=todayStr();saveState();logActivity(todayStr());showToast('Visión anual guardada');
  const editVisionBtn = $('#edit-vision-btn');
  const visionCard = $('#vision-card');
  const saveVisionBtn = $('#save-annual-btn');
  if(visionCard) visionCard.classList.add('view-mode');
  if(editVisionBtn) editVisionBtn.style.display = 'block';
  if(saveVisionBtn) saveVisionBtn.style.display = 'none';
}

// ─── CALENDAR ───
function initCalendar() {
  const prev = $('#cal-prev');
  const next = $('#cal-next');
  if (prev) {
    prev.addEventListener('click', () => {
      calDate.setMonth(calDate.getMonth() - 1);
      renderCalendar();
    });
  }
  if (next) {
    next.addEventListener('click', () => {
      calDate.setMonth(calDate.getMonth() + 1);
      renderCalendar();
    });
  }
}

function renderCalendar() {
  const grid = $('#calendar-grid'); if(!grid) return;
  const y = calDate.getFullYear(), m = calDate.getMonth();
  const first = new Date(y, m, 1), last = new Date(y, m+1, 0);
  const today = todayStr();
  
  // Update navigation header title
  const titleEl = $('#cal-month-title');
  if (titleEl) {
    const monthName = calDate.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' });
    titleEl.textContent = monthName.charAt(0).toUpperCase() + monthName.slice(1);
  }
  
  let html = '';
  const days = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
  days.forEach(d => html += `<div class="cal-header-cell">${d}</div>`);
  for (let i = 0; i < first.getDay(); i++) html += `<div class="cal-day empty"></div>`;
  for (let i = 1; i <= last.getDate(); i++) {
    const dStr = `${y}-${String(m+1).padStart(2,'0')}-${String(i).padStart(2,'0')}`;
    const activity = getDayActivity(dStr);
    const dots = [
      activity.victories.length ? '<span class="cal-dot victory"></span>' : '',
      activity.prides.length ? '<span class="cal-dot pride"></span>' : '',
      activity.gratitude.length ? '<span class="cal-dot gratitude"></span>' : '',
      activity.beliefs.length ? '<span class="cal-dot belief"></span>' : '',
      activity.tasks.length ? '<span class="cal-dot task"></span>' : '',
      activity.smartGoals.length ? '<span class="cal-dot smart"></span>' : '',
      activity.sectionItems.length ? '<span class="cal-dot section"></span>' : '',
      activity.focusCount ? '<span class="cal-dot focus"></span>' : '',
      (activity.scheduledRituals.length || activity.completedRituals.length) ? '<span class="cal-dot ritual"></span>' : ''
    ].join('');
    const act = activity.total ? 'active' : '';
    const isToday = dStr === today ? 'today' : '';
    const selected = dStr === selectedCalendarDate ? 'selected' : '';
    html += `<button class="cal-day ${act} ${isToday} ${selected}" data-cal-date="${dStr}"><span class="cal-day-number">${i}</span><span class="cal-day-dots">${dots}</span></button>`;
  }
  grid.innerHTML = html;
  grid.querySelectorAll('[data-cal-date]').forEach(day => day.addEventListener('click', () => renderDayDetail(day.dataset.calDate)));
}

function getDayActivity(dateStr) {
  const tasks = state.dailyTasks[dateStr] || [];
  const scheduledRituals = (state.rituals || []).filter(r => isRitualScheduled(r, dateStr));
  const completedRituals = (state.rituals || []).filter(r => isRitualCompleted(r, dateStr));
  const focusCount = state.activityLog && state.activityLog[dateStr] ? state.activityLog[dateStr] : 0;
  const smartGoals = (state.smartGoals || []).filter(goal => isSmartGoalActiveOn(goal, dateStr));
  const sectionItems = getSectionItemsForDate(dateStr);
  const data = {
    victories: state.victories.filter(x => x.date === dateStr),
    prides: state.prideLogs.filter(x => x.date === dateStr),
    gratitude: (state.gratitudeLogs || []).filter(x => x.date === dateStr),
    beliefs: state.beliefs.filter(x => x.date === dateStr),
    tasks,
    scheduledRituals,
    completedRituals,
    smartGoals,
    sectionItems,
    focusCount
  };
  data.total = data.victories.length + data.prides.length + data.gratitude.length + data.beliefs.length + data.tasks.length + data.completedRituals.length + data.smartGoals.length + data.sectionItems.length + focusCount;
  return data;
}

function isSmartGoalActiveOn(goal, dateStr) {
  if (!goal || !goal.startDate || !goal.duration) return false;
  const start = new Date(goal.startDate + 'T00:00:00');
  const day = new Date(dateStr + 'T00:00:00');
  const elapsed = Math.floor((day - start) / 864e5);
  return elapsed >= 0 && elapsed <= Number(goal.duration || 0);
}

function getSectionItemsForDate(dateStr) {
  const items = [];
  const dates = state.sectionDates || {};
  if (dates.weekly === dateStr && (state.weeklyReflection.well || state.weeklyReflection.adjust)) {
    if (state.weeklyReflection.well) items.push({ section:'Semanal', text:`Salió bien: ${state.weeklyReflection.well}` });
    if (state.weeklyReflection.adjust) items.push({ section:'Semanal', text:`Ajuste: ${state.weeklyReflection.adjust}` });
  }
  if (dates.learning === dateStr && state.learning) {
    [['Libro',state.learning.book],['Curso',state.learning.course],['Conferencia',state.learning.conference],['Mastermind',state.learning.mastermind]].forEach(([label,value]) => {
      if (value) items.push({ section:'Aprendizaje', text:`${label}: ${value}` });
    });
  }
  if (dates.stopDoing === dateStr && state.stopDoingList) {
    state.stopDoingList.filter(Boolean).forEach(value => items.push({ section:'Dejar de hacer', text:value }));
  }
  if (dates.quarterly === dateStr && state.quarterly10) {
    state.quarterly10.filter(Boolean).forEach((value, i) => items.push({ section:'Trimestral', text:`${i + 1}. ${value}` }));
  }
  if (dates.annual === dateStr) {
    if (state.visionText) items.push({ section:'Anual', text:`Visión: ${state.visionText}` });
    (state.annualBig5 || []).filter(Boolean).forEach((value, i) => items.push({ section:'Big 5', text:`${i + 1}. ${value}` }));
    (state.values5 || []).filter(Boolean).forEach((value, i) => items.push({ section:'Valores', text:`${i + 1}. ${value}` }));
    (state.mustBecome5 || []).filter(Boolean).forEach((value, i) => items.push({ section:'Identidad', text:`${i + 1}. ${value}` }));
  }
  return items;
}

function renderDayDetail(dateStr) {
  const panel = $('#cal-day-detail');
  const content = $('#cal-detail-content');
  if (!panel || !content) return;
  selectedCalendarDate = dateStr;
  const activity = getDayActivity(dateStr);
  $('#cal-detail-title').textContent = `Detalle del ${fmtDate(dateStr)}`;
  const taskHtml = activity.tasks.map(t => `<div class="cal-detail-item cal-task-item"><span class="read-status ${t.completed?'done':''}"></span><span>${esc(t.text)}</span><span class="task-priority-tag ${t.priority||'medium'}">${t.priority==='high'?'Alta':t.priority==='low'?'Baja':'Media'}</span></div>`).join('');
  const ritualHtml = activity.scheduledRituals.map(r => {
    const done = isRitualCompleted(r, dateStr);
    return `<div class="cal-detail-item cal-task-item"><span class="read-status ${done?'done':''}"></span><span>${esc(r.name)}</span><span class="cal-status-pill">${done?'Completado':'Programado'}</span></div>`;
  }).join('');
  const smartHtml = activity.smartGoals.map(g => `<div class="cal-detail-item"><strong>${esc(g.goal)}</strong><div class="cal-detail-meta">${Number(g.progress||0)}% avance real${g.nextStep?` · ${esc(g.nextStep)}`:''}</div></div>`).join('');
  const sectionHtml = activity.sectionItems.map(item => `<div class="cal-detail-item"><strong>${esc(item.section)}</strong><div class="cal-detail-meta">${esc(item.text)}</div></div>`).join('');
  const groups = [
    ['Tareas', taskHtml],
    ['Rituales programados', ritualHtml],
    ['Metas SMART activas', smartHtml],
    ['Secciones guardadas', sectionHtml],
    ['Gratitud', activity.gratitude.map(x => x.content)],
    ['Orgullos', activity.prides.map(x => x.content)],
    ['Victorias', activity.victories.map(x => x.content || x.text || x.title || 'Victoria registrada')],
    ['Creencias reconfiguradas', activity.beliefs.map(x => `${x.belief} -> ${x.reframe}`)],
    ['Sesiones de enfoque', activity.focusCount ? [`${activity.focusCount} acción(es) registradas`] : []]
  ];
  const html = groups.filter(([,items]) => Array.isArray(items) ? items.length : items).map(([title,items]) => `
    <div class="cal-detail-group">
      <div class="cal-detail-heading">${title}</div>
      ${Array.isArray(items) ? items.map(item => `<div class="cal-detail-item">${esc(item)}</div>`).join('') : items}
    </div>
  `).join('');
  content.innerHTML = html || '<div class="empty-state empty-state-compact"><div class="empty-state-text">No hay actividades registradas este dia.</div><button class="zen-btn zen-btn-primary" id="empty-calendar-day-btn">Planear hoy</button></div>';content.querySelector('#empty-calendar-day-btn')?.addEventListener('click',()=>switchTab('hoy',{focus:true}));
  panel.style.display = 'block';
  renderCalendar();
}

// ─── PROFILE & AI CONFIG ───
function openAiSettingsModal() {
  const modal = $('#ai-settings-modal');
  if (!modal) return;
  modal.style.display = 'flex';
  renderProfile(); // Pre-fill AI settings
}

function closeAiSettingsModal() {
  const modal = $('#ai-settings-modal');
  if (modal) modal.style.display = 'none';
}

function initProfile() {
  const btn = $('#save-profile-btn');
  if (btn) btn.addEventListener('click', saveProfile);
  
  const aiBtn = $('#save-ai-btn');
  if (aiBtn) aiBtn.addEventListener('click', () => saveAIConfig('modal'));
  $('#save-ai-key-session-btn')?.addEventListener('click', () => saveAIKeyForSession('modal'));
  $('#test-ai-connection-btn')?.addEventListener('click', () => testAIConnection('modal'));
  $('#clear-ai-key-btn')?.addEventListener('click', clearAIKeyForSession);
  $('#ai-provider')?.addEventListener('change', syncAIModelDefault);
  $('#profile-save-ai-key-btn')?.addEventListener('click', () => saveAIKeyForSession('profile'));
  $('#profile-test-ai-connection-btn')?.addEventListener('click', () => testAIConnection('profile'));
  $('#profile-clear-ai-key-btn')?.addEventListener('click', clearAIKeyForSession);
  $('#profile-ai-provider')?.addEventListener('change', syncAIModelDefault);
  
  $$('.ai-report-btn').forEach(b => b.addEventListener('click', () => generateAIReport(b.dataset.type)));

  const closeAiBtn = $('#close-ai-settings-btn');
  if (closeAiBtn) {
    closeAiBtn.addEventListener('click', () => closeAiSettingsModal());
  }
  $('#open-ai-connection-profile-btn')?.addEventListener('click', () => openAiSettingsModal());
  $('#restart-onboarding-btn')?.addEventListener('click', () => startOnboardingTour(true));
  $('#open-advanced-settings-btn')?.addEventListener('click', () => openAiSettingsModal());
  $('#export-data-btn')?.addEventListener('click', () => {
    const payload = JSON.stringify(getCloudSafeState(), null, 2);
    const url = URL.createObjectURL(new Blob([payload], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `roka-datos-${todayStr()}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    showToast('Copia de datos preparada');
  });
  $('#profile-context-core')?.addEventListener('change', event => {
    state.coachPreferences.useCoreContext = event.target.checked;
    saveState();
  });
  $('#profile-context-sensitive')?.addEventListener('change', event => {
    state.coachPreferences.useSensitiveContext = event.target.checked;
    saveState();
  });
  $('#profile-advanced-tools')?.addEventListener('change', event => {
    state.settings.advancedTools = event.target.checked;
    saveState();
    renderAdvancedTools();
  });
  $('#profile-coach-style')?.addEventListener('change', event => {
    state.coachPreferences.style = event.target.value;
    saveState();
  });
  renderThemePresets();

  const editProfileBtn = $('#edit-profile-btn');
  const profileCard = $('#profile-card');
  if (editProfileBtn && profileCard) {
    editProfileBtn.addEventListener('click', () => {
      profileCard.classList.remove('view-mode');
      editProfileBtn.style.display = 'none';
      if (btn) btn.style.display = 'block';
    });
  }
}

function saveProfile() {
  if (!state.userProfile) state.userProfile = { name: '', archetype: '', fears: '', values: '', learning: '', lifeHistory: '', enneagram: '', birthDate: '', birthTime: '', birthPlace: '' };
  state.userProfile.name = $('#profile-name').value;
  if (document.querySelector('#profile-archetype')) state.userProfile.archetype = document.querySelector('#profile-archetype').value;
  state.userProfile.fears = $('#profile-fears').value;
  state.userProfile.values = $('#profile-values').value;
  if (document.querySelector('#profile-learning')) state.userProfile.learning = document.querySelector('#profile-learning').value;
  state.userProfile.lifeHistory = $('#profile-life-history').value;
  if (document.querySelector('#profile-enneagram')) state.userProfile.enneagram = document.querySelector('#profile-enneagram').value;
  state.userProfile.birthDate = $('#profile-birth-date').value;
  state.userProfile.birthTime = $('#profile-birth-time').value;
  state.userProfile.birthPlace = $('#profile-birth-place').value;
  saveState();
  addXP(20, 'Configuración actualizada');
  
  const profileCard = $('#profile-card');
  const editProfileBtn = $('#edit-profile-btn');
  const btn = $('#save-profile-btn');
  if (profileCard) profileCard.classList.add('view-mode');
  if (editProfileBtn) editProfileBtn.style.display = 'block';
  if (btn) btn.style.display = 'none';
}

function saveAIConfig(source = 'modal') {
  if (!state.aiConfig) state.aiConfig = { prompt: '' };
  state.aiConfig.prompt = $('#ai-prompt')?.value.trim() || '';
  state.coachPreferences.useCoreContext = $('#ai-context-core')?.checked !== false;
  state.coachPreferences.useSensitiveContext = $('#ai-context-sensitive')?.checked === true;
  saveAIConnectionFields(source);
  const { keyEl, rememberEl } = getAIFormFields(source);
  const typedKey = keyEl?.value.trim() || '';
  if (typedKey) {
    storeAIKey(typedKey, rememberEl?.checked === true);
    if (keyEl) keyEl.value = '';
  }
  delete state.aiConfig.apiKey;
  delete state.aiConfig.provider;
  delete state.aiConfig.model;
  saveState();
  $('#ai-settings-modal').style.display = 'none';
  renderProfile();
  showToast('Preferencias del Coach guardadas');
}

function renderProfile() {
  if (!state.userProfile) state.userProfile = { name: '', archetype: '', fears: '', values: '', learning: '', lifeHistory: '', enneagram: '', birthDate: '', birthTime: '', birthPlace: '' };
  const p = state.userProfile;
  if($('#profile-name')) $('#profile-name').value = p.name || '';
  if(document.querySelector('#profile-archetype')) document.querySelector('#profile-archetype').value = p.archetype || '';
  if($('#profile-fears')) $('#profile-fears').value = p.fears || '';
  if($('#profile-values')) $('#profile-values').value = p.values || '';
  if(document.querySelector('#profile-learning')) document.querySelector('#profile-learning').value = p.learning || '';
  if($('#profile-life-history')) $('#profile-life-history').value = p.lifeHistory || '';
  if(document.querySelector('#profile-enneagram')) document.querySelector('#profile-enneagram').value = p.enneagram || '';
  if($('#profile-birth-date')) $('#profile-birth-date').value = p.birthDate || '';
  if($('#profile-birth-time')) $('#profile-birth-time').value = p.birthTime || '';
  if($('#profile-birth-place')) $('#profile-birth-place').value = p.birthPlace || '';
  requestAnimationFrame(() => {
    $$('#profile-card textarea').forEach(area => {
      area.style.height = 'auto';
      area.style.height = `${Math.max(44, area.scrollHeight)}px`;
    });
  });
  
  if (!state.aiConfig) state.aiConfig = { prompt: '' };
  if($('#ai-prompt')) $('#ai-prompt').value = state.aiConfig.prompt || '';
  const provider = getAIProvider();
  syncAIConnectionFormFields(provider, getAIModel(provider));
  if($('#ai-api-key')) $('#ai-api-key').value = '';
  if($('#profile-ai-api-key')) $('#profile-ai-api-key').value = '';
  if($('#ai-remember-key')) $('#ai-remember-key').checked = Boolean(localStorage.getItem(AI_SESSION_KEY));
  if($('#profile-ai-remember-key')) $('#profile-ai-remember-key').checked = Boolean(localStorage.getItem(AI_SESSION_KEY));
  updateAIConnectionStatus();
  if($('#ai-context-core')) $('#ai-context-core').checked = state.coachPreferences.useCoreContext !== false;
  if($('#ai-context-sensitive')) $('#ai-context-sensitive').checked = state.coachPreferences.useSensitiveContext === true;
  if($('#profile-context-core')) $('#profile-context-core').checked = state.coachPreferences.useCoreContext !== false;
  if($('#profile-context-sensitive')) $('#profile-context-sensitive').checked = state.coachPreferences.useSensitiveContext === true;
  if($('#profile-advanced-tools')) $('#profile-advanced-tools').checked = state.settings?.advancedTools === true;
  if($('#profile-coach-style')) $('#profile-coach-style').value = state.coachPreferences.style || 'direct';
  renderThemePresets();
  
  if ($('#profile-xp-total')) $('#profile-xp-total').textContent = `${state.gamification ? state.gamification.xp : 0} XP Total`;
  
  const container = $('#badges-container');
  if (container) {
    if (!state.gamification) state.gamification = { xp: 0, level: 1, badges: [] };
    const unlocked = state.gamification.badges || [];
    container.innerHTML = BADGES.map(b => {
      const isUnlocked = unlocked.includes(b.id);
      return `<div class="badge-item ${isUnlocked ? 'unlocked' : ''}" title="${b.desc}">
        <div class="badge-icon">${b.icon}</div>
        <div class="badge-name">${b.name}</div>
      </div>`;
    }).join('');
  }
}

// ─── PROGRESS DASHBOARD ───
function renderProgress() {
  const totalV=state.victories.length, totalB=state.beliefs.length, totalM=state.mantras.length;
  const totalP=state.prideLogs.length, totalG=state.smartGoals.length;
  renderLifeAssessment();
  let streak=0; { let d=new Date(); for(let i=0;i<365;i++){const k=localDateKey(d);const has=getDayActivity(k).total;if(has){streak++;d.setDate(d.getDate()-1);}else{if(i===0){d.setDate(d.getDate()-1);continue;}break;}} }
  const ritualRate=(()=>{if(!state.rituals.length)return 0;const dk=['dom','lun','mar','mie','jue','vie','sab'];let total=0,done=0;state.rituals.forEach(r=>{dk.forEach(d=>{total++;if(r.days&&r.days[d]===true)done++;});});return total>0?Math.round(done/total*100):0;})();

  const stats=[
    {icon:'i-flame',value:streak,label:'Racha de dias',color:'var(--accent-orange)'},
    {icon:'i-check',value:totalV,label:'Victorias',color:'var(--accent-green)'},
    {icon:'i-refresh-cw',value:totalB,label:'Creencias rotas',color:'var(--accent-orange)'},
    {icon:'i-target',value:totalM,label:'Mantras activos',color:'var(--accent-green)'},
    {icon:'i-star',value:totalP,label:'Orgullos',color:'var(--accent-gold)'},
    {icon:'i-flag',value:totalG,label:'Metas SMART',color:'var(--accent-orange)'},
    {icon:'i-repeat',value:ritualRate+'%',label:'Rituales semana',color:'var(--accent-green)'},
    {icon:'i-users',value:state.circleOfGiants.length,label:'Gigantes',color:'var(--accent-gold)'}
  ];
  const statsGrid = $('#stats-grid');
  if(statsGrid) statsGrid.innerHTML=stats.map(s=>`<div class="stat-card"><div class="stat-icon"><svg class="icon" aria-hidden="true"><use href="#${s.icon}"/></svg></div><div class="stat-value" style="color:${s.color};">${s.value}</div><div class="stat-label">${s.label}</div></div>`).join('');
  renderWeeklyReviewTrend();

  // Heatmap
  const hm=$('#heatmap'); if(hm){hm.innerHTML='';
  for(let i=29;i>=0;i--){const d=new Date();d.setDate(d.getDate()-i);const k=localDateKey(d);
    let count=getDayActivity(k).total;
    const lvl=count===0?'':count===1?'level-1':count===2?'level-2':count===3?'level-3':'level-4';
    const cell=document.createElement('div');cell.className=`heatmap-cell ${lvl}`;cell.title=`${fmtDate(d)}: ${count} actividades`;hm.appendChild(cell);}}

  renderSmartProgressSummary();

  // Recent prides
  const rp=$('#recent-prides');
  if(rp){const recentP=state.prideLogs.slice(-5).reverse();
  rp.innerHTML=recentP.length?recentP.map(p=>`<div class="recent-item"><div class="recent-item-date">${fmtDate(p.date)}</div><div class="recent-item-text">${esc(p.content)}</div></div>`).join(''):'<div class="empty-state" style="padding:20px;"><div class="empty-state-text">Sin orgullos aun</div></div>';}

  // Recent beliefs
  const rb=$('#recent-beliefs');
  if(rb){const recentB=state.beliefs.slice(-5).reverse();
  rb.innerHTML=recentB.length?recentB.map(b=>`<div class="recent-item"><div class="recent-item-date">${fmtDate(b.date)}</div><div class="recent-item-belief">${esc(b.belief)}</div><div class="recent-item-reframe">-> ${esc(b.reframe)}</div></div>`).join(''):'<div class="empty-state" style="padding:20px;"><div class="empty-state-text">Sin creencias reconfiguradas</div></div>';}
}

function renderWeeklyReviewTrend() {
  const c = $('#weekly-review-trend');
  if (!c) return;
  const reviews = (state.weeklyReviews || []).slice(-8);
  if (!reviews.length) { c.innerHTML = ''; return; }
  c.innerHTML = `<div class="glass-card"><div class="card-header"><div class="card-title-group"><div class="card-icon green"><svg class="icon" aria-hidden="true"><use href="#i-trending-up"/></svg></div><h2 class="card-title">Tendencia de revisiones</h2></div></div><div class="trend-bars">${reviews.map(review => { const task = Number(review.stats?.taskRate || 0); const ritual = Number(review.stats?.ritualRate || 0); return `<div class="trend-bar-row"><span>${esc(review.weekKey || '')}</span><div class="trend-bar"><i style="width:${task}%"></i></div><div class="trend-bar ritual"><i style="width:${ritual}%"></i></div></div>`; }).join('')}</div></div>`;
}

function renderLifeAssessment() {
  const c = $('#life-assessment');
  if(!c) return;
  const avg = Math.round(LIFE_WHEEL_AXES.reduce((sum, axis) => sum + (Number(state.lifeWheel[axis.key]) || 0), 0) / LIFE_WHEEL_AXES.length * 10) / 10;
  c.innerHTML = `<div class="life-assessment-summary"><span>Promedio vital</span><strong>${avg}/10</strong></div>` + LIFE_WHEEL_AXES.map(axis => {
    const value = Number(state.lifeWheel[axis.key]) || 5;
    return `<div class="life-assessment-row"><div class="life-assessment-label">${axis.label}</div><input type="range" min="1" max="10" value="${value}" class="life-assessment-input" data-life-axis="${axis.key}"><div class="life-assessment-value">${value}</div></div>`;
  }).join('');
  c.querySelectorAll('[data-life-axis]').forEach(inp => inp.addEventListener('input', () => {
    state.lifeWheel[inp.dataset.lifeAxis] = +inp.value;
    saveState();
    renderLifeAssessment();
    if ($('#tab-strategy') && $('#tab-strategy').classList.contains('active')) renderLifeWheel();
  }));
}

function renderSmartProgressSummary() {
  const c = $('#smart-progress-summary');
  if(!c) return;
  if(!state.smartGoals.length) {
    c.innerHTML = '<div class="empty-state" style="padding:20px;"><div class="empty-state-text">Sin metas SMART aun</div></div>';
    return;
  }
  c.innerHTML = state.smartGoals.map(g => {
    const progress = Math.min(100, Math.max(0, Number(g.progress || 0)));
    return `<div class="smart-summary-item"><div class="smart-summary-top"><span>${esc(g.goal)}</span><strong>${progress}%</strong></div><div class="smart-progress-track"><div style="width:${progress}%"></div></div>${g.nextStep?`<div class="smart-summary-step">${esc(g.nextStep)}</div>`:''}</div>`;
  }).join('');
}

// ─── USER JOURNEY & CENTRAL AI ───
function getCompletionScore() {
  const today = todayStr();
  const tasks = state.dailyTasks[today] || [];
  const checks = [
    !!(state.userProfile && state.userProfile.name),
    !!(state.userProfile && state.userProfile.values),
    !!(state.userProfile && state.userProfile.fears),
    !!(state.personalMap && state.personalMap.archetype),
    !!(state.personalMap && state.personalMap.enneagram),
    !!(state.personalMap && state.personalMap.productivity),
    tasks.length > 0,
    tasks.some(t => t.completed),
    (state.gratitudeLogs || []).some(g => g.date === today),
    (state.prideLogs || []).some(p => p.date === today),
    (state.smartGoals || []).length > 0,
    (state.rituals || []).length > 0,
    hasCompletedRitual(today)
  ];
  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
}

function getUserJourneyStatus() {
  const today = todayStr();
  const score = getCompletionScore();
  const tasks = state.dailyTasks[today] || [];
  const completedTasks = tasks.filter(t => t.completed).length;
  const missing = [];
  if (!state.userProfile?.name) missing.push('completa tu perfil base');
  if (!state.personalMap?.archetype || !state.personalMap?.enneagram || !state.personalMap?.productivity) missing.push('calcula tu mapa personal');
  if (!tasks.length) missing.push('define el plan del día');
  if (!(state.gratitudeLogs || []).some(g => g.date === today)) missing.push('registra gratitud');
  if (!(state.prideLogs || []).some(p => p.date === today)) missing.push('registra un orgullo');
  if (!(state.smartGoals || []).length) missing.push('crea una meta SMART');

  let nextAction = 'Genera tu ruta IA para ordenar el día.';
  if (missing.length) nextAction = `Siguiente acción: ${missing[0]}.`;
  else if (completedTasks < tasks.length) nextAction = 'Siguiente acción: ejecuta la tarea más importante pendiente.';
  else nextAction = 'Día sólido: revisa progreso y pide lectura semanal cuando cierres.';

  return {
    score,
    nextAction,
    missing,
    steps: [
      { key: 'llenar', label: 'Llenar', done: tasks.length > 0 || !!state.userProfile?.name },
      { key: 'entender', label: 'Entender', done: !!state.personalMap?.archetype && !!state.personalMap?.enneagram },
      { key: 'planear', label: 'Planear', done: (state.smartGoals || []).length > 0 },
      { key: 'ejecutar', label: 'Ejecutar', done: completedTasks > 0 || hasCompletedRitual(today) },
      { key: 'revisar', label: 'Revisar', done: (state.prideLogs || []).some(p => p.date === today) }
    ]
  };
}

function renderJourneyStatus() {
  const status = getUserJourneyStatus();
  const scoreEl = $('#journey-completion-score');
  const meter = $('#journey-meter-fill');
  const next = $('#journey-next-action');
  const steps = $('#journey-steps');
  const ready = $('#ai-readiness');
  if (scoreEl) scoreEl.textContent = `${status.score}%`;
  if (meter) meter.style.width = `${status.score}%`;
  if (next) next.textContent = status.nextAction;
  if (steps) {
    steps.innerHTML = status.steps.map(step => `<span class="journey-step ${step.done ? 'done' : ''}">${step.label}</span>`).join('');
  }
  if (ready) {
    ready.innerHTML = status.missing.length
      ? `<strong>Para una lectura más precisa:</strong> ${esc(status.missing.slice(0, 3).join(', '))}.`
      : '<strong>Listo:</strong> la IA ya tiene suficiente contexto para una lectura útil.';
  }
}

function getTodayRecommendationContext() {
  const today = todayStr();
  const tasks = state.dailyTasks[today] || [];
  const gratitude = (state.gratitudeLogs || []).filter(g => g.date === today).map(g => g.content).join(' | ') || 'Sin gratitud hoy';
  const prides = (state.prideLogs || []).filter(p => p.date === today).map(p => p.content).join(' | ') || 'Sin orgullos hoy';
  const status = getUserJourneyStatus();
  return `Fecha: ${today}
Completitud: ${status.score}%
Siguiente acción detectada: ${status.nextAction}
Tareas de hoy: ${tasks.map(t => `${t.completed ? '[x]' : '[ ]'} ${t.text} (${t.priority || 'media'})`).join('; ') || 'Sin tareas'}
Gratitud: ${gratitude}
Orgullos: ${prides}
${buildWholeAppContext()}`;
}

async function generateDailyAIRoute() {
  const status = getUserJourneyStatus();
  if (status.score < 20) showSaveStatus('empty');
  const prompt = `Con este contexto de la app, crea una Ruta Zen para hoy. Debe ser breve, accionable y priorizada.

${getTodayRecommendationContext()}

Formato obligatorio:
1. Lectura del día en 2 líneas.
2. Tareas sugeridas desde los siguientes pasos de metas activas.
3. Tres pasos de ejecución para la primera tarea.
4. Un riesgo a evitar.
5. Frase de cierre tipo mantra, sobria.`;
  try {
    showSaveStatus('ai');
    const response = await callAI(prompt, 'Eres un coach central de vida, productividad y enfoque. Tono ryokan: sobrio, claro, directo, sin motivación genérica.');
    const report = { id: gid(), type: 'daily-route', title: 'Ruta Zen de Hoy', content: response, date: todayStr() };
    await saveAIReport(report);
    renderJourneyStatus();
    switchTab('coach');
    showCoachView('reports');
    showToast('Ruta de hoy generada');
  } catch(e) {
    showSaveStatus('error', e.message);
  }
}

async function generateWeeklyReview() {
  const prompt = `Genera una revisión semanal accionable a partir del sistema ROKA.

${getTodayRecommendationContext()}

Formato obligatorio:
1. Patron principal observado.
2. Lo que debe continuar.
3. Lo que debe detenerse.
4. Tres prioridades para la semana.
5. Siguiente paso SMART.`;
  try {
    showSaveStatus('ai');
    const response = await callAI(prompt, 'Eres un estratega semanal. Lee patrones, contradicciones y siguiente acción. Nada de relleno.');
    const report = { id: gid(), type: 'weekly-review', title: 'Revisión Semanal IA', content: response, date: todayStr() };
    await saveAIReport(report);
    switchTab('coach');
    showCoachView('reports');
    showToast('Revisión semanal generada');
  } catch(e) {
    showSaveStatus('error', e.message);
  }
}

// ─── AI INTEGRATION ───
async function callAI(prompt, systemInstruction = '') {
  const sysPrompt = state.aiConfig.prompt ? state.aiConfig.prompt + '\n' + systemInstruction : systemInstruction;
  if (!currentUser) throw new Error('Inicia sesión para usar el Coach.');
  showToast('Coach ROKA está pensando...');
  try {
    const authToken = await currentUser.getIdToken();
    const result = await callAIGateway({ mode: 'report', prompt, systemInstruction: sysPrompt, authToken, ...getAIConnectionConfig() });
    return result.text;
  } catch (error) { throw new Error('Error de conexión IA: ' + error.message); }
}

function getAIProvider() {
  const stored = localStorage.getItem(AI_PROVIDER_KEY);
  return AI_PROVIDER_DEFAULTS[stored] ? stored : 'openai';
}

function getAIModel(provider = getAIProvider()) {
  const stored = localStorage.getItem(AI_MODEL_KEY);
  return stored || AI_PROVIDER_DEFAULTS[provider] || AI_PROVIDER_DEFAULTS.openai;
}

function getAIConnectionConfig() {
  const provider = getAIProvider();
  return {
    provider,
    model: getAIModel(provider),
    clientApiKey: getStoredAIKey()
  };
}

function getStoredAIKey() {
  return sessionStorage.getItem(AI_SESSION_KEY) || localStorage.getItem(AI_SESSION_KEY) || '';
}

function storeAIKey(key, remember = false) {
  sessionStorage.setItem(AI_SESSION_KEY, key);
  if (remember) localStorage.setItem(AI_SESSION_KEY, key);
  else localStorage.removeItem(AI_SESSION_KEY);
}

function clearStoredAIKey() {
  sessionStorage.removeItem(AI_SESSION_KEY);
  localStorage.removeItem(AI_SESSION_KEY);
}

function updateAIConnectionStatus(message = '') {
  const hasKey = Boolean(getStoredAIKey());
  const provider = getAIProvider();
  const model = getAIModel(provider);
  const route = provider === 'openai'
    ? 'ruta: gateway /api/ai'
    : `ruta: directo ${provider === 'google' ? 'Gemini' : 'DeepSeek'}`;
  const text = message || (hasKey
    ? `Clave IA guardada. Proveedor: ${provider}. Modelo: ${model}. ${route}.`
    : `Falta API key o backend activo. Proveedor: ${provider}. Modelo: ${model}.`);
  ['#ai-connection-status', '#profile-ai-connection-status'].forEach(selector => {
    const status = $(selector);
    if (status) status.textContent = text;
  });
}

function syncAIModelDefault(event) {
  const providerEl = event?.target || $('#ai-provider') || $('#profile-ai-provider');
  const modelEl = providerEl?.id === 'profile-ai-provider' ? $('#profile-ai-model') : $('#ai-model');
  if (!providerEl || !modelEl) return;
  const provider = AI_PROVIDER_DEFAULTS[providerEl.value] ? providerEl.value : 'openai';
  modelEl.value = AI_PROVIDER_DEFAULTS[provider];
  localStorage.setItem(AI_PROVIDER_KEY, provider);
  localStorage.setItem(AI_MODEL_KEY, modelEl.value);
  syncAIConnectionFormFields(provider, modelEl.value);
  updateAIConnectionStatus(provider === 'openai'
    ? 'OpenAI usa el gateway /api/ai. Si Firebase Functions no está desplegado, prueba con Google Gemini o DeepSeek.'
    : '');
}

function getAIFormFields(source = 'profile') {
  const prefix = source === 'modal' ? 'ai' : 'profile-ai';
  return {
    providerEl: $(`#${prefix}-provider`),
    modelEl: $(`#${prefix}-model`),
    keyEl: $(`#${prefix}-api-key`),
    rememberEl: $(`#${prefix}-remember-key`)
  };
}

function saveAIConnectionFields(source = 'profile') {
  const { providerEl, modelEl } = getAIFormFields(source);
  const provider = providerEl?.value || getAIProvider();
  const safeProvider = AI_PROVIDER_DEFAULTS[provider] ? provider : 'openai';
  const model = modelEl?.value.trim() || AI_PROVIDER_DEFAULTS[safeProvider];
  localStorage.setItem(AI_PROVIDER_KEY, safeProvider);
  localStorage.setItem(AI_MODEL_KEY, model);
  syncAIConnectionFormFields(safeProvider, model);
  return { provider: safeProvider, model };
}

function syncAIConnectionFormFields(provider = getAIProvider(), model = getAIModel(provider)) {
  if ($('#ai-provider')) $('#ai-provider').value = provider;
  if ($('#ai-model')) $('#ai-model').value = model;
  if ($('#profile-ai-provider')) $('#profile-ai-provider').value = provider;
  if ($('#profile-ai-model')) $('#profile-ai-model').value = model;
  if (provider === 'openai') {
    updateAIConnectionStatus('OpenAI usa el gateway /api/ai. Si Firebase Functions no está desplegado, prueba con Google Gemini o DeepSeek.');
  } else {
    updateAIConnectionStatus();
  }
}

function saveAIKeyForSession(source = 'profile') {
  const config = saveAIConnectionFields(source);
  const { keyEl, rememberEl } = getAIFormFields(source);
  const key = keyEl?.value.trim() || '';
  if (!key) {
    showToast('Pega una API key para guardarla');
    return;
  }
  storeAIKey(key, rememberEl?.checked === true);
  if ($('#ai-api-key')) $('#ai-api-key').value = '';
  if ($('#profile-ai-api-key')) $('#profile-ai-api-key').value = '';
  const route = config.provider === 'openai' ? 'gateway /api/ai' : `directo ${config.provider === 'google' ? 'Gemini' : 'DeepSeek'}`;
  updateAIConnectionStatus(`Clave IA guardada. Proveedor: ${config.provider}. Modelo: ${config.model}. Ruta: ${route}.`);
  showToast('Clave IA guardada');
}

function clearAIKeyForSession() {
  clearStoredAIKey();
  if ($('#ai-api-key')) $('#ai-api-key').value = '';
  if ($('#profile-ai-api-key')) $('#profile-ai-api-key').value = '';
  updateAIConnectionStatus();
  showToast('Clave IA borrada de la sesión');
}

async function testAIConnection(source = 'profile') {
  if (!currentUser) { showToast('Inicia sesión para probar la IA'); return; }
  saveAIConnectionFields(source);
  const { keyEl, rememberEl } = getAIFormFields(source);
  const typedKey = keyEl?.value.trim() || '';
  const config = { ...getAIConnectionConfig(), clientApiKey: typedKey || getStoredAIKey() };
  try {
    showToast('Probando conexión IA...');
    const authToken = await currentUser.getIdToken();
    const result = await callAIGateway({
      mode: 'chat',
      authToken,
      messages: [{ role: 'user', content: 'Responde solamente: conexión ok' }],
      context: 'Prueba técnica breve de conexión IA.',
      systemInstruction: 'Responde en español, con dos palabras como máximo.',
      ...config
    });
    if (typedKey) {
      storeAIKey(typedKey, rememberEl?.checked === true);
      if ($('#ai-api-key')) $('#ai-api-key').value = '';
      if ($('#profile-ai-api-key')) $('#profile-ai-api-key').value = '';
    }
    const route = result.route || (config.provider === 'openai' ? 'gateway /api/ai' : `directo ${config.provider}`);
    updateAIConnectionStatus(`Conexión IA verificada. Proveedor: ${config.provider}. Modelo: ${config.model}. Ruta usada: ${route}.`);
    showToast('Conexión IA lista');
  } catch (error) {
    updateAIConnectionStatus('No se pudo conectar: ' + error.message);
    showToast('Error IA: ' + error.message);
  }
}

function resolveThemeCode(selection) {
  if (selection === 'auto') {
    const prefersLight = window.matchMedia?.('(prefers-color-scheme: light)')?.matches;
    return prefersLight ? THEME_AUTO_LIGHT : THEME_AUTO_DARK;
  }
  return THEME_PRESETS.some(item => item.code === selection) ? selection : 'zen-garden';
}

function applyThemePreset(selection = localStorage.getItem(THEME_PRESET_KEY) || 'zen-garden', persist = false) {
  const storedSelection = selection === 'auto' || THEME_PRESETS.some(item => item.code === selection) ? selection : 'zen-garden';
  const resolved = resolveThemeCode(storedSelection);
  document.body.classList.remove(...THEME_CLASS_NAMES);
  document.body.classList.add(`theme-${resolved}`);
  document.body.classList.toggle('light-theme', resolved === 'paper');
  if (persist) localStorage.setItem(THEME_PRESET_KEY, storedSelection);
  renderThemePresets();
}

function renderThemePresets() {
  const container = $('#theme-preset-grid');
  if (!container) return;
  const active = localStorage.getItem(THEME_PRESET_KEY) || 'zen-garden';
  const options = [...THEME_PRESETS, { code: 'auto', name: 'Automático', description: 'Sigue el tema de tu dispositivo (Zen o Papel)', swatches: ['#8fcfba', '#EFE8DA'] }];
  container.innerHTML = options.map(preset => `
    <button class="theme-preset-card ${active === preset.code ? 'active' : ''}" type="button" data-theme-preset="${esc(preset.code)}" aria-pressed="${active === preset.code}">
      <span class="theme-preset-swatches">${preset.swatches.map(color => `<i style="background:${esc(color)}"></i>`).join('')}</span>
      <b>${esc(preset.name)}</b>
      <small>${esc(preset.description)}</small>
    </button>
  `).join('');
  container.querySelectorAll('[data-theme-preset]').forEach(button => {
    button.addEventListener('click', () => {
      applyThemePreset(button.dataset.themePreset, true);
      showToast('Paleta visual actualizada');
    });
  });
}

async function generateAIReport(type) {
  if (!state.userProfile) { showToast('Guarda tu perfil primero.'); return; }
  const p = state.userProfile;
  let prompt = `Perfil del usuario:\nNombre: ${p.name||'Usuario'}\nEneagrama: ${p.enneagram||'No especificado'}\nValores: ${p.values||'No especificados'}\nMiedos: ${p.fears||'No especificados'}\nHistorial de vida: ${p.lifeHistory||'No provisto'}\nNacimiento: ${p.birthDate||'No provisto'} ${p.birthTime||''} en ${p.birthPlace||'No provisto'}\n\n`;
  let title = '';
  
  if (type === 'astral') {
    prompt += `Genera una Carta Astral completa y Misión de Vida basándote en su fecha, hora y lugar de nacimiento, combinándolo con sus miedos y valores.`;
    title = 'Carta Astral & Misión de Vida';
  } else if (type === 'psych') {
    prompt += `Genera un Perfil Psicológico Profundo basándote en su eneagrama, historial de vida y miedos. Usa psicología profunda para darle feedback transformacional.`;
    title = 'Perfil Psicológico & Eneagrama';
  } else if (type === 'strategy') {
    prompt += `Genera una Estrategia Zen a 5 Años. Desglosa los próximos pasos según sus valores, historial de vida, estilo de aprendizaje (${p.learning}) y arquetipo (${p.archetype}).`;
    title = 'Estrategia Zen a 5 Años';
  }

  try {
    const response = await callAI(prompt, 'Eres un maestro Zen, astrólogo experto y psicólogo profundo. Responde siempre en formato Markdown, con un tono sabio, claro y revelador. Mantén el formato ordenado y profundo.');
    const report = { id: gid(), type, title, content: response, date: todayStr() };
    if(!state.aiReports) state.aiReports = [];
    await saveAIReport(report);
    showToast('Reporte generado con éxito');
  } catch(e) { showToast(e.message); }
}

async function generateMapReport(type) {
  const p = state.userProfile || {};
  const map = state.personalMap || {};
  const context = buildWholeAppContext();
  const archetype = map.archetype ? ARCHETYPE_LABELS[map.archetype] : 'No calculado';
  const enneagram = map.enneagram ? `Tipo ${map.enneagram}` : 'No calculado';
  const productivity = map.productivity ? PRODUCTIVITY_LABELS[map.productivity] : 'No calculado';
  let title = 'Mapa Personal IA';
  let ask = 'Genera un mapa personal claro: fortalezas, bloqueos, estilo de acción, riesgos y recomendaciones.';
  if(type === 'steps') {
    title = 'Siguientes Pasos';
    ask = 'Genera un plan de pasos accionables: hoy, esta semana, este mes y próximos 90 días. Prioriza con claridad y evita frases genéricas.';
  } else if(type === 'deep') {
    title = 'Diagnóstico Profundo';
    ask = 'Genera un diagnóstico profundo integrando arquetipo, eneagrama, productividad, miedos, metas, hábitos y visión. Incluye contradicciones, patrones y palancas de cambio.';
  }
  const prompt = `
Nombre: ${p.name || 'Usuario'}
Arquetipo sugerido: ${archetype}
Eneagrama sugerido: ${enneagram}
Perfil de productividad: ${productivity}
Valores: ${p.values || 'No especificados'}
Miedos/bloqueos: ${p.fears || 'No especificados'}
Historia de vida: ${p.lifeHistory || 'No provista'}

Datos actuales de la app:
${context}

Solicitud:
${ask}

Formato obligatorio en Markdown:
## Resumen ejecutivo
Tres frases claras y específicas.
## Hallazgos
De tres a cinco hallazgos vinculados con los datos disponibles.
## Evidencia utilizada
Indica qué datos de ROKA sustentan la lectura y qué información falta.
## Plan de acción
Tres acciones concretas, priorizadas y medibles.
## Siguiente paso
Una sola acción que pueda comenzar hoy en menos de 25 minutos.

No presentes inferencias psicológicas, de personalidad o astrológicas como diagnóstico clínico o hecho comprobado.
`;
  try {
    const response = await callAI(prompt, 'Eres un estratega de vida y productividad con tono sobrio, preciso y práctico. Responde en español, con secciones claras y pasos concretos.');
    const report = { id: gid(), type: 'map-' + type, title, content: response, date: todayStr() };
    if(!state.aiReports) state.aiReports = [];
    await saveAIReport(report);
    showToast('Informe generado');
  } catch(e) { showToast('Error IA: ' + e.message); }
}

function buildWholeAppContext() {
  const avgLife = Math.round(LIFE_WHEEL_AXES.reduce((sum, axis) => sum + (Number(state.lifeWheel[axis.key]) || 0), 0) / LIFE_WHEEL_AXES.length * 10) / 10;
  const smart = activeGoals().map(g => `- ${g.goal} (${g.progress || 0}%): ${g.nextStep || 'sin siguiente paso'} | Big 5: ${g.big5Index !== null && g.big5Index !== undefined ? (state.annualBig5[g.big5Index] || 'sin texto') : 'sin vínculo'} | Área: ${getLifeAreaLabel(g.lifeArea) || 'sin área'}`).join('\n') || 'Sin metas SMART activas';
  const rituals = (state.rituals || []).map(r => { const ad = ritualAdherence(state, r.id, todayStr(), 7); return `- ${r.name}: ${ad.completed}/${ad.scheduled} últimos 7 días${r.goalId ? ` (meta: ${getGoalTitle(r.goalId)})` : ''}`; }).join('\n') || 'Sin rituales';
  const today = todayStr();
  const todayTasks = (state.dailyTasks[today] || []).map(t => `${t.completed?'[x]':'[ ]'} ${t.text}${t.goalId?` (meta: ${getGoalTitle(t.goalId)})`:''}`).join('; ') || 'Sin tareas hoy';
  const latestReview = [...(state.weeklyReviews || [])].sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||'')))[0];
  const lowAreas = lowLifeAreas(state, 4).map(area => `${getLifeAreaLabel(area.key)} ${area.value}/10`).join(', ') || 'Sin áreas bajo 4';
  const quarterly = (state.quarterly10 || []).filter(Boolean).map((x,i)=>`${i+1}. ${x}`).join('\n') || 'Sin prioridades trimestrales';
  const annual = (state.annualBig5 || []).filter(Boolean).map((x,i)=>`${i+1}. ${x}`).join('\n') || 'Sin Big 5 anual';
  const stop = (state.stopDoingList || []).filter(Boolean).map(x=>`- ${x}`).join('\n') || 'Sin lista de dejar de hacer';
  return `Promedio rueda de vida: ${avgLife}/10
Áreas bajas: ${lowAreas}
Foco semanal: ${(state.weekFocus?.goalIds || []).map(getGoalTitle).filter(Boolean).join(' | ') || 'Sin foco semanal'}
Tareas de hoy: ${todayTasks}
Metas SMART:
${smart}
Rituales:
${rituals}
Última revisión semanal:
Salió bien: ${latestReview?.well || 'Sin revisión'}
Ajuste: ${latestReview?.adjust || 'Sin revisión'}
Aprendizaje: libro=${state.learning.book || '-'}, curso=${state.learning.course || '-'}, conferencia=${state.learning.conference || '-'}, mastermind=${state.learning.mastermind || '-'}
Stop doing:
${stop}
Prioridades trimestrales:
${quarterly}
Visión anual: ${state.visionText || 'Sin visión'}
Big 5 anual:
${annual}
Mantras: ${(state.mantras || []).map(m=>m.text).join(' | ') || 'Sin mantras'}
Creencias reconfiguradas: ${(state.beliefs || []).map(b=>`${b.belief} -> ${b.reframe}`).join(' | ') || 'Sin creencias'}`;
}

function showCoachView(view = 'chat', updateHash = true) {
  const isChat = view === 'chat';
  $('#coach-chat-view')?.toggleAttribute('hidden', !isChat);
  $('#coach-reports-view')?.toggleAttribute('hidden', isChat);
  $$('.coach-view-tabs [data-coach-view]').forEach(button => {
    const active = button.dataset.coachView === view;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
  if (updateHash) setRouteHash('coach', isChat ? 'chat' : 'informes');
  if (!isChat) renderAIReportsList();
}

function coachThreadRef(threadId) {
  return doc(db, 'users', currentUser.uid, 'chatThreads', threadId);
}

async function createCoachThread() {
  const now = new Date().toISOString();
  const thread = { id: gid(), title: 'Nueva conversación', createdAt: now, updatedAt: now };
  coachThreads = [thread, ...coachThreads];
  activeCoachThreadId = thread.id;
  activeCoachMessages = [];
  renderCoachThreads();
  renderCoachMessages();
  if (currentUser) await setDoc(coachThreadRef(thread.id), thread).catch(error => console.warn('Conversación local pendiente.', error));
  $('#coach-input')?.focus();
  return thread;
}

async function loadCoachThreads() {
  if (!currentUser) return;
  try {
    const threadsRef = collection(db, 'users', currentUser.uid, 'chatThreads');
    const snapshot = await getDocs(query(threadsRef, orderBy('updatedAt', 'desc'), limit(30)));
    coachThreads = snapshot.docs.map(item => item.data());
  } catch (error) {
    console.warn('No se pudo cargar el historial del Coach.', error);
  }
  renderCoachThreads();
  if (coachThreads.length && !activeCoachThreadId) await openCoachThread(coachThreads[0].id);
}

async function openCoachThread(threadId) {
  activeCoachThreadId = threadId;
  const thread = coachThreads.find(item => item.id === threadId);
  if ($('#coach-thread-title')) $('#coach-thread-title').textContent = thread?.title || 'Conversación';
  renderCoachThreads();
  if (!currentUser) { activeCoachMessages = []; renderCoachMessages(); return; }
  try {
    const messagesRef = collection(db, 'users', currentUser.uid, 'chatThreads', threadId, 'messages');
    const snapshot = await getDocs(query(messagesRef, orderBy('createdAt', 'asc'), limit(100)));
    activeCoachMessages = snapshot.docs.map(item => item.data());
  } catch (error) {
    activeCoachMessages = [];
    console.warn('No se pudieron cargar los mensajes.', error);
  }
  renderCoachMessages();
}

function renderCoachThreads() {
  const container = $('#coach-thread-list');
  if (!container) return;
  container.innerHTML = coachThreads.length ? coachThreads.map(thread => `<button class="coach-thread-item ${thread.id === activeCoachThreadId ? 'active' : ''}" data-thread-id="${esc(thread.id)}">${esc(thread.title)}</button>`).join('') : '<p class="coach-privacy-note">Aquí aparecerán tus conversaciones.</p>';
  container.querySelectorAll('[data-thread-id]').forEach(button => button.addEventListener('click', () => openCoachThread(button.dataset.threadId)));
}

function renderCoachMessages() {
  const container = $('#coach-messages');
  if (!container) return;
  if (!activeCoachMessages.length) {
    container.innerHTML = `<div class="coach-welcome"><div class="coach-mark">R</div><h3>¿Qué necesitas resolver?</h3><p>Puedo ayudarte a elegir una prioridad, convertir una idea en meta o revisar por qué te estás deteniendo.</p><div class="coach-starters"><button data-coach-prompt="Ayúdame a elegir la acción más importante para hoy.">Priorizar mi día</button><button data-coach-prompt="Revisa mis metas y dime cuál necesita atención primero.">Revisar mis metas</button><button data-coach-prompt="Estoy bloqueado. Hazme preguntas para encontrar el siguiente paso.">Salir de un bloqueo</button></div></div>`;
  } else {
    container.innerHTML = activeCoachMessages.map(message => `<div class="coach-message ${message.role}${message.failed ? ' failed' : ''}"><div class="coach-message-bubble">${esc(message.content)}${message.role === 'assistant' ? `<div class="coach-message-actions">${message.failed ? `<button data-message-action="retry" data-message-id="${message.id}">Reintentar</button><button data-message-action="copy" data-message-id="${message.id}">Copiar</button>` : `<button data-message-action="copy" data-message-id="${message.id}">Copiar</button><button data-message-action="task" data-message-id="${message.id}">Guardar como tarea</button><button data-message-action="goal" data-message-id="${message.id}">Convertir en meta</button>`}</div>` : ''}</div></div>`).join('');
  }
  container.querySelectorAll('[data-coach-prompt]').forEach(button => button.addEventListener('click', () => {
    $('#coach-input').value = button.dataset.coachPrompt;
    $('#coach-input').focus();
  }));
  container.querySelectorAll('[data-message-action]').forEach(button => button.addEventListener('click', () => saveCoachMessageAs(button.dataset.messageAction, button.dataset.messageId)));
  container.scrollTop = container.scrollHeight;
}

async function persistCoachMessage(message) {
  if (!currentUser || !activeCoachThreadId) return;
  await setDoc(doc(db, 'users', currentUser.uid, 'chatThreads', activeCoachThreadId, 'messages', message.id), message);
}

function buildCoachContext() {
  if (state.coachPreferences.useCoreContext === false || $('#coach-use-context')?.checked === false) return 'El usuario decidió no compartir contexto de la app en esta conversación.';
  let context = `Pantalla de origen: ${ROUTES[coachOriginRoute]?.label || 'Hoy'}\n${getTodayRecommendationContext()}`;
  if (state.coachPreferences.useSensitiveContext) {
    context += `\nContexto sensible autorizado:\nMiedos o bloqueos: ${state.userProfile?.fears || 'Sin datos'}\nHistoria personal: ${state.userProfile?.lifeHistory || 'Sin datos'}\nNacimiento: ${state.userProfile?.birthDate || 'Sin datos'} ${state.userProfile?.birthPlace || ''}`;
  }
  return context;
}

async function sendCoachMessage(text) {
  const content = String(text || '').trim();
  if (!content || !currentUser) return;
  if (!activeCoachThreadId) await createCoachThread();
  const now = new Date().toISOString();
  const userMessage = { id: gid(), role: 'user', content, createdAt: now };
  activeCoachMessages.push(userMessage);
  renderCoachMessages();
  await persistCoachMessage(userMessage).catch(() => {});

  const thread = coachThreads.find(item => item.id === activeCoachThreadId);
  if (thread && thread.title === 'Nueva conversación') thread.title = content.slice(0, 52);
  if (thread) {
    thread.updatedAt = now;
    await setDoc(coachThreadRef(thread.id), thread).catch(() => {});
    if ($('#coach-thread-title')) $('#coach-thread-title').textContent = thread.title;
    renderCoachThreads();
  }

  await requestCoachReply();
}

async function requestCoachReply() {
  const sendButton = $('#coach-send-btn');
  const form = $('#coach-form');
  if (sendButton) { sendButton.disabled = true; sendButton.textContent = 'Pensando…'; }
  form?.setAttribute('aria-busy', 'true');
  try {
    const authToken = await currentUser.getIdToken();
    const messages = activeCoachMessages.filter(message => !message.failed).slice(-16).map(({ role, content: body }) => ({ role, content: body }));
    const response = await callAIGateway({
      mode: 'chat', authToken, messages, context: buildCoachContext(),
      systemInstruction: `Eres el Coach de ejecución de ROKA. Responde en español, con claridad, sin motivación genérica. Estilo: ${state.coachPreferences.style}. Termina con una acción concreta y breve.`,
      ...getAIConnectionConfig()
    });
    const assistantMessage = { id: gid(), role: 'assistant', content: response.text, usage: response.usage, createdAt: new Date().toISOString() };
    activeCoachMessages.push(assistantMessage);
    await persistCoachMessage(assistantMessage).catch(() => {});
  } catch (error) {
    activeCoachMessages.push({ id: gid(), role: 'assistant', content: `No pude responder ahora. ${error.message}\n\nPuedes intentarlo de nuevo en unos momentos.`, createdAt: new Date().toISOString(), failed: true });
  } finally {
    if (sendButton) { sendButton.disabled = false; sendButton.textContent = 'Enviar'; }
    form?.removeAttribute('aria-busy');
    renderCoachMessages();
  }
}

function saveCoachMessageAs(type, messageId) {
  const message = activeCoachMessages.find(item => item.id === messageId);
  if (!message) return;
  if (type === 'retry') {
    activeCoachMessages = activeCoachMessages.filter(item => item.id !== messageId);
    renderCoachMessages();
    requestCoachReply();
  } else if (type === 'copy') {
    navigator.clipboard.writeText(message.content || '').then(() => showToast('Respuesta copiada')).catch(() => showToast('No se pudo copiar'));
  } else if (type === 'task') {
    if (!confirm('¿Guardar esta recomendación como tarea para hoy?')) return;
    const today = todayStr();
    if (!state.dailyTasks[today]) state.dailyTasks[today] = [];
    state.dailyTasks[today].push({ id: gid(), text: message.content.slice(0, 240), priority: 'high', completed: false });
    saveState(); renderPlanner(); showToast('Tarea añadida a Hoy');
  } else if (type === 'goal') {
    if (!confirm('¿Convertir esta recomendación en una meta activa?')) return;
    state.smartGoals.push({ id: gid(), goal: message.content.slice(0, 180), measurable: '', achievable: true, relevance: 'Creada desde el Coach', duration: 90, progress: 0, nextStep: '', big5Index: null, lifeArea: '', status: 'active', progressHistory: [{ date: todayStr(), progress: 0 }], createdAt: new Date().toISOString(), startDate: todayStr(), completed: false });
    saveState(); renderSmartGoals(); showToast('Meta creada');
  }
}

function initCoach() {
  $$('.coach-view-tabs [data-coach-view]').forEach(button => button.addEventListener('click', () => showCoachView(button.dataset.coachView)));
  $('#new-chat-btn')?.addEventListener('click', createCoachThread);
  $('#new-chat-hero-btn')?.addEventListener('click', () => { showCoachView('chat'); createCoachThread(); });
  $('#coach-form')?.addEventListener('submit', event => {
    event.preventDefault();
    const input = $('#coach-input');
    const value = input.value;
    input.value = '';
    input.style.height = '';
    sendCoachMessage(value);
  });
  $('#coach-input')?.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); $('#coach-form').requestSubmit(); }
  });
  $('#coach-input')?.addEventListener('input', event => {
    event.target.style.height = 'auto';
    event.target.style.height = `${Math.min(160, event.target.scrollHeight)}px`;
  });
  renderCoachThreads();
  renderCoachMessages();
}

function getReportsCollection() {
  return currentUser ? collection(db, 'users', currentUser.uid, 'reports') : null;
}

async function saveAIReport(report) {
  const normalized = { ...report, createdAt: report.createdAt || new Date().toISOString() };
  reportCache = [normalized, ...reportCache.filter(item => item.id !== normalized.id)];
  renderAIReportsList();
  if (!currentUser) {
    state.aiReports = [normalized, ...(state.aiReports || []).filter(item => item.id !== normalized.id)];
    await saveState();
    return;
  }
  try {
    await setDoc(doc(db, 'users', currentUser.uid, 'reports', normalized.id), normalized);
  } catch (error) {
    state.aiReports = [normalized, ...(state.aiReports || []).filter(item => item.id !== normalized.id)];
    await saveState();
    console.warn('Informe guardado localmente; migración pendiente.', error);
  }
}

async function loadReports() {
  if (!currentUser) { renderAIReportsList(); return; }
  try {
    const snapshot = await getDocs(query(getReportsCollection(), orderBy('createdAt', 'desc'), limit(50)));
    reportCache = snapshot.docs.map(item => item.data());
  } catch (error) {
    console.warn('No se pudo cargar el historial de informes.', error);
  }
  renderAIReportsList();
}

async function migrateLegacyReports() {
  if (!currentUser || state.reportsMigrated || !(state.aiReports || []).length) return;
  try {
    for (const legacy of state.aiReports) {
      const normalized = { ...legacy, createdAt: legacy.createdAt || legacy.date || new Date().toISOString(), migratedFromState: true };
      await setDoc(doc(db, 'users', currentUser.uid, 'reports', normalized.id), normalized);
    }
    state.reportsMigrated = true;
    state.aiReports = [];
    await saveState(true);
    await flushCloudSave();
    await loadReports();
  } catch (error) {
    console.warn('Los informes anteriores se conservaron porque la migración no terminó.', error);
  }
}

function getVisibleReports() {
  const all = [...reportCache, ...(state.aiReports || [])];
  return [...new Map(all.map(report => [report.id, report])).values()]
    .sort((a, b) => Date.parse(b.createdAt || b.date || 0) - Date.parse(a.createdAt || a.date || 0));
}

function renderAIReportsList() {
  const container = $('#ai-reports-list');
  if (!container) return;
  const reports = getVisibleReports();
  if (!reports.length) {
    container.innerHTML = '<div class="empty-reports"><h3>Todavía no hay informes</h3><p>Genera un mapa personal o un diagnóstico para convertir tus datos en decisiones.</p><button class="zen-btn zen-btn-primary" id="empty-reports-btn">Generar mi primer informe</button></div>';container.querySelector('#empty-reports-btn')?.addEventListener('click',()=>$('.map-report-btn[data-report="personal"]')?.click());
    return;
  }
  container.innerHTML = reports.map(report => `
    <article class="report-item" data-report-id="${esc(report.id)}">
      <div class="report-summary">
        <div class="report-summary-top"><h3>${esc(report.title || 'Informe ROKA')}</h3><span class="report-date">${fmtDate(report.createdAt || report.date)}</span></div>
        <p class="report-preview">${esc(reportPreview(report.content || ''))}</p>
        <div class="report-controls">
          <button data-report-action="toggle">Abrir informe</button>
          <button data-report-action="ask">Preguntar al Coach</button>
          <button data-report-action="copy">Copiar</button>
          <button data-report-action="print">Imprimir</button>
          <button data-report-action="delete">Eliminar</button>
        </div>
      </div>
      <div class="report-body" hidden><div class="markdown-body">${renderSafeMarkdown(report.content || '')}</div></div>
    </article>`).join('');

  container.querySelectorAll('[data-report-action]').forEach(button => button.addEventListener('click', async () => {
    const article = button.closest('[data-report-id]');
    const report = reports.find(item => item.id === article?.dataset.reportId);
    if (!report) return;
    const action = button.dataset.reportAction;
    if (action === 'toggle') {
      const body = article.querySelector('.report-body');
      body.hidden = !body.hidden;
      button.textContent = body.hidden ? 'Abrir informe' : 'Cerrar informe';
    } else if (action === 'ask') {
      switchTab('coach');
      showCoachView('chat');
      const input = $('#coach-input');
      input.value = `Quiero conversar sobre el informe “${report.title}”. Ayúdame a elegir la acción más importante.`;
      input.focus();
    } else if (action === 'copy') {
      await navigator.clipboard.writeText(report.content || '');
      showToast('Informe copiado');
    } else if (action === 'print') {
      article.querySelector('.report-body').hidden = false;
      window.print();
    } else if (action === 'delete' && confirm(`¿Eliminar “${report.title}”? Esta acción no se puede deshacer.`)) {
      reportCache = reportCache.filter(item => item.id !== report.id);
      state.aiReports = (state.aiReports || []).filter(item => item.id !== report.id);
      if (currentUser) await deleteDoc(doc(db, 'users', currentUser.uid, 'reports', report.id)).catch(() => {});
      await saveState(true);
      await flushCloudSave();
      renderAIReportsList();
    }
  }));
}


// ─── RENDER ALL ───
function renderAll() { 
  renderQuote(); renderPride(); renderGratitude(); 
  renderPlanner(); renderRituals(); renderDailyRitualsQuick(); renderWeeklyReflection(); 
  renderSmartGoals(); renderLearning(); renderStopDoing(); renderGiants(); renderQuarterly10(); renderAnnual(); renderPersonalMap(); renderProfile(); renderProgress(); renderBeliefsLibrary(); renderMantras(); updateXPDisplay(); checkBadges();
  renderTodaySystem();
  renderWeeklyReviewWizard();
  renderAdvancedTools();
  renderJourneyStatus();
  updateClarityPanel();
  renderCalendar();
  if (typeof renderLifeWheel === 'function') renderLifeWheel();
  calcStreak();
}

// ─── ONBOARDING TOUR LOGIC ───
let tourStep = 0;
let tourWasRestarted = false;
const onboardingDraft = { goal: '', action: '', habit: '' };
const TOUR_STEPS = [
  { title: "¿Qué quieres lograr en los próximos 90 días?", desc: "Escribe un resultado concreto. ROKA lo convertirá en una meta activa.", input: true, label: "Meta a 90 días", placeholder: "Ejemplo: conseguir tres nuevos clientes este trimestre", key: 'goal' },
  { title: "¿Cuál es el primer paso?", desc: "Define una acción que puedas poner en tu plan de hoy.", input: true, label: "Primer paso", placeholder: "Ejemplo: escribir y enviar la primera propuesta", key: 'action' },
  { title: "¿Qué hábito diario te acerca a eso?", desc: "Este paso es opcional. Si lo escribes, se creará un ritual diario vinculado a la meta.", input: true, optional: true, label: "Hábito diario", placeholder: "Ejemplo: prospectar 20 minutos", key: 'habit' }
];

function startOnboardingTour(restarted = false) {
  tourWasRestarted = restarted;
  tourStep = 0;
  onboardingDraft.goal = '';
  onboardingDraft.action = '';
  onboardingDraft.habit = '';
  showTourStep();
}

function showTourStep() {
  const overlay = $('#onboarding-overlay');
  if (!overlay) return;
  overlay.style.display = 'flex';
  
  const step = TOUR_STEPS[tourStep];
  $('#onboarding-title').textContent = step.title;
  $('#onboarding-desc').textContent = step.desc;
  const stepIndicator = $('#onboarding-step');
  if(stepIndicator) stepIndicator.textContent = `Paso ${tourStep + 1} de ${TOUR_STEPS.length}`;
  const wrap = $('#onboarding-input-wrap');
  const input = $('#onboarding-input');
  wrap.hidden = !step.input;
  if (step.input) {
    $('#onboarding-input-label').textContent = step.label;
    input.placeholder = step.placeholder;
    input.value = onboardingDraft[step.key] || '';
    setTimeout(() => input.focus(), 50);
  }
  const nextBtn = $('#onboarding-next');
  nextBtn.textContent = tourStep === TOUR_STEPS.length - 1 ? 'Crear mi primer día' : 'Continuar';
}

async function handleTourNext() {
  const step = TOUR_STEPS[tourStep];
  if (step.input) {
    const value = $('#onboarding-input').value.trim();
    if (!value && !step.optional) { showToast('Escribe una respuesta para continuar'); return; }
    onboardingDraft[step.key] = value;
  }
  if (tourStep < TOUR_STEPS.length - 1) {
    tourStep++;
    showTourStep();
  } else {
    let goalId = '';
    if (onboardingDraft.goal) {
      goalId = gid();
      state.smartGoals.push({ id: goalId, goal: onboardingDraft.goal, measurable: '', achievable: true, relevance: 'Prioridad inicial', duration: 90, progress: 0, nextStep: onboardingDraft.action, big5Index: null, lifeArea: '', status: 'active', progressHistory: [{ date: todayStr(), progress: 0 }], createdAt: new Date().toISOString(), startDate: todayStr(), completed: false });
    }
    if (onboardingDraft.action) {
      const today = todayStr();
      if (!state.dailyTasks[today]) state.dailyTasks[today] = [];
      state.dailyTasks[today].push({ id: gid(), text: onboardingDraft.action, priority: 'high', completed: false, goalId });
    }
    if (onboardingDraft.habit && goalId) state.rituals.push({ id: gid(), name: onboardingDraft.habit, goalId, lifeArea: '', createdAt: new Date().toISOString(), days: { lun:true, mar:true, mie:true, jue:true, vie:true, sab:true, dom:true }, completions: {} });
    state.onboarding = { status: 'completed', completedAt: new Date().toISOString(), step: TOUR_STEPS.length };
    state.hasSeenOnboarding = true;
    await saveState(true);
    await flushCloudSave();
    renderAll();
    closeTour(false);
    switchTab('hoy');
  }
}

function closeTour(skipped = true) {
  const overlay = $('#onboarding-overlay');
  if (overlay) overlay.style.display = 'none';
  if (skipped && !tourWasRestarted) {
    state.onboarding = { status: 'skipped', completedAt: new Date().toISOString(), step: tourStep };
    state.hasSeenOnboarding = true;
    saveState(true);
    flushCloudSave(true).catch(() => {});
  }
  showToast(skipped ? 'Puedes volver a la introducción desde Perfil' : 'Tu primer día está listo');
}

// ─── INIT ───
function initCookieBanner() {
  if (!localStorage.getItem('rokaCookiesAccepted')) {
    const banner = $('#cookie-banner');
    if (banner) {
      banner.style.display = 'flex';
      const close = value => {
        localStorage.setItem('rokaCookiesAccepted', value);
        banner.style.display = 'none';
        showToast('Preferencias guardadas');
      };
      $('#cookie-accept-btn')?.addEventListener('click', () => close('accepted'));
      $('#cookie-essential-btn')?.addEventListener('click', () => close('essential'));
    }
  }
}

function initCollapsibleSections() {
  $$('.collapsible-header').forEach(header => {
    header.addEventListener('click', () => header.parentElement?.classList.toggle('collapsed'));
  });
}

function safeInit(fn, name) {
  try { fn(); }
  catch(e) { console.error('Error en ' + name + ':', e); }
}

function initThemeToggle() {
  const stored = localStorage.getItem(THEME_PRESET_KEY) || 'zen-garden';
  applyThemePreset(stored);
  const systemTheme = window.matchMedia?.('(prefers-color-scheme: light)');
  systemTheme?.addEventListener?.('change', () => {
    if ((localStorage.getItem(THEME_PRESET_KEY) || 'zen-garden') === 'auto') applyThemePreset('auto');
  });
}

function initApp() {
  safeInit(initThemeToggle, 'initThemeToggle');
  safeInit(updateHeaderDate, 'updateHeaderDate');
  safeInit(initTabs, 'initTabs');
  safeInit(initCollapsibleSections, 'initCollapsibleSections');
  safeInit(initTimer, 'initTimer');
  safeInit(initReframer, 'initReframer');
  safeInit(initPride, 'initPride');
  safeInit(initGratitude, 'initGratitude');
  safeInit(initPlanner, 'initPlanner');
  safeInit(initRituals, 'initRituals');
  safeInit(initWeeklyReflection, 'initWeeklyReflection');
  safeInit(initWeeklyWizard, 'initWeeklyWizard');
  safeInit(initSmartGoals, 'initSmartGoals');
  safeInit(initLearning, 'initLearning');
  safeInit(initStopDoing, 'initStopDoing');
  safeInit(initQuarterly, 'initQuarterly');
  safeInit(initAnnual, 'initAnnual');
  safeInit(initGiants, 'initGiants');
  safeInit(initMantraSlide, 'initMantraSlide');
  safeInit(initCalendar, 'initCalendar');
  safeInit(initPersonalMap, 'initPersonalMap');
  safeInit(initProfile, 'initProfile');
  safeInit(initCoach, 'initCoach');
  safeInit(renderAll, 'renderAll');
  safeInit(() => switchTab(routeFromHash(), { replace: !location.hash, updateHash: !location.hash }), 'switchTab');

  // Eventos de onboarding
  const nextBtn = $('#onboarding-next');
  const skipBtn = $('#onboarding-skip');
  if(nextBtn) nextBtn.addEventListener('click', handleTourNext);
  if(skipBtn) skipBtn.addEventListener('click', closeTour);
}

document.addEventListener('DOMContentLoaded', () => {
  initAuth();
  initCookieBanner();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushCloudSave(true).catch(() => {});
  });
  window.addEventListener('pagehide', () => {
    flushCloudSave(true).catch(() => {});
  });
  
  // Register Service Worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').then(registration => {
      registration.update().catch(() => {});
      if (registration.waiting) registration.waiting.postMessage({ type: 'SKIP_WAITING' });
    }).catch(err => {
      console.log('SW registration failed: ', err);
    });
    if ('caches' in window) {
      caches.keys()
        .then(keys => Promise.all(keys
          .filter(key => key.startsWith('roka-mind-') && !key.includes('v40-button-fix'))
          .map(key => caches.delete(key))))
        .catch(() => {});
    }
  }
});
