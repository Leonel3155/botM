// Horas y zonas horarias para la pregunta del día. Solo Intl, igual que el bot:
// la lógica copia server/bot/services/timezone.ts y nextDailyQuestionAt() de server/routes/helpers.ts
// para poder calcular la próxima pregunta con cambios que todavía no se guardan.

/** Las 24 horas del día (lo que acepta el bot: hora local 0-23). */
export const HOURS_OF_DAY: readonly number[] = Array.from({ length: 24 }, (_, hour) => hour);

const pad = (value: number) => String(value).padStart(2, "0");

/** 18 → "6:00 p. m." (siempre igual, sin depender del navegador). */
export function formatHour12(hour: number, minute = 0): string {
  const h = ((hour % 24) + 24) % 24;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${pad(minute)} ${h < 12 ? "a. m." : "p. m."}`;
}

/** "a las 6:00 p. m." / "a la 1:00 p. m." */
export function atHour12(hour: number, minute = 0): string {
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12 === 1 ? "a la" : "a las"} ${formatHour12(hour, minute)}`;
}

/** Texto de apoyo para cada hora: "18:00 · tarde". */
export function hourHint(hour: number): string {
  let period: string;
  if (hour === 0) period = "medianoche";
  else if (hour < 6) period = "madrugada";
  else if (hour < 12) period = "mañana";
  else if (hour === 12) period = "mediodía";
  else if (hour < 20) period = "tarde";
  else period = "noche";
  return `${pad(hour)}:00 · ${period}`;
}

// =============================================
// Zonas horarias
// =============================================

export interface TimezoneOption {
  /** Nombre IANA que se manda al servidor. */
  id: string;
  label: string;
  /** Nombre corto para frases ("hora de México, centro"); si falta, se usa label. */
  short?: string;
}

export interface TimezoneGroup {
  label: string;
  options: TimezoneOption[];
}

/** Zonas más comunes de la comunidad (Latinoamérica, España y EE. UU.). */
export const TIMEZONE_GROUPS: TimezoneGroup[] = [
  {
    label: "México",
    options: [
      { id: "America/Mexico_City", label: "México · Centro (CDMX, Guadalajara, Monterrey)", short: "México, centro" },
      { id: "America/Cancun", label: "México · Quintana Roo (Cancún)", short: "Cancún" },
      { id: "America/Mazatlan", label: "México · Pacífico (Sinaloa, Nayarit, BCS)", short: "México, Pacífico" },
      { id: "America/Hermosillo", label: "México · Sonora", short: "Sonora" },
      { id: "America/Tijuana", label: "México · Baja California (Tijuana)", short: "Tijuana" },
    ],
  },
  {
    label: "Centroamérica y el Caribe",
    options: [
      { id: "America/Guatemala", label: "Guatemala" },
      { id: "America/El_Salvador", label: "El Salvador" },
      { id: "America/Tegucigalpa", label: "Honduras" },
      { id: "America/Managua", label: "Nicaragua" },
      { id: "America/Costa_Rica", label: "Costa Rica" },
      { id: "America/Panama", label: "Panamá" },
      { id: "America/Havana", label: "Cuba" },
      { id: "America/Santo_Domingo", label: "República Dominicana" },
      { id: "America/Puerto_Rico", label: "Puerto Rico" },
    ],
  },
  {
    label: "Sudamérica",
    options: [
      { id: "America/Bogota", label: "Colombia" },
      { id: "America/Caracas", label: "Venezuela" },
      { id: "America/Guayaquil", label: "Ecuador" },
      { id: "America/Lima", label: "Perú" },
      { id: "America/La_Paz", label: "Bolivia" },
      { id: "America/Santiago", label: "Chile" },
      { id: "America/Argentina/Buenos_Aires", label: "Argentina" },
      { id: "America/Montevideo", label: "Uruguay" },
      { id: "America/Asuncion", label: "Paraguay" },
    ],
  },
  {
    label: "España",
    options: [
      { id: "Europe/Madrid", label: "España · Península y Baleares", short: "España" },
      { id: "Atlantic/Canary", label: "España · Canarias", short: "Canarias" },
    ],
  },
  {
    label: "Estados Unidos",
    options: [
      { id: "America/New_York", label: "EE. UU. · Este (Nueva York, Miami)", short: "EE. UU., este" },
      { id: "America/Chicago", label: "EE. UU. · Centro (Chicago, Houston)", short: "EE. UU., centro" },
      { id: "America/Denver", label: "EE. UU. · Montaña (Denver)", short: "EE. UU., montaña" },
      { id: "America/Los_Angeles", label: "EE. UU. · Pacífico (Los Ángeles)", short: "EE. UU., Pacífico" },
    ],
  },
  {
    label: "Otra",
    options: [{ id: "UTC", label: "UTC (hora universal)", short: "UTC" }],
  },
];

