import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import {
  Activity,
  ArrowRight,
  Ban,
  Eraser,
  Gavel,
  Lock,
  MessageCircleHeart,
  MessageSquareOff,
  MessagesSquare,
  RefreshCw,
  ShieldAlert,
  Unlock,
  UserX,
  Users,
  Volume2,
} from "lucide-react";
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
import type { GuildResponse, ModerationActionResponse } from "@/lib/api-types";
import { useSelectedGuild } from "@/lib/guild";
import { NAV_ITEMS } from "@/lib/navigation";
import { getApiErrorInfo, isApiError } from "@/lib/queryClient";
import { useRealtimeStatus, type RealtimeStatus } from "@/lib/websocket";
import { cn } from "@/lib/utils";

/**
 * GET /api/dashboard/:guildId/stats. Solo se muestran los campos que son datos
 * reales; todos son opcionales por si la API cambia.
 */
interface DashboardStats {
  totalMembers?: number;
}

/** GET /api/guild/:guildId/discord-channels */
interface DiscordChannel {
  id: string;
  name: string;
  type: "text" | "voice";
  category: string;
}

const numberFormat = new Intl.NumberFormat("es-MX");

function formatHour(hour: number | null | undefined): string | null {
  if (typeof hour !== "number" || !Number.isInteger(hour) || hour < 0 || hour > 23) return null;
  return `${String(hour).padStart(2, "0")}:00`;
}

const realtimeText: Record<RealtimeStatus, { status: StatusKind; label: string }> = {
  idle: { status: "offline", label: "Desconectadas" },
  connecting: { status: "pending", label: "Conectando…" },
  live: { status: "online", label: "Activas" },
  reconnecting: { status: "warning", label: "Reconectando…" },
  denied: { status: "offline", label: "No disponibles para este servidor" },
};

const moderationLabels: Record<string, { label: string; icon: typeof Gavel; tone: string }> = {
  warn: { label: "Advertencia", icon: ShieldAlert, tone: "text-status-warning bg-status-warning/10" },
  mute: { label: "Silencio", icon: MessageSquareOff, tone: "text-status-warning bg-status-warning/10" },
  unmute: { label: "Se quitó el silencio", icon: Volume2, tone: "text-status-online bg-status-online/10" },
  kick: { label: "Expulsión", icon: UserX, tone: "text-status-error bg-status-error/10" },
  ban: { label: "Baneo", icon: Ban, tone: "text-status-error bg-status-error/10" },
  clear: { label: "Mensajes borrados", icon: Eraser, tone: "text-muted-foreground bg-muted" },
  lockdown: { label: "Canal bloqueado", icon: Lock, tone: "text-status-error bg-status-error/10" },
  unlock: { label: "Canal desbloqueado", icon: Unlock, tone: "text-status-online bg-status-online/10" },
};

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <span className="text-sm text-muted-foreground">{label}</span>
      <div className="text-sm text-foreground sm:text-right">{children}</div>
    </div>
  );
}

interface FeatureTileProps {
  title: string;
  icon: typeof Gavel;
  loading: boolean;
  enabled: boolean;
  detail: ReactNode;
  warning?: string | null;
}

function FeatureTile({ title, icon: Icon, loading, enabled, detail, warning }: FeatureTileProps) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-background/40 p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Icon className="h-5 w-5 text-primary" aria-hidden="true" />
          <span className="font-medium text-foreground">{title}</span>
        </div>
        {loading ? (
          <Skeleton className="h-5 w-20" />
        ) : (
          <Badge
            variant={enabled ? "default" : "outline"}
            className={cn(!enabled && "text-muted-foreground")}
          >
            {enabled ? "Activada" : "Desactivada"}
          </Badge>
        )}
      </div>
      {loading ? (
        <Skeleton className="h-4 w-48" />
      ) : (
        <p className="text-sm text-muted-foreground">{detail}</p>
      )}
      {!loading && warning && <p className="text-xs text-status-warning">{warning}</p>}
    </div>
  );
}

