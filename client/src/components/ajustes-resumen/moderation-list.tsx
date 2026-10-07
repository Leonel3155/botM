import {
  Ban,
  Eraser,
  Gavel,
  Lock,
  MessageSquareOff,
  ShieldAlert,
  ShieldCheck,
  Unlock,
  UserX,
  Volume2,
  type LucideIcon,
} from "lucide-react";
import type { ModerationActionItem } from "@shared/api";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { moderationLabel, parseIso, relativeTime, userName } from "./format";

const ACTION_STYLE: Record<string, { icon: LucideIcon; tone: string }> = {
  warn: { icon: ShieldAlert, tone: "text-status-warning bg-status-warning/10" },
  mute: { icon: MessageSquareOff, tone: "text-status-warning bg-status-warning/10" },
  unmute: { icon: Volume2, tone: "text-status-success bg-status-success/10" },
  kick: { icon: UserX, tone: "text-status-error bg-status-error/10" },
  ban: { icon: Ban, tone: "text-status-error bg-status-error/10" },
  unban: { icon: ShieldCheck, tone: "text-status-success bg-status-success/10" },
  clear: { icon: Eraser, tone: "text-muted-foreground bg-muted" },
  lockdown: { icon: Lock, tone: "text-status-error bg-status-error/10" },
  unlock: { icon: Unlock, tone: "text-status-success bg-status-success/10" },
};

const DEFAULT_STYLE = { icon: Gavel, tone: "text-muted-foreground bg-muted" };

/** Acciones que no van dirigidas a una persona (el "usuario" es quien la hizo o el canal). */
const CHANNEL_ACTIONS = new Set(["clear", "lockdown", "unlock"]);

function ModerationRow({ action }: { action: ModerationActionItem }) {
  const { icon: Icon, tone } = ACTION_STYLE[action.type] ?? DEFAULT_STYLE;
  const when = parseIso(action.createdAt);
  const target = userName(action.user);
  const moderator = userName(action.moderator);
  const showTarget = !CHANNEL_ACTIONS.has(action.type) && action.user.id !== action.moderator.id;
  // Un silencio sigue vigente si no se quitó y aún no pasa su tiempo
  const muteActive =
    action.type === "mute" &&
    action.active &&
    !!when &&
    typeof action.duration === "number" &&
    when.getTime() + action.duration * 60_000 > Date.now();

  return (
    <li className="flex items-start gap-3 border-b border-border py-3 last:border-0">
      <div className={cn("mt-0.5 shrink-0 rounded-full p-2", tone)}>
        <Icon className="h-4 w-4" aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <p className="text-sm font-medium text-foreground">
            {moderationLabel(action.type)}
            {typeof action.duration === "number" && action.duration > 0 && (
              <span className="font-normal text-muted-foreground"> · {action.duration} min</span>
            )}
          </p>
          {muteActive && (
            <Badge variant="outline" className="text-[10px] text-status-warning">
              Vigente
            </Badge>
          )}
        </div>
        <p className="truncate text-xs text-muted-foreground">
          {showTarget ? (
            <>
              A <span className="text-foreground">{target}</span> · por {moderator}
            </>
          ) : (
            <>Por {moderator}</>
          )}
        </p>
        {action.reason && (
          <p className="truncate text-xs text-muted-foreground" title={action.reason}>
            Motivo: {action.reason}
          </p>
        )}
        {when && <p className="mt-1 font-mono text-xs text-muted-foreground">{relativeTime(when)}</p>}
      </div>
    </li>
  );
}

/** Lista corta de acciones de moderación (la más reciente arriba). */
export function ModerationList({ actions }: { actions: ModerationActionItem[] }) {
  return (
    <ul className="-my-3" data-testid="list-moderation">
      {actions.map((action) => (
        <ModerationRow key={action.id} action={action} />
      ))}
    </ul>
  );
}
