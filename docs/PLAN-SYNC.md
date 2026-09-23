# ROKA Mind Focus — Sincronización multi-dispositivo (esquema v5)

Rama: `codex/audit-hardening`. Sin commit, push ni deploy.

## 1. Problema

Todo el estado vive en un solo documento `users/{uid}`, que se sobrescribe completo con `setDoc` (gana el último que escribe). Si el celular y la computadora editan en paralelo, uno borra los cambios del otro, aunque hayan tocado cosas distintas. Además, los cambios del otro dispositivo solo llegan al recargar la app.

## 2. Objetivo

- Las ediciones de distintos elementos en dos dispositivos **nunca** se pierden. Ejemplo: el celular crea una tarea y la computadora edita una meta; ambas cosas quedan.
- Si dos dispositivos editan **el mismo** elemento, gana la edición más reciente (LWW por elemento o por campo), sin afectar al resto.
- Los contadores se suman y no se sobrescriben: sesiones de foco, actividad, XP.
- Las completaciones de rituales hechas en dos dispositivos el mismo día se conservan todas.
- Un borrado se respeta: un elemento borrado no revive por una copia vieja de otro dispositivo, salvo que ese dispositivo lo haya editado **después** del borrado.
- Los cambios de otro dispositivo aparecen en vivo, sin recargar.
- Offline primero: la app sigue funcionando sin red y sincroniza al volver.
- Los datos existentes se migran sin pérdida. El documento viejo se conserva como respaldo.

## 3. Principio de diseño: la forma del estado en memoria NO cambia

`app.js` tiene cientos de lugares que mutan `state` y luego llaman a `saveState()`. **No se tocan.** Solo se reemplaza la capa de persistencia:

```
state (en memoria, igual que hoy)
   │ stateToModel()                       ▲ modelToState()
   ▼                                      │
model (normalizado, con _u/_d por item) ──┴── merge(local, remoto)
   │ diffModels(lastSynced, current)
   ▼
escrituras de Firestore por ruta de campo (updateDoc/setDoc merge + increment)
```

## 4. Esquema remoto v5

Todos los valores de elementos llevan `_u` (marca de tiempo en ms del último cambio, estampada por el adaptador) y, opcionalmente, `_d: true` (tombstone).

| Documento | Contenido |
|---|---|
| `users/{uid}` | **Respaldo del estado heredado, que no se modifica**, más `schema: 5` y `migratedAt`. Los clientes v5 no vuelven a escribir el estado heredado. |
| `users/{uid}/sync/collections` | Mapas por id: `goals`, `rituals` (**sin** `completions`), `beliefs`, `mantras`, `circleOfGiants`, `weeklyReviews`, `aiReports` (legado). Por ejemplo, `goals.{id} = {…goal, _u}`. |
| `users/{uid}/sync/singletons` | Un campo por clave escalar u objeto: `userProfile`, `lifeWheel`, `annualBig5`, `values5`, `mustBecome5`, `quarterly10`, `stopDoingList`, `weeklyReflection`, `learning`, `visionText`, `sectionDates`, `personalMap`, `coachPreferences`, `aiConfig`, `settings`, `weekFocus`, `onboarding`, `hasSeenOnboarding`, `reportsMigrated`, `gamification.level`, `gamification.badges`, `localArchive`, más cualquier otra clave desconocida del estado. Formato: `{ v: <valor>, _u }`. LWW por clave. |
| `users/{uid}/sync/counters` | `xp` (número), con escritura por `increment(delta)`. |
| `users/{uid}/days/{YYYY-MM-DD}` | `tasks.{id} = {…task, _u}`, `logs.{id} = {kind: 'pride'|'gratitude'|'victory', …, _u}`, `ritualDone.{ritualId} = {v: true|false, _u}`, `activity` (número, `increment`), `focus` (número, `increment`). |

Notas:
- `gamification.xp` pasa a `counters.xp`. Los demás contadores diarios (`activityLog`, `focusLog`) pasan a `days/{fecha}.activity|focus`.
- `ritual.completions[date]` y el marcador legado `days[dk] === 'completed_' + date` pasan a `days/{fecha}.ritualDone.{ritualId}`. `modelToState` reconstruye `ritual.completions` a partir de los días cargados.
- `dailyTasks[date]` pasa a `days/{date}.tasks` y conserva el orden con un campo `order` (índice) dentro de cada tarea.
- Los arrays de objetos sin `id`: asignar un id estable al migrar.

## 5. Módulos

