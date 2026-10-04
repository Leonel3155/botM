import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusIndicator, type StatusKind } from "@/components/status-indicator";
import { cn } from "@/lib/utils";

export interface SectionStatus {
  kind: StatusKind;
  text: string;
}

interface SectionHeaderProps {
  icon: LucideIcon;
  title: string;
  description: string;
  /** Esta sección tiene cambios sin guardar */
  dirty: boolean;
  /** Interruptor de encendido (va a la derecha) */
  toggle: ReactNode;
  /** Cómo está funcionando ahora mismo (lo guardado) */
  status: SectionStatus;
  testId: string;
}

/** Cabecera de cada tarjeta: icono, título, interruptor y estado actual. */
export function SectionHeader({ icon: Icon, title, description, dirty, toggle, status, testId }: SectionHeaderProps) {
  return (
    <CardHeader className="gap-4 space-y-0 p-4 sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10">
            <Icon className="h-5 w-5 text-primary" aria-hidden="true" />
          </div>
          <div className="min-w-0 space-y-1.5">
            <CardTitle className="flex flex-wrap items-center gap-2 text-lg md:text-xl">
              {title}
              {dirty && (
                <Badge variant="outline" className="border-primary/60 font-medium text-primary">
                  Sin guardar
                </Badge>
              )}
            </CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
        </div>
        <div className="shrink-0">{toggle}</div>
      </div>
      <div
        className="flex flex-col gap-1 rounded-lg border border-border bg-background/40 px-3 py-2.5 sm:flex-row sm:items-center sm:gap-3"
        data-testid={testId}
      >
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Ahora mismo</span>
        <StatusIndicator status={status.kind} label={status.text} className="items-start [&>span:first-child]:mt-1.5" />
      </div>
    </CardHeader>
  );
}

/** Aviso amarillo en línea (permisos que faltan, canal borrado...). */
export function InlineWarning({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn("flex items-start gap-1.5 text-sm text-status-warning", className)}>
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

/** Fila "dato: valor" de los paneles de información. */
export function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 py-2.5">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="text-sm text-foreground">{children}</dd>
    </div>
  );
}
