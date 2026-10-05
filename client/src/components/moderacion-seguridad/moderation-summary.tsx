import { useQuery } from "@tanstack/react-query";
import { Gavel, History, RefreshCw, ShieldAlert, TriangleAlert } from "lucide-react";
import type { DashboardStatsResponse } from "@shared/api";
import { Button } from "@/components/ui/button";
import { StatCard } from "@/components/stat-card";
import { getApiErrorInfo } from "@/lib/queryClient";
import { dashboardStatsKey } from "./query-keys";
import { numberFormat } from "./utils";

/** Totales reales de moderación (los cuenta el servidor en la base de datos). */
export function ModerationSummary({ guildId }: { guildId: string }) {
  const stats = useQuery<DashboardStatsResponse>({
    queryKey: dashboardStatsKey(guildId),
    staleTime: 60_000,
  });

  const counts = stats.data?.counts;
  const value = (n: number | undefined) => (typeof n === "number" ? numberFormat.format(n) : "—");

  return (
    <section className="space-y-3" aria-label="Resumen de moderación">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Últimos 7 días"
          icon={Gavel}
          loading={stats.isLoading}
          value={value(counts?.moderationActions7d)}
          subtitle="Acciones de moderación"
          testId="stat-moderation-7d"
        />
        <StatCard
          title="Últimos 30 días"
          icon={History}
          loading={stats.isLoading}
          value={value(counts?.moderationActions30d)}
          subtitle="Acciones de moderación"
          testId="stat-moderation-30d"
        />
        <StatCard
          title="Advertencias · 30 días"
          icon={TriangleAlert}
          loading={stats.isLoading}
          value={value(counts?.warnings30d)}
          subtitle="Hechas con /warn este mes"
          testId="stat-warnings-30d"
        />
        <StatCard
          title="Advertencias en total"
          icon={ShieldAlert}
          loading={stats.isLoading}
          value={value(counts?.warningsTotal)}
          subtitle="Desde que el bot guarda el historial"
          testId="stat-warnings-total"
        />
      </div>

      {stats.isError && !counts && (
        <div
          className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3 text-sm sm:flex-row sm:items-center sm:justify-between"
          role="alert"
        >
          <p className="text-muted-foreground">
            No pudimos cargar los totales: {getApiErrorInfo(stats.error).description}
          </p>
          <Button variant="outline" size="sm" className="shrink-0" onClick={() => void stats.refetch()}>
            <RefreshCw />
            Reintentar
          </Button>
        </div>
      )}
    </section>
  );
}
