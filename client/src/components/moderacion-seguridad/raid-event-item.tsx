import { useState, type ReactNode } from "react";
import { CheckCheck, ChevronDown, Copy, Loader2, Square } from "lucide-react";
import type { RaidEventItem as RaidEvent } from "@shared/api";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  describeLiftedBy,
  describeResolvedBy,
  plainLabel,
  raidEventStatus,
  raidEventTitle,
  severityMeta,
  type RaidEventStatus,
} from "./antiraid-texts";
import { RelativeTime } from "./relative-time";
import { formatRelative, numberFormat, parseDate } from "./utils";

interface RaidEventItemProps {
  event: RaidEvent;
  /** value → etiqueta de las acciones (de GET /antiraid) */
  actionLabels: Record<string, string>;
  currentUserId: string | null;
  now: Date;
  /** Se está terminando o marcando como revisado */
  resolving: boolean;
  /** Otra acción en curso: el botón se desactiva */
  busy: boolean;
  onResolve: (event: RaidEvent) => void;
}

const STATUS_PILLS: Record<RaidEventStatus, { label: string; className: string }> = {
  active: { label: "En curso", className: "border-status-error/40 bg-status-error/15 text-status-error" },
  pending: { label: "Pendiente", className: "border-status-warning/40 bg-status-warning/10 text-status-warning" },
  ended: { label: "Terminado", className: "border-border bg-muted text-muted-foreground" },
  reviewed: { label: "Revisado", className: "border-primary/40 bg-primary/10 text-primary" },
};

function StatusPill({ status }: { status: RaidEventStatus }) {
  const pill = STATUS_PILLS[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border px-2 py-0.5 text-xs font-semibold",
        pill.className,
      )}
    >
      {status === "active" && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-status-error" aria-hidden="true" />}
      {status === "reviewed" && <CheckCheck className="h-3 w-3" aria-hidden="true" />}
      {pill.label}
    </span>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm text-foreground">{children}</dd>
    </div>
  );
}

