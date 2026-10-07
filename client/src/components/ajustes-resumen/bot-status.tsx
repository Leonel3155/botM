import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import type { DashboardStatsResponse } from "@shared/api";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusIndicator, type StatusKind } from "@/components/status-indicator";
import { formatUptime } from "./format";

/**
 * Clave de GET /api/dashboard/:guildId/stats. Empieza por "/api/dashboard/<id>",
 * así el aviso "settingsUpdated" del tiempo real la invalida (ver lib/websocket.ts).
 */
export function dashboardStatsKey(guildId: string) {
  return ["/api/dashboard", guildId, "stats"] as const;
}

/** Resumen del servidor (lo comparten Resumen y Ajustes: una sola petición en caché). */
export function useDashboardStats(guildId: string) {
  return useQuery<DashboardStatsResponse>({
    queryKey: dashboardStatsKey(guildId),
    enabled: !!guildId,
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
}

export interface BotStatusInfo {
  status: StatusKind;
  label: string;
  /** Explicación corta para la persona (null si todo va bien). */
  hint: string | null;
}

/** Estado del bot en este servidor, a partir de la respuesta del resumen. */
export function getBotStatus(
  stats: DashboardStatsResponse | undefined,
  { loading, failed }: { loading: boolean; failed: boolean },
): BotStatusInfo {
  if (loading) return { status: "pending", label: "Comprobando…", hint: null };
  if (!stats) {
    return failed
      ? { status: "warning", label: "No pudimos comprobarlo", hint: null }
      : { status: "pending", label: "Comprobando…", hint: null };
  }
  if (!stats.bot.online) {
    return {
      status: "error",
      label: "Desconectado de Discord",
      hint: "El bot no está conectado ahora mismo. Si se acaba de reiniciar, espera unos segundos y actualiza.",
    };
  }
  if (!stats.bot.inGuild) {
    return {
      status: "offline",
      label: "No está en este servidor",
      hint: "Invítalo para que salude, haga preguntas y cuide tu servidor.",
    };
  }
  return { status: "online", label: "En línea", hint: null };
}

/**
 * ¿Puede el bot recibir cambios de configuración ahora? Las rutas que guardan
 * necesitan al bot conectado (si no, 503) y dentro del servidor (si no, 404).
 * - ready: conectado y en el servidor
 * - offline: desconectado de Discord (p. ej. reiniciándose): no sabemos si está en el servidor
 * - missing: hay que invitarlo
 * - checking: aún no lo sabemos
 */
export type BotPresence = "ready" | "offline" | "missing" | "checking";

export function getBotPresence(
  stats: DashboardStatsResponse | undefined,
  { loading, listBotInGuild }: { loading: boolean; listBotInGuild: boolean },
): BotPresence {
  if (stats) {
    if (!stats.bot.online) return "offline";
    return stats.bot.inGuild ? "ready" : "missing";
  }
  // Sin el resumen usamos la lista de servidores (dice false también si el bot está desconectado)
  if (listBotInGuild) return "ready";
  return loading ? "checking" : "missing";
}

/** Qué tan buena es la latencia con Discord. */
export function pingQuality(ms: number): { status: StatusKind; label: string } {
  if (ms < 250) return { status: "success", label: "buena" };
  if (ms < 600) return { status: "warning", label: "algo lenta" };
  return { status: "error", label: "lenta" };
}

/** Fila "etiqueta → valor" de las tarjetas de detalle. */
export function DetailRow({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <span className="text-sm text-muted-foreground">{label}</span>
      <div className="min-w-0 text-sm text-foreground sm:text-right">{children}</div>
    </div>
  );
}

interface BotDetailsProps {
  stats: DashboardStatsResponse | undefined;
  loading: boolean;
  failed: boolean;
}

/** Filas con el estado, la latencia y el tiempo encendido del bot. */
export function BotDetailRows({ stats, loading, failed }: BotDetailsProps) {
  const botStatus = getBotStatus(stats, { loading, failed });
  const ping = stats?.bot.online ? stats.bot.pingMs : null;
  const quality = typeof ping === "number" ? pingQuality(ping) : null;
  const uptime = stats?.bot.online ? formatUptime(stats.bot.uptimeSeconds) : null;
  const placeholder = loading ? <Skeleton className="h-4 w-20 sm:ml-auto" /> : <span className="text-muted-foreground">—</span>;

  return (
    <>
      <DetailRow label="Bot en este servidor">
        <StatusIndicator status={botStatus.status} label={botStatus.label} className="sm:justify-end" testId="status-bot" />
      </DetailRow>
      <DetailRow label="Latencia con Discord">
        {typeof ping === "number" && quality ? (
          <span className="inline-flex items-center gap-3">
            <span className="font-mono">{ping} ms</span>
            <StatusIndicator status={quality.status} label={quality.label} />
          </span>
        ) : stats?.bot.online ? (
          <span className="text-muted-foreground">Aún sin medir</span>
        ) : (
          placeholder
        )}
      </DetailRow>
      <DetailRow label="Encendido desde hace">
        {uptime ? <span className="font-mono">{uptime}</span> : placeholder}
      </DetailRow>
    </>
  );
}
