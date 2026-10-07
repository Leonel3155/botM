// Textos en lenguaje sencillo para la protección anti-raid (según server/bot/middleware/antiRaid.ts).
import { Info, ShieldAlert, TriangleAlert, type LucideIcon } from "lucide-react";
import type { RaidEventItem } from "@shared/api";
import type { AntiRaidSettings } from "@shared/schema";
import { formatMinutes, isSnowflake } from "./utils";

interface ActionExplanation {
  /** Qué hace, explicado para alguien que no es experto */
  detail: string;
  /** Permisos que necesita el bot (null = ninguno especial) */
  needs: string | null;
  /** Para la frase "Si entran N personas…, el bot …" */
  phrase: string;
}

const ACTION_EXPLANATIONS: Record<string, ActionExplanation> = {
  alert: {
    detail:
      "El bot avisa al staff cuántas cuentas entraron y quiénes son. No cambia nada del servidor: tú decides qué hacer.",
    needs: null,
    phrase: "avisa al staff",
  },
  verification: {
    detail:
      "Además de avisar, sube la verificación del servidor al máximo mientras dure el modo raid: solo pueden escribir cuentas con un teléfono verificado. Al terminar, la regresa a como estaba.",
    needs: "El bot necesita el permiso Gestionar servidor.",
    phrase: "sube la verificación al máximo y avisa al staff",
  },
  lockdown: {
    detail:
      "Lo mismo que la verificación máxima y, además, expulsa a las cuentas nuevas de la ráfaga y a cualquiera que entre mientras dure el modo raid. Es la opción más fuerte.",
    needs: "El bot necesita los permisos Gestionar servidor y Expulsar miembros.",
    phrase: "sube la verificación al máximo, expulsa a quien entre y avisa al staff",
  },
};

export function actionExplanation(action: string): ActionExplanation | null {
  return ACTION_EXPLANATIONS[action] ?? null;
}

export type AntiRaidRule = Pick<AntiRaidSettings, "joinThreshold" | "joinWindowSeconds" | "lockdownMinutes" | "action">;

/** "Si entran 8 personas en 15 segundos, el bot activa el modo raid durante 10 min y …". */
export function describeRule(rule: AntiRaidRule): string {
  const people = rule.joinThreshold === 1 ? "1 persona" : `${rule.joinThreshold} personas`;
  const seconds = rule.joinWindowSeconds === 1 ? "1 segundo" : `${rule.joinWindowSeconds} segundos`;
  const phrase = actionExplanation(rule.action)?.phrase ?? "aplica la acción elegida";
  return `Si entran ${people} en ${seconds} o menos, el bot activa el modo raid durante ${formatMinutes(rule.lockdownMinutes)}: ${phrase}.`;
}

interface LiftTexts {
  /** Antes de terminarlo (diálogos de confirmación) */
  future: string;
  /** Después de terminarlo (avisos) */
  past: string;
}

// Al terminar, el bot solo deshace lo que hizo: la verificación únicamente si la subió
// (verificación / lockdown, y solo si tenía permiso) y deja de expulsar solo con lockdown.
const LIFT_TEXTS: Record<string, LiftTexts> = {
  alert: {
    future: "El bot avisará al staff de que todo volvió a la normalidad.",
    past: "El bot avisó al staff de que todo volvió a la normalidad.",
  },
  verification: {
    future: "El bot regresará la verificación del servidor a como estaba (si la había subido) y avisará al staff.",
    past: "El bot regresó la verificación del servidor a como estaba (si la había subido) y avisó al staff.",
  },
  lockdown: {
    future:
      "El bot dejará de expulsar a quien entre, regresará la verificación a como estaba (si la había subido) y avisará al staff.",
    past: "El bot dejó de expulsar a quien entra, regresó la verificación a como estaba (si la había subido) y avisó al staff.",
  },
};

