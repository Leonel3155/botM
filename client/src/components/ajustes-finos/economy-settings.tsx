import { Dices, SlidersHorizontal } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { SaveBar } from "@/components/comunidad/save-bar";
import { NumberSetting, SettingsGroup, SwitchSetting, useTuningDraft } from "./shared";

const FIELDS = [
  "startingBalance",
  "messageCoinsPercent",
  "levelUpCoinsFactor",
  "luckyChancePercent",
  "luckyCoins",
  "dailyBase",
  "dailyPerLevel",
  "dailyCooldownHours",
  "dailyStreakStepPercent",
  "dailyStreakMaxDays",
  "workCooldownMinutes",
  "workPayPercent",
  "crimeEnabled",
  "crimeCooldownMinutes",
  "crimeSuccessPercent",
  "crimeRiskPercent",
  "slutEnabled",
  "slutCooldownMinutes",
  "slutSuccessPercent",
  "robEnabled",
  "robCooldownMinutes",
  "robSuccessPercent",
  "robFinePercent",
  "robMinWallet",
  "gamblingEnabled",
  "minBet",
  "maxBet",
] as const;

/** Montos, esperas y probabilidades de la economía y los juegos. */
export function EconomySettings({ guildId, blocked }: { guildId: string; blocked: string | null }) {
  const editor = useTuningDraft(guildId, FIELDS);
  const { draft, update } = editor;

  if (!draft) {
    return editor.query.isError ? (
      <Alert variant="destructive"><AlertDescription>No se pudieron cargar los ajustes de la economía. Recarga la página.</AlertDescription></Alert>
    ) : (
      <Skeleton className="h-64 w-full rounded-xl" />
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="p-4 sm:p-6">
          <CardTitle className="flex items-center gap-2 text-lg">
            <SlidersHorizontal className="h-5 w-5 text-primary" aria-hidden="true" />
            Reglas de la economía
          </CardTitle>
          <CardDescription>Cuántas monedas da cada cosa y cada cuánto se puede usar. Lo que ya tiene la gente no cambia.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6 p-4 pt-0 sm:p-6 sm:pt-0">
          <SettingsGroup title="Al platicar y subir de nivel">
            <NumberSetting
              field="messageCoinsPercent"
              value={draft.messageCoinsPercent}
              onChange={(messageCoinsPercent) => update({ messageCoinsPercent })}
              suffix="%"
              hint="Cada mensaje premiado da entre nivel y 4 × nivel monedas; esto lo escala (0 % = platicar no da monedas)."
            />
            <NumberSetting
              field="levelUpCoinsFactor"
              value={draft.levelUpCoinsFactor}
              onChange={(levelUpCoinsFactor) => update({ levelUpCoinsFactor })}
              suffix="× nivel²"
              hint={`Al llegar al nivel 10 se ganan ${(100 * draft.levelUpCoinsFactor).toLocaleString("es-MX")} monedas.`}
            />
            <NumberSetting field="luckyChancePercent" value={draft.luckyChancePercent} onChange={(luckyChancePercent) => update({ luckyChancePercent })} suffix="% por mensaje" />
            <NumberSetting field="luckyCoins" value={draft.luckyCoins} onChange={(luckyCoins) => update({ luckyCoins })} suffix="monedas" />
            <NumberSetting
              field="startingBalance"
              value={draft.startingBalance}
              onChange={(startingBalance) => update({ startingBalance })}
              suffix="monedas"
              hint="Para las cuentas que se creen desde ahora."
            />
          </SettingsGroup>

          <SettingsGroup title="/daily" description="La racha sube si se cobra antes de que pase el doble de la espera.">
            <NumberSetting field="dailyBase" value={draft.dailyBase} onChange={(dailyBase) => update({ dailyBase })} suffix="monedas" />
            <NumberSetting field="dailyPerLevel" value={draft.dailyPerLevel} onChange={(dailyPerLevel) => update({ dailyPerLevel })} suffix="monedas por nivel" />
            <NumberSetting field="dailyCooldownHours" value={draft.dailyCooldownHours} onChange={(dailyCooldownHours) => update({ dailyCooldownHours })} suffix="horas" />
            <NumberSetting field="dailyStreakStepPercent" value={draft.dailyStreakStepPercent} onChange={(dailyStreakStepPercent) => update({ dailyStreakStepPercent })} suffix="% por día" />
            <NumberSetting
              field="dailyStreakMaxDays"
              value={draft.dailyStreakMaxDays}
              onChange={(dailyStreakMaxDays) => update({ dailyStreakMaxDays })}
              suffix="días"
              hint={`Bono máximo: +${draft.dailyStreakStepPercent * draft.dailyStreakMaxDays} %.`}
            />
          </SettingsGroup>

          <SettingsGroup title="/work">
            <NumberSetting field="workCooldownMinutes" value={draft.workCooldownMinutes} onChange={(workCooldownMinutes) => update({ workCooldownMinutes })} suffix="minutos" />
            <NumberSetting
              field="workPayPercent"
              value={draft.workPayPercent}
              onChange={(workPayPercent) => update({ workPayPercent })}
              suffix="%"
              hint="Escala la paga de todos los trabajos (100 % = de 50 a 500 monedas según el trabajo)."
            />
          </SettingsGroup>

          <div className="space-y-4">
            <SwitchSetting id="crime-enabled" label="/crime activado" checked={draft.crimeEnabled} onChange={(crimeEnabled) => update({ crimeEnabled })} />
            <SettingsGroup title="/crime" className={draft.crimeEnabled ? undefined : "opacity-60"}>
              <NumberSetting field="crimeCooldownMinutes" value={draft.crimeCooldownMinutes} onChange={(crimeCooldownMinutes) => update({ crimeCooldownMinutes })} suffix="minutos" />
              <NumberSetting field="crimeSuccessPercent" value={draft.crimeSuccessPercent} onChange={(crimeSuccessPercent) => update({ crimeSuccessPercent })} suffix="%" />
              <NumberSetting
                field="crimeRiskPercent"
                value={draft.crimeRiskPercent}
                onChange={(crimeRiskPercent) => update({ crimeRiskPercent })}
                suffix="% de la cartera"
                hint="Lo que se gana si sale bien o se pierde si sale mal."
              />
            </SettingsGroup>
          </div>

          <div className="space-y-4">
            <SwitchSetting id="slut-enabled" label="/slut activado" checked={draft.slutEnabled} onChange={(slutEnabled) => update({ slutEnabled })} />
            <SettingsGroup title="/slut" className={draft.slutEnabled ? undefined : "opacity-60"}>
              <NumberSetting field="slutCooldownMinutes" value={draft.slutCooldownMinutes} onChange={(slutCooldownMinutes) => update({ slutCooldownMinutes })} suffix="minutos" />
              <NumberSetting field="slutSuccessPercent" value={draft.slutSuccessPercent} onChange={(slutSuccessPercent) => update({ slutSuccessPercent })} suffix="%" />
            </SettingsGroup>
          </div>

          <div className="space-y-4">
            <SwitchSetting
              id="rob-enabled"
              label="/rob activado"
              description="Si lo apagas, nadie puede robarle a nadie."
              checked={draft.robEnabled}
              onChange={(robEnabled) => update({ robEnabled })}
            />
            <SettingsGroup title="/rob" className={draft.robEnabled ? undefined : "opacity-60"}>
              <NumberSetting field="robCooldownMinutes" value={draft.robCooldownMinutes} onChange={(robCooldownMinutes) => update({ robCooldownMinutes })} suffix="minutos" />
              <NumberSetting field="robSuccessPercent" value={draft.robSuccessPercent} onChange={(robSuccessPercent) => update({ robSuccessPercent })} suffix="%" />
              <NumberSetting field="robFinePercent" value={draft.robFinePercent} onChange={(robFinePercent) => update({ robFinePercent })} suffix="% de su cartera" hint="Lo que paga quien roba si lo atrapan." />
              <NumberSetting field="robMinWallet" value={draft.robMinWallet} onChange={(robMinWallet) => update({ robMinWallet })} suffix="monedas" hint="Tanto quien roba como la víctima necesitan esto en la cartera." />
            </SettingsGroup>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="p-4 sm:p-6">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Dices className="h-5 w-5 text-primary" aria-hidden="true" />
            Juegos de azar
          </CardTitle>
          <CardDescription>/blackjack, /slots, /ruleta, /dado y /ruleta-rusa.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6 p-4 pt-0 sm:p-6 sm:pt-0">
          <SwitchSetting
            id="gambling-enabled"
            label="Juegos de azar activados"
            description="Si los apagas, la economía sigue funcionando pero nadie puede apostar."
            checked={draft.gamblingEnabled}
            onChange={(gamblingEnabled) => update({ gamblingEnabled })}
          />
          <SettingsGroup title="Apuestas" className={draft.gamblingEnabled ? undefined : "opacity-60"}>
            <NumberSetting field="minBet" value={draft.minBet} onChange={(minBet) => update({ minBet })} suffix="monedas" />
            <NumberSetting
              field="maxBet"
              value={draft.maxBet}
              onChange={(maxBet) => update({ maxBet })}
              suffix="monedas"
              hint="0 = sin límite. /ruleta-rusa siempre apuesta toda la cartera, así que solo respeta el mínimo."
            />
          </SettingsGroup>
        </CardContent>
      </Card>

      {editor.error && <Alert variant="destructive" role="alert"><AlertDescription>{editor.error}</AlertDescription></Alert>}
      {editor.changed.length > 0 && (
        blocked ? (
          <Alert><AlertDescription>{blocked}</AlertDescription></Alert>
        ) : (
          <SaveBar sections={["Reglas de la economía"]} saving={editor.saving} onSave={editor.save} onDiscard={editor.discard} />
        )
      )}
    </div>
  );
}
