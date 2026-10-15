import { Cake, Hand, Sparkles, Star, VenetianMask } from "lucide-react";
import { EXTRAS_LIMITS } from "@shared/api";
import { isValidButtonEmoji } from "@shared/emoji";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { ApiErrorState } from "@/components/api-error-state";
import { PageHeader } from "@/components/page-header";
import { SaveBar } from "@/components/comunidad/save-bar";
import {
  ChannelSelect,
  FeatureCard,
  Field,
  RoleSelect,
  useChannelsQuery,
  useExtrasDraft,
  useExtrasQuery,
  useRolesQuery,
} from "@/components/extras/shared";
import { useSelectedGuild } from "@/lib/guild";

const FIELDS = [
  "interactionsEnabled",
  "birthdaysEnabled", "birthdayChannelId", "birthdayRoleId", "birthdayHour", "birthdayMessage",
  "starboardEnabled", "starboardChannelId", "starboardEmoji", "starboardThreshold",
  "confessionsEnabled", "confessionsChannelId",
] as const;

const SECTION_OF: Record<(typeof FIELDS)[number], string> = {
  interactionsEnabled: "Interacciones",
  birthdaysEnabled: "Cumpleaños", birthdayChannelId: "Cumpleaños", birthdayRoleId: "Cumpleaños", birthdayHour: "Cumpleaños", birthdayMessage: "Cumpleaños",
  starboardEnabled: "Starboard", starboardChannelId: "Starboard", starboardEmoji: "Starboard", starboardThreshold: "Starboard",
  confessionsEnabled: "Confesiones", confessionsChannelId: "Confesiones",
};

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

const COMMANDS: { name: string; text: string }[] = [
  { name: "/abrazar, /besar, /cachetada, /acariciar, /golpear, /morder, /saludar, /chocar, /picar, /acurrucar", text: "Interacciones con GIF hacia otra persona. El bot cuenta cuántas veces se las hacen." },
  { name: "/reaccion", text: "Un GIF de cómo te sientes: bailar, llorar, reír, dormir…" },
  { name: "/cumple guardar · ver · proximos · borrar", text: "Cada quien guarda su fecha (sin el año)." },
  { name: "/encuesta", text: "Encuesta con los botones de Discord: de 2 a 10 opciones separadas con ;." },
  { name: "/recordar crear · lista · borrar", text: "Te aviso en el canal cuando llegue la hora (10m, 2h, 1d…)." },
  { name: "/confesar", text: "Confesión anónima en el canal elegido. Los admins pueden ver el autor con /confesion autor si hay abuso." },
];

function DiversionHeader() {
  return (
    <PageHeader
      title="Diversión"
      description="Cosas para que la gente platique y se quede: interacciones con GIFs, cumpleaños, lo mejor del servidor y confesiones anónimas."
    />
  );
}

