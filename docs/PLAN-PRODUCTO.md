# ROKA Mind Focus — Rediseño de producto: un sistema conectado

Fecha: 2026-09-23 · Rama: `codex/audit-hardening`

## 1. Diagnóstico

La app tiene más de 15 herramientas sueltas: SMART, Big 5, 10 prioridades, valores, identidad, dejar de hacer, Círculo de Gigantes, Rueda de la Vida, creencias, mantras, gratitud, orgullos, tests de personalidad, carta astral y XP. Ninguna alimenta a otra. Tampoco hay un camino que guíe al usuario: no sabe qué hacer hoy ni por qué.

## 2. Propuesta de valor (una frase)

> **ROKA convierte lo que quieres lograr en lo que haces hoy, y cada semana te muestra si está funcionando.**

Todo lo que no sirva a esa frase se vuelve opcional.

## 3. El sistema: 4 niveles conectados

```
VISIÓN  (5 años, valores, identidad, Rueda de la Vida = diagnóstico)
   │  cada meta del año nace de la visión o de un área baja de la Rueda
   ▼
AÑO     (Big 5)
   │  cada meta trimestral SMART se vincula a un Big 5 y a un área de vida
   ▼
TRIMESTRE (metas SMART activas, máx. recomendado 3) ── RITUALES (hábitos que sostienen una meta)
   │  cada meta tiene SIEMPRE un "siguiente paso"
   ▼
HOY     (tareas: los siguientes pasos de tus metas + tareas libres, rituales del día, foco, cierre)
   │
   ▼
SEMANA  (revisión guiada: datos reales de la semana → ajuste de metas → foco de la próxima semana)
   └──► vuelve a alimentar TRIMESTRE y HOY
```

El Coach lee todo el sistema y ayuda en cada nivel.

## 4. Nueva navegación (5 pestañas + Perfil en el avatar)

| Pestaña | Ruta | Pregunta que responde | Contenido |
|---|---|---|---|
| **Hoy** | `#/hoy` | ¿Qué hago ahora? | Aviso de revisión semanal si toca · Pendientes de días anteriores · **Siguientes pasos de tus metas** · Plan del día · Rituales del día · Enfoque (temporizador) · **Cierre del día** (gratitud y orgullo en una sola tarjeta) · Mantra activo |
| **Metas** | `#/metas` | ¿Hacia dónde voy? | Subpestañas: **Trimestre** (metas SMART y rituales vinculados, dejar de hacer) · **Año** (Big 5) · **Visión** (5 años, valores, identidad, Rueda de la Vida) · **Hábitos** (tabla de rituales por días) |
| **Semana** | `#/semana` | ¿Está funcionando? | Subpestañas: **Revisión** (asistente guiado) · **Calendario** · **Resumen** (estadísticas, tendencia de revisiones, logros) |
| **Mente** | `#/mente` | ¿Qué me frena? | Creencias y mantras · Aprendizaje · Círculo de Gigantes · *Herramientas avanzadas* (tests y carta astral, ocultas por defecto) |
| **Coach** | `#/coach` | Ayúdame a decidir | Sin cambios estructurales; más contexto (ver §8) |
| Perfil | `#/perfil` | Ajustes | Solo cuenta, IA, tema, datos, preferencias del Coach e interruptor de "Herramientas avanzadas". Se abre desde el avatar; sale de la barra lateral y de la inferior. |

Alias de ruta que se conservan: `progreso` → `semana`, `reflection` → `semana`, `mindset` → `mente`, `strategy` → `metas`, `today`/`daily` → `hoy`, `identity`/`profile` → `perfil`, `ai` → `coach`.
Subrutas: `#/metas/trimestre|anio|vision|habitos`, `#/semana/revision|calendario|resumen`.

## 5. Modelo de datos (compatible hacia atrás; `stateVersion: 4`)

Añadir sin borrar campos existentes (la migración en `normalizeState` solo completa valores por defecto):