### `public/js/lib/sync-model.js` (puro, sin Firebase ni DOM; 100 % probado)
- `stateToModel(state, { now, prevModel })`: construye el modelo normalizado. Para cada elemento o clave cuyo contenido (sin `_u`/`_d`) difiere de `prevModel`, estampa `_u = now`; si no cambió, conserva el `_u` de `prevModel`. Los elementos presentes en `prevModel` y ausentes ahora se convierten en tombstone `{_d: true, _u: now}`. Los contadores se guardan como valores absolutos en el modelo.
- `modelToState(model, baseState)`: reconstruye el estado con la forma exacta que usa `app.js` (ignorando tombstones, reconstruyendo `completions`, `dailyTasks`, `activityLog`, `focusLog`, `gamification.xp`, el orden de las tareas).
- `diffModels(prev, next)`: devuelve la lista de escrituras `{ path: 'users/{uid}/…' relativo, fields: { 'goals.abc': value | {__increment: n} } }`, agrupada por documento. Contadores: `delta = next - prev`, y solo si `delta !== 0`.
- `mergeModels(local, remote)`: LWW por elemento o clave comparando `_u` (con empate, gana el remoto). Tombstone contra edición: gana el de mayor `_u`. Contadores: se usa el valor remoto, que es la verdad del servidor, más los deltas locales pendientes (el llamador pasa `pendingCounterDeltas`).
- `legacyToModel(legacyState, now)`: migración del estado v4 al modelo v5 (todo con `_u = getStateTime(legacy) || now`).

### `public/js/services/syncService.js` (Firestore)
- `startSync(uid, callbacks)`: carga `sync/*`, `days` de los últimos 400 días y el documento raíz; ejecuta la migración si hace falta (§6) y se suscribe con `onSnapshot` a `sync/*` y a `days` desde hace 60 días hasta hoy. Al recibir un snapshot con cambios remotos (`!snapshot.metadata.hasPendingWrites`): `mergeModels` → `modelToState` → `callbacks.onRemoteChange(newState)`.
- `pushChanges()`: calcula `diffModels(lastSyncedModel, stateToModel(state))`, escribe en un `writeBatch` (máx. 400 operaciones por batch) con `setDoc(ref, data, { merge: true })` usando rutas anidadas. Para contadores usa `increment()`; para crear documentos de día nuevos, `setDoc` con merge. Si tiene éxito, actualiza `lastSyncedModel`.
- `stopSync()`: cancela las suscripciones (se llama al cerrar sesión).
- `lastSyncedModel` y `pendingCounterDeltas` se guardan en `localStorage` bajo la clave `rokaMindSyncBase` junto con `ownerUid`. Se borran en `clearLocalSession()`. Si el `ownerUid` no coincide, se descartan (misma regla que hoy).

### Cambios en `app.js`
- `saveState()`: el guardado local inmediato no cambia; el debounce ahora llama a `syncService.pushChanges()` en lugar de `setDoc(users/{uid}, estadoCompleto)`. Mantener `flushCloudSave()` con la misma semántica.
- Se eliminan `reconcileCloudStateInBackground` y `syncPendingState` (quedan reemplazados por `startSync` y el reintento de `pushChanges` en el evento `online` y cada 45 s si hay diff pendiente).
- `onRemoteChange(newState)`: asigna `state = newState`, `normalizeState()`, guarda en local y hace un re-render **suave**:
  - No re-renderiza la vista si hay un `input`/`textarea` enfocado dentro de ella; marca la vista como "sucia" y la re-renderiza al perder el foco.
  - Agrupa los cambios remotos con un debounce de 300 ms.
  - Muestra un indicador discreto en el punto de sincronización del avatar.
- El estado de sincronización (`updateAccountSyncStatus`) refleja: sincronizado / pendiente / sin conexión / aplicando cambios de otro dispositivo.
- `getCloudSafeState` / `pruneStateForCloud` / el aviso de 1 MB ya no se necesitan para la nube: los días son documentos separados. Mantener la poda local de `localStorage` si el estado local supera unos 4 MB.

## 6. Migración (una vez por cuenta, idempotente)

1. Al entrar, `startSync` lee `users/{uid}`. Si `schema !== 5`:
   1. Elegir la fuente con `choosePersistedState(local, remoto heredado)` (lógica existente con `ownerUid`).
   2. Copiar el documento heredado a `users/{uid}/backups/{timestamp}` (respaldo, se escribe una sola vez).
   3. `legacyToModel` → escribir todos los documentos v5 en batches.
   4. Al final, `setDoc(users/{uid}, { schema: 5, migratedAt }, { merge: true })`. **No** borrar los campos heredados.
