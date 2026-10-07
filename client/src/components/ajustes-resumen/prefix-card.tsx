import { useMemo } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Info, Loader2, RotateCcw, Save, Terminal, TriangleAlert } from "lucide-react";
import type { GuildConfigResponse, GuildConfigUpdateRequest, SuccessResponse } from "@shared/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiErrorState } from "@/components/api-error-state";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, isApiError } from "@/lib/queryClient";
import { cn } from "@/lib/utils";

/**
 * Límites del prefijo: los mismos que guildConfigSchema en server/routes.ts
 * (1-5 caracteres sin espacios; la columna es varchar(5)). shared/api.ts aún no
 * exporta una constante para esto, así que viven aquí en un solo lugar.
 */
export const PREFIX_LIMITS = { minLength: 1, maxLength: 5 } as const;
export const DEFAULT_PREFIX = "&";

/** Prefijos fáciles de escribir en el móvil y que no chocan con Discord. */
const COMMON_PREFIXES = ["&", "!", "?", ".", "$", "-"] as const;

/** Comandos rápidos que trae el bot (server/bot/commands/prefix.ts). */
const EXAMPLE_COMMANDS = [
  { name: "bal", what: "saldo" },
  { name: "daily", what: "recompensa diaria" },
  { name: "lv", what: "nivel" },
  { name: "help", what: "ayuda" },
] as const;

const prefixSchema = z.object({
  prefix: z
    .string()
    .trim()
    .min(PREFIX_LIMITS.minLength, "Escribe un prefijo (por ejemplo &).")
    .max(PREFIX_LIMITS.maxLength, `El prefijo puede tener hasta ${PREFIX_LIMITS.maxLength} caracteres.`)
    .regex(/^\S+$/, "El prefijo no puede tener espacios."),
});
type PrefixFormValues = z.infer<typeof prefixSchema>;

/** Clave de GET /api/guild/:guildId/config (la invalida el aviso "settingsUpdated"). */
export function guildConfigKey(guildId: string) {
  return ["/api/guild", guildId, "config"] as const;
}

/** Consejos según el prefijo escrito (no impiden guardar). */
function prefixTip(prefix: string): string | null {
  if (!prefix) return null;
  if (prefix.startsWith("/")) {
    return "La barra / la usan los comandos de Discord: es mejor otro símbolo para no confundirse.";
  }
  if (/^[\p{L}\p{N}]/u.test(prefix)) {
    return "Ojo: si empieza con letra o número, algunos mensajes normales podrían activar comandos sin querer.";
  }
  return null;
}

interface PrefixCardProps {
  guildId: string;
  /** Sin el bot en el servidor no se puede guardar (el servidor responde 404). */
  botInGuild: boolean;
}

