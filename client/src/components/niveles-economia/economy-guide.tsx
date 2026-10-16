import type { ReactNode } from "react";
import { Briefcase, Dices, HandCoins, Landmark, ShieldCheck, Sparkles, type LucideIcon } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CommandList, type BotCommandInfo } from "./command-list";
import { formatCoins } from "./format";
import { formatWaitMinutes, formatWaitSeconds, type GuildTuning } from "@shared/tuning";
import { levelUpReward, messageCoinRange } from "./level-math";

// Los montos y esperas son ajustes de cada servidor (shared/tuning.ts); los textos se arman con ellos.

/** "1 hora", "2 horas", "90 minutos"… */
export const formatMinutes = formatWaitMinutes;

const n = (value: number) => value.toLocaleString("es-MX");

interface CommandGroup {
  id: string;
  title: string;
  icon: LucideIcon;
  note?: string;
  commands: BotCommandInfo[];
}

const commandGroups = (t: GuildTuning): CommandGroup[] => [
  {
    id: "ganar",
    title: "Ganar monedas",
    icon: Briefcase,
    commands: [
      {
        name: "daily",
        description: `Recompensa diaria: ${n(t.dailyBase)} monedas + ${n(t.dailyPerLevel)} por cada nivel, más ${t.dailyStreakStepPercent} % por cada día de racha (hasta +${t.dailyStreakStepPercent * t.dailyStreakMaxDays} %). Una vez cada ${formatMinutes(t.dailyCooldownHours * 60)}; si pasa el doble de tiempo, la racha empieza de nuevo.`,
        prefixAliases: ["daily"],
      },
      {
        name: "work",
        args: "[trabajo]",
        description: `Trabajar una vez cada ${formatMinutes(t.workCooldownMinutes)}: de ${n(Math.floor(50 * t.workPayPercent / 100))} a ${n(Math.floor(500 * t.workPayPercent / 100))} monedas según el trabajo (constructor, oficinista, repartidor, programador o artista).`,
      },
      {
        name: "crime",
        description: t.crimeEnabled
          ? `Arriesga el ${t.crimeRiskPercent} % de la cartera: ${t.crimeSuccessPercent} % de probabilidad de ganar esa cantidad; si no, la pierde. Cada ${formatMinutes(t.crimeCooldownMinutes)}.`
          : "Desactivado en este servidor.",
      },
      {
        name: "slut",
        description: t.slutEnabled
          ? `Trabajo nocturno arriesgado: ${t.slutSuccessPercent} % de ganar entre 200 y 1,000 monedas; si sale mal, pierde el 10 % de la cartera (máximo 300). Cada ${formatMinutes(t.slutCooldownMinutes)}.`
          : "Desactivado en este servidor.",
      },
      {
        name: "rob",
        args: "<usuario>",
        description: t.robEnabled
          ? `Intenta robar de la cartera de alguien, cada ${formatMinutes(t.robCooldownMinutes)}. Sale bien ${t.robSuccessPercent} % de las veces y se lleva desde 50 hasta el 10 % de lo que trae la otra persona (máximo 1,000); si falla, paga una multa del ${t.robFinePercent} % de su cartera. Ambos necesitan al menos ${n(t.robMinWallet)} monedas en la cartera.`
          : "Desactivado en este servidor: nadie puede robar.",
      },
    ],
  },
  {
    id: "banco",
    title: "Saldo, banco y regalos",
    icon: Landmark,
    commands: [
      { name: "balance", args: "[usuario]", description: "Muestra la cartera, el banco y el total.", prefixAliases: ["bal"] },
      {
        name: "deposit",
        args: "<cantidad|todo>",
        description: "Guarda monedas en el banco, donde nadie las puede robar ni se pueden apostar.",
        prefixAliases: ["dep"],
      },
      {
        name: "withdraw",
        args: "<cantidad|todo>",
        description: "Saca monedas del banco a la cartera.",
        prefixAliases: ["with"],
      },
      { name: "give", args: "<usuario> <cantidad>", description: "Regala monedas de la cartera a otra persona." },
      { name: "leaderboard", args: "[límite]", description: "Ranking de monedas (cartera + banco), hasta 25 personas." },
      { name: "economy-stats", description: "Cuántas cuentas hay y cuántas monedas hay en carteras y en bancos." },
      {
        name: "lot",
        kind: "prefix",
        description: "Muestra cuántos boletos tiene. Por ahora solo se acumulan: el bot todavía no hace sorteos.",
      },
    ],
  },
  {
    id: "azar",
    title: "Juegos de azar",
    icon: Dices,
    note: t.gamblingEnabled
      ? `Solo se apuesta lo que hay en la cartera; lo del banco está a salvo. Apuesta mínima: ${n(t.minBet)}${t.maxBet > 0 ? `, máxima: ${n(t.maxBet)}` : ""}.`
      : "Los juegos de azar están desactivados en este servidor.",
    commands: [
      {
        name: "blackjack",
        args: "<cantidad|todo>",
        description: "Blackjack contra el bot: ganar paga 1 a 1 y el blackjack natural paga 3 a 2.",
      },
      {
        name: "slots",
        args: "<cantidad>",
        description:
          "Tragamonedas: tres símbolos iguales pagan de 3 a 15 veces la apuesta; un par de estrellas o diamantes paga 1.5 o 2 veces, y los demás pares devuelven la apuesta.",
      },
      {
        name: "ruleta",
        args: "<apuesta> <cantidad>",
        description: "Ruleta europea: a un número del 0 al 36 paga 36 veces; a rojo, negro, par o impar paga el doble.",
      },
      {
        name: "dado",
        args: "[cantidad]",
        description: "Si sale 6, recibe 6 veces lo apostado. Sin cantidad, solo tira el dado por diversión.",
      },
      {
        name: "ruleta-rusa",
        args: "[cámaras]",
        description:
          `Apuesta TODA la cartera (mínimo ${n(Math.max(100, t.minBet))}). Con más cámaras es más seguro pero se gana menos: con 6 cámaras sobrevive 5 de cada 6 veces y gana una quinta parte de lo apostado.`,
      },
    ],
  },
  {
    id: "admins",
    title: "Para administradores",
    icon: ShieldCheck,
    note: "Solo los puede usar quien tiene el permiso de Administrador.",
    commands: [
      { name: "add-money", args: "<usuario> <cantidad>", description: "Da monedas a alguien." },
      { name: "remove-money", args: "<usuario> <cantidad|todo>", description: "Quita monedas de la cartera de alguien." },
      { name: "reset-money", args: "<usuario>", description: "Deja en cero la cartera y el banco de alguien." },
      { name: "add-money-role", args: "<rol> <cantidad>", description: "Da monedas a todas las personas con un rol." },
    ],
  },
];

