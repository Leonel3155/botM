import { useQuery } from "@tanstack/react-query";
import { Coins, Gavel, LineChart, RefreshCw, ShieldAlert, Trophy, Users } from "lucide-react";
import type { AnalyticsResponse } from "@shared/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiErrorState } from "@/components/api-error-state";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import {
  LevelDistributionChart,
  LevelDistributionTable,
  levelDistributionSummary,
  ModerationByTypeList,
  ModerationPerDayChart,
  ModerationPerDayTable,
  moderationPerDaySummary,
  TopEarnersChart,
  TopEarnersTable,
  topEarnersSummary,
} from "@/components/ajustes-resumen/analytics-charts";
import { ChartCard } from "@/components/ajustes-resumen/chart-card";
import { formatNumber, plural, relativeTime } from "@/components/ajustes-resumen/format";
import { useSelectedGuild } from "@/lib/guild";
import { getApiErrorInfo } from "@/lib/queryClient";
import { cn } from "@/lib/utils";

function ChartSkeleton({ className }: { className?: string }) {
  return (
    <Card className={className}>
      <CardHeader className="space-y-2">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-4 w-64 max-w-full" />
      </CardHeader>
      <CardContent>
        <Skeleton className="h-64 w-full" />
      </CardContent>
    </Card>
  );
}

