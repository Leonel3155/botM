import { Fragment, type CSSProperties, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { Bot, Server } from "lucide-react";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AppSidebar } from "@/components/app-sidebar";
import { ApiErrorState } from "@/components/api-error-state";
import { EmptyState } from "@/components/empty-state";
import { GuildAvatar } from "@/components/guild-avatar";
import { InviteBotButton } from "@/components/invite-bot-button";
import { useGuild } from "@/lib/guild";
import { findNavItem } from "@/lib/navigation";
import { useRealtime, type RealtimeStatus } from "@/lib/websocket";
import { cn } from "@/lib/utils";

const sidebarStyle = {
  "--sidebar-width": "17rem",
  "--sidebar-width-icon": "3rem",
} as CSSProperties;

const realtimeLabels: Record<RealtimeStatus, { label: string; dot: string } | null> = {
  idle: null,
  connecting: { label: "Conectando…", dot: "bg-status-offline animate-pulse" },
  live: { label: "En vivo", dot: "bg-status-online" },
  reconnecting: { label: "Reconectando…", dot: "bg-status-warning animate-pulse" },
  denied: { label: "Sin avisos en vivo", dot: "bg-status-offline" },
};

/** Indicador de las actualizaciones en tiempo real (cabecera). */
export function RealtimeBadge({ status }: { status: RealtimeStatus }) {
  const config = realtimeLabels[status];
  if (!config) return null;
  return (
    <div
      className="flex items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1 text-xs text-muted-foreground"
      title="Actualizaciones en tiempo real del panel"
      data-testid="status-realtime"
    >
      <span className={cn("h-2 w-2 rounded-full", config.dot)} aria-hidden="true" />
      <span className="hidden sm:inline">{config.label}</span>
      <span className="sr-only sm:hidden">{config.label}</span>
    </div>
  );
}

/**
 * Estructura del panel: menú lateral (en móvil, panel deslizable), cabecera y contenido.
 * La conexión en tiempo real vive aquí: solo existe con sesión y servidor elegido.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const { selectedGuild } = useGuild();
  const realtimeStatus = useRealtime(selectedGuild?.id ?? null);
  const current = findNavItem(location);

  return (
    <SidebarProvider style={sidebarStyle}>
      <AppSidebar />
      <SidebarInset className="min-w-0 bg-background">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-border bg-background/85 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/70 md:px-6">
          <SidebarTrigger className="-ml-1" data-testid="button-sidebar-toggle" />
          <div className="flex min-w-0 flex-1 items-center gap-2 text-sm">
            {current && current.guildScoped && selectedGuild ? (
              <>
                <GuildAvatar guild={selectedGuild} size="xs" className="hidden sm:flex" />
                <span className="hidden truncate text-muted-foreground sm:inline">{selectedGuild.name}</span>
                <span className="hidden text-muted-foreground sm:inline" aria-hidden="true">/</span>
                <span className="truncate font-medium text-foreground">{current.title}</span>
              </>
            ) : (
              <span className="truncate font-medium text-foreground">{current?.title ?? "BotM"}</span>
            )}
          </div>
          <RealtimeBadge status={realtimeStatus} />
        </header>
        {/* SidebarInset ya es el <main> de la página */}
        <div className="flex-1">
          <div className="mx-auto w-full max-w-7xl p-4 md:p-8">{children}</div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}

/** Aviso cuando el bot no está en el servidor elegido (las páginas siguen visibles). */
function BotMissingBanner({ guildId, guildName }: { guildId: string; guildName: string }) {
  return (
    <div
      className="mb-6 flex flex-col gap-3 rounded-lg border border-status-warning/40 bg-status-warning/10 p-4 sm:flex-row sm:items-center sm:justify-between"
      role="status"
      data-testid="banner-bot-missing"
    >
      <div className="flex items-start gap-3">
        <Bot className="mt-0.5 h-5 w-5 shrink-0 text-status-warning" aria-hidden="true" />
        <div>
          <p className="text-sm font-medium text-foreground">El bot no está en {guildName}</p>
          <p className="text-sm text-muted-foreground">
            Invítalo para que funcione aquí. Hasta entonces no podrás guardar cambios en este servidor.
          </p>
        </div>
      </div>
      <InviteBotButton guildId={guildId} size="sm" className="shrink-0" />
    </div>
  );
}

function BotOfflineBanner() {
  return (
    <div
      className="mb-6 flex items-start gap-3 rounded-lg border border-status-warning/40 bg-status-warning/10 p-4"
      role="status"
      data-testid="banner-bot-offline"
    >
      <Bot className="mt-0.5 h-5 w-5 shrink-0 text-status-warning" aria-hidden="true" />
      <div>
        <p className="text-sm font-medium text-foreground">El bot está desconectado de Discord</p>
        <p className="text-sm text-muted-foreground">
          Lo intenta de nuevo solo. Si sigue así, revisa la consola donde corre el bot. Hasta que vuelva no podrás guardar cambios.
        </p>
      </div>
    </div>
  );
}

export function PageSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Cargando">
      <div className="space-y-2">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-32 rounded-xl" />
        ))}
      </div>
    </div>
  );
}

/**
 * Para las páginas de un servidor: espera a tener la lista de servidores y uno
 * elegido. Al cambiar de servidor la página se monta de nuevo (sin datos del anterior).
 */
export function RequireGuild({ children }: { children: ReactNode }) {
  const { isLoading, error, guilds, selectedGuild, refetch } = useGuild();

  if (isLoading) return <PageSkeleton />;

  if (error && guilds.length === 0) {
    return <ApiErrorState error={error} onRetry={refetch} />;
  }

  if (!selectedGuild) {
    return (
      <EmptyState
        icon={Server}
        title="Aún no hay servidores que puedas configurar"
        description="Para usar el panel necesitas ser dueño de un servidor de Discord o tener ahí el permiso de Administrador o Gestionar servidor."
        action={
          <Button asChild variant="outline">
            <Link href="/servidores">Ver servidores</Link>
          </Button>
        }
      />
    );
  }

  return (
    <Fragment key={selectedGuild.id}>
      {!selectedGuild.botOnline ? (
        <BotOfflineBanner />
      ) : (
        !selectedGuild.botInGuild && <BotMissingBanner guildId={selectedGuild.id} guildName={selectedGuild.name} />
      )}
      {children}
    </Fragment>
  );
}
