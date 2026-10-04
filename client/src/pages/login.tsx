import { AlertCircle, Bot, Clock } from "lucide-react";
import { SiDiscord } from "react-icons/si";
import { useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { startLogin } from "@/lib/auth";

/** Errores con los que vuelve el callback de Discord (?error=...). */
const LOGIN_ERRORS: Record<string, { title: string; description: string }> = {
  invalid_state: {
    title: "El inicio de sesión caducó",
    description: "Tardó demasiado o empezó en otra pestaña. Vuelve a intentarlo desde aquí.",
  },
  access_denied: {
    title: "Cancelaste el permiso en Discord",
    description: "Para entrar al panel necesitamos que aceptes en Discord. Solo pedimos tu perfil y tu lista de servidores.",
  },
  auth_failed: {
    title: "Discord no pudo confirmar tu inicio de sesión",
    description: "Espera un momento y vuelve a intentarlo.",
  },
  no_code: {
    title: "Discord no devolvió el código de acceso",
    description: "Vuelve a intentarlo. Si sigue pasando, cierra la pestaña de Discord y empieza de nuevo.",
  },
};

const UNKNOWN_ERROR = {
  title: "No se pudo iniciar sesión",
  description: "Vuelve a intentarlo en un momento.",
};

interface LoginProps {
  /** Código de ?error= que dejó el callback de Discord */
  errorCode?: string | null;
  /** La sesión expiró mientras se usaba el panel */
  sessionExpired?: boolean;
}

export default function Login({ errorCode, sessionExpired }: LoginProps) {
  const [redirecting, setRedirecting] = useState(false);
  const error = errorCode ? LOGIN_ERRORS[errorCode] ?? UNKNOWN_ERROR : null;

  const handleLogin = () => {
    setRedirecting(true);
    startLogin();
  };

  return (
    <div className="flex min-h-svh items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-4 text-center">
          <div className="flex justify-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-lg bg-primary">
              <Bot className="h-10 w-10 text-primary-foreground" aria-hidden="true" />
            </div>
          </div>
          <div>
            <CardTitle className="text-2xl">BotM</CardTitle>
            <CardDescription className="mt-2">
              Inicia sesión con Discord para configurar el bot de tu servidor
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {error && (
            <Alert variant="destructive" data-testid="alert-login-error">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>{error.title}</AlertTitle>
              <AlertDescription>{error.description}</AlertDescription>
            </Alert>
          )}
          {!error && sessionExpired && (
            <Alert data-testid="alert-session-expired">
              <Clock className="h-4 w-4" />
              <AlertTitle>Tu sesión expiró</AlertTitle>
              <AlertDescription>Inicia sesión de nuevo para seguir donde ibas.</AlertDescription>
            </Alert>
          )}

          <Button
            onClick={handleLogin}
            disabled={redirecting}
            className="h-12 w-full gap-2 text-base font-semibold"
            size="lg"
            data-testid="button-discord-login"
          >
            <SiDiscord className="h-5 w-5" aria-hidden="true" />
            {redirecting ? "Abriendo Discord…" : "Iniciar sesión con Discord"}
          </Button>

          <p className="text-center text-xs text-muted-foreground">
            Solo pedimos ver tu perfil y la lista de tus servidores. El panel nunca publica nada en tu nombre.
          </p>

          {import.meta.env.DEV && (
            <p className="text-center text-xs text-muted-foreground">
              ¿Probando en local?{" "}
              <a href="/auth/dev-login" className="text-primary underline-offset-4 hover:underline">
                Entrar en modo desarrollo
              </a>{" "}
              (requiere DEV_BYPASS_AUTH=1)
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
