import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Inbox } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  title: string;
  description?: ReactNode;
  icon?: LucideIcon;
  /** Botones o enlaces debajo del texto */
  action?: ReactNode;
  /** Sin tarjeta alrededor (para usarlo dentro de otra tarjeta) */
  bare?: boolean;
  className?: string;
  testId?: string;
}

/**
 * Estado vacío honesto: "Aún no hay datos…". Úsalo en vez de inventar números
 * cuando algo todavía no se recoge o no hay registros.
 */
export function EmptyState({
  title,
  description,
  icon: Icon = Inbox,
  action,
  bare = false,
  className,
  testId,
}: EmptyStateProps) {
  const content = (
    <div
      className={cn("flex flex-col items-center justify-center px-4 text-center", bare ? "py-8" : "py-12")}
      data-testid={testId}
    >
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-border bg-muted">
        <Icon className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
      </div>
      <h3 className="text-base font-semibold text-foreground">{title}</h3>
      {description && <div className="mt-2 max-w-md text-sm text-muted-foreground">{description}</div>}
      {action && <div className="mt-6 flex flex-wrap items-center justify-center gap-2">{action}</div>}
    </div>
  );

  if (bare) return <div className={className}>{content}</div>;
  return (
    <Card className={className}>
      <CardContent className="p-0">{content}</CardContent>
    </Card>
  );
}
