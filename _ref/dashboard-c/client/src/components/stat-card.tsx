import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type { LucideIcon } from "lucide-react";

interface StatCardProps {
  title: string;
  value: string | number;
  icon: LucideIcon;
  subtitle?: string;
  testId?: string;
}

export function StatCard({ title, value, icon: Icon, subtitle, testId }: StatCardProps) {
  return (
    <Card className="hover-elevate">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <p className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
          {title}
        </p>
        <Icon className="h-5 w-5 text-primary" />
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-1">
          <p 
            className="text-3xl font-bold font-mono text-foreground"
            data-testid={testId || `stat-${title.toLowerCase().replace(/\s+/g, '-')}`}
          >
            {value}
          </p>
          {subtitle && (
            <p className="text-xs text-muted-foreground">{subtitle}</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
