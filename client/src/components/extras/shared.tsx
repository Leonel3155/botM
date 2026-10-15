import { useEffect, useMemo, useState, type ReactNode } from "react";
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
  const [error, setError] = useState<string | null>(null);

  // Al llegar datos nuevos del servidor (o cambiar de servidor) se reemplaza el borrador si no había cambios
  const savedKey = saved ? JSON.stringify(pick(saved)) : "";
  const [baseKey, setBaseKey] = useState(savedKey);
  useEffect(() => {
    if (!saved) return;
    if (!draft || JSON.stringify(draft) === baseKey) setDraft(pick(saved));
    setBaseKey(savedKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedKey, guildId]);

  const changed = useMemo(() => {
    if (!saved || !draft) return [] as K[];
    return fields.filter((field) => !sameValue(draft[field], saved[field]));
  }, [draft, saved, fields]);

  const mutation = useMutation({
    mutationFn: async (body: GuildExtrasSaveRequest) => {
      const res = await apiRequest("PATCH", `/api/guilds/${guildId}/extras`, body);
      return (await res.json()) as GuildExtrasResponse;
    },
    onSuccess: (response) => {
      queryClient.setQueryData(extrasKey(guildId), response);
      setDraft(pick(response.extras));
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
    if (saved) setDraft(pick(saved));
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
        {missing && <RichSelectItem value={value} hint="Ese canal ya no existe">Canal borrado</RichSelectItem>}
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
