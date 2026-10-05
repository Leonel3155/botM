import { useMemo } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation } from "@tanstack/react-query";
import { ExternalLink, Info, Loader2 } from "lucide-react";
import type {
  ContentFeedCreateRequest,
  ContentFeedItem,
  ContentFeedResponse,
  ContentFeedUpdateRequest,
} from "@shared/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, getApiErrorInfo, isApiError } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { errorDetails, errorText, invalidatePaths, useDiscordChannels } from "./api";
import { ChannelIssueNote, ChannelPicker, channelLabel, findChannel, getChannelIssue } from "./channel-picker";
import {
  CONTENT_FEED_LIMITS,
  DEFAULT_POST_INTERVAL,
  POST_INTERVAL_PRESETS,
  SHORT_INTERVAL_WARNING_MINUTES,
  feedKind,
  feedSubreddit,
  formatInterval,
  formatIntervalShort,
  isValidSubreddit,
  normalizeSubreddit,
  subredditUrl,
} from "./feed-utils";

const { min: INTERVAL_MIN, max: INTERVAL_MAX } = CONTENT_FEED_LIMITS.postInterval;

function buildSchema(requireSubreddit: boolean) {
  return z.object({
    subreddit: requireSubreddit
      ? z.string().superRefine((value, ctx) => {
          const name = normalizeSubreddit(value);
          if (!name) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Escribe el nombre de un subreddit." });
          } else if (!isValidSubreddit(name)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `"${name}" no es un nombre válido: usa de ${CONTENT_FEED_LIMITS.subredditMinLength} a ${CONTENT_FEED_LIMITS.subredditMaxLength} letras, números o guion bajo (_), sin espacios.`,
            });
          }
        })
      : z.string(),
    channelId: z.string().min(1, "Elige el canal donde se van a publicar."),
    postInterval: z
      .number({
        required_error: "Escribe cada cuántos minutos publicar.",
        invalid_type_error: "Escribe cada cuántos minutos publicar.",
      })
      .int("Usa minutos enteros, sin decimales.")
      .min(INTERVAL_MIN, `Lo mínimo es ${INTERVAL_MIN} ${INTERVAL_MIN === 1 ? "minuto" : "minutos"}.`)
      .max(INTERVAL_MAX, `Lo máximo es ${INTERVAL_MAX} minutos (${INTERVAL_MAX / 60} horas).`),
  });
}

type FeedFormValues = z.infer<ReturnType<typeof buildSchema>>;

/** Campos del 400 del servidor → campos del formulario. */
const SERVER_FIELD_MAP: Record<string, keyof FeedFormValues> = {
  "sourceConfig.subreddit": "subreddit",
  sourceConfig: "subreddit",
  channelId: "channelId",
  postInterval: "postInterval",
};

export type FeedDialogMode =
  | { kind: "create"; defaultChannelId: string | null }
  | { kind: "edit"; feed: ContentFeedItem };

interface FeedFormDialogProps {
  guildId: string;
  mode: FeedDialogMode;
  /** Feeds que ya existen (para avisar de duplicados). */
  existingFeeds: ContentFeedItem[];
  onClose: () => void;
}

/**
 * Crear o editar un feed de Reddit. Se monta al abrirlo y se desmonta al cerrarlo,
 * así el formulario siempre empieza limpio.
 */
