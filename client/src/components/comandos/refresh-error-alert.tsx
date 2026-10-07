import { AlertTriangle, LogIn, RefreshCw } from "lucide-react";
import { Link } from "wouter";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { InviteBotButton } from "@/components/invite-bot-button";
import { startLogin } from "@/lib/auth";
import { getApiErrorInfo } from "@/lib/queryClient";
import { cn } from "@/lib/utils";

interface RefreshErrorAlertProps {
  error: unknown;
  guildId: string;
  onRetry: () => void;
  /** Ya se está volviendo a pedir la lista. */
  retrying: boolean;
}

/**
 * Aviso para cuando falla una actualización pero ya tenemos la lista cargada: se queda lo
 * que se ve (y el diálogo abierto con lo que la persona escribió) en lugar de cambiar toda
 * la página por el error.
 */
export function RefreshErrorAlert({ error, guildId, onRetry, retrying }: RefreshErrorAlertProps) {
  const info = getApiErrorInfo(error);
  const canRetry = info.kind !== "forbidden" && info.kind !== "unauthorized";

  return (
    <Alert className="border-status-warning/40 bg-status-warning/10" role="status" data-testid="alert-refresh-error">
      <AlertTriangle className="h-4 w-4 !text-status-warning" aria-hidden="true" />
      <AlertTitle>No pudimos actualizar tus comandos</AlertTitle>
      <AlertDescription className="space-y-3">
        <p>
          {info.title}. {info.description} Mientras tanto ves lo último que cargamos, que puede no estar al día.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {info.kind === "botMissing" && <InviteBotButton guildId={guildId} size="sm" />}
          {info.kind === "forbidden" && (
            <Button asChild variant="outline" size="sm">
              <Link href="/servidores">Elegir otro servidor</Link>
            </Button>
          )}
          {info.kind === "unauthorized" && (
            <Button size="sm" onClick={startLogin}>
              <LogIn />
              Iniciar sesión
            </Button>
          )}
          {canRetry && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onRetry}
              disabled={retrying}
              data-testid="button-retry-refresh"
            >
              <RefreshCw className={cn(retrying && "animate-spin")} />
              {info.kind === "botMissing" ? "Ya lo invité" : "Reintentar"}
            </Button>
          )}
        </div>
      </AlertDescription>
    </Alert>
  );
}