export default function Diversion() {
  const { guildId } = useSelectedGuild();
  const extrasQuery = useExtrasQuery(guildId);
  const channelsQuery = useChannelsQuery(guildId);
  const rolesQuery = useRolesQuery(guildId);
  const editor = useExtrasDraft(guildId, extrasQuery.data?.extras, FIELDS);
  const { draft, update } = editor;

  if (!extrasQuery.data || !draft) {
    return (
      <div className="space-y-6">
        <DiversionHeader />
        {extrasQuery.isError ? (
          <ApiErrorState error={extrasQuery.error} onRetry={() => void extrasQuery.refetch()} />
        ) : (
          [0, 1, 2].map((index) => <Skeleton key={index} className="h-40 w-full rounded-xl" />)
        )}
      </div>
    );
  }

  const { stats, defaultBirthdayMessage } = extrasQuery.data;
  const channels = channelsQuery.data;
  const emojiOk = isValidButtonEmoji(draft.starboardEmoji.trim());
  const sections = [...new Set(editor.changed.map((field) => SECTION_OF[field]))];

  const save = () => {
    if (!emojiOk) {
      editor.setError("El emoji del starboard no es válido: pon uno solo (por ejemplo ⭐).");
      return;
    }
    editor.save();
  };

  return (
    <div className="space-y-6 pb-4">
      <DiversionHeader />

      <FeatureCard
        icon={Hand}
        title="Interacciones con GIFs"
        description="/abrazar, /besar, /cachetada y más, con un GIF al azar. También /reaccion para mostrar cómo te sientes."
        enabled={draft.interactionsEnabled}
        onToggle={(interactionsEnabled) => update({ interactionsEnabled })}
        testId="interactions"
      />

      <FeatureCard
        icon={Cake}
        title="Cumpleaños"
        description={<>Cada quien guarda su fecha con <code>/cumple guardar</code> y el bot lo felicita ese día. Hay {stats.birthdays} cumpleaños guardados.</>}
        enabled={draft.birthdaysEnabled}
        onToggle={(birthdaysEnabled) => update({ birthdaysEnabled })}
        testId="birthdays"
      >
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Canal de felicitaciones" htmlFor="birthday-channel">
            <ChannelSelect id="birthday-channel" value={draft.birthdayChannelId} onChange={(birthdayChannelId) => update({ birthdayChannelId })} channels={channels} testId="select-birthday-channel" />
          </Field>
          <Field label="Hora de la felicitación" htmlFor="birthday-hour" hint="En la zona horaria del servidor (la cambias en Bienvenida y pregunta del día).">
            <Select value={String(draft.birthdayHour)} onValueChange={(value) => update({ birthdayHour: Number(value) })}>
              <SelectTrigger id="birthday-hour" data-testid="select-birthday-hour"><SelectValue /></SelectTrigger>
              <SelectContent className="max-h-72">
                {HOURS.map((hour) => <SelectItem key={hour} value={String(hour)}>{String(hour).padStart(2, "0")}:00</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Rol de cumpleañero (opcional)" htmlFor="birthday-role" hint="Se lo doy ese día y se lo quito a las 24 horas.">
            <RoleSelect id="birthday-role" value={draft.birthdayRoleId} onChange={(birthdayRoleId) => update({ birthdayRoleId })} roles={rolesQuery.data} testId="select-birthday-role" />
          </Field>
        </div>
        <Field label="Mensaje" htmlFor="birthday-message" hint={<>Escribe <code>{"{usuarios}"}</code> donde van las menciones. Vacío = el mensaje de siempre.</>}>
          <Textarea
            id="birthday-message"
            value={draft.birthdayMessage ?? ""}
            placeholder={defaultBirthdayMessage}
            maxLength={EXTRAS_LIMITS.birthdayMessageMaxLength}
            onChange={(event) => update({ birthdayMessage: event.target.value || null })}
            data-testid="input-birthday-message"
          />
        </Field>
      </FeatureCard>

      <FeatureCard
        icon={Star}
        title="Starboard (lo mejor del servidor)"
        description={`Cuando un mensaje junta suficientes reacciones con el emoji elegido, lo copio a un canal especial. Llevo ${stats.starboardPosts} mensajes destacados.`}
        enabled={draft.starboardEnabled}
        onToggle={(starboardEnabled) => update({ starboardEnabled })}
        testId="starboard"
      >
        <div className="grid gap-4 md:grid-cols-3">
          <Field label="Canal" htmlFor="starboard-channel">
            <ChannelSelect id="starboard-channel" value={draft.starboardChannelId} onChange={(starboardChannelId) => update({ starboardChannelId })} channels={channels} testId="select-starboard-channel" />
          </Field>
          <Field label="Emoji" htmlFor="starboard-emoji" hint={emojiOk ? "Uno solo, o uno del servidor como <:nombre:id>." : "Ese emoji no es válido."}>
            <Input id="starboard-emoji" value={draft.starboardEmoji} maxLength={EXTRAS_LIMITS.starboardEmojiMaxLength} onChange={(event) => update({ starboardEmoji: event.target.value })} aria-invalid={!emojiOk} data-testid="input-starboard-emoji" />
          </Field>
          <Field label="Reacciones necesarias" htmlFor="starboard-threshold" hint="No cuenta la del autor.">
            <Input
              id="starboard-threshold"
              type="number"
              inputMode="numeric"
              min={EXTRAS_LIMITS.starboardThresholdMin}
              max={EXTRAS_LIMITS.starboardThresholdMax}
              value={draft.starboardThreshold}
              onChange={(event) => {
                const value = Math.round(Number(event.target.value));
                if (Number.isFinite(value)) update({ starboardThreshold: Math.min(EXTRAS_LIMITS.starboardThresholdMax, Math.max(EXTRAS_LIMITS.starboardThresholdMin, value)) });
              }}
              data-testid="input-starboard-threshold"
            />
          </Field>
        </div>
        <p className="text-xs text-muted-foreground">Por seguridad, nada de un canal +18 pasa a un starboard normal.</p>
      </FeatureCard>

      <FeatureCard
        icon={VenetianMask}
        title="Confesiones anónimas"
        description={`Con /confesar cualquiera manda una confesión y sale en el canal sin su nombre. Van ${stats.confessions}.`}
        enabled={draft.confessionsEnabled}
        onToggle={(confessionsEnabled) => update({ confessionsEnabled })}
        testId="confessions"
      >
        <Field label="Canal de confesiones" htmlFor="confessions-channel" hint="Si el filtro de palabras está activado, también revisa las confesiones. Los admins pueden ver quién escribió una con /confesion autor (queda en el historial de moderación).">
          <ChannelSelect id="confessions-channel" value={draft.confessionsChannelId} onChange={(confessionsChannelId) => update({ confessionsChannelId })} channels={channels} testId="select-confessions-channel" />
        </Field>
      </FeatureCard>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-5 w-5 text-primary" aria-hidden="true" />
            Comandos para todos
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-3 text-sm">
            {COMMANDS.map((command) => (
              <li key={command.name}>
                <code className="text-foreground">{command.name}</code>
                <p className="text-muted-foreground">{command.text}</p>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs text-muted-foreground">
            <Badge variant="outline" className="mr-1">Tip</Badge>
            Hay {stats.pendingReminders} recordatorios pendientes en este servidor.
          </p>
        </CardContent>
      </Card>

      {editor.error && (
        <Alert variant="destructive" role="alert"><AlertDescription>{editor.error}</AlertDescription></Alert>
      )}

      {editor.changed.length > 0 && (
        <SaveBar sections={sections} saving={editor.saving} onSave={save} onDiscard={editor.discard} />
      )}
    </div>
  );
}
