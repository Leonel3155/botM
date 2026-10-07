import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ShieldCheck, ShieldOff } from "lucide-react";
import type { AntiRaidResponse, DashboardStatsResponse } from "@shared/api";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { StatusIndicator } from "@/components/status-indicator";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { describeRule } from "./antiraid-texts";
import { ConfirmDialog } from "./confirm-dialog";
import { dashboardStatsKey } from "./query-keys";
import { useAntiRaidUpdate } from "./use-antiraid";
import { describeMutationError, numberFormat } from "./utils";

interface AntiRaidStatusCardProps {
  guildId: string;
  data: AntiRaidResponse;
  /** El bot está en el servidor (sin él no se puede guardar) */
  botInGuild: boolean;
}

/** Interruptor principal de la protección + la regla actual explicada en una frase. */
export function AntiRaidStatusCard({ guildId, data, botInGuild }: AntiRaidStatusCardProps) {
  const { toast } = useToast();
  const update = useAntiRaidUpdate(guildId);
  const [confirmDisableOpen, setConfirmDisableOpen] = useState(false);

  const stats = useQuery<DashboardStatsResponse>({
    queryKey: dashboardStatsKey(guildId),
    staleTime: 60_000,
  });
  const raids30d = stats.data?.counts?.raidEvents30d;

  // Mientras se guarda, el interruptor muestra ya el valor pedido
  const enabled = update.isPending && update.variables?.enabled !== undefined ? update.variables.enabled : data.config.enabled;

  const save = (next: boolean) => {
    update.mutate(
      { enabled: next },
      {
        onSuccess: (result) => {
          const extra = result.warnings.length > 0 ? ` ${result.warnings.join(" ")}` : "";
          toast(
            next
              ? {
                  title: "Protección anti-raid activada",
                  description: `El bot vigilará las entradas masivas y actuará solo si pasa algo.${extra}`,
                }
              : {
                  title: "Protección anti-raid desactivada",
                  description: `${result.liftedRaid ? "También terminó el modo raid que estaba activo. " : ""}El bot ya no reaccionará ante entradas masivas.${extra}`,
                },
          );
        },
        onError: (error) => {
          toast({
            variant: "destructive",
            title: next ? "No se pudo activar la protección" : "No se pudo desactivar la protección",
            description: describeMutationError(error),
          });
        },
        onSettled: () => setConfirmDisableOpen(false),
      },
    );
  };

  const onToggle = (next: boolean) => {
    // Apagarla en pleno raid también lo termina: lo confirmamos antes
    if (!next && data.activeRaid) {
      setConfirmDisableOpen(true);
      return;
    }
    save(next);
  };

  const Icon = enabled ? ShieldCheck : ShieldOff;

  return (
    <Card className={cn(enabled && "border-primary/40")} data-testid="card-antiraid-status">
      <CardContent className="flex flex-col gap-5 p-4 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <div
              className={cn(
                "flex h-11 w-11 shrink-0 items-center justify-center rounded-md",
                enabled ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground",
              )}
            >
              <Icon className="h-6 w-6" aria-hidden="true" />
            </div>
            <div className="min-w-0 space-y-1">
              <Label htmlFor="switch-antiraid-enabled" className="text-base font-semibold text-foreground">
                Protección anti-raid
              </Label>
              <StatusIndicator
                status={enabled ? "online" : "offline"}
                label={enabled ? "Activada" : "Desactivada"}
                testId="status-antiraid"
              />
            </div>
          </div>
          <Switch
            id="switch-antiraid-enabled"
            checked={enabled}
            onCheckedChange={onToggle}
            disabled={!botInGuild || update.isPending}
            aria-label="Protección anti-raid"
            data-testid="switch-antiraid-enabled"
          />
        </div>

        <p className="text-sm text-muted-foreground">
          {enabled
            ? describeRule(data.config)
            : "Ahora mismo el bot no hace nada si entran muchas cuentas de golpe. Actívala para que vigile por ti y avise al staff."}
        </p>

        <div className="flex flex-col gap-1 border-t border-border pt-4 text-sm sm:flex-row sm:items-center sm:justify-between">
          <span className="text-muted-foreground">Raids detectados en los últimos 30 días</span>
          {stats.isLoading ? (
            <Skeleton className="h-5 w-10" />
          ) : (
            <span className="font-mono text-lg font-bold text-foreground" data-testid="text-raids-30d">
              {typeof raids30d === "number" ? numberFormat.format(raids30d) : "—"}
            </span>
          )}
        </div>

        {!botInGuild && (
          <p className="text-xs text-status-warning">Invita al bot al servidor para poder cambiar la protección.</p>
        )}
      </CardContent>

      <ConfirmDialog
        open={confirmDisableOpen}
        onOpenChange={setConfirmDisableOpen}
        title="¿Desactivar la protección anti-raid?"
        description={
          <>
            <p>Hay un modo raid activo ahora mismo. Si desactivas la protección, también se termina: la verificación vuelve a como estaba y el bot deja de actuar.</p>
            <p>Después de esto el bot no reaccionará ante nuevas entradas masivas.</p>
          </>
        }
        confirmLabel="Sí, desactivar"
        pendingLabel="Desactivando…"
        destructive
        pending={update.isPending}
        onConfirm={() => save(false)}
        testId="dialog-disable-antiraid"
      />
    </Card>
  );
}
