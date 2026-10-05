import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { ChevronDown, Table2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/** Color de las barras: el amarillo "Dark Knight" (una sola serie por gráfica). */
export const CHART_COLOR = "hsl(var(--chart-1))";

interface ChartCardProps {
  title: string;
  description?: ReactNode;
  icon: LucideIcon;
  /** Resumen en texto de lo que muestra la gráfica (para lectores de pantalla). */
  summary?: string;
  /** Tabla con los mismos datos (se abre con "Ver los datos en tabla"). */
  table?: ReactNode;
  /** Se está actualizando: la gráfica se queda, un poco atenuada (sin saltos). */
  refreshing?: boolean;
  className?: string;
  testId?: string;
  children: ReactNode;
}

/** Tarjeta de una gráfica: título, la gráfica, su resumen accesible y la vista de tabla. */
export function ChartCard({
  title,
  description,
  icon: Icon,
  summary,
  table,
  refreshing = false,
  className,
  testId,
  children,
}: ChartCardProps) {
  return (
    <Card className={cn("flex min-w-0 flex-col", className)} data-testid={testId}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-xl">
          <Icon className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
          {title}
        </CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-4">
        <figure className={cn("min-w-0 transition-opacity duration-150", refreshing && "opacity-60")} aria-busy={refreshing}>
          {children}
          {summary && <figcaption className="sr-only">{summary}</figcaption>}
        </figure>
        {table && (
          <details className="group mt-auto rounded-md border border-border">
            <summary className="flex cursor-pointer select-none list-none items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
              <Table2 className="h-4 w-4" aria-hidden="true" />
              Ver los datos en tabla
              <ChevronDown className="ml-auto h-4 w-4 transition-transform group-open:rotate-180" aria-hidden="true" />
            </summary>
            <div className="max-h-80 overflow-auto border-t border-border">{table}</div>
          </details>
        )}
      </CardContent>
    </Card>
  );
}

export interface TooltipRow {
  label: string;
  value: string;
  /** Muestra la rayita de color de la serie */
  color?: string;
}

/** Contenido del tooltip de las gráficas: el valor primero (resaltado) y luego qué es. */
export function ChartTooltipBox({ title, rows }: { title: string; rows: TooltipRow[] }) {
  return (
    <div className="min-w-[9rem] max-w-[16rem] rounded-lg border border-popover-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-xl">
      <p className="mb-1.5 font-medium text-muted-foreground">{title}</p>
      <div className="space-y-1">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center gap-2">
            {row.color && (
              <span className="h-0.5 w-3 shrink-0 rounded-full" style={{ backgroundColor: row.color }} aria-hidden="true" />
            )}
            <span className="font-mono font-semibold text-foreground">{row.value}</span>
            <span className="truncate text-muted-foreground">{row.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
