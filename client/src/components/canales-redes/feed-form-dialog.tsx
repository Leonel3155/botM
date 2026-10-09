import { useMemo } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation } from "@tanstack/react-query";
import { ExternalLink, Image as ImageIcon, Info, Loader2, Newspaper } from "lucide-react";
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
  NEWS_SECTIONS,
  NEWS_SECTION_LABELS,
  NEWS_TOPIC_SUGGESTIONS,
  POST_INTERVAL_PRESETS,
  SHORT_INTERVAL_WARNING_MINUTES,
  feedKind,
  feedNews,
  feedSubreddit,
  feedTitle,
  formatInterval,
  formatIntervalShort,
  isValidSubreddit,
  normalizeSubreddit,
  subredditUrl,
  type NewsSection,
} from "./feed-utils";

const { min: REDDIT_INTERVAL_MIN, max: INTERVAL_MAX } = CONTENT_FEED_LIMITS.postInterval;
const NEWS_INTERVAL_MIN = CONTENT_FEED_LIMITS.newsMinInterval;

type FeedType = "news" | "reddit";
type NewsMode = "section" | "topic" | "url";

const NEWS_MODES: { value: NewsMode; label: string }[] = [
  { value: "section", label: "Sección" },
  { value: "topic", label: "Tema" },
  { value: "url", label: "Sitio o RSS" },
];

function intervalMin(type: FeedType): number {
  return type === "news" ? NEWS_INTERVAL_MIN : REDDIT_INTERVAL_MIN;
}

/** En crear se valida lo del tipo elegido; en editar solo canal e intervalo. */
function buildSchema(isCreate: boolean, editingType: FeedType) {
  return z
    .object({
      type: z.enum(["news", "reddit"]),
      subreddit: z.string(),
      newsMode: z.enum(["section", "topic", "url"]),
      section: z.string(),
      topic: z.string(),
      url: z.string(),
      channelId: z.string().min(1, "Elige el canal donde se van a publicar."),
      // NaN = casilla vacía; se revisa abajo para que no tape los demás errores del formulario
      postInterval: z.number().or(z.nan()),
    })
    .superRefine((values, ctx) => {
      const type = isCreate ? values.type : editingType;
      const min = intervalMin(type);
      if (!Number.isFinite(values.postInterval)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["postInterval"], message: "Escribe cada cuántos minutos." });
      } else if (!Number.isInteger(values.postInterval)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["postInterval"], message: "Usa minutos enteros, sin decimales." });
      } else if (values.postInterval > INTERVAL_MAX) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["postInterval"],
          message: `Lo máximo es ${INTERVAL_MAX} minutos (${INTERVAL_MAX / 60} horas).`,
        });
      } else if (values.postInterval < min) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["postInterval"],
          message:
            type === "news"
              ? `Para noticias, lo mínimo es ${min} minutos.`
              : `Lo mínimo es ${min} ${min === 1 ? "minuto" : "minutos"}.`,
        });
      }
      if (!isCreate) return;

      if (type === "reddit") {
        const name = normalizeSubreddit(values.subreddit);
        if (!name) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["subreddit"], message: "Escribe el nombre de un subreddit." });
        } else if (!isValidSubreddit(name)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["subreddit"],
            message: `"${name}" no es un nombre válido: usa de ${CONTENT_FEED_LIMITS.subredditMinLength} a ${CONTENT_FEED_LIMITS.subredditMaxLength} letras, números o guion bajo (_), sin espacios.`,
          });
        }
        return;
      }

      if (values.newsMode === "section") {
        if (!(NEWS_SECTIONS as readonly string[]).includes(values.section)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["section"], message: "Elige una sección." });
        }
      } else if (values.newsMode === "topic") {
        const topic = values.topic.trim();
        if (topic.length < CONTENT_FEED_LIMITS.newsTopicMinLength) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["topic"], message: "Escribe de qué quieres noticias." });
        } else if (topic.length > CONTENT_FEED_LIMITS.newsTopicMaxLength) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["topic"],
            message: `El tema puede tener hasta ${CONTENT_FEED_LIMITS.newsTopicMaxLength} letras.`,
          });
        }
      } else {
        const url = values.url.trim();
        if (url.length < 4 || !url.includes(".")) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["url"], message: "Pega el enlace del sitio o de su RSS." });
        } else if (url.length > CONTENT_FEED_LIMITS.newsUrlMaxLength) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["url"], message: "Ese enlace es demasiado largo." });
        }
      }
    });
}

type FeedFormValues = z.infer<ReturnType<typeof buildSchema>>;

