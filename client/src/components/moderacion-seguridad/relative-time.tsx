import { cn } from "@/lib/utils";
import { formatAbsolute, formatRelative, parseDate } from "./utils";

interface RelativeTimeProps {
  /** Texto ISO o milisegundos */
  value: string | number | null | undefined;
  /** Referencia para "hace…" (pásale useNow() para que se actualice sola) */
  now?: Date;
  /** Texto si la fecha falta o no es válida */
  fallback?: string;
  className?: string;
}

/** "hace 5 minutos", con la fecha completa al pasar el mouse. */
export function RelativeTime({ value, now, fallback = "Fecha desconocida", className }: RelativeTimeProps) {
  const date = parseDate(value);
  if (!date) return <span className={cn("text-muted-foreground", className)}>{fallback}</span>;

  const absolute = formatAbsolute(date);
  return (
    <time dateTime={date.toISOString()} title={absolute} className={className}>
      {formatRelative(date, now)}
    </time>
  );
}
