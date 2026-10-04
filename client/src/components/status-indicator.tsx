import { cn } from "@/lib/utils";

export type StatusKind = "online" | "success" | "warning" | "error" | "offline" | "pending";

interface StatusIndicatorProps {
  status: StatusKind;
  label?: string;
  showLabel?: boolean;
  className?: string;
  testId?: string;
}

const statusConfig: Record<StatusKind, { color: string; label: string }> = {
  online: { color: "bg-status-online", label: "En línea" },
  success: { color: "bg-status-success", label: "Correcto" },
  warning: { color: "bg-status-warning", label: "Atención" },
  error: { color: "bg-status-error", label: "Con problemas" },
  offline: { color: "bg-status-offline", label: "Desconectado" },
  pending: { color: "bg-status-offline animate-pulse", label: "Comprobando…" },
};

/** Punto de color + texto (estilo Dark Knight: amarillo = en línea). */
export function StatusIndicator({ status, label, showLabel = true, className, testId }: StatusIndicatorProps) {
  const config = statusConfig[status];
  return (
    <div className={cn("flex items-center gap-2", className)} data-testid={testId}>
      <span className={cn("h-2 w-2 shrink-0 rounded-full", config.color)} aria-hidden="true" />
      {showLabel ? (
        <span className="text-sm text-foreground">{label ?? config.label}</span>
      ) : (
        <span className="sr-only">{label ?? config.label}</span>
      )}
    </div>
  );
}
