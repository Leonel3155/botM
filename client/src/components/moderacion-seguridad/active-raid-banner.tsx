import { useEffect, useId, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Siren, Square } from "lucide-react";
import type { ActiveRaidInfo } from "@shared/api";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { ConfirmDialog } from "./confirm-dialog";
import { liftTexts, plainLabel } from "./antiraid-texts";
import { antiRaidKey } from "./query-keys";
import { useLiftRaid } from "./use-antiraid";
import { describeMutationError, formatRelative, numberFormat, parseDate } from "./utils";

interface ActiveRaidBannerProps {
  guildId: string;
  raid: ActiveRaidInfo;
  /** Etiqueta de la acción tal como la manda la API */
  actionLabel: string;
  now: Date;
}

/** Aviso grande y rojo mientras el modo raid está activo, con el botón para terminarlo. */
export function ActiveRaidBanner({ guildId, raid, actionLabel, now }: ActiveRaidBannerProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const lift = useLiftRaid(guildId);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const titleId = useId();
  const afterLift = liftTexts(raid.action);

  const startedAt = parseDate(raid.startedAt);
  const endsAt = parseDate(raid.endsAt);
  const overdue = !!endsAt && endsAt.getTime() <= now.getTime();

  // Cuando se cumple el tiempo, el bot lo termina solo: pedimos el estado nuevo una vez
  const refreshedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!overdue || refreshedFor.current === raid.endsAt) return;
    refreshedFor.current = raid.endsAt;
    const id = window.setTimeout(() => {
      void queryClient.invalidateQueries({ queryKey: antiRaidKey(guildId) });
    }, 3_000);
    return () => window.clearTimeout(id);
  }, [overdue, raid.endsAt, guildId, queryClient]);

  const confirmLift = () => {
    lift.mutate(undefined, {
      onSuccess: (result) => {
        toast(
          result.lifted
            ? { title: "Modo raid terminado", description: afterLift.past }
            : { title: "El modo raid ya había terminado", description: "No había ningún modo raid activo. Actualizamos la página." },
        );
      },
      onError: (error) => {
        toast({ variant: "destructive", title: "No se pudo terminar el modo raid", description: describeMutationError(error) });
      },
      onSettled: () => setConfirmOpen(false),
    });
  };

  return (
    // Sin role="alert" en todo el bloque: el tiempo y los contadores cambian solos y el lector de
    // pantalla lo leería entero una y otra vez. Solo se anuncia una vez el aviso fijo de abajo.
    <section
      className="rounded-xl border border-status-error/50 bg-status-error/10 p-4 sm:p-6"
      aria-labelledby={titleId}
      data-testid="banner-active-raid"
    >
      <p role="alert" className="sr-only">
        Modo raid activo: el bot detectó una entrada masiva de cuentas.
      </p>
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="flex min-w-0 gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-status-error/20 text-status-error">
            <Siren className="h-5 w-5 animate-pulse" aria-hidden="true" />
          </div>
          <div className="min-w-0 space-y-1">
            <h2 id={titleId} className="text-lg font-semibold text-foreground">
              Modo raid activo
            </h2>
            <p className="text-sm text-foreground/90">
              El bot detectó una entrada masiva{startedAt ? ` ${formatRelative(startedAt, now)}` : ""} y está
              aplicando: <span className="font-medium">{plainLabel(actionLabel)}</span>.
            </p>
          </div>
        </div>
        <Button
          variant="destructive"
          className="w-full shrink-0 md:w-auto"
          onClick={() => setConfirmOpen(true)}
          disabled={lift.isPending}
          data-testid="button-lift-raid"
        >
          <Square />
          Terminar modo raid
        </Button>
      </div>

      <dl className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-status-error/30 bg-background/60 p-3">
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Termina</dt>
          <dd className="mt-1 text-sm font-medium text-foreground">
            {endsAt ? (overdue ? "En unos segundos…" : formatRelative(endsAt, now)) : "—"}
          </dd>
        </div>
        <div className="rounded-lg border border-status-error/30 bg-background/60 p-3">
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Entradas durante el raid</dt>
          <dd className="mt-1 font-mono text-xl font-bold text-foreground">{numberFormat.format(raid.joinsDuringRaid)}</dd>
        </div>
        <div className="rounded-lg border border-status-error/30 bg-background/60 p-3">
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Expulsados</dt>
          <dd className="mt-1 font-mono text-xl font-bold text-foreground">{numberFormat.format(raid.kicked)}</dd>
        </div>
      </dl>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="¿Terminar el modo raid ahora?"
        description={
          <>
            <p>{afterLift.future}</p>
            <p>Hazlo solo si ya pasó el peligro. Si vuelven a entrar muchas cuentas de golpe, se activará otra vez.</p>
          </>
        }
        confirmLabel="Sí, terminar"
        pendingLabel="Terminando…"
        destructive
        pending={lift.isPending}
        onConfirm={confirmLift}
        testId="dialog-lift-raid"
      />
    </section>
  );
}
