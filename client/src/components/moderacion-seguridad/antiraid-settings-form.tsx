import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useForm, useWatch, type UseFormReturn } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQuery } from "@tanstack/react-query";
import { Info, Loader2, RefreshCw, Save, SlidersHorizontal, TriangleAlert, Undo2 } from "lucide-react";
import {
  ANTI_RAID_LIMITS,
  type AntiRaidResponse,
  type AntiRaidUpdateRequest,
  type DiscordChannelItem,
  type DiscordChannelsResponse,
} from "@shared/api";
import type { AntiRaidAction, AntiRaidSettings } from "@shared/schema";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { isApiError } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { actionExplanation, describeRule } from "./antiraid-texts";
import { discordChannelsKey } from "./query-keys";
import { useAntiRaidUpdate } from "./use-antiraid";
import { describeMutationError, formatMinutes } from "./utils";

/** Valor del selector para "sin canal fijo" (logChannelId null). */
const AUTO_CHANNEL = "auto";

const LIMITS = ANTI_RAID_LIMITS;

/** Número entero dentro de los límites del bot (los inputs dan texto; se convierte al guardar). */
function intField(limits: { readonly min: number; readonly max: number }, unit: string) {
  return z
    .string()
    .trim()
    .min(1, "Escribe un número.")
    .regex(/^\d+$/, "Usa solo un número entero, sin puntos ni comas.")
    .refine((value) => {
      const n = Number(value);
      return n >= limits.min && n <= limits.max;
    }, `Elige un número entre ${limits.min} y ${limits.max} ${unit}.`);
}

const formSchema = z.object({
  joinThreshold: intField(LIMITS.joinThreshold, "entradas"),
  joinWindowSeconds: intField(LIMITS.joinWindowSeconds, "segundos"),
  action: z.string().min(1, "Elige qué hará el bot."),
  lockdownMinutes: intField(LIMITS.lockdownMinutes, "minutos"),
  minAccountAgeDays: intField(LIMITS.minAccountAgeDays, "días"),
  logChannelId: z.string(),
});

type FormValues = z.infer<typeof formSchema>;

const NUMBER_FIELDS = ["joinThreshold", "joinWindowSeconds", "lockdownMinutes", "minAccountAgeDays"] as const;
const FORM_FIELDS: readonly string[] = [...NUMBER_FIELDS, "action", "logChannelId"];

function toFormValues(config: AntiRaidSettings): FormValues {
  return {
    joinThreshold: String(config.joinThreshold),
    joinWindowSeconds: String(config.joinWindowSeconds),
    action: config.action,
    lockdownMinutes: String(config.lockdownMinutes),
    minAccountAgeDays: String(config.minAccountAgeDays),
    logChannelId: config.logChannelId ?? AUTO_CHANNEL,
  };
}

/**
 * Solo lo que la persona cambió respecto a los valores con los que empezó a editar (`baseline`),
 * no respecto a lo último del servidor: así no se pisa lo que otro cambió mientras tanto
 * (desde /antiraid configurar u otra pestaña) en campos que aquí nadie tocó.
 */
function changedFields(values: FormValues, baseline: AntiRaidSettings): AntiRaidUpdateRequest {
  const body: AntiRaidUpdateRequest = {};
  for (const field of NUMBER_FIELDS) {
    const value = Number(values[field]);
    if (value !== baseline[field]) body[field] = value;
  }
  if (values.action !== baseline.action) body.action = values.action as AntiRaidAction;
  const channel = values.logChannelId === AUTO_CHANNEL ? null : values.logChannelId;
  if (channel !== (baseline.logChannelId ?? null)) body.logChannelId = channel;
  return body;
}

/** Canales de texto agrupados por categoría (en el orden de Discord). */
function groupChannels(channels: DiscordChannelItem[]) {
  const groups: { category: string; channels: DiscordChannelItem[] }[] = [];
  for (const channel of channels) {
    if (channel.type === "voice") continue;
    let group = groups.find((g) => g.category === channel.category);
    if (!group) {
      group = { category: channel.category, channels: [] };
      groups.push(group);
    }
    group.channels.push(channel);
  }
  return groups;
}

interface NumberFieldProps {
  form: UseFormReturn<FormValues>;
  name: (typeof NUMBER_FIELDS)[number];
  label: string;
  unit: string;
  limits: { readonly min: number; readonly max: number };
  description: string;
}

