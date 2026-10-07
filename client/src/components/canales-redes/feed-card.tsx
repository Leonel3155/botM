import { useState, type ReactNode } from "react";
import { useMutation } from "@tanstack/react-query";
import { formatDistance } from "date-fns";
import { es } from "date-fns/locale";
import { AlertTriangle, ExternalLink, Loader2, Pencil, PowerOff, Rss, Trash2, Twitter } from "lucide-react";
import type { ContentFeedItem, ContentFeedResponse, ContentFeedsResponse, DiscordChannelItem } from "@shared/api";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, isApiError, queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { errorText, feedsKey, invalidatePaths } from "./api";
import { ChannelIssueNote, findChannel, getChannelIssue } from "./channel-picker";
import { feedKind, feedSubreddit, feedTitle, formatInterval, parseDate, subredditUrl } from "./feed-utils";

interface FeedCardProps {
  guildId: string;
  feed: ContentFeedItem;
  /** Canales del servidor (undefined si aún no cargan o el bot no está). */
  channels: DiscordChannelItem[] | undefined;
  /** Se puede editar (el bot está en el servidor y los canales cargaron). */
  canEdit: boolean;
  /** Hora actual (se renueva cada minuto) para los textos relativos. */
  now: number;
  onEdit: () => void;
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 truncate text-sm text-foreground">{children}</dd>
    </div>
  );
}

/** "hace 5 minutos" */
function relative(date: Date, now: number) {
  return formatDistance(date, new Date(now), { addSuffix: true, locale: es });
}

