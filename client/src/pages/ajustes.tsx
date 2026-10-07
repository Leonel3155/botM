import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  ArrowRight,
  BarChart3,
  Bot,
  Coins,
  Hash,
  Loader2,
  LogOut,
  MessageCircleHeart,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import type { GuildConfigResponse } from "@shared/api";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { InviteBotButton } from "@/components/invite-bot-button";
import { PageHeader } from "@/components/page-header";
import {
  BotDetailRows,
  DetailRow,
  getBotPresence,
  getBotStatus,
  useDashboardStats,
} from "@/components/ajustes-resumen/bot-status";
import { formatDurationLong } from "@/components/ajustes-resumen/format";
import { guildConfigKey, PrefixCard } from "@/components/ajustes-resumen/prefix-card";
import { useToast } from "@/hooks/use-toast";
import { displayName, initials, useAuthStatus, useLogout, userAvatarUrl } from "@/lib/auth";
import { useSelectedGuild, type UserGuild } from "@/lib/guild";
import { getApiErrorInfo } from "@/lib/queryClient";
import { cn } from "@/lib/utils";

// =============================================
// Lo demás se configura en su propia sección
// =============================================

interface SectionLink {
  title: string;
  description: string;
  icon: LucideIcon;
  href: string;
  linkLabel: string;
  /** Interruptor de GET /api/guild/:guildId/config que se cambia en esa sección */
  configKey?: "levelUpMessages" | "economyEnabled" | "antiRaidEnabled";
  onLabel?: string;
  offLabel?: string;
}

const SECTION_LINKS: SectionLink[] = [
  {
    title: "Avisos al subir de nivel",
    description: "El bot felicita en el chat a quien sube de nivel.",
    icon: BarChart3,
    href: "/niveles",
    linkLabel: "Ir a Niveles",
    configKey: "levelUpMessages",
    onLabel: "Activados",
    offLabel: "Desactivados",
  },
  {
    title: "Economía",
    description: "Monedas, recompensa diaria, trabajos y juegos.",
    icon: Coins,
    href: "/economia",
    linkLabel: "Ir a Economía",
    configKey: "economyEnabled",
    onLabel: "Activada",
    offLabel: "Desactivada",
  },
  {
    title: "Protección anti-raid",
    description: "Detecta cuando entran muchas cuentas de golpe y avisa al staff.",
    icon: ShieldCheck,
    href: "/seguridad",
    linkLabel: "Ir a Seguridad",
    configKey: "antiRaidEnabled",
    onLabel: "Activada",
    offLabel: "Desactivada",
  },
  {
    title: "Bienvenida y pregunta del día",
    description: "El saludo para los nuevos y la pregunta diaria que anima la charla.",
    icon: MessageCircleHeart,
    href: "/comunidad",
    linkLabel: "Ir a Comunidad",
  },
  {
    title: "Canales",
    description: "En qué canal publica el bot el contenido y los avisos de moderación.",
    icon: Hash,
    href: "/canales",
    linkLabel: "Ir a Canales",
  },
];

