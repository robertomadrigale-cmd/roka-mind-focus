# ROKA Mind Focus — Simplificación y "Empezar de cero"

Rama: crear `simplify-and-reset` desde `main`. Sin commit, push ni deploy.

**Principio:** quitar de la interfaz, de los prompts de IA y del código lo que no sirve al ciclo metas → hoy → semana. **No borrar datos guardados** en esta migración: los campos viejos del estado se ignoran. Solo "Empezar de cero" borra, y únicamente cuando el usuario lo pide.

## A. Eliminar

1. **Herramientas avanzadas y pseudo-psicología**
   - Quitar: tests de arquetipo, eneagrama y productividad (`#archetype-quiz`, `#enneagram-quiz`, `#productivity-quiz`, sus resultados, estados y botones), el "Mapa personal IA" (`.map-report-btn`, `generateMapReport`) y los informes astral/psicológico/estrategia a 5 años (`.ai-report-btn`, `generateAIReport`).
   - Quitar el interruptor `settings.advancedTools` y la sección "Herramientas avanzadas" de Mente y Perfil.
   - Quitar de Perfil los campos de nacimiento (fecha, hora, lugar). **Conservar** nombre, valores, miedos o bloqueos, e historia personal (el Coach los usa con consentimiento).
   - Eliminar los datos de nacimiento, eneagrama, arquetipo y astrología de todo contexto o prompt de IA (`buildCoachContext`, `buildWholeAppContext`, etc.).
   - Borrar el código muerto relacionado: `ARCHETYPE_*`, `ENNEAGRAM_*`, `PRODUCTIVITY_*`, `renderPersonalMap`, `renderDiagnosisResults`, etc.
2. **XP, niveles e insignias**
   - Quitar `addXP`, `updateXPDisplay`, `checkBadges`, `unlockBadge`, `LEVELS`, `BADGES`, "Logros desbloqueados", `#profile-xp-total`, `#user-level-display`, `#xp-fill` y cualquier toast de "+XP".
   - **Conservar la racha.**
   - En sync-model, `counters.xp` puede quedarse (inofensivo), pero sin interfaz.
3. **Frases motivacionales:** quitar `QUOTES`, `renderQuote` y `#quote-banner`.
4. **Victorias:** quitar toda referencia en la interfaz (puntos del calendario, detalle del día, estadísticas de Resumen, conteos). El campo `victories` puede seguir en el estado sin mostrarse.
5. **Duplicados:**
   - Quitar de Hoy el botón "Ver coach IA".
   - Quitar el botón flotante del Coach (`#coach-fab`).
   - Quitar "Generar ruta de hoy" (`#generate-daily-route-btn`, `#ai-daily-route-btn`, `generateDailyAIRoute`). El Coach ya tiene el iniciador "Priorizar mi día".

## B. Fusionar

6. **Visión en una sola página** (Metas → Visión). Las subpestañas de Metas quedan en **Trimestre · Visión · Hábitos** (se quita "Año").
   - La página Visión contiene, en este orden:
     1. **Mi visión**: el `visionText` existente, un párrafo.
     2. **3 valores**: los primeros 3 de `values5`.
     3. **3 metas del año**: los primeros 3 de `annualBig5`. Cada una muestra cuántas metas trimestrales activas la impulsan, o "Sin meta activa → Crear" (lógica existente de Big 5).
     4. **Rueda de la Vida**, con sus llamados a crear meta o ritual en las áreas bajas.
   - Quitar "En quién me convertiré" (`mustBecome5`) y las "Ideas / 10 prioridades del trimestre" (`quarterly10`, con su "Convertir en meta").
   - El selector del formulario SMART ("¿A qué meta del año contribuye?") ofrece solo las 3 metas del año. Si una meta tiene `big5Index > 2`, tratarlo como `null` al mostrar, sin modificar el dato.
   - Alias de ruta: `#/metas/anio` → `#/metas/vision`.
   - Trimestre conserva las metas SMART, los rituales vinculados y la lista "Dejar de hacer".