/** Un raid del historial: qué pasó, qué hizo el bot y cómo terminó. Color según la severidad. */
export function RaidEventItem({ event, actionLabels, currentUserId, now, resolving, busy, onResolve }: RaidEventItemProps) {
  const { toast } = useToast();
  const [idsOpen, setIdsOpen] = useState(false);
  const d = event.details;
  const status = raidEventStatus(event);
  const severity = severityMeta(event.severity);
  const SeverityIcon = severity.icon;

  const joins = typeof d.joins === "number" ? d.joins : null;
  const windowSeconds = typeof d.windowSeconds === "number" ? d.windowSeconds : null;
  const newAccounts = typeof d.newAccounts === "number" ? d.newAccounts : null;
  const kicked = typeof d.kicked === "number" ? d.kicked : typeof d.kickedAtStart === "number" ? d.kickedAtStart : null;
  const joinsDuringRaid = typeof d.joinsDuringRaid === "number" ? d.joinsDuringRaid : null;
  const userIds = Array.isArray(d.userIds) ? d.userIds.filter((id): id is string => typeof id === "string") : [];

  const actionText = d.action ? plainLabel(actionLabels[d.action] ?? d.action) : null;

  const liftedAt = parseDate(typeof d.liftedAt === "number" ? d.liftedAt : null);
  const liftAt = parseDate(typeof d.liftAt === "number" ? d.liftAt : null);
  const resolvedAt = parseDate(typeof d.resolvedAt === "number" ? d.resolvedAt : null);
  const liftedBy = describeLiftedBy(typeof d.liftedBy === "string" ? d.liftedBy : undefined, currentUserId);
  const resolvedBy = describeResolvedBy(typeof d.resolvedBy === "string" ? d.resolvedBy : undefined, currentUserId);

  let summary: string;
  if (joins !== null && windowSeconds !== null) {
    summary = `Entraron ${numberFormat.format(joins)} cuentas en ${numberFormat.format(windowSeconds)} segundos o menos`;
    if (typeof d.threshold === "number") summary += ` (la protección salta con ${numberFormat.format(d.threshold)})`;
    summary += ".";
  } else if (joins !== null) {
    summary = `Entraron ${numberFormat.format(joins)} cuentas de golpe.`;
  } else {
    summary = "El bot detectó actividad sospechosa.";
  }

  let ending: string | null = null;
  if (event.isActive) {
    ending = liftAt ? `El modo raid termina ${formatRelative(liftAt, now)}.` : "El modo raid sigue activo.";
  } else if (liftedAt) {
    ending = `El modo raid terminó ${formatRelative(liftedAt, now)}${liftedBy ? ` ${liftedBy}` : ""}.`;
  } else if (status === "pending") {
    ending =
      "El modo raid ya no está activo, pero quedó abierto en el historial (por ejemplo, si el bot se reinició o no pudo guardar cuándo terminó). Márcalo como revisado para cerrarlo.";
  } else if (status === "ended") {
    ending = "El modo raid ya terminó.";
  }

  const copyIds = async () => {
    try {
      await navigator.clipboard.writeText(userIds.join("\n"));
      toast({ title: "IDs copiados", description: `Copiaste ${userIds.length} ${userIds.length === 1 ? "ID" : "IDs"} al portapapeles.` });
    } catch {
      toast({ variant: "destructive", title: "No se pudieron copiar", description: "Tu navegador no dejó usar el portapapeles. Selecciónalos y cópialos a mano." });
    }
  };

  return (
    <li
      className={cn(
        "flex gap-3 rounded-lg border border-l-4 border-border bg-background/40 p-3 sm:gap-4 sm:p-4",
        severity.accent,
      )}
      data-testid={`raid-event-${event.id}`}
    >
      <div className={cn("mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full", severity.soft, severity.text)}>
        <SeverityIcon className="h-4 w-4" aria-hidden="true" />
      </div>

      <div className="min-w-0 flex-1 space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="font-medium text-foreground">{raidEventTitle(event.type)}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              <RelativeTime value={event.createdAt} now={now} className="font-mono" />
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                "whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-semibold uppercase tracking-wide",
                severity.soft,
                severity.text,
              )}
            >
              Severidad {severity.label.toLowerCase()}
            </span>
            <StatusPill status={status} />
          </div>
        </div>

        <p className="text-sm text-foreground/90">{summary}</p>

        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {newAccounts !== null && (
            <Fact label="Cuentas nuevas">
              <span className="font-mono">{numberFormat.format(newAccounts)}</span>
              {joins !== null && <span className="text-muted-foreground"> de {numberFormat.format(joins)}</span>}
            </Fact>
          )}
          {actionText && <Fact label="Qué hizo el bot">{actionText}</Fact>}
          {joinsDuringRaid !== null && (
            <Fact label="Entraron durante el raid">
              <span className="font-mono">{numberFormat.format(joinsDuringRaid)}</span>
            </Fact>
          )}
          {kicked !== null && (
            <Fact label="Expulsados">
              <span className="font-mono">{numberFormat.format(kicked)}</span>
            </Fact>
          )}
        </dl>

        {(ending || resolvedAt) && (
          <div className="space-y-0.5 text-xs text-muted-foreground">
            {ending && <p>{ending}</p>}
            {resolvedAt && (
              <p>
                Marcado como revisado {formatRelative(resolvedAt, now)}
                {resolvedBy ? ` ${resolvedBy}` : ""}.
              </p>
            )}
          </div>
        )}

        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          {(status === "active" || status === "pending") && (
            <Button
              size="sm"
              variant={status === "active" ? "destructive" : "default"}
              onClick={() => onResolve(event)}
              disabled={busy || resolving}
              data-testid={`button-resolve-${event.id}`}
            >
              {resolving ? <Loader2 className="animate-spin" /> : status === "active" ? <Square /> : <CheckCheck />}
              {resolving
                ? status === "active"
                  ? "Terminando…"
                  : "Guardando…"
                : status === "active"
                  ? "Terminar modo raid"
                  : "Marcar como revisado"}
            </Button>
          )}

          {userIds.length > 0 && (
            <Collapsible open={idsOpen} onOpenChange={setIdsOpen} className="w-full sm:w-auto">
              <CollapsibleTrigger asChild>
                <Button size="sm" variant="ghost" className="w-full justify-start sm:w-auto" aria-expanded={idsOpen}>
                  <ChevronDown className={cn("transition-transform", idsOpen && "rotate-180")} />
                  {idsOpen ? "Ocultar" : "Ver"} los IDs de {userIds.length === 1 ? "la cuenta" : `las ${userIds.length} cuentas`}
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-2 space-y-2">
                <ul className="max-h-40 overflow-y-auto rounded-md border border-border bg-background/60 p-2 font-mono text-xs text-muted-foreground">
                  {userIds.map((id) => (
                    <li key={id} className="select-all py-0.5">
                      {id}
                    </li>
                  ))}
                </ul>
                <Button size="sm" variant="outline" onClick={() => void copyIds()}>
                  <Copy />
                  Copiar IDs
                </Button>
              </CollapsibleContent>
            </Collapsible>
          )}
        </div>
      </div>
    </li>
  );
}
