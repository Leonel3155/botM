import { useEffect, useRef } from "react";
import { useIsFetching, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import type { AntiRaidResponse } from "@shared/api";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiErrorState } from "@/components/api-error-state";
import { PageHeader } from "@/components/page-header";
import { ActiveRaidBanner } from "@/components/moderacion-seguridad/active-raid-banner";
import { AntiRaidHelp } from "@/components/moderacion-seguridad/antiraid-help";
import { AntiRaidSettingsForm } from "@/components/moderacion-seguridad/antiraid-settings-form";
import { AntiRaidStatusCard } from "@/components/moderacion-seguridad/antiraid-status-card";
import {
  antiRaidKey,
  dashboardStatsKey,
  raidEventsKey,
} from "@/components/moderacion-seguridad/query-keys";
import { RaidEventsTimeline } from "@/components/moderacion-seguridad/raid-events-timeline";
import { useNow } from "@/components/moderacion-seguridad/utils";
import { useSelectedGuild } from "@/lib/guild";
import { cn } from "@/lib/utils";

function SecuritySkeleton() {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3" aria-busy="true" aria-label="Cargando la protección anti-raid">
      <div className="space-y-6 lg:col-span-2">
        <Skeleton className="h-44 rounded-xl" />
        <Skeleton className="h-[32rem] rounded-xl" />
      </div>
      <Skeleton className="h-96 rounded-xl" />
    </div>
  );
}

/**
 * Seguridad: protección anti-raid (GET/PATCH /api/guilds/:guildId/antiraid), modo raid activo
 * (POST .../antiraid/lift) e historial de raids (GET .../raid-events, POST .../resolve).
 */
export default function Seguridad() {
  const { guildId, guild } = useSelectedGuild();
  const queryClient = useQueryClient();
  const now = useNow(15_000);
  const botInGuild = guild?.botInGuild ?? true;

  const antiRaid = useQuery<AntiRaidResponse>({
    queryKey: antiRaidKey(guildId),
    staleTime: 10_000,
    refetchOnWindowFocus: true,
    // El bot no avisa al panel cuando detecta un raid: revisamos cada minuto (y más seguido en pleno raid)
    refetchInterval: (query) => (query.state.data?.activeRaid ? 15_000 : 60_000),
  });

  // Si empieza o termina un modo raid entre revisiones, el historial y los totales también cambiaron
  const raidMarker = antiRaid.data ? antiRaid.data.activeRaid?.startedAt ?? "sin-raid" : null;
  const previousMarker = useRef<string | null>(raidMarker);
  useEffect(() => {
    if (raidMarker === null) return;
    if (previousMarker.current !== null && previousMarker.current !== raidMarker) {
      void queryClient.invalidateQueries({ queryKey: raidEventsKey(guildId) });
      void queryClient.invalidateQueries({ queryKey: dashboardStatsKey(guildId) });
    }
    previousMarker.current = raidMarker;
  }, [raidMarker, guildId, queryClient]);

  const fetchingEvents = useIsFetching({ queryKey: raidEventsKey(guildId) });
  const refreshing = antiRaid.isFetching || fetchingEvents > 0;

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: antiRaidKey(guildId) });
    void queryClient.invalidateQueries({ queryKey: raidEventsKey(guildId) });
    void queryClient.invalidateQueries({ queryKey: dashboardStatsKey(guildId) });
  };

  const data = antiRaid.data;
  const activeRaidLabel = data?.activeRaid
    ? data.actions.find((action) => action.value === data.activeRaid?.action)?.label ?? data.activeRaid.action
    : "";

  return (
    <div className="space-y-8">
      <PageHeader
        title="Seguridad"
        description="Protege tu servidor de los raids: cuando muchas cuentas entran de golpe para llenarlo todo de spam."
        actions={
          <Button variant="outline" onClick={refresh} disabled={refreshing} data-testid="button-refresh-security">
            <RefreshCw className={cn(refreshing && "animate-spin")} />
            Actualizar
          </Button>
        }
      />

      {antiRaid.isLoading ? (
        <SecuritySkeleton />
      ) : !data ? (
        <ApiErrorState error={antiRaid.error} onRetry={() => void antiRaid.refetch()} />
      ) : (
        <>
          {data.activeRaid && (
            <ActiveRaidBanner guildId={guildId} raid={data.activeRaid} actionLabel={activeRaidLabel} now={now} />
          )}

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <div className="min-w-0 space-y-6 lg:col-span-2">
              <AntiRaidStatusCard guildId={guildId} data={data} botInGuild={botInGuild} />
              <AntiRaidSettingsForm guildId={guildId} data={data} botInGuild={botInGuild} />
            </div>
            <div className="min-w-0 lg:self-start">
              <AntiRaidHelp />
            </div>
          </div>
        </>
      )}

      {/* Si el anti-raid no cargó (sin permisos, sesión caducada…), el historial fallaría igual */}
      {(antiRaid.isLoading || data) && <RaidEventsTimeline guildId={guildId} actions={data?.actions ?? []} />}
    </div>
  );
}