/** Campos del 400 del servidor → campos del formulario. */
function serverField(field: string, values: FeedFormValues): keyof FeedFormValues | null {
  switch (field) {
    case "sourceConfig.subreddit":
      return "subreddit";
    case "sourceConfig.section":
      return "section";
    case "sourceConfig.topic":
      return "topic";
    case "sourceConfig.url":
      return "url";
    case "sourceConfig":
      if (values.type === "reddit") return "subreddit";
      return values.newsMode === "section" ? "section" : values.newsMode === "topic" ? "topic" : "url";
    case "channelId":
      return "channelId";
    case "postInterval":
      return "postInterval";
    default:
      return null;
  }
}

/** Botones tipo "pastilla" para elegir una opción. */
function ChoiceButtons<T extends string>({
  options,
  value,
  onChange,
  disabled,
  label,
}: {
  options: readonly { value: T; label: string }[];
  value: T | "";
  onChange: (value: T) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label={label}>
      {options.map((option) => {
        const active = value === option.value;
        return (
          <Button
            key={option.value}
            type="button"
            size="sm"
            variant={active ? "default" : "outline"}
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            disabled={disabled}
          >
            {option.label}
          </Button>
        );
      })}
    </div>
  );
}

const SECTION_OPTIONS = NEWS_SECTIONS.map((section) => ({ value: section, label: NEWS_SECTION_LABELS[section] }));

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
 * Crear o editar un feed (noticias o Reddit). Se monta al abrirlo y se desmonta al cerrarlo,
 * así el formulario siempre empieza limpio.
 */
