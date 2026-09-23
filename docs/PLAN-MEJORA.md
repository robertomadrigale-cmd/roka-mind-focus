# Plan de mejora — ROKA Mind Focus

Origen: auditoría técnica del 2026-09-23 (rama base `codex/restore-ai-zen-focus`).
Rama de trabajo: `codex/audit-hardening`.

Reglas generales para quien implemente:

- Mantener el estilo del código existente (JS vanilla, módulos ES, sin frameworks ni bundler).
- No agregar dependencias de runtime al frontend. Para pruebas usar `node --test` (Node 24, sin librerías).
- No hacer `git commit`, `git push` ni `firebase deploy`. No borrar archivos no versionados del usuario.
- Cada cambio debe dejar la app funcionando con `python -m http.server 4173` servido desde `public/`.

---

## Fase 1 — Crítico (seguridad y privacidad)

### 1.1 Dejar de publicar el repositorio completo en Hosting
**Problema:** `firebase.json` usa `"public": "."`; en producción se descargan `/temp_full_transcript_utf8.txt`, `/package.json`, `/README.md`, `/firestore.rules`, etc.
**Cambio:**
- Crear `public/` y mover con `git mv`: `index.html`, `privacidad.html`, `terminos.html`, `manifest.json`, `sw.js`, `css/`, `js/`, `assets/`.
- `firebase.json`: `"public": "public"`; reducir `ignore` a `["**/.*", "**/node_modules/**"]`.
- `README.md`: actualizar instrucciones de desarrollo local (`python -m http.server 4173 --directory public`).
- `mundial-2026-productos-rochin.svg` queda fuera de `public/` (no se publica).
**Aceptación:** ningún archivo fuera de `public/` es alcanzable al servir; todas las rutas de la app (`/`, `/js/app.js`, `/sw.js`, `/assets/...`) siguen resolviendo.

### 1.2 Aislar los datos locales por cuenta
**Problema:** al cerrar sesión no se borra `localStorage['rokaMindState']`; el siguiente usuario del mismo navegador recibe esos datos y `reconcileCloudStateInBackground` los sube a SU cuenta.
**Cambio:**
- Añadir `ownerUid` al estado local (no se sube a la nube o, si se sube, es inofensivo).
- Al iniciar sesión: si el estado local tiene `ownerUid` distinto del `uid` actual → descartarlo (tratar como vacío) antes de cualquier reconciliación.
- Estado local heredado sin `ownerUid`: se permite adoptarlo una única vez (comportamiento actual) y se estampa `ownerUid`.
- Función `clearLocalSession()` llamada al cerrar sesión (y en `onAuthStateChanged` con `user === null` si había un usuario previo): borra `rokaMindState`, la API key IA (sessionStorage y localStorage), resetea `state` a `DEFAULT_STATE`, `coachThreads`, `activeCoachThreadId`, `activeCoachMessages`, `reportCache`.
- El botón "Cerrar Sesión" debe intentar primero un guardado pendiente en la nube (con timeout) y luego limpiar.
**Aceptación:** prueba unitaria de la función de selección de estado con los casos: mismo uid, uid distinto, legado sin uid, remoto vacío.

### 1.3 Política de privacidad veraz
**Problema:** `privacidad.html` afirma que no se transfieren datos a terceros, pero el contenido del perfil (historia de vida, miedos, nacimiento) se envía a OpenAI, Google (Gemini) y DeepSeek.
**Cambio:** reescribir la sección correspondiente: qué datos se envían, a qué proveedores, cuándo (solo al usar el Coach/informes y según los interruptores de contexto), que DeepSeek procesa datos fuera de México, que la API key la aporta el usuario, y cómo desactivarlo. Añadir fecha de última actualización. Marcar en el HTML con un comentario `<!-- REVISIÓN LEGAL PENDIENTE -->`.

### 1.4 API key IA: solo sesión por defecto
**Problema:** `storeAIKey` la guarda también en `localStorage` (persistente, texto plano).
**Cambio:** guardar en `sessionStorage`; solo en `localStorage` si el usuario marca una casilla nueva "Recordar en este dispositivo" (en ambos formularios: modal y perfil). Se borra al cerrar sesión (1.2).

### 1.5 Retirar ganchos de prueba de producción
Eliminar `window.test_*` al final de `app.js` y `window.startOnboardingTour` si no se usa desde HTML (verificar). Las pruebas usarán módulos puros (Fase 4).

---

## Fase 2 — Bugs de datos

### 2.1 Fechas en hora local
**Problema:** `todayStr()` y otros usan `toISOString()` (UTC). En México, después de las 18:00 todo se registra con fecha de mañana y el calendario (fechas locales) no coincide.
**Cambio:** crear `public/js/lib/dates.js` con `localDateKey(date = new Date())` → `YYYY-MM-DD` local. Reemplazar TODAS las ocurrencias de `toISOString().split('T')[0]` (app.js líneas ~353, ~835, ~1771, ~1789). Los timestamps (`updatedAt`, `createdAt`) siguen en ISO.
**Aceptación:** pruebas con fechas a las 23:30 locales.

### 2.2 Rueda de la Vida pierde cambios
**Problema:** `LifeWheel` guarda la referencia a `state` en el constructor; `state` se reasigna tras la reconciliación en la nube → las ediciones se escriben en un objeto huérfano.
**Cambio:** pasar `getState: () => state` y usar `this.getState()` en cada lectura/escritura. Revisar que `Timer` u otros componentes no tengan el mismo patrón.

