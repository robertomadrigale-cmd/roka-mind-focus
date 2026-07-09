const CACHE_NAME = 'roka-mind-v26-touch-nav-fix';
const APP_SHELL_CACHE = `${CACHE_NAME}-shell`;
const RUNTIME_CACHE = `${CACHE_NAME}-runtime`;
const AUDIO_CACHE = `${CACHE_NAME}-audio`;
const urlsToCache = [
  '/',
  '/index.html',
  '/css/main.css',
  '/js/app.js',
  '/js/components/Timer.js',
  '/js/components/LifeWheel.js',
  '/js/services/aiGateway.js',
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
