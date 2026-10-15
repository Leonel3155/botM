import { useState } from "react";
import { Ban, ClipboardList, Plus, ShieldAlert, Trash2, X } from "lucide-react";
import { EXTRAS_LIMITS, type AutoPunishRuleItem, type LogEventKey } from "@shared/api";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
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
import { useBotAvailability } from "@/components/ajustes-resumen/bot-status";
import { useSelectedGuild } from "@/lib/guild";

const FIELDS = [
  "logsEnabled", "logsChannelId", "logEvents",
  "filterEnabled", "filterWords", "filterInvites", "filterLinks", "filterExemptRoleIds", "filterWarn",
  "autoPunishEnabled", "autoPunishRules",
] as const;

const SECTION_OF: Record<(typeof FIELDS)[number], string> = {
  logsEnabled: "Registro", logsChannelId: "Registro", logEvents: "Registro",
  filterEnabled: "Filtro", filterWords: "Filtro", filterInvites: "Filtro", filterLinks: "Filtro", filterExemptRoleIds: "Filtro", filterWarn: "Filtro",
  autoPunishEnabled: "Castigos automáticos", autoPunishRules: "Castigos automáticos",
};

const LOG_EVENTS: { key: LogEventKey; label: string }[] = [
  { key: "messageDelete", label: "Mensajes borrados" },
  { key: "messageEdit", label: "Mensajes editados" },
  { key: "memberJoin", label: "Entradas al servidor" },
  { key: "memberLeave", label: "Salidas del servidor" },
  { key: "roles", label: "Cambios de roles" },
  { key: "moderation", label: "Acciones de moderación (también las automáticas)" },
];

const ACTION_LABELS: Record<AutoPunishRuleItem["action"], string> = {
  timeout: "Aislar (silenciar)",
  kick: "Expulsar",
  ban: "Banear",
};

function AutomodHeader() {
  return (
    <PageHeader
      title="Moderación automática"
      description="El bot vigila por ti: anota lo que pasa en un canal de registro, borra palabras o invitaciones que no quieres y castiga solo a quien junta advertencias."
    />
  );
}

