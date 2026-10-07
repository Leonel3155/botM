import type { ReactNode } from "react";
import { BookOpen } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CommandList, type BotCommandInfo } from "./command-list";
import { formatCoins, formatNumber } from "./format";
import {
  MESSAGE_XP_MAX,
  MESSAGE_XP_MIN,
  PRESTIGE_MAX_BONUS_LEVELS,
  PRESTIGE_MIN_LEVEL,
  PRESTIGE_XP_BONUS,
  levelUpReward,
  prestigeMultiplier,
  xpForLevelStep,
  xpToReachLevel,
} from "./level-math";

const LEVEL_EXAMPLES = [2, 5, 10, 25, 50, PRESTIGE_MIN_LEVEL];

/** Comandos de niveles (server/bot/commands/level.ts, prestige.ts y prefix.ts). */
const LEVEL_COMMANDS: BotCommandInfo[] = [
  {
    name: "level",
    args: "[usuario]",
    description: "Nivel, XP total, puesto en el ranking y cuánto falta para el siguiente nivel. También existe /lv.",
    prefixAliases: ["lv", "rank"],
  },
  {
    name: "lb",
    args: "[límite]",
    description: "Ranking de niveles del servidor (hasta 25 personas).",
    prefixAliases: ["lb"],
  },
  { name: "xpinfo", description: "Explica cómo se gana XP y cuánto pide cada nivel." },
  { name: "levelrewards", description: "Muestra los premios por subir de nivel." },
  {
    name: "prestige",
    description: `Desde el nivel ${PRESTIGE_MIN_LEVEL}: vuelve al nivel 1 a cambio de más XP por mensaje. Pide confirmación antes.`,
  },
];

function RuleSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

function Rules({ items }: { items: ReactNode[] }) {
  return (
    <ul className="list-disc space-y-1.5 pl-5 text-sm text-foreground marker:text-primary">
      {items.map((item, index) => (
        <li key={index}>{item}</li>
      ))}
    </ul>
  );
}

/**
 * Reglas del XP tal como las aplica el bot (server/bot/events/index.ts y services/levels.ts).
 * `economyEnabled` null = todavía no se sabe.
 */
export function XpRulesCard({ prefix, economyEnabled }: { prefix: string; economyEnabled: boolean | null }) {
  const maxBonusPercent = Math.round(PRESTIGE_XP_BONUS * PRESTIGE_MAX_BONUS_LEVELS * 100);
  const reward10 = levelUpReward(10);
  const maxMultiplier = prestigeMultiplier(PRESTIGE_MAX_BONUS_LEVELS).toFixed(0);

  return (
    <Card>
      <CardHeader className="p-4 sm:p-6">
        <CardTitle className="flex items-center gap-2 text-lg">
          <BookOpen className="h-5 w-5 text-primary" aria-hidden="true" />
          Cómo funcionan los niveles
        </CardTitle>
        <CardDescription>Estas son las reglas exactas que usa el bot. El XP siempre está activo.</CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-8 p-4 pt-0 sm:p-6 sm:pt-0 lg:grid-cols-2">
        <div className="space-y-6">
          <RuleSection title="Cómo se gana XP">
            <Rules
              items={[
                <>
                  Cada mensaje da entre <strong>{MESSAGE_XP_MIN}</strong> y <strong>{MESSAGE_XP_MAX} XP</strong> al azar.
                </>,
                <>
                  Solo cuenta <strong>un mensaje por minuto</strong> por persona: escribir muchos seguidos no da más XP.
                </>,
                "Los bots no ganan XP.",
                "Cada nivel pide un 10 % más de XP que el anterior.",
              ]}
            />
          </RuleSection>

          <RuleSection title="Prestigio">
            <Rules
              items={[
                <>
                  Al llegar al nivel <strong>{PRESTIGE_MIN_LEVEL}</strong>, cada persona puede usar{" "}
                  <code className="font-mono text-primary">/prestige</code>: vuelve al nivel 1 con 0 XP, pero conserva sus
                  monedas y boletos.
                </>,
                <>
                  Cada prestigio da <strong>+{Math.round(PRESTIGE_XP_BONUS * 100)} %</strong> de XP por mensaje, hasta{" "}
                  <strong>+{maxBonusPercent} % (x{maxMultiplier})</strong> con {PRESTIGE_MAX_BONUS_LEVELS} prestigios.
                </>,
              ]}
            />
          </RuleSection>

          <RuleSection title="Premios al subir de nivel">
            <Rules
              items={[
                <>
                  Nivel² × 50 monedas y (nivel ÷ 5) + 1 boletos. Por ejemplo, al llegar al nivel 10 recibe{" "}
                  {formatCoins(reward10.coins)} y {reward10.tickets} boletos.
                </>,
                "Además, cada mensaje que da XP también da unas monedas (más cuanto más alto el nivel).",
              ]}
            />
            {economyEnabled === false && (
              <p className="text-xs text-status-warning">
                Ahora la economía está desactivada: solo se gana XP, sin monedas ni boletos.
              </p>
            )}
          </RuleSection>
        </div>

        <div className="space-y-6">
          <RuleSection title="XP que pide cada nivel">
            <div className="overflow-hidden rounded-lg border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Para llegar al</TableHead>
                    <TableHead className="text-right">XP de ese nivel</TableHead>
                    <TableHead className="text-right">XP total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {LEVEL_EXAMPLES.map((level) => (
                    <TableRow key={level}>
                      <TableCell className="font-medium">Nivel {level}</TableCell>
                      <TableCell className="text-right font-mono">{formatNumber(xpForLevelStep(level))}</TableCell>
                      <TableCell className="text-right font-mono">{formatNumber(xpToReachLevel(level))}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </RuleSection>

          <RuleSection title="Comandos en Discord">
            <CommandList commands={LEVEL_COMMANDS} prefix={prefix} />
          </RuleSection>
        </div>
      </CardContent>
    </Card>
  );
}
