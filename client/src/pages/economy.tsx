import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Coins, PiggyBank, Power, RefreshCw, Users, Wallet } from "lucide-react";
import type { AnalyticsResponse, EconomyTopResponse } from "@shared/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ApiErrorState } from "@/components/api-error-state";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { EconomyCommandsCard, HowCoinsWorkCard } from "@/components/niveles-economia/economy-guide";
import { formatCoins, formatCompact, formatNumber } from "@/components/niveles-economia/format";
import { ConfigToggle, useGuildConfig } from "@/components/niveles-economia/guild-config";
import { RankingSkeleton, TopLimitSelect, type TopLimit } from "@/components/niveles-economia/ranking-parts";
import { WealthLeaderboard } from "@/components/niveles-economia/wealth-leaderboard";
import { useSelectedGuild } from "@/lib/guild";
import { cn } from "@/lib/utils";

export default function Economy() {
  const { guildId } = useSelectedGuild();
  const [limit, setLimit] = useState<TopLimit>(10);

  // Ranking: GET /api/economy/:guildId/top?limit=N (cartera + banco)
  const topQuery = useQuery<EconomyTopResponse>({
    queryKey: ["/api/economy", guildId, `top?limit=${limit}`],
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });

  // Totales reales de la base de datos
  const analyticsQuery = useQuery<AnalyticsResponse>({
    queryKey: ["/api/guilds", guildId, "analytics"],
    staleTime: 60_000,
  });

  const configQuery = useGuildConfig(guildId);

  const refreshAll = () => {
    void topQuery.refetch();
    void analyticsQuery.refetch();
    void configQuery.refetch();
  };
  const refreshing = topQuery.isFetching || analyticsQuery.isFetching;

  // Las cuentas en cero (se crean solas al escribir) no aportan nada al ranking
  const top = (topQuery.data ?? []).filter((entry) => entry.total > 0);
  const totals = analyticsQuery.data?.totals;
  const accounts = totals?.usersWithEconomy ?? 0;
  const coins = totals?.coinsInCirculation ?? 0;
  const average = accounts > 0 ? Math.round(coins / accounts) : null;
  const economyEnabled = configQuery.data?.economyEnabled ?? null;
  const prefix = configQuery.data?.prefix ?? "&";
  const statsUnavailable = analyticsQuery.isError;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Economía"
        description="Monedas virtuales para jugar y presumir: se ganan platicando y con comandos en Discord."
        actions={
          <Button variant="outline" onClick={refreshAll} disabled={refreshing} data-testid="button-refresh-economy">
            <RefreshCw className={cn(refreshing && "animate-spin")} />
            Actualizar
          </Button>
        }
      />

      {/* Interruptor general */}
      <Card>
        <CardHeader className="p-4 sm:p-6">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Power className="h-5 w-5 text-primary" aria-hidden="true" />
            Encender o apagar la economía
          </CardTitle>
          <CardDescription>Útil si prefieres un servidor solo de charla, sin monedas ni apuestas.</CardDescription>
        </CardHeader>
        <CardContent className="p-4 pt-0 sm:p-6 sm:pt-0">
          <ConfigToggle
            field="economyEnabled"
            id="toggle-economy-enabled"
            label="Economía activada"
            description={
              <>
                Monedas, banco y juegos de azar. Si la apagas, los comandos de economía y de apuestas responden que
                está desactivada y al platicar solo se gana XP. Nadie pierde lo que ya tenía: al volver a activarla,
                todo sigue igual.
              </>
            }
            savedOn="Economía activada"
            savedOff="Economía desactivada"
          />
        </CardContent>
      </Card>

      {/* Números reales */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
        <StatCard
          title="Personas con cuenta"
          icon={Users}
          loading={analyticsQuery.isLoading}
          value={totals ? formatNumber(accounts) : "—"}
          subtitle={statsUnavailable ? "No se pudo cargar ahora" : "Se crea sola al platicar o usar un comando"}
          testId="stat-economy-accounts"
        />
        <StatCard
          title="Monedas en circulación"
          icon={Coins}
          loading={analyticsQuery.isLoading}
          value={totals ? <span title={formatCoins(coins)}>{formatCompact(coins)}</span> : "—"}
          subtitle={statsUnavailable ? "No se pudo cargar ahora" : "Suma de todas las carteras y bancos"}
          testId="stat-economy-coins"
        />
        <StatCard
          title="Promedio por cuenta"
          icon={PiggyBank}
          loading={analyticsQuery.isLoading}
          value={average !== null ? <span title={formatCoins(average)}>{formatCompact(average)}</span> : "—"}
          subtitle={
            statsUnavailable
              ? "No se pudo cargar ahora"
              : average !== null
                ? "Monedas por persona, contando cartera y banco"
                : "Aún no hay cuentas"
          }
          testId="stat-economy-average"
        />
      </div>

      {/* Ranking + cómo se ganan */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader className="flex flex-col gap-3 space-y-0 p-4 sm:flex-row sm:items-start sm:justify-between sm:p-6">
            <div className="space-y-1.5">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Wallet className="h-5 w-5 text-primary" aria-hidden="true" />
                Las personas con más monedas
              </CardTitle>
              <CardDescription>Cartera + banco, igual que /leaderboard en Discord.</CardDescription>
            </div>
            <TopLimitSelect id="economy-limit" value={limit} onChange={setLimit} />
          </CardHeader>
          <CardContent
            className={cn("p-4 pt-0 sm:p-6 sm:pt-0", topQuery.isPlaceholderData && "opacity-60 transition-opacity")}
            aria-busy={topQuery.isFetching}
          >
            {economyEnabled === false && (
              <p className="mb-4 rounded-lg border border-status-warning/40 bg-status-warning/10 p-3 text-sm text-foreground">
                La economía está desactivada. Las monedas se conservan, pero nadie puede ganarlas ni usarlas hasta que
                la vuelvas a activar.
              </p>
            )}
            {topQuery.isLoading ? (
              <RankingSkeleton />
            ) : topQuery.isError ? (
              <ApiErrorState error={topQuery.error} onRetry={() => void topQuery.refetch()} bare />
            ) : top.length === 0 ? (
              <EmptyState
                bare
                icon={Coins}
                title="Aún nadie tiene monedas"
                description={
                  <>
                    Las monedas llegan solas al platicar, y también con{" "}
                    <code className="font-mono text-foreground">/daily</code> y{" "}
                    <code className="font-mono text-foreground">/work</code>.
                  </>
                }
                testId="empty-wealth-ranking"
              />
            ) : (
              <WealthLeaderboard entries={top} />
            )}
          </CardContent>
        </Card>

        <div className="lg:col-span-2">
          <HowCoinsWorkCard />
        </div>
      </div>

      <EconomyCommandsCard prefix={prefix} economyEnabled={economyEnabled} />
    </div>
  );
}
