import { getApiErrorInfo, isApiError, type ApiError } from "@/lib/queryClient";

const numberFormat = new Intl.NumberFormat("es-MX");
const compactFormat = new Intl.NumberFormat("es-MX", { notation: "compact", maximumFractionDigits: 1 });

export function formatNumber(value: number): string {
  return numberFormat.format(Math.floor(value));
}

/** "1 moneda" / "1,500 monedas" (igual que el bot). */
export function formatCoins(value: number): string {
  const n = Math.floor(value);
  return `${numberFormat.format(n)} ${Math.abs(n) === 1 ? "moneda" : "monedas"}`;
}

/** Números grandes en corto para las tarjetas: 1.2 M, 35.4 mil… (completo si es pequeño). */
export function formatCompact(value: number): string {
  return Math.abs(value) < 100_000 ? formatNumber(value) : compactFormat.format(value);
}

/** Segundos de espera que manda el servidor: retryAfterSeconds (429) o retryAfter (503, Discord limitando). */
function retrySeconds(error: ApiError): number | null {
  const raw = error.status === 429 ? error.body?.retryAfterSeconds : error.status === 503 ? error.body?.retryAfter : null;
  return typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? Math.ceil(raw) : null;
}

/**
 * Texto para un toast de error al guardar. Usa el mensaje del servidor (ya viene en español)
 * y, si el servidor dice cuánto esperar, lo agrega.
 */
export function mutationErrorToast(error: unknown): { title: string; description: string } {
  if (!isApiError(error)) {
    return { title: "No se pudo guardar", description: "Intenta de nuevo en un momento." };
  }

  // 400: errores de validación por campo
  if (error.kind === "validation") {
    const details = Array.isArray(error.body?.details)
      ? error.body.details.map((d) => d?.message).filter((m): m is string => typeof m === "string" && m.length > 0)
      : [];
    return { title: "No se pudo guardar", description: details.length > 0 ? details.join(" ") : error.message };
  }

  const info = getApiErrorInfo(error);
  const seconds = retrySeconds(error);
  const waitText = seconds && !/\d/.test(info.description) ? ` Podrás intentarlo en ${seconds} s.` : "";

  // 429 del panel, o 503 porque Discord está limitando las solicitudes (trae retryAfter)
  const rateLimited = error.status === 429 || (error.status === 503 && error.body !== null && "retryAfter" in error.body);
  if (rateLimited) {
    return { title: "Espera un momento", description: `${info.description}${waitText}` };
  }

  // Sesión, permisos, bot ausente o caído, sin conexión: el título amable dice qué pasó
  const generic = error.kind === "server" || error.kind === "notFound";
  return {
    title: "No se pudo guardar",
    description: generic ? `${info.description}${waitText}` : `${info.title}. ${info.description}${waitText}`,
  };
}
