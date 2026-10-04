import { useState } from "react";
import { useMutation, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { useFormContext, useWatch } from "react-hook-form";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { Loader2, MessagesSquare, Send } from "lucide-react";
import type { DiscordChannelsResponse, EngagementSettingsResponse, PostQuestionNowResponse } from "@shared/api";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectGroup, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { ChannelField, channelLabel } from "./channel-field";
import type { EngagementFormValues } from "./form";
import { discordLinkAction, retryAfterSecondsFrom, useCooldown, useNow } from "./hooks";
import { RichSelectItem } from "./rich-select-item";
import { InfoRow, InlineWarning, SectionHeader, type SectionStatus } from "./section-parts";
import {
  HOURS_OF_DAY,
  TIMEZONE_GROUPS,
  atHour12,
  computeNextDailyQuestion,
  currentTimePhrase,
  describeInViewerZone,
  describeLocalDay,
  describeMoment,
  findTimezoneOption,
  formatHour12,
  hourHint,
  timezoneShortLabel,
} from "./time";

type SavedQuestion = EngagementSettingsResponse["dailyQuestion"];

const numberFormat = new Intl.NumberFormat("es-MX");

interface DailyQuestionCardProps {
  guildId: string;
  saved: SavedQuestion;
  /** Esta sección tiene cambios sin guardar */
  dirty: boolean;
  botInGuild: boolean;
  channelsQuery: UseQueryResult<DiscordChannelsResponse>;
}

function questionStatus(saved: SavedQuestion, channelName: string | null): SectionStatus {
  if (!saved.enabled) {
    return { kind: "offline", text: "Apagada: el servidor no recibe una pregunta diaria." };
  }
  if (!saved.channelId) {
    return { kind: "warning", text: "Activada, pero falta elegir el canal de la pregunta." };
  }
  if (saved.channelProblem) {
    return { kind: "warning", text: `Activada, pero hay un problema: ${saved.channelProblem}` };
  }
  const where = channelName ? ` en ${channelName}` : "";
  return {
    kind: "online",
    text: `Activada: una pregunta todos los días ${atHour12(saved.hour)} (hora de ${timezoneShortLabel(saved.timezone)})${where}.`,
  };
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Tarjeta "Pregunta del día": interruptor, canal, hora, zona, hilo, próxima publicación y "publicar ahora". */
export function DailyQuestionCard({ guildId, saved, dirty, botInGuild, channelsQuery }: DailyQuestionCardProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const form = useFormContext<EngagementFormValues>();
  const draft = useWatch({ control: form.control, name: "dailyQuestion" });
  const now = useNow();
  const cooldown = useCooldown();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const savedChannelName = channelLabel(channelsQuery.data, saved.channelId);
  const status = questionStatus(saved, savedChannelName);

  // ---- Próxima pregunta ----
  // Sin cambios: lo que calculó el servidor. Con cambios: la misma regla con los valores nuevos.
  let nextPost: Date | null = null;
  if (!dirty) {
    const parsed = saved.enabled && saved.nextPostAt ? new Date(saved.nextPostAt) : null;
    nextPost = parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
  } else if (draft) {
    nextPost = computeNextDailyQuestion(
      {
        enabled: draft.enabled ?? false,
        channelId: draft.channelId ?? null,
        hour: draft.hour ?? saved.hour,
        timezone: draft.timezone ?? saved.timezone,
        lastPosted: saved.lastPosted,
      },
      now,
    );
  }
  const scheduleTimezone = dirty && draft?.timezone ? draft.timezone : saved.timezone;
  const imminent = nextPost !== null && nextPost.getTime() - now.getTime() <= 60_000;
  const nextText = nextPost && !imminent ? describeMoment(nextPost, scheduleTimezone, now) : null;
  const nextViewerText = nextPost && !imminent ? describeInViewerZone(nextPost, scheduleTimezone, now) : null;
  const lastPostedText = saved.lastPosted ? describeLocalDay(saved.lastPosted, saved.timezone, now) : null;

  // ---- Publicar una ahora ----
  const postNow = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/guilds/${guildId}/engagement/post-question-now`);
      return (await res.json()) as PostQuestionNowResponse;
    },
    onSuccess: (data) => {
      const where = channelLabel(channelsQuery.data, data.channelId) ?? "el canal de la pregunta";
      toast({
        title: `¡Publiqué la pregunta #${numberFormat.format(data.questionNumber)}!`,
        description: `Ya está en ${where}. Cuenta como la pregunta de hoy.`,
        action: discordLinkAction(data.messageUrl),
      });
      // Cambian "última pregunta", el contador y la próxima publicación
      void queryClient.invalidateQueries({ queryKey: ["/api/guilds", guildId, "engagement"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/dashboard", guildId] });
    },
    onError: (error) => {
      const wait = retryAfterSecondsFrom(error);
      if (wait) cooldown.start(wait);
      toast({
        variant: "destructive",
        title: wait ? "Espera un momento" : "No se pudo publicar la pregunta",
        description: error.message,
      });
    },
  });

  let postBlocked: string | null = null;
  if (!botInGuild) postBlocked = "El bot tiene que estar en el servidor y conectado para publicar.";
  else if (!saved.channelId) postBlocked = "Primero elige el canal de la pregunta y guarda.";
  else if (dirty) postBlocked = "Guarda tus cambios primero: se publica con lo que está guardado.";

  return (
    <Card data-testid="card-daily-question">
      <SectionHeader
        icon={MessagesSquare}
        title="Pregunta del día"
        description="Cada día lanzo una pregunta para que la gente platique, aunque nadie más esté escribiendo."
        dirty={dirty}
        status={status}
        testId="status-daily-question"
        toggle={
          <FormField
            control={form.control}
            name="dailyQuestion.enabled"
            render={({ field }) => (
              <FormItem className="flex items-center gap-2 space-y-0">
                <FormLabel className="hidden text-sm font-normal text-muted-foreground sm:block">
                  {field.value ? "Activada" : "Apagada"}
                </FormLabel>
                <FormControl>
                  <Switch
                    ref={field.ref}
                    checked={field.value}
                    onCheckedChange={field.onChange}
                    onBlur={field.onBlur}
                    aria-label="Activar la pregunta del día"
                    data-testid="switch-daily-question"
                  />
                </FormControl>
              </FormItem>
            )}
          />
        }
      />

      <CardContent className="p-4 pt-0 sm:p-6 sm:pt-0">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
          {/* Ajustes */}
          <div className="min-w-0 space-y-6 lg:col-span-3">
            <ChannelField
              control={form.control}
              name="dailyQuestion.channelId"
              label="Canal de la pregunta"
              placeholder="Elige dónde publico la pregunta"
              channelsQuery={channelsQuery}
              savedChannelId={saved.channelId}
              savedProblem={saved.channelProblem}
              testId="select-question-channel"
            />

            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="dailyQuestion.hour"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Hora</FormLabel>
                    <Select value={String(field.value)} onValueChange={(next) => field.onChange(Number(next))}>
                      <FormControl>
                        <SelectTrigger ref={field.ref} onBlur={field.onBlur} data-testid="select-question-hour">
                          <SelectValue placeholder="Elige una hora" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent className="max-h-80">
                        {HOURS_OF_DAY.map((hour) => (
                          <RichSelectItem key={hour} value={String(hour)} hint={hourHint(hour)}>
                            {formatHour12(hour)}
                          </RichSelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormDescription>En la zona horaria del servidor.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="dailyQuestion.timezone"
                render={({ field }) => {
                  const option = findTimezoneOption(field.value);
                  const selectValue = option?.id ?? field.value;
                  const nowThere = field.value ? currentTimePhrase(field.value, now) : null;
                  // Zonas que no están en la lista (la guardada o la actual): se muestran tal cual para no perderlas
                  const customZones = Array.from(new Set([saved.timezone, field.value])).filter(
                    (zone): zone is string => !!zone && !findTimezoneOption(zone),
                  );
                  return (
                    <FormItem>
                      <FormLabel>Zona horaria</FormLabel>
                      <Select value={selectValue} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger ref={field.ref} onBlur={field.onBlur} data-testid="select-question-timezone">
                            <SelectValue placeholder="Elige la zona horaria" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent className="max-h-80">
                          {customZones.length > 0 && (
                            <>
                              <SelectGroup>
                                <SelectLabel className="text-xs uppercase tracking-wide text-muted-foreground">
                                  Zona guardada
                                </SelectLabel>
                                {customZones.map((zone) => {
                                  const time = currentTimePhrase(zone, now);
                                  return (
                                    <RichSelectItem key={zone} value={zone} hint={time ? `Ahora ${time}` : undefined}>
                                      {zone}
                                    </RichSelectItem>
                                  );
                                })}
                              </SelectGroup>
                              <SelectSeparator />
                            </>
                          )}
                          {TIMEZONE_GROUPS.map((group) => (
                            <SelectGroup key={group.label}>
                              <SelectLabel className="text-xs uppercase tracking-wide text-muted-foreground">
                                {group.label}
                              </SelectLabel>
                              {group.options.map((zone) => {
                                const time = currentTimePhrase(zone.id, now);
                                return (
                                  <RichSelectItem key={zone.id} value={zone.id} hint={time ? `Ahora ${time}` : undefined}>
                                    {zone.label}
                                  </RichSelectItem>
                                );
                              })}
                            </SelectGroup>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormDescription>
                        {nowThere ? `Allí ahora ${nowThere} ` : ""}También la uso para /evento.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  );
                }}
              />
            </div>

            <FormField
              control={form.control}
              name="dailyQuestion.thread"
              render={({ field }) => (
                <FormItem className="space-y-2">
                  <div className="flex items-start justify-between gap-4 rounded-lg border border-border bg-background/40 p-4">
                    <div className="min-w-0 space-y-1">
                      <FormLabel className="leading-snug">Crear un hilo para las respuestas</FormLabel>
                      <FormDescription>Así las respuestas quedan juntas y el canal no se llena.</FormDescription>
                    </div>
                    <FormControl>
                      <Switch
                        ref={field.ref}
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        onBlur={field.onBlur}
                        data-testid="switch-question-thread"
                      />
                    </FormControl>
                  </div>
                  {field.value && saved.thread && saved.threadProblem && draft?.channelId === saved.channelId && (
                    <InlineWarning>{saved.threadProblem}</InlineWarning>
                  )}
                </FormItem>
              )}
            />
          </div>

          {/* Calendario */}
          <div className="min-w-0 space-y-4 lg:col-span-2">
            <div className="rounded-lg border border-border bg-background/40 px-4 py-1.5">
              <dl className="divide-y divide-border" data-testid="info-daily-question">
                {nextPost && (
                  <InfoRow label={dirty ? "Próxima pregunta (al guardar)" : "Próxima pregunta"}>
                    {imminent ? (
                      <span className="text-primary">
                        {dirty
                          ? "En cuanto guardes: ya pasó esa hora hoy y aún no hay pregunta de hoy."
                          : "En menos de un minuto."}
                      </span>
                    ) : (
                      <>
                        <span className="font-medium">{nextText ? capitalize(nextText) : null}</span>
                        <span className="block text-xs text-muted-foreground">
                          {formatDistanceToNow(nextPost, { addSuffix: true, locale: es })}
                          {" · "}
                          hora de {timezoneShortLabel(scheduleTimezone)}
                          {nextViewerText ? ` · en tu hora: ${nextViewerText}` : ""}
                        </span>
                      </>
                    )}
                  </InfoRow>
                )}
                <InfoRow label="Última pregunta">
                  {lastPostedText ? capitalize(lastPostedText) : "Todavía no he publicado ninguna."}
                </InfoRow>
                <InfoRow label="Preguntas publicadas">
                  <span className="font-mono">{numberFormat.format(saved.postedCount)}</span>
                  {saved.totalQuestions > 0 && (
                    <span className="block text-xs text-muted-foreground">
                      Quedan {numberFormat.format(saved.remainingInCycle)} de{" "}
                      {numberFormat.format(saved.totalQuestions)} antes de empezar a repetir.
                    </span>
                  )}
                </InfoRow>
              </dl>
            </div>

            <div className="space-y-3 rounded-lg border border-border bg-background/40 p-4">
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">¿Quieres animar el chat ya?</p>
                <p className="text-sm text-muted-foreground">
                  {postBlocked ??
                    `Publico una pregunta ahora en ${savedChannelName ?? "el canal guardado"}. Cuenta como la pregunta de hoy, así que hoy ya no saldrá otra.`}
                </p>
              </div>
              <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
                <AlertDialogTrigger asChild>
                  <Button
                    type="button"
                    className="w-full sm:w-auto"
                    disabled={!!postBlocked || postNow.isPending || cooldown.remaining > 0}
                    data-testid="button-post-question-now"
                  >
                    {postNow.isPending ? <Loader2 className="animate-spin" /> : <Send />}
                    {postNow.isPending
                      ? "Publicando…"
                      : cooldown.remaining > 0
                        ? `Espera ${cooldown.remaining} s`
                        : "Publicar una ahora"}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>¿Publico una pregunta ahora?</AlertDialogTitle>
                    <AlertDialogDescription>
                      La publico en {savedChannelName ?? "el canal guardado"} en este momento. Cuenta como la pregunta
                      de hoy: {saved.enabled
                        ? `la automática de hoy ya no saldrá y mañana sigo ${atHour12(saved.hour)}.`
                        : "si activas la pregunta diaria, la siguiente saldrá mañana."}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction onClick={() => postNow.mutate()} data-testid="button-confirm-post-question">
                      Publicar ahora
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
