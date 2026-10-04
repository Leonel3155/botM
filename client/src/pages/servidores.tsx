import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { Bot, Check, Crown, RefreshCw, Search, Server, Settings2, ShieldCheck, UserPlus } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiErrorState } from "@/components/api-error-state";
import { EmptyState } from "@/components/empty-state";
import { GuildAvatar } from "@/components/guild-avatar";
import { InviteBotButton } from "@/components/invite-bot-button";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { useGuild, type UserGuild } from "@/lib/guild";
import { canBuildInviteUrl } from "@/lib/invite";
import { cn } from "@/lib/utils";

function ServerCard({
  guild,
  selected,
  onConfigure,
}: {
  guild: UserGuild;
  selected: boolean;
  onConfigure: () => void;
}) {
  return (
    <Card
      className={cn("flex flex-col", selected && "border-primary/70")}
      data-testid={`card-server-${guild.id}`}
    >
      <CardHeader className="flex flex-row items-start gap-3 space-y-0">
        <GuildAvatar guild={guild} size="md" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-foreground" title={guild.name}>
            {guild.name}
          </p>
          <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">ID: {guild.id}</p>
        </div>
        {guild.botInGuild ? (
          <Badge className="shrink-0">Bot activo</Badge>
        ) : (
          <Badge variant="outline" className="shrink-0 text-muted-foreground">
            Sin bot
          </Badge>
        )}
      </CardHeader>
      <CardContent className="mt-auto space-y-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          {guild.owner ? (
            <>
              <Crown className="h-4 w-4 text-primary" aria-hidden="true" />
              Eres el dueño
            </>
          ) : (
            <>
              <ShieldCheck className="h-4 w-4 text-primary" aria-hidden="true" />
              Eres administrador
            </>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {guild.botInGuild ? (
            selected ? (
              <Button variant="secondary" onClick={onConfigure} data-testid={`button-configure-${guild.id}`}>
                <Check />
                Seleccionado · ir al resumen
              </Button>
            ) : (
              <Button onClick={onConfigure} data-testid={`button-configure-${guild.id}`}>
                <Settings2 />
                Configurar
              </Button>
            )
          ) : (
            <InviteBotButton guildId={guild.id} />
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function Servidores() {
  const { guilds, isLoading, isFetching, error, refetch, selectedGuildId, selectGuild } = useGuild();
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return guilds;
    return guilds.filter((g) => g.name.toLowerCase().includes(term) || g.id.includes(term));
  }, [guilds, search]);

  const withBot = guilds.filter((g) => g.botInGuild).length;
  const withoutBot = guilds.length - withBot;

  const header = (
    <PageHeader
      title="Servidores"
      description="Los servidores de Discord que puedes administrar (eres dueño o tienes Administrador / Gestionar servidor)."
      actions={
        <Button variant="outline" onClick={refetch} disabled={isFetching} data-testid="button-refresh-servers">
          <RefreshCw className={cn(isFetching && "animate-spin")} />
          Actualizar
        </Button>
      }
    />
  );

  if (isLoading) {
    return (
      <div className="space-y-6">
        {header}
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-44 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  if (error && guilds.length === 0) {
    return (
      <div className="space-y-6">
        {header}
        <ApiErrorState error={error} onRetry={refetch} />
      </div>
    );
  }

  if (guilds.length === 0) {
    return (
      <div className="space-y-6">
        {header}
        <EmptyState
          icon={Server}
          title="No administras ningún servidor"
          description="Aquí aparecen los servidores donde eres dueño o tienes el permiso de Administrador o Gestionar servidor. Si acabas de recibir ese permiso, pulsa Actualizar."
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {header}

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
        <StatCard title="Tus servidores" value={guilds.length} icon={Server} subtitle="Que puedes administrar" testId="stat-total-servers" />
        <StatCard title="Con el bot" value={withBot} icon={Bot} subtitle="Listos para configurar" testId="stat-with-bot" />
        <StatCard title="Sin el bot" value={withoutBot} icon={UserPlus} subtitle="Invítalo para empezar" testId="stat-without-bot" />
      </div>

      {withoutBot > 0 && !canBuildInviteUrl() && (
        <Alert>
          <UserPlus className="h-4 w-4" />
          <AlertTitle>Falta configurar el enlace de invitación</AlertTitle>
          <AlertDescription>
            Para que funcione el botón "Invitar bot", define <code className="font-mono">VITE_DISCORD_CLIENT_ID</code> con
            el Application ID del bot (ver <code className="font-mono">client/.env.example</code>).
          </AlertDescription>
        </Alert>
      )}

      {guilds.length > 6 && (
        <div className="relative max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Buscar por nombre o ID…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
            aria-label="Buscar servidor"
            data-testid="input-search-servers"
          />
        </div>
      )}

      {filtered.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((guild) => (
            <ServerCard
              key={guild.id}
              guild={guild}
              selected={guild.id === selectedGuildId}
              onConfigure={() => {
                selectGuild(guild.id);
                navigate("/");
              }}
            />
          ))}
        </div>
      ) : (
        <EmptyState icon={Search} title="Ningún servidor coincide" description="Prueba con otro nombre o ID." />
      )}

      {withoutBot > 0 && (
        <p className="text-xs text-muted-foreground">
          Después de invitar al bot, vuelve a esta pestaña o pulsa Actualizar para verlo como "Bot activo".
        </p>
      )}
    </div>
  );
}