- `smartGoals[]`: `big5Index` (número 0–4 o `null`), `lifeArea` (clave de `LIFE_WHEEL_AXES` o `''`), `status` (`'active' | 'done' | 'paused'`; derivar `'done'` si `completed`), `progressHistory: [{date, progress}]` (añadir entrada cuando cambia `progress`), `createdAt`.
- `dailyTasks[date][]`: `goalId` (opcional), `carriedFrom` (fecha original, opcional), `completedAt` (ISO, opcional).
- `rituals[]`: `goalId` (opcional), `lifeArea` (opcional), `createdAt`.
- `weeklyReviews: [{ id, weekKey, createdAt, stats, well, adjust, goalUpdates: [{goalId, from, to, nextStep}], focusGoalIds: [], lifeWheel: {…copia…} }]` (máx. 104; recortar las más antiguas).
- `weekFocus: { weekKey, goalIds: [] }`: metas en foco esta semana (las elige la revisión).
- `settings: { advancedTools: boolean }`. Valor por defecto: `true` si el usuario ya tiene datos en `personalMap` (archetype/enneagram/productivity) o informes de tipo `astral`/`psych`; si no, `false`.
- Mantener `weeklyReflection`, `quarterly10`, `victories`, `gamification` para no perder datos. `quarterly10` pasa a ser una lista de "Ideas del trimestre" con un botón **"Convertir en meta"**.

`weekKey` = lunes de la semana en fecha local `YYYY-MM-DD` (ver `public/js/lib/dates.js`).

## 6. Conexiones (lo que hace que sea un sistema)

1. **Meta → Hoy**: la tarjeta "Siguientes pasos de tus metas" en Hoy lista cada meta activa (primero las de `weekFocus`) con su `nextStep` y el botón **"Hacer hoy"**, que crea una tarea con `goalId` y prioridad alta. Si una meta no tiene `nextStep`, se muestra un campo en línea: "Define el siguiente paso de «meta»".
2. **Tarea → Meta**: al completar una tarea con `goalId` cuyo texto coincide con el `nextStep` de la meta, se vacía el `nextStep` y aparece en línea (en la misma tarjeta de la tarea completada) un mini formulario: "Siguiente paso" + control de avance (%) + Guardar. Cada cambio de avance se registra en `progressHistory`. Las tareas vinculadas muestran una etiqueta con el nombre corto de la meta.
3. **Pendientes**: si existen tareas incompletas de días anteriores (últimos 14 días), Hoy muestra "Tienes N pendientes de días anteriores" con **Pasar a hoy** (se mueven con `carriedFrom`) y **Descartar**.
4. **Rituales ↔ Metas**: al crear un ritual (desde Hoy o desde Hábitos) se puede elegir una meta y un área de vida opcionales. En la tarjeta de cada meta se listan sus rituales con su cumplimiento de los últimos 7 días (programados vs. completados).
5. **Rueda de la Vida → Metas/Rituales**: las áreas con puntaje ≤ 4 muestran **"Crear meta"** (abre el formulario SMART con `lifeArea` precargado) y **"Crear ritual"**.
6. **Big 5 → Metas**: el formulario SMART tiene un selector "¿A qué meta del año contribuye?" (Big 5 no vacíos). En Año, cada Big 5 muestra cuántas metas trimestrales activas lo impulsan; si ninguna, muestra "Sin meta activa → Crear".
7. **Revisión semanal guiada** (Semana → Revisión), asistente de 5 pasos:
   1. *Tu semana en datos* (automático): tareas completadas/total, % de cumplimiento de rituales, sesiones de foco, cambio de avance por meta y días activos.
   2. *Reflexión*: "¿Qué salió bien?" y "¿Qué ajustarás?" (rellenan también `weeklyReflection` por compatibilidad).
   3. *Metas*: por cada meta activa, nuevo avance (%), siguiente paso y opción de pausar o marcar como lograda.
   4. *Sistema*: revisar rituales (mantener o eliminar) y la lista "Dejar de hacer" (editable).
   5. *Foco de la próxima semana*: elegir hasta 3 metas → `weekFocus`. Opcional: actualizar la Rueda de la Vida.
   Al guardar se crea un registro en `weeklyReviews`, se actualiza `sectionDates.weekly` y se ofrece **"Pedir feedback al Coach"** (usa el flujo `callAI` existente con las estadísticas y las respuestas).
