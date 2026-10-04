import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

interface StatCardProps {
  title: string;
  value: ReactNode;
  icon: LucideIcon;
  subtitle?: ReactNode;
  /** Muestra un esqueleto en lugar del número */
  loading?: boolean;
  testId?: string;
}

/** Tarjeta de dato: número grande en monoespaciada, etiqueta en mayúsculas e icono amarillo. */
export function StatCard({ title, value, icon: Icon, subtitle, loading, testId }: StatCardProps) {
  return (
    <Card className="hover-elevate">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</p>
        <Icon className="h-5 w-5 text-primary" aria-hidden="true" />
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-1">
          {loading ? (
            <Skeleton className="h-9 w-24" />
          ) : (
            <p className="font-mono text-3xl font-bold text-foreground" data-testid={testId}>
              {value}
            </p>
          )}
          {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
        </div>
      </CardContent>
    </Card>
  );
}
