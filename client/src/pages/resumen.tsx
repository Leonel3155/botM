import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  Activity,
  ArrowRight,
  Coins,
  Gavel,
  MessageCircleHeart,
  MessagesSquare,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Siren,
  Sparkles,
  Trophy,
  TriangleAlert,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { DashboardStatsResponse, DiscordChannelsResponse } from "@shared/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiErrorState } from "@/components/api-error-state";
import { EmptyState } from "@/components/empty-state";
import { GuildAvatar } from "@/components/guild-avatar";
import { InviteBotButton } from "@/components/invite-bot-button";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { StatusIndicator, type StatusKind } from "@/components/status-indicator";
import { BotDetailRows, DetailRow, getBotStatus, useDashboardStats } from "@/components/ajustes-resumen/bot-status";
import {
  formatDay,
  formatHour,
  formatNumber,
  formatStatNumber,
  parseIso,
  plural,
  relativeTime,
  userName,
} from "@/components/ajustes-resumen/format";
import { ModerationList } from "@/components/ajustes-resumen/moderation-list";
import { StatNumber } from "@/components/ajustes-resumen/stat-number";
import { UserAvatar } from "@/components/ajustes-resumen/user-avatar";
import { useSelectedGuild } from "@/lib/guild";
import { NAV_ITEMS } from "@/lib/navigation";
import { getApiErrorInfo } from "@/lib/queryClient";
import { useRealtimeStatus, type RealtimeStatus } from "@/lib/websocket";
import { cn } from "@/lib/utils";

const realtimeText: Record<RealtimeStatus, { status: StatusKind; label: string }> = {
  idle: { status: "offline", label: "Desconectadas" },
  connecting: { status: "pending", label: "Conectando…" },
  live: { status: "online", label: "Activas" },
  reconnecting: { status: "warning", label: "Reconectando…" },
  denied: { status: "offline", label: "No disponibles para este servidor" },
};

/** "America/Mexico_City" → "America/Mexico City" (más fácil de leer). */
function prettyTimezone(timezone: string): string {
  return timezone.replace(/_/g, " ");
}

/**
 * Cómo está el canal de una función, según la lista de canales del bot.
 * Si el canal falta o el bot no puede escribir ahí, el bot no publica nada (solo deja un aviso en su registro).
 */
type ChannelCheck =
  | { state: "none" } // no hay canal elegido
  | { state: "unknown" } // aún no lo sabemos (cargando, error o bot fuera del servidor)
  | { state: "gone" } // el canal ya no existe (o el bot no lo ve)
  | { state: "blocked"; name: string } // existe, pero al bot le faltan permisos
  | { state: "ok"; name: string };

/** Aviso para la tarjeta de una función cuando su canal no sirve (null si está bien o no lo sabemos). */
function channelWarning(check: ChannelCheck, what: string): string | null {
  switch (check.state) {
    case "none":
      return `Falta elegir el canal ${what}.`;
    case "gone":
      return `El canal ${what} ya no existe: elige otro en Comunidad.`;
    case "blocked":
      return `No puedo publicar en ${check.name} (me faltan permisos).`;
    default:
      return null;
  }
}

/** El canal no sirve: el bot no publicará hasta que se arregle. */
function channelBroken(check: ChannelCheck): boolean {
  return check.state === "none" || check.state === "gone" || check.state === "blocked";
}

// =============================================
// Tarjeta de una función (bienvenida, pregunta del día, anti-raid)
// =============================================

interface FeatureTileProps {
  title: string;
  icon: LucideIcon;
  loading: boolean;
  enabled: boolean;
  /** Texto de la insignia: "Activada" / "Activado"... */
  onLabel: string;
  offLabel: string;
  /** Aviso en rojo (p. ej. modo raid activo) */
  alert?: ReactNode;
  /** Aviso en naranja (p. ej. falta el canal) */
  warning?: string | null;
  href: string;
  linkLabel: string;
  testId: string;
  children?: ReactNode;
}

