const CACHE_NAME = 'roka-mind-v48-hoy-order';
const APP_SHELL_CACHE = `${CACHE_NAME}-shell`;
const RUNTIME_CACHE = `${CACHE_NAME}-runtime`;
const AUDIO_CACHE = `${CACHE_NAME}-audio`;
const urlsToCache = [
  '/',
  '/index.html',
  '/css/main.css',
  '/js/app.js',
  '/js/lib/dates.js',
  '/js/lib/reminders.js',
  '/js/lib/persistence.js',
  '/js/lib/sync-model.js',
  '/js/lib/system.js',
  '/js/components/Timer.js',
  '/js/components/LifeWheel.js',
  '/js/services/aiGateway.js',
  '/js/services/markdown.js',
  '/js/services/syncService.js',
  '/manifest.json',
  '/assets/icon.svg',
  '/assets/zen-garden-bg.webp'
];
const AUDIO_EXTENSIONS = ['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac'];

// Al instalar, cachear archivos
self.addEventListener('install', event => {
  self.skipWaiting(); // Activar inmediatamente sin esperar
  event.waitUntil(
    caches.open(APP_SHELL_CACHE).then(cache => cache.addAll(urlsToCache))
  );
});

// Al activar, borrar cachés viejos
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => ![APP_SHELL_CACHE, RUNTIME_CACHE, AUDIO_CACHE].includes(k)).map(k => caches.delete(k)))
    ).then(() => self.clients.claim()) // Tomar control inmediato
  );
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

function isAudioRequest(request) {
  const url = new URL(request.url);
  return AUDIO_EXTENSIONS.some(ext => url.pathname.toLowerCase().endsWith(ext)) || request.destination === 'audio';
}

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response && response.ok) {
    const cache = await caches.open(cacheName);
    cache.put(request, response.clone());
  }
  return response;
}

async function networkFirst(request, cacheName) {
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch (e) {
    return caches.match(request);
  }
}

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);

  // Ignore Firebase, Firestore, and external APIs to prevent massive lag
  if (url.origin !== self.location.origin || url.pathname.startsWith('/__/')) {
    return;
  }

  if (isAudioRequest(event.request)) {
    event.respondWith(cacheFirst(event.request, AUDIO_CACHE));
    return;
  }

  const isShellAsset = urlsToCache.includes(url.pathname);
  event.respondWith(networkFirst(event.request, isShellAsset ? APP_SHELL_CACHE : RUNTIME_CACHE));
});

// ─── Recordatorios ───
// La app envía la configuración; el service worker la guarda en Cache Storage
// para poder usarla cuando el sistema lo despierta con periodicsync.
const REMINDERS_CACHE = 'roka-reminders-config';
const WEEK_DAY_INDEX = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

async function readReminderStore() {
  const cache = await caches.open(REMINDERS_CACHE);
  const res = await cache.match('/__roka-reminders');
  return res ? res.json() : { reminders: null, shown: {} };
}

async function writeReminderStore(store) {
  const cache = await caches.open(REMINDERS_CACHE);
  await cache.put('/__roka-reminders', new Response(JSON.stringify(store), { headers: { 'Content-Type': 'application/json' } }));
}

function reminderDateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function reminderMinutes(t) {
  const [h, m] = String(t || '00:00').split(':').map(Number);
  return h * 60 + m;
}

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'ROKA_REMINDERS') {
    event.waitUntil(readReminderStore().then(store => writeReminderStore({ ...store, reminders: event.data.reminders })));
  }
});

self.addEventListener('periodicsync', event => {
  if (event.tag !== 'roka-reminders') return;
  event.waitUntil((async () => {
    const store = await readReminderStore();
    const r = store.reminders;
    if (!r || !r.notifications) return;
    const now = new Date();
    const today = reminderDateKey(now);
    const minutes = now.getHours() * 60 + now.getMinutes();
    let due = null;
    if (now.getDay() === WEEK_DAY_INDEX[r.weeklyDay] && minutes >= reminderMinutes(r.weeklyTime) && store.shown.weekly !== today) {
      due = { kind: 'weekly', title: 'ROKA · Cierra tu semana', body: 'Tu revisión semanal toma 10 minutos.', route: '#/semana/revision' };
    } else if (minutes >= reminderMinutes(r.dailyTime) && store.shown.daily !== today) {
      due = { kind: 'daily', title: 'ROKA · Planea tu día', body: 'Elige el siguiente paso de tus metas.', route: '#/hoy' };
    }
    if (!due) return;
    await self.registration.showNotification(due.title, { body: due.body, tag: `roka-${due.kind}`, icon: '/assets/icon.svg', data: { route: due.route } });
    await writeReminderStore({ ...store, shown: { ...store.shown, [due.kind]: today } });
  })());
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const route = (event.notification.data && event.notification.data.route) || '#/hoy';
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find(client => new URL(client.url).origin === self.location.origin);
    if (existing) {
      await existing.focus();
      return existing.navigate(`/${route}`);
    }
    return self.clients.openWindow(`/${route}`);
  })());
});