export default function Estadisticas() {
  const { guildId } = useSelectedGuild();

  // La clave empieza por "/api/guilds/<id>": el aviso "settingsUpdated" del tiempo real la refresca
  const analyticsQuery = useQuery<AnalyticsResponse>({
    queryKey: ["/api/guilds", guildId, "analytics"],
    staleTime: 2 * 60_000,
    refetchInterval: 5 * 60_000,
  });
  const data = analyticsQuery.data;
  const loading = analyticsQuery.isLoading;
  const refreshing = analyticsQuery.isFetching && !loading;
  const updatedAt = analyticsQuery.dataUpdatedAt ? new Date(analyticsQuery.dataUpdatedAt) : null;

  const header = (
    <PageHeader
      title="Estadísticas"
      description={
        <>
          Cómo se mueve tu servidor, con los datos reales que guarda el bot
          {updatedAt && data ? <span className="text-muted-foreground"> · actualizado {relativeTime(updatedAt)}</span> : null}
        </>
      }
      actions={
        <Button
          variant="outline"
          onClick={() => void analyticsQuery.refetch()}
          disabled={analyticsQuery.isFetching}
          data-testid="button-refresh-analytics"
        >
          <RefreshCw className={cn(analyticsQuery.isFetching && "animate-spin")} />
          Actualizar
        </Button>
      }
    />
  );

  if (analyticsQuery.isError && !data) {
    return (
      <div className="space-y-6">
        {header}
        <ApiErrorState error={analyticsQuery.error} onRetry={() => void analyticsQuery.refetch()} />
      </div>
    );
  }

  const totals = data?.totals;
  const hasLevels = (data?.levelDistribution ?? []).some((bucket) => bucket.users > 0);
  const hasEarners = (data?.topEarners.length ?? 0) > 0;
  const moderationTotal = data?.moderationPerDay.reduce((sum, day) => sum + day.total, 0) ?? 0;

  return (
    <div className="space-y-6">
      {header}

      {analyticsQuery.isError && data && (
        <p className="text-sm text-status-warning" role="status">
          No se pudo actualizar: {getApiErrorInfo(analyticsQuery.error).title}. Mostramos los últimos datos que tenemos.
        </p>
      )}

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Personas con nivel"
          icon={Trophy}
          loading={loading}
          value={formatNumber(totals?.usersWithLevels)}
          subtitle="Ya escribieron al menos un mensaje"
          testId="stat-analytics-levels"
        />
        <StatCard
          title="Monedas en circulación"
          icon={Coins}
          loading={loading}
          value={formatNumber(totals?.coinsInCirculation)}
          subtitle={
            totals
              ? totals.usersWithEconomy > 0
                ? `${plural(totals.usersWithEconomy, "persona tiene", "personas tienen")} cartera`
                : "Nadie tiene cartera todavía"
              : undefined
          }
          testId="stat-analytics-coins"
        />
        <StatCard
          title="Moderación · 30 días"
          icon={Gavel}
          loading={loading}
          value={formatNumber(totals?.moderationActions30d)}
          subtitle="Acciones del staff con el bot"
          testId="stat-analytics-moderation"
        />
        <StatCard
          title="Alertas de raid · 30 días"
          icon={ShieldAlert}
          loading={loading}
          value={formatNumber(totals?.raidEvents30d)}
          subtitle="Entradas masivas detectadas"
          testId="stat-analytics-raids"
        />
      </div>

      {loading || !data ? (
        <>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <ChartSkeleton />
            <ChartSkeleton />
          </div>
          <ChartSkeleton />
        </>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <ChartCard
              title="Niveles de la comunidad"
              description="Cuántas personas hay en cada rango de nivel."
              icon={Users}
              refreshing={refreshing}
              summary={hasLevels ? levelDistributionSummary(data.levelDistribution) : undefined}
              table={hasLevels ? <LevelDistributionTable buckets={data.levelDistribution} /> : undefined}
              testId="card-chart-levels"
            >
              {hasLevels ? (
                <LevelDistributionChart buckets={data.levelDistribution} />
              ) : (
                <EmptyState
                  bare
                  icon={Trophy}
                  title="Aún nadie tiene nivel"
                  description="Cuando la gente escriba en el servidor, el bot les dará XP y aquí verás cómo se reparten los niveles."
                />
              )}
            </ChartCard>

            <ChartCard
              title="Quién tiene más monedas"
              description="Las 10 personas con más monedas, sumando cartera y banco."
              icon={Coins}
              refreshing={refreshing}
              summary={hasEarners ? topEarnersSummary(data.topEarners) : undefined}
              table={hasEarners ? <TopEarnersTable entries={data.topEarners} /> : undefined}
              testId="card-chart-earners"
            >
              {hasEarners ? (
                <TopEarnersChart entries={data.topEarners} />
              ) : (
                <EmptyState
                  bare
                  icon={Coins}
                  title="Aún nadie tiene monedas"
                  description="Cuando la gente use /daily o /work, aquí verás quién va juntando más."
                />
              )}
            </ChartCard>
          </div>

          <ChartCard
            title="Moderación por día"
            description={`Acciones del staff en los últimos ${data.moderationPerDay.length} días. Los días se cuentan con la hora del servidor (${data.timezone.replace(/_/g, " ")}).`}
            icon={LineChart}
            refreshing={refreshing}
            summary={moderationTotal > 0 ? moderationPerDaySummary(data.moderationPerDay) : undefined}
            table={moderationTotal > 0 ? <ModerationPerDayTable days={data.moderationPerDay} /> : undefined}
            testId="card-chart-moderation"
          >
            {moderationTotal > 0 ? (
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
                <div className="min-w-0 lg:col-span-2">
                  <ModerationPerDayChart days={data.moderationPerDay} />
                </div>
                <div className="min-w-0 space-y-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Por tipo · 30 días</p>
                  <ModerationByTypeList byType={data.moderationByType30d} />
                </div>
              </div>
            ) : (
              <EmptyState
                bare
                icon={Gavel}
                title="Ninguna acción de moderación en 30 días"
                description="¡Todo tranquilo! Cuando el staff use /warn, /mute, /kick o /ban, aquí verás cuántas hubo cada día."
              />
            )}
          </ChartCard>
        </>
      )}

      <p className="text-xs text-muted-foreground">
        Todo sale de la base de datos del bot (niveles, monedas y acciones de moderación): no hay números de ejemplo ni
        estimaciones.
      </p>
    </div>
  );
}
