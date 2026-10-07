// Utilidades compartidas por las páginas de Moderación y Seguridad.
import { useEffect, useState } from "react";
import { format, formatDistance, isValid, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import type { UserRef } from "@shared/api";
import { isApiError } from "@/lib/queryClient";

export const numberFormat = new Intl.NumberFormat("es-MX");

/** IDs de Discord (snowflakes): 17 a 20 dígitos. */
export const SNOWFLAKE_REGEX = /^\d{17,20}$/;

export function isSnowflake(value: string | null | undefined): value is string {
  return typeof value === "string" && SNOWFLAKE_REGEX.test(value);
}

// =============================================
// Fechas
// =============================================

/** Texto ISO o milisegundos → Date (null si falta o no es válida). */
export function parseDate(value: string | number | null | undefined): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const date = typeof value === "number" ? new Date(value) : parseISO(value);
  return isValid(date) ? date : null;
}

/** "hace 5 minutos" / "en 3 minutos" (respecto a `now`). */
export function formatRelative(date: Date, now: Date = new Date()): string {
  return formatDistance(date, now, { addSuffix: true, locale: es });
}

/** "4 de octubre de 2026, 18:05" en la hora de quien mira el panel. */
export function formatAbsolute(date: Date): string {
  return format(date, "d 'de' MMMM 'de' yyyy, HH:mm", { locale: es });
}

/** Duración en minutos → "10 min", "2 h", "1 h 30 min", "1 día"… */
export function formatMinutes(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return "0 min";
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = Math.round(minutes % 60);
  const parts: string[] = [];
  if (days) parts.push(days === 1 ? "1 día" : `${days} días`);
  if (hours) parts.push(`${hours} h`);
  if (mins) parts.push(`${mins} min`);
  return parts.join(" ");
}

/** Fecha "ahora" que se actualiza sola cada `intervalMs` (para textos relativos y cuentas atrás). */
export function useNow(intervalMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** El valor, pero solo después de que deje de cambiar durante `delayMs`. */
export function useDebouncedValue<T>(value: T, delayMs = 400): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

// =============================================
// Usuarios de Discord
// =============================================

/** Nombre para mostrar (el bot guarda el nombre de usuario cuando ve a la persona). */
export function userName(user: Pick<UserRef, "username">): string {
  return user.username?.trim() || "Usuario sin nombre guardado";
}

export function userAvatarUrl(user: Pick<UserRef, "id" | "avatar">, size = 64): string | null {
  if (!user.avatar || !isSnowflake(user.id)) return null;
  return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=${size}`;
}

// =============================================
// Errores de las acciones (toasts)
// =============================================

/** Texto para el toast de una acción que falló: el mensaje del servidor (ya viene en español). */
export function describeMutationError(error: unknown): string {
  if (!isApiError(error)) return "Intenta de nuevo en un momento.";

  const details = error.body?.details;
  if (error.kind === "validation" && Array.isArray(details) && details.length > 1) {
    const messages = Array.from(new Set(details.map((detail) => detail.message).filter(Boolean)));
    if (messages.length > 0) return messages.join(" ");
  }

  const retryAfter = error.body?.retryAfterSeconds;
  if (error.status === 429 && typeof retryAfter === "number" && !error.message.includes(`${retryAfter} s`)) {
    return `${error.message} Espera ${retryAfter} s.`;
  }

  return error.message;
}
