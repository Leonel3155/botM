import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import type { DiscordChannelsResponse, DiscordRolesResponse, GuildTuningResponse, GuildTuningSaveRequest } from "@shared/api";
import {
  DEFAULT_TUNING,
  TUNING_NUMBER_LABELS,
  TUNING_NUMBER_LIMITS,
  roundToStep,
  type GuildTuning,
  type TuningNumberKey,
} from "@shared/tuning";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { RichSelectItem } from "@/components/comunidad/rich-select-item";
import { errorMessage } from "@/components/comandos/utils";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";

export const tuningKey = (guildId: string) => ["/api/guilds", guildId, "tuning"] as const;

export function useTuningQuery(guildId: string) {
  return useQuery<GuildTuningResponse>({ queryKey: tuningKey(guildId), staleTime: 30_000, enabled: !!guildId });
}

/** Ajustes del servidor, o los predeterminados mientras cargan (para textos de ayuda). */
export function useTuning(guildId: string): GuildTuning {
  return useTuningQuery(guildId).data?.tuning ?? DEFAULT_TUNING;
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Borrador de una parte de los ajustes finos (solo `fields`). Guarda con PATCH mandando únicamente lo que
 * cambió, así dos páginas (o dos personas) no se pisan los demás ajustes.
 */
export function useTuningDraft<K extends keyof GuildTuning>(guildId: string, fields: readonly K[]) {
  const { toast } = useToast();
  const query = useTuningQuery(guildId);
  const saved = query.data?.tuning;
  const pick = (source: GuildTuning) => Object.fromEntries(fields.map((field) => [field, source[field]])) as Pick<GuildTuning, K>;
  const [draft, setDraft] = useState<Pick<GuildTuning, K> | null>(saved ? pick(saved) : null);
  const [error, setError] = useState<string | null>(null);

  // Si llegan datos nuevos (otra pestaña guardó, o cambiaste de servidor) y no había cambios, se toman.
  // Si sí había cambios, solo se actualizan los campos que no tocaste.
  const savedKey = saved ? JSON.stringify(pick(saved)) : "";
  const [base, setBase] = useState<Pick<GuildTuning, K> | null>(saved ? pick(saved) : null);
  useEffect(() => {
    if (!saved) return;
    const next = pick(saved);
    setDraft((current) => {
      if (!current || !base) return next;
      const merged = { ...current };
      for (const field of fields) {
        if (sameValue(current[field], base[field])) merged[field] = next[field];
      }
      return merged;
    });
    setBase(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedKey, guildId]);

  const changed = useMemo(() => {
    if (!saved || !draft) return [] as K[];
    return fields.filter((field) => !sameValue(draft[field], saved[field]));
  }, [draft, saved, fields]);

  const mutation = useMutation({
    mutationFn: async (body: GuildTuningSaveRequest) => {
      const res = await apiRequest("PATCH", `/api/guilds/${guildId}/tuning`, body);
      return (await res.json()) as GuildTuningResponse;
    },
    onSuccess: (response) => {
      queryClient.setQueryData(tuningKey(guildId), response);
      // Las analíticas cuentan a quién ya le toca prestigiar con el nivel del servidor
      void queryClient.invalidateQueries({ queryKey: ["/api/guilds", guildId, "analytics"] });
      setDraft(pick(response.tuning));
      setBase(pick(response.tuning));
      setError(null);
      toast({ title: "Cambios guardados", description: "El bot usa los valores nuevos en unos segundos." });
    },
    onError: (err) => setError(errorMessage(err)),
  });

  const update = (patch: Partial<Pick<GuildTuning, K>>) => setDraft((current) => (current ? { ...current, ...patch } : current));
  const save = () => {
    if (!draft) return;
    mutation.mutate(Object.fromEntries(changed.map((field) => [field, draft[field]])) as GuildTuningSaveRequest);
  };
  const discard = () => {
    if (saved) setDraft(pick(saved));
    setError(null);
  };
  const resetToDefaults = () => setDraft(pick(DEFAULT_TUNING));

  return { query, saved, draft, update, changed, save, discard, resetToDefaults, saving: mutation.isPending, error, setError };
}

interface NumberSettingProps {
  field: TuningNumberKey;
  value: number;
  onChange: (value: number) => void;
  /** Unidad después del número, p. ej. "minutos" o "%" */
  suffix?: string;
  hint?: ReactNode;
  label?: string;
  disabled?: boolean;
}

/** Número con sus límites. Deja escribir libremente y ajusta al rango al salir del campo. */
export function NumberSetting({ field, value, onChange, suffix, hint, label, disabled }: NumberSettingProps) {
  const limits = TUNING_NUMBER_LIMITS[field];
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const id = `tuning-${field}`;
  const commit = () => {
    // En los enteros, "10,000" o "1,000,000" son miles (como los escribe el panel); si no, la coma es el
    // punto decimal ("1,5")
    const trimmed = text.trim();
    const thousands = !(limits.step && limits.step < 1) && /^-?\d{1,3}(,\d{3})+$/.test(trimmed);
    const cleaned = thousands ? trimmed.replace(/,/g, "") : trimmed.replace(",", ".");
    const parsed = Number(cleaned);
    if (!Number.isFinite(parsed) || cleaned === "") {
      setText(String(value));
      return;
    }
    const clamped = Math.min(Math.max(roundToStep(parsed, limits.step), limits.min), limits.max);
    setText(String(clamped));
    if (clamped !== value) onChange(clamped);
  };
  const isDefault = value === DEFAULT_TUNING[field];
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-sm">{label ?? TUNING_NUMBER_LABELS[field]}</Label>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          inputMode={limits.step && limits.step < 1 ? "decimal" : "numeric"}
          className="w-32"
          value={text}
          disabled={disabled}
          onChange={(event) => setText(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") commit();
          }}
          data-testid={`input-${field}`}
        />
        {suffix && <span className="text-sm text-muted-foreground">{suffix}</span>}
      </div>
      <p className="text-xs text-muted-foreground">
        {hint}
        {hint ? " " : ""}
        {isDefault ? "Valor predeterminado." : `Predeterminado: ${DEFAULT_TUNING[field].toLocaleString("es-MX")}.`}
      </p>
    </div>
  );
}

interface SwitchSettingProps {
  id: string;
  label: string;
  description?: ReactNode;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}

export function SwitchSetting({ id, label, description, checked, onChange, disabled }: SwitchSettingProps) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border border-border bg-background/40 p-4">
      <div className="min-w-0 space-y-1">
        <Label htmlFor={id} className="text-sm font-medium text-foreground">{label}</Label>
        {description && <div className="text-xs text-muted-foreground">{description}</div>}
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} disabled={disabled} data-testid={`switch-${id}`} />
    </div>
  );
}

