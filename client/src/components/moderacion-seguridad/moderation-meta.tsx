import {
  Ban,
  Eraser,
  Gavel,
  Lock,
  MessageSquareOff,
  TriangleAlert,
  Unlock,
  UserCheck,
  UserX,
  Volume2,
  type LucideIcon,
} from "lucide-react";
import { MODERATION_ACTION_LABELS, type ModerationActionItem } from "@shared/api";
import { cn } from "@/lib/utils";
import { formatRelative, parseDate } from "./utils";

type Tone = "warning" | "error" | "success" | "neutral";

const TONE_CLASSES: Record<Tone, { badge: string; iconBox: string }> = {
  warning: {
    badge: "border-status-warning/30 bg-status-warning/10 text-status-warning",
    iconBox: "bg-status-warning/10 text-status-warning",
  },
  error: {
    badge: "border-status-error/30 bg-status-error/10 text-status-error",
    iconBox: "bg-status-error/10 text-status-error",
  },
  success: {
    badge: "border-status-success/30 bg-status-success/10 text-status-success",
    iconBox: "bg-status-success/10 text-status-success",
  },
  neutral: {
    badge: "border-border bg-muted text-muted-foreground",
    iconBox: "bg-muted text-muted-foreground",
  },
};

const ACTION_STYLE: Record<string, { icon: LucideIcon; tone: Tone }> = {
  warn: { icon: TriangleAlert, tone: "warning" },
  mute: { icon: MessageSquareOff, tone: "warning" },
  unmute: { icon: Volume2, tone: "success" },
  kick: { icon: UserX, tone: "error" },
  ban: { icon: Ban, tone: "error" },
  unban: { icon: UserCheck, tone: "success" },
  clear: { icon: Eraser, tone: "neutral" },
  lockdown: { icon: Lock, tone: "error" },
  unlock: { icon: Unlock, tone: "success" },
};

/**
 * Acciones sobre un canal (/clear, /lockdown): el bot las guarda con el propio
 * moderador como "persona", así que en la tabla no se muestra a nadie sancionado.
 */
const CHANNEL_ACTIONS = new Set(["clear", "lockdown", "unlock"]);

export function isChannelAction(type: string): boolean {
  return CHANNEL_ACTIONS.has(type);
}

export function actionLabel(type: string): string {
  return MODERATION_ACTION_LABELS[type] ?? type;
}

export function actionStyle(type: string) {
  const style = ACTION_STYLE[type] ?? { icon: Gavel, tone: "neutral" as Tone };
  return { icon: style.icon, ...TONE_CLASSES[style.tone] };
}

/** Insignia de color con el tipo de acción ("Advertencia", "Baneo"…). */
export function ActionBadge({ type, duration, className }: { type: string; duration?: number | null; className?: string }) {
  const { icon: Icon, badge } = actionStyle(type);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border px-2 py-0.5 text-xs font-semibold",
        badge,
        className,
      )}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      {actionLabel(type)}
      {typeof duration === "number" && duration > 0 && (
        <span className="font-mono font-normal opacity-80">· {duration} min</span>
      )}
    </span>
  );
}

/**
 * Estado de un silencio: vigente (con cuándo termina) o terminado.
 * Si ya pasó la hora y sigue vigente, el bot pudo reiniciarse a mitad: se avisa.
 */
export function MuteStatus({ action, now }: { action: ModerationActionItem; now: Date }) {
  if (action.type !== "mute") return null;

  if (!action.active) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <span className="h-1.5 w-1.5 rounded-full bg-status-offline" aria-hidden="true" />
        Terminado
      </span>
    );
  }

  const start = parseDate(action.createdAt);
  const end = start && action.duration ? new Date(start.getTime() + action.duration * 60_000) : null;

  // El bot quita el silencio con un temporizador: si se reinició a mitad, puede seguir puesto
  if (end && end.getTime() <= now.getTime()) {
    return (
      <span className="flex flex-col gap-0.5 text-xs text-status-warning">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-status-warning" aria-hidden="true" />
          Debía terminar {formatRelative(end, now)}
        </span>
        <span className="text-muted-foreground">Si sigue silenciado en Discord, usa /unmute.</span>
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-primary">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-status-online" aria-hidden="true" />
      {end ? `Vigente · termina ${formatRelative(end, now)}` : "Vigente"}
    </span>
  );
}
