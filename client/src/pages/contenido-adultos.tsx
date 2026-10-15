import { Lock, ShieldCheck, X } from "lucide-react";
import { EXTRAS_LIMITS } from "@shared/api";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiErrorState } from "@/components/api-error-state";
import { PageHeader } from "@/components/page-header";
import { SaveBar } from "@/components/comunidad/save-bar";
import { RichSelectItem } from "@/components/comunidad/rich-select-item";
import { useBotAvailability } from "@/components/ajustes-resumen/bot-status";
import { FeatureCard, useChannelsQuery, useExtrasDraft, useExtrasQuery } from "@/components/extras/shared";
import { useSelectedGuild } from "@/lib/guild";

const FIELDS = ["nsfwEnabled", "nsfwChannelIds"] as const;
const ADD = "__agregar__";

function Header() {
  return (
    <PageHeader
      title="Contenido +18"
      description="Imágenes para adultos con /nsfw, solo en canales que tú autorices y que además estén marcados como +18 en Discord."
    />
  );
}

export default function ContenidoAdultos() {
  const { guildId, guild } = useSelectedGuild();
  const availability = useBotAvailability(guildId, guild?.botInGuild);
  const extrasQuery = useExtrasQuery(guildId);
  const channelsQuery = useChannelsQuery(guildId);
  const editor = useExtrasDraft(guildId, extrasQuery.data?.extras, FIELDS);
  const { draft, update } = editor;

  if (!extrasQuery.data || !draft) {
    return (
      <div className="space-y-6">
        <Header />
        {extrasQuery.isError ? (
          <ApiErrorState error={extrasQuery.error} onRetry={() => void extrasQuery.refetch()} />
        ) : (
          <Skeleton className="h-48 w-full rounded-xl" />
        )}
      </div>
    );
  }

  const channels = channelsQuery.data ?? [];
  const byId = new Map(channels.map((channel) => [channel.id, channel]));
  const ageRestricted = channels.filter((channel) => channel.nsfw && (channel.type === "text" || channel.type === "announcement"));
  const addable = ageRestricted.filter((channel) => !draft.nsfwChannelIds.includes(channel.id));
  const log = extrasQuery.data.nsfwLog;

  return (
    <div className="space-y-6 pb-4">
      <Header />
      {availability.blocked && (
        <Alert><AlertDescription>{availability.blocked}</AlertDescription></Alert>
      )}

      <Alert>
        <Lock className="h-4 w-4" />
        <AlertTitle>Doble candado</AlertTitle>
        <AlertDescription>
          El bot solo publica si las dos cosas se cumplen: el canal está en tu lista de abajo <strong>y</strong> está marcado en Discord
          como "con restricción de edad". Si falta una, no publica nada. Discord además esconde <code>/nsfw</code> en los canales normales.
        </AlertDescription>
      </Alert>

      <FeatureCard
        icon={ShieldCheck}
        title="Permitir contenido +18"
        description="Las imágenes son ilustraciones anime para adultos de waifu.pics, en categorías fijas. No se puede buscar por etiquetas, así nadie puede pedir otra cosa."
        enabled={draft.nsfwEnabled}
        onToggle={(nsfwEnabled) => update({ nsfwEnabled })}
        testId="nsfw"
      >
        <div className="space-y-2">
          <Label htmlFor="nsfw-channel">Canales autorizados ({draft.nsfwChannelIds.length}/{EXTRAS_LIMITS.nsfwMaxChannels})</Label>
          {ageRestricted.length === 0 && channelsQuery.data ? (
            <p className="text-sm text-muted-foreground">
              No hay canales marcados como +18 en tu servidor. En Discord: Editar canal → Información general → activa "Canal con
              restricción de edad". Luego vuelve aquí.
            </p>
          ) : (
            <Select
              value={ADD}
              onValueChange={(channelId) => channelId !== ADD && update({ nsfwChannelIds: [...draft.nsfwChannelIds, channelId].slice(0, EXTRAS_LIMITS.nsfwMaxChannels) })}
            >
              <SelectTrigger id="nsfw-channel" data-testid="select-nsfw-channel">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-80">
                <RichSelectItem value={ADD}>Agregar un canal +18…</RichSelectItem>
                {addable.map((channel) => (
                  <RichSelectItem key={channel.id} value={channel.id} disabled={!channel.botCanPost} hint={channel.botCanPost ? channel.category : "No puedo publicar aquí (me faltan permisos)"}>
                    🔞 #{channel.name}
                  </RichSelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <p className="text-xs text-muted-foreground">Solo salen los canales marcados como +18 en Discord.</p>
          {draft.nsfwChannelIds.length > 0 && (
            <div className="flex flex-wrap gap-2" data-testid="list-nsfw-channels">
              {draft.nsfwChannelIds.map((id) => {
                const channel = byId.get(id);
                const unmarked = channelsQuery.data && (!channel || !channel.nsfw);
                return (
                  <Badge key={id} variant={unmarked ? "destructive" : "secondary"} className="gap-1 pr-1">
                    #{channel?.name ?? "canal borrado"}
                    {unmarked && " (ya no es +18: no publico ahí)"}
                    <button
                      type="button"
                      className="rounded-sm p-0.5 hover:bg-background/60"
                      onClick={() => update({ nsfwChannelIds: draft.nsfwChannelIds.filter((item) => item !== id) })}
                      aria-label="Quitar canal"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                );
              })}
            </div>
          )}
        </div>
      </FeatureCard>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Lo último que se publicó</CardTitle>
          <CardDescription>Por si hay que borrar algo: quién lo pidió, dónde y cuándo.</CardDescription>
        </CardHeader>
        <CardContent>
          {log.length === 0 ? (
            <p className="text-sm text-muted-foreground">Todavía no se ha publicado nada.</p>
          ) : (
            <ul className="divide-y divide-border text-sm" data-testid="list-nsfw-log">
              {log.map((entry, index) => (
                <li key={index} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>
                    #{byId.get(entry.channelId)?.name ?? "canal"} · <span className="text-muted-foreground">{entry.category}</span> · usuario {entry.userId}
                  </span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {entry.createdAt ? new Date(entry.createdAt).toLocaleString("es-MX") : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {editor.error && (
        <Alert variant="destructive" role="alert"><AlertDescription>{editor.error}</AlertDescription></Alert>
      )}
      {editor.changed.length > 0 && (
        <SaveBar sections={["Contenido +18"]} saving={editor.saving} onSave={editor.save} onDiscard={editor.discard} />
      )}
    </div>
  );
}
