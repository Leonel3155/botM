import type { ReactNode } from "react";
import { Link } from "wouter";
import { Lightbulb, MessageSquareText, Terminal } from "lucide-react";
import { CUSTOM_COMMAND_LIMITS } from "@shared/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

function Step({ number, children }: { number: number; children: ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15 font-mono text-xs font-bold text-primary"
        aria-hidden="true"
      >
        {number}
      </span>
      <span className="min-w-0 pt-0.5 text-sm text-foreground">{children}</span>
    </li>
  );
}

interface HowToCardProps {
  prefix: string;
  /** Un comando real y activo del servidor para el ejemplo (null = "nombre"). */
  exampleName: string | null;
  className?: string;
}

/** Explica cómo se usan los comandos en Discord (con el prefijo real del servidor). */
export function HowToCard({ prefix, exampleName, className }: HowToCardProps) {
  const example = `${prefix}${exampleName ?? "nombre"}`;
  return (
    <Card className={className} data-testid="card-how-to">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageSquareText className="h-5 w-5 text-primary" aria-hidden="true" />
          Cómo se usan en Discord
        </CardTitle>
        <CardDescription>El bot contesta por ti con el texto que dejes listo aquí.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <ol className="space-y-3">
          <Step number={1}>Crea el comando: un nombre corto y lo que quieres que conteste el bot.</Step>
          <Step number={2}>
            Cualquiera escribe <code className="break-all rounded bg-muted px-1.5 py-0.5 font-mono text-primary">{example}</code>{" "}
            en un canal donde el bot pueda escribir.
          </Step>
          <Step number={3}>
            El bot responde al momento. Cada persona puede usar un comando cada{" "}
            {CUSTOM_COMMAND_LIMITS.cooldownSeconds} segundos, para que nadie llene el chat.
          </Step>
        </ol>
        <div className="space-y-2 border-t border-border pt-4 text-xs text-muted-foreground">
          <p>
            Tu prefijo es <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-primary">{prefix}</code>. Si lo
            cambias en{" "}
            <Link href="/ajustes" className="font-medium text-primary underline-offset-4 hover:underline">
              Ajustes
            </Link>
            , los comandos se usarán con el nuevo.
          </p>
          <p className="flex items-start gap-1.5">
            <Lightbulb className="mt-px h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
            <span>
              Estos comandos no salen en <code className="font-mono text-foreground">{prefix}ayuda</code>: cuéntale a tu
              comunidad cuáles hay (por ejemplo, en el canal de reglas).
            </span>
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

interface UsageCardProps {
  used: number;
  max: number;
  enabled: number;
  className?: string;
}

/** Cuántos comandos lleva el servidor de los que permite el bot. */
export function UsageCard({ used, max, enabled, className }: UsageCardProps) {
  const atLimit = used >= max;
  const percent = max > 0 ? Math.min(100, Math.round((used / max) * 100)) : 0;
  return (
    <Card className={cn("hover-elevate", className)} data-testid="card-usage">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Comandos creados</p>
        <Terminal className="h-5 w-5 text-primary" aria-hidden="true" />
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="font-mono text-3xl font-bold text-foreground" data-testid="text-commands-used">
          {used}
          <span className="text-lg font-medium text-muted-foreground"> / {max}</span>
        </p>
        <Progress
          value={percent}
          className={cn("h-2", atLimit && "[&>div]:bg-status-warning")}
          aria-label={`${used} de ${max} comandos usados`}
        />
        <p className="text-xs text-muted-foreground">
          {used} de {max} usados
          {used > 0 && (
            <>
              {" · "}
              {enabled === used ? "todos activos" : enabled === 1 ? "1 activo" : `${enabled} activos`}
            </>
          )}
        </p>
        {atLimit && (
          <p className="text-xs text-status-warning" role="status">
            Llegaste al máximo. Borra uno que ya no uses para crear otro.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