export function FeedFormDialog({ guildId, mode, existingFeeds, onClose }: FeedFormDialogProps) {
  const { toast } = useToast();
  const channelsQuery = useDiscordChannels(guildId);
  const channels = channelsQuery.data;
  const isCreate = mode.kind === "create";
  const editingFeed = mode.kind === "edit" ? mode.feed : null;
  const editingType: FeedType = editingFeed && feedKind(editingFeed) === "rss" ? "news" : "reddit";

  const schema = useMemo(() => buildSchema(isCreate, editingType), [isCreate, editingType]);

  const form = useForm<FeedFormValues>({
    resolver: zodResolver(schema),
    mode: "onTouched",
    defaultValues: {
      type: editingFeed ? editingType : "news",
      subreddit: editingFeed ? feedSubreddit(editingFeed) ?? "" : "",
      newsMode: "section",
      section: "",
      topic: "",
      url: "",
      channelId: editingFeed
        ? editingFeed.channelId ?? ""
        : mode.kind === "create" && mode.defaultChannelId
          ? mode.defaultChannelId
          : "",
      postInterval: editingFeed ? editingFeed.postInterval : DEFAULT_POST_INTERVAL,
    },
  });

  const watchedType = form.watch("type");
  const type: FeedType = isCreate ? watchedType : editingType;
  const newsMode = form.watch("newsMode");
  const section = form.watch("section");
  const topicInput = form.watch("topic");
  const urlInput = form.watch("url");
  const subredditInput = form.watch("subreddit");
  const channelId = form.watch("channelId");
  const postInterval = form.watch("postInterval");
  const minInterval = intervalMin(type);

  const subredditName = normalizeSubreddit(subredditInput ?? "");
  const subredditOk = isValidSubreddit(subredditName);

  // Feeds que ya publican lo mismo (solo para avisar; se puede crear igual)
  const duplicates = !isCreate
    ? []
    : type === "reddit"
      ? subredditOk
        ? existingFeeds.filter(
            (feed) =>
              feedKind(feed) === "reddit" && feedSubreddit(feed)?.toLowerCase() === subredditName.toLowerCase(),
          )
        : []
      : existingFeeds.filter((feed) => {
          if (feedKind(feed) !== "rss") return false;
          const news = feedNews(feed);
          if (newsMode === "section") return !!section && news.section === section;
          if (newsMode === "topic") {
            const topic = topicInput.trim().toLowerCase();
            return !!topic && news.topic?.toLowerCase() === topic;
          }
          const url = urlInput.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/+$/, "");
          return !!url && [news.url, news.siteUrl].some(
            (value) => value?.toLowerCase().replace(/^https?:\/\//, "").replace(/\/+$/, "") === url,
          );
        });
  const duplicateWhere = duplicates.length > 0 ? channelLabel(channels, duplicates[0].channelId) : null;
  const duplicateName = duplicates.length > 0 ? feedTitle(duplicates[0]) : "";
  const proposedDefault =
    mode.kind === "create" && !!mode.defaultChannelId && channelId === mode.defaultChannelId;

  const applyServerError = (error: unknown) => {
    const details = errorDetails(error);
    const values = form.getValues();
    let mapped = false;
    for (const detail of details) {
      const field = serverField(detail.field, values);
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
        description:
          feedKind(feed) === "rss"
            ? `El bot revisará ${feedTitle(feed)} ${formatInterval(feed.postInterval)} y publicará lo nuevo${where ? ` en ${where}` : ""}. La primera noticia sale en el próximo minuto.`
            : `El bot publicará imágenes de r/${feedSubreddit(feed) ?? subredditName}${where ? ` en ${where}` : ""} ${formatInterval(feed.postInterval)}.`,
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
      if (values.type === "reddit") {
        createMutation.mutate({
          source: "reddit",
          channelId: values.channelId,
          // El bot se salta lo marcado como NSFW; se guarda explícito
          sourceConfig: { subreddit: normalizeSubreddit(values.subreddit), filterNSFW: true },
          postInterval: values.postInterval,
        });
        return;
      }
      createMutation.mutate({
        source: "rss",
        channelId: values.channelId,
        sourceConfig:
          values.newsMode === "section"
            ? { section: values.section as NewsSection }
            : values.newsMode === "topic"
              ? { topic: values.topic.trim() }
              : { url: values.url.trim() },
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

  // Valida al momento si ya se intentó enviar o si el campo ya se tocó (así no queda un error viejo debajo)
  const setValue = <K extends keyof FeedFormValues>(name: K, value: FeedFormValues[K]) => {
    const state = form.getFieldState(name);
    form.setValue(name, value as never, {
      shouldDirty: true,
      shouldValidate: form.formState.isSubmitted || state.isTouched || !!state.error,
    });
  };

  const chooseType = (next: FeedType) => {
    if (next === type) return;
    setValue("type", next);
    form.clearErrors();
    // Las noticias no se revisan tan seguido como Reddit
    const current = form.getValues("postInterval");
    if (next === "news" && Number.isFinite(current) && current < NEWS_INTERVAL_MIN) setValue("postInterval", DEFAULT_POST_INTERVAL);
  };

  const rootError = form.formState.errors.root?.server?.message;
  const channelIssue = getChannelIssue(channels, channelId || null);
  const editingName = editingFeed ? feedTitle(editingFeed) : null;

  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent
        className="max-h-[90vh] w-[calc(100%-2rem)] overflow-y-auto rounded-lg sm:w-full"
        data-testid="dialog-feed-form"
      >
        <DialogHeader>
          <DialogTitle>{isCreate ? "Nuevo feed" : `Editar ${editingName ?? "feed"}`}</DialogTitle>
          <DialogDescription>
            {type === "news"
              ? "Cada cierto tiempo, el bot revisa el feed y publica las noticias nuevas en el canal que elijas."
              : "Cada cierto tiempo, el bot toma una imagen al azar de lo más popular del subreddit y la publica en el canal que elijas."}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5" noValidate>
            {/* Qué publica */}
            {isCreate ? (
              <>
                <div className="space-y-2">
                  <p className="text-sm font-medium text-foreground">Qué quieres publicar</p>
                  <div className="grid grid-cols-2 gap-2" role="group" aria-label="Tipo de feed">
                    {(
                      [
                        { value: "news", label: "Noticias", Icon: Newspaper },
                        { value: "reddit", label: "Memes de Reddit", Icon: ImageIcon },
                      ] as const
                    ).map(({ value, label, Icon }) => (
                      <Button
                        key={value}
                        type="button"
                        variant={type === value ? "default" : "outline"}
                        aria-pressed={type === value}
                        onClick={() => chooseType(value)}
                        disabled={pending}
                        data-testid={`button-feed-type-${value}`}
                      >
                        <Icon aria-hidden="true" />
                        {label}
                      </Button>
                    ))}
                  </div>
                </div>

                {type === "news" ? (
                  <div className="space-y-3">
                    <div className="space-y-2">
                      <p className="text-sm font-medium text-foreground">De dónde</p>
                      <ChoiceButtons
                        options={NEWS_MODES}
                        value={newsMode}
                        onChange={(value) => {
                          setValue("newsMode", value);
                          form.clearErrors(["section", "topic", "url"]);
                        }}
                        disabled={pending}
                        label="De dónde salen las noticias"
                      />
                    </div>

                    {newsMode === "section" && (
                      <FormField
                        control={form.control}
                        name="section"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Sección de Google Noticias</FormLabel>
                            <ChoiceButtons
                              options={SECTION_OPTIONS}
                              value={field.value as NewsSection | ""}
                              onChange={(value) => setValue("section", value)}
                              disabled={pending}
                              label="Sección"
                            />
                            <FormDescription>Las noticias más importantes de esa sección, en español (edición México).</FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    )}

                    {newsMode === "topic" && (
                      <FormField
                        control={form.control}
                        name="topic"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Tema</FormLabel>
                            <FormControl>
                              <Input
                                {...field}
                                placeholder="videojuegos"
                                autoComplete="off"
                                maxLength={CONTENT_FEED_LIMITS.newsTopicMaxLength}
                                data-testid="input-news-topic"
                              />
                            </FormControl>
                            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Temas sugeridos">
                              {NEWS_TOPIC_SUGGESTIONS.map((suggestion) => (
                                <Button
                                  key={suggestion}
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  className="h-7 px-2 text-xs"
                                  onClick={() => setValue("topic", suggestion)}
                                  disabled={pending}
                                >
                                  {suggestion}
                                </Button>
                              ))}
                            </div>
                            <FormDescription>
                              El bot busca ese tema en Google Noticias y publica lo de los últimos días.
                            </FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    )}

                    {newsMode === "url" && (
                      <FormField
                        control={form.control}
                        name="url"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Enlace del sitio o de su RSS</FormLabel>
                            <FormControl>
                              <Input
                                {...field}
                                type="url"
                                inputMode="url"
                                className="font-mono"
                                placeholder="https://www.xataka.com.mx"
                                autoComplete="off"
                                autoCapitalize="none"
                                spellCheck={false}
                                maxLength={CONTENT_FEED_LIMITS.newsUrlMaxLength}
                                data-testid="input-news-url"
                              />
                            </FormControl>
                            <FormDescription>
                              Pega la página principal de un sitio de noticias o de un canal de YouTube y el bot busca
                              su RSS solo. También sirve el enlace directo al RSS.
                            </FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    )}

                    {duplicates.length > 0 && (
                      <p className="text-xs text-status-warning">
                        Ya tienes {duplicates.length === 1 ? "un feed" : `${duplicates.length} feeds`} de {duplicateName}
                        {duplicateWhere ? ` (en ${duplicateWhere})` : ""}. Puedes crear otro, pero se repetirán las
                        noticias.
                      </p>
                    )}
                  </div>
                ) : (
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
                )}
              </>
            ) : (
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">{type === "news" ? "Origen" : "Subreddit"}</p>
                <p className={cn("text-sm text-foreground", type === "reddit" && "font-mono")}>{editingName}</p>
                <p className="text-xs text-muted-foreground">
                  {type === "news"
                    ? "El origen no se puede cambiar. Si quieres otro, crea un feed nuevo y borra este."
                    : "El subreddit no se puede cambiar. Si quieres otro, crea un feed nuevo y borra este."}
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
                  <FormLabel>{type === "news" ? "Cada cuánto revisar (minutos)" : "Cada cuánto publicar (minutos)"}</FormLabel>
                  <div className="flex flex-wrap gap-2" role="group" aria-label="Atajos de intervalo">
                    {POST_INTERVAL_PRESETS.filter((minutes) => minutes >= minInterval).map((minutes) => {
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
                        min={minInterval}
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
                      {Number.isFinite(postInterval) && postInterval >= minInterval && postInterval <= INTERVAL_MAX
                        ? `= ${formatInterval(postInterval)}`
                        : "minutos"}
                    </span>
                  </div>
                  <FormDescription>
                    Entre {minInterval} y {INTERVAL_MAX} minutos ({INTERVAL_MAX / 60} horas).
                  </FormDescription>
                  {type === "reddit" &&
                    Number.isFinite(postInterval) &&
                    postInterval >= minInterval &&
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
              {type === "news" ? (
                <span>
                  En cada turno publica hasta {CONTENT_FEED_LIMITS.newsMaxPerTurn} noticias nuevas (las más recientes) y
                  nunca repite. La primera vez publica la más reciente para que veas cómo queda; después, nada de más de
                  3 días. Las de Google Noticias salen sin imagen; las de muchos sitios sí la traen.
                </span>
              ) : (
                <span>
                  Solo se publican posts con imagen, y se salta lo que Reddit marca como NSFW. Si en ese momento
                  Reddit no responde o no hay imágenes, ese turno se salta. Reddit apaga su RSS el 13 de noviembre de 2026.
                </span>
              )}
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
                {isCreate
                  ? pending
                    ? type === "news"
                      ? "Revisando el feed…"
                      : "Creando…"
                    : "Crear feed"
                  : pending
                    ? "Guardando…"
                    : "Guardar cambios"}
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
