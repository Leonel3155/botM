import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { isChunkLoadError, reloadOnceForChunkError } from "@/lib/chunk-reload";
import { cn } from "@/lib/utils";

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Al cambiar (p. ej. la ruta) se vuelve a intentar mostrar el contenido */
  resetKey?: unknown;
  /** "section": tarjeta dentro del panel (el menú sigue usable). "fullscreen": toda la pantalla */
  variant?: "section" | "fullscreen";
}

interface ErrorBoundaryState {
  error: unknown;
  hasError: boolean;
  reloading: boolean;
}

/**
 * Evita la pantalla en blanco si una sección falla al descargarse (panel
 * actualizado con la pestaña abierta, corte de red) o al dibujarse. En el
 * primer caso recarga la página una vez sola; si no, muestra un aviso con
 * "Recargar".
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null, hasError: false, reloading: false };

  static getDerivedStateFromError(error: unknown): Partial<ErrorBoundaryState> {
    return { error, hasError: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    if (isChunkLoadError(error)) {
      if (reloadOnceForChunkError()) this.setState({ reloading: true });
      return;
    }
    console.error("[PANEL] Error al mostrar la sección:", error, info.componentStack);
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps, prevState: ErrorBoundaryState) {
    // prevState.hasError: si el error llegó junto con el cambio de ruta (al abrir una
    // sección que falla), no lo borramos en ese mismo momento: fallaría otra vez igual.
    if (
      this.state.hasError &&
      prevState.hasError &&
      !this.state.reloading &&
      prevProps.resetKey !== this.props.resetKey
    ) {
      this.setState({ error: null, hasError: false });
    }
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <ErrorFallback
        chunkError={isChunkLoadError(this.state.error)}
        reloading={this.state.reloading}
        variant={this.props.variant ?? "section"}
      />
    );
  }
}

function ErrorFallback({
  chunkError,
  reloading,
  variant,
}: {
  chunkError: boolean;
  reloading: boolean;
  variant: "section" | "fullscreen";
}) {
  const fullscreen = variant === "fullscreen";

  const title = reloading
    ? "Recargando el panel…"
    : chunkError
      ? "No se pudo cargar esta sección"
      : "Algo salió mal al mostrar esta sección";

  const description = reloading
    ? "No se pudo cargar esta sección (puede que el panel se haya actualizado). Recargamos la página para traer la versión más reciente."
    : chunkError
      ? "Puede que el panel se haya actualizado o que se haya cortado la conexión. Recarga la página para continuar."
      : fullscreen
        ? "Recarga la página para intentarlo de nuevo."
        : "Recarga la página para intentarlo de nuevo. También puedes ir a otra sección desde el menú.";

  const content = (
    <div className="flex flex-col items-center justify-center px-4 py-12 text-center" role="alert" data-testid="error-boundary">
      <div
        className={cn(
          "mb-4 flex h-12 w-12 items-center justify-center rounded-full",
          reloading ? "bg-primary/10 text-primary" : "bg-destructive/10 text-destructive",
        )}
      >
        {reloading ? (
          <Loader2 className="h-6 w-6 animate-spin" aria-hidden="true" />
        ) : (
          <AlertTriangle className="h-6 w-6" aria-hidden="true" />
        )}
      </div>
      <h3 className="text-base font-semibold text-foreground">{title}</h3>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">{description}</p>
      {!reloading && (
        <div className="mt-6">
          <Button onClick={() => window.location.reload()} data-testid="button-reload">
            <RefreshCw />
            Recargar
          </Button>
        </div>
      )}
    </div>
  );

  const card = (
    <Card className={cn(reloading ? "border-primary/40" : "border-destructive/40", fullscreen && "w-full max-w-lg")}>
      <CardContent className="p-0">{content}</CardContent>
    </Card>
  );

  if (!fullscreen) return card;
  return <div className="flex min-h-svh items-center justify-center bg-background p-4">{card}</div>;
}