export function FeedFormDialog({ guildId, mode, existingFeeds, onClose }: FeedFormDialogProps) {
  const { toast } = useToast();
  const channelsQuery = useDiscordChannels(guildId);
  const channels = channelsQuery.data;
  const isCreate = mode.kind === "create";
  const editingFeed = mode.kind === "edit" ? mode.feed : null;

  const schema = useMemo(() => buildSchema(isCreate), [isCreate]);

  const form = useForm<FeedFormValues>({
    resolver: zodResolver(schema),
    mode: "onTouched",
    defaultValues: editingFeed
      ? {
          subreddit: feedSubreddit(editingFeed) ?? "",
          channelId: editingFeed.channelId ?? "",
          postInterval: editingFeed.postInterval,
        }
      : {
          subreddit: "",
          channelId: mode.kind === "create" && mode.defaultChannelId ? mode.defaultChannelId : "",
          postInterval: DEFAULT_POST_INTERVAL,
        },
  });

  const subredditInput = form.watch("subreddit");
  const channelId = form.watch("channelId");
  const postInterval = form.watch("postInterval");

  const subredditName = normalizeSubreddit(subredditInput ?? "");
  const subredditOk = isValidSubreddit(subredditName);
  const duplicates = isCreate && subredditOk
    ? existingFeeds.filter(
        (feed) =>
          feedKind(feed) === "reddit" && feedSubreddit(feed)?.toLowerCase() === subredditName.toLowerCase(),
      )
    : [];
  const duplicateWhere = duplicates.length > 0 ? channelLabel(channels, duplicates[0].channelId) : null;
  const proposedDefault =
    mode.kind === "create" && !!mode.defaultChannelId && channelId === mode.defaultChannelId;

  const applyServerError = (error: unknown) => {
    const details = errorDetails(error);
    let mapped = false;
    for (const detail of details) {
      const field = SERVER_FIELD_MAP[detail.field];
      if (field) {
        form.setError(field, { type: "server", message: detail.message });
        mapped = true;
      }
    }
    if (!mapped) form.setError("root.server", { type: "server", message: errorText(error) });
  };

  const createMutation = useMutation({
    mutationFn: async (body: ContentFeedCreateRequest) => {
      const res = await apiRequest("POST", `/api/social/${guildId}/feeds`, body);
      return (await res.json()) as ContentFeedResponse;
    },
    onSuccess: (feed) => {
      void invalidatePaths([`/api/social/${guildId}`]);
      const where = channelLabel(channels, feed.channelId);
      toast({
        title: "¡Feed creado!",
        description: `El bot publicará imágenes de r/${feedSubreddit(feed) ?? subredditName}${where ? ` en ${where}` : ""} ${formatInterval(feed.postInterval)}.`,
      });
      onClose();
    },
    onError: (error) => {
      if (isApiError(error) && error.status === 409) {
        // Límite de feeds: puede que la lista estuviera desactualizada
        void invalidatePaths([`/api/social/${guildId}`]);
        toast({ variant: "destructive", title: "Llegaste al límite de feeds", description: error.message });
        form.setError("root.server", { type: "server", message: error.message });
        return;
      }
      applyServerError(error);
      toast({ variant: "destructive", title: "No se pudo crear el feed", description: errorText(error) });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ feedId, body }: { feedId: string; body: ContentFeedUpdateRequest }) => {
      const res = await apiRequest("PATCH", `/api/social/${guildId}/feeds/${feedId}`, body);
      return (await res.json()) as ContentFeedResponse;
    },
    onSuccess: () => {
      void invalidatePaths([`/api/social/${guildId}`]);
      toast({ title: "Cambios guardados", description: "El feed ya usa la nueva configuración." });
      onClose();
    },
    onError: (error) => {
      if (isApiError(error) && error.status === 404) void invalidatePaths([`/api/social/${guildId}`]);
      applyServerError(error);
      toast({ variant: "destructive", title: "No se pudieron guardar los cambios", description: errorText(error) });
    },
  });

  const pending = createMutation.isPending || updateMutation.isPending;
  const channelsReady = channelsQuery.isSuccess;

  const onSubmit = (values: FeedFormValues) => {
    form.clearErrors("root");
    if (mode.kind === "create") {
      createMutation.mutate({
        source: "reddit",
        channelId: values.channelId,
        // El bot nunca publica contenido NSFW; se guarda explícito
        sourceConfig: { subreddit: normalizeSubreddit(values.subreddit), filterNSFW: true },
        postInterval: values.postInterval,
      });
      return;
    }

    const feed = mode.feed;
    const body: ContentFeedUpdateRequest = {};
    if (values.channelId !== (feed.channelId ?? "")) body.channelId = values.channelId;
    if (values.postInterval !== feed.postInterval) body.postInterval = values.postInterval;
    if (Object.keys(body).length === 0) {
      toast({ title: "No hay cambios", description: "El feed ya estaba así." });
      onClose();
      return;
    }
    updateMutation.mutate({ feedId: feed.id, body });
  };

  const rootError = form.formState.errors.root?.server?.message;
  const channelIssue = getChannelIssue(channels, channelId || null);
  const editingSubreddit = editingFeed ? feedSubreddit(editingFeed) : null;

  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent
        className="max-h-[90vh] w-[calc(100%-2rem)] overflow-y-auto rounded-lg sm:w-full"
        data-testid="dialog-feed-form"
      >
        <DialogHeader>
          <DialogTitle>
            {isCreate ? "Nuevo feed de Reddit" : `Editar ${editingSubreddit ? `r/${editingSubreddit}` : "feed"}`}
          </DialogTitle>
          <DialogDescription>
            Cada cierto tiempo, el bot toma una imagen al azar de lo más popular del subreddit y la publica en el
            canal que elijas.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5" noValidate>
            {/* Subreddit */}
            {isCreate ? (
              <FormField
                control={form.control}
                name="subreddit"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Subreddit</FormLabel>
                    <div className="relative">
                      <span
                        className="pointer-events-none absolute inset-y-0 left-3 flex items-center font-mono text-sm text-muted-foreground"
                        aria-hidden="true"
                      >
                        r/
                      </span>
                      <FormControl>
                        <Input
                          {...field}
                          className="pl-8 font-mono"
                          placeholder="memes"
                          autoComplete="off"
                          autoCapitalize="none"
                          spellCheck={false}
                          maxLength={200}
                          data-testid="input-subreddit"
                        />
                      </FormControl>
                    </div>
                    <FormDescription>
                      El nombre tal como aparece en Reddit (sin «r/»). También puedes pegar el enlace del subreddit.
                    </FormDescription>
                    {subredditOk && (
                      <a
                        href={subredditUrl(subredditName)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-primary underline-offset-4 hover:underline"
                      >
                        Ver r/{subredditName} en Reddit para comprobar que existe
                        <ExternalLink className="h-3 w-3" aria-hidden="true" />
                        <span className="sr-only">(se abre en otra pestaña)</span>
                      </a>
                    )}
                    {duplicates.length > 0 && (
                      <p className="text-xs text-status-warning">
                        Ya tienes {duplicates.length === 1 ? "un feed" : `${duplicates.length} feeds`} de r/{subredditName}
                        {duplicateWhere ? ` (en ${duplicateWhere})` : ""}. Puedes crear otro, pero es probable que se
                        repitan imágenes.
                      </p>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />
            ) : (
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">Subreddit</p>
                <p className="font-mono text-sm text-foreground">
                  {editingSubreddit ? `r/${editingSubreddit}` : "Sin subreddit"}
                </p>
                <p className="text-xs text-muted-foreground">
                  El subreddit no se puede cambiar. Si quieres otro, crea un feed nuevo y borra este.
                </p>
              </div>
            )}

            {/* Canal */}
            <FormField
              control={form.control}
              name="channelId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Canal donde se publica</FormLabel>
                  {channelsQuery.isLoading ? (
                    <Skeleton className="h-9 w-full" />
                  ) : channelsQuery.isError ? (
                    <div className="rounded-md border border-status-warning/40 bg-status-warning/10 p-3 text-sm" role="alert">
                      <p className="font-medium text-foreground">{getApiErrorInfo(channelsQuery.error).title}</p>
                      <p className="mt-1 text-muted-foreground">
                        No pudimos cargar los canales del servidor, así que por ahora no se puede elegir uno.
                      </p>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="mt-2"
                        onClick={() => void channelsQuery.refetch()}
                        disabled={channelsQuery.isFetching}
                      >
                        {channelsQuery.isFetching && <Loader2 className="animate-spin" aria-hidden="true" />}
                        Reintentar
                      </Button>
                    </div>
                  ) : (
                    <FormControl>
                      <ChannelPicker
                        value={field.value || null}
                        onChange={(value) => field.onChange(value ?? "")}
                        channels={channels ?? []}
                        placeholder="Elige un canal de texto"
                        disabled={pending}
                        data-testid="select-feed-channel"
                      />
                    </FormControl>
                  )}
                  {proposedDefault && !channelIssue && (
                    <FormDescription>
                      Te propusimos tu canal de contenido (lo eliges en la página Canales).
                    </FormDescription>
                  )}
                  <ChannelIssueNote issue={channelIssue} />
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Intervalo */}
            <FormField
              control={form.control}
              name="postInterval"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Cada cuánto publicar (minutos)</FormLabel>
                  <div className="flex flex-wrap gap-2" role="group" aria-label="Atajos de intervalo">
                    {POST_INTERVAL_PRESETS.map((minutes) => {
                      const active = field.value === minutes;
                      return (
                        <Button
                          key={minutes}
                          type="button"
                          size="sm"
                          variant={active ? "default" : "outline"}
                          aria-pressed={active}
                          onClick={() => form.setValue("postInterval", minutes, { shouldDirty: true, shouldValidate: true })}
                          disabled={pending}
                        >
                          {formatIntervalShort(minutes)}
                        </Button>
                      );
                    })}
                  </div>
                  <div className="flex items-center gap-2">
                    <FormControl>
                      <Input
                        type="number"
                        inputMode="numeric"
                        min={INTERVAL_MIN}
                        max={INTERVAL_MAX}
                        step={1}
                        className="w-28 font-mono"
                        name={field.name}
                        ref={field.ref}
                        onBlur={field.onBlur}
                        value={Number.isFinite(field.value) ? field.value : ""}
                        onChange={(event) =>
                          field.onChange(event.target.value === "" ? Number.NaN : event.target.valueAsNumber)
                        }
                        disabled={pending}
                        data-testid="input-post-interval"
                      />
                    </FormControl>
                    <span className="text-sm text-muted-foreground">
                      {Number.isFinite(postInterval) && postInterval >= INTERVAL_MIN && postInterval <= INTERVAL_MAX
                        ? `= ${formatInterval(postInterval)}`
                        : "minutos"}
                    </span>
                  </div>
                  <FormDescription>
                    Entre {INTERVAL_MIN} y {INTERVAL_MAX} minutos ({INTERVAL_MAX / 60} horas).
                  </FormDescription>
                  {Number.isFinite(postInterval) &&
                    postInterval >= INTERVAL_MIN &&
                    postInterval < SHORT_INTERVAL_WARNING_MINUTES && (
                      <p className="text-xs text-status-warning">
                        Ojo: con un intervalo tan corto el canal se llena rápido y Reddit puede limitar al bot.
                      </p>
                    )}
                  <FormMessage />
                </FormItem>
              )}
            />

            <p className="flex items-start gap-2 rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
              <span>
                Solo se publican posts con imagen y nunca contenido para adultos (NSFW). Si en ese momento Reddit no
                responde o no hay imágenes, ese turno se salta.
              </span>
            </p>

            {rootError && (
              <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive" role="alert">
                {rootError}
              </p>
            )}

            <DialogFooter className="gap-2 sm:space-x-0">
              <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={pending || !channelsReady}
                className={cn(pending && "cursor-wait")}
                data-testid="button-submit-feed"
              >
                {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
                {isCreate ? (pending ? "Creando…" : "Crear feed") : pending ? "Guardando…" : "Guardar cambios"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

/** Para mostrar el canal propuesto solo si sirve (existe y el bot puede publicar). */
export function usableDefaultChannel(
  channels: Parameters<typeof findChannel>[0],
  channelId: string | null | undefined,
): string | null {
  const channel = findChannel(channels, channelId);
  return channel && channel.type !== "voice" && channel.botCanPost ? channel.id : null;
}
