import type { WealthEntry } from "@shared/api";
import { formatCoins, formatCompact, formatNumber } from "./format";
import { RankBadge, UserAvatar, displayUserName } from "./ranking-parts";

function WealthRow({ entry }: { entry: WealthEntry }) {
  const name = displayUserName(entry.username);
  const bankShare = entry.total > 0 ? Math.min(Math.max((entry.bank / entry.total) * 100, 0), 100) : 0;

  return (
    <li className="flex items-center gap-3 py-3" data-testid={`row-wealth-${entry.rank}`}>
      <RankBadge rank={entry.rank} />
      <UserAvatar userId={entry.userId} avatar={entry.avatar} name={name} />
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <p className="truncate font-medium text-foreground" title={entry.username ? name : `ID ${entry.userId}`}>
            {name}
          </p>
          <p className="shrink-0 font-mono text-sm font-semibold text-primary" title={formatCoins(entry.total)}>
            {formatCompact(entry.total)}
            <span className="sr-only"> monedas en total</span>
          </p>
        </div>
        {/* Parte guardada en el banco (no se puede robar ni apostar) frente a la cartera */}
        <div className="flex h-1.5 overflow-hidden rounded-full bg-secondary" aria-hidden="true">
          <div className="h-full bg-primary/50" style={{ width: `${100 - bankShare}%` }} />
          <div className="h-full bg-primary" style={{ width: `${bankShare}%` }} />
        </div>
        <p className="flex flex-wrap justify-between gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 shrink-0 rounded-full bg-primary/50" aria-hidden="true" />
            Cartera <span className="font-mono text-foreground">{formatNumber(entry.wallet)}</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 shrink-0 rounded-full bg-primary" aria-hidden="true" />
            Banco <span className="font-mono text-foreground">{formatNumber(entry.bank)}</span>
          </span>
        </p>
      </div>
    </li>
  );
}

/** Ranking de monedas (cartera + banco), igual que /leaderboard en Discord. */
export function WealthLeaderboard({ entries }: { entries: WealthEntry[] }) {
  return (
    <ol className="divide-y divide-border" aria-label="Ranking de monedas" data-testid="list-wealth-ranking">
      {/* La tabla no impide filas repetidas de una persona: el puesto (único) va en la clave */}
      {entries.map((entry) => (
        <WealthRow key={`${entry.rank}-${entry.userId}`} entry={entry} />
      ))}
    </ol>
  );
}
