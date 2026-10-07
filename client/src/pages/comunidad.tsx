import { useEffect, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertTriangle, Bot, RefreshCw, X } from "lucide-react";
import type {
  DashboardStatsResponse,
  DiscordChannelsResponse,
  DiscordRolesResponse,
  EngagementSettingsResponse,
  EngagementUpdateRequest,
  EngagementUpdateResponse,
} from "@shared/api";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Form } from "@/components/ui/form";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiErrorState } from "@/components/api-error-state";
import { PageHeader } from "@/components/page-header";
import { StatusIndicator } from "@/components/status-indicator";
import { CommandsTip } from "@/components/comunidad/commands-tip";
import { DailyQuestionCard } from "@/components/comunidad/daily-question-card";
import {
  buildEngagementUpdate,
  engagementFormSchema,
  mergeFormValues,
  toFormValues,
  type EngagementFormValues,
} from "@/components/comunidad/form";
import { SaveBar } from "@/components/comunidad/save-bar";
import { WelcomeCard } from "@/components/comunidad/welcome-card";
import { useToast } from "@/hooks/use-toast";
import { useAuthStatus } from "@/lib/auth";
import { useSelectedGuild } from "@/lib/guild";
import { apiRequest } from "@/lib/queryClient";

const PAGE_TITLE = "Bienvenida y pregunta del día";
const PAGE_DESCRIPTION =
  "Estas dos funciones mantienen vivo el servidor solas: saludan a cada persona que llega y lanzan una pregunta cada día para que la gente platique, aunque tú no estés escribiendo.";

/** Clave de GET /api/guilds/:guildId/engagement (el aviso "settingsUpdated" del WebSocket la invalida). */
function engagementKey(guildId: string) {
  return ["/api/guilds", guildId, "engagement"] as const;
}

function ComunidadHeader({ actions }: { actions?: ReactNode }) {
  // El título es largo: en celulares (360 px) no cabe en una línea, así que lo dejamos saltar de línea
  // en lugar de cortarlo con "…" (PageHeader trunca por defecto).
  return (
    <PageHeader
      title={<span className="block whitespace-normal break-words">{PAGE_TITLE}</span>}
      description={PAGE_DESCRIPTION}
      actions={actions}
    />
  );
}

function ComunidadSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Cargando la configuración">
      <ComunidadHeader />
      {[0, 1].map((index) => (
        <Card key={index}>
          <CardHeader className="gap-4 space-y-0">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <Skeleton className="h-10 w-10 rounded-md" />
                <div className="space-y-2">
                  <Skeleton className="h-6 w-44" />
                  <Skeleton className="h-4 w-72 max-w-[55vw]" />
                </div>
              </div>
              <Skeleton className="h-6 w-11 rounded-full" />
            </div>
            <Skeleton className="h-10 w-full rounded-lg" />
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div className="space-y-4">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-36 w-full" />
              <Skeleton className="h-9 w-full" />
            </div>
            <Skeleton className="h-56 w-full rounded-lg" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export default function Comunidad() {
  const { guildId } = useSelectedGuild();
  const engagementQuery = useQuery<EngagementSettingsResponse>({
    queryKey: engagementKey(guildId),
    staleTime: 30_000,
    // El bot publica la pregunta por su cuenta (sin aviso por WebSocket): con la pregunta activada
    // revisamos cada minuto para que "próxima" y "última pregunta" no se queden viejas.
    refetchInterval: (query) => (query.state.data?.dailyQuestion.enabled ? 60_000 : false),
  });

  if (!engagementQuery.data) {
    if (engagementQuery.isError) {
      return (
        <div className="space-y-6">
          <ComunidadHeader />
          <ApiErrorState error={engagementQuery.error} onRetry={() => void engagementQuery.refetch()} />
        </div>
      );
    }
    return <ComunidadSkeleton />;
  }

  return (
    <EngagementEditor
      guildId={guildId}
      saved={engagementQuery.data}
      refreshing={engagementQuery.isFetching}
      onRefresh={() => void engagementQuery.refetch()}
    />
  );
}

interface EngagementEditorProps {
  guildId: string;
  /** Lo guardado en el servidor (se actualiza solo con el WebSocket) */
  saved: EngagementSettingsResponse;
  refreshing: boolean;
  onRefresh: () => void;
}

interface SaveVariables {
  body: EngagementUpdateRequest;
  /** Valores del formulario al pulsar Guardar */
  submitted: EngagementFormValues;
}

function EngagementEditor({ guildId, saved, refreshing, onRefresh }: EngagementEditorProps) {
  const { guild } = useSelectedGuild();
  const { data: auth } = useAuthStatus();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [warnings, setWarnings] = useState<string[]>([]);

  // Canales y roles salen de la caché del bot; los miembros, del resumen (para la vista previa)
  const channelsQuery = useQuery<DiscordChannelsResponse>({
    queryKey: ["/api/guild", guildId, "discord-channels"],
    staleTime: 5 * 60_000,
  });
  const rolesQuery = useQuery<DiscordRolesResponse>({
    queryKey: ["/api/guilds", guildId, "discord-roles"],
    staleTime: 5 * 60_000,
  });
  const statsQuery = useQuery<DashboardStatsResponse>({
    queryKey: ["/api/dashboard", guildId, "stats"],
    staleTime: 60_000,
  });
  const memberCount = statsQuery.data?.guild?.memberCount;

  const form = useForm<EngagementFormValues>({
    resolver: zodResolver(engagementFormSchema),
    defaultValues: toFormValues(saved),
    mode: "onSubmit",
    reValidateMode: "onChange",
  });

  // Si lo guardado cambia (alguien usó /bienvenida, otra pestaña...), se actualizan los campos que
  // no tocaste y tus cambios sin guardar se quedan como están.
  const baselineRef = useRef(saved);
  useEffect(() => {
    const previous = baselineRef.current;
    if (previous === saved) return;
    baselineRef.current = saved;
    const merged = mergeFormValues(
      form.getValues(),
      toFormValues(previous),
      toFormValues(saved),
      saved.welcome.defaultMessage,
    );
    form.reset(merged, { keepErrors: true, keepIsSubmitted: true });
  }, [saved, form]);

  const values = form.watch();
  const changes = buildEngagementUpdate(saved, values);
  const hasChanges = changes !== null;

  // Avisar antes de cerrar o recargar la pestaña con cambios sin guardar
  useEffect(() => {
    if (!hasChanges) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [hasChanges]);

  const saveMutation = useMutation({
    mutationFn: async ({ body }: SaveVariables) => {
      const res = await apiRequest("PATCH", `/api/guilds/${guildId}/engagement`, body);
      return (await res.json()) as EngagementUpdateResponse;
    },
    onSuccess: (data, { submitted }) => {
      const { warnings: returnedWarnings, ...settings } = data;
      baselineRef.current = settings;
      // Lo que cambiaste mientras se guardaba se respeta; el resto queda como lo guardó el servidor
      form.reset(mergeFormValues(form.getValues(), submitted, toFormValues(settings), settings.welcome.defaultMessage));
      queryClient.setQueryData<EngagementSettingsResponse>(engagementKey(guildId), settings);
      // El resumen muestra si están activadas y la próxima pregunta
      void queryClient.invalidateQueries({ queryKey: ["/api/guilds", guildId], exact: true });
      void queryClient.invalidateQueries({ queryKey: ["/api/dashboard", guildId] });

      const list = Array.isArray(returnedWarnings)
        ? returnedWarnings.filter((warning): warning is string => typeof warning === "string" && warning.trim() !== "")
        : [];
      setWarnings(list);
      toast(
        list.length > 0
          ? { title: "Guardado, pero revisa esto", description: list.join(" ") }
          : { title: "¡Cambios guardados!", description: "El bot ya usa la configuración nueva." },
      );
    },
    onError: (error) => {
      toast({ variant: "destructive", title: "No se pudieron guardar los cambios", description: error.message });
    },
  });

  const onSave = form.handleSubmit(
    (submitted) => {
      const update = buildEngagementUpdate(saved, submitted);
      if (!update) return;
      saveMutation.mutate({ body: update.body, submitted });
    },
    () => {
      toast({
        variant: "destructive",
        title: "Revisa los datos",
        description: "Hay algo que corregir antes de guardar (está marcado en rojo).",
      });
    },
  );

  const onDiscard = () => {
    form.reset(toFormValues(saved));
  };

  const dirtySections: string[] = [];
  if (changes?.welcomeChanged) dirtySections.push("Bienvenida");
  if (changes?.questionChanged) dirtySections.push("Pregunta del día");

  // El bot está en el servidor (según la lista de servidores) pero no respondió: probablemente reiniciando.
  // Si no está en el servidor, el aviso con "Invitar bot" ya lo muestra el panel arriba.
  const botOffline = !saved.botInGuild && guild?.botInGuild !== false;

  return (
    <Form {...form}>
      <div className="space-y-6">
        <ComunidadHeader
          actions={
            <StatusIndicator
              status={hasChanges ? "warning" : "success"}
              label={hasChanges ? "Cambios sin guardar" : "Todo guardado"}
              testId="status-save"
            />
          }
        />

        {botOffline && (
          <Alert className="border-status-warning/40 bg-status-warning/10" role="status">
            <Bot className="h-4 w-4 !text-status-warning" aria-hidden="true" />
            <AlertTitle>El bot no está conectado ahora mismo</AlertTitle>
            <AlertDescription className="space-y-3">
              <p>
                Puedes ver la configuración y preparar cambios, pero para guardarlos, probar la bienvenida o publicar una
                pregunta el bot tiene que estar en línea. Si se está reiniciando, intenta en un momento.
              </p>
              <Button type="button" variant="outline" size="sm" onClick={onRefresh} disabled={refreshing}>
                <RefreshCw className={refreshing ? "animate-spin" : undefined} />
                Volver a comprobar
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {warnings.length > 0 && (
          <Alert className="border-status-warning/40 pr-12" role="status" data-testid="alert-save-warnings">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute right-2 top-2 h-8 w-8"
              onClick={() => setWarnings([])}
              aria-label="Cerrar el aviso"
            >
              <X />
            </Button>
            <AlertTriangle className="h-4 w-4 !text-status-warning" aria-hidden="true" />
            <AlertTitle>Se guardó, pero hay algo que revisar</AlertTitle>
            <AlertDescription>
              <ul className="list-disc space-y-1 pl-4">
                {warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        <WelcomeCard
          guildId={guildId}
          saved={saved.welcome}
          dirty={changes?.welcomeChanged ?? false}
          botInGuild={saved.botInGuild}
          channelsQuery={channelsQuery}
          rolesQuery={rolesQuery}
          user={auth?.user ?? null}
          devMode={auth?.devMode === true}
          guild={guild}
          memberCount={typeof memberCount === "number" ? memberCount : null}
        />

        <DailyQuestionCard
          guildId={guildId}
          saved={saved.dailyQuestion}
          dirty={changes?.questionChanged ?? false}
          botInGuild={saved.botInGuild}
          channelsQuery={channelsQuery}
        />

        <CommandsTip />

        {(hasChanges || saveMutation.isPending) && (
          <SaveBar
            sections={dirtySections}
            saving={saveMutation.isPending}
            onSave={() => void onSave()}
            onDiscard={onDiscard}
          />
        )}
      </div>
    </Form>
  );
}
