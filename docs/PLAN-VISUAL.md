# ROKA Mind Focus — Pasada visual

Objetivo: que la jerarquía diga **"qué hago ahora"** y que la app se vea terminada, conservando la estética zen (verde bosque, vidrio y el círculo que respira).
Rama: `codex/audit-hardening`. Sin commit, push ni deploy.

## 1. Encabezado mínimo
- Dejar solo: marca, racha y avatar.
  - Marca: círculo más "ROKA" en una línea; el lema solo en escritorio.
  - Racha: ícono SVG de llama o diamante, número y "días" (solo en escritorio).
  - Avatar: abre Perfil.
- Quitar del encabezado:
  - `#theme-toggle-btn`: el tema se elige en Perfil.
  - `#settings-toggle-btn`: los botones de Perfil que hoy le hacen `.click()` deben abrir el modal `#ai-settings-modal` directamente.
  - `#header-date`: la fecha pasa al subtítulo de Hoy, p. ej. "Miércoles 23 de septiembre".
  - `#account-sync-status` y `#logout-btn`: el estado de sincronización pasa a un punto de color sobre el avatar (`data-status`: synced = verde, pending = ámbar, saving = pulso), con `title` y `aria-label` descriptivos; el texto completo va en Perfil → sección "Cuenta", junto con "Cerrar sesión".
- **Mantener intacta** la lógica de cierre de sesión (flush → `clearLocalSession` → `signOut`) y `updateAccountSyncStatus`: solo cambia dónde se muestran.

## 2. Tipografía y contraste
- Tamaño mínimo **12 px** para cualquier texto. Excepción: etiquetas de la barra inferior, mínimo 11 px con `font-weight: 600`.
- Escala: 12 / 14 / 16 / 20 / 28 / 36 px, en tokens `--fs-xs … --fs-3xl`. Cuerpo: 15–16 px.
- `--text-muted` y `--text-secondary` con contraste ≥ 4.5:1 sobre `--bg-surface` en cada tema.
- Los títulos de tarjeta no van en mayúsculas forzadas y usan el mismo peso en toda la app.

## 3. Íconos
- Un sprite SVG en línea al inicio de `<body>` (`<svg hidden><symbol id="i-…">`), con trazos al estilo Lucide: 24×24, `stroke="currentColor"`, `stroke-width="2"`, sin relleno.
- Usarlo con `<svg class="icon"><use href="#i-…"/></svg>`.
- Reemplazar **todos** los glifos Unicode y emojis usados como ícono (☐ ✓ ★ + ◐ ⚙ ◆ ◇ ↻ ↗ ✦ ⟲ ⟐ ▲ ◎ ⊕ 📖 👥 ✏️ ⏱ ◉ ✕, kanji 静 巡 的 縁, las letras "M", "I", "R" dentro de `card-icon`), tanto en HTML como en las plantillas de `app.js`.
- Los botones de borrar (✕) pasan a `i-x` con `aria-label="Eliminar"`.

## 4. Color con significado
- Tokens por tema:
  - `--accent`: acción principal (botones primarios, "Hacer hoy", foco).
  - `--success`: completado (checks, rituales hechos, metas logradas).
  - `--warning`: pendientes y atrasos.
  - `--info`: datos y estadísticas.
- Tareas o rituales completados: check `--success` y texto atenuado.
- Tarjeta de pendientes: borde izquierdo `--warning`.
- Metas en foco semanal: insignia "En foco" con `--accent`.

## 5. Distribución de Hoy
- ≥ 1100 px: dos columnas.
  - Izquierda (más ancha): avisos (revisión semanal, pendientes), siguientes pasos y plan del día.
  - Derecha: rituales del día, enfoque (temporizador compacto) y cierre del día.
- Móvil: una columna en ese mismo orden. El temporizador en móvil ocupa como máximo unos 320 px de alto.
- En escritorio, Metas y Semana aprovechan el ancho: tarjetas en cuadrícula de 2 columnas donde tenga sentido.

## 6. Estados vacíos con acción
Cada estado vacío: ícono SVG, una frase y un botón primario que resuelve el vacío:
- Sin metas → "Crear mi primera meta": abre el formulario SMART.
- Sin tareas → enfocar `#task-input`.
- Sin rituales → enfocar `#daily-ritual-input`.
- Sin mantras o creencias → enfocar `#belief-input`.
- Sin informes → "Generar mi primer informe": lleva a Coach → informes.
- Calendario sin actividad → "Planear hoy": navega a Hoy.

## 7. Revisión semanal como asistente real
- Mostrar un solo paso a la vez.
- Indicador de progreso de 5 pasos (clicable para volver atrás), con botones "Atrás" y "Siguiente"; en el último paso, "Guardar revisión".
- Mantener los ids y la función de guardado existentes; solo cambia la presentación.
- Se puede navegar con teclado.

## 8. Temas
- Reducir `THEME_PRESETS` a tres:
  - `zen-garden`: "Zen", oscuro, por defecto.
  - `paper`: "Papel", claro.
  - `graphite`: "Grafito", oscuro de alto contraste.
- Agregar la opción "Automático", que sigue `prefers-color-scheme` usando Zen o Papel.
- Si el tema guardado ya no existe, usar `zen-garden`. Eliminar el CSS de los temas retirados.
- El selector vive en Perfil → Apariencia.

## 9. Estilos en línea
- Mover a clases los `style="…"` de `index.html`: encabezado, Hoy, Metas, Semana, Mente, banner de cookies, modal de IA y onboarding.
- En `app.js`, las plantillas nuevas no usan `style=` salvo valores dinámicos (anchos de barras de progreso).

## 10. Móvil
- A 375 px de ancho: sin scroll horizontal, sin elementos cortados en el encabezado y barra inferior legible.
- Revisar que `--roka-visual-width` / `--roka-visual-left` (`updateMobileViewportVars`) no achiquen el layout. Si solo sirven para el teclado de iOS, limitar su uso a la barra inferior con `width: 100%` como respaldo.
- Usar `min-height: 100dvh` donde hoy se usa `100vh`.
- Áreas táctiles de al menos 44×44 px.

## 11. Técnico
- Subir `CACHE_NAME` en `sw.js` y la cadena equivalente en la limpieza de cachés de `app.js`, además de los `?v=` en `index.html`.
- Mantener sin cambios: ids usados por `app.js` (verificar con un script que todos los `$('#…')` existan y no haya duplicados), rutas, lógica de datos, seguridad (sin handlers en línea) y pruebas (`npm test` en verde).