const NEUTRAL_LIFT: LiftTexts = {
  future: "El bot terminará el modo raid y avisará al staff.",
  past: "El bot terminó el modo raid y avisó al staff.",
};

/** Qué pasa al terminar el modo raid, según la acción que estaba aplicando. */
export function liftTexts(action: string | null | undefined): LiftTexts {
  return (action && LIFT_TEXTS[action]) || NEUTRAL_LIFT;
}

/** Quita el emoji del principio de las etiquetas del bot ("📣 Solo alertar…" → "Solo alertar…"). */
export function plainLabel(label: string): string {
  return label.replace(/^[^\p{L}\p{N}]+/u, "").trim() || label;
}

// =============================================
// Eventos de raid
// =============================================

const EVENT_TYPE_LABELS: Record<string, string> = {
  join_spam: "Entrada masiva de cuentas",
};

export function raidEventTitle(type: string): string {
  return EVENT_TYPE_LABELS[type] ?? type;
}

/**
 * Estado real de un raid. En el servidor `resolved` significa "ya no está abierto": el bot lo pone
 * al terminar el modo raid (al cumplirse el tiempo, con /antiraid levantar, desde el panel o al
 * reiniciarse). `reviewed` indica que alguien del staff lo marcó como revisado en el panel.
 * - active: el modo raid sigue en curso
 * - reviewed: alguien lo marcó como revisado desde el panel
 * - ended: el modo raid terminó y nadie lo ha revisado todavía
 * - pending: quedó abierto sin modo raid activo (p. ej. el bot se reinició y no lo cerró)
 */
export type RaidEventStatus = "active" | "reviewed" | "ended" | "pending";

export function raidEventStatus(event: Pick<RaidEventItem, "isActive" | "resolved" | "reviewed">): RaidEventStatus {
  if (event.isActive) return "active";
  if (event.reviewed) return "reviewed";
  if (event.resolved) return "ended";
  return "pending";
}

export interface SeverityMeta {
  label: string;
  icon: LucideIcon;
  /** Color del texto */
  text: string;
  /** Fondo suave (círculo del icono y etiqueta) */
  soft: string;
  /** Línea de color a la izquierda */
  accent: string;
}

const SEVERITY: Record<string, SeverityMeta> = {
  high: {
    label: "Alta",
    icon: ShieldAlert,
    text: "text-status-error",
    soft: "bg-status-error/10",
    accent: "border-l-status-error",
  },
  medium: {
    label: "Media",
    icon: TriangleAlert,
    text: "text-status-warning",
    soft: "bg-status-warning/10",
    accent: "border-l-status-warning",
  },
  low: {
    label: "Baja",
    icon: Info,
    text: "text-status-online",
    soft: "bg-status-online/10",
    accent: "border-l-status-online",
  },
};

export function severityMeta(severity: string): SeverityMeta {
  return (
    SEVERITY[severity] ?? {
      label: severity,
      icon: Info,
      text: "text-muted-foreground",
      soft: "bg-muted",
      accent: "border-l-border",
    }
  );
}

/** Cómo terminó un modo raid: "al cumplirse el tiempo", "(lo terminaste tú)"… */
export function describeLiftedBy(actor: string | undefined, currentUserId: string | null | undefined): string | null {
  if (!actor) return null;
  if (actor === "auto") return "al cumplirse el tiempo";
  if (actor === "restart") return "al reiniciarse el bot";
  if (actor === "manual") return "a mano";
  if (currentUserId && actor === currentUserId) return "(lo terminaste tú)";
  if (isSnowflake(actor)) return `(lo terminó el administrador con ID ${actor})`;
  return null;
}

/** Quién lo marcó como revisado: "(por ti)", "(por el administrador con ID …)". */
export function describeResolvedBy(actor: string | undefined, currentUserId: string | null | undefined): string | null {
  if (!actor) return null;
  if (currentUserId && actor === currentUserId) return "(por ti)";
  if (isSnowflake(actor)) return `(por el administrador con ID ${actor})`;
  return null;
}
