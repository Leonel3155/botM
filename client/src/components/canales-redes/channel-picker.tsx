import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from "react";
import { AlertTriangle, Hash, Megaphone, Volume2, type LucideIcon } from "lucide-react";
import type { DiscordChannelItem, DiscordChannelKind } from "@shared/api";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export const CHANNEL_KIND_LABELS: Record<DiscordChannelKind, string> = {
  text: "Texto",
  announcement: "Anuncios",
  voice: "Voz",
};

const CHANNEL_KIND_ICONS: Record<DiscordChannelKind, LucideIcon> = {
  text: Hash,
  announcement: Megaphone,
  voice: Volume2,
};

/** Valor interno de la opción "sin canal" (Radix no acepta "" como valor de una opción). */
const NONE_VALUE = "__ninguno__";

export function findChannel(channels: DiscordChannelItem[] | undefined, channelId: string | null | undefined) {
  if (!channelId || !channels) return undefined;
  return channels.find((channel) => channel.id === channelId);
}

/** "#general", o null si no hay canal o no lo encontramos. */
export function channelLabel(channels: DiscordChannelItem[] | undefined, channelId: string | null | undefined) {
  const channel = findChannel(channels, channelId);
  return channel ? `#${channel.name}` : null;
}

export interface ChannelIssue {
  /** error: el bot no publicará nada ahí. warning: le faltan permisos (se puede arreglar en Discord). */
  level: "error" | "warning";
  text: string;
}

/**
 * Problema con un canal elegido, según la lista de canales del bot. null si todo bien,
 * si no hay canal o si la lista aún no carga.
 */
export function getChannelIssue(
  channels: DiscordChannelItem[] | undefined,
  channelId: string | null | undefined,
): ChannelIssue | null {
  if (!channelId || !channels) return null;
  const channel = findChannel(channels, channelId);
  if (!channel) {
    return { level: "error", text: "Ese canal ya no existe o el bot no puede verlo. Elige otro." };
  }
  if (channel.type === "voice") {
    return { level: "error", text: `#${channel.name} es un canal de voz: el bot no publica ahí. Elige un canal de texto.` };
  }
  if (!channel.botCanPost) {
    return {
      level: "warning",
      text: `El bot no puede publicar en #${channel.name}. En Discord, dale ahí los permisos Ver canal, Enviar mensajes e Insertar enlaces.`,
    };
  }
  return null;
}

/** Aviso debajo de un selector de canal. */
export function ChannelIssueNote({ issue, id, className }: { issue: ChannelIssue | null; id?: string; className?: string }) {
  if (!issue) return null;
  return (
    <p
      id={id}
      className={cn(
        "flex items-start gap-2 text-xs",
        issue.level === "error" ? "text-destructive" : "text-status-warning",
        className,
      )}
    >
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>{issue.text}</span>
    </p>
  );
}

function ChannelOption({ channel }: { channel: DiscordChannelItem }) {
  const Icon = CHANNEL_KIND_ICONS[channel.type];
  return (
    <span className="flex min-w-0 items-center gap-2">
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="truncate">{channel.name}</span>
      <span className="shrink-0 text-xs text-muted-foreground">· {CHANNEL_KIND_LABELS[channel.type]}</span>
      {!channel.botCanPost && (
        <>
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-status-warning" aria-hidden="true" />
          <span className="sr-only">(el bot no puede publicar aquí)</span>
        </>
      )}
    </span>
  );
}

/** Agrupa por categoría respetando el orden de Discord (la API ya los manda ordenados). */
function groupByCategory(channels: DiscordChannelItem[]) {
  const groups: { category: string; channels: DiscordChannelItem[] }[] = [];
  for (const channel of channels) {
    const last = groups[groups.length - 1];
    if (last && last.category === channel.category) last.channels.push(channel);
    else groups.push({ category: channel.category, channels: [channel] });
  }
  return groups;
}

type TriggerProps = Omit<
  ComponentPropsWithoutRef<typeof SelectTrigger>,
  "value" | "onChange" | "children" | "defaultValue" | "dir"
>;

export interface ChannelPickerProps extends TriggerProps {
  value: string | null;
  onChange: (channelId: string | null) => void;
  channels: DiscordChannelItem[];
  /** Si se pasa, aparece la opción para dejarlo sin canal (devuelve null). */
  noneLabel?: string;
  placeholder?: string;
}

/**
 * Selector de canal de Discord: solo canales de texto y de anuncios (en los de voz el bot
 * no publica), agrupados por categoría, con el tipo y un aviso si el bot no puede publicar.
 * Los props sobrantes (id, aria-*) van al botón, así funciona dentro de <FormControl>.
 */
export const ChannelPicker = forwardRef<ElementRef<typeof SelectTrigger>, ChannelPickerProps>(
  function ChannelPicker(
    { value, onChange, channels, noneLabel, placeholder = "Elige un canal", disabled, className, ...triggerProps },
    ref,
  ) {
    const postable = channels.filter((channel) => channel.type !== "voice");
    const selected = findChannel(channels, value);
    // El canal guardado ya no está (lo borraron o el bot no lo ve) o es de voz: se muestra igual
    const orphan = value && (!selected || selected.type === "voice") ? value : null;
    const groups = groupByCategory(postable);

    const selectValue = value ?? (noneLabel ? NONE_VALUE : "");

    return (
      <Select
        value={selectValue}
        onValueChange={(next) => onChange(next === NONE_VALUE ? null : next)}
        disabled={disabled}
      >
        <SelectTrigger ref={ref} className={cn("w-full text-left [&>span]:min-w-0", className)} {...triggerProps}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent className="max-w-[calc(100vw-2rem)]">
          {noneLabel && <SelectItem value={NONE_VALUE}>{noneLabel}</SelectItem>}
          {orphan && (
            <SelectItem value={orphan} disabled>
              {selected ? (
                <ChannelOption channel={selected} />
              ) : (
                <span className="flex items-center gap-2 text-destructive">
                  <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
                  Canal que ya no existe
                </span>
              )}
            </SelectItem>
          )}
          {(noneLabel || orphan) && groups.length > 0 && <SelectSeparator />}
          {groups.length === 0 ? (
            <div className="px-3 py-2 text-sm text-muted-foreground">
              Este servidor no tiene canales de texto que el bot pueda ver.
            </div>
          ) : (
            groups.map((group, index) => (
              <SelectGroup key={`${group.category}-${index}`}>
                <SelectLabel className="text-xs uppercase tracking-wide text-muted-foreground">
                  {group.category}
                </SelectLabel>
                {group.channels.map((channel) => (
                  <SelectItem key={channel.id} value={channel.id}>
                    <ChannelOption channel={channel} />
                  </SelectItem>
                ))}
              </SelectGroup>
            ))
          )}
        </SelectContent>
      </Select>
    );
  },
);