2. Si en otro dispositivo la migración está en curso o ya terminó (`schema === 5`), no se repite.
3. **Clientes viejos en caché** (versión anterior que todavía escribe el documento completo en `users/{uid}`): si `users/{uid}.updatedAt > migratedAt`, el cliente v5 fusiona ese estado heredado más nuevo con `legacyToModel` + `mergeModels` y lo sube, y luego actualiza `migratedAt`. Así no se pierden los cambios hechos con la versión vieja durante la transición.
4. Si la migración falla a medias, se reintenta de forma segura: las escrituras son idempotentes por id y `schema` solo se marca al final.

## 7. Reglas de Firestore (`firestore.rules`)

Agregar, solo para el dueño (`request.auth.uid == userId`):
- `users/{userId}/sync/{docId}` con `docId in ['collections','singletons','counters']`.
- `users/{userId}/days/{dayId}` con `dayId.matches('^\\d{4}-\\d{2}-\\d{2}$')`.
- `users/{userId}/backups/{backupId}`: crear y leer, **sin** actualizar ni borrar.

Se mantienen las reglas actuales (`chatThreads`, `reports`, `aiUsage`, denegar por defecto).

## 8. Pruebas (obligatorias)

### Unitarias — `tests/sync-model.test.mjs`
- `stateToModel` → `modelToState` hace un viaje de ida y vuelta sin pérdida sobre un estado v4 completo y realista: metas, rituales con completions (incluido el marcador legado), tareas de varios días, logs, contadores, singletons y claves desconocidas.
- **Simulación de dos dispositivos** (A y B parten del mismo modelo):
  - A crea una tarea y B edita una meta → merge: ambos cambios presentes.
  - A y B editan la misma meta → gana el `_u` mayor.
  - A borra un ritual y B lo edita antes (con `_u` menor) → queda borrado. B lo edita después → revive con la edición de B.
  - A y B completan rituales distintos el mismo día → ambos quedan completados.
  - A +1 foco y B +2 foco → el total remoto es la suma (vía deltas).
  - A cambia `lifeWheel` y B cambia `userProfile` → ambos quedan.
- `diffModels` no genera escrituras cuando nada cambió y agrupa por documento.
- `legacyToModel` sobre un estado v3/v4 real (usar un fixture anónimo basado en `DEFAULT_STATE` más datos de ejemplo).

### Integración — emulador de Firestore (Java 21 disponible)
- `firebase.json`: agregar `"emulators": { "firestore": { "port": 8080 } }`.
- `tests/sync-emulator.test.mjs`: usar el SDK de Firebase para Node como `devDependency` (`firebase`), apuntado al emulador con `connectFirestoreEmulator`, sin autenticación real: correr las reglas en modo abierto o probarlas aparte con `@firebase/rules-unit-testing`, también `devDependency`.
  - Dos instancias de app (dispositivo A y B) contra el mismo uid: escrituras concurrentes intercaladas → estado final idéntico en ambos y sin pérdidas (los mismos escenarios de la simulación).
  - La migración desde un documento heredado v4 produce un modelo equivalente y crea el respaldo.
  - Reglas: otro uid no puede leer ni escribir `sync`, `days` ni `backups`; el dueño no puede borrar ni actualizar `backups`.
- Script `npm run test:emulator` → `firebase emulators:exec --only firestore "node --test tests/sync-emulator.test.mjs"`. `npm test` sigue corriendo solo las pruebas unitarias.

## 9. Técnico

- Importar desde `https://www.gstatic.com/firebasejs/12.14.0/firebase-firestore.js` también `updateDoc`, `writeBatch`, `onSnapshot`, `increment`, `where`, `documentId` (o una consulta por rango de id de documento) según haga falta.
- Mantener la seguridad existente: `ownerUid`, `clearLocalSession` (debe llamar a `stopSync` y borrar `rokaMindSyncBase`), orden del cierre de sesión (flush → limpiar → `signOut`), fechas locales y ningún handler en línea.
- Agregar `sync-model.js` y `syncService.js` a `urlsToCache` de `sw.js`. Subir `CACHE_NAME`, la cadena equivalente en `app.js` y los `?v=`.
- Los cambios en `app.js` deben ser mínimos y localizados en la capa de persistencia.
- **No** hacer commit, push, `firebase deploy` (ni de hosting ni de reglas) ni borrar archivos no versionados.
