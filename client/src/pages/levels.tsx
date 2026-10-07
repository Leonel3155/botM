import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { BarChart3, Megaphone, RefreshCw, Rocket, Trophy, Users } from "lucide-react";
import type { AnalyticsResponse, LevelsTopResponse } from "@shared/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiErrorState } from "@/components/api-error-state";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { ConfigToggle, useGuildConfig } from "@/components/niveles-economia/guild-config";
import { formatNumber } from "@/components/niveles-economia/format";
import { LevelDistributionChart } from "@/components/niveles-economia/level-distribution-chart";
import { LevelLeaderboard } from "@/components/niveles-economia/level-leaderboard";
import { PRESTIGE_MIN_LEVEL, XP_COOLDOWN_SECONDS } from "@/components/niveles-economia/level-math";
import { RankingSkeleton, TopLimitSelect, displayUserName, type TopLimit } from "@/components/niveles-economia/ranking-parts";
import { XpRulesCard } from "@/components/niveles-economia/xp-rules";
import { useSelectedGuild } from "@/lib/guild";
import { cn } from "@/lib/utils";

export default function Levels() {
  const { guildId } = useSelectedGuild();
  const [limit, setLimit] = useState<TopLimit>(10);

  // Ranking: GET /api/levels/:guildId/top?limit=N (ordenado por nivel y luego XP)
  const topQuery = useQuery<LevelsTopResponse>({
    queryKey: ["/api/levels", guildId, `top?limit=${limit}`],
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });

  // Totales y distribución por nivel (solo datos de la base de datos)
  const analyticsQuery = useQuery<AnalyticsResponse>({
    queryKey: ["/api/guilds", guildId, "analytics"],
    staleTime: 60_000,
  });

  // Prefijo real (para los comandos) y si la economía está activada
  const configQuery = useGuildConfig(guildId);

  const refreshAll = () => {
    void topQuery.refetch();
    void analyticsQuery.refetch();
    void configQuery.refetch();
  };
  const refreshing = topQuery.isFetching || analyticsQuery.isFetching;

  const top = topQuery.data ?? [];
  const leader = top[0];
  const analytics = analyticsQuery.data;
  const buckets = analytics?.levelDistribution ?? [];
  const prestigeReady = buckets
    .filter((bucket) => bucket.minLevel >= PRESTIGE_MIN_LEVEL)
    .reduce((sum, bucket) => sum + bucket.users, 0);
  const hasDistribution = buckets.some((bucket) => bucket.users > 0);
  const prefix = configQuery.data?.prefix ?? "&";
  const statsUnavailable = analyticsQuery.isError;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Niveles"
        description="La gente gana XP al platicar y sube de nivel. Aquí ves quién va a la cabeza."
        actions={
          <Button variant="outline" onClick={refreshAll} disabled={refreshing} data-testid="button-refresh-levels">
            <RefreshCw className={cn(refreshing && "animate-spin")} />
            Actualizar
          </Button>
        }
      />

      {/* Números reales */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
        <StatCard
          title="Personas con nivel"
          icon={Users}
          loading={analyticsQuery.isLoading}
          value={analytics ? formatNumber(analytics.totals.usersWithLevels) : "—"}
          subtitle={statsUnavailable ? "No se pudo cargar ahora" : "Han ganado XP en este servidor"}
          testId="stat-users-with-levels"
        />
        <StatCard
          title="Nivel más alto"
          icon={Trophy}
          loading={topQuery.isLoading}
          value={leader ? formatNumber(leader.level) : "—"}
          subtitle={
            leader
              ? leader.username
                ? `Lo tiene ${displayUserName(leader.username)}`
                : "Lo tiene alguien de quien aún no guardamos el nombre"
              : topQuery.isError
                ? "No se pudo cargar ahora"
                : "Aún nadie tiene XP"
          }
          testId="stat-top-level"
        />
        <StatCard
          title="Listos para prestigio"
          icon={Rocket}
          loading={analyticsQuery.isLoading}
          value={analytics ? formatNumber(prestigeReady) : "—"}
          subtitle={
            statsUnavailable
              ? "No se pudo cargar ahora"
              : `Nivel ${PRESTIGE_MIN_LEVEL} o más: ya pueden usar /prestige`
          }
          testId="stat-prestige-ready"
        />
      </div>

      {/* Ajuste que el bot sí usa */}
      <Card>
        <CardHeader className="p-4 sm:p-6">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Megaphone className="h-5 w-5 text-primary" aria-hidden="true" />
            Avisos en el chat
          </CardTitle>
          <CardDescription>
            Felicitar en público anima a la gente a seguir participando, sin que tengas que escribir nada.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-4 pt-0 sm:p-6 sm:pt-0">
          <ConfigToggle
            field="levelUpMessages"
            id="toggle-level-up-messages"
            label="Anunciar subidas de nivel"
            description={
              <>
                Cuando alguien sube de nivel, el bot lo felicita en el canal donde escribió (con su premio, si la
                economía está activada). Si lo apagas, se sigue ganando XP y premios, pero el bot no publica nada en
                el chat.
              </>
            }
            savedOn="Listo: el bot anunciará las subidas de nivel"
            savedOff="Listo: el bot ya no anunciará las subidas de nivel"
          />
        </CardContent>
      </Card>

      {/* Ranking + distribución */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader className="flex flex-col gap-3 space-y-0 p-4 sm:flex-row sm:items-start sm:justify-between sm:p-6">
            <div className="space-y-1.5">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Trophy className="h-5 w-5 text-primary" aria-hidden="true" />
                Ranking de niveles
              </CardTitle>
              <CardDescription>El mismo orden que /lb en Discord: primero el nivel y luego la XP.</CardDescription>
            </div>
            <TopLimitSelect id="levels-limit" value={limit} onChange={setLimit} />
          </CardHeader>
          <CardContent
            className={cn("p-4 pt-0 sm:p-6 sm:pt-0", topQuery.isPlaceholderData && "opacity-60 transition-opacity")}
            aria-busy={topQuery.isFetching}
          >
            {topQuery.isLoading ? (
              <RankingSkeleton />
            ) : topQuery.isError ? (
              <ApiErrorState error={topQuery.error} onRetry={() => void topQuery.refetch()} bare />
            ) : top.length === 0 ? (
              <EmptyState
                bare
                icon={Trophy}
                title="Aún nadie tiene XP"
                description={`Cuando la gente empiece a platicar en el servidor, aquí aparecerá el ranking. Cada mensaje cuenta (uno cada ${XP_COOLDOWN_SECONDS} segundos por persona).`}
                testId="empty-level-ranking"
              />
            ) : (
              <LevelLeaderboard entries={top} />
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="p-4 sm:p-6">
            <CardTitle className="flex items-center gap-2 text-lg">
              <BarChart3 className="h-5 w-5 text-primary" aria-hidden="true" />
              Personas por nivel
            </CardTitle>
            <CardDescription>Cuántas personas hay en cada rango de niveles.</CardDescription>
          </CardHeader>
          <CardContent className="p-4 pt-0 sm:p-6 sm:pt-0">
            {analyticsQuery.isLoading ? (
              <div className="space-y-3" aria-busy="true" aria-label="Cargando gráfica">
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <Skeleton key={i} className="h-6" style={{ width: `${90 - i * 12}%` }} />
                ))}
              </div>
            ) : analyticsQuery.isError ? (
              <ApiErrorState error={analyticsQuery.error} onRetry={() => void analyticsQuery.refetch()} bare />
            ) : !hasDistribution ? (
              <EmptyState
                bare
                icon={BarChart3}
                title="Todavía no hay datos"
                description="La gráfica se llena sola cuando la gente gana su primera XP."
                testId="empty-level-distribution"
              />
            ) : (
              <LevelDistributionChart buckets={buckets} />
            )}
          </CardContent>
        </Card>
      </div>

      <XpRulesCard prefix={prefix} economyEnabled={configQuery.data?.economyEnabled ?? null} />
    </div>
  );
}
