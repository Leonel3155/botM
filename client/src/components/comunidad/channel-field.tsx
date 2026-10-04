import type { ReactNode } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import type { Control } from "react-hook-form";
import { Hash, Megaphone, RefreshCw } from "lucide-react";
import type { DiscordChannelItem, DiscordChannelsResponse } from "@shared/api";
import { Button } from "@/components/ui/button";
import { FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectGroup, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { getApiErrorInfo, isApiError } from "@/lib/queryClient";
import type { EngagementFormValues } from "./form";
import { RichSelectItem } from "./rich-select-item";
import { InlineWarning } from "./section-parts";

/** Solo canales donde se puede escribir (texto y anuncios). */
export function postableChannels(channels: DiscordChannelsResponse | undefined): DiscordChannelItem[] {
  return (channels ?? []).filter((channel) => channel.type === "text" || channel.type === "announcement");
}

/** "#general" si conocemos el canal, o null. */
export function channelLabel(channels: DiscordChannelsResponse | undefined, channelId: string | null | undefined): string | null {
  if (!channelId) return null;
  const channel = channels?.find((candidate) => candidate.id === channelId);
  return channel ? `#${channel.name}` : null;
}

function groupByCategory(channels: DiscordChannelItem[]) {
  const groups: { category: string; channels: DiscordChannelItem[] }[] = [];
  for (const channel of channels) {
    const last = groups[groups.length - 1];
    if (last && last.category === channel.category) last.channels.push(channel);
    else groups.push({ category: channel.category, channels: [channel] });
  }
  return groups;
}

function ChannelName({ channel }: { channel: DiscordChannelItem }) {
  const Icon = channel.type === "announcement" ? Megaphone : Hash;
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="truncate">{channel.name}</span>
    </span>
  );
}

interface ChannelFieldProps {
  control: Control<EngagementFormValues>;
  name: "welcome.channelId" | "dailyQuestion.channelId";
  label: string;
  description?: ReactNode;
  placeholder: string;
  channelsQuery: UseQueryResult<DiscordChannelsResponse>;
  /** Canal guardado y el problema que el servidor detectó con él (si hay) */
  savedChannelId: string | null;
  savedProblem: string | null;
  testId: string;
}

/**
 * Selector de canal: solo canales de texto y de anuncios, agrupados por categoría.
 * Los canales donde el bot no puede publicar salen en gris y no se pueden elegir.
 */
export function ChannelField({
  control,
  name,
  label,
  description,
  placeholder,
  channelsQuery,
  savedChannelId,
  savedProblem,
  testId,
}: ChannelFieldProps) {
  const channels = postableChannels(channelsQuery.data);
  const groups = groupByCategory(channels);
  const someBlocked = channels.some((channel) => !channel.botCanPost);
  const errorInfo = channelsQuery.isError ? getApiErrorInfo(channelsQuery.error) : null;
  const botMissing = isApiError(channelsQuery.error) && channelsQuery.error.kind === "botMissing";

  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => {
        const value = field.value ?? null;
        const selected = value ? channels.find((channel) => channel.id === value) : undefined;
        const unknown = !!value && channelsQuery.isSuccess && !selected;

        let warning: string | null = null;
        if (value && value === savedChannelId && savedProblem) warning = savedProblem;
        else if (unknown) warning = "Ese canal ya no existe o no lo puedo ver. Elige otro.";
        else if (selected && !selected.botCanPost) {
          warning = `No puedo publicar en #${selected.name}: revisa que mi rol tenga Ver canal, Enviar mensajes e Insertar enlaces ahí.`;
        }

        return (
          <FormItem>
            <FormLabel>{label}</FormLabel>
            {channelsQuery.isLoading ? (
              <Skeleton className="h-9 w-full" aria-label="Cargando canales" />
            ) : (
              <Select
                value={value ?? ""}
                onValueChange={(next) => field.onChange(next || null)}
                disabled={!channelsQuery.isSuccess}
              >
                <FormControl>
                  <SelectTrigger ref={field.ref} onBlur={field.onBlur} data-testid={testId}>
                    <SelectValue placeholder={channelsQuery.isSuccess ? placeholder : "No pude cargar los canales"}>
                      {/* Sin la lista no hay elementos que mostrar: decimos qué pasa con el guardado */}
                      {channelsQuery.isSuccess ? undefined : "Canal guardado (no pude cargar la lista)"}
                    </SelectValue>
                  </SelectTrigger>
                </FormControl>
                <SelectContent className="max-h-80">
                  {unknown && value && (
                    <RichSelectItem value={value} disabled hint="Ya no existe o no lo puedo ver">
                      Canal desconocido
                    </RichSelectItem>
                  )}
                  {groups.map((group) => (
                    <SelectGroup key={`${group.category}-${group.channels[0].id}`}>
                      <SelectLabel className="text-xs uppercase tracking-wide text-muted-foreground">
                        {group.category}
                      </SelectLabel>
                      {group.channels.map((channel) => (
                        <RichSelectItem
                          key={channel.id}
                          value={channel.id}
                          disabled={!channel.botCanPost}
                          hint={channel.botCanPost ? undefined : "No puedo publicar aquí (me faltan permisos)"}
                        >
                          <ChannelName channel={channel} />
                        </RichSelectItem>
                      ))}
                    </SelectGroup>
                  ))}
                  {channels.length === 0 && (
                    <p className="px-2 py-3 text-sm text-muted-foreground">
                      No encontré canales de texto en este servidor.
                    </p>
                  )}
                </SelectContent>
              </Select>
            )}
            {description && <FormDescription>{description}</FormDescription>}
            {channelsQuery.isSuccess && someBlocked && (
              <p className="text-xs text-muted-foreground">
                Los canales en gris son donde no puedo publicar: me falta Ver canal, Enviar mensajes o Insertar enlaces.
              </p>
            )}
            <FormMessage />
            {warning && <InlineWarning>{warning}</InlineWarning>}
            {errorInfo && (
              <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground" role="alert">
                <span>
                  {errorInfo.title}.{" "}
                  {botMissing ? "Invita al bot para poder elegir un canal." : errorInfo.description}
                </span>
                {!botMissing && (
                  <Button type="button" variant="outline" size="sm" onClick={() => void channelsQuery.refetch()}>
                    <RefreshCw />
                    Reintentar
                  </Button>
                )}
              </div>
            )}
          </FormItem>
        );
      }}
    />
  );
}
