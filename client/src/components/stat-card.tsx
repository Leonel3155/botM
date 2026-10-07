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

/**
 * Tarjeta de dato: número grande en monoespaciada, etiqueta en mayúsculas e icono amarillo.
 * Nada se sale de la tarjeta aunque sea angosta (móvil de 360 px, 3 columnas junto al menú):
 * los textos largos pasan a la línea siguiente y, si el valor es texto, se ve entero al
 * pasar el cursor.
 */
export function StatCard({ title, value, icon: Icon, subtitle, loading, testId }: StatCardProps) {
  const valueTitle = typeof value === "string" || typeof value === "number" ? String(value) : undefined;

  return (
    <Card className="hover-elevate min-w-0">
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0 pb-2">
        <p className="min-w-0 break-words text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {title}
        </p>
        <Icon className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
      </CardHeader>
      <CardContent>
        <div className="flex min-w-0 flex-col gap-1">
          {loading ? (
            <Skeleton className="h-9 w-24 max-w-full" />
          ) : (
            <p
              className="min-w-0 break-words font-mono text-3xl font-bold leading-tight text-foreground [overflow-wrap:anywhere]"
              title={valueTitle}
              data-testid={testId}
            >
              {value}
            </p>
          )}
          {subtitle && <p className="min-w-0 break-words text-xs text-muted-foreground">{subtitle}</p>}
        </div>
      </CardContent>
    </Card>
  );
}
