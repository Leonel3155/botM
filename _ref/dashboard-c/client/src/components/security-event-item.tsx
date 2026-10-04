import { formatDistanceToNow } from "date-fns";
import type { SecurityEvent } from "@shared/schema";
import { AlertCircle, Info, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

interface SecurityEventItemProps {
  event: SecurityEvent;
  testId?: string;
}

const severityConfig = {
  info: {
    icon: Info,
    color: "text-status-online",
    bgColor: "bg-status-online/10",
  },
  warning: {
    icon: AlertTriangle,
    color: "text-status-warning",
    bgColor: "bg-status-warning/10",
  },
  error: {
    icon: AlertCircle,
    color: "text-status-error",
    bgColor: "bg-status-error/10",
  },
};

export function SecurityEventItem({ event, testId }: SecurityEventItemProps) {
  const config = severityConfig[event.severity as keyof typeof severityConfig] || severityConfig.info;
  const Icon = config.icon;

  return (
    <div 
      className="flex items-start gap-3 py-3 border-b border-border last:border-0"
      data-testid={testId || `event-${event.id}`}
    >
      <div className={cn("rounded-full p-2 mt-0.5", config.bgColor)}>
        <Icon className={cn("h-4 w-4", config.color)} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground">
          {event.description}
        </p>
        <div className="flex items-center gap-3 mt-1">
          <span className="text-xs text-muted-foreground font-mono">
            {formatDistanceToNow(new Date(event.timestamp), { addSuffix: true })}
          </span>
          {event.ipAddress && (
            <span className="text-xs text-muted-foreground font-mono">
              {event.ipAddress}
            </span>
          )}
        </div>
      </div>
      <span className={cn(
        "text-xs px-2 py-1 rounded-md font-medium uppercase tracking-wide",
        config.bgColor,
        config.color
      )}>
        {event.severity}
      </span>
    </div>
  );
}
