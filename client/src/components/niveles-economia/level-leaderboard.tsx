import type { LeaderboardEntry } from "@shared/api";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { formatNumber } from "./format";
import { levelProgress } from "./level-math";
import { RankBadge, UserAvatar, displayUserName } from "./ranking-parts";

function LevelRow({ entry }: { entry: LeaderboardEntry }) {
  const name = displayUserName(entry.username);
  // El bot usa totalXp (y xp en filas viejas) para calcular el progreso
  const totalXp = entry.totalXp || entry.xp || 0;
  const progress = levelProgress(totalXp);
  // Si el nivel guardado no cuadra con la XP (datos antiguos), solo mostramos la XP total
  const showProgress = progress !== null && progress.level === entry.level;

  return (
    <li className="flex items-center gap-3 py-3" data-testid={`row-level-${entry.rank}`}>
      <RankBadge rank={entry.rank} />
      <UserAvatar userId={entry.userId} avatar={entry.avatar} name={name} />
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <p className="truncate font-medium text-foreground" title={entry.username ? name : `ID ${entry.userId}`}>
            {name}
          </p>
          <Badge variant="outline" className="shrink-0 font-mono">
            Nivel {formatNumber(entry.level)}
          </Badge>
        </div>
        {showProgress ? (
          <>
            <Progress
              value={progress.percent}
              className="h-1.5"
              aria-label={`Progreso de ${name} hacia el nivel ${entry.level + 1}`}
            />
            <p className="flex flex-wrap justify-between gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
              <span className="font-mono">
                {formatNumber(progress.intoLevel)} / {formatNumber(progress.levelSize)} XP
                <span className="font-sans"> · faltan {formatNumber(progress.remaining)}</span>
              </span>
              <span className="font-mono">{formatNumber(totalXp)} XP en total</span>
            </p>
          </>
        ) : (
          <p className="font-mono text-xs text-muted-foreground">{formatNumber(totalXp)} XP en total</p>
        )}
      </div>
    </li>
  );
}

/** Ranking de niveles con barra de progreso (misma fórmula que /level en Discord). */
export function LevelLeaderboard({ entries }: { entries: LeaderboardEntry[] }) {
  return (
    <ol className="divide-y divide-border" aria-label="Ranking de niveles" data-testid="list-level-ranking">
      {/* La tabla no impide filas repetidas de una persona: el puesto (único) va en la clave */}
      {entries.map((entry) => (
        <LevelRow key={`${entry.rank}-${entry.userId}`} entry={entry} />
      ))}
    </ol>
  );
}