8. **Aviso de revisión**: en Hoy, si no existe una revisión para la `weekKey` actual y es viernes, sábado, domingo o lunes (o si pasaron más de 7 días desde la última), mostrar la tarjeta "Cierra tu semana en 10 minutos → Empezar revisión".
9. **Resumen**: tendencia de las últimas 8 revisiones (tareas completadas y % de rituales), con barras simples en SVG o CSS, sin librerías.

## 7. Simplificación

- **Herramientas avanzadas** (ocultas si `settings.advancedTools === false`): tests de arquetipo, eneagrama y productividad, "Mapa personal IA", carta astral/perfil psicológico/estrategia a 5 años, insignias y XP (la racha de días se mantiene visible porque es útil). Todo pasa a Mente → *Herramientas avanzadas*, con el interruptor también en Perfil. Nunca se borran datos.
- **Cierre del día**: gratitud y orgullo en una sola tarjeta con dos campos y un botón "Guardar cierre". Se mantienen `gratitudeLogs` y `prideLogs`.
- **Hoy** debe caber en un recorrido lógico de arriba hacia abajo: avisos → siguientes pasos → plan → rituales → foco → cierre. La cita motivacional se queda al final y el temporizador baja debajo del plan.
- Textos de las pestañas y títulos en español claro, sin jerga ("Instalador de Rituales" pasa a ser "Hábitos"; "Tu taller mental" puede quedarse).

## 8. Coach

`getTodayRecommendationContext` / `buildCoachContext` / `buildWholeAppContext` deben incluir: metas activas con Big 5 vinculado, avance y siguiente paso; `weekFocus`; tareas de hoy (hechas y pendientes); cumplimiento de rituales de los últimos 7 días; la última revisión semanal (`well` y `adjust`); y las áreas bajas de la Rueda. El botón "Generar ruta de hoy" debe proponer tareas a partir de los siguientes pasos. Las acciones del Coach "Guardar como tarea" y "Convertir en meta" siguen igual.

## 9. Onboarding (3 pasos, reemplaza el actual)

1. "¿Qué quieres lograr en los próximos 90 días?" → crea la meta SMART (30 → 90 días por defecto).
2. "¿Cuál es el primer paso?" → `nextStep` de la meta y tarea de hoy vinculada (`goalId`).
3. "¿Qué hábito diario te acerca a eso?" (opcional) → ritual todos los días vinculado a la meta.

## 10. Requisitos técnicos

- Vanilla JS con módulos ES, sin dependencias nuevas. Seguir el estilo existente (`$`, `$$`, `esc`, `saveState`, `showToast`, `todayStr`).
- Lógica pura en `public/js/lib/system.js`, sin DOM: `weekKey(date)`, `weekStats(state, weekKey)`, `ritualAdherence(state, ritualId, endDate, days)`, `goalNextSteps(state)`, `overdueTasks(state, today, maxDays)`, `carryOverTasks(state, today, ids)`, `completeTaskEffects(state, date, taskId)`, `migrateState(state)` (defaults de v4 y `advancedTools`), `shouldPromptWeeklyReview(state, today)`, `lowLifeAreas(state, threshold)`. Todas con pruebas en `tests/system.test.mjs`.
- Todo texto de usuario que se inyecte con `innerHTML` pasa por `esc()`.
- Mantener funcionando: separación de datos por `ownerUid`, debounce del guardado (`saveState`/`flushCloudSave`), fechas locales, service worker (añadir `system.js` a `urlsToCache` y subir las versiones de caché y `?v=`).
- Móvil primero: la barra inferior queda con 5 ítems (Hoy, Metas, Semana, Mente, Coach) y el FAB del Coach se quita si el Coach ya está en la barra. En escritorio, la barra lateral muestra las 5 pestañas y el avatar abre Perfil.
- Accesibilidad: botones reales, `aria-current` en navegación y `aria-selected` en subpestañas; los asistentes se navegan con teclado.
- No hacer commit, push ni deploy.