function NumberField({ form, name, label, unit, limits, description }: NumberFieldProps) {
  return (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <div className="relative">
            <FormControl>
              <Input
                {...field}
                type="number"
                inputMode="numeric"
                min={limits.min}
                max={limits.max}
                step={1}
                className="pr-24 font-mono"
                data-testid={`input-antiraid-${name}`}
              />
            </FormControl>
            <span
              className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground"
              aria-hidden="true"
            >
              {unit}
            </span>
          </div>
          <FormDescription className="text-xs">
            {description} Entre {limits.min} y {limits.max}.
          </FormDescription>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

interface AntiRaidSettingsFormProps {
  guildId: string;
  data: AntiRaidResponse;
  botInGuild: boolean;
}

/** Cuándo se detecta un raid, qué hace el bot y dónde avisa. */
export function AntiRaidSettingsForm({ guildId, data, botInGuild }: AntiRaidSettingsFormProps) {
  const { toast } = useToast();
  const update = useAntiRaidUpdate(guildId);
  const [warnings, setWarnings] = useState<string[]>([]);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: toFormValues(data.config),
    mode: "onChange",
  });
  const { isDirty } = form.formState;

  // Configuración desde la que se empezó a editar: al guardar se compara contra esta
  const [baseline, setBaseline] = useState<AntiRaidSettings>(data.config);
  const resetTo = useCallback(
    (config: AntiRaidSettings) => {
      setBaseline(config);
      form.reset(toFormValues(config));
    },
    [form],
  );

  // Si cambia en otro lado (Discord, otra pestaña), mostramos lo nuevo salvo que estés editando.
  // También al dejar de editar (p. ej. si vuelves a poner los valores de antes), para no quedarnos con lo viejo.
  const serverKey = JSON.stringify(toFormValues(data.config));
  const latestConfig = useRef(data.config);
  latestConfig.current = data.config;
  useEffect(() => {
    if (!isDirty) resetTo(latestConfig.current);
  }, [serverKey, isDirty, resetTo]);
  // …y si estás editando, te avisamos de que hay algo nuevo
  const changedElsewhere = isDirty && serverKey !== JSON.stringify(toFormValues(baseline));

  const channelsQuery = useQuery<DiscordChannelsResponse>({
    queryKey: discordChannelsKey(guildId),
    enabled: botInGuild,
    staleTime: 5 * 60_000,
  });
  const channelGroups = useMemo(() => groupChannels(channelsQuery.data ?? []), [channelsQuery.data]);

  // Vista previa de la regla con lo que hay escrito ahora
  const watched = useWatch({ control: form.control });
  const preview = useMemo(() => {
    const parsed = formSchema.safeParse(watched);
    if (!parsed.success) return null;
    return describeRule({
      joinThreshold: Number(parsed.data.joinThreshold),
      joinWindowSeconds: Number(parsed.data.joinWindowSeconds),
      lockdownMinutes: Number(parsed.data.lockdownMinutes),
      action: parsed.data.action as AntiRaidAction,
    });
  }, [watched]);

  const selectedChannelId = watched.logChannelId ?? AUTO_CHANNEL;
  const selectedChannel = channelsQuery.data?.find((channel) => channel.id === selectedChannelId) ?? null;
  const selectedIsKnown = selectedChannelId === AUTO_CHANNEL || !!selectedChannel;

  const onSubmit = form.handleSubmit((values) => {
    const body = changedFields(values, baseline);
    if (Object.keys(body).length === 0) {
      resetTo(data.config);
      toast({ title: "No hay cambios que guardar", description: "Todo estaba igual a lo guardado." });
      return;
    }

    update.mutate(body, {
      onSuccess: (result) => {
        resetTo(result.config);
        setWarnings(result.warnings);
        toast({
          title: "Ajustes anti-raid guardados",
          description:
            result.warnings.length > 0
              ? "Se guardaron, pero revisa los avisos debajo del formulario."
              : "El bot ya usa la nueva configuración.",
        });
      },
      onError: (error) => {
        // Errores por campo (400): los mostramos junto a cada campo
        const details = isApiError(error) ? error.body?.details : undefined;
        details?.forEach((detail) => {
          if (FORM_FIELDS.includes(detail.field)) {
            form.setError(detail.field as keyof FormValues, { type: "server", message: detail.message });
          }
        });
        toast({ variant: "destructive", title: "No se pudieron guardar los ajustes", description: describeMutationError(error) });
      },
    });
  });

  const discard = () => {
    resetTo(data.config);
  };

  return (
    <Card data-testid="card-antiraid-settings">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SlidersHorizontal className="h-5 w-5 text-primary" aria-hidden="true" />
          Ajustes de detección
        </CardTitle>
        <CardDescription>Decide cuándo el bot considera que hay un raid, qué hace y dónde te avisa.</CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={onSubmit} noValidate className="space-y-6">
            {!data.config.enabled && (
              <p className="flex items-start gap-2 rounded-lg border border-border bg-background/40 p-3 text-sm text-muted-foreground">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                La protección está desactivada. Puedes dejar todo listo aquí y se usará cuando la actives.
              </p>
            )}

            <fieldset disabled={!botInGuild || update.isPending} className="space-y-6">
              <legend className="sr-only">Ajustes de la protección anti-raid</legend>

              {/* ¿Cuándo hay un raid? */}
              <section className="space-y-4" aria-labelledby="antiraid-when">
                <h3 id="antiraid-when" className="text-sm font-semibold text-foreground">
                  ¿Cuándo hay un raid?
                </h3>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <NumberField
                    form={form}
                    name="joinThreshold"
                    label="Entradas seguidas"
                    unit="personas"
                    limits={LIMITS.joinThreshold}
                    description="Cuántas cuentas tienen que entrar de golpe."
                  />
                  <NumberField
                    form={form}
                    name="joinWindowSeconds"
                    label="En cuánto tiempo"
                    unit="segundos"
                    limits={LIMITS.joinWindowSeconds}
                    description="El tiempo en el que deben entrar."
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Menos entradas o más segundos lo hacen más sensible: puede saltar si compartes una invitación muy popular.
                </p>
              </section>

              {/* ¿Qué hace el bot? */}
              <FormField
                control={form.control}
                name="action"
                render={({ field }) => (
                  <FormItem className="space-y-3">
                    <FormLabel className="text-sm font-semibold text-foreground">¿Qué hace el bot cuando detecta uno?</FormLabel>
                    <FormControl>
                      <RadioGroup
                        value={field.value}
                        onValueChange={field.onChange}
                        className="grid gap-3"
                        aria-label="Qué hace el bot cuando detecta un raid"
                        data-testid="radio-antiraid-action"
                      >
                        {data.actions.map((option) => {
                          const info = actionExplanation(option.value);
                          const id = `antiraid-action-${option.value}`;
                          const selected = field.value === option.value;
                          return (
                            <label
                              key={option.value}
                              htmlFor={id}
                              className={cn(
                                "flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition-colors",
                                selected ? "border-primary bg-primary/5" : "border-border hover:border-primary/50",
                              )}
                            >
                              <RadioGroupItem value={option.value} id={id} className="mt-0.5 shrink-0" />
                              <span className="min-w-0 space-y-1">
                                <span className="block text-sm font-medium text-foreground">{option.label}</span>
                                {info && <span className="block text-sm text-muted-foreground">{info.detail}</span>}
                                {info?.needs && <span className="block text-xs text-muted-foreground">{info.needs}</span>}
                              </span>
                            </label>
                          );
                        })}
                      </RadioGroup>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Detalles */}
              <section className="space-y-4" aria-labelledby="antiraid-details">
                <h3 id="antiraid-details" className="text-sm font-semibold text-foreground">
                  Detalles
                </h3>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <NumberField
                    form={form}
                    name="lockdownMinutes"
                    label="Duración del modo raid"
                    unit="minutos"
                    limits={LIMITS.lockdownMinutes}
                    description={`Cuánto dura antes de volver a la normalidad (máximo ${formatMinutes(LIMITS.lockdownMinutes.max)}). Puedes terminarlo antes.`}
                  />
                  <NumberField
                    form={form}
                    name="minAccountAgeDays"
                    label="Cuenta nueva si tiene menos de"
                    unit="días"
                    limits={LIMITS.minAccountAgeDays}
                    description="Las cuentas nuevas suben la severidad del raid y, con Lockdown, son las que se expulsan de la ráfaga."
                  />
                </div>
              </section>

              {/* Canal de alertas */}
              <FormField
                control={form.control}
                name="logChannelId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Canal de alertas</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange} disabled={!botInGuild || update.isPending}>
                      <FormControl>
                        <SelectTrigger className="w-full sm:max-w-sm" data-testid="select-antiraid-channel">
                          <SelectValue placeholder="Elige un canal" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value={AUTO_CHANNEL}>Automático</SelectItem>
                        {!selectedIsKnown && field.value !== AUTO_CHANNEL && (
                          <SelectItem value={field.value}>
                            {channelsQuery.isSuccess ? "Canal que ya no existe" : "Canal guardado"} ({field.value})
                          </SelectItem>
                        )}
                        {channelGroups.map((group) => (
                          <SelectGroup key={group.category}>
                            <SelectLabel className="text-xs uppercase tracking-wide text-muted-foreground">
                              {group.category}
                            </SelectLabel>
                            {group.channels.map((channel) => (
                              <SelectItem key={channel.id} value={channel.id}>
                                #{channel.name}
                                {!channel.botCanPost && " · el bot no puede escribir"}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormDescription className="text-xs">
                      En «Automático» el bot avisa en el canal de moderación que elegiste en Canales; si no hay, en un canal
                      privado del staff (como #mod-logs) y, si tampoco, le escribe por mensaje directo al dueño del servidor.
                      Elige un canal privado: la alerta dice cuándo termina el modo raid.
                    </FormDescription>
                    {selectedChannel && !selectedChannel.botCanPost && (
                      <p className="flex items-start gap-2 text-xs text-status-warning">
                        <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        El bot no puede escribir en #{selectedChannel.name}. Dale permiso para ver el canal, enviar mensajes e
                        insertar enlaces, o elige otro.
                      </p>
                    )}
                    {channelsQuery.isError && (
                      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        No pudimos cargar la lista de canales.
                        <Button type="button" variant="link" size="sm" className="h-auto min-h-0 p-0 text-xs" onClick={() => void channelsQuery.refetch()}>
                          <RefreshCw className="h-3 w-3" />
                          Reintentar
                        </Button>
                      </div>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />
            </fieldset>

            {/* Vista previa */}
            <div className="rounded-lg border border-primary/30 bg-primary/5 p-4" aria-live="polite">
              <p className="text-xs font-medium uppercase tracking-wide text-primary">Así quedaría</p>
              <p className="mt-1 text-sm text-foreground">
                {preview ?? "Corrige los campos marcados en rojo para ver cómo quedaría la regla."}
              </p>
            </div>

            {warnings.length > 0 && (
              <Alert className="border-status-warning/40 bg-status-warning/10" data-testid="alert-antiraid-warnings">
                <TriangleAlert className="h-4 w-4 !text-status-warning" />
                <AlertTitle className="text-status-warning">Se guardó, pero ojo</AlertTitle>
                <AlertDescription>
                  <ul className="list-disc space-y-1 pl-4 text-foreground/90">
                    {warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                  <Button type="button" variant="ghost" size="sm" className="mt-2" onClick={() => setWarnings([])}>
                    Entendido
                  </Button>
                </AlertDescription>
              </Alert>
            )}

            {changedElsewhere && (
              <Alert className="border-primary/40 bg-primary/5" data-testid="alert-antiraid-changed-elsewhere">
                <Info className="h-4 w-4 !text-primary" />
                <AlertTitle>Alguien cambió estos ajustes mientras editabas</AlertTitle>
                <AlertDescription className="space-y-2">
                  <p>
                    Se cambiaron desde Discord (/antiraid configurar) o desde otra pestaña. Si guardas, solo se envían los
                    campos que tú cambiaste; el resto se queda como lo dejó la otra persona.
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={discard}
                    disabled={update.isPending}
                    data-testid="button-load-latest-antiraid"
                  >
                    <RefreshCw />
                    Descartar mis cambios y ver lo nuevo
                  </Button>
                </AlertDescription>
              </Alert>
            )}

            <div className="flex flex-col-reverse gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-muted-foreground" aria-live="polite">
                {!botInGuild
                  ? "Invita al bot al servidor para poder guardar."
                  : isDirty
                    ? "Tienes cambios sin guardar."
                    : "Todo está guardado."}
              </p>
              <div className="flex flex-col gap-2 sm:flex-row">
                {isDirty && (
                  <Button type="button" variant="ghost" onClick={discard} disabled={update.isPending} data-testid="button-discard-antiraid">
                    <Undo2 />
                    Descartar
                  </Button>
                )}
                <Button
                  type="submit"
                  disabled={!isDirty || update.isPending || !botInGuild}
                  data-testid="button-save-antiraid"
                >
                  {update.isPending ? <Loader2 className="animate-spin" /> : <Save />}
                  {update.isPending ? "Guardando…" : "Guardar cambios"}
                </Button>
              </div>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