export default function Automod() {
  const { guildId, guild } = useSelectedGuild();
  const availability = useBotAvailability(guildId, guild?.botInGuild);
  const extrasQuery = useExtrasQuery(guildId);
  const channelsQuery = useChannelsQuery(guildId);
  const rolesQuery = useRolesQuery(guildId);
  const editor = useExtrasDraft(guildId, extrasQuery.data?.extras, FIELDS);
  const { draft, update } = editor;
  const [newWord, setNewWord] = useState("");

  if (!extrasQuery.data || !draft) {
    return (
      <div className="space-y-6">
        <AutomodHeader />
        {extrasQuery.isError ? (
          <ApiErrorState error={extrasQuery.error} onRetry={() => void extrasQuery.refetch()} />
        ) : (
          [0, 1, 2].map((index) => <Skeleton key={index} className="h-40 w-full rounded-xl" />)
        )}
      </div>
    );
  }

  const sections = [...new Set(editor.changed.map((field) => SECTION_OF[field]))];
  const roles = rolesQuery.data;
  const exemptRoles = draft.filterExemptRoleIds;

  const addWords = () => {
    // Se pueden pegar varias separadas con comas
    const words = newWord.split(",").map((word) => word.trim()).filter((word) => word.replace("*", "").length >= 2);
    if (words.length === 0) return;
    const existing = new Set(draft.filterWords.map((word) => word.toLowerCase()));
    const merged = [...draft.filterWords, ...words.filter((word) => !existing.has(word.toLowerCase()))]
      .slice(0, EXTRAS_LIMITS.filterMaxWords)
      .map((word) => word.slice(0, EXTRAS_LIMITS.filterWordMaxLength));
    update({ filterWords: merged });
    setNewWord("");
  };

  const updateRule = (index: number, patch: Partial<AutoPunishRuleItem>) =>
    update({ autoPunishRules: draft.autoPunishRules.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)) });

  const duplicateWarns = new Set(draft.autoPunishRules.map((rule) => rule.warns)).size !== draft.autoPunishRules.length;

  const save = () => {
    if (duplicateWarns) {
      editor.setError("Hay dos castigos con la misma cantidad de advertencias.");
      return;
    }
    editor.save();
  };

  return (
    <div className="space-y-6 pb-4">
      <AutomodHeader />

      {availability.blocked && (
        <Alert><AlertDescription>{availability.blocked}</AlertDescription></Alert>
      )}

      <FeatureCard
        icon={ClipboardList}
        title="Registro (logs)"
        description="Un canal privado para el staff donde anoto lo que pasa en el servidor."
        enabled={draft.logsEnabled}
        onToggle={(logsEnabled) => update({ logsEnabled })}
        testId="logs"
      >
        <Field label="Canal de registro" htmlFor="logs-channel" hint="Te conviene un canal que solo vea el staff.">
          <ChannelSelect id="logs-channel" value={draft.logsChannelId} onChange={(logsChannelId) => update({ logsChannelId })} channels={channelsQuery.data} testId="select-logs-channel" />
        </Field>
        <div className="grid gap-2 sm:grid-cols-2">
          {LOG_EVENTS.map((event) => {
            const checked = draft.logEvents.includes(event.key);
            return (
              <label key={event.key} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={checked}
                  onCheckedChange={(value) => update({
                    logEvents: value ? [...draft.logEvents, event.key] : draft.logEvents.filter((key) => key !== event.key),
                  })}
                  data-testid={`check-log-${event.key}`}
                />
                {event.label}
              </label>
            );
          })}
        </div>
      </FeatureCard>

      <FeatureCard
        icon={Ban}
        title="Filtro de palabras y enlaces"
        description="Borro al momento los mensajes (nuevos o editados) con palabras prohibidas, invitaciones a otros servidores o enlaces. Los admins y quien puede gestionar mensajes no pasan por el filtro."
        enabled={draft.filterEnabled}
        onToggle={(filterEnabled) => update({ filterEnabled })}
        testId="filter"
      >
        <div className="space-y-2">
          <Label htmlFor="filter-word">Palabras prohibidas ({draft.filterWords.length}/{EXTRAS_LIMITS.filterMaxWords})</Label>
          <div className="flex gap-2">
            <Input
              id="filter-word"
              value={newWord}
              placeholder="Escribe una palabra (o varias separadas con comas)"
              onChange={(event) => setNewWord(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  addWords();
                }
              }}
              data-testid="input-filter-word"
            />
            <Button type="button" variant="outline" onClick={addWords} data-testid="button-add-word"><Plus />Agregar</Button>
          </div>
          <p className="text-xs text-muted-foreground">
            No importan mayúsculas, acentos ni trucos como "h0l4". Pon <code>*</code> al final para atrapar todo lo que empiece así (<code>tont*</code> atrapa "tonto" y "tontería").
          </p>
          {draft.filterWords.length > 0 && (
            <div className="flex flex-wrap gap-2" data-testid="list-filter-words">
              {draft.filterWords.map((word) => (
                <Badge key={word} variant="secondary" className="gap-1 pr-1">
                  {word}
                  <button
                    type="button"
                    className="rounded-sm p-0.5 hover:bg-background/60"
                    onClick={() => update({ filterWords: draft.filterWords.filter((item) => item !== word) })}
                    aria-label={`Quitar ${word}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex items-center justify-between gap-3 rounded-md border p-3 text-sm">
            <span>Borrar invitaciones a otros servidores</span>
            <Switch checked={draft.filterInvites} onCheckedChange={(filterInvites) => update({ filterInvites })} data-testid="switch-filter-invites" />
          </label>
          <label className="flex items-center justify-between gap-3 rounded-md border p-3 text-sm">
            <span>Borrar cualquier enlace</span>
            <Switch checked={draft.filterLinks} onCheckedChange={(filterLinks) => update({ filterLinks })} data-testid="switch-filter-links" />
          </label>
          <label className="flex items-center justify-between gap-3 rounded-md border p-3 text-sm sm:col-span-2">
            <span>Además de borrar, dar una advertencia (cuenta para los castigos automáticos)</span>
            <Switch checked={draft.filterWarn} onCheckedChange={(filterWarn) => update({ filterWarn })} data-testid="switch-filter-warn" />
          </label>
        </div>

        <div className="space-y-2">
          <Label htmlFor="filter-exempt">Roles que no pasan por el filtro</Label>
          <RoleSelect
            id="filter-exempt"
            value={null}
            noneLabel="Agregar un rol…"
            onlyAssignable={false}
            roles={roles?.filter((role) => !exemptRoles.includes(role.id))}
            onChange={(roleId) => roleId && update({ filterExemptRoleIds: [...exemptRoles, roleId].slice(0, EXTRAS_LIMITS.filterMaxExemptRoles) })}
            testId="select-filter-exempt"
          />
          {exemptRoles.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {exemptRoles.map((roleId) => (
                <Badge key={roleId} variant="outline" className="gap-1 pr-1">
                  @{roles?.find((role) => role.id === roleId)?.name ?? "rol borrado"}
                  <button type="button" className="rounded-sm p-0.5 hover:bg-muted" onClick={() => update({ filterExemptRoleIds: exemptRoles.filter((id) => id !== roleId) })} aria-label="Quitar rol">
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
          )}
        </div>
      </FeatureCard>

      <FeatureCard
        icon={ShieldAlert}
        title="Castigos automáticos"
        description={<>Cuando alguien junta cierta cantidad de advertencias (de <code>/warn</code> o del filtro), le aplico el castigo solo. Con <code>/clearwarns</code> le borras las advertencias y empieza de cero.</>}
        enabled={draft.autoPunishEnabled}
        onToggle={(autoPunishEnabled) => update({ autoPunishEnabled })}
        testId="autopunish"
      >
        <div className="space-y-3">
          {draft.autoPunishRules.map((rule, index) => (
            <div key={index} className="flex flex-wrap items-end gap-3 rounded-md border p-3" data-testid={`rule-${index}`}>
              <Field label="Advertencias" htmlFor={`rule-warns-${index}`}>
                <Input
                  id={`rule-warns-${index}`}
                  type="number"
                  className="w-24"
                  min={1}
                  max={EXTRAS_LIMITS.autoPunishMaxWarns}
                  value={rule.warns}
                  onChange={(event) => {
                    const warns = Math.round(Number(event.target.value));
                    if (Number.isFinite(warns)) updateRule(index, { warns: Math.min(EXTRAS_LIMITS.autoPunishMaxWarns, Math.max(1, warns)) });
                  }}
                />
              </Field>
              <Field label="Castigo" htmlFor={`rule-action-${index}`}>
                <Select value={rule.action} onValueChange={(action) => updateRule(index, { action: action as AutoPunishRuleItem["action"], minutes: action === "timeout" ? rule.minutes ?? 60 : undefined })}>
                  <SelectTrigger id={`rule-action-${index}`} className="w-48"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(ACTION_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              {rule.action === "timeout" && (
                <Field label="Minutos" htmlFor={`rule-minutes-${index}`}>
                  <Input
                    id={`rule-minutes-${index}`}
                    type="number"
                    className="w-28"
                    min={1}
                    max={EXTRAS_LIMITS.timeoutMaxMinutes}
                    value={rule.minutes ?? 60}
                    onChange={(event) => {
                      const minutes = Math.round(Number(event.target.value));
                      if (Number.isFinite(minutes)) updateRule(index, { minutes: Math.min(EXTRAS_LIMITS.timeoutMaxMinutes, Math.max(1, minutes)) });
                    }}
                  />
                </Field>
              )}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="ml-auto"
                onClick={() => update({ autoPunishRules: draft.autoPunishRules.filter((_, i) => i !== index) })}
                aria-label="Quitar castigo"
              >
                <Trash2 />
              </Button>
            </div>
          ))}
          {draft.autoPunishRules.length < EXTRAS_LIMITS.autoPunishMaxRules && (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                const next = Math.max(0, ...draft.autoPunishRules.map((rule) => rule.warns)) + 1;
                update({ autoPunishRules: [...draft.autoPunishRules, { warns: Math.min(next, EXTRAS_LIMITS.autoPunishMaxWarns), action: "timeout", minutes: 60 }] });
              }}
              data-testid="button-add-rule"
            >
              <Plus />Agregar castigo
            </Button>
          )}
          {duplicateWarns && <p className="text-sm text-destructive">Hay dos castigos con la misma cantidad de advertencias.</p>}
          <p className="text-xs text-muted-foreground">
            Cada castigo se aplica una vez, justo al llegar a esa cantidad. No puedo castigar al dueño del servidor ni a alguien con un rol igual o más alto que el mío.
          </p>
        </div>
      </FeatureCard>

      {editor.error && (
        <Alert variant="destructive" role="alert"><AlertDescription>{editor.error}</AlertDescription></Alert>
      )}
      {editor.changed.length > 0 && (
        <SaveBar sections={sections} saving={editor.saving} onSave={save} onDiscard={editor.discard} />
      )}
    </div>
  );
}
