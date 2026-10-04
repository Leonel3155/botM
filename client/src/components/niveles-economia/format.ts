import { isApiError } from "@/lib/queryClient";

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

/** Texto para un toast de error al guardar (usa el mensaje del servidor, que ya viene en español). */
export function mutationErrorToast(error: unknown): { title: string; description: string } {
  if (!isApiError(error)) {
    return { title: "No se pudo guardar", description: "Intenta de nuevo en un momento." };
  }
  if (error.status === 429) {
    const retry = error.body?.retryAfterSeconds;
    const seconds = typeof retry === "number" && retry > 0 ? Math.ceil(retry) : null;
    const text = error.message;
    return {
      title: "Espera un momento",
      description: seconds && !/\d/.test(text) ? `${text} Podrás intentarlo en ${seconds} s.` : text,
    };
  }
  const details = Array.isArray(error.body?.details)
    ? error.body.details.map((d) => d?.message).filter((m): m is string => typeof m === "string" && m.length > 0)
    : [];
  return {
    title: "No se pudo guardar",
    description: details.length > 0 ? details.join(" ") : error.message,
  };
}
