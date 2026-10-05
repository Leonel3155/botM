import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  AntiRaidLiftResponse,
  AntiRaidResponse,
  AntiRaidUpdateRequest,
  AntiRaidUpdateResponse,
  RaidEventResolveResponse,
} from "@shared/api";
import { apiRequest } from "@/lib/queryClient";
import { antiRaidKey, dashboardStatsKey, raidEventsKey } from "./query-keys";

/** PATCH /api/guilds/:guildId/antiraid: guarda solo lo que se manda y deja la respuesta en caché. */
export function useAntiRaidUpdate(guildId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: AntiRaidUpdateRequest) => {
      const res = await apiRequest("PATCH", `/api/guilds/${guildId}/antiraid`, body);
      return (await res.json()) as AntiRaidUpdateResponse;
    },
    onSuccess: ({ config, actions, activeRaid, liftedRaid }) => {
      queryClient.setQueryData<AntiRaidResponse>(antiRaidKey(guildId), { config, actions, activeRaid });
      void queryClient.invalidateQueries({ queryKey: dashboardStatsKey(guildId) });
      if (liftedRaid) void queryClient.invalidateQueries({ queryKey: raidEventsKey(guildId) });
    },
  });
}

/** POST /api/guilds/:guildId/antiraid/lift: termina ya el modo raid activo. */
export function useLiftRaid(guildId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/guilds/${guildId}/antiraid/lift`);
      return (await res.json()) as AntiRaidLiftResponse;
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: antiRaidKey(guildId) });
      void queryClient.invalidateQueries({ queryKey: raidEventsKey(guildId) });
      void queryClient.invalidateQueries({ queryKey: dashboardStatsKey(guildId) });
    },
  });
}

/** POST /api/guilds/:guildId/raid-events/:eventId/resolve: lo marca como revisado (y termina el raid si es el activo). */
export function useResolveRaidEvent(guildId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (eventId: string) => {
      const res = await apiRequest("POST", `/api/guilds/${guildId}/raid-events/${encodeURIComponent(eventId)}/resolve`);
      return (await res.json()) as RaidEventResolveResponse;
    },
    onSuccess: ({ liftedRaid }) => {
      void queryClient.invalidateQueries({ queryKey: raidEventsKey(guildId) });
      if (liftedRaid) {
        void queryClient.invalidateQueries({ queryKey: antiRaidKey(guildId) });
        void queryClient.invalidateQueries({ queryKey: dashboardStatsKey(guildId) });
      }
    },
  });
}