7. **Informes IA: solo 2 tipos**
   - **Feedback de la revisión semanal**: el que ya existe en el asistente ("Pedir feedback al Coach"). Si existe también la función vieja `generateWeeklyReview` y está duplicada, quitarla.
   - **"Ayúdame con esta meta"**: botón nuevo en cada tarjeta de meta SMART. Genera un informe con `callAI` usando la meta, su SMART, el avance, el siguiente paso, los rituales vinculados, las tareas relacionadas de los últimos 14 días y la última revisión semanal. Secciones: Diagnóstico, Obstáculos probables, Plan de 2 semanas y Siguiente paso de hoy (menos de 25 minutos). Se guarda como informe `type: 'goal-help'` con el título "Plan: <meta>" y se ofrece "Convertir el siguiente paso en tarea de hoy".
   - Los informes viejos ya guardados siguen visibles en Coach → Informes.
8. **Temporizador: 3 patrones**
   - **Enfoque**: caja 4-4-4-4 (`box`).
   - **Calma**: resonancia 5-5 (`resonance`, el patrón por defecto).
   - **Descanso**: 4-7-8 (`relax`).
   - Quitar `extended`, `sigh`, `diaphragm` y `pursed` del HTML y de `BREATHING_PATTERNS`. Si el patrón guardado ya no existe, usar `resonance`.

## C. Se quedan sin cambios
- Mente: Creencias y mantras, Aprendizaje, Círculo de Gigantes.

## D. "Empezar de cero" (Perfil → Privacidad y datos)

Flujo:
1. El botón **"Empezar de cero"** (estilo de peligro suave) abre un modal que explica qué se borra y qué se conserva, con un campo donde hay que escribir `BORRAR` para habilitar el botón de confirmar.
2. Antes de borrar se descarga automáticamente la exportación JSON (la función de "Descargar mis datos").
3. Se borra:
   - **Nube:** `users/{uid}/sync/collections|singletons|counters`, todos los `users/{uid}/days/*`, todos los `users/{uid}/chatThreads/*` con sus `messages/*`, y todos los `users/{uid}/reports/*`. Borrar en batches de 400 como máximo.
   - **Documento raíz:** `setDoc(users/{uid}, { schema: 5, migratedAt: <el existente>, resetAt: <ISO ahora> })` **sin merge**, para eliminar los campos heredados del estado.
   - **Local:** `rokaMindState`, `rokaMindSyncBase` y los caches en memoria (`coachThreads`, `reportCache`, etc.).
4. Se conserva:
   - La sesión de la cuenta.
   - La API key de IA (sessionStorage y localStorage).
   - El tema elegido y "Tema del día".
   - `settings.reminders`: se vuelve a escribir tras el reinicio.
   - `users/{uid}/backups/*`: inmutables por reglas; el modal lo menciona.
5. Después: el estado queda en `DEFAULT_STATE`, se reinicia el onboarding (`status: 'not_started'`) y se reinicia `startSync`.

**Reinicio en los demás dispositivos (obligatorio para que no resuciten los datos):**
- `syncService` escucha también el documento raíz. Guarda el `resetAt` conocido junto a `rokaMindSyncBase`.
- Si el `resetAt` remoto es distinto del conocido y posterior, el dispositivo descarta su estado local y su base (sin empujar nada), carga el estado vacío remoto y llama a `callbacks.onReset()`. La app reinicia la vista y muestra el aviso "Tus datos se reiniciaron desde otro dispositivo".
- Durante el reinicio se cancelan los pushes pendientes y el debounce, para evitar condiciones de carrera.
- Pruebas:
  - Unitarias para la lógica de decisión de `resetAt`.
  - En el emulador: el dispositivo A reinicia; el dispositivo B, que tenía datos y una base cacheada, se reconecta, **no vuelve a subir nada** y termina vacío.

## E. Textos y privacidad
- Actualizar `privacidad.html`: quitar las menciones a datos de nacimiento, eneagrama o astrología; mencionar "Empezar de cero" y que los respaldos de migración se eliminan a solicitud (derechos ARCO).
- Onboarding, estados vacíos y textos: ninguna referencia a XP, arquetipos ni astrología.

## F. Técnico
- Mantener: `ownerUid`, cierre de sesión (flush → `clearLocalSession` → `signOut`), fechas locales, sin handlers en línea, `esc()` en `innerHTML` y acentos en español.
- Ajustar las pruebas existentes que dependían de lo eliminado (p. ej. `migrateState`/`advancedTools`) sin bajar la cobertura del ciclo principal.
- Subir `CACHE_NAME` (y la cadena equivalente en `app.js`), los `?v=` y `urlsToCache`.
- Verificar: `npm test`, `npm run test:emulator`, `node --check` y un script que confirme que cada id referenciado por `app.js` existe una sola vez en `index.html`.