export default function Resumen() {
  const { guildId, guild } = useSelectedGuild();
  const realtimeStatus = useRealtimeStatus();

  // Estado del bot + número de miembros (requiere que el bot esté en el servidor)
  const statsQuery = useQuery<DashboardStats>({
    queryKey: ["/api/dashboard", guildId, "stats"],
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  // Configuración guardada del servidor (bienvenida, pregunta del día...).
  // 404 = el servidor aún no tiene fila en la base de datos: todo con valores por defecto.
  const configQuery = useQuery<GuildResponse>({
    queryKey: ["/api/guilds", guildId],
    staleTime: 60_000,
  });

  // Nombres de los canales (solo si el bot está: los saca de su caché)
  const channelsQuery = useQuery<DiscordChannel[]>({
    queryKey: ["/api/guild", guildId, "discord-channels"],
    enabled: statsQuery.isSuccess,
    staleTime: 5 * 60_000,
  });

  const moderationQuery = useQuery<ModerationActionResponse[]>({
    queryKey: ["/api/moderation", guildId, "actions?limit=5"],
    staleTime: 60_000,
  });

  const refreshAll = () => {
    void statsQuery.refetch();
    void configQuery.refetch();
    void moderationQuery.refetch();
    if (statsQuery.isSuccess) void channelsQuery.refetch();
  };

  // ---- Estado del bot ----
  const statsErrorKind = isApiError(statsQuery.error) ? statsQuery.error.kind : null;
  let botStatus: { status: StatusKind; label: string };
  if (statsQuery.isLoading) botStatus = { status: "pending", label: "Comprobando…" };
  else if (statsQuery.isSuccess) botStatus = { status: "online", label: "En línea" };
  else if (statsErrorKind === "botMissing") botStatus = { status: "offline", label: "No está en este servidor" };
  else if (statsErrorKind === "unavailable") botStatus = { status: "error", label: "No disponible ahora" };
  else botStatus = { status: "warning", label: "No pudimos comprobarlo" };

  const totalMembers = statsQuery.data?.totalMembers;
  const realtime = realtimeText[realtimeStatus];

  // ---- Comunidad ----
  const configMissing = isApiError(configQuery.error) && configQuery.error.kind === "notFound";
  const config = configQuery.data;
  const configLoading = configQuery.isLoading;
  const channelName = (channelId: string | null | undefined) => {
    if (!channelId) return null;
    const channel = channelsQuery.data?.find((c) => c.id === channelId);
    return channel ? `#${channel.name}` : null;
  };

  const welcomeEnabled = config?.welcomeEnabled === true;
  const welcomeChannel = channelName(config?.welcomeChannelId);
  const welcomeDetail = welcomeEnabled
    ? welcomeChannel ? `Saluda a cada persona nueva en ${welcomeChannel}.` : "Saluda a cada persona nueva que entra."
    : "Nadie recibe un saludo al entrar todavía.";
  const welcomeWarning = welcomeEnabled && !config?.welcomeChannelId ? "Falta elegir el canal de bienvenida." : null;

  const questionEnabled = config?.dailyQuestionEnabled === true;
  const questionHour = formatHour(config?.dailyQuestionHour);
  const questionChannel = channelName(config?.dailyQuestionChannelId);
  const questionDetail = questionEnabled
    ? [
        questionHour ? `Todos los días a las ${questionHour}` : "Todos los días",
        config?.timezone ? ` (${config.timezone})` : "",
        questionChannel ? ` en ${questionChannel}` : "",
        ".",
      ].join("")
    : "Una pregunta diaria para que el servidor no se quede en silencio.";
  const questionWarning = questionEnabled && !config?.dailyQuestionChannelId ? "Falta elegir el canal de la pregunta." : null;

  const quickLinks = NAV_ITEMS.filter((item) => item.href !== "/");

  return (
    <div className="space-y-8">
      <PageHeader
        leading={guild ? <GuildAvatar guild={guild} size="lg" /> : null}
        title={guild?.name ?? "Resumen"}
        description="Resumen de tu servidor y del bot"
        actions={
          <Button variant="outline" onClick={refreshAll} disabled={statsQuery.isFetching} data-testid="button-refresh">
            <RefreshCw className={cn(statsQuery.isFetching && "animate-spin")} />
            Actualizar
          </Button>
        }
      />

      {/* Estado del bot + miembros */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-primary" aria-hidden="true" />
              Estado del bot
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="divide-y divide-border">
              <DetailRow label="Bot en este servidor">
                <StatusIndicator status={botStatus.status} label={botStatus.label} testId="status-bot" />
              </DetailRow>
              <DetailRow label="Actualizaciones en vivo">
                <StatusIndicator status={realtime.status} label={realtime.label} testId="status-realtime-detail" />
              </DetailRow>
              {guild && (
                <DetailRow label="Tu acceso">
                  {guild.owner ? "Dueño del servidor" : "Administrador"}
                </DetailRow>
              )}
            </div>
            {statsQuery.isError && (
              <div className="mt-4 flex flex-col gap-3 rounded-lg border border-border bg-background/40 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-medium text-foreground">{getApiErrorInfo(statsQuery.error).title}</p>
                  <p className="text-sm text-muted-foreground">{getApiErrorInfo(statsQuery.error).description}</p>
                </div>
                {statsErrorKind === "botMissing" ? (
                  <InviteBotButton guildId={guildId} size="sm" className="shrink-0" />
                ) : statsErrorKind !== "forbidden" && statsErrorKind !== "unauthorized" ? (
                  <Button variant="outline" size="sm" className="shrink-0" onClick={() => void statsQuery.refetch()}>
                    <RefreshCw />
                    Reintentar
                  </Button>
                ) : null}
              </div>
            )}
          </CardContent>
        </Card>

        <StatCard
          title="Miembros"
          icon={Users}
          loading={statsQuery.isLoading}
          value={typeof totalMembers === "number" ? numberFormat.format(totalMembers) : "—"}
          subtitle={
            typeof totalMembers === "number"
              ? "Personas en el servidor, según Discord"
              : "Aún no hay datos: el bot tiene que estar en el servidor"
          }
          testId="stat-members"
        />
      </div>

      {/* Comunidad + moderación reciente */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MessageCircleHeart className="h-5 w-5 text-primary" aria-hidden="true" />
              Mantén vivo el servidor
            </CardTitle>
            <CardDescription>
              El bot puede saludar a quien llega y lanzar una pregunta cada día para que la gente converse.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {configQuery.isError && !configMissing ? (
              <ApiErrorState error={configQuery.error} onRetry={() => void configQuery.refetch()} bare />
            ) : (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <FeatureTile
                  title="Bienvenida"
                  icon={MessageCircleHeart}
                  loading={configLoading}
                  enabled={welcomeEnabled}
                  detail={welcomeDetail}
                  warning={welcomeWarning}
                />
                <FeatureTile
                  title="Pregunta del día"
                  icon={MessagesSquare}
                  loading={configLoading}
                  enabled={questionEnabled}
                  detail={questionDetail}
                  warning={questionWarning}
                />
              </div>
            )}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-muted-foreground">
                También puedes hacerlo desde Discord con{" "}
                <code className="font-mono text-foreground">/bienvenida</code> y{" "}
                <code className="font-mono text-foreground">/pregunta-del-dia</code>.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button asChild size="sm">
                  <Link href="/comunidad" data-testid="link-config-bienvenida">Configurar bienvenida</Link>
                </Button>
                <Button asChild size="sm" variant="outline">
                  <Link href="/comunidad" data-testid="link-config-pregunta">Configurar pregunta del día</Link>
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2">
                <Gavel className="h-5 w-5 text-primary" aria-hidden="true" />
                Moderación reciente
              </span>
              <Link href="/moderacion" className="text-xs font-normal text-muted-foreground hover:text-primary">
                Ver todo
              </Link>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {moderationQuery.isLoading ? (
              <div className="space-y-3">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : moderationQuery.isError ? (
              <ApiErrorState error={moderationQuery.error} onRetry={() => void moderationQuery.refetch()} bare />
            ) : !moderationQuery.data || moderationQuery.data.length === 0 ? (
              <EmptyState
                bare
                icon={Gavel}
                title="Aún no hay acciones de moderación"
                description="Cuando el equipo use comandos como /warn o /mute, aparecerán aquí."
              />
            ) : (
              <ul className="max-h-80 overflow-y-auto" data-testid="list-moderation">
                {moderationQuery.data.slice(0, 5).map((action) => {
                  const meta = moderationLabels[action.type] ?? {
                    label: action.type,
                    icon: Gavel,
                    tone: "text-muted-foreground bg-muted",
                  };
                  const Icon = meta.icon;
                  const when = action.createdAt ? new Date(action.createdAt) : null;
                  return (
                    <li key={action.id} className="flex items-start gap-3 border-b border-border py-3 last:border-0">
                      <div className={cn("mt-0.5 rounded-full p-2", meta.tone)}>
                        <Icon className="h-4 w-4" aria-hidden="true" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-foreground">
                          {meta.label}
                          {typeof action.duration === "number" && action.duration > 0 && (
                            <span className="font-normal text-muted-foreground"> · {action.duration} min</span>
                          )}
                        </p>
                        {action.reason && (
                          <p className="truncate text-xs text-muted-foreground" title={action.reason}>
                            {action.reason}
                          </p>
                        )}
                        {when && !Number.isNaN(when.getTime()) && (
                          <p className="mt-1 font-mono text-xs text-muted-foreground">
                            {formatDistanceToNow(when, { addSuffix: true, locale: es })}
                          </p>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Accesos rápidos */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-foreground">Accesos rápidos</h2>
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
              <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
