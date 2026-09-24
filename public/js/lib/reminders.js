// Recordatorios del ciclo ROKA: plan diario y revisión semanal.
// Lógica pura (sin DOM) para poder probarla con node:test.

export const WEEK_DAYS = [
  { key: 'SU', label: 'Domingo', js: 0 },
  { key: 'MO', label: 'Lunes', js: 1 },
  { key: 'TU', label: 'Martes', js: 2 },
  { key: 'WE', label: 'Miércoles', js: 3 },
  { key: 'TH', label: 'Jueves', js: 4 },
  { key: 'FR', label: 'Viernes', js: 5 },
  { key: 'SA', label: 'Sábado', js: 6 }
];

export const DEFAULT_REMINDERS = { dailyTime: '08:00', weeklyDay: 'SU', weeklyTime: '18:00', notifications: false };

export function normalizeReminders(value = {}) {
  const time = input => (/^([01]\d|2[0-3]):[0-5]\d$/.test(String(input || '')) ? String(input) : null);
  return {
    dailyTime: time(value.dailyTime) || DEFAULT_REMINDERS.dailyTime,
    weeklyDay: WEEK_DAYS.some(day => day.key === value.weeklyDay) ? value.weeklyDay : DEFAULT_REMINDERS.weeklyDay,
    weeklyTime: time(value.weeklyTime) || DEFAULT_REMINDERS.weeklyTime,
    notifications: value.notifications === true
  };
}

function pad(value) {
  return String(value).padStart(2, '0');
}

function icsDate(date) {
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
}

function icsStamp(date) {
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
}

function icsText(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

function nextWeekday(from, jsDay) {
  const date = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  date.setDate(date.getDate() + ((jsDay - date.getDay() + 7) % 7));
  return date;
}

// Genera un calendario .ics con dos eventos recurrentes en hora local (flotante),
// cada uno con una alarma en el momento del evento.
export function buildRemindersICS(reminders, { url = '', now = new Date() } = {}) {
  const r = normalizeReminders(reminders);
  const weekly = WEEK_DAYS.find(day => day.key === r.weeklyDay);
  const events = [
    {
      uid: 'roka-daily-plan@roka-mind-focus',
      start: `${icsDate(now)}T${r.dailyTime.replace(':', '')}00`,
      rrule: 'FREQ=DAILY',
      summary: 'ROKA · Planea tu día',
      description: 'Abre ROKA, elige el siguiente paso de tus metas y define tus 3 tareas de hoy.',
      link: url ? `${url}#/hoy` : ''
    },
    {
      uid: 'roka-weekly-review@roka-mind-focus',
      start: `${icsDate(nextWeekday(now, weekly.js))}T${r.weeklyTime.replace(':', '')}00`,
      rrule: `FREQ=WEEKLY;BYDAY=${weekly.key}`,
      summary: 'ROKA · Cierra tu semana',
      description: 'Revisión semanal de 10 minutos: datos reales, ajuste de metas y foco de la próxima semana.',
      link: url ? `${url}#/semana/revision` : ''
    }
  ];
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//ROKA Mind Focus//Recordatorios//ES', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  events.forEach(event => {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${event.uid}`,
      `DTSTAMP:${icsStamp(now)}`,
      `DTSTART:${event.start}`,
      'DURATION:PT15M',
      `RRULE:${event.rrule}`,
      `SUMMARY:${icsText(event.summary)}`,
      `DESCRIPTION:${icsText(event.link ? `${event.description}\n${event.link}` : event.description)}`,
      ...(event.link ? [`URL:${event.link}`] : []),
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${icsText(event.summary)}`,
      'TRIGGER:PT0M',
      'END:VALARM',
      'END:VEVENT'
    );
  });
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

function minutesOf(time) {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

function dateKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// Devuelve el recordatorio que toca mostrar ahora (o null), sin repetir uno ya mostrado hoy.
// `shown` = { daily: 'YYYY-MM-DD', weekly: 'YYYY-MM-DD' }.
export function dueReminder(reminders, shown = {}, now = new Date()) {
  const r = normalizeReminders(reminders);
  const today = dateKey(now);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const weekly = WEEK_DAYS.find(day => day.key === r.weeklyDay);
  if (now.getDay() === weekly.js && nowMinutes >= minutesOf(r.weeklyTime) && shown.weekly !== today) {
    return { kind: 'weekly', title: 'Cierra tu semana', body: 'Tu revisión semanal toma 10 minutos. Ajusta metas y elige tu foco.', route: '#/semana/revision' };
  }
  if (nowMinutes >= minutesOf(r.dailyTime) && shown.daily !== today) {
    return { kind: 'daily', title: 'Planea tu día', body: 'Elige el siguiente paso de tus metas y define lo importante de hoy.', route: '#/hoy' };
  }
  return null;
}

export function markReminderShown(shown = {}, kind, now = new Date()) {
  return { ...shown, [kind]: dateKey(now) };
}