/** Todos los comandos de economía y apuestas, agrupados. */
export function EconomyCommandsCard({ prefix, economyEnabled, tuning }: { prefix: string; economyEnabled: boolean | null; tuning: GuildTuning }) {
  return (
    <Card>
      <CardHeader className="p-4 sm:p-6">
        <CardTitle className="text-lg">Comandos de economía</CardTitle>
        <CardDescription>
          Lo que la gente puede hacer con sus monedas en Discord.
          {economyEnabled === false && (
            <span className="mt-1 block text-status-warning">
              Con la economía desactivada, todos estos comandos responden que está apagada.
            </span>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-4 p-4 pt-0 sm:p-6 sm:pt-0 md:grid-cols-2">
        {commandGroups(tuning).map((group) => (
          <section
            key={group.id}
            className="space-y-3 rounded-lg border border-border bg-background/40 p-4"
            aria-labelledby={`commands-${group.id}`}
          >
            <div className="space-y-1">
              <h3 id={`commands-${group.id}`} className="flex items-center gap-2 font-semibold text-foreground">
                <group.icon className="h-4 w-4 text-primary" aria-hidden="true" />
                {group.title}
              </h3>
              {group.note && <p className="text-xs text-muted-foreground">{group.note}</p>}
            </div>
            <CommandList commands={group.commands} prefix={prefix} />
          </section>
        ))}
      </CardContent>
    </Card>
  );
}

function EarnItem({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10">
        <Icon className="h-4 w-4 text-primary" aria-hidden="true" />
      </div>
      <div className="min-w-0 space-y-0.5">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="text-sm text-muted-foreground">{children}</p>
      </div>
    </li>
  );
}

/** De dónde salen las monedas, según el código del bot. */
export function HowCoinsWorkCard({ economyEnabled, tuning }: { economyEnabled: boolean | null; tuning: GuildTuning }) {
  const coins10 = messageCoinRange(10, tuning);
  const reward10 = levelUpReward(10, tuning);
  const luckyPercent = tuning.luckyChancePercent.toLocaleString("es-MX");
  const cooldown = formatWaitSeconds(tuning.xpCooldownSeconds);

  return (
    <Card className="h-full">
      <CardHeader className="p-4 sm:p-6">
        <CardTitle className="flex items-center gap-2 text-lg">
          <HandCoins className="h-5 w-5 text-primary" aria-hidden="true" />
          De dónde salen las monedas
        </CardTitle>
        <CardDescription>
          {economyEnabled === false ? (
            <span className="block text-status-warning">
              Con la economía desactivada, el bot no reparte monedas: esto es lo que hará cuando la vuelvas a activar.
            </span>
          ) : (
            "Así reparte el bot, sin que tengas que hacer nada."
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="p-4 pt-0 sm:p-6 sm:pt-0">
        <ul className="space-y-4">
          <EarnItem icon={HandCoins} title="Platicando">
            Cada mensaje que da XP (uno cada {cooldown}) también da monedas según el nivel: alguien de nivel 10 gana entre{" "}
            {coins10.min} y {coins10.max}. Además, 1 boleto (a veces 2).
          </EarnItem>
          <EarnItem icon={Sparkles} title="Golpe de suerte">
            Cada mensaje premiado tiene un {luckyPercent} % de probabilidad de dar {formatCoins(tuning.luckyCoins)} extra.
          </EarnItem>
          <EarnItem icon={Landmark} title="Al subir de nivel">
            Nivel² × {tuning.levelUpCoinsFactor} monedas: al llegar al nivel 10 son {formatCoins(reward10.coins)}.
          </EarnItem>
          <EarnItem icon={Briefcase} title="Con comandos">
            <code className="font-mono text-primary">/daily</code> una vez cada {formatMinutes(tuning.dailyCooldownHours * 60)} y{" "}
            <code className="font-mono text-primary">/work</code> una vez cada {formatMinutes(tuning.workCooldownMinutes)}.
          </EarnItem>
        </ul>
      </CardContent>
    </Card>
  );
}
