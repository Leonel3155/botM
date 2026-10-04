import { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface StatsCardProps {
  title: string;
  value: string | number;
  icon: ReactNode;
  trend?: {
    value: string;
    label: string;
    positive: boolean;
  };
  className?: string;
  'data-testid'?: string;
}

export default function StatsCard({ 
  title, 
  value, 
  icon, 
  trend, 
  className,
  'data-testid': testId
}: StatsCardProps) {
  return (
    <div className={cn("stats-card", className)} data-testid={testId}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-discord-muted text-sm font-medium" data-testid={`text-${testId}-title`}>
            {title}
          </p>
          <p className="text-2xl font-bold text-white mt-1" data-testid={`text-${testId}-value`}>
            {value}
          </p>
        </div>
        <div className="bg-opacity-20 p-3 rounded-lg">
          {icon}
        </div>
      </div>
      {trend && (
        <div className="flex items-center mt-3">
          <span 
            className={cn(
              "text-sm",
              trend.positive ? "text-discord-success" : "text-discord-error"
            )}
            data-testid={`text-${testId}-trend-value`}
          >
            {trend.positive ? "+" : ""}{trend.value}
          </span>
          <span className="text-discord-muted text-sm ml-2" data-testid={`text-${testId}-trend-label`}>
            {trend.label}
          </span>
        </div>
      )}
    </div>
  );
}
