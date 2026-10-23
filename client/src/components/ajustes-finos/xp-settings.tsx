import { Award, Plus, SlidersHorizontal, Trash2 } from "lucide-react";
import { DEFAULT_LEVEL_UP_MESSAGE, LEVEL_UP_PLACEHOLDERS, TUNING_LIMITS, type LevelRoleReward } from "@shared/tuning";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { SaveBar } from "@/components/comunidad/save-bar";
import { ChannelSelect, RoleSelect, useChannelsQuery, useRolesQuery } from "@/components/extras/shared";
import { IdChips, NumberSetting, SettingsGroup, SwitchSetting, channelOptions, roleOptions, useTuningDraft } from "./shared";

const FIELDS = [
  "xpEnabled",
  "xpMin",
  "xpMax",
  "xpCooldownSeconds",
  "xpMinMessageLength",
  "xpMultiplierPercent",
  "noXpChannelIds",
  "noXpRoleIds",
  "voiceXpPerMinute",
  "voiceXpMinMembers",
  "levelUpChannelId",
  "levelUpMessage",
  "levelUpPing",
  "levelRoleRewards",
  "levelRoleStack",
  "prestigeMinLevel",
  "prestigeBonusPercent",
  "prestigeMaxBonus",
] as const;

function nextFreeLevel(rules: LevelRoleReward[]): number {
  const used = new Set(rules.map((rule) => rule.level));
  for (const level of [5, 10, 15, 20, 25, 30, 40, 50, 75, 100]) if (!used.has(level)) return level;
  return Math.min(Math.max(0, ...rules.map((rule) => rule.level)) + 10, TUNING_LIMITS.maxLevel);
}

