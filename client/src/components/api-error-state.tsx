import { AlertCircle, Bot, Clock, LogIn, RefreshCw, ShieldOff, WifiOff } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { InviteBotButton } from "@/components/invite-bot-button";
import { startLogin } from "@/lib/auth";
import { useSelectedGuildId } from "@/lib/guild";
import { getApiErrorInfo, isRateLimitError } from "@/lib/queryClient";
import { cn } from "@/lib/utils";

interface ApiErrorStateProps {
  error: unknown;
  /** Si se pasa, aparece "Reintentar" en los errores que pueden pasar solos */
  onRetry?: () => void;
  /** Sin tarjeta alrededor (para usarlo dentro de otra tarjeta) */
  bare?: boolean;
  className?: string;
}

/**
 * Muestra un error de la API con un texto amable y la acción que corresponde:
 * - 401 → volver a iniciar sesión
 * - 403 { forbidden } → "No tienes permisos de administrador en este servidor"
 * - 404 { botMissing } → "El bot no está en este servidor" + Invitar bot
 * - 503 → "El bot no está disponible ahora, intenta en un momento" + Reintentar
 * - 429, o 503 porque Discord está limitando → "Espera un momento" con el texto del servidor + Reintentar
 */
export function ApiErrorState({ error, onRetry, bare = false, className }: ApiErrorStateProps) {
  const info = getApiErrorInfo(error);
  const rateLimited = isRateLimitError(error);
  const guildId = useSelectedGuildId();

  const Icon =
    info.kind === "botMissing" ? Bot
    : info.kind === "forbidden" ? ShieldOff
    : info.kind === "network" ? WifiOff
    : info.kind === "unauthorized" ? LogIn
    : rateLimited ? Clock
    : AlertCircle;

  // Basta con esperar: aviso en amarillo, no error en rojo
  const isWarning = info.kind === "botMissing" || info.kind === "unavailable" || rateLimited;
  const canRetry = onRetry && info.kind !== "forbidden" && info.kind !== "unauthorized" && info.kind !== "botMissing";

  const content = (
    <div
      className={cn("flex flex-col items-center justify-center px-4 text-center", bare ? "py-8" : "py-12")}
      role="alert"
      data-testid={`error-${info.kind}`}
    >
      <div
        className={cn(
          "mb-4 flex h-12 w-12 items-center justify-center rounded-full",
          isWarning ? "bg-status-warning/10 text-status-warning" : "bg-destructive/10 text-destructive",
        )}
      >
        <Icon className="h-6 w-6" aria-hidden="true" />
      </div>
      <h3 className="text-base font-semibold text-foreground">{info.title}</h3>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">{info.description}</p>

      <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
        {info.kind === "botMissing" && <InviteBotButton guildId={guildId} />}
        {info.kind === "botMissing" && onRetry && (
          <Button variant="outline" onClick={onRetry} data-testid="button-retry">
            <RefreshCw />
            Ya lo invité
          </Button>
        )}
        {info.kind === "forbidden" && (
          <Button asChild variant="outline">
            <Link href="/servidores">Elegir otro servidor</Link>
          </Button>
        )}
        {info.kind === "unauthorized" && (
          <Button onClick={startLogin}>
            <LogIn />
            Iniciar sesión
          </Button>
        )}
        {canRetry && (
          <Button variant="outline" onClick={onRetry} data-testid="button-retry">
            <RefreshCw />
            Reintentar
          </Button>
        )}
      </div>
    </div>
  );

  if (bare) return <div className={className}>{content}</div>;
  return (
    <Card className={cn(isWarning ? "border-status-warning/40" : "border-destructive/40", className)}>
      <CardContent className="p-0">{content}</CardContent>
    </Card>
  );
}