const canonicalCache = new Map<string, string | null>();

/**
 * Nombre canónico de la zona según el navegador, o null si no es válida.
 * (El servidor guarda el canónico: "America/Argentina/Buenos_Aires" puede volver como "America/Buenos_Aires".)
 */
export function canonicalTimezone(timeZone: string | null | undefined): string | null {
  if (!timeZone) return null;
  if (canonicalCache.has(timeZone)) return canonicalCache.get(timeZone) ?? null;
  let canonical: string | null;
  try {
    canonical = new Intl.DateTimeFormat("en-US", { timeZone }).resolvedOptions().timeZone;
  } catch {
    canonical = null;
  }
  canonicalCache.set(timeZone, canonical);
  return canonical;
}

/** ¿Las dos son la misma zona (aunque se escriban distinto)? */
export function sameTimezone(a: string | null | undefined, b: string | null | undefined): boolean {
  if (a === b) return true;
  const canonicalA = canonicalTimezone(a);
  return canonicalA !== null && canonicalA === canonicalTimezone(b);
}

/** Opción de la lista que corresponde a esa zona (si está en la lista). */
export function findTimezoneOption(timeZone: string | null | undefined): TimezoneOption | undefined {
  if (!timeZone) return undefined;
  for (const group of TIMEZONE_GROUPS) {
    const option = group.options.find((candidate) => sameTimezone(candidate.id, timeZone));
    if (option) return option;
  }
  return undefined;
}

/** Nombre amable de la zona ("Colombia"), o el nombre IANA si no está en la lista. */
export function timezoneLabel(timeZone: string): string {
  return findTimezoneOption(timeZone)?.label ?? timeZone;
}

/** Nombre corto para frases ("México, centro", "Colombia"), o el nombre IANA si no está en la lista. */
export function timezoneShortLabel(timeZone: string): string {
  const option = findTimezoneOption(timeZone);
  return option ? option.short ?? option.label : timeZone;
}

/** Zona horaria del navegador de quien mira el panel. */
export function viewerTimezone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

// =============================================
// Fechas en una zona
// =============================================

interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number; // 0-23
  minute: number;
  second: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function getFormatter(timeZone: string): Intl.DateTimeFormat | null {
  const cached = formatterCache.get(timeZone);
  if (cached) return cached;
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    formatterCache.set(timeZone, formatter);
    return formatter;
  } catch {
    return null;
  }
}

function getZonedParts(date: Date, timeZone: string): ZonedParts | null {
  const formatter = getFormatter(timeZone);
  if (!formatter) return null;
  const values: Record<string, number> = {};
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== "literal") values[part.type] = Number(part.value);
  }
  if (!Number.isFinite(values.year) || !Number.isFinite(values.month) || !Number.isFinite(values.day)) return null;
  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: (values.hour ?? 0) % 24,
    minute: values.minute ?? 0,
    second: values.second ?? 0,
  };
}