function FeatureTile({
  title,
  icon: Icon,
  loading,
  enabled,
  onLabel,
  offLabel,
  alert,
  warning,
  href,
  linkLabel,
  testId,
  children,
}: FeatureTileProps) {
  return (
    <div className="flex h-full flex-col gap-3 rounded-lg border border-border bg-background/40 p-4" data-testid={testId}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Icon className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
          <span className="truncate font-medium text-foreground">{title}</span>
        </div>
        {loading ? (
          <Skeleton className="h-5 w-20" />
        ) : (
          <Badge variant={enabled ? "default" : "outline"} className={cn("shrink-0", !enabled && "text-muted-foreground")}>
            {enabled ? onLabel : offLabel}
          </Badge>
        )}
      </div>

      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      ) : (
        <div className="space-y-1.5 text-sm text-muted-foreground">{children}</div>
      )}

      {!loading && alert && (
        <div className="flex items-start gap-2 rounded-md border border-status-error/40 bg-status-error/10 p-2 text-xs text-foreground" role="status">
          <Siren className="mt-0.5 h-4 w-4 shrink-0 text-status-error" aria-hidden="true" />
          <span>{alert}</span>
        </div>
      )}
      {!loading && warning && (
        <p className="flex items-start gap-2 text-xs text-status-warning">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {warning}
        </p>
      )}

      <div className="mt-auto pt-1">
        <Button asChild size="sm" variant="outline" className="w-full sm:w-auto">
          <Link href={href} data-testid={`${testId}-link`}>
            {linkLabel}
            <ArrowRight />
          </Link>
        </Button>
      </div>
    </div>
  );
}

// =============================================
// Funciones principales del bot
// =============================================

function FeaturesCard({
  stats,
  loading,
  checkChannel,
}: {
  stats: DashboardStatsResponse | undefined;
  loading: boolean;
  checkChannel: (channelId: string | null) => ChannelCheck;
}) {
  const welcome = stats?.features.welcome;
  const question = stats?.features.dailyQuestion;
  const antiRaid = stats?.features.antiRaid;
  const raidEvents30d = stats?.counts.raidEvents30d ?? 0;

  // Bienvenida
  const welcomeOn = welcome?.enabled === true;
  const welcomeChannel = checkChannel(welcome?.channelId ?? null);

  // Pregunta del día
  const questionOn = question?.enabled === true;
  const questionChannel = checkChannel(question?.channelId ?? null);
  const questionHour = formatHour(question?.hour);
  const nextPost = parseIso(question?.nextPostAt);
  // Con el canal roto no sale ninguna pregunta: no prometemos la próxima
  const nextPostText =
    nextPost && !channelBroken(questionChannel)
      ? nextPost.getTime() <= Date.now()
        ? "La próxima sale en cualquier momento."
        : `La próxima sale ${relativeTime(nextPost)}.`
      : null;

  // Anti-raid
  const antiRaidOn = antiRaid?.enabled === true;
  const raidEndsAt = parseIso(antiRaid?.raidModeEndsAt);
  const raidAlert = antiRaid?.raidModeActive
    ? `Modo raid activo ahora${raidEndsAt && raidEndsAt.getTime() > Date.now() ? `: termina ${relativeTime(raidEndsAt)}` : ""}. Revisa Seguridad.`
    : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-xl">
          <Sparkles className="h-5 w-5 text-primary" aria-hidden="true" />
          Mantén vivo y seguro el servidor
        </CardTitle>
        <CardDescription>
          El bot puede saludar a quien llega, lanzar una pregunta cada día para que la gente converse y vigilar los raids.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <FeatureTile
            title="Bienvenida"
            icon={MessageCircleHeart}
            loading={loading}
            enabled={welcomeOn}
            onLabel="Activada"
            offLabel="Desactivada"
            warning={welcomeOn ? channelWarning(welcomeChannel, "de bienvenida") : null}
            href="/comunidad"
            linkLabel="Configurar bienvenida"
            testId="feature-welcome"
          >
            {welcomeOn ? (
              <p>
                {welcomeChannel.state === "ok" ? (
                  <>Saluda a cada persona nueva en <span className="text-foreground">{welcomeChannel.name}</span>.</>
                ) : channelBroken(welcomeChannel) ? (
                  "Está activada, pero por ahora nadie recibe el saludo."
                ) : (
                  "Saluda a cada persona nueva que entra."
                )}
              </p>
            ) : (
              <p>Nadie recibe un saludo al entrar todavía. Actívala para que los nuevos se sientan en casa.</p>
            )}
          </FeatureTile>

          <FeatureTile
            title="Pregunta del día"
            icon={MessagesSquare}
            loading={loading}
            enabled={questionOn}
            onLabel="Activada"
            offLabel="Desactivada"
            warning={questionOn ? channelWarning(questionChannel, "de la pregunta") : null}
            href="/comunidad"
            linkLabel="Configurar pregunta"
            testId="feature-question"
          >
            {questionOn && question ? (
              <>
                <p>
                  Todos los días{questionHour ? <> a las <span className="font-mono text-foreground">{questionHour}</span></> : null}{" "}
                  ({prettyTimezone(question.timezone)})
                  {questionChannel.state === "ok" ? (
                    <> en <span className="text-foreground">{questionChannel.name}</span></>
                  ) : null}
                  .
                </p>
                {nextPostText && <p>{nextPostText}</p>}
                {channelBroken(questionChannel) && (
                  <p>
                    {questionChannel.state === "none"
                      ? "No saldrá ninguna pregunta hasta que elijas un canal."
                      : "No saldrá ninguna pregunta hasta que se arregle el canal."}
                  </p>
                )}
                {question.lastPosted && <p className="text-xs">Última pregunta: {formatDay(question.lastPosted, "long")}.</p>}
              </>
            ) : (
              <p>Una pregunta diaria para que la conversación no se apague, aunque nadie escriba primero.</p>
            )}
          </FeatureTile>

          <FeatureTile
            title="Anti-raid"
            icon={ShieldCheck}
            loading={loading}
            enabled={antiRaidOn}
            onLabel="Activado"
            offLabel="Desactivado"
            alert={raidAlert}
            href="/seguridad"
            linkLabel="Ver seguridad"
            testId="feature-antiraid"
          >
            <p>
              {antiRaidOn
                ? "Vigila si entran muchas cuentas de golpe y avisa al staff."
                : "Apagado: el bot no reaccionará si entran muchas cuentas de golpe."}
            </p>
            <p className="text-xs">
              {raidEvents30d > 0
                ? `${plural(raidEvents30d, "alerta", "alertas")} de raid en los últimos 30 días.`
                : "Sin alertas de raid en los últimos 30 días."}
            </p>
          </FeatureTile>
        </div>
        <p className="mt-4 text-xs text-muted-foreground">
          También puedes hacerlo desde Discord con{" "}
          <code className="font-mono text-foreground">/bienvenida</code>,{" "}
          <code className="font-mono text-foreground">/pregunta-del-dia</code> y{" "}
          <code className="font-mono text-foreground">/antiraid</code>.
        </p>
      </CardContent>
    </Card>
  );
}

