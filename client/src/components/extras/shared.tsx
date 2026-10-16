import { useEffect, useMemo, useState, type ComponentPropsWithoutRef, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { LucideIcon } from "lucide-react";
import type {
  DiscordChannelsResponse,
  DiscordRolesResponse,
  GuildExtrasItem,
  GuildExtrasResponse,
  GuildExtrasSaveRequest,
} from "@shared/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { RichSelectItem } from "@/components/comunidad/rich-select-item";
import { postableChannels } from "@/components/comunidad/channel-field";
import { errorMessage } from "@/components/comandos/utils";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";

export const extrasKey = (guildId: string) => ["/api/guilds", guildId, "extras"] as const;
export const channelsKey = (guildId: string) => ["/api/guild", guildId, "discord-channels"] as const;
export const rolesKey = (guildId: string) => ["/api/guilds", guildId, "discord-roles"] as const;

const NONE = "__ninguno__";

export function useExtrasQuery(guildId: string) {
  return useQuery<GuildExtrasResponse>({ queryKey: extrasKey(guildId), staleTime: 30_000 });
}

export function useChannelsQuery(guildId: string) {
  return useQuery<DiscordChannelsResponse>({ queryKey: channelsKey(guildId), staleTime: 60_000 });
}

export function useRolesQuery(guildId: string) {
  return useQuery<DiscordRolesResponse>({ queryKey: rolesKey(guildId), staleTime: 60_000 });
}

function sameValue(a: unknown, b: unknown): boolean {
  // Las listas de textos (eventos, palabras, ids) son conjuntos: cambiar solo el orden no es un cambio
  if (Array.isArray(a) && Array.isArray(b) && [...a, ...b].every((item) => typeof item === "string")) {
    return JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
  }
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Borrador editable de una parte de los ajustes extra (solo los campos `fields`). Guarda con PATCH
 * mandando únicamente lo que cambió, así dos páginas no se pisan.
 */
export function useExtrasDraft<K extends keyof GuildExtrasItem>(guildId: string, saved: GuildExtrasItem | undefined, fields: readonly K[]) {
  const { toast } = useToast();
  const pick = (source: GuildExtrasItem) => Object.fromEntries(fields.map((field) => [field, source[field]])) as Pick<GuildExtrasItem, K>;
  const [draft, setDraft] = useState<Pick<GuildExtrasItem, K> | null>(saved ? pick(saved) : null);
  // Valores del servidor de los que parte el borrador: con ellos se sabe qué editó de verdad el usuario
  const [base, setBase] = useState<Pick<GuildExtrasItem, K> | null>(saved ? pick(saved) : null);
  const [error, setError] = useState<string | null>(null);

  // Al llegar datos nuevos del servidor (otra pestaña u otro admin guardó) los campos que el usuario no ha
  // tocado toman el valor nuevo; lo que sí editó se queda en el borrador
  const savedKey = saved ? JSON.stringify(pick(saved)) : "";
  useEffect(() => {
    if (!saved) return;
    const next = pick(saved);
    setDraft((current) => {
      if (!current || !base) return next;
      const merged = { ...current };
      for (const field of fields) if (sameValue(current[field], base[field])) merged[field] = next[field];
      return merged;
    });
    setBase(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedKey, guildId]);

  const changed = useMemo(() => {
    if (!base || !draft) return [] as K[];
    return fields.filter((field) => !sameValue(draft[field], base[field]));
  }, [draft, base, fields]);

  const mutation = useMutation({
    mutationFn: async (body: GuildExtrasSaveRequest) => {
      const res = await apiRequest("PATCH", `/api/guilds/${guildId}/extras`, body);
      return (await res.json()) as GuildExtrasResponse;
    },
    onSuccess: (response) => {
      queryClient.setQueryData(extrasKey(guildId), response);
      const next = pick(response.extras);
      setBase(next);
      setDraft(next);
      setError(null);
      toast({ title: "Cambios guardados", description: "El bot ya usa la configuración nueva." });
    },
    onError: (err) => setError(errorMessage(err)),
  });

  const update = (patch: Partial<Pick<GuildExtrasItem, K>>) => setDraft((current) => (current ? { ...current, ...patch } : current));
  const save = () => {
    if (!draft) return;
    const body = Object.fromEntries(changed.map((field) => [field, draft[field]])) as GuildExtrasSaveRequest;
    mutation.mutate(body);
  };
  const discard = () => {
    if (base) setDraft(base);
    setError(null);
  };

  return { draft, update, changed, save, discard, saving: mutation.isPending, error, setError };
}

interface ChannelSelectProps {
  id: string;
  value: string | null;
  onChange: (value: string | null) => void;
  channels: DiscordChannelsResponse | undefined;
  placeholder?: string;
  testId?: string;
}

export function ChannelSelect({ id, value, onChange, channels, placeholder = "Elige un canal", testId }: ChannelSelectProps) {
  const postable = postableChannels(channels);
  const missing = value && channels && !postable.some((channel) => channel.id === value);
  return (
    <Select value={value ?? NONE} onValueChange={(next) => onChange(next === NONE ? null : next)}>
      <SelectTrigger id={id} data-testid={testId}>
        <SelectValue placeholder={channels ? placeholder : "Cargando canales…"} />
      </SelectTrigger>
      <SelectContent className="max-h-80">
        <RichSelectItem value={NONE}>{placeholder}</RichSelectItem>
        {missing && <RichSelectItem value={value} hint="Ese canal no existe o no tienes acceso a él">Canal oculto o borrado</RichSelectItem>}
        <SelectSeparator />
        {postable.map((channel) => (
          <RichSelectItem
            key={channel.id}
            value={channel.id}
            disabled={!channel.botCanPost && channel.id !== value}
            hint={channel.botCanPost ? channel.category : "No puedo publicar aquí (me faltan permisos)"}
          >
            #{channel.name}
          </RichSelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

type ClampedNumberInputProps = Omit<ComponentPropsWithoutRef<typeof Input>,"value" | "onChange" | "type" | "min" | "max"> & {
  value: number;
  min: number;
  max: number;
  onCommit: (value: number) => void;
};

/** Entero escrito en el campo, o null si está vacío o no es un número. */
function parseWholeNumber(raw: string): number | null {
  const n = Math.round(Number(raw));
  return raw.trim() !== "" && Number.isFinite(n) ? n : null;
}

/**
 * Campo numérico que deja escribir libremente (borrar y teclear otro número) y solo pasa al borrador enteros
 * dentro del rango; al salir del campo corrige lo que haya quedado vacío o fuera de rango.
 */
export function ClampedNumberInput({ value, min, max, onCommit, onBlur, ...props }: ClampedNumberInputProps) {
  const [text, setText] = useState(String(value));
  // Si el valor cambia por fuera (descartar, quitar una regla) se muestra el nuevo; si es el que se está escribiendo, se respeta el texto
  useEffect(() => {
    setText((current) => (parseWholeNumber(current) === value ? current : String(value)));
  }, [value]);
  return (
    <Input
      {...props}
      type="number"
      min={min}
      max={max}
      value={text}
      onChange={(event) => {
        const raw = event.target.value;
        setText(raw);
        const n = parseWholeNumber(raw);
        if (n !== null && n >= min && n <= max) onCommit(n);
      }}
      onBlur={(event) => {
        const n = parseWholeNumber(text);
        const clamped = n === null ? value : Math.min(max, Math.max(min, n));
        setText(String(clamped));
        if (clamped !== value) onCommit(clamped);
        onBlur?.(event);
      }}
    />
  );
}

interface RoleSelectProps {
  id: string;
  value: string | null;
  onChange: (value: string | null) => void;
  roles: DiscordRolesResponse | undefined;
  noneLabel?: string;
  /** Solo roles que el bot puede dar */
  onlyAssignable?: boolean;
  testId?: string;
}

export function RoleSelect({ id, value, onChange, roles, noneLabel = "Sin rol", onlyAssignable = true, testId }: RoleSelectProps) {
  return (
    <Select value={value ?? NONE} onValueChange={(next) => onChange(next === NONE ? null : next)}>
      <SelectTrigger id={id} data-testid={testId}>
        <SelectValue placeholder={roles ? noneLabel : "Cargando roles…"} />
      </SelectTrigger>
      <SelectContent className="max-h-80">
        <RichSelectItem value={NONE}>{noneLabel}</RichSelectItem>
        <SelectSeparator />
        {(roles ?? []).map((role) => (
          <RichSelectItem
            key={role.id}
            value={role.id}
            disabled={onlyAssignable && !role.assignable && role.id !== value}
            hint={onlyAssignable && !role.assignable ? role.reason ?? undefined : undefined}
          >
            <span className="inline-flex items-center gap-2">
              <span className="h-3 w-3 shrink-0 rounded-full border border-border" style={role.color ? { backgroundColor: role.color } : undefined} aria-hidden="true" />
              @{role.name}
            </span>
          </RichSelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

interface FeatureCardProps {
  icon: LucideIcon;
  title: string;
  description: ReactNode;
  enabled?: boolean;
  onToggle?: (enabled: boolean) => void;
  testId: string;
  children?: ReactNode;
}

/** Tarjeta de una función con su interruptor; el contenido se atenúa mientras está apagada. */
export function FeatureCard({ icon: Icon, title, description, enabled, onToggle, testId, children }: FeatureCardProps) {
  return (
    <Card data-testid={`card-${testId}`}>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Icon className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0 space-y-1">
            <CardTitle className="text-lg">{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
        </div>
        {onToggle && (
          <Switch checked={!!enabled} onCheckedChange={onToggle} aria-label={`Activar ${title}`} data-testid={`switch-${testId}`} />
        )}
      </CardHeader>
      {children && <CardContent className={cn("space-y-4", onToggle && !enabled && "opacity-60")}>{children}</CardContent>}
    </Card>
  );
}

export function Field({ label, htmlFor, hint, children }: { label: string; htmlFor: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

interface InstantExtrasToggleProps {
  guildId: string;
  field: "voiceXpEnabled" | "interactionsEnabled";
  id: string;
  label: string;
  description: ReactNode;
  savedOn: string;
  savedOff: string;
}

/** Interruptor que guarda al momento (sin barra de "Guardar"), como los de Niveles y Economía. */
export function InstantExtrasToggle({ guildId, field, id, label, description, savedOn, savedOff }: InstantExtrasToggleProps) {
  const { toast } = useToast();
  const query = useExtrasQuery(guildId);
  const mutation = useMutation({
    mutationFn: async (value: boolean) => {
      const res = await apiRequest("PATCH", `/api/guilds/${guildId}/extras`, { [field]: value });
      return (await res.json()) as GuildExtrasResponse;
    },
    onSuccess: (response, value) => {
      queryClient.setQueryData(extrasKey(guildId), response);
      toast({ title: value ? savedOn : savedOff, description: "El bot lo aplicará en unos segundos." });
    },
    onError: (err) => toast({ variant: "destructive", title: "No se pudo guardar", description: errorMessage(err) }),
  });
  const checked = mutation.isPending ? !!mutation.variables : !!query.data?.extras[field];
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border border-border bg-background/40 p-4">
      <div className="min-w-0 space-y-1">
        <Label htmlFor={id} className="text-base font-medium text-foreground">{label}</Label>
        <div className="text-sm text-muted-foreground">{description}</div>
      </div>
      <Switch id={id} checked={checked} disabled={!query.data || mutation.isPending} onCheckedChange={(value) => mutation.mutate(value)} data-testid={`switch-${id}`} />
    </div>
  );
}
