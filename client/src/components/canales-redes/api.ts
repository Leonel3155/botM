import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type {
  ApiErrorBody,
  ChannelConfigResponse,
  ContentFeedsResponse,
  DiscordChannelsResponse,
} from "@shared/api";
import { isApiError, queryClient, queryKeyToPath } from "@/lib/queryClient";

/**
 * Claves de react-query de Canales y Redes sociales. Se arman como las del resto del
 * panel (["/api/...", guildId, ...]) para que los avisos del WebSocket las invaliden:
 * - settingsUpdated → todo lo que empieza por /api/guild/{id} y /api/guilds/{id}
 * - feedCreated → /api/social/{id}
 */
export const channelConfigKey = (guildId: string) => ["/api/guild", guildId, "channels"] as const;
export const discordChannelsKey = (guildId: string) => ["/api/guild", guildId, "discord-channels"] as const;
export const feedsKey = (guildId: string) => ["/api/social", guildId, "feeds"] as const;
/** Bienvenida y pregunta del día (la misma URL que usa la página de Comunidad). */
export const engagementKey = (guildId: string) => ["/api/guilds", guildId, "engagement"] as const;
/** Anti-raid (la misma URL que usa la página de Seguridad). */
export const antiRaidKey = (guildId: string) => ["/api/guilds", guildId, "antiraid"] as const;

/** GET /api/guild/:guildId/channels */
export function useChannelConfig(guildId: string) {
  return useQuery<ChannelConfigResponse>({
    queryKey: channelConfigKey(guildId),
    enabled: guildId !== "",
    staleTime: 60_000,
  });
}

/** GET /api/guild/:guildId/discord-channels (necesita que el bot esté en el servidor). */
export function useDiscordChannels(guildId: string) {
  return useQuery<DiscordChannelsResponse>({
    queryKey: discordChannelsKey(guildId),
    enabled: guildId !== "",
    staleTime: 5 * 60_000,
  });
}

/** GET /api/social/:guildId/feeds */
export function useContentFeeds(guildId: string) {
  return useQuery<ContentFeedsResponse>({
    queryKey: feedsKey(guildId),
    enabled: guildId !== "",
    staleTime: 60_000,
  });
}

/** Invalida todas las consultas cuya URL empieza por alguno de los prefijos. */
export function invalidatePaths(prefixes: string[]) {
  return queryClient.invalidateQueries({
    predicate: (query) => {
      const path = queryKeyToPath(query.queryKey);
      return prefixes.some(
        (prefix) => path === prefix || path.startsWith(`${prefix}/`) || path.startsWith(`${prefix}?`),
      );
    },
  });
}

/** Texto en español para un toast de error (el servidor ya manda sus mensajes en español). */
export function errorText(error: unknown, fallback = "Algo salió mal. Intenta de nuevo en un momento."): string {
  if (isApiError(error)) return error.message;
  return fallback;
}

/** Errores de validación por campo que manda el servidor en un 400. */
export function errorDetails(error: unknown): NonNullable<ApiErrorBody["details"]> {
  if (!isApiError(error)) return [];
  const details = error.body?.details;
  return Array.isArray(details)
    ? details.filter(
        (d): d is { field: string; message: string } =>
          !!d && typeof d.field === "string" && typeof d.message === "string",
      )
    : [];
}

/** Hora actual que se renueva cada `intervalMs` (para textos como "hace 5 minutos"). */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