/** Todo lo que se puede ajustar de XP, avisos, roles por nivel y prestigio. */
export function XpSettings({ guildId, blocked }: { guildId: string; blocked: string | null }) {
  const editor = useTuningDraft(guildId, FIELDS);
  const channelsQuery = useChannelsQuery(guildId);
  const rolesQuery = useRolesQuery(guildId);
  const { draft, update } = editor;

  if (!draft) {
    return editor.query.isError ? (
      <Alert variant="destructive"><AlertDescription>No se pudieron cargar los ajustes de XP. Recarga la página.</AlertDescription></Alert>
    ) : (
      <Skeleton className="h-64 w-full rounded-xl" />
    );
  }

  const roles = rolesQuery.data;
  const updateRule = (index: number, patch: Partial<LevelRoleReward>) =>
    update({ levelRoleRewards: draft.levelRoleRewards.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)) });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="p-4 sm:p-6">
          <CardTitle className="flex items-center gap-2 text-lg">
            <SlidersHorizontal className="h-5 w-5 text-primary" aria-hidden="true" />
            Reglas de XP
          </CardTitle>
          <CardDescription>Cuánta XP se gana y dónde. Los cambios valen desde el siguiente mensaje.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6 p-4 pt-0 sm:p-6 sm:pt-0">
          <SwitchSetting
            id="xp-enabled"
            label="Sistema de XP encendido"
            description="Si lo apagas, nadie gana XP ni sube de nivel (ni por mensajes ni por voz). Lo que ya tenían se conserva, y las monedas por platicar siguen si la economía está prendida."
            checked={draft.xpEnabled}
            onChange={(xpEnabled) => update({ xpEnabled })}
          />
          <SettingsGroup title="Por mensaje" description="Cada mensaje premiado da una cantidad al azar entre el mínimo y el máximo.">
            <NumberSetting field="xpMin" value={draft.xpMin} onChange={(xpMin) => update({ xpMin, xpMax: Math.max(xpMin, draft.xpMax) })} suffix="XP" />
            <NumberSetting field="xpMax" value={draft.xpMax} onChange={(xpMax) => update({ xpMax, xpMin: Math.min(xpMax, draft.xpMin) })} suffix="XP" />
            <NumberSetting
              field="xpCooldownSeconds"
              value={draft.xpCooldownSeconds}
              onChange={(xpCooldownSeconds) => update({ xpCooldownSeconds })}
              suffix="segundos"
              hint="Solo un mensaje por persona cuenta en este tiempo, así el spam no sirve. También aplica a las monedas por platicar."
            />
            <NumberSetting
              field="xpMinMessageLength"
              value={draft.xpMinMessageLength}
              onChange={(xpMinMessageLength) => update({ xpMinMessageLength })}
              suffix="letras"
              hint="Los mensajes más cortos no dan XP ni monedas (0 = cualquiera)."
            />
            <NumberSetting
              field="xpMultiplierPercent"
              value={draft.xpMultiplierPercent}
              onChange={(xpMultiplierPercent) => update({ xpMultiplierPercent })}
              suffix="%"
              hint="100 % es lo normal. Pon 200 % para un evento de doble XP (aplica a mensajes y voz)."
            />
          </SettingsGroup>
          <SettingsGroup title="En canales de voz" description="Solo cuenta si el XP por voz está encendido arriba.">
            <NumberSetting field="voiceXpPerMinute" value={draft.voiceXpPerMinute} onChange={(voiceXpPerMinute) => update({ voiceXpPerMinute })} suffix="XP" />
            <NumberSetting
              field="voiceXpMinMembers"
              value={draft.voiceXpMinMembers}
              onChange={(voiceXpMinMembers) => update({ voiceXpMinMembers })}
              suffix="personas"
              hint="Sin contar bots. Con 2 nadie gana XP estando solo."
            />
          </SettingsGroup>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <IdChips
              id="no-xp-channels"
              label="Canales sin XP"
              hint="Ahí no se gana XP ni monedas por platicar (sirve para canales de bots, spam o voz AFK)."
              value={draft.noXpChannelIds}
              onChange={(noXpChannelIds) => update({ noXpChannelIds })}
              max={TUNING_LIMITS.listMax}
              options={channelOptions(channelsQuery.data)}
              missingLabel="canal oculto o borrado"
              missingVariant="outline"
              loaded={channelsQuery.data !== undefined}
              placeholder="Agregar un canal…"
            />
            <IdChips
              id="no-xp-roles"
              label="Roles sin XP"
              hint="Quien tenga uno de estos roles no gana XP ni monedas por platicar (por ejemplo, un rol de castigados)."
              value={draft.noXpRoleIds}
              onChange={(noXpRoleIds) => update({ noXpRoleIds })}
              max={TUNING_LIMITS.listMax}
              options={roleOptions(roles)}
              missingLabel="rol borrado"
              loaded={roles !== undefined}
              placeholder="Agregar un rol…"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="p-4 sm:p-6">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Award className="h-5 w-5 text-primary" aria-hidden="true" />
            Avisos y roles por nivel
          </CardTitle>
          <CardDescription>Dónde se anuncia cada subida de nivel y qué rol se gana al llegar a cierto nivel.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6 p-4 pt-0 sm:p-6 sm:pt-0">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="level-up-channel" className="text-sm">Canal de avisos</Label>
              <ChannelSelect
                id="level-up-channel"
                value={draft.levelUpChannelId}
                onChange={(levelUpChannelId) => update({ levelUpChannelId })}
                channels={channelsQuery.data}
                placeholder="El canal donde escribió"
                testId="select-level-up-channel"
              />
              <p className="text-xs text-muted-foreground">Si eliges uno, todos los avisos de nivel salen ahí.</p>
            </div>
            <SwitchSetting
              id="level-up-ping"
              label="Mencionar a la persona"
              description="Si lo apagas, el aviso pone su nombre sin mandarle notificación."
              checked={draft.levelUpPing}
              onChange={(levelUpPing) => update({ levelUpPing })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="level-up-message" className="text-sm">Mensaje al subir de nivel</Label>
            <Textarea
              id="level-up-message"
              rows={2}
              maxLength={TUNING_LIMITS.levelUpMessageMax}
              placeholder={DEFAULT_LEVEL_UP_MESSAGE}
              value={draft.levelUpMessage ?? ""}
              onChange={(event) => update({ levelUpMessage: event.target.value || null })}
              data-testid="input-level-up-message"
            />
            <p className="text-xs text-muted-foreground">
              Vacío = el predeterminado. Puedes usar {LEVEL_UP_PLACEHOLDERS.map((p) => <code key={p} className="mr-1">{p}</code>)}
              ({"{premio}"} son las monedas y boletos, si la economía está activada). Los avisos se apagan arriba, en "Anunciar subidas de nivel".
            </p>
          </div>

          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-foreground">Roles por nivel ({draft.levelRoleRewards.length}/{TUNING_LIMITS.levelRolesMax})</h3>
                <p className="text-xs text-muted-foreground">
                  Al llegar al nivel, el bot da el rol (quien ya lo pasó lo recibe la próxima vez que suba). El rol del bot tiene que estar por encima de estos roles.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={draft.levelRoleRewards.length >= TUNING_LIMITS.levelRolesMax}
                onClick={() => update({ levelRoleRewards: [...draft.levelRoleRewards, { level: nextFreeLevel(draft.levelRoleRewards), roleId: "" }] })}
                data-testid="button-add-level-role"
              >
                <Plus />
                Agregar
              </Button>
            </div>
            {draft.levelRoleRewards.length === 0 ? (
              <p className="text-sm text-muted-foreground">Todavía no hay roles por nivel.</p>
            ) : (
              <ul className="space-y-2" data-testid="list-level-roles">
                {draft.levelRoleRewards.map((rule, index) => (
                  <li key={index} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
                    <Label htmlFor={`level-role-level-${index}`} className="text-sm">Nivel</Label>
                    <Input
                      id={`level-role-level-${index}`}
                      inputMode="numeric"
                      className="w-20"
                      value={String(rule.level)}
                      onChange={(event) => {
                        const level = Number(event.target.value.replace(/\D/g, ""));
                        updateRule(index, { level: Math.min(level, TUNING_LIMITS.maxLevel) });
                      }}
                    />
                    <div className="min-w-[12rem] flex-1">
                      <RoleSelect
                        id={`level-role-${index}`}
                        value={rule.roleId || null}
                        onChange={(roleId) => updateRule(index, { roleId: roleId ?? "" })}
                        roles={roles}
                        noneLabel="Elige un rol"
                      />
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => update({ levelRoleRewards: draft.levelRoleRewards.filter((_, i) => i !== index) })}
                      aria-label={`Quitar el rol del nivel ${rule.level}`}
                    >
                      <Trash2 />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            <SwitchSetting
              id="level-role-stack"
              label="Conservar los roles de niveles anteriores"
              description="Si lo apagas, al ganar un rol nuevo el bot quita los de niveles más bajos (solo queda el más alto)."
              checked={draft.levelRoleStack}
              onChange={(levelRoleStack) => update({ levelRoleStack })}
            />
          </div>

          <SettingsGroup title="Prestigio" description="Con /prestige se vuelve al nivel 1 a cambio de más XP para siempre.">
            <NumberSetting field="prestigeMinLevel" value={draft.prestigeMinLevel} onChange={(prestigeMinLevel) => update({ prestigeMinLevel })} />
            <NumberSetting field="prestigeBonusPercent" value={draft.prestigeBonusPercent} onChange={(prestigeBonusPercent) => update({ prestigeBonusPercent })} suffix="% por prestigio" />
            <NumberSetting
              field="prestigeMaxBonus"
              value={draft.prestigeMaxBonus}
              onChange={(prestigeMaxBonus) => update({ prestigeMaxBonus })}
              suffix="prestigios"
              hint={`Bono máximo: +${draft.prestigeBonusPercent * draft.prestigeMaxBonus} %.`}
            />
          </SettingsGroup>
        </CardContent>
      </Card>

      {editor.error && <Alert variant="destructive" role="alert"><AlertDescription>{editor.error}</AlertDescription></Alert>}
      {editor.changed.length > 0 && (
        blocked ? (
          <Alert><AlertDescription>{blocked}</AlertDescription></Alert>
        ) : (
          <SaveBar
            sections={["Reglas de XP"]}
            saving={editor.saving}
            onSave={() => {
              if (draft.levelRoleRewards.some((rule) => !rule.roleId || rule.level < 2)) {
                editor.setError("Cada rol por nivel necesita un nivel (desde el 2) y un rol. Completa o quita los que faltan.");
                return;
              }
              editor.save();
            }}
            onDiscard={editor.discard}
          />
        )
      )}
    </div>
  );
}
