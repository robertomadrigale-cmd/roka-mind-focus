import { initializeApp } from "https://www.gstatic.com/firebasejs/12.14.0/firebase-app.js";
import { getAuth, GoogleAuthProvider, browserLocalPersistence, getRedirectResult, setPersistence, signInWithPopup, signInWithRedirect, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.14.0/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, deleteDoc, collection, getDocs, query, orderBy, limit } from "https://www.gstatic.com/firebasejs/12.14.0/firebase-firestore.js";
import { Timer } from "./components/Timer.js";
import { LifeWheel, LIFE_WHEEL_AXES } from "./components/LifeWheel.js";
import { callAIGateway } from "./services/aiGateway.js?v=10.7";
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
  stateVersion: 3,
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
  learning: { book:'', course:'', conference:'', mastermind:'' },
  visionText: '',
  sectionDates: { weekly:'', learning:'', stopDoing:'', quarterly:'', annual:'' },
  dailyTasks: {},
  stopDoingList: ['','','','','','','','','',''],
  activityLog: {},
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
const THEME_PRESET_KEY = 'rokaMindThemePreset';
const THEME_PRESETS = [
  { code: 'zen-garden', name: 'Zen Garden', description: 'Niebla, piedra y calma profunda', swatches: ['#07120e', '#163226', '#8fcfba', '#d8c08a'] },
  { code: 'executive-blue', name: 'Azul ejecutivo', description: 'Actual y seguro', swatches: ['#07111E', '#122238', '#68B7FF'] },
  { code: 'graphite', name: 'Graphite', description: 'Premium oscuro', swatches: ['#080A0D', '#171C24', '#78B7FF'] },
  { code: 'emerald', name: 'Emerald', description: 'Comercial fresco', swatches: ['#06140F', '#112B22', '#58D99A'] },
  { code: 'wine', name: 'Wine', description: 'Ejecutivo calido', swatches: ['#170A12', '#321826', '#F08CAA'] },
  { code: 'opera-gx', name: 'Opera GX', description: 'Neon gamer magenta', swatches: ['#0D0A14', '#1A1322', '#FF1B57'] },
  { code: 'moleskine', name: 'Moleskine', description: 'Negro, papel y elastico', swatches: ['#0B0B0A', '#1C1914', '#B63A31', '#D6C08C'] },
  { code: 'paper', name: 'Paper', description: 'Claro y descansado', swatches: ['#EFE8DA', '#FFF9EF', '#8E6A3C'] }
];
const THEME_CLASS_NAMES = THEME_PRESETS.map(preset => `theme-${preset.code}`);

const STORAGE_KEY = 'rokaMindState';
let state = JSON.parse(JSON.stringify(DEFAULT_STATE));
let appInitialized = false;
let calDate = new Date();
let coachThreads = [];
let activeCoachThreadId = '';
let activeCoachMessages = [];
let reportCache = [];

function deepMerge(t, s) {
  const r = { ...t };
  for (const k in s) {
    if (s[k] && typeof s[k]==='object' && !Array.isArray(s[k])) r[k] = deepMerge(t[k]||{}, s[k]);
    else if (s[k] !== undefined) r[k] = s[k];
  }
  return r;
}

function normalizeState() {
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
  if (state.hasSeenOnboarding && state.onboarding.status === 'not_started') state.onboarding.status = 'completed';
  state.smartGoals = state.smartGoals.map(goal => ({
    progress: 0,
    nextStep: '',
    ...goal,
    progress: Math.min(100, Math.max(0, Number(goal.progress || 0)))
  }));
  state.stateVersion = DEFAULT_STATE.stateVersion;
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

function getStateTime(data) {
  const value = data && (data.updatedAt || data.lastSavedAt || data.savedAt);
  const time = value ? Date.parse(value) : 0;
  return Number.isFinite(time) ? time : 0;
}

function hasMeaningfulUserData(data) {
  if (!data || typeof data !== 'object') return false;
  const today = todayStr();
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
    (data.activityLog && data.activityLog[today])
  );
}

function choosePersistedState(localData, remoteData) {
  const localHasData = hasMeaningfulUserData(localData);
  const remoteHasData = hasMeaningfulUserData(remoteData);
  if (!remoteHasData && localHasData) return localData;
  if (!localHasData && remoteHasData) return remoteData;

  const localTime = getStateTime(localData);
  const remoteTime = getStateTime(remoteData);
  if (localTime || remoteTime) return localTime > remoteTime ? localData : remoteData;

  return localHasData ? localData : remoteData;
}

const FETCH_TIMEOUT_MS = 12000;
function withTimeout(promise) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Firebase timeout')), FETCH_TIMEOUT_MS))
  ]);
}

function getCloudSafeState() {
  const cloudState = JSON.parse(JSON.stringify(state));
  cloudState.pendingCloudSync = false;
  delete cloudState.lastCloudSyncError;
  if (cloudState.aiConfig) {
    delete cloudState.aiConfig.apiKey;
    delete cloudState.aiConfig.provider;
    delete cloudState.aiConfig.model;
  }
  return cloudState;
}

async function loadState() {
  const localData = parseStoredState(localStorage.getItem(STORAGE_KEY));
  let shouldSyncLocalToCloud = false;
  try {
    if (currentUser) {
      const docRef = doc(db, "users", currentUser.uid);
      const docSnap = await withTimeout(getDoc(docRef));
      if (docSnap.exists()) {
        const remoteData = docSnap.data();
        const chosen = choosePersistedState(localData, remoteData);
        shouldSyncLocalToCloud = chosen === localData && hasMeaningfulUserData(localData);
        state = deepMerge(DEFAULT_STATE, chosen);
      } else {
        state = deepMerge(DEFAULT_STATE, localData);
        shouldSyncLocalToCloud = hasMeaningfulUserData(localData);
      }
    } else {
      state = deepMerge(DEFAULT_STATE, localData);
    }
  } catch(e) { 
    console.warn('No se pudo cargar Firebase; usando datos locales.', e);
    state = deepMerge(DEFAULT_STATE, localData);
  }
  normalizeState();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  if (currentUser && shouldSyncLocalToCloud) {
    await saveState(true);
  }
  
  if (currentUser && state.onboarding.status === 'not_started' && !hasMeaningfulUserData(state)) {
    setTimeout(() => startOnboardingTour(), 700);
  }
}