function OtherSettingsCard({ guildId }: { guildId: string }) {
  // Misma consulta que la tarjeta del prefijo: una sola petición en caché
  const configQuery = useQuery<GuildConfigResponse>({
    queryKey: guildConfigKey(guildId),
    staleTime: 60_000,
  });
  const config = configQuery.data;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-xl">
          <SlidersHorizontal className="h-5 w-5 text-primary" aria-hidden="true" />
          Lo demás, en su sección
        </CardTitle>
        <CardDescription>
          Para que nada se repita, cada función se configura en su propia página. Aquí ves cómo están ahora.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="-my-3 divide-y divide-border" data-testid="list-section-links">
          {SECTION_LINKS.map((section) => {
            const value = section.configKey && config ? config[section.configKey] : undefined;
            return (
              <li key={section.href} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-start gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10">
                    <section.icon className="h-4 w-4 text-primary" aria-hidden="true" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium text-foreground">{section.title}</p>
                      {section.configKey &&
                        (configQuery.isLoading ? (
                          <Skeleton className="h-5 w-20" />
                        ) : typeof value === "boolean" ? (
                          <Badge
                            variant={value ? "default" : "outline"}
                            className={cn(!value && "text-muted-foreground")}
                          >
                            {value ? section.onLabel : section.offLabel}
                          </Badge>
                        ) : null)}
                    </div>
                    <p className="text-sm text-muted-foreground">{section.description}</p>
                  </div>
                </div>
                <Button asChild variant="outline" size="sm" className="w-full shrink-0 sm:w-auto">
                  <Link href={section.href} data-testid={`link-section-${section.href.slice(1)}`}>
                    {section.linkLabel}
                    <ArrowRight />
                  </Link>
                </Button>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

// =============================================
// Cuenta
// =============================================

function AccountCard({ guild }: { guild: UserGuild | null }) {
  const { data: auth, isLoading } = useAuthStatus();
  const logout = useLogout();
  const { toast } = useToast();

  const user = auth?.user ?? null;
  const name = displayName(user);
  const avatarUrl = userAvatarUrl(user, 128);
  const sessionLength = typeof auth?.expiresIn === "number" ? formatDurationLong(auth.expiresIn) : null;

  const handleLogout = () => {
    logout.mutate(undefined, {
      onError: (error) => {
        toast({
          variant: "destructive",
          title: "No se pudo cerrar la sesión",
          description: error instanceof Error ? error.message : "Intenta de nuevo en un momento.",
        });
      },
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-xl">
          <UserRound className="h-5 w-5 text-primary" aria-hidden="true" />
          Tu cuenta
        </CardTitle>
        <CardDescription>La cuenta de Discord con la que entraste al panel.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="flex items-center gap-4">
            <Skeleton className="h-14 w-14 rounded-full" />
            <div className="space-y-2">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-4 w-24" />
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-4">
            <Avatar className="h-14 w-14">
              {avatarUrl && <AvatarImage src={avatarUrl} alt="" />}
              <AvatarFallback className="bg-primary/10 text-lg font-semibold text-primary">
                {initials(name || "?")}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="truncate text-lg font-semibold text-foreground" data-testid="text-account-name">
                {name || "Sesión iniciada"}
              </p>
              {user?.username && user.username !== name && (
                <p className="truncate text-sm text-muted-foreground">@{user.username}</p>
              )}
            </div>
            {auth?.devMode && (
              <Badge variant="outline" className="shrink-0 font-mono text-[10px]">
                DEV
              </Badge>
            )}
          </div>
        )}

        <div className="divide-y divide-border">
          {user && (
            <DetailRow label="ID de Discord">
              <code className="break-all font-mono text-xs">{user.id}</code>
            </DetailRow>
          )}
          {guild && (
            <DetailRow label="En este servidor">{guild.owner ? "Eres el dueño" : "Eres administrador"}</DetailRow>
          )}
          {sessionLength && (
            <DetailRow label="Sesión">Se cierra sola tras {sessionLength} sin usar el panel</DetailRow>
          )}
          {auth?.devMode && <DetailRow label="Modo">Acceso de desarrollo (sin Discord)</DetailRow>}
        </div>

        <div className="space-y-2">
          <Button
            variant="outline"
            className="w-full sm:w-auto"
            onClick={handleLogout}
            disabled={logout.isPending}
            data-testid="button-account-logout"
          >
            {logout.isPending ? <Loader2 className="animate-spin" /> : <LogOut />}
            {logout.isPending ? "Cerrando sesión…" : "Cerrar sesión"}
          </Button>
          <p className="text-xs text-muted-foreground">Cerrar sesión no apaga el bot: tu servidor sigue funcionando igual.</p>
        </div>
      </CardContent>
    </Card>
  );
}

// =============================================
// Bot
// =============================================

function BotCard({ guildId, guild }: { guildId: string; guild: UserGuild | null }) {
  const statsQuery = useDashboardStats(guildId);
  const stats = statsQuery.data;
  const botStatus = getBotStatus(stats, { loading: statsQuery.isLoading, failed: statsQuery.isError });

  // Con el bot desconectado de Discord no sabemos si está en el servidor: usamos lo último que dijo la lista
  const botInGuild = stats?.bot.online ? stats.bot.inGuild : (guild?.botInGuild ?? false);
  const guildName = guild?.name ?? stats?.guild.name ?? "este servidor";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-xl">
          <Bot className="h-5 w-5 text-primary" aria-hidden="true" />
          El bot
        </CardTitle>
        <CardDescription>Cómo está el bot en {guildName} y cómo invitarlo.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="divide-y divide-border">
          <BotDetailRows stats={stats} loading={statsQuery.isLoading} failed={statsQuery.isError} />
        </div>

        {statsQuery.isError && (
          <div className="flex flex-col gap-2 rounded-lg border border-border bg-background/40 p-3 sm:flex-row sm:items-center sm:justify-between" role="status">
            <p className="text-sm text-muted-foreground">
              {getApiErrorInfo(statsQuery.error).title}. {getApiErrorInfo(statsQuery.error).description}
            </p>
            <Button
              variant="outline"
              size="sm"
              className="shrink-0"
              onClick={() => void statsQuery.refetch()}
              disabled={statsQuery.isFetching}
            >
              <RefreshCw className={cn(statsQuery.isFetching && "animate-spin")} />
              Reintentar
            </Button>
          </div>
        )}
        {botStatus.hint && <p className="text-sm text-muted-foreground">{botStatus.hint}</p>}

        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          {botInGuild ? (
            <InviteBotButton guildId={guildId} variant="outline" label="Volver a invitar aquí" className="w-full sm:w-auto" />
          ) : (
            <InviteBotButton guildId={guildId} label="Invitar a este servidor" className="w-full sm:w-auto" />
          )}
          <InviteBotButton variant="outline" label="Invitar a otro servidor" className="w-full sm:w-auto" />
        </div>
        <p className="text-xs text-muted-foreground">
          ¿Al bot le falta algún permiso? Vuelve a invitarlo: Discord te mostrará los permisos que necesita para que los
          aceptes otra vez.
        </p>
      </CardContent>
    </Card>
  );
}

// =============================================
// Página
// =============================================

export default function Ajustes() {
  const { guildId, guild } = useSelectedGuild();
  // Misma consulta que la tarjeta del bot (una sola petición en caché): dice si el bot está
  // desconectado de Discord, cosa que la lista de servidores no distingue de "no está aquí"
  const statsQuery = useDashboardStats(guildId);
  const botPresence = getBotPresence(statsQuery.data, {
    loading: statsQuery.isLoading,
    listBotInGuild: guild?.botInGuild ?? false,
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Ajustes" description="El prefijo de los comandos, tu cuenta y el bot." />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-6 lg:col-span-2">
          <PrefixCard guildId={guildId} botPresence={botPresence} />
          <OtherSettingsCard guildId={guildId} />
        </div>
        <div className="min-w-0 space-y-6">
          <AccountCard guild={guild} />
          <BotCard guildId={guildId} guild={guild} />
        </div>
      </div>
    </div>
  );
}
