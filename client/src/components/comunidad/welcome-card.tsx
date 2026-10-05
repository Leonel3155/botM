import { useRef } from "react";
import { useMutation, type UseQueryResult } from "@tanstack/react-query";
import { useFormContext, useWatch } from "react-hook-form";
import { Loader2, MessageCircleHeart, RotateCcw, Send, Wand2 } from "lucide-react";
import {
  WELCOME_MESSAGE_MAX_LENGTH,
  WELCOME_PLACEHOLDERS,
  type DiscordChannelsResponse,
  type DiscordRolesResponse,
  type EngagementSettingsResponse,
  type TestWelcomeResponse,
} from "@shared/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ToastAction } from "@/components/ui/toast";
import { useToast } from "@/hooks/use-toast";
import type { SessionUser } from "@/lib/auth";
import type { UserGuild } from "@/lib/guild";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { ChannelField, channelLabel } from "./channel-field";
import { sameWelcomeMessage, type EngagementFormValues } from "./form";
import { discordLinkAction, retryAfterSecondsFrom, useCooldown } from "./hooks";
import { RoleField, roleLabel } from "./role-field";
import { SectionHeader, type SectionStatus } from "./section-parts";
import { WelcomePreview } from "./welcome-preview";

const MESSAGE_FIELD = "welcome.message" as const;
const numberFormat = new Intl.NumberFormat("es-MX");

interface WelcomeCardProps {
  guildId: string;
  saved: EngagementSettingsResponse["welcome"];
  /** Esta sección tiene cambios sin guardar */
  dirty: boolean;
  botInGuild: boolean;
  channelsQuery: UseQueryResult<DiscordChannelsResponse>;
  rolesQuery: UseQueryResult<DiscordRolesResponse>;
  user: SessionUser | null;
  devMode: boolean;
  guild: UserGuild | null;
  memberCount: number | null;
}

function welcomeStatus(
  saved: EngagementSettingsResponse["welcome"],
  channelName: string | null,
  roleName: string | null,
): SectionStatus {
  // El rol automático funciona aparte del saludo (igual que en el bot): se da aunque la bienvenida esté apagada
  const givesRole = !!saved.roleId && !saved.roleProblem;
  const roleText = roleName ? `el rol ${roleName}` : "el rol automático";
  if (!saved.enabled) {
    if (givesRole) {
      return {
        kind: "warning",
        text: `Apagada: no saludo a nadie, pero sigo dando ${roleText} a quien entra (quítalo abajo si no lo quieres).`,
      };
    }
    return { kind: "offline", text: "Apagada: por ahora nadie recibe un saludo al entrar." };
  }
  if (!saved.channelId) {
    return { kind: "warning", text: "Activada, pero falta elegir el canal de bienvenida." };
  }
  if (saved.channelProblem) {
    return { kind: "warning", text: `Activada, pero hay un problema: ${saved.channelProblem}` };
  }
  const where = channelName ? ` en ${channelName}` : "";
  if (saved.roleId && saved.roleProblem) {
    return {
      kind: "warning",
      text: `Activada: saludo a cada persona nueva${where}, pero no puedo dar ${roleText}. ${saved.roleProblem}`,
    };
  }
  const role = givesRole && roleName ? ` y le doy el rol ${roleName}` : "";
  return { kind: "online", text: `Activada: saludo a cada persona nueva${where}${role}.` };
}

