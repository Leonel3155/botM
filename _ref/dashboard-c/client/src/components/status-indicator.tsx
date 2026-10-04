import { cn } from "@/lib/utils";

interface StatusIndicatorProps {
  status: "online" | "warning" | "error" | "offline";
  label?: string;
  showLabel?: boolean;
  testId?: string;
}

const statusConfig = {
  online: {
    color: "bg-status-online",
    label: "Online",
  },
  warning: {
    color: "bg-status-warning",
    label: "Warning",
  },
  error: {
    color: "bg-status-error",
    label: "Error",
  },
  offline: {
    color: "bg-status-offline",
    label: "Offline",
  },
};

export function StatusIndicator({ 
  status, 
  label, 
  showLabel = true,
  testId 
}: StatusIndicatorProps) {
  const config = statusConfig[status];
  const displayLabel = label || config.label;

  return (
    <div className="flex items-center gap-2" data-testid={testId}>
      <div className={cn("h-2 w-2 rounded-full", config.color)} />
      {showLabel && (
        <span className="text-sm text-foreground">{displayLabel}</span>
      )}
    </div>
  );
}
