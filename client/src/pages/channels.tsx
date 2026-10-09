import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Controller, useForm } from "react-hook-form";
import { useLocation } from "wouter";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, Hash, Loader2, MessageCircleHeart, RefreshCw, Save, Share2, ShieldAlert, Undo2 } from "lucide-react";
import type {
  AntiRaidResponse,
  ChannelConfigResponse,
  ChannelConfigUpdateRequest,
  EngagementSettingsResponse,
} from "@shared/api";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiErrorState } from "@/components/api-error-state";
import { PageHeader } from "@/components/page-header";
import {
  antiRaidKey,
  channelConfigKey,
  engagementKey,
  errorDetails,
  errorText,
  invalidatePaths,
  useChannelConfig,
  useDiscordChannels,
} from "@/components/canales-redes/api";
import { channelLabel, findChannel, getChannelIssue } from "@/components/canales-redes/channel-picker";
import { ChannelRoleCard } from "@/components/canales-redes/channel-role-card";
import { useToast } from "@/hooks/use-toast";
import { useSelectedGuild } from "@/lib/guild";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";

/** Canales que se configuran aquí: exactamente los de ChannelConfigUpdateRequest. */
const CHANNEL_FIELDS = ["welcomeChannelId", "contentChannelId", "moderationChannelId"] as const satisfies readonly (keyof ChannelConfigUpdateRequest)[];
type ChannelField = (typeof CHANNEL_FIELDS)[number];
type ChannelFormValues = Record<ChannelField, string | null>;

const FIELD_NAMES: Record<ChannelField, string> = {
  welcomeChannelId: "Bienvenida",
  contentChannelId: "Contenido (noticias y Reddit)",
  moderationChannelId: "Moderación",
};

// Igual que la API: un ID de Discord o null (sin canal)
const channelIdSchema = z
  .string()
  .regex(/^\d{17,20}$/, "Ese canal no es válido. Elige otro de la lista.")
  .nullable();

const channelFormSchema = z
  .object({
    welcomeChannelId: channelIdSchema,
    contentChannelId: channelIdSchema,
    moderationChannelId: channelIdSchema,
  })
  .strict();

const EMPTY_VALUES: ChannelFormValues = {
  welcomeChannelId: null,
  contentChannelId: null,
  moderationChannelId: null,
};

function pickValues(config: ChannelConfigResponse | undefined): ChannelFormValues | undefined {
  if (!config) return undefined;
  return {
    welcomeChannelId: config.welcomeChannelId ?? null,
    contentChannelId: config.contentChannelId ?? null,
    moderationChannelId: config.moderationChannelId ?? null,
  };
}

function StatusBadge({ on, onText, offText }: { on: boolean; onText: string; offText: string }) {
  return on ? (
    <Badge variant="outline" className="border-primary/50 text-primary">
      {onText}
    </Badge>
  ) : (
    <Badge variant="outline" className="text-muted-foreground">
      {offText}
    </Badge>
  );
}