/** Tarjeta "Bienvenida": interruptor, canal, mensaje con vista previa, rol automático y prueba. */
export function WelcomeCard({
  guildId,
  saved,
  dirty,
  botInGuild,
  channelsQuery,
  rolesQuery,
  user,
  devMode,
  guild,
  memberCount,
}: WelcomeCardProps) {
  const { toast } = useToast();
  const form = useFormContext<EngagementFormValues>();
  const message = useWatch({ control: form.control, name: MESSAGE_FIELD }) ?? "";
  const channelId = useWatch({ control: form.control, name: "welcome.channelId" });
  const enabledDraft = useWatch({ control: form.control, name: "welcome.enabled" });
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  // Última posición del cursor en el mensaje (null = nunca lo tocó: los marcadores van al final)
  const selectionRef = useRef<{ start: number; end: number } | null>(null);
  const cooldown = useCooldown();

  const savedChannelName = channelLabel(channelsQuery.data, saved.channelId);
  const savedRoleName = roleLabel(rolesQuery.data, saved.roleId);
  const status = welcomeStatus(saved, savedChannelName, savedRoleName);

  const length = message.length;
  const nearLimit = length > WELCOME_MESSAGE_MAX_LENGTH * 0.9;

  const setMessage = (next: string) => {
    form.setValue(MESSAGE_FIELD, next, { shouldDirty: true, shouldValidate: form.formState.isSubmitted });
  };

  // Volver al predeterminado borra lo escrito: se puede deshacer desde el aviso
  const resetToDefault = () => {
    const previous = form.getValues(MESSAGE_FIELD) ?? "";
    setMessage("");
    selectionRef.current = null;
    // Si lo que había ya era el predeterminado, no se pierde nada
    if (sameWelcomeMessage(previous, null, saved.defaultMessage)) return;
    toast({
      title: "Volví al mensaje predeterminado",
      description: "Si fue sin querer, recupera lo que habías escrito.",
      action: (
        <ToastAction
          altText="Deshacer y recuperar el mensaje que habías escrito"
          onClick={() => setMessage(previous)}
          data-testid="button-welcome-undo-default"
        >
          Deshacer
        </ToastAction>
      ),
    });
  };

  const insertPlaceholder = (key: string) => {
    const current = form.getValues(MESSAGE_FIELD) ?? "";
    const start = Math.min(selectionRef.current?.start ?? current.length, current.length);
    const end = Math.min(selectionRef.current?.end ?? current.length, current.length);
    const next = current.slice(0, start) + key + current.slice(end);
    if (next.length > WELCOME_MESSAGE_MAX_LENGTH) {
      toast({
        variant: "destructive",
        title: "No cabe en el mensaje",
        description: `El mensaje puede tener como máximo ${numberFormat.format(WELCOME_MESSAGE_MAX_LENGTH)} caracteres.`,
      });
      return;
    }
    setMessage(next);
    const caret = start + key.length;
    selectionRef.current = { start: caret, end: caret };
    window.requestAnimationFrame(() => {
      const element = textareaRef.current;
      if (!element) return;
      element.focus();
      element.setSelectionRange(caret, caret);
    });
  };

  const testWelcome = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/guilds/${guildId}/engagement/test-welcome`);
      return (await res.json()) as TestWelcomeResponse;
    },
    onSuccess: (data) => {
      const where = channelLabel(channelsQuery.data, data.channelId) ?? "el canal de bienvenida";
      toast({
        title: "¡Listo! Publiqué una bienvenida de prueba",
        description: `Te saludé en ${where} como si acabaras de entrar.`,
        action: discordLinkAction(data.messageUrl),
      });
    },
    onError: (error) => {
      const wait = retryAfterSecondsFrom(error);
      if (wait) cooldown.start(wait);
      toast({
        variant: "destructive",
        title: wait ? "Espera un momento" : "No se pudo publicar la prueba",
        description: error.message,
      });
    },
  });

  // Por qué no se puede probar ahora (null = se puede)
  let testBlocked: string | null = null;
  if (devMode) {
    // La sesión de desarrollo no es una cuenta de Discord: el servidor siempre rechaza la prueba
    testBlocked =
      "Con el acceso de desarrollo no puedo probarla: la prueba te saluda a ti y esta sesión no es una cuenta real de Discord. Inicia sesión con Discord para probarla.";
  } else if (!botInGuild) testBlocked = "El bot tiene que estar en el servidor y conectado para probarla.";
  else if (!saved.channelId) testBlocked = "Primero elige el canal de bienvenida y guarda.";
  else if (saved.channelProblem) testBlocked = `No puedo publicar en el canal guardado: ${saved.channelProblem}`;
  else if (dirty) testBlocked = "Guarda tus cambios primero: la prueba usa lo que está guardado.";

  return (
    <Card data-testid="card-welcome">
      <SectionHeader
        icon={MessageCircleHeart}
        title="Bienvenida"
        description="Saludo a cada persona que entra al servidor, para que nadie llegue a un chat vacío."
        dirty={dirty}
        status={status}
        testId="status-welcome"
        toggle={
          <FormField
            control={form.control}
            name="welcome.enabled"
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
                    aria-label="Activar la bienvenida"
                    data-testid="switch-welcome"
                  />
                </FormControl>
              </FormItem>
            )}
          />
        }
      />

      <CardContent className="space-y-6 p-4 pt-0 sm:p-6 sm:pt-0">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Ajustes */}
          <div className="min-w-0 space-y-6">
            <ChannelField
              control={form.control}
              name="welcome.channelId"
              label="Canal de bienvenida"
              placeholder="Elige dónde saludo"
              channelsQuery={channelsQuery}
              savedChannelId={saved.channelId}
              savedProblem={saved.channelProblem}
              testId="select-welcome-channel"
            />

            <FormField
              control={form.control}
              name={MESSAGE_FIELD}
              render={({ field }) => (
                <FormItem>
                  <div className="flex items-end justify-between gap-2">
                    <FormLabel>Mensaje de bienvenida</FormLabel>
                    <span className={cn("font-mono text-xs", nearLimit ? "text-status-warning" : "text-muted-foreground")}>
                      {numberFormat.format(length)} / {numberFormat.format(WELCOME_MESSAGE_MAX_LENGTH)}
                      <span className="sr-only"> caracteres</span>
                    </span>
                  </div>
                  <FormControl>
                    <Textarea
                      name={field.name}
                      value={field.value ?? ""}
                      onChange={field.onChange}
                      onBlur={field.onBlur}
                      ref={(element) => {
                        field.ref(element);
                        textareaRef.current = element;
                      }}
                      onSelect={(event) => {
                        const target = event.currentTarget;
                        selectionRef.current = { start: target.selectionStart, end: target.selectionEnd };
                      }}
                      rows={6}
                      maxLength={WELCOME_MESSAGE_MAX_LENGTH}
                      placeholder={saved.defaultMessage}
                      className="min-h-[9rem] resize-y"
                      data-testid="input-welcome-message"
                    />
                  </FormControl>
                  <FormMessage />
                  <p className="text-xs text-muted-foreground">
                    {message.trim()
                      ? "Puedes usar **negrita**, *cursiva* y saltos de línea, como en Discord."
                      : "Si lo dejas vacío uso el mensaje predeterminado (lo ves en la vista previa)."}
                  </p>
                </FormItem>
              )}
            />

            <div className="space-y-2">
              <p className="text-sm font-medium text-foreground" id="welcome-placeholders-label">
                Toca para insertar en el mensaje
              </p>
              <div className="grid grid-cols-2 gap-2" role="group" aria-labelledby="welcome-placeholders-label">
                {WELCOME_PLACEHOLDERS.map((placeholder) => (
                  <Button
                    key={placeholder.key}
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-auto min-w-0 flex-col items-start justify-start gap-0 whitespace-normal py-1.5 text-left"
                    onClick={() => insertPlaceholder(placeholder.key)}
                    aria-label={`Insertar ${placeholder.key}: ${placeholder.description}`}
                    data-testid={`chip-placeholder-${placeholder.key.replace(/[{}]/g, "")}`}
                  >
                    <code className="font-mono text-xs text-primary">{placeholder.key}</code>
                    <span className="text-[11px] font-normal text-muted-foreground">{placeholder.description}</span>
                  </Button>
                ))}
              </div>
              <div className="flex flex-wrap gap-2 pt-1">
                {message.trim() ? (
                  <Button type="button" variant="ghost" size="sm" onClick={resetToDefault} data-testid="button-welcome-default">
                    <RotateCcw />
                    Volver al mensaje predeterminado
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setMessage(saved.defaultMessage)}
                    data-testid="button-welcome-edit-default"
                  >
                    <Wand2 />
                    Editar a partir del predeterminado
                  </Button>
                )}
              </div>
            </div>

            <RoleField
              control={form.control}
              rolesQuery={rolesQuery}
              savedRoleId={saved.roleId}
              savedProblem={saved.roleProblem}
              welcomeEnabled={enabledDraft}
            />
          </div>

          {/* Vista previa */}
          <div className="min-w-0 lg:sticky lg:top-20 lg:self-start">
            <WelcomePreview
              template={message}
              defaultMessage={saved.defaultMessage}
              user={user}
              guild={guild}
              memberCount={memberCount}
              hasChannel={!!channelId}
              channelName={channelLabel(channelsQuery.data, channelId)}
            />
          </div>
        </div>

        {/* Probar */}
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-background/40 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 space-y-1">
            <p className="text-sm font-medium text-foreground">Prueba cómo queda en Discord</p>
            <p className="text-sm text-muted-foreground">
              {testBlocked ??
                `Publico una bienvenida de prueba contigo en ${savedChannelName ?? "el canal guardado"}, con el mensaje guardado. Funciona aunque esté apagada.`}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            className="shrink-0"
            onClick={() => testWelcome.mutate()}
            disabled={!!testBlocked || testWelcome.isPending || cooldown.remaining > 0}
            data-testid="button-test-welcome"
          >
            {testWelcome.isPending ? <Loader2 className="animate-spin" /> : <Send />}
            {testWelcome.isPending
              ? "Publicando…"
              : cooldown.remaining > 0
                ? `Espera ${cooldown.remaining} s`
                : "Probar bienvenida"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
