import { Check, ChevronsUpDown, RefreshCw, Server } from "lucide-react";
import { useLocation } from "wouter";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { GuildAvatar } from "@/components/guild-avatar";
import { useGuild } from "@/lib/guild";
import { getApiErrorInfo } from "@/lib/queryClient";
import { cn } from "@/lib/utils";

interface ServerSwitcherProps {
  /** Se llama tras elegir (en móvil cierra el menú lateral) */
  onNavigate?: () => void;
}

/** Selector del servidor que se está configurando (arriba del menú lateral). */
export function ServerSwitcher({ onNavigate }: ServerSwitcherProps) {
  const { guilds, isLoading, error, refetch, selectedGuild, selectGuild } = useGuild();
  const [, navigate] = useLocation();

  if (isLoading) {
    return (
      <div className="flex items-center gap-3 rounded-md border border-sidebar-border p-2">
        <Skeleton className="h-8 w-8 rounded-lg" />
        <div className="flex-1 space-y-1.5">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-2.5 w-16" />
        </div>
      </div>
    );
  }

  if (error && guilds.length === 0) {
    return (
      <div className="rounded-md border border-sidebar-border p-3 text-xs text-muted-foreground">
        <p>{getApiErrorInfo(error).title}</p>
        <button
          type="button"
          onClick={refetch}
          className="mt-2 inline-flex items-center gap-1 font-medium text-primary hover:underline"
        >
          <RefreshCw className="h-3 w-3" />
          Reintentar
        </button>
      </div>
    );
  }

  if (!selectedGuild) {
    return (
      <button
        type="button"
        onClick={() => {
          navigate("/servidores");
          onNavigate?.();
        }}
        className="flex w-full items-center gap-3 rounded-md border border-dashed border-sidebar-border p-2 text-left text-sm text-muted-foreground hover-elevate"
      >
        <Server className="h-4 w-4" />
        No tienes servidores para administrar
      </button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-3 rounded-md border border-sidebar-border bg-sidebar-accent/40 p-2 text-left outline-none hover-elevate focus-visible:ring-2 focus-visible:ring-sidebar-ring"
          data-testid="button-server-switcher"
        >
          <GuildAvatar guild={selectedGuild} size="sm" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-sidebar-foreground">{selectedGuild.name}</p>
            <p className={cn("text-xs", selectedGuild.botInGuild ? "text-muted-foreground" : "text-status-warning")}>
              {selectedGuild.botInGuild ? "Servidor actual" : selectedGuild.botOnline ? "El bot no está aquí" : "Bot desconectado"}
            </p>
          </div>
          <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[--radix-dropdown-menu-trigger-width] min-w-64">
        <DropdownMenuLabel className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Tus servidores
        </DropdownMenuLabel>
        <div className="max-h-72 overflow-y-auto">
          {guilds.map((guild) => (
            <DropdownMenuItem
              key={guild.id}
              onSelect={() => {
                selectGuild(guild.id);
                onNavigate?.();
              }}
              className="gap-3"
              data-testid={`item-guild-${guild.id}`}
            >
              <GuildAvatar guild={guild} size="xs" />
              <span className="min-w-0 flex-1 truncate">{guild.name}</span>
              {!guild.botInGuild && guild.botOnline && (
                <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  Sin bot
                </span>
              )}
              {guild.id === selectedGuild.id && <Check className="h-4 w-4 shrink-0 text-primary" />}
            </DropdownMenuItem>
          ))}
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => {
            navigate("/servidores");
            onNavigate?.();
          }}
          className="gap-3"
        >
          <Server className="h-4 w-4 text-muted-foreground" />
          Ver todos e invitar al bot
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
