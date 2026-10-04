import { useEffect, useState } from "react";
import { ToastAction, type ToastActionElement } from "@/components/ui/toast";
import { isApiError } from "@/lib/queryClient";

/** Segundos que pide esperar un 429 de las acciones de prueba (null si no es eso). */
export function retryAfterSecondsFrom(error: unknown): number | null {
  if (!isApiError(error) || error.status !== 429) return null;
  const seconds = error.body?.retryAfterSeconds;
  return typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : null;
}

/** Cuenta atrás para no repetir una acción antes de tiempo (la marca el servidor con 429). */
export function useCooldown() {
  const [until, setUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (until <= Date.now()) return;
    const timer = window.setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= until) window.clearInterval(timer);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [until]);

  const remaining = Math.max(0, Math.ceil((until - now) / 1000));
  return {
    remaining,
    start: (seconds: number) => {
      const current = Date.now();
      setNow(current);
      setUntil(current + seconds * 1000);
    },
  };
}

/** La hora actual, refrescada cada `intervalMs` (para textos como "en 2 horas"). */
export function useNow(intervalMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/** Solo enlaces de Discord (lo que devuelve el bot como messageUrl). */
function safeDiscordUrl(url: unknown): string | null {
  if (typeof url !== "string") return null;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname;
    const isDiscord = host === "discord.com" || host.endsWith(".discord.com");
    return parsed.protocol === "https:" && isDiscord ? parsed.toString() : null;
  } catch {
    return null;
  }
}

/** Botón "Ver en Discord" para los avisos de éxito (undefined si el enlace no es de Discord). */
export function discordLinkAction(url: unknown): ToastActionElement | undefined {
  const safe = safeDiscordUrl(url);
  if (!safe) return undefined;
  return (
    <ToastAction altText="Abrir el mensaje en Discord" asChild>
      <a href={safe} target="_blank" rel="noopener noreferrer">
        Ver en Discord
      </a>
    </ToastAction>
  );
}