/** Tarjeta para ver y cambiar el prefijo de los comandos rápidos y personalizados. */
export function PrefixCard({ guildId, botInGuild }: PrefixCardProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const configKey = guildConfigKey(guildId);

  const configQuery = useQuery<GuildConfigResponse>({
    queryKey: configKey,
    staleTime: 60_000,
  });
  const savedPrefix = configQuery.data?.prefix;

  // Si el prefijo cambia desde otro lado (tiempo real), el campo se actualiza salvo que lo estés editando
  const values = useMemo(() => (savedPrefix !== undefined ? { prefix: savedPrefix } : undefined), [savedPrefix]);
  const form = useForm<PrefixFormValues>({
    resolver: zodResolver(prefixSchema),
    defaultValues: { prefix: "" },
    values,
    resetOptions: { keepDirtyValues: true },
    mode: "onChange",
  });

  const mutation = useMutation({
    mutationFn: async (body: GuildConfigUpdateRequest) => {
      const res = await apiRequest("PUT", `/api/guild/${guildId}/config`, body);
      return (await res.json()) as SuccessResponse;
    },
    onSuccess: (_data, body) => {
      const prefix = body.prefix ?? DEFAULT_PREFIX;
      queryClient.setQueryData<GuildConfigResponse>(configKey, (old) => (old ? { ...old, prefix } : old));
      form.reset({ prefix });
      void queryClient.invalidateQueries({ queryKey: configKey });
      // La lista de comandos personalizados muestra el prefijo actual
      void queryClient.invalidateQueries({ queryKey: ["/api/custom-commands", guildId] });
      toast({
        title: "¡Prefijo guardado!",
        description: `Ahora los comandos se usan así: ${prefix}help. El cambio se nota en Discord en unos segundos.`,
      });
    },
    onError: (error) => {
      const detail = isApiError(error) ? error.body?.details?.find((d) => d.field === "prefix") : undefined;
      if (detail) form.setError("prefix", { message: detail.message });
      toast({
        variant: "destructive",
        title: "No se pudo guardar el prefijo",
        description: error instanceof Error ? error.message : "Intenta de nuevo en un momento.",
      });
    },
  });

  const onSubmit = (data: PrefixFormValues) => {
    if (data.prefix === savedPrefix) {
      form.reset({ prefix: data.prefix });
      return;
    }
    mutation.mutate({ prefix: data.prefix });
  };

  const typed = form.watch("prefix");
  const preview = (typed ?? "").trim();
  const previewValid = prefixSchema.safeParse({ prefix: typed ?? "" }).success;
  const tip = previewValid ? prefixTip(preview) : null;
  const isDirty = form.formState.isDirty && preview !== savedPrefix;
  const saving = mutation.isPending;
  const canSave = botInGuild && isDirty && previewValid && !saving;

  const pickPrefix = (prefix: string) => {
    form.setValue("prefix", prefix, { shouldDirty: true, shouldValidate: true });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-xl">
          <Terminal className="h-5 w-5 text-primary" aria-hidden="true" />
          Prefijo de comandos
        </CardTitle>
        <CardDescription>
          Es el símbolo que va antes de los comandos rápidos del bot (como{" "}
          <code className="font-mono text-foreground">{savedPrefix ?? DEFAULT_PREFIX}bal</code> o{" "}
          <code className="font-mono text-foreground">{savedPrefix ?? DEFAULT_PREFIX}daily</code>) y de tus{" "}
          <Link href="/comandos" className="text-primary hover:underline">
            comandos personalizados
          </Link>
          . Los comandos de barra (<code className="font-mono text-foreground">/</code>) no cambian.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {configQuery.isLoading ? (
          <div className="space-y-3" aria-busy="true" aria-label="Cargando">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-9 w-full max-w-xs" />
            <Skeleton className="h-4 w-64 max-w-full" />
          </div>
        ) : configQuery.isError ? (
          <ApiErrorState error={configQuery.error} onRetry={() => void configQuery.refetch()} bare />
        ) : (
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5" noValidate>
              <FormField
                control={form.control}
                name="prefix"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Prefijo</FormLabel>
                    <div className="flex items-center gap-3">
                      <FormControl>
                        <Input
                          {...field}
                          autoComplete="off"
                          autoCapitalize="off"
                          autoCorrect="off"
                          spellCheck={false}
                          placeholder={DEFAULT_PREFIX}
                          className="max-w-[8rem] font-mono text-lg"
                          disabled={saving}
                          data-testid="input-prefix"
                        />
                      </FormControl>
                      <span
                        className={cn(
                          "font-mono text-xs",
                          preview.length > PREFIX_LIMITS.maxLength ? "text-destructive" : "text-muted-foreground",
                        )}
                        aria-hidden="true"
                      >
                        {preview.length}/{PREFIX_LIMITS.maxLength}
                      </span>
                    </div>
                    <FormDescription>
                      De {PREFIX_LIMITS.minLength} a {PREFIX_LIMITS.maxLength} caracteres, sin espacios. El predeterminado es{" "}
                      <code className="font-mono text-foreground">{DEFAULT_PREFIX}</code>.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="space-y-2">
                <p className="text-sm text-muted-foreground" id="common-prefixes-label">
                  Prefijos comunes
                </p>
                <div className="flex flex-wrap gap-2" role="group" aria-labelledby="common-prefixes-label">
                  {COMMON_PREFIXES.map((prefix) => (
                    <Button
                      key={prefix}
                      type="button"
                      size="sm"
                      variant={preview === prefix ? "default" : "outline"}
                      className="min-w-10 font-mono"
                      onClick={() => pickPrefix(prefix)}
                      disabled={saving}
                      aria-label={`Usar ${prefix} como prefijo`}
                      aria-pressed={preview === prefix}
                    >
                      {prefix}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="rounded-lg border border-border bg-background/40 p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Así se escribirán</p>
                {previewValid ? (
                  <ul className="mt-2 flex flex-wrap gap-2" data-testid="list-prefix-preview">
                    {EXAMPLE_COMMANDS.map((command) => (
                      <li key={command.name} className="rounded-md border border-border bg-card px-2.5 py-1 text-xs">
                        <code className="font-mono text-primary">
                          {preview}
                          {command.name}
                        </code>{" "}
                        <span className="text-muted-foreground">{command.what}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-sm text-muted-foreground">Escribe un prefijo válido para ver cómo quedan los comandos.</p>
                )}
                {tip && (
                  <p className="mt-3 flex items-start gap-2 text-xs text-status-warning">
                    <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    {tip}
                  </p>
                )}
              </div>

              {!botInGuild && (
                <p className="flex items-start gap-2 text-sm text-status-warning" role="status">
                  <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  Invita al bot a este servidor para poder guardar cambios.
                </p>
              )}

              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs text-muted-foreground">
                  Prefijo actual: <code className="font-mono text-foreground">{savedPrefix ?? DEFAULT_PREFIX}</code>
                </p>
                <div className="flex flex-wrap gap-2">
                  {isDirty && (
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => form.reset({ prefix: savedPrefix ?? DEFAULT_PREFIX })}
                      disabled={saving}
                      data-testid="button-prefix-cancel"
                    >
                      Cancelar
                    </Button>
                  )}
                  {!isDirty && savedPrefix !== undefined && savedPrefix !== DEFAULT_PREFIX && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => mutation.mutate({ prefix: DEFAULT_PREFIX })}
                      disabled={!botInGuild || saving}
                      data-testid="button-prefix-reset"
                    >
                      <RotateCcw />
                      Volver a {DEFAULT_PREFIX}
                    </Button>
                  )}
                  <Button type="submit" disabled={!canSave} data-testid="button-prefix-save">
                    {saving ? <Loader2 className="animate-spin" /> : <Save />}
                    {saving ? "Guardando…" : "Guardar prefijo"}
                  </Button>
                </div>
              </div>
            </form>
          </Form>
        )}
      </CardContent>
    </Card>
  );
}
