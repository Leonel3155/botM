import { useMemo, useState } from "react";
import { Link } from "wouter";
import { AlertTriangle, Info, Plus, RefreshCw, Rss, Share2, Twitter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ApiErrorState } from "@/components/api-error-state";
import { EmptyState } from "@/components/empty-state";
import { InviteBotButton } from "@/components/invite-bot-button";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { useChannelConfig, useContentFeeds, useDiscordChannels, useNow } from "@/components/canales-redes/api";
import { channelLabel } from "@/components/canales-redes/channel-picker";
import { FeedCard } from "@/components/canales-redes/feed-card";
import { FeedFormDialog, usableDefaultChannel, type FeedDialogMode } from "@/components/canales-redes/feed-form-dialog";
import { CONTENT_FEED_LIMITS, feedKind, isSupportedKind, sortFeeds } from "@/components/canales-redes/feed-utils";
import { useSelectedGuild } from "@/lib/guild";
import { getApiErrorInfo, isApiError } from "@/lib/queryClient";
import { cn } from "@/lib/utils";

const MAX_FEEDS = CONTENT_FEED_LIMITS.maxPerGuild;

function FeedsSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2" aria-busy="true" aria-label="Cargando feeds">
      {[0, 1].map((i) => (
        <Card key={i}>
          <CardContent className="space-y-4 p-6">
            <div className="flex items-center gap-3">
              <Skeleton className="h-10 w-10 rounded-md" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-5 w-32" />
                <Skeleton className="h-4 w-16" />
              </div>
              <Skeleton className="h-6 w-11 rounded-full" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              {[0, 1, 2, 3].map((j) => (
                <Skeleton key={j} className="h-9 w-full" />
              ))}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export default function Social() {
  const { guildId } = useSelectedGuild();
  const feedsQuery = useContentFeeds(guildId);
  const channelsQuery = useDiscordChannels(guildId);
  const configQuery = useChannelConfig(guildId);
  const now = useNow();
  const [dialog, setDialog] = useState<FeedDialogMode | null>(null);

  const feeds = useMemo(() => sortFeeds(feedsQuery.data ?? []), [feedsQuery.data]);
  const total = feeds.length;
  const atLimit = total >= MAX_FEEDS;
  const activeCount = feeds.filter((feed) => isSupportedKind(feedKind(feed)) && feed.enabled).length;
  const legacyCount = feeds.filter((feed) => !isSupportedKind(feedKind(feed))).length;

  const channels = channelsQuery.data;
  const channelsErrorKind = isApiError(channelsQuery.error) ? channelsQuery.error.kind : null;
  const botMissing = channelsErrorKind === "botMissing";
  // Crear o editar necesita al bot en el servidor (la API revisa el canal con él)
  const canEdit = channelsQuery.isSuccess;
  // Canal de contenido (página Canales): se propone al crear un feed si el bot puede publicar ahí
  const proposedChannelId = usableDefaultChannel(channels, configQuery.data?.contentChannelId);
  const contentChannel = channelLabel(channels, proposedChannelId);

  const createBlockedReason = atLimit
    ? `Llegaste al máximo de ${MAX_FEEDS} feeds. Borra alguno para crear otro.`
    : botMissing
      ? "El bot tiene que estar en el servidor para crear feeds."
      : channelsQuery.isError
        ? "No pudimos cargar los canales del servidor."
        : feedsQuery.isError
          ? "No pudimos cargar tus feeds."
          : null;
  const createDisabled = !!createBlockedReason || feedsQuery.isLoading;

  const openCreate = () => setDialog({ kind: "create", defaultChannelId: proposedChannelId });

  const refreshAll = () => {
    void feedsQuery.refetch();
    void channelsQuery.refetch();
    void configQuery.refetch();
  };

  const createButton = (label: string, testId: string) => {
    const button = (
      <Button onClick={openCreate} disabled={createDisabled} data-testid={testId}>
        <Plus aria-hidden="true" />
        {label}
      </Button>
    );
    if (!createBlockedReason) return button;
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          {/* span: un botón deshabilitado no recibe el hover del tooltip */}
          <span tabIndex={0} className="inline-flex">
            {button}
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">{createBlockedReason}</TooltipContent>
      </Tooltip>
    );
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Redes sociales"
        description="Comparte noticias y memes de Reddit en tus canales para que siempre haya algo nuevo de qué hablar."
        actions={
          <>
            <Button
              variant="outline"
              onClick={refreshAll}
              disabled={feedsQuery.isFetching}
              data-testid="button-refresh-feeds"
            >
              <RefreshCw className={cn(feedsQuery.isFetching && "animate-spin")} aria-hidden="true" />
              Actualizar
            </Button>
            {createButton("Nuevo feed", "button-new-feed")}
          </>
        }
      />

      {/* Cifras reales de la API */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <StatCard
          title="Feeds activos"
          icon={Rss}
          loading={feedsQuery.isLoading}
          value={feedsQuery.isError ? "—" : activeCount}
          subtitle={
            feedsQuery.isSuccess
              ? activeCount > 0
                ? "Cada uno publica con su propio intervalo"
                : "Ninguno está publicando ahora"
              : undefined
          }
          testId="stat-active-feeds"
        />
        <StatCard
          title="Feeds creados"
          icon={Share2}
          loading={feedsQuery.isLoading}
          value={feedsQuery.isError ? "—" : `${total} / ${MAX_FEEDS}`}
          subtitle={
            !feedsQuery.isSuccess
              ? undefined
              : atLimit
                ? "Llegaste al máximo: borra uno para crear otro"
                : `Puedes crear ${MAX_FEEDS - total} más en este servidor`
          }
          testId="stat-total-feeds"
        />
      </div>

      {/* Cómo funciona (lo que hace el bot de verdad) */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Info className="h-5 w-5 text-primary" aria-hidden="true" />
            Cómo funciona
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <ul className="list-disc space-y-1.5 pl-5">
            <li>
              <span className="text-foreground">Noticias:</span> cuando le toca a un feed, el bot lo revisa y publica
              las noticias nuevas (hasta {CONTENT_FEED_LIMITS.newsMaxPerTurn} por turno) con título, resumen, imagen si
              la hay y enlace. Nunca repite una noticia. Puedes usar secciones o temas de Google Noticias, o cualquier
              sitio o canal de YouTube que tenga RSS. No hace falta ninguna clave.
            </li>
            <li>
              <span className="text-foreground">Reddit:</span> el bot mira lo más popular del subreddit y publica una
              imagen al azar. Lee el RSS público de Reddit, sin cuenta; si Reddit no responde o no hay imágenes, ese
              turno no se publica nada. Se salta lo que Reddit marca como NSFW; no uses subreddits para adultos, ahí Reddit no marca nada.
            </li>
            <li>
              Solo publica mientras el bot está conectado. «Último intento» se marca cada vez que le toca al feed,
              aunque esa vez no haya habido nada nuevo.
            </li>
            <li>
              Si el canal ya no existe o el bot no puede escribir ahí, no publica nada, pero ese turno también cuenta
              como intento y mueve «Último intento». Cuando arregles el canal, la próxima publicación llega en el
              siguiente turno del feed (lo ves en «Siguiente turno»); cambiar el canal o pausar y reanudar el feed no
              lo adelanta.
            </li>
          </ul>
          <p>
            {contentChannel ? (
              <>
                Al crear un feed te proponemos tu canal de contenido, <span className="text-foreground">{contentChannel}</span>.
                Puedes cambiarlo en{" "}
              </>
            ) : (
              <>¿Tienes un canal para noticias o memes? Elígelo como canal de contenido en </>
            )}
            <Link href="/canales" className="text-primary underline-offset-4 hover:underline">
              Canales
            </Link>
            {contentChannel ? "." : " y lo propondremos al crear cada feed."}
          </p>
          <p className="flex items-start gap-2">
            <Twitter className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>Twitter/X no está disponible: X cobra por leer publicaciones. Usa noticias o Reddit.</span>
          </p>
        </CardContent>
      </Card>

      {/* Avisos que bloquean crear o editar */}
      {botMissing ? (
        <Card className="border-status-warning/40">
          <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="flex items-start gap-2 text-sm text-foreground">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-status-warning" aria-hidden="true" />
              <span>Para crear, editar o pausar feeds, el bot tiene que estar en el servidor.</span>
            </p>
            <InviteBotButton guildId={guildId} size="sm" className="shrink-0" />
          </CardContent>
        </Card>
      ) : channelsQuery.isError ? (
        <Card className="border-status-warning/40">
          <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-2 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-status-warning" aria-hidden="true" />
              <div>
                <p className="font-medium text-foreground">{getApiErrorInfo(channelsQuery.error).title}</p>
                <p className="text-muted-foreground">
                  Sin la lista de canales no se pueden crear ni editar feeds por ahora.
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="shrink-0"
              onClick={() => void channelsQuery.refetch()}
              disabled={channelsQuery.isFetching}
            >
              <RefreshCw className={cn(channelsQuery.isFetching && "animate-spin")} aria-hidden="true" />
              Reintentar
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {atLimit && !feedsQuery.isError && (
        <p className="flex items-start gap-2 text-sm text-status-warning" role="status">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            Llegaste al máximo de {MAX_FEEDS} feeds en este servidor. Borra alguno para crear otro.
            {legacyCount > 0 && " Los feeds viejos de Twitter/X también cuentan."}
          </span>
        </p>
      )}

      {/* Lista de feeds */}
      <section className="space-y-4" aria-labelledby="titulo-feeds">
        <h2 id="titulo-feeds" className="text-lg font-semibold text-foreground">
          Tus feeds
        </h2>
        {feedsQuery.isLoading ? (
          <FeedsSkeleton />
        ) : feedsQuery.isError ? (
          <ApiErrorState error={feedsQuery.error} onRetry={() => void feedsQuery.refetch()} />
        ) : feeds.length === 0 ? (
          <EmptyState
            icon={Rss}
            title="Aún no tienes feeds"
            description="Crea uno y el bot compartirá noticias de los temas que elijas o imágenes de tu subreddit favorito cada cierto tiempo. Así el chat siempre tiene algo nuevo, aunque nadie haya escrito todavía."
            action={createButton("Crear mi primer feed", "button-first-feed")}
            testId="state-no-feeds"
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2" data-testid="list-feeds">
            {feeds.map((feed) => (
              <FeedCard
                key={feed.id}
                guildId={guildId}
                feed={feed}
                channels={channels}
                canEdit={canEdit}
                botMissing={botMissing}
                now={now}
                onEdit={() => setDialog({ kind: "edit", feed })}
              />
            ))}
          </div>
        )}
      </section>

      {dialog && (
        <FeedFormDialog
          key={dialog.kind === "edit" ? dialog.feed.id : "nuevo"}
          guildId={guildId}
          mode={dialog}
          existingFeeds={feeds}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}