// =============================================
// Listas: top de niveles y moderación reciente
// =============================================

function ListSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Cargando">
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} className="h-11 w-full" />
      ))}
    </div>
  );
}

function TopLevelsCard({ stats, loading }: { stats: DashboardStatsResponse | undefined; loading: boolean }) {
  const top = stats?.topLevels ?? [];
  return (
    <Card className="flex flex-col">
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2 text-xl">
          <span className="flex items-center gap-2">
            <Trophy className="h-5 w-5 text-primary" aria-hidden="true" />
            Top 5 por nivel
          </span>
          <Link href="/estadisticas" className="text-xs font-normal text-muted-foreground hover:text-primary">
            Ver estadísticas
          </Link>
        </CardTitle>
        <CardDescription>Quiénes más participan en el servidor.</CardDescription>
      </CardHeader>
      <CardContent className="flex-1">
        {loading ? (
          <ListSkeleton />
        ) : top.length === 0 ? (
          <EmptyState
            bare
            icon={Trophy}
            title="Aún nadie tiene nivel"
            description="Cuando la gente escriba en el servidor, el bot les dará XP y aquí verás quién va arriba."
          />
        ) : (
          <ol className="-my-2" data-testid="list-top-levels">
            {top.map((entry) => {
              const user = { id: entry.userId, username: entry.username, avatar: entry.avatar };
              return (
                <li key={entry.userId} className="flex items-center gap-3 border-b border-border py-2.5 last:border-0">
                  <span
                    className={cn(
                      "w-6 shrink-0 text-center font-mono text-sm",
                      entry.rank === 1 ? "font-bold text-primary" : "text-muted-foreground",
                    )}
                  >
                    <span className="sr-only">Puesto </span>
                    {entry.rank}
                  </span>
                  <UserAvatar user={user} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">{userName(user)}</p>
                    <p className="font-mono text-xs text-muted-foreground">{formatNumber(entry.totalXp)} XP en total</p>
                  </div>
                  <Badge variant={entry.rank === 1 ? "default" : "outline"} className="shrink-0 font-mono">
                    Nivel {entry.level}
                  </Badge>
                </li>
              );
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

function RecentModerationCard({ stats, loading }: { stats: DashboardStatsResponse | undefined; loading: boolean }) {
  const actions = stats?.recentModeration ?? [];
  return (
    <Card className="flex flex-col">
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2 text-xl">
          <span className="flex items-center gap-2">
            <Gavel className="h-5 w-5 text-primary" aria-hidden="true" />
            Moderación reciente
          </span>
          <Link href="/moderacion" className="text-xs font-normal text-muted-foreground hover:text-primary">
            Ver todo
          </Link>
        </CardTitle>
        <CardDescription>Las últimas 5 acciones del staff.</CardDescription>
      </CardHeader>
      <CardContent className="flex-1">
        {loading ? (
          <ListSkeleton />
        ) : actions.length === 0 ? (
          <EmptyState
            bare
            icon={Gavel}
            title="Aún no hay acciones de moderación"
            description="Cuando el staff use comandos como /warn, /mute o /ban, aparecerán aquí."
          />
        ) : (
          <ModerationList actions={actions} />
        )}
      </CardContent>
    </Card>
  );
}

// =============================================
// Página
// =============================================

export default function Resumen() {
  const { guildId, guild } = useSelectedGuild();
  const realtimeStatus = useRealtimeStatus();
  const statsQuery = useDashboardStats(guildId);
  const stats = statsQuery.data;
  const loading = statsQuery.isLoading;
  const botReady = !!stats?.bot.online && !!stats.bot.inGuild;

  // Nombres de los canales (solo con el bot en el servidor: salen de su caché)
  const channelsQuery = useQuery<DiscordChannelsResponse>({
    queryKey: ["/api/guild", guildId, "discord-channels"],
    enabled: botReady,
    staleTime: 5 * 60_000,
  });
  const checkChannel = (channelId: string | null): ChannelCheck => {
    if (!channelId) return { state: "none" };
    const channels = botReady ? channelsQuery.data : undefined;
    if (!channels) return { state: "unknown" };
    const channel = channels.find((c) => c.id === channelId);
    if (!channel) return { state: "gone" };
    const name = `#${channel.name}`;
    return channel.botCanPost ? { state: "ok", name } : { state: "blocked", name };
  };

  const refreshAll = () => {
    void statsQuery.refetch();
    if (botReady) void channelsQuery.refetch();
  };

  const botStatus = getBotStatus(stats, { loading, failed: statsQuery.isError });
  const realtime = realtimeText[realtimeStatus];
  const updatedAt = statsQuery.dataUpdatedAt ? new Date(statsQuery.dataUpdatedAt) : null;

  const counts = stats?.counts;
  const memberCount = stats?.guild.memberCount ?? null;
  const onlineCount = stats?.guild.onlineCount ?? null;
  const coins = formatStatNumber(counts?.coinsInCirculation);

  const title = guild?.name ?? stats?.guild.name ?? "Resumen";
  const quickLinks = NAV_ITEMS.filter((item) => item.href !== "/");
  const quickLinkBadges: Record<string, string> =
    counts && counts.customCommands > 0 ? { "/comandos": plural(counts.customCommands, "comando", "comandos") } : {};

  const header = (
    <PageHeader
      leading={guild ? <GuildAvatar guild={guild} size="lg" /> : null}
      title={title}
      description={
        <>
          Así va tu servidor
          {updatedAt && stats ? <span className="text-muted-foreground"> · actualizado {relativeTime(updatedAt)}</span> : null}
        </>
      }
      actions={
        <Button variant="outline" onClick={refreshAll} disabled={statsQuery.isFetching} data-testid="button-refresh">
          <RefreshCw className={cn(statsQuery.isFetching && "animate-spin")} />
          Actualizar
        </Button>
      }
    />
  );

  const quickLinksSection = (
    <section className="space-y-4" aria-labelledby="quick-links-title">
      <h2 id="quick-links-title" className="text-lg font-semibold text-foreground">
        Accesos rápidos
      </h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {quickLinks.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="group flex items-center gap-4 rounded-xl border border-card-border bg-card p-4 transition-colors hover:border-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            data-testid={`quick-link-${item.href.slice(1)}`}
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10">
              <item.icon className="h-5 w-5 text-primary" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium text-foreground">{item.title}</p>
              <p className="truncate text-xs text-muted-foreground">{item.description}</p>
            </div>
            {quickLinkBadges[item.href] && (
              <Badge variant="outline" className="shrink-0 font-mono text-[10px] text-muted-foreground">
                {quickLinkBadges[item.href]}
              </Badge>
            )}
            <ArrowRight
              className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary"
              aria-hidden="true"
            />
          </Link>
        ))}
      </div>
    </section>
  );

  // Sin datos y con error: no hay nada real que mostrar
  if (statsQuery.isError && !stats) {
    return (
      <div className="space-y-8">
        {header}
        <ApiErrorState error={statsQuery.error} onRetry={() => void statsQuery.refetch()} />
        {quickLinksSection}
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {header}

      {/* Estado del bot + miembros */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl">
              <Activity className="h-5 w-5 text-primary" aria-hidden="true" />
              Estado del bot
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="divide-y divide-border">
              <BotDetailRows stats={stats} loading={loading} failed={statsQuery.isError} />
              <DetailRow label="Actualizaciones en vivo">
                <StatusIndicator
                  status={realtime.status}
                  label={realtime.label}
                  className="sm:justify-end"
                  testId="status-realtime-detail"
                />
              </DetailRow>
              {stats && (
                <DetailRow label="Zona horaria del servidor">
                  {prettyTimezone(stats.features.dailyQuestion.timezone)}
                </DetailRow>
              )}
              {guild && <DetailRow label="Tu acceso">{guild.owner ? "Dueño del servidor" : "Administrador"}</DetailRow>}
            </div>

            {botStatus.hint && (
              <div className="mt-4 flex flex-col gap-3 rounded-lg border border-border bg-background/40 p-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-muted-foreground">{botStatus.hint}</p>
                {stats?.bot.online && !stats.bot.inGuild ? (
                  <InviteBotButton guildId={guildId} size="sm" className="shrink-0" />
                ) : (
                  <Button variant="outline" size="sm" className="shrink-0" onClick={refreshAll} disabled={statsQuery.isFetching}>
                    <RefreshCw className={cn(statsQuery.isFetching && "animate-spin")} />
                    Reintentar
                  </Button>
                )}
              </div>
            )}

            {statsQuery.isError && stats && (
              <p className="mt-4 text-xs text-status-warning" role="status">
                No se pudo actualizar: {getApiErrorInfo(statsQuery.error).title}. Mostramos los últimos datos que tenemos.
              </p>
            )}
          </CardContent>
        </Card>

        <StatCard
          title="Miembros"
          icon={Users}
          loading={loading}
          value={<StatNumber value={memberCount} />}
          subtitle={
            loading
              ? undefined
              : memberCount === null
              ? "Aparece cuando el bot esté conectado y dentro del servidor"
              : onlineCount !== null
                ? `${formatNumber(onlineCount)} conectados ahora, según Discord`
                : "Personas en el servidor, según Discord"
          }
          testId="stat-members"
        />
      </div>

      {/* Números reales de la base de datos. 4 columnas solo desde xl: con la barra lateral, en lg
          cada tarjeta mide ~150 px y "12,345" ya no cabe */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="Personas con nivel"
          icon={Trophy}
          loading={loading}
          value={<StatNumber value={counts?.usersWithLevels} />}
          subtitle="Ya escribieron al menos un mensaje"
          testId="stat-users-levels"
        />
        <StatCard
          title="Monedas en circulación"
          icon={Coins}
          loading={loading}
          value={<StatNumber value={counts?.coinsInCirculation} />}
          subtitle={coins.full ? `Exactamente ${coins.full}, sumando carteras y bancos` : "Sumando carteras y bancos"}
          testId="stat-coins"
        />
        <StatCard
          title="Moderación · 7 días"
          icon={Gavel}
          loading={loading}
          value={<StatNumber value={counts?.moderationActions7d} />}
          subtitle={counts ? `${formatNumber(counts.moderationActions30d)} en los últimos 30 días` : undefined}
          testId="stat-moderation-7d"
        />
        <StatCard
          title="Advertencias · 30 días"
          icon={ShieldAlert}
          loading={loading}
          value={<StatNumber value={counts?.warnings30d} />}
          subtitle={counts ? `${formatNumber(counts.warningsTotal)} en total` : undefined}
          testId="stat-warnings-30d"
        />
      </div>

      <FeaturesCard stats={stats} loading={loading} checkChannel={checkChannel} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <TopLevelsCard stats={stats} loading={loading} />
        <RecentModerationCard stats={stats} loading={loading} />
      </div>

      {quickLinksSection}
    </div>
  );
}