function dateKey(parts: Pick<ZonedParts, "year" | "month" | "day">): string {
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

function getOffsetMs(date: Date, timeZone: string): number | null {
  const p = getZonedParts(date, timeZone);
  if (!p) return null;
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** Fecha/hora local de una zona → instante real (null si esa hora no existe por el cambio de horario). */
function zonedTimeToDate(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): Date | null {
  const naiveUtc = Date.UTC(year, month - 1, day, hour, minute);
  const firstOffset = getOffsetMs(new Date(naiveUtc), timeZone);
  if (firstOffset === null) return null;
  const secondOffset = getOffsetMs(new Date(naiveUtc - firstOffset), timeZone);
  if (secondOffset === null) return null;

  const result = new Date(naiveUtc - secondOffset);
  const check = getZonedParts(result, timeZone);
  if (!check || check.year !== year || check.month !== month || check.day !== day || check.hour !== hour || check.minute !== minute) {
    return null;
  }
  return result;
}

interface NextQuestionInput {
  enabled: boolean;
  channelId: string | null;
  hour: number;
  timezone: string;
  /** YYYY-MM-DD en la zona del servidor */
  lastPosted: string | null;
}

/**
 * Cuándo sale la próxima pregunta, con la misma regla que el bot: a la hora elegida si hoy
 * aún no hubo pregunta; si ya pasó la hora y no ha salido, sale en el próximo minuto (devuelve `now`).
 * null si está apagada, sin canal o no se puede calcular.
 */
export function computeNextDailyQuestion(input: NextQuestionInput, now: Date = new Date()): Date | null {
  if (!input.enabled || !input.channelId) return null;
  if (!Number.isInteger(input.hour) || input.hour < 0 || input.hour > 23) return null;
  const local = getZonedParts(now, input.timezone);
  if (!local) return null;

  const postedToday = input.lastPosted === dateKey(local);
  if (!postedToday && local.hour >= input.hour) return now;

  const day = new Date(Date.UTC(local.year, local.month - 1, local.day + (postedToday ? 1 : 0)));
  for (let candidate = input.hour; candidate <= 23; candidate++) {
    const at = zonedTimeToDate(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), candidate, 0, input.timezone);
    if (at) return at;
  }
  return null;
}

// =============================================
// Textos de fechas
// =============================================

const WEEKDAYS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MONTHS = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

function calendarLabel(year: number, month: number, day: number, currentYear: number): string {
  const weekday = WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  return `${weekday} ${day} de ${MONTHS[month - 1]}${year !== currentYear ? ` de ${year}` : ""}`;
}

function dayDifference(a: Pick<ZonedParts, "year" | "month" | "day">, b: Pick<ZonedParts, "year" | "month" | "day">): number {
  return Math.round((Date.UTC(a.year, a.month - 1, a.day) - Date.UTC(b.year, b.month - 1, b.day)) / 86_400_000);
}

/** "hoy a las 6:00 p. m.", "mañana a la 1:00 p. m.", "el lunes 6 de octubre a las 9:00 a. m." */
export function describeMoment(date: Date, timeZone: string, now: Date = new Date()): string | null {
  const target = getZonedParts(date, timeZone);
  const today = getZonedParts(now, timeZone);
  if (!target || !today) return null;
  const at = atHour12(target.hour, target.minute);
  const diff = dayDifference(target, today);
  if (diff === 0) return `hoy ${at}`;
  if (diff === 1) return `mañana ${at}`;
  if (diff === -1) return `ayer ${at}`;
  return `el ${calendarLabel(target.year, target.month, target.day, today.year)} ${at}`;
}

/** Día "YYYY-MM-DD" (en la zona del servidor) → "hoy", "ayer" o "el sábado 4 de octubre". */
export function describeLocalDay(value: string, timeZone: string, now: Date = new Date()): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const today = getZonedParts(now, timeZone);
  if (!today) return null;
  const diff = dayDifference({ year, month, day }, today);
  if (diff === 0) return "hoy";
  if (diff === -1) return "ayer";
  return `el ${calendarLabel(year, month, day, today.year)}`;
}

/**
 * Hora actual en esa zona como frase ("son las 6:04 p. m.", "es la 1:15 p. m."), para ayudar a
 * elegir la zona correcta. Termina en "m.", así que no hace falta otro punto detrás.
 */
export function currentTimePhrase(timeZone: string, now: Date = new Date()): string | null {
  const parts = getZonedParts(now, timeZone);
  if (!parts) return null;
  const h12 = parts.hour % 12 === 0 ? 12 : parts.hour % 12;
  return `${h12 === 1 ? "es la" : "son las"} ${formatHour12(parts.hour, parts.minute)}`;
}

/**
 * Si quien mira el panel está en otra zona (con otra hora), el mismo momento en su hora local.
 * null si es la misma hora o no se puede saber.
 */
export function describeInViewerZone(date: Date, serverTimezone: string, now: Date = new Date()): string | null {
  const viewer = viewerTimezone();
  if (!viewer || sameTimezone(viewer, serverTimezone)) return null;
  const inServer = getZonedParts(date, serverTimezone);
  const inViewer = getZonedParts(date, viewer);
  if (!inServer || !inViewer) return null;
  if (dateKey(inServer) === dateKey(inViewer) && inServer.hour === inViewer.hour && inServer.minute === inViewer.minute) {
    return null;
  }
  return describeMoment(date, viewer, now);
}

/** Hora local de quien mira, para la vista previa ("Hoy a las 6:04 p. m."). */
export function formatLocalTime(date: Date): string {
  return formatHour12(date.getHours(), date.getMinutes());
}