/** Grupo de ajustes con título, en una cuadrícula de dos columnas. */
export function SettingsGroup({ title, description, children, className }: { title: string; description?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("space-y-3", className)}>
      <div>
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}

const ADD = "__agregar__";

interface IdChipsProps {
  id: string;
  label: string;
  hint?: ReactNode;
  value: string[];
  onChange: (ids: string[]) => void;
  max: number;
  options: { id: string; label: string; hint?: string; disabled?: boolean }[];
  /** Nombre a mostrar de un ID que ya no está en las opciones */
  missingLabel: string;
  /** Rojo si seguro ya no existe; "outline" si puede existir pero no lo ves (canales privados) */
  missingVariant?: "destructive" | "outline";
  /** false mientras cargan las opciones: así nada sale como borrado antes de tiempo */
  loaded?: boolean;
  placeholder: string;
}

/** Lista de canales o roles como fichas, con un selector para agregar más. */
export function IdChips({ id, label, hint, value, onChange, max, options, missingLabel, missingVariant = "destructive", loaded = true, placeholder }: IdChipsProps) {
  const byId = new Map(options.map((option) => [option.id, option]));
  const nameOf = (itemId: string) => byId.get(itemId)?.label ?? (loaded ? missingLabel : "…");
  const addable = options.filter((option) => !value.includes(option.id));
  return (
    <div className="space-y-2">
      <Label htmlFor={id} className="text-sm">{label} ({value.length}/{max})</Label>
      <Select value={ADD} onValueChange={(next) => next !== ADD && value.length < max && onChange([...value, next])}>
        <SelectTrigger id={id} data-testid={`select-${id}`} disabled={value.length >= max}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="max-h-80">
          <RichSelectItem value={ADD}>{placeholder}</RichSelectItem>
          {addable.map((option) => (
            <RichSelectItem key={option.id} value={option.id} disabled={option.disabled} hint={option.hint}>
              {option.label}
            </RichSelectItem>
          ))}
        </SelectContent>
      </Select>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      {value.length > 0 && (
        <div className="flex flex-wrap gap-2" data-testid={`list-${id}`}>
          {value.map((itemId) => (
            <Badge key={itemId} variant={byId.has(itemId) || !loaded ? "secondary" : missingVariant} className="gap-1 pr-1">
              {nameOf(itemId)}
              <button
                type="button"
                className="rounded-sm p-0.5 hover:bg-background/60"
                onClick={() => onChange(value.filter((item) => item !== itemId))}
                aria-label={`Quitar ${nameOf(itemId)}`}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

const CHANNEL_ICON: Record<string, string> = { voice: "🔊", stage: "🎙️", forum: "💬", announcement: "📢" };

export function channelOptions(channels: DiscordChannelsResponse | undefined) {
  return (channels ?? []).map((channel) => ({
    id: channel.id,
    label: `${CHANNEL_ICON[channel.type] ?? "#"}${CHANNEL_ICON[channel.type] ? " " : ""}${channel.name}`,
    hint: channel.category,
  }));
}

export function roleOptions(roles: DiscordRolesResponse | undefined) {
  return (roles ?? []).map((role) => ({ id: role.id, label: `@${role.name}` }));
}