function loadLocalState() {
  const localData = parseStoredState(localStorage.getItem(STORAGE_KEY));
  state = deepMerge(DEFAULT_STATE, localData);
  normalizeState();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function applyFirstRunDefaultsIfNeeded() {
  if (!currentUser || state.onboarding.status !== 'not_started' || hasMeaningfulUserData(state)) return false;
  setTimeout(() => startOnboardingTour(), 700);
  return true;
}

async function reconcileCloudStateInBackground() {
  if (!currentUser) return;
  updateAccountSyncStatus('saving');
  const beforeUpdatedAt = state.updatedAt;
  const localData = parseStoredState(localStorage.getItem(STORAGE_KEY));
  let shouldSyncLocalToCloud = false;
  try {
    const docRef = doc(db, "users", currentUser.uid);
    const docSnap = await withTimeout(getDoc(docRef));
    if (docSnap.exists()) {
      const remoteData = docSnap.data();
      const chosen = choosePersistedState(localData, remoteData);
      shouldSyncLocalToCloud = chosen === localData && hasMeaningfulUserData(localData);
      state = deepMerge(DEFAULT_STATE, chosen);
    } else {
      state = deepMerge(DEFAULT_STATE, localData);
      shouldSyncLocalToCloud = hasMeaningfulUserData(localData);
    }
    normalizeState();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    if (shouldSyncLocalToCloud) await saveState(true);
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
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  if (currentUser) updateAccountSyncStatus('saving');

  if (!currentUser) {
    state.pendingCloudSync = false;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    if (!quiet) showSaveStatus('saved', 'Guardado en este dispositivo');
    return;
  }

  try {
    await withTimeout(setDoc(doc(db, "users", currentUser.uid), getCloudSafeState()));
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
    const nextState = deepMerge(DEFAULT_STATE, localData);
    nextState.pendingCloudSync = false;
    delete nextState.lastCloudSyncError;
    await withTimeout(setDoc(doc(db, "users", currentUser.uid), nextState));
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
function todayStr() { return new Date().toISOString().split('T')[0]; }
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

function updateAccountSyncStatus(status = 'idle') {
  const el = $('#account-sync-status');
  if (!el) return;
  if (!currentUser) {
    el.textContent = 'Sin sesión';
    el.dataset.status = 'offline';
    return;
  }
  const email = currentUser.email || 'Cuenta Google';
  const labels = {
    synced: 'Nube sincronizada',
    pending: 'Nube pendiente',
    saving: 'Sincronizando...',
    idle: 'Cuenta conectada'
  };
  el.textContent = `${email} · ${labels[status] || labels.idle}`;
  el.dataset.status = status;
}

function isMobileAuthFlow() {
  return false;
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

function initSelectionGuard() {
  document.addEventListener('selectionchange', () => {
    const selection = window.getSelection && window.getSelection();
    if (!selection || selection.isCollapsed || isEditableSelectionTarget(selection.anchorNode)) return;
    window.setTimeout(() => {
      const current = window.getSelection && window.getSelection();
      if (current && !current.isCollapsed && !isEditableSelectionTarget(current.anchorNode)) current.removeAllRanges();
    }, 0);
  });
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
      $('#auth-overlay').style.display = 'none';
      $('#app').style.display = 'grid';
      const avatar = $('#profile-avatar-btn');
      if (avatar) avatar.textContent = (user.displayName || user.email || 'R').trim().charAt(0).toUpperCase();
      updateAccountSyncStatus('saving');
      
      if(!$('#account-sync-status')) {
        const sync = document.createElement('div');
        sync.id = 'account-sync-status';
        sync.className = 'account-sync-status';
        sync.textContent = 'Cuenta conectada';
        $('.header-right').prepend(sync);
      }

      if(!$('#logout-btn')) {
        const btn = document.createElement('button');
        btn.id = 'logout-btn';
        btn.className = 'zen-btn zen-btn-ghost';
        btn.style.padding = '6px 12px';
        btn.textContent = 'Cerrar Sesión';
        btn.addEventListener('click', () => signOut(auth));
        $('.header-right').appendChild(btn);
      }

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
      currentUser = null;
      $('#auth-overlay').style.display = 'flex';
      $('#app').style.display = 'none';
      if($('#logout-btn')) $('#logout-btn').remove();
      if($('#account-sync-status')) $('#account-sync-status').remove();
    }
  });

  $('#google-login-btn').addEventListener('click', async () => {
    $('#auth-loading').style.display = 'block';
    $('#auth-loading').textContent = 'Conectando...';
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    try {
      await setPersistence(auth, browserLocalPersistence);
      if (isMobileAuthFlow()) {
        $('#auth-loading').textContent = 'Abriendo Google...';
        await signInWithRedirect(auth, provider);
        return;
      }
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
  if ($('#tab-profile') && $('#tab-profile').classList.contains('active')) renderProfile();
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
  coach: { section: 'coach', label: 'Coach' },
  mente: { section: 'mindset', label: 'Mente' },
  metas: { section: 'strategy', label: 'Metas' },
  progreso: { section: 'reflection', label: 'Progreso' },
  perfil: { section: 'identity', label: 'Perfil' }
};
const ROUTE_ALIASES = { today: 'hoy', daily: 'hoy', ai: 'coach', mindset: 'mente', strategy: 'metas', reflection: 'progreso', identity: 'perfil', profile: 'perfil' };
const ROUTE_ORDER = ['hoy', 'coach', 'mente', 'metas', 'progreso', 'perfil'];
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
    const map = { activas: 'strat-monthly', trimestre: 'strat-quarterly', vision: 'strat-vision' };
    document.querySelector(`.strat-sub-tab[data-target="${map[subroute] || map.activas}"]`)?.click();
  }
  if (route === 'progreso' && subroute) {
    const map = { resumen: 'reflection-progress', semana: 'reflection-weekly', calendario: 'reflection-calendar' };
    document.querySelector(`.reflection-sub-tab[data-target="${map[subroute] || map.resumen}"]`)?.click();
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

  $$('.strat-sub-tab').forEach(b => {
    b.addEventListener('click', () => {
      $$('.strat-sub-tab').forEach(x => { x.classList.remove('active'); x.style.color = 'var(--text-secondary)'; x.style.fontWeight = 'normal'; });
      $$('.strat-content').forEach(c => { c.classList.remove('active'); c.style.display = 'none'; });
      b.classList.add('active');
      b.style.color = 'var(--accent-gold)';
      b.style.fontWeight = 'bold';
      const target = b.dataset.target;
      const tc = $(`#${target}`);
      if (tc) {
        tc.classList.add('active');
        tc.style.display = 'block';
      }
      setRouteHash('metas', b.dataset.subroute || (target === 'strat-quarterly' ? 'trimestre' : target === 'strat-vision' ? 'vision' : 'activas'));
    });
  });

  $$('.reflection-sub-tab').forEach(b => {
    b.addEventListener('click', () => {
      $$('.reflection-sub-tab').forEach(x => { x.classList.remove('active'); x.style.color = 'var(--text-secondary)'; x.style.fontWeight = 'normal'; });
      $$('.reflection-sub-content').forEach(c => { c.classList.remove('active'); c.style.display = 'none'; });
      b.classList.add('active');
      b.style.color = 'var(--accent-gold)';
      b.style.fontWeight = 'bold';
      const target = b.dataset.target;
      const tc = $(`#${target}`);
      if (tc) {
        tc.classList.add('active');
        tc.style.display = 'block';
      }
      const subroute = target === 'reflection-weekly' ? 'semana' : target === 'reflection-calendar' ? 'calendario' : 'resumen';
      setRouteHash('progreso', subroute);
    });
  });
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
  if (options.updateHash !== false) setRouteHash(route, '', options.replace === true);
  else activateHashSubroute(route);
  window.scrollTo({ top: 0 });
  if (options.focus) {
    const heading = section?.querySelector('h1');
    if (heading) { heading.setAttribute('tabindex', '-1'); heading.focus({ preventScroll: true }); }
  }
}

function moveRoute(direction) {
  const currentIndex = ROUTE_ORDER.indexOf(activeRoute);
  const nextIndex = Math.min(ROUTE_ORDER.length - 1, Math.max(0, currentIndex + direction));
  switchTab(ROUTE_ORDER[nextIndex]);
}

function renderRoutePager() {
  // Navigation is now handled by the sidebar/bottom nav
}

function updateHeaderDate() {
  const now=new Date(), opts={weekday:'long',year:'numeric',month:'long',day:'numeric'};
  const s=now.toLocaleDateString('es-MX',opts);
  $('#header-date').textContent=s.charAt(0).toUpperCase()+s.slice(1);
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
    const key=d.toISOString().split('T')[0];
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
      logActivity(todayStr());
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
  if(!state.mantras.length){c.innerHTML='<div class="empty-state" style="grid-column:1/-1;"><div class="empty-state-icon">静</div><div class="empty-state-text">Reconfigura una creencia para crear tu primer mantra.</div></div>';return;}
  c.innerHTML=state.mantras.map(m=>`<div class="mantra-card" data-id="${m.id}"><div class="mantra-text">"${esc(m.text)}"</div><div class="mantra-date">${fmtDate(m.date)}</div><button class="btn-delete mantra-delete" data-id="${m.id}">✕</button></div>`).join('');
  c.querySelectorAll('.mantra-delete').forEach(b=>b.addEventListener('click',e=>{e.stopPropagation();state.mantras=state.mantras.filter(m=>m.id!==b.dataset.id);saveState();renderMantras();}));
}

function renderBeliefsLibrary() {
  const c = $('#beliefs-library');
  const count = $('#beliefs-count');
  if (!c) return;
  const beliefs = state.beliefs || [];
  if (count) count.textContent = `${beliefs.length} ${beliefs.length === 1 ? 'registro' : 'registros'}`;
  if (!beliefs.length) {
    c.innerHTML = '<div class="empty-state"><div class="empty-state-icon">静</div><div class="empty-state-text">Aún no has guardado creencias. Escribe una arriba para crear tu primer registro.</div></div>';
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
    if ($('#tab-progress') && $('#tab-progress').classList.contains('active')) renderProgress();
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
  if(!tasks.length){c.innerHTML='<div class="empty-state" style="padding:20px;"><div class="empty-state-text" style="font-size:0.8rem;">Agrega tareas para planificar tu día</div></div>';updatePlannerProgress([]);return;}
  const prOrder={high:0,medium:1,low:2};
  const sorted=[...tasks].sort((a,b)=>(a.completed?1:0)-(b.completed?1:0)||(prOrder[a.priority]||1)-(prOrder[b.priority]||1));
  c.innerHTML=sorted.map(t=>{
    const prLabels={high:'Alta',medium:'Media',low:'Baja'};
    return `<div class="planner-task ${t.completed?'completed':''}"><button class="task-check ${t.completed?'done':''}" data-tid="${t.id}"></button><span class="task-text">${esc(t.text)}</span><span class="task-priority-tag ${t.priority}">${prLabels[t.priority]}</span><button class="btn-delete" data-del-task="${t.id}" style="opacity:0.5;">✕</button></div>`;
  }).join('');
  c.querySelectorAll('.task-check').forEach(b=>b.addEventListener('click',()=>{const tk=tasks.find(t=>t.id===b.dataset.tid);if(tk){tk.completed=!tk.completed;saveState();renderPlanner();}}));
  c.querySelectorAll('[data-del-task]').forEach(b=>b.addEventListener('click',()=>{state.dailyTasks[today]=tasks.filter(t=>t.id!==b.dataset.delTask);saveState();renderPlanner();}));
  updatePlannerProgress(tasks);
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
  if(!state.rituals.length){c.innerHTML='<div class="empty-state" style="padding:20px;"><div class="empty-state-text" style="font-size:0.8rem;">Agrega rituales en "Semanal"</div></div>';return;}
  const date = todayStr();
  const scheduled = state.rituals.filter(r => isRitualScheduled(r, date));
  const list = scheduled.length ? scheduled : state.rituals;
  c.innerHTML=(scheduled.length?'':'<div class="calendar-save-hint">No hay rituales programados para hoy; mostrando todos.</div>') + list.map(r=>{const done=isRitualCompleted(r,date); return `<div style="display:flex;align-items:center;gap:12px;padding:8px 0;border-bottom:1px solid var(--border-subtle);"><button class="ritual-check ${done?'completed':''}" data-rid="${r.id}"></button><span style="font-size:0.85rem;${done?'text-decoration:line-through;color:var(--text-muted);':''}">${esc(r.name)}</span></div>`;}).join('');
  c.querySelectorAll('.ritual-check').forEach(b=>b.addEventListener('click',()=>{const r=state.rituals.find(x=>x.id===b.dataset.rid);if(r){setRitualCompleted(r,date,!isRitualCompleted(r,date));saveState();renderDailyRitualsQuick();renderRituals();if($('#tab-calendar')&&$('#tab-calendar').classList.contains('active'))renderCalendar();calcStreak();}}));
}

// ─── RITUALS (Weekly) ───
function initRituals() { $('#add-ritual-btn').addEventListener('click',addRitual); $('#ritual-input').addEventListener('keydown',e=>{if(e.key==='Enter')addRitual();}); }
function addRitual() { const i=$('#ritual-input'),n=i.value.trim(); if(!n)return; if(state.rituals.length>=10){showToast('Máximo 10 rituales');return;} state.rituals.push({id:gid(),name:n,days:{lun:false,mar:false,mie:false,jue:false,vie:false,sab:false,dom:false}}); saveState();i.value='';renderRituals();renderDailyRitualsQuick();showToast('Ritual agregado'); }
function renderRituals() {
  const c=$('#rituals-container'); if(!c)return;
  if(!state.rituals.length){c.innerHTML='<div class="empty-state"><div class="empty-state-icon">巡</div><div class="empty-state-text">Agrega tu primer ritual</div></div>';return;}
  const dl=['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'], dk=['lun','mar','mie','jue','vie','sab','dom'];
  let h=`<table class="rituals-grid"><thead><tr><th style="text-align:left;padding-left:12px;">Ritual</th>${dl.map(d=>`<th>${d}</th>`).join('')}<th></th></tr></thead><tbody>`;
  state.rituals.forEach(r=>{h+=`<tr><td class="ritual-name">${esc(r.name)}</td>${dk.map(d=>{const scheduled=r.days&&r.days[d]===true;return`<td><button class="ritual-check ${scheduled?'completed':''}" title="Programar este ritual" data-rid="${r.id}" data-day="${d}"></button></td>`;}).join('')}<td><button class="btn-delete" data-del-rit="${r.id}" style="opacity:0.5;">✕</button></td></tr>`;});
  h+='</tbody></table>'; c.innerHTML=h;
  c.querySelectorAll('.ritual-check').forEach(b=>b.addEventListener('click',()=>{const r=state.rituals.find(x=>x.id===b.dataset.rid);if(r){if(!r.days)r.days={};r.days[b.dataset.day]=r.days[b.dataset.day]===true?false:true;saveState();renderRituals();renderDailyRitualsQuick();if($('#tab-calendar')&&$('#tab-calendar').classList.contains('active'))renderCalendar();showToast('Rutina semanal guardada');}}));
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
        let feedbackBox = $('#ai-weekly-feedback');
        if(!feedbackBox) {
          feedbackBox = document.createElement('div');
          feedbackBox.id = 'ai-weekly-feedback';
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

function saveWeeklyReflection() {
  const w=$('#weekly-well'),a=$('#weekly-adjust');
  if(w) state.weeklyReflection.well=w.value;
  if(a) state.weeklyReflection.adjust=a.value;
  state.sectionDates.weekly = todayStr();
  saveState();
  logActivity(todayStr());
  showToast('Revisión semanal guardada');
  if($('#tab-calendar')&&$('#tab-calendar').classList.contains('active'))renderCalendar();
}

function renderWeeklyReflection() {
  const w=$('#weekly-well'),a=$('#weekly-adjust');
  if(w && document.activeElement !== w) w.value=state.weeklyReflection.well||'';
  if(a && document.activeElement !== a) a.value=state.weeklyReflection.adjust||'';
}

function renderLifeWheel() {
  if (!lifeWheelComponent) lifeWheelComponent = new LifeWheel({ $, state, saveState });
  lifeWheelComponent.render();
}

// ─── SMART GOALS ───
let smartAch=false;
function initSmartGoals() {
  $('#add-smart-btn').addEventListener('click',()=>{$('#smart-form').style.display='block';$('#add-smart-btn').style.display='none';});
  $('#cancel-smart-btn').addEventListener('click',()=>{$('#smart-form').style.display='none';$('#add-smart-btn').style.display='';clearSmart();});
  $('#smart-achievable').addEventListener('click',()=>{smartAch=!smartAch;$('#smart-achievable').classList.toggle('on',smartAch);});
  $('#smart-duration').addEventListener('input',()=>{$('#smart-duration-label').textContent=$('#smart-duration').value;});
  $('#smart-progress').addEventListener('input',()=>{$('#smart-progress-label').textContent=$('#smart-progress').value;});
  $('#save-smart-btn').addEventListener('click',saveSmart);
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
    startDate:todayStr(),
    completed:+$('#smart-progress').value>=100
  });
  saveState();clearSmart();$('#smart-form').style.display='none';$('#add-smart-btn').style.display='';renderSmartGoals();showToast('Objetivo SMART guardado');
}
function renderSmartGoals(){
  const c=$('#smart-goals-container');if(!c)return;
  if(!state.smartGoals.length){c.innerHTML='<div class="empty-state"><div class="empty-state-icon">的</div><div class="empty-state-text">Crea tu primer objetivo SMART</div></div>';return;}
  c.innerHTML=state.smartGoals.map(g=>{const st=new Date(g.startDate),now=new Date(),el=Math.floor((now-st)/864e5),pr=Math.min(100,Math.round(el/g.duration*100)),dl=Math.max(0,g.duration-el);
    const real=Math.min(100,Math.max(0,Number(g.progress||0)));
    return`<div class="smart-card" style="margin-top:16px;"><div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;"><div><div style="font-family:'Playfair Display',serif;font-size:1.1rem;font-weight:600;margin-bottom:8px;">${esc(g.goal)}</div><div style="display:flex;gap:16px;flex-wrap:wrap;margin-top:12px;"><div class="smart-field"><span class="smart-label">Medible</span><div style="font-size:0.9rem;">${esc(g.measurable||'—')}</div></div><div class="smart-field"><span class="smart-label">Relevancia</span><div style="font-size:0.9rem;">${esc(g.relevance||'—')}</div></div><div class="smart-field"><span class="smart-label">Alcanzable</span><div style="font-size:0.9rem;">${g.achievable?'Si':'No definido'}</div></div><div class="smart-field"><span class="smart-label">Plazo</span><div style="font-size:0.9rem;">${g.duration} dias (quedan ${dl})</div></div></div></div><button class="btn-delete" data-del-sm="${g.id}" style="opacity:0.6;">✕</button></div><div class="smart-progress-panel"><div class="smart-progress-row"><span class="smart-label">Avance real</span><strong>${real}%</strong></div><input type="range" class="timeline-slider smart-progress-input" min="0" max="100" value="${real}" data-progress-sm="${g.id}"><div class="smart-progress-track"><div style="width:${real}%"></div></div><label class="smart-label" style="margin-top:12px;">Siguiente avance visible</label><input class="zen-input smart-next-step-input" value="${esc(g.nextStep||'')}" data-next-sm="${g.id}" placeholder="Define el siguiente paso medible..."><div class="smart-time-progress"><span>Progreso temporal</span><span>${pr}%</span></div></div></div>`;}).join('');
  c.querySelectorAll('[data-del-sm]').forEach(b=>b.addEventListener('click',()=>{state.smartGoals=state.smartGoals.filter(g=>g.id!==b.dataset.delSm);saveState();renderSmartGoals();}));
  c.querySelectorAll('[data-progress-sm]').forEach(inp=>inp.addEventListener('input',()=>{const g=state.smartGoals.find(x=>x.id===inp.dataset.progressSm);if(g){g.progress=+inp.value;g.completed=g.progress>=100;saveState();renderSmartGoals();if($('#tab-progress')&&$('#tab-progress').classList.contains('active'))renderProgress();}}));
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
function renderGiants(){const c=$('#giants-container');if(!c)return;if(!state.circleOfGiants.length){c.innerHTML='<div class="empty-state"><div class="empty-state-icon">縁</div><div class="empty-state-text">Agrega a las 5 personas que más impulsan tu crecimiento</div></div>';return;}c.innerHTML=state.circleOfGiants.map(g=>{const i=g.name.charAt(0).toUpperCase(),sc=g.status==='connected'?'connected':'to-reach',st=g.status==='connected'?'Conectado':'Por Contactar';return`<div class="giant-card"><div class="giant-avatar">${i}</div><div class="giant-info"><span class="giant-name">${esc(g.name)}</span><span class="giant-role">${esc(g.role||'Sin rol')}</span>${g.action?`<span style="font-size:0.7rem;color:var(--accent-orange);margin-top:2px;">→ ${esc(g.action)}</span>`:''}</div><div style="display:flex;align-items:center;gap:8px;"><span class="giant-status ${sc}">${st}</span><button class="btn-delete" data-del-gi="${g.id}" style="opacity:0.5;">✕</button></div></div>`;}).join('');c.querySelectorAll('[data-del-gi]').forEach(b=>b.addEventListener('click',()=>{state.circleOfGiants=state.circleOfGiants.filter(g=>g.id!==b.dataset.delGi);saveState();renderGiants();}));}

// ─── QUARTERLY 10 ───
function initQuarterly(){if($('#save-quarterly-btn'))$('#save-quarterly-btn').addEventListener('click',saveQuarterly);}
function renderQuarterly10(){const c=$('#quarterly10-container');if(!c)return;c.innerHTML=state.quarterly10.map((item,i)=>`<div class="big5-item"><span class="big5-number" style="color:var(--accent-orange);">${i+1}</span><input class="zen-input" value="${esc(item)}" data-q10="${i}" placeholder="Prioridad ${i+1}..."></div>`).join('');c.querySelectorAll('[data-q10]').forEach(inp=>inp.addEventListener('blur',()=>{state.quarterly10[+inp.dataset.q10]=inp.value;saveState();}));}
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
function renderB5(cid,data,sk){const c=$(`#${cid}`);if(!c)return;const ph={big5:['Meta anual principal...','Segunda gran meta...','Tercer objetivo...','Cuarta prioridad...','Quinta meta...'],values:['Primer valor...','Segundo valor...','Tercer valor...','Cuarto valor...','Quinto valor...'],become:['¿En quién me convertiré?','Segunda identidad...','Tercer aspecto...','Cuarta cualidad...','Quinta transformación...']};c.innerHTML=data.map((item,i)=>`<div class="big5-item"><span class="big5-number">${i+1}</span><input class="zen-input" value="${esc(item)}" data-lk="${sk}" data-li="${i}" placeholder="${(ph[sk]&&ph[sk][i])||''}"></div>`).join('');c.querySelectorAll(`[data-lk="${sk}"]`).forEach(inp=>inp.addEventListener('blur',()=>{const idx=+inp.dataset.li;if(sk==='big5')state.annualBig5[idx]=inp.value;else if(sk==='values')state.values5[idx]=inp.value;else state.mustBecome5[idx]=inp.value;saveState();}));}
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
    ['Sesiones de enfoque', activity.focusCount ? [`${activity.focusCount} accion(es) registradas`] : []]
  ];
  const html = groups.filter(([,items]) => Array.isArray(items) ? items.length : items).map(([title,items]) => `
    <div class="cal-detail-group">
      <div class="cal-detail-heading">${title}</div>
      ${Array.isArray(items) ? items.map(item => `<div class="cal-detail-item">${esc(item)}</div>`).join('') : items}
    </div>
  `).join('');
  content.innerHTML = html || '<div class="empty-state" style="padding:20px;"><div class="empty-state-text">No hay actividades registradas este dia.</div></div>';
  panel.style.display = 'block';
  renderCalendar();
}

// ─── PROFILE & AI CONFIG ───
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

  const aiSettingsModal = $('#ai-settings-modal');
  const openAiBtn = $('#settings-toggle-btn');
  const closeAiBtn = $('#close-ai-settings-btn');
  
  if (openAiBtn && aiSettingsModal) {
    openAiBtn.addEventListener('click', () => {
      aiSettingsModal.style.display = 'flex';
      renderProfile(); // Pre-fill AI settings
    });
  }
  if (closeAiBtn && aiSettingsModal) {
    closeAiBtn.addEventListener('click', () => aiSettingsModal.style.display = 'none');
  }
  $('#open-ai-connection-profile-btn')?.addEventListener('click', () => $('#settings-toggle-btn')?.click());
  $('#restart-onboarding-btn')?.addEventListener('click', () => startOnboardingTour(true));
  $('#open-advanced-settings-btn')?.addEventListener('click', () => $('#settings-toggle-btn')?.click());
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
  if ($('#profile-archetype')) state.userProfile.archetype = $('#profile-archetype').value;
  state.userProfile.fears = $('#profile-fears').value;
  state.userProfile.values = $('#profile-values').value;
  if ($('#profile-learning')) state.userProfile.learning = $('#profile-learning').value;
  state.userProfile.lifeHistory = $('#profile-life-history').value;
  if ($('#profile-enneagram')) state.userProfile.enneagram = $('#profile-enneagram').value;
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
  const { keyEl } = getAIFormFields(source);
  const typedKey = keyEl?.value.trim() || '';
  if (typedKey) {
    storeAIKey(typedKey);
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
  if($('#profile-archetype')) $('#profile-archetype').value = p.archetype || '';
  if($('#profile-fears')) $('#profile-fears').value = p.fears || '';
  if($('#profile-values')) $('#profile-values').value = p.values || '';
  if($('#profile-learning')) $('#profile-learning').value = p.learning || '';
  if($('#profile-life-history')) $('#profile-life-history').value = p.lifeHistory || '';
  if($('#profile-enneagram')) $('#profile-enneagram').value = p.enneagram || '';
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
  updateAIConnectionStatus();
  if($('#ai-context-core')) $('#ai-context-core').checked = state.coachPreferences.useCoreContext !== false;
  if($('#ai-context-sensitive')) $('#ai-context-sensitive').checked = state.coachPreferences.useSensitiveContext === true;
  if($('#profile-context-core')) $('#profile-context-core').checked = state.coachPreferences.useCoreContext !== false;
  if($('#profile-context-sensitive')) $('#profile-context-sensitive').checked = state.coachPreferences.useSensitiveContext === true;
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
  let streak=0; { let d=new Date(); for(let i=0;i<365;i++){const k=d.toISOString().split('T')[0];const has=getDayActivity(k).total;if(has){streak++;d.setDate(d.getDate()-1);}else{if(i===0){d.setDate(d.getDate()-1);continue;}break;}} }
  const ritualRate=(()=>{if(!state.rituals.length)return 0;const dk=['dom','lun','mar','mie','jue','vie','sab'];let total=0,done=0;state.rituals.forEach(r=>{dk.forEach(d=>{total++;if(r.days&&r.days[d]===true)done++;});});return total>0?Math.round(done/total*100):0;})();

  const stats=[
    {icon:'◆',value:streak,label:'Racha de dias',color:'var(--accent-orange)'},
    {icon:'+',value:totalV,label:'Victorias',color:'var(--accent-green)'},
    {icon:'↻',value:totalB,label:'Creencias rotas',color:'var(--accent-orange)'},
    {icon:'I',value:totalM,label:'Mantras activos',color:'var(--accent-green)'},
    {icon:'•',value:totalP,label:'Orgullos',color:'var(--accent-gold)'},
    {icon:'M',value:totalG,label:'Metas SMART',color:'var(--accent-orange)'},
    {icon:'R',value:ritualRate+'%',label:'Rituales semana',color:'var(--accent-green)'},
    {icon:'G',value:state.circleOfGiants.length,label:'Gigantes',color:'var(--accent-gold)'}
  ];
  const statsGrid = $('#stats-grid');
  if(statsGrid) statsGrid.innerHTML=stats.map(s=>`<div class="stat-card"><div class="stat-icon">${s.icon}</div><div class="stat-value" style="color:${s.color};">${s.value}</div><div class="stat-label">${s.label}</div></div>`).join('');

  // Heatmap
  const hm=$('#heatmap'); if(hm){hm.innerHTML='';
  for(let i=29;i>=0;i--){const d=new Date();d.setDate(d.getDate()-i);const k=d.toISOString().split('T')[0];
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
    if ($('#tab-quarterly') && $('#tab-quarterly').classList.contains('active')) renderLifeWheel();
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
Siguiente accion detectada: ${status.nextAction}
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
1. Lectura del dia en 2 lineas.
2. Una accion esencial de 25 minutos.
3. Tres pasos de ejecucion.
4. Un riesgo a evitar.
5. Frase de cierre tipo mantra, sobria.`;
  try {
    showSaveStatus('ai');
    const response = await callAI(prompt, 'Eres un coach central de vida, productividad y enfoque. Tono ryokan: sobrio, claro, directo, sin motivacion generica.');
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
  const prompt = `Genera una revision semanal accionable a partir del sistema ROKA.

${getTodayRecommendationContext()}

Formato obligatorio:
1. Patron principal observado.
2. Lo que debe continuar.
3. Lo que debe detenerse.
4. Tres prioridades para la semana.
5. Siguiente paso SMART.`;
  try {
    showSaveStatus('ai');
    const response = await callAI(prompt, 'Eres un estratega semanal. Lee patrones, contradicciones y siguiente accion. Nada de relleno.');
    const report = { id: gid(), type: 'weekly-review', title: 'Revision Semanal IA', content: response, date: todayStr() };
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

function storeAIKey(key) {
  sessionStorage.setItem(AI_SESSION_KEY, key);
  localStorage.setItem(AI_SESSION_KEY, key);
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
    keyEl: $(`#${prefix}-api-key`)
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
  const { keyEl } = getAIFormFields(source);
  const key = keyEl?.value.trim() || '';
  if (!key) {
    showToast('Pega una API key para guardarla');
    return;
  }
  storeAIKey(key);
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
  const { keyEl } = getAIFormFields(source);
  const typedKey = keyEl?.value.trim() || '';
  const config = { ...getAIConnectionConfig(), clientApiKey: typedKey || getStoredAIKey() };
  try {
    showToast('Probando conexión IA...');
    const authToken = await currentUser.getIdToken();
    const result = await callAIGateway({
      mode: 'chat',
      authToken,
      messages: [{ role: 'user', content: 'Responde solamente: conexion ok' }],
      context: 'Prueba tecnica breve de conexion IA.',
      systemInstruction: 'Responde en español, con dos palabras como maximo.',
      ...config
    });
    if (typedKey) {
      storeAIKey(typedKey);
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

function applyThemePreset(presetCode = localStorage.getItem(THEME_PRESET_KEY) || 'zen-garden', persist = false) {
  const preset = THEME_PRESETS.some(item => item.code === presetCode) ? presetCode : 'zen-garden';
  document.body.classList.remove(...THEME_CLASS_NAMES);
  document.body.classList.add(`theme-${preset}`);
  if (preset === 'paper') {
    document.body.classList.add('light-theme');
    localStorage.setItem('rokaLightTheme', 'true');
    const btn = $('#theme-toggle-btn');
    if (btn) btn.textContent = '◑';
  } else if (persist) {
    document.body.classList.remove('light-theme');
    localStorage.setItem('rokaLightTheme', 'false');
    const btn = $('#theme-toggle-btn');
    if (btn) btn.textContent = '◐';
  }
  if (persist) localStorage.setItem(THEME_PRESET_KEY, preset);
  renderThemePresets();
}

function renderThemePresets() {
  const container = $('#theme-preset-grid');
  if (!container) return;
  const active = localStorage.getItem(THEME_PRESET_KEY) || 'zen-garden';
  container.innerHTML = THEME_PRESETS.map(preset => `
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
  const smart = (state.smartGoals || []).map(g => `- ${g.goal} (${g.progress || 0}%): ${g.nextStep || 'sin siguiente paso'}`).join('\n') || 'Sin metas SMART';
  const rituals = (state.rituals || []).map(r => `- ${r.name}`).join('\n') || 'Sin rituales';
  const quarterly = (state.quarterly10 || []).filter(Boolean).map((x,i)=>`${i+1}. ${x}`).join('\n') || 'Sin prioridades trimestrales';
  const annual = (state.annualBig5 || []).filter(Boolean).map((x,i)=>`${i+1}. ${x}`).join('\n') || 'Sin Big 5 anual';
  const stop = (state.stopDoingList || []).filter(Boolean).map(x=>`- ${x}`).join('\n') || 'Sin lista de dejar de hacer';
  return `Promedio rueda de vida: ${avgLife}/10
Metas SMART:
${smart}
Rituales:
${rituals}
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
    container.innerHTML = activeCoachMessages.map(message => `<div class="coach-message ${message.role}${message.failed ? ' failed' : ''}"><div class="coach-message-bubble">${esc(message.content)}${message.role === 'assistant' ? `<div class="coach-message-actions">${message.failed ? `<button data-message-action="retry" data-message-id="${message.id}">Reintentar</button>` : `<button data-message-action="task" data-message-id="${message.id}">Guardar como tarea</button><button data-message-action="goal" data-message-id="${message.id}">Convertir en meta</button>`}</div>` : ''}</div></div>`).join('');
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
  } else if (type === 'task') {
    if (!confirm('¿Guardar esta recomendación como tarea para hoy?')) return;
    const today = todayStr();
    if (!state.dailyTasks[today]) state.dailyTasks[today] = [];
    state.dailyTasks[today].push({ id: gid(), text: message.content.slice(0, 240), priority: 'high', completed: false });
    saveState(); renderPlanner(); showToast('Tarea añadida a Hoy');
  } else if (type === 'goal') {
    if (!confirm('¿Convertir esta recomendación en una meta activa?')) return;
    state.smartGoals.push({ id: gid(), goal: message.content.slice(0, 180), measurable: '', achievable: true, relevance: 'Creada desde el Coach', duration: 30, progress: 0, nextStep: '', startDate: todayStr(), completed: false });
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
    container.innerHTML = '<div class="empty-reports"><h3>Todavía no hay informes</h3><p>Genera un mapa personal o un diagnóstico para convertir tus datos en decisiones.</p></div>';
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
      renderAIReportsList();
    }
  }));
}


// ─── RENDER ALL ───
function renderAll() { 
  renderQuote(); renderPride(); renderGratitude(); 
  renderPlanner(); renderRituals(); renderDailyRitualsQuick(); renderWeeklyReflection(); 
  renderSmartGoals(); renderLearning(); renderStopDoing(); renderGiants(); renderQuarterly10(); renderAnnual(); renderPersonalMap(); renderProfile(); renderProgress(); renderBeliefsLibrary(); renderMantras(); updateXPDisplay(); checkBadges();
  renderJourneyStatus();
  updateClarityPanel();
  renderCalendar();
  if (typeof renderLifeWheel === 'function') renderLifeWheel();
  calcStreak();
}

// ─── ONBOARDING TOUR LOGIC ───
let tourStep = 0;
let tourWasRestarted = false;
const onboardingDraft = { goal: '', action: '' };
const TOUR_STEPS = [
  {
    title: "Convierte claridad en acción",
    desc: "ROKA conecta tus metas, tu día y tu progreso para mostrarte siempre el siguiente paso.",
    input: false
  },
  {
    title: "¿Qué quieres mover primero?",
    desc: "Escribe una prioridad real. No tiene que estar perfecta; después podrás convertirla en una meta SMART completa.",
    input: true,
    label: "Mi prioridad",
    placeholder: "Ejemplo: conseguir tres nuevos clientes este trimestre",
    key: 'goal'
  },
  {
    title: "Elige la primera acción",
    desc: "Define algo que puedas comenzar hoy. El Coach podrá ayudarte a ajustar el plan cuando lo necesites.",
    input: true,
    label: "Mi primera acción",
    placeholder: "Ejemplo: escribir y enviar la primera propuesta",
    key: 'action'
  }
];

window.startOnboardingTour = function(restarted = false) {
  tourWasRestarted = restarted;
  tourStep = 0;
  onboardingDraft.goal = '';
  onboardingDraft.action = '';
  showTourStep();
};

function showTourStep() {
  const overlay = $('#onboarding-overlay');
  if (!overlay) return;
  overlay.style.display = 'flex';
  
  const step = TOUR_STEPS[tourStep];
  $('#onboarding-title').textContent = step.title;
  $('#onboarding-desc').textContent = step.desc;
  const stepIndicator = $('#onboarding-step') || $('#onboarding-steps');
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
    if (!value) { showToast('Escribe una respuesta para continuar'); return; }
    onboardingDraft[step.key] = value;
  }
  if (tourStep < TOUR_STEPS.length - 1) {
    tourStep++;
    showTourStep();
  } else {
    if (onboardingDraft.goal) state.smartGoals.push({ id: gid(), goal: onboardingDraft.goal, measurable: '', achievable: true, relevance: 'Prioridad inicial', duration: 30, progress: 0, nextStep: onboardingDraft.action, startDate: todayStr(), completed: false });
    if (onboardingDraft.action) {
      const today = todayStr();
      if (!state.dailyTasks[today]) state.dailyTasks[today] = [];
      state.dailyTasks[today].push({ id: gid(), text: onboardingDraft.action, priority: 'high', completed: false });
    }
    state.onboarding = { status: 'completed', completedAt: new Date().toISOString(), step: TOUR_STEPS.length };
    state.hasSeenOnboarding = true;
    await saveState(true);
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
  }
  showToast(skipped ? 'Puedes volver a la introducción desde Perfil' : 'Tu primer día está listo');
}

// ─── INIT ───
function initCookieBanner() {
  if (!localStorage.getItem('rokaCookiesAccepted')) {
    const banner = $('#cookie-banner');
    if (banner) {
      banner.style.display = 'flex';
      $('#cookie-accept-btn').addEventListener('click', () => {
        localStorage.setItem('rokaCookiesAccepted', 'true');
        banner.style.display = 'none';
        showToast('Preferencias guardadas');
      });
    }
  }
}

function safeInit(fn, name) {
  try { fn(); }
  catch(e) { console.error('Error en ' + name + ':', e); }
}

function initThemeToggle() {
  const btn = $('#theme-toggle-btn');
  if(!btn) return;
  applyThemePreset(localStorage.getItem(THEME_PRESET_KEY) || 'zen-garden');
  const storedTheme = localStorage.getItem('rokaLightTheme');
  const systemTheme = window.matchMedia?.('(prefers-color-scheme: light)');
  const isLight = storedTheme === null ? Boolean(systemTheme?.matches) : storedTheme === 'true';
  if(isLight) { document.body.classList.add('light-theme'); btn.textContent = '◑'; }
  else { document.body.classList.remove('light-theme'); btn.textContent = '◐'; }

  systemTheme?.addEventListener?.('change', event => {
    if (localStorage.getItem('rokaLightTheme') !== null) return;
    document.body.classList.toggle('light-theme', event.matches);
    btn.textContent = event.matches ? '◑' : '◐';
  });
  
  btn.addEventListener('click', () => {
    document.body.classList.toggle('light-theme');
    const nowLight = document.body.classList.contains('light-theme');
    localStorage.setItem('rokaLightTheme', nowLight);
    btn.textContent = nowLight ? '◑' : '◐';
    showToast(nowLight ? 'Modo claro activado' : 'Modo oscuro activado');
    renderThemePresets();
  });
}

function initApp() {
  safeInit(initThemeToggle, 'initThemeToggle');
  safeInit(updateHeaderDate, 'updateHeaderDate');
  safeInit(initTabs, 'initTabs');
  safeInit(initTimer, 'initTimer');
  safeInit(initReframer, 'initReframer');
  safeInit(initPride, 'initPride');
  safeInit(initGratitude, 'initGratitude');
  safeInit(initPlanner, 'initPlanner');
  safeInit(initRituals, 'initRituals');
  safeInit(initWeeklyReflection, 'initWeeklyReflection');
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
  initSelectionGuard();
  initAuth();
  initCookieBanner();
  
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
          .filter(key => key.startsWith('roka-mind-') && !key.includes('v33-touch-selection-guard'))
          .map(key => caches.delete(key))))
        .catch(() => {});
    }
  }
});

// For testing purposes
window.test_initApp = initApp;
window.test_loadState = loadState;
window.test_state = state;
window.test_setCurrentUser = (u) => { currentUser = u; };
window.test_renderReports = renderAIReportsList;
window.test_navigate = switchTab;
