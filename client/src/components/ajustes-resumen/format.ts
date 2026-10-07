import { format, formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { MODERATION_ACTION_LABELS, type UserRef } from "@shared/api";

// Formatos compartidos por Resumen, Ajustes y Estadísticas (todo en español de México).

const numberFormat = new Intl.NumberFormat("es-MX");
const compactFormat = new Intl.NumberFormat("es-MX", { notation: "compact", maximumFractionDigits: 1 });

/** 12345 → "12,345". null / undefined → "—". */
export function formatNumber(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? numberFormat.format(value) : "—";
}

/** Para los ejes de las gráficas: 12345 → "12.3 k". */
export function formatCompact(value: number): string {
  return Number.isFinite(value) ? compactFormat.format(value) : "";
}

/**
 * El número grande de StatCard va en monoespaciada de 30 px (unos 18 px por carácter).
 * Con las filas de tarjetas en 2 columnas hasta xl, le quedan al menos ~150 px en
 * cualquier ancho: caben 8 caracteres ("123,456" sí; "1,234,567" ya no).
 */
const STAT_VALUE_MAX_CHARS = 8;

/**
 * Número para una StatCard: completo si cabe ("12,345"); si no, abreviado ("1.2 M")
 * y `full` con el número exacto para mostrarlo aparte. null / undefined → "—".
 */
export function formatStatNumber(value: number | null | undefined): { text: string; full: string | null } {
  const full = formatNumber(value);
  if (typeof value !== "number" || full.length <= STAT_VALUE_MAX_CHARS) return { text: full, full: null };
  return { text: formatCompact(value), full };
}

/** "1 persona" / "3 personas". */
export function plural(count: number, one: string, many: string): string {
  return `${formatNumber(count)} ${count === 1 ? one : many}`;
}

/** 18 → "18:00". */
export function formatHour(hour: number | null | undefined): string | null {
  if (typeof hour !== "number" || !Number.isInteger(hour) || hour < 0 || hour > 23) return null;
  return `${String(hour).padStart(2, "0")}:00`;
}

/** Segundos encendido → "2 d 5 h", "3 h 20 min", "12 min". */
export function formatUptime(seconds: number | null | undefined): string | null {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0) return null;
  if (seconds < 60) return "menos de un minuto";
  const totalMinutes = Math.floor(seconds / 60);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return hours > 0 ? `${days} d ${hours} h` : `${days} d`;
  if (hours > 0) return minutes > 0 ? `${hours} h ${minutes} min` : `${hours} h`;
  return `${minutes} min`;
}

/** Segundos de una sesión → "7 días", "12 horas", "30 minutos". */
export function formatDurationLong(seconds: number): string | null {
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const days = Math.round(seconds / 86_400);
  if (days >= 2) return plural(days, "día", "días");
  const hours = Math.round(seconds / 3_600);
  if (hours >= 1) return plural(hours, "hora", "horas");
  return plural(Math.max(1, Math.round(seconds / 60)), "minuto", "minutos");
}

/** Texto ISO → Date (null si falta o no es válido). */
export function parseIso(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** "hace 5 minutos" / "en 3 horas". */
export function relativeTime(date: Date): string {
  return formatDistanceToNow(date, { addSuffix: true, locale: es });
}

/**
 * "YYYY-MM-DD" (día en la zona del servidor) → Date a medianoche local, solo para
 * darle formato: así "2026-10-04" siempre se lee como 4 de octubre, sin corrimientos.
 */
export function parseLocalDay(value: string | null | undefined): Date | null {
  const match = value ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null;
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

/** "2026-10-04" → "4 oct" (ejes) o "sábado 4 de octubre" (largo). */
export function formatDay(value: string, style: "short" | "long" = "short"): string {
  const date = parseLocalDay(value);
  if (!date) return value;
  return style === "short"
    ? format(date, "d MMM", { locale: es }).replace(".", "")
    : format(date, "EEEE d 'de' MMMM", { locale: es });
}

/** Nombre para mostrar de un usuario de Discord (la base de datos puede no conocerlo). */
export function userName(user: Pick<UserRef, "id" | "username">): string {
  const name = user.username?.trim();
  return name || `Usuario #${user.id.slice(-4)}`;
}

/** Avatar de Discord (null si no tiene: se muestran sus iniciales). */
export function userAvatarSrc(user: Pick<UserRef, "id" | "avatar">, size = 64): string | null {
  if (!user.avatar || !/^\d{17,20}$/.test(user.id) || !/^(a_)?[0-9a-f]{32}$/i.test(user.avatar)) return null;
  return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=${size}`;
}

/** Nombre en español de un tipo de acción de moderación ("warn" → "Advertencia"). */
export function moderationLabel(type: string): string {
  return MODERATION_ACTION_LABELS[type] ?? type;
}