/** Cuándo vuelve a pasar el bot por el feed (aprox.: revisa cada minuto mientras está conectado). */
function nextTurnText(feed: ContentFeedItem, now: number): string {
  const last = parseDate(feed.lastPosted);
  if (!last) return "En el próximo minuto";
  const remaining = last.getTime() + feed.postInterval * 60_000 - now;
  if (remaining <= 60_000) return "En el próximo minuto";
  const minutes = Math.round(remaining / 60_000);
  if (minutes < 60) return `Dentro de ~${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `Dentro de ~${hours} h` : `Dentro de ~${hours} h ${rest} min`;
}

export function FeedCard({ guildId, feed, channels, canEdit, now, onEdit }: FeedCardProps) {
  const { toast } = useToast();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const kind = feedKind(feed);
  const title = feedTitle(feed);
  const subreddit = feedSubreddit(feed);
  const isLegacy = kind !== "reddit";

  const replaceInCache = (updated: ContentFeedResponse) => {
    queryClient.setQueryData<ContentFeedsResponse>(feedsKey(guildId), (old) =>
      old?.map((item) => (item.id === updated.id ? updated : item)),
    );
  };

  const toggleMutation = useMutation({
    mutationFn: async (enabled: boolean) => {
      const res = await apiRequest("PATCH", `/api/social/${guildId}/feeds/${feed.id}`, { enabled });
      return (await res.json()) as ContentFeedResponse;
    },
    onSuccess: (updated) => {
      replaceInCache(updated);
      void invalidatePaths([`/api/social/${guildId}`]);
      toast(
        isLegacy
          ? { title: "Feed desactivado", description: "Ya solo queda en la lista; puedes borrarlo cuando quieras." }
          : {
              title: updated.enabled ? "Feed activado" : "Feed pausado",
              description: updated.enabled
                ? `${title} vuelve a publicar ${formatInterval(updated.postInterval)}.`
                : `${title} deja de publicar hasta que lo vuelvas a activar.`,
            },
      );
    },
    onError: (error) => {
      if (isApiError(error) && error.status === 404) void invalidatePaths([`/api/social/${guildId}`]);
      toast({ variant: "destructive", title: "No se pudo cambiar el feed", description: errorText(error) });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", `/api/social/${guildId}/feeds/${feed.id}`);
    },
    onSuccess: () => {
      setConfirmDelete(false);
      queryClient.setQueryData<ContentFeedsResponse>(feedsKey(guildId), (old) =>
        old?.filter((item) => item.id !== feed.id),
      );
      void invalidatePaths([`/api/social/${guildId}`]);
      toast({ title: "Feed borrado", description: `${title} ya no publicará nada.` });
    },
    onError: (error) => {
      if (isApiError(error) && error.status === 404) {
        // Ya no existía (lo borró alguien más): solo actualizamos la lista
        setConfirmDelete(false);
        void invalidatePaths([`/api/social/${guildId}`]);
      }
      toast({ variant: "destructive", title: "No se pudo borrar el feed", description: errorText(error) });
    },
  });

  // Mientras se guarda, el interruptor ya muestra lo que se pidió
  const enabled = toggleMutation.isPending && toggleMutation.variables !== undefined ? toggleMutation.variables : feed.enabled;
  const busy = toggleMutation.isPending || deleteMutation.isPending;

  const channel = findChannel(channels, feed.channelId);
  const channelIssue = feed.channelId ? getChannelIssue(channels, feed.channelId) : null;
  const lastPosted = parseDate(feed.lastPosted);

  const Icon = kind === "twitter" ? Twitter : Rss;

  return (
    <Card className={cn("flex flex-col", !enabled && !isLegacy && "opacity-90")} data-testid={`card-feed-${feed.id}`}>
      <CardContent className="flex flex-1 flex-col gap-4 p-4 sm:p-6">
        {/* Título + interruptor */}
        <div className="flex items-start gap-3">
          <div
            className={cn(
              "flex h-10 w-10 shrink-0 items-center justify-center rounded-md",
              isLegacy ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary",
            )}
          >
            <Icon className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            {kind === "reddit" && subreddit ? (
              <a
                href={subredditUrl(subreddit)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex max-w-full items-center gap-1 font-mono font-semibold text-foreground hover:text-primary"
              >
                <span className="truncate">{title}</span>
                <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span className="sr-only">(abre Reddit en otra pestaña)</span>
              </a>
            ) : (
              <p className="truncate font-semibold text-foreground">{title}</p>
            )}
            <div className="mt-1 flex flex-wrap gap-2">
              {isLegacy ? (
                <Badge variant="outline" className="border-status-warning/50 text-status-warning">
                  {kind === "twitter" ? "Twitter/X ya no está disponible" : "Origen no compatible"}
                </Badge>
              ) : enabled ? (
                <Badge>Activo</Badge>
              ) : (
                <Badge variant="outline" className="text-muted-foreground">
                  Pausado
                </Badge>
              )}
              {isLegacy && (
                <Badge variant="outline" className="text-muted-foreground">
                  {feed.enabled ? "Activado, pero no publica" : "Desactivado"}
                </Badge>
              )}
            </div>
          </div>
          {!isLegacy && (
            <div className="flex shrink-0 items-center gap-2 pt-1">
              {toggleMutation.isPending && (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden="true" />
              )}
              <Switch
                checked={enabled}
                onCheckedChange={(checked) => toggleMutation.mutate(checked)}
                disabled={busy || !canEdit}
                aria-label={`${enabled ? "Pausar" : "Activar"} ${title}`}
                data-testid={`switch-feed-${feed.id}`}
              />
            </div>
          )}
        </div>

        {isLegacy ? (
          <p className="text-sm text-muted-foreground">
            {kind === "twitter"
              ? "Este feed es de cuando el bot intentaba publicar desde Twitter/X. Esa función ya no existe, así que no publica nada: puedes desactivarlo o borrarlo."
              : "El bot no sabe publicar desde este origen, así que este feed no hace nada. Puedes desactivarlo o borrarlo."}
          </p>
        ) : (
          <dl className="grid grid-cols-1 gap-3 min-[400px]:grid-cols-2">
            <Detail label="Canal">
              {channel ? (
                `#${channel.name}`
              ) : feed.channelId ? (
                channels ? (
                  <span className="text-destructive">Canal borrado</span>
                ) : (
                  <span className="text-muted-foreground">Canal guardado</span>
                )
              ) : (
                <span className="text-destructive">Sin canal</span>
              )}
            </Detail>
            <Detail label="Frecuencia">{formatInterval(feed.postInterval)}</Detail>
            <Detail label="Último intento">
              {lastPosted ? (
                <time dateTime={lastPosted.toISOString()} title={lastPosted.toLocaleString("es-MX")}>
                  {relative(lastPosted, now)}
                </time>
              ) : (
                <span className="text-muted-foreground">Todavía ninguno</span>
              )}
            </Detail>
            <Detail label="Siguiente turno">
              {enabled ? nextTurnText(feed, now) : <span className="text-muted-foreground">En pausa</span>}
            </Detail>
          </dl>
        )}

        {!isLegacy && !feed.channelId && (
          <p className="flex items-start gap-2 text-xs text-destructive">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>Este feed no tiene canal, así que no publica nada. Edítalo para elegir uno.</span>
          </p>
        )}
        {!isLegacy && <ChannelIssueNote issue={channelIssue} />}

        {/* Acciones */}
        <div className="mt-auto flex flex-wrap gap-2 border-t border-border pt-4">
          {isLegacy ? (
            feed.enabled && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => toggleMutation.mutate(false)}
                disabled={busy}
                data-testid={`button-disable-feed-${feed.id}`}
              >
                {toggleMutation.isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <PowerOff aria-hidden="true" />}
                Desactivar
              </Button>
            )
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={onEdit}
              disabled={busy || !canEdit}
              data-testid={`button-edit-feed-${feed.id}`}
            >
              <Pencil aria-hidden="true" />
              Editar
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive"
            onClick={() => setConfirmDelete(true)}
            disabled={busy}
            data-testid={`button-delete-feed-${feed.id}`}
          >
            <Trash2 aria-hidden="true" />
            Borrar
          </Button>
        </div>
      </CardContent>

      <AlertDialog open={confirmDelete} onOpenChange={(open) => !deleteMutation.isPending && setConfirmDelete(open)}>
        <AlertDialogContent className="w-[calc(100%-2rem)] rounded-lg sm:w-full">
          <AlertDialogHeader>
            <AlertDialogTitle>¿Borrar {title}?</AlertDialogTitle>
            <AlertDialogDescription>
              {isLegacy
                ? "El feed desaparece de la lista. No se puede deshacer."
                : "El bot dejará de publicar desde este subreddit. Las publicaciones que ya hizo se quedan en Discord. No se puede deshacer."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:space-x-0">
            <AlertDialogCancel className="mt-0" disabled={deleteMutation.isPending}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: "destructive" })}
              disabled={deleteMutation.isPending}
              onClick={(event) => {
                // Se cierra al terminar (si falla, sigue abierto para reintentar)
                event.preventDefault();
                deleteMutation.mutate();
              }}
              data-testid={`button-confirm-delete-feed-${feed.id}`}
            >
              {deleteMutation.isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
              {deleteMutation.isPending ? "Borrando…" : "Sí, borrar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