function Note({ children, tone = "warning" }: { children: ReactNode; tone?: "warning" | "muted" }) {
  return (
    <p
      className={cn(
        "flex items-start gap-2 text-xs",
        tone === "warning" ? "text-status-warning" : "text-muted-foreground",
      )}
    >
      {tone === "warning" && <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
      <span>{children}</span>
    </p>
  );
}

function ChannelsSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Cargando canales">
      {[0, 1, 2].map((i) => (
        <Card key={i}>
          <CardContent className="space-y-4 p-6">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-full max-w-md" />
            <div className="grid grid-cols-1 gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]">
              <div className="space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-5/6" />
                <Skeleton className="h-4 w-4/6" />
              </div>
              <Skeleton className="h-9 w-full" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/** Respaldo del anti-raid cuando no tiene un canal donde escribir (igual que el bot). */
const ALERT_FALLBACK = "el bot buscará un canal privado del staff y, si no hay, le escribirá al dueño por mensaje directo";

export default function ChannelsPage() {
  const { guildId } = useSelectedGuild();
  // Al cambiar de servidor se empieza de cero: los cambios sin guardar no pasan de un servidor a otro
  return <ChannelsEditor key={guildId} guildId={guildId} />;
}

function ChannelsEditor({ guildId }: { guildId: string }) {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  /** Ruta a la que se quería ir con cambios sin guardar (abre el aviso). */
  const [leaveTo, setLeaveTo] = useState<string | null>(null);

  const configQuery = useChannelConfig(guildId);
  const channelsQuery = useDiscordChannels(guildId);
  // Solo para explicar el contexto (si fallan, la página funciona igual)
  const engagementQuery = useQuery<EngagementSettingsResponse>({
    queryKey: engagementKey(guildId),
    enabled: guildId !== "",
    staleTime: 60_000,
  });
  const antiRaidQuery = useQuery<AntiRaidResponse>({
    queryKey: antiRaidKey(guildId),
    enabled: guildId !== "",
    staleTime: 60_000,
  });

  const config = configQuery.data;
  const channels = channelsQuery.data;
  const serverValues = useMemo(() => pickValues(config), [config]);

  const form = useForm<ChannelFormValues>({
    resolver: zodResolver(channelFormSchema),
    defaultValues: EMPTY_VALUES,
    // Cuando llegan datos nuevos (p. ej. otro admin cambió algo), se actualizan los
    // selectores que no tocaste; lo que estás editando se respeta.
    values: serverValues,
    resetOptions: { keepDirtyValues: true },
  });

  const current = form.watch();
  const { dirtyFields } = form.formState;
  // Cambios = lo que tocaste y quedó distinto de lo guardado (lo que llegue del servidor no cuenta)
  const changedFields = serverValues
    ? CHANNEL_FIELDS.filter((field) => dirtyFields[field] && (current[field] ?? null) !== serverValues[field])
    : [];
  const hasChanges = changedFields.length > 0;

  // Avisar antes de cerrar la pestaña con cambios sin guardar
  useEffect(() => {
    if (!hasChanges) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [hasChanges]);

  // Y antes de ir a otra página del panel (menú lateral o los enlaces de cada tarjeta)
  useEffect(() => {
    if (!hasChanges) return;
    const handler = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }
      const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if ((anchor.target && anchor.target !== "_self") || anchor.hasAttribute("download")) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin || url.pathname.startsWith("/api/")) return;
      if (url.pathname === window.location.pathname) return;
      // Con preventDefault, wouter no navega (el resto del clic sigue, p. ej. cerrar el menú en el móvil)
      event.preventDefault();
      setLeaveTo(`${url.pathname}${url.search}${url.hash}`);
    };
    document.addEventListener("click", handler, true);
    return () => document.removeEventListener("click", handler, true);
  }, [hasChanges]);

  const saveMutation = useMutation({
    mutationFn: async (body: ChannelConfigUpdateRequest) => {
      await apiRequest("PUT", `/api/guild/${guildId}/channels`, body);
      return body;
    },
    onSuccess: (body) => {
      const saved = { ...(serverValues ?? EMPTY_VALUES), ...body } as ChannelFormValues;
      queryClient.setQueryData<ChannelConfigResponse>(channelConfigKey(guildId), (old) =>
        old ? { ...old, ...body } : old,
      );
      form.reset(saved);
      // La bienvenida usa el mismo canal: que Comunidad y el Resumen se enteren
      void invalidatePaths([`/api/guild/${guildId}`, `/api/guilds/${guildId}`, `/api/dashboard/${guildId}`]);

      const fields = Object.keys(body) as ChannelField[];
      const summary = fields
        .map((field) => `${FIELD_NAMES[field]}: ${channelLabel(channels, saved[field]) ?? "sin canal"}`)
        .join(" · ");
      const problems = fields
        .map((field) => getChannelIssue(channels, saved[field]))
        .filter((issue): issue is NonNullable<typeof issue> => issue !== null);
      toast({
        title: "Canales guardados",
        description: problems.length > 0 ? `${summary}. Ojo: ${problems.map((p) => p.text).join(" ")}` : summary,
      });
    },
    onError: (error) => {
      for (const detail of errorDetails(error)) {
        if ((CHANNEL_FIELDS as readonly string[]).includes(detail.field)) {
          form.setError(detail.field as ChannelField, { type: "server", message: detail.message });
        }
      }
      toast({ variant: "destructive", title: "No se pudieron guardar los canales", description: errorText(error) });
    },
  });

  /** Solo se manda lo que cambió (null si no hay nada que guardar). */
  const buildBody = (values: ChannelFormValues): ChannelConfigUpdateRequest | null => {
    if (!serverValues) return null;
    const body: ChannelConfigUpdateRequest = {};
    for (const field of changedFields) {
      body[field] = values[field] ?? null;
    }
    return Object.keys(body).length > 0 ? body : null;
  };

  const onSubmit = (values: ChannelFormValues) => {
    const body = buildBody(values);
    if (body) saveMutation.mutate(body);
  };

  const discard = () => {
    if (serverValues) form.reset(serverValues);
  };

  const leaveWithoutSaving = () => {
    const target = leaveTo;
    setLeaveTo(null);
    discard();
    if (target) navigate(target);
  };

  const saveAndLeave = form.handleSubmit(
    (values) => {
      const target = leaveTo;
      const body = buildBody(values);
      if (!body) {
        setLeaveTo(null);
        if (target) navigate(target);
        return;
      }
      saveMutation.mutate(body, {
        onSuccess: () => {
          setLeaveTo(null);
          if (target) navigate(target);
        },
        // El error ya sale en un aviso y junto a cada canal: te quedas para corregirlo
        onError: () => setLeaveTo(null),
      });
    },
    () => setLeaveTo(null),
  );

  const refreshAll = () => {
    void configQuery.refetch();
    void channelsQuery.refetch();
    void engagementQuery.refetch();
    void antiRaidQuery.refetch();
  };

  const header = (
    <PageHeader
      title="Canales"
      description="Elige en qué canal hace cada cosa el bot. Si creaste un canal en Discord hace un momento, pulsa Actualizar."
      actions={
        <Button
          variant="outline"
          onClick={refreshAll}
          disabled={channelsQuery.isFetching || configQuery.isFetching}
          data-testid="button-refresh-channels"
        >
          <RefreshCw className={cn((channelsQuery.isFetching || configQuery.isFetching) && "animate-spin")} />
          Actualizar
        </Button>
      }
    />
  );

  // Aviso al salir con cambios sin guardar (también si la página quedó en un estado de error)
  const saving = saveMutation.isPending;
  const leaveDialog = (
    <AlertDialog open={leaveTo !== null} onOpenChange={(open) => !open && !saving && setLeaveTo(null)}>
      <AlertDialogContent className="w-[calc(100%-2rem)] rounded-lg sm:w-full">
        <AlertDialogHeader>
          <AlertDialogTitle>Tienes cambios sin guardar</AlertDialogTitle>
          <AlertDialogDescription>
            Si sales ahora, se pierden los canales que cambiaste aquí. ¿Quieres guardarlos antes de salir?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2 sm:space-x-0">
          <AlertDialogCancel className="mt-0" disabled={saving} data-testid="button-leave-stay">
            Quedarme aquí
          </AlertDialogCancel>
          <Button variant="outline" onClick={leaveWithoutSaving} disabled={saving} data-testid="button-leave-discard">
            <Undo2 aria-hidden="true" />
            Salir sin guardar
          </Button>
          <Button onClick={() => void saveAndLeave()} disabled={saving} data-testid="button-leave-save">
            {saving ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Save aria-hidden="true" />}
            {saving ? "Guardando…" : "Guardar y salir"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  if (configQuery.isLoading || channelsQuery.isLoading) {
    return (
      <div className="space-y-6">
        {header}
        <ChannelsSkeleton />
        {leaveDialog}
      </div>
    );
  }

  if (configQuery.isError) {
    return (
      <div className="space-y-6">
        {header}
        <ApiErrorState error={configQuery.error} onRetry={() => void configQuery.refetch()} />
        {leaveDialog}
      </div>
    );
  }

  if (channelsQuery.isError || !channels || !serverValues) {
    return (
      <div className="space-y-6">
        {header}
        <ApiErrorState error={channelsQuery.error} onRetry={() => void channelsQuery.refetch()} />
        {leaveDialog}
      </div>
    );
  }

  const pending = saving;
  const errors = form.formState.errors;

  // ----- Contexto: bienvenida -----
  const welcome = engagementQuery.data?.welcome;
  const welcomeStatus = welcome ? (
    <StatusBadge on={welcome.enabled} onText="Bienvenida activada" offText="Bienvenida desactivada" />
  ) : null;
  const welcomeNotes =
    welcome?.enabled && !current.welcomeChannelId ? (
      <Note>La bienvenida está activada: sin canal, el bot no le dará la bienvenida a nadie.</Note>
    ) : welcome && !welcome.enabled && current.welcomeChannelId ? (
      <Note tone="muted">La bienvenida está desactivada: el bot no publicará aquí hasta que la actives en Comunidad.</Note>
    ) : null;

  // ----- Contexto: anti-raid -----
  // El bot avisa en: canal de alertas de Seguridad → este canal → canal privado del staff → MD al dueño,
  // saltándose los canales donde no puede escribir.
  const antiRaid = antiRaidQuery.data?.config;
  const logChannel = findChannel(channels, antiRaid?.logChannelId);
  const moderationUsable = !!current.moderationChannelId && getChannelIssue(channels, current.moderationChannelId) === null;
  const moderationStatus = antiRaid ? (
    <StatusBadge on={antiRaid.enabled} onText="Anti-raid activado" offText="Anti-raid desactivado" />
  ) : null;
  let moderationNotes: ReactNode = null;
  if (antiRaid && !antiRaid.enabled) {
    moderationNotes = <Note tone="muted">El anti-raid está apagado, así que por ahora no llegan alertas.</Note>;
  } else if (antiRaid?.logChannelId && logChannel?.botCanPost) {
    moderationNotes = (
      <Note tone="muted">
        Ahora mismo Seguridad manda las alertas a #{logChannel.name}. Este canal solo se usa si el bot deja de poder
        escribir allí.
      </Note>
    );
  } else if (antiRaid?.logChannelId) {
    const brokenLog = logChannel
      ? `El bot no puede escribir en #${logChannel.name}, el canal de alertas que elegiste en Seguridad`
      : "El canal de alertas que elegiste en Seguridad ya no existe o el bot no lo ve";
    moderationNotes = (
      <Note>{`${brokenLog}, así que ${moderationUsable ? "las alertas van a este canal." : `${ALERT_FALLBACK}.`}`}</Note>
    );
  } else if (antiRaid && !current.moderationChannelId) {
    moderationNotes = <Note tone="muted">Sin canal aquí, {ALERT_FALLBACK}.</Note>;
  } else if (antiRaid && !moderationUsable) {
    moderationNotes = <Note tone="muted">Mientras el bot no pueda escribir aquí, {ALERT_FALLBACK}.</Note>;
  }

  return (
    <div className="space-y-6">
      {header}

      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <Controller
          control={form.control}
          name="welcomeChannelId"
          render={({ field }) => (
            <ChannelRoleCard
              fieldId="canal-bienvenida"
              icon={MessageCircleHeart}
              title="Bienvenida"
              purpose="Donde el bot saluda a cada persona que entra al servidor."
              facts={[
                "Solo publica si la bienvenida está activada en Bienvenida y pregunta del día.",
                <>
                  Es el mismo canal de esa página (y de <code className="font-mono text-foreground">/bienvenida canal</code>{" "}
                  en Discord): si lo cambias aquí, también cambia allá.
                </>,
                "Elige un canal que todos puedan ver, como #general o #bienvenidas.",
              ]}
              status={welcomeStatus}
              value={field.value}
              savedValue={serverValues.welcomeChannelId}
              onChange={field.onChange}
              onBlur={field.onBlur}
              channels={channels}
              disabled={pending}
              notes={welcomeNotes}
              error={errors.welcomeChannelId?.message}
              link={{ href: "/comunidad", label: "Configurar la bienvenida" }}
            />
          )}
        />

        <Controller
          control={form.control}
          name="contentChannelId"
          render={({ field }) => (
            <ChannelRoleCard
              fieldId="canal-contenido"
              icon={Share2}
              title="Contenido (noticias y Reddit)"
              purpose="Tu canal preferido para noticias, memes e imágenes de Reddit."
              facts={[
                "Cuando creas un feed en Redes sociales, el panel te propone este canal.",
                "Cada feed publica en el canal que tenga elegido: cambiar este no mueve los feeds que ya existen.",
                "Un canal tipo #memes o #contenido funciona muy bien.",
              ]}
              value={field.value}
              savedValue={serverValues.contentChannelId}
              onChange={field.onChange}
              onBlur={field.onBlur}
              channels={channels}
              disabled={pending}
              error={errors.contentChannelId?.message}
              link={{ href: "/redes", label: "Ir a Redes sociales" }}
            />
          )}
        />

        <Controller
          control={form.control}
          name="moderationChannelId"
          render={({ field }) => (
            <ChannelRoleCard
              fieldId="canal-moderacion"
              icon={ShieldAlert}
              title="Moderación"
              purpose="Aquí llegan las alertas del anti-raid cuando detecta muchas entradas sospechosas de golpe."
              facts={[
                "Se usa cuando en Seguridad el canal de alertas está en automático, o si el bot no puede escribir en el que elegiste allí.",
                "Usa un canal privado del staff: las alertas dicen cuándo termina el modo raid y eso no deberían verlo los raiders.",
                "Por ahora solo lo usa el anti-raid. Los comandos de moderación como /warn o /mute no publican registros aquí.",
              ]}
              status={moderationStatus}
              value={field.value}
              savedValue={serverValues.moderationChannelId}
              onChange={field.onChange}
              onBlur={field.onBlur}
              channels={channels}
              disabled={pending}
              notes={moderationNotes}
              error={errors.moderationChannelId?.message}
              link={{ href: "/seguridad", label: "Ir a Seguridad" }}
            />
          )}
        />

        {/* Barra para guardar (se queda abajo mientras hay cambios) */}
        <div className={cn(hasChanges && "sticky bottom-4 z-10")}>
          <Card className={cn(hasChanges ? "border-primary/60 shadow-lg" : "border-border")}>
            <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="flex items-center gap-2 text-sm text-foreground" aria-live="polite">
                <Hash className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                {hasChanges
                  ? `Tienes ${changedFields.length} ${changedFields.length === 1 ? "cambio" : "cambios"} sin guardar.`
                  : "Todo está guardado."}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={discard}
                  disabled={!hasChanges || pending}
                  data-testid="button-discard-channels"
                >
                  <Undo2 aria-hidden="true" />
                  Descartar
                </Button>
                <Button type="submit" disabled={!hasChanges || pending} data-testid="button-save-channels">
                  {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Save aria-hidden="true" />}
                  {pending ? "Guardando…" : "Guardar cambios"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </form>
      {leaveDialog}
    </div>
  );
}
