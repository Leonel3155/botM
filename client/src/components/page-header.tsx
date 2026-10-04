import type { ReactNode } from "react";

interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  /** Icono o avatar a la izquierda del título */
  leading?: ReactNode;
  /** Botones a la derecha (debajo en móvil) */
  actions?: ReactNode;
}

/** Encabezado de página del panel: título grande, descripción gris y acciones. */
export function PageHeader({ title, description, leading, actions }: PageHeaderProps) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 items-center gap-4">
        {leading}
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-bold text-foreground md:text-3xl" data-testid="text-page-title">
            {title}
          </h1>
          {description && <p className="mt-1 text-sm text-muted-foreground md:text-base">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