### 2.3 Temporizador preciso
**Problema:** `Timer` descuenta 1 s por `setInterval`; en segundo plano el navegador lo ralentiza.
**Cambio:** al iniciar/reanudar guardar `endAt = Date.now() + restanteMs`; en cada tick calcular restante = `endAt - Date.now()`; al pausar guardar el restante. Recalcular también en `visibilitychange`.

### 2.4 Permitir seleccionar y copiar texto
**Problema:** `initSelectionGuard` borra toda selección fuera de inputs; no se pueden copiar respuestas del Coach.
**Cambio:** eliminar el guard global de `selectionchange`. Mantener la protección solo en botones/navegación (CSS `user-select: none` en esos elementos + los listeners de `hardenTouchTarget`). Añadir botón "Copiar" en mensajes del Coach del asistente.

---

## Fase 3 — Backend IA, sincronización y cabeceras

### 3.1 Endurecer la Cloud Function `ai` (functions/index.js)
- Lista blanca de modelos por proveedor (`ALLOWED_MODELS`); rechazar con 400 cualquier otro.
- Dejar de aceptar `clientApiKey` en el servidor (el servidor solo usa sus secretos). El cliente no debe enviarla al gateway (`aiGateway.js`).
- Acceso opcional restringido: si existe la variable `AI_ALLOWED_EMAILS` (lista separada por comas), solo esos correos verificados pueden usar las claves del servidor → 403 al resto.
- `encodeURIComponent(model)` en la URL de Gemini; enviar la API key de Gemini por cabecera `x-goog-api-key` en lugar de query string.
- `cors`: restringir a `https://roka-zen-full.web.app` y `https://roka-zen-full.firebaseapp.com` (y `http://127.0.0.1:4173`, `http://localhost:4173`).
- No reenviar mensajes de error crudos del proveedor al cliente: registrarlos con `logger` y responder un mensaje genérico en español.
- Aceptación: `node --check functions/index.js` pasa; lógica de validación extraída a funciones puras con pruebas.

### 3.2 Menos escrituras a Firestore
- `saveState()`: escribir en `localStorage` de inmediato; la escritura en la nube se agrupa con debounce (~1500 ms). Hacer flush en `visibilitychange` (hidden), `pagehide` y antes de cerrar sesión.
- Slider de progreso SMART: actualizar la UI en `input`, guardar en `change`.
- Eliminar guardados duplicados (`logActivity` + `addXP` + `saveState` en cadena ya quedan agrupados por el debounce; revisar que no haya await que dependa del guardado inmediato, p. ej. onboarding y migración de informes, que deben usar un flush explícito).

### 3.3 Protección contra el límite de 1 MB del documento
- Antes de subir, medir el tamaño del JSON. Si supera ~800 KB, mostrar aviso persistente en el estado de sincronización y registrar en consola.
- Poda segura: `dailyTasks` y `activityLog` con más de 400 días de antigüedad se archivan fuera del documento principal (solo local, dentro de la exportación). *No* migrar datos existentes a subcolecciones en esta fase (ver Fase 5).

### 3.4 Cabeceras de seguridad (firebase.json)
Añadir para `**`: `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`.
Añadir `Content-Security-Policy-Report-Only` (no bloqueante todavía) que permita: `self`, `https://www.gstatic.com`, `https://apis.google.com`, `https://*.googleapis.com`, `https://*.firebaseapp.com`, `https://accounts.google.com`, `https://api.openai.com`, `https://api.deepseek.com`, `https://generativelanguage.googleapis.com`; `frame-src` para `*.firebaseapp.com` y `accounts.google.com`.
Eliminar los dos `onclick=` inline de `index.html` (listeners en JS) para poder activar la CSP en el futuro.

### 3.5 Banner de cookies
Añadir botón "Solo esenciales". Hoy la app no carga analytics; el texto debe decir que solo usa almacenamiento local esencial.

---

## Fase 4 — Calidad

- Extraer a `public/js/lib/` funciones puras sin DOM: `dates.js`, `persistence.js` (`hasMeaningfulUserData`, `choosePersistedState`, `getStateTime`, selección por `ownerUid`, poda), y validación del gateway en `functions/lib/validate.js`.
- Pruebas en `tests/*.test.mjs` con `node:test` y `node:assert`. Script raíz `"test": "node --test tests/"`.
- Eliminar código muerto: `loadState` (si solo lo usaban los test hooks), `isMobileAuthFlow` (siempre false; simplificar el flujo), `renderRoutePager`, `moveRoute` si no se usa.
- Workflow `.github/workflows/test.yml`: Node 24, `npm test`, `node --check` sobre todos los `.js` de `public/js` y `functions/`.
- Subir la versión de caché del Service Worker y las query `?v=` de `app.js`/`main.css` en `index.html` y en la limpieza de cachés de `app.js`.

---

## Fase 5 — Requiere decisión del dueño (NO implementar ahora)

- Migrar el modelo de datos a subcolecciones (`users/{uid}/days/{fecha}`) con sincronización por documento y resolución de conflictos por campo. Implica migración de datos reales en producción.
- Desplegar la Cloud Function (requiere plan Blaze, secretos y decidir `AI_ALLOWED_EMAILS`) y activar Firebase App Check (requiere crear clave reCAPTCHA en consola).
- Pasar la CSP de Report-Only a bloqueante tras revisar informes.
- Revisión legal de la política de privacidad.
- Limpieza del directorio de trabajo (PNGs de depuración, `temp_*.txt`, scripts `fix_*.py`).
