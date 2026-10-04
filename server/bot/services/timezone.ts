// Utilidades de zona horaria basadas solo en Intl (sin dependencias extra)

export const DEFAULT_TIMEZONE = 'America/Mexico_City';

// Atajos en español para las zonas más comunes de la comunidad
const TIMEZONE_ALIASES: Record<string, string> = {
  'mexico': 'America/Mexico_City',
  'cdmx': 'America/Mexico_City',
  'ciudad de mexico': 'America/Mexico_City',
  'guadalajara': 'America/Mexico_City',
  'monterrey': 'America/Monterrey',
  'cancun': 'America/Cancun',
  'tijuana': 'America/Tijuana',
  'hermosillo': 'America/Hermosillo',
  'chihuahua': 'America/Chihuahua',
  'mazatlan': 'America/Mazatlan',
  'guatemala': 'America/Guatemala',
  'el salvador': 'America/El_Salvador',
  'honduras': 'America/Tegucigalpa',
  'nicaragua': 'America/Managua',
  'costa rica': 'America/Costa_Rica',
  'panama': 'America/Panama',
  'cuba': 'America/Havana',
  'republica dominicana': 'America/Santo_Domingo',
  'puerto rico': 'America/Puerto_Rico',
  'colombia': 'America/Bogota',
  'bogota': 'America/Bogota',
  'venezuela': 'America/Caracas',
  'caracas': 'America/Caracas',
  'ecuador': 'America/Guayaquil',
  'peru': 'America/Lima',
  'lima': 'America/Lima',
  'bolivia': 'America/La_Paz',
  'chile': 'America/Santiago',
  'santiago': 'America/Santiago',
  'argentina': 'America/Argentina/Buenos_Aires',
  'buenos aires': 'America/Argentina/Buenos_Aires',
  'uruguay': 'America/Montevideo',
  'paraguay': 'America/Asuncion',
  'espana': 'Europe/Madrid',
  'madrid': 'Europe/Madrid',
  'utc': 'UTC',
};

export interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number; // 0-23
  minute: number;
  second: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function getFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    formatterCache.set(timeZone, formatter);
  }
  return formatter;
}

function stripAccents(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Devuelve el nombre IANA canónico (p. ej. "America/Mexico_City") o null si no es válido
export function normalizeTimezone(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  const alias = TIMEZONE_ALIASES[stripAccents(trimmed).toLowerCase()];
  const candidate = alias || trimmed.replace(/\s+/g, '_');

  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: candidate }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

// Zona horaria guardada en la base de datos, o la predeterminada si falta o es inválida
export function resolveTimezone(timezone: string | null | undefined): string {
  return normalizeTimezone(timezone) || DEFAULT_TIMEZONE;
}

export function getZonedParts(date: Date, timeZone: string): ZonedParts {
  const values: Record<string, number> = {};
  for (const part of getFormatter(timeZone).formatToParts(date)) {
    if (part.type !== 'literal') values[part.type] = Number(part.value);
  }
  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: (values.hour ?? 0) % 24,
    minute: values.minute ?? 0,
    second: values.second ?? 0,
  };
}

const pad = (value: number) => String(value).padStart(2, '0');

// Fecha local "YYYY-MM-DD" en la zona indicada
export function getLocalDateString(date: Date, timeZone: string): string {
  const { year, month, day } = getZonedParts(date, timeZone);
  return `${year}-${pad(month)}-${pad(day)}`;
}

// Diferencia (ms) entre la hora local de la zona y UTC en ese instante
function getOffsetMs(date: Date, timeZone: string): number {
  const p = getZonedParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

// Convierte una fecha/hora local de una zona a un instante real. Devuelve null si esa hora
// no existe en la zona (p. ej. el salto de horario de verano).
export function zonedTimeToDate(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string
): Date | null {
  const naiveUtc = Date.UTC(year, month - 1, day, hour, minute);
  let timestamp = naiveUtc - getOffsetMs(new Date(naiveUtc), timeZone);
  const secondOffset = getOffsetMs(new Date(timestamp), timeZone);
  timestamp = naiveUtc - secondOffset;

  const result = new Date(timestamp);
  const check = getZonedParts(result, timeZone);
  if (
    check.year !== year ||
    check.month !== month ||
    check.day !== day ||
    check.hour !== hour ||
    check.minute !== minute
  ) {
    return null;
  }
  return result;
}

export type ParsedDateTime =
  | { ok: true; date: Date }
  | { ok: false; error: string };

// Acepta "AAAA-MM-DD HH:mm" (o "DD/MM/AAAA HH:mm") interpretado en la zona del servidor
export function parseLocalDateTime(input: string, timeZone: string): ParsedDateTime {
  const text = input.trim().replace(/\s+/g, ' ');
  let year: number, month: number, day: number, hour: number, minute: number;

  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})$/);
  const latam = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}) (\d{1,2}):(\d{2})$/);

  if (iso) {
    [year, month, day, hour, minute] = iso.slice(1).map(Number);
  } else if (latam) {
    [day, month, year, hour, minute] = latam.slice(1).map(Number);
  } else {
    return {
      ok: false,
      error: 'No entendí la fecha. Usa el formato `AAAA-MM-DD HH:mm`, por ejemplo `2026-10-31 20:00` (hora en formato 24 h).',
    };
  }

  if (month < 1 || month > 12) {
    return { ok: false, error: `El mes **${month}** no existe. Debe ir del 1 al 12.` };
  }
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day < 1 || day > daysInMonth) {
    return { ok: false, error: `Ese mes solo tiene ${daysInMonth} días; revisa el día **${day}**.` };
  }
  if (hour > 23 || minute > 59) {
    return { ok: false, error: 'La hora debe ir de `00:00` a `23:59` (formato 24 h, por ejemplo `20:30`).' };
  }

  const date = zonedTimeToDate(year, month, day, hour, minute, timeZone);
  if (!date) {
    return { ok: false, error: `Esa hora no existe en la zona **${timeZone}** (cambio de horario). Prueba con otra hora.` };
  }
  return { ok: true, date };
}

// Fecha y hora legibles en español, en la zona indicada
export function formatInTimezone(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('es-MX', {
    timeZone,
    dateStyle: 'full',
    timeStyle: 'short',
  }).format(date);
}
