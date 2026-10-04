import type { ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import type { GuildConfigResponse, GuildConfigUpdateRequest } from "@shared/api";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { ApiErrorState } from "@/components/api-error-state";
import { useToast } from "@/hooks/use-toast";
import { useSelectedGuild } from "@/lib/guild";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { mutationErrorToast } from "./format";

/**
 * Configuración del servidor que el bot SÍ lee: GET/PUT /api/guild/:guildId/config
 * (columnas levelUpMessages y economyEnabled; el bot las consulta con una caché de 15 s).
 * La clave empieza por /api/guild/{id}, así que el aviso "settingsUpdated" del tiempo real la refresca.
 */
export function guildConfigKey(guildId: string) {
  return ["/api/guild", guildId, "config"] as const;
}

export function useGuildConfig(guildId: string) {
  return useQuery<GuildConfigResponse>({
    queryKey: guildConfigKey(guildId),
    staleTime: 60_000,
    enabled: !!guildId,
  });
}

export function useUpdateGuildConfig(guildId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (patch: GuildConfigUpdateRequest) => {
      await apiRequest("PUT", `/api/guild/${guildId}/config`, patch);
      return patch;
    },
    onSuccess: (patch) => {
      queryClient.setQueryData<GuildConfigResponse>(guildConfigKey(guildId), (old) => (old ? { ...old, ...patch } : old));
      // Lo mismo que hace el aviso en tiempo real, por si no está conectado
      void queryClient.invalidateQueries({ queryKey: ["/api/guild", guildId] });
      void queryClient.invalidateQueries({ queryKey: ["/api/guilds", guildId] });
      void queryClient.invalidateQueries({ queryKey: ["/api/dashboard", guildId] });
    },
  });
}

type ToggleField = "levelUpMessages" | "economyEnabled";

interface ConfigToggleProps {
  field: ToggleField;
  /** id del interruptor (para la etiqueta) */
  id: string;
  label: string;
  description: ReactNode;
  /** Toast al guardar: título al activar y al desactivar */
  savedOn: string;
  savedOff: string;
}

/** Interruptor conectado a la configuración real del servidor, con estados de carga, error y guardado. */
export function ConfigToggle({ field, id, label, description, savedOn, savedOff }: ConfigToggleProps) {
  const { guildId, guild } = useSelectedGuild();
  const config = useGuildConfig(guildId);
  const update = useUpdateGuildConfig(guildId);
  const { toast } = useToast();

  const botMissing = guild ? !guild.botInGuild : false;
  const saved = config.data?.[field];
  // Mientras se guarda, el interruptor ya muestra lo que se pidió
  const pendingValue = update.isPending ? update.variables?.[field] : undefined;
  const checked = pendingValue ?? saved ?? false;
  const descriptionId = `${id}-description`;

  const onCheckedChange = (value: boolean) => {
    const patch: GuildConfigUpdateRequest =
      field === "levelUpMessages" ? { levelUpMessages: value } : { economyEnabled: value };
    update.mutate(patch, {
      onSuccess: () => {
        toast({
          title: value ? savedOn : savedOff,
          description: "El bot lo aplicará en unos segundos.",
        });
      },
      onError: (error) => {
        toast({ variant: "destructive", ...mutationErrorToast(error) });
      },
    });
  };

  if (config.isError) {
    return <ApiErrorState error={config.error} onRetry={() => void config.refetch()} bare />;
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-background/40 p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <Label htmlFor={id} className="text-base font-medium text-foreground">
            {label}
          </Label>
          <div id={descriptionId} className="text-sm text-muted-foreground">
            {description}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 pt-0.5">
          {update.isPending && (
            <>
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden="true" />
              <span className="sr-only" role="status">
                Guardando…
              </span>
            </>
          )}
          {config.isLoading ? (
            <Skeleton className="h-6 w-11 rounded-full" />
          ) : (
            <>
              <span
                className={cn("hidden text-xs font-medium sm:inline", checked ? "text-primary" : "text-muted-foreground")}
                aria-hidden="true"
              >
                {checked ? "Activado" : "Desactivado"}
              </span>
              <Switch
                id={id}
                checked={checked}
                onCheckedChange={onCheckedChange}
                disabled={update.isPending || botMissing || !config.data}
                aria-describedby={descriptionId}
                data-testid={`switch-${field}`}
              />
            </>
          )}
        </div>
      </div>
      {botMissing && (
        <p className="text-xs text-status-warning">Invita al bot a este servidor para poder cambiar esto.</p>
      )}
    </div>
  );
}
