import { and, eq, gte, gt, or, sql } from 'drizzle-orm';
import { db } from '../../db';
import { userEconomy, userLevels } from '@shared/schema';
import { DEFAULT_TUNING, MAX_TOTAL_XP, levelUpCoins, prestigeMultiplierFor, type GuildTuning } from '@shared/tuning';

// ===== Curva de niveles =====
// Pasar del nivel N-1 al N cuesta floor(100 × 1.1^(N-2)) XP (la misma fórmula que usa storage.updateUserXP)

// Los valores (XP por mensaje, prestigio, premio por nivel…) se ajustan por servidor en el panel:
// ver shared/tuning.ts. Sin ajustes guardados se usan los de DEFAULT_TUNING.

// Premio por subir a `level`. Si de una sola vez se pasó de `fromLevel` a `level` (mucha XP de golpe),
// suma el premio de cada nivel intermedio.
export function levelUpReward(level: number, tuning: GuildTuning = DEFAULT_TUNING, fromLevel = level - 1): { coins: number; tickets: number } {
  let coins = 0;
  let tickets = 0;
  for (let reached = Math.max(fromLevel + 1, 2); reached <= level; reached++) {
    coins += levelUpCoins(tuning, reached);
    tickets += Math.floor(reached / 5) + 1;
  }
  return { coins, tickets };
}

/** XP al azar de un mensaje premiado, antes de multiplicadores. */
export function randomMessageXp(tuning: GuildTuning = DEFAULT_TUNING): number {
  return Math.floor(Math.random() * (tuning.xpMax - tuning.xpMin + 1)) + tuning.xpMin;
}

export type LevelRow = typeof userLevels.$inferSelect;

// XP para subir del nivel anterior a `level`
export function xpForLevelStep(level: number): number {
  if (level <= 1) return 0;
  return Math.floor(100 * Math.pow(1.1, level - 2));
}

// XP total acumulada que hace falta para llegar a `level`
export function xpToReachLevel(level: number): number {
  let total = 0;
  for (let i = 2; i <= level; i++) total += xpForLevelStep(i);
  return total;
}

export function levelFromTotalXp(totalXp: number): number {
  let level = 1;
  let required = 0;
  while (true) {
    const next = required + xpForLevelStep(level + 1);
    if (next > totalXp) return level;
    required = next;
    level++;
  }
}

export function prestigeMultiplier(prestigeLevel: number, tuning: GuildTuning = DEFAULT_TUNING): number {
  return prestigeMultiplierFor(tuning, prestigeLevel);
}

export { formatMultiplier } from '@shared/tuning';

export interface LevelProgress {
  level: number;
  totalXp: number;
  intoLevel: number;   // XP ganada dentro del nivel actual
  levelSize: number;   // XP que pide el nivel actual
  remaining: number;   // XP que falta para el siguiente
}

export function levelProgress(totalXp: number): LevelProgress {
  const level = levelFromTotalXp(totalXp);
  const start = xpToReachLevel(level);
  const levelSize = xpForLevelStep(level + 1);
  return {
    level,
    totalXp,
    intoLevel: totalXp - start,
    levelSize,
    remaining: Math.max(start + levelSize - totalXp, 0),
  };
}

export function rowTotalXp(row: Pick<LevelRow, 'totalXp' | 'xp'> | undefined): number {
  return row ? (row.totalXp || row.xp || 0) : 0;
}

function levelWhere(guildId: string, userId: string) {
  return and(eq(userLevels.guildId, guildId), eq(userLevels.userId, userId));
}

export async function getLevelRow(guildId: string, userId: string): Promise<LevelRow | undefined> {
  const [row] = await db
    .select()
    .from(userLevels)
    .where(levelWhere(guildId, userId))
    .orderBy(userLevels.id)
    .limit(1);
  return row;
}

// ===== XP por mensajes =====

// Suma XP de forma atómica (bloquea la fila) y recalcula el nivel.
// Requiere que el usuario y el servidor ya existan en la base de datos.
export async function awardXp(guildId: string, userId: string, gain: number): Promise<{ previousLevel: number; level: number; totalXp: number }> {
  const xp = Math.max(0, Math.floor(gain));
  return db.transaction(async (tx) => {
    const select = () => tx
      .select()
      .from(userLevels)
      .where(levelWhere(guildId, userId))
      .orderBy(userLevels.id)
      .limit(1)
      .for('update');

    let [row] = await select();
    if (!row) {
      // Sin índice único: un candado consultivo evita crear la fila dos veces
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`lvl:${guildId}:${userId}`}))`);
      [row] = await select();
    }

    const now = new Date();
    if (!row) {
      const totalXp = Math.min(xp, MAX_TOTAL_XP);
      const level = levelFromTotalXp(totalXp);
      await tx.insert(userLevels).values({ userId, guildId, xp: totalXp, totalXp, level, lastMessageAt: now });
      return { previousLevel: 1, level, totalXp };
    }

    const previousLevel = row.level ?? 1;
    const totalXp = Math.min(rowTotalXp(row) + xp, MAX_TOTAL_XP);
    const level = levelFromTotalXp(totalXp);
    await tx
      .update(userLevels)
      .set({ xp: totalXp, totalXp, level, lastMessageAt: now })
      .where(eq(userLevels.id, row.id));
    return { previousLevel, level, totalXp };
  });
}

// ===== Prestigio =====

export type PrestigeResult = { ok: true; prestigeLevel: number } | { ok: false };

// Vuelve al nivel 1 con 0 XP y suma un prestigio, todo en una transacción.
// El UPDATE condicional (nivel >= minLevel) hace que un doble clic no pueda prestigiar dos veces.
// Requiere que exista la cuenta económica (ensureAccount).
export async function applyPrestige(guildId: string, userId: string, minLevel = DEFAULT_TUNING.prestigeMinLevel): Promise<PrestigeResult> {
  return db.transaction(async (tx) => {
    const reset = await tx
      .update(userLevels)
      .set({ level: 1, xp: 0, totalXp: 0 })
      .where(and(levelWhere(guildId, userId), gte(userLevels.level, minLevel)))
      .returning({ id: userLevels.id });
    if (reset.length === 0) return { ok: false as const };

    const [account] = await tx
      .select({ id: userEconomy.id })
      .from(userEconomy)
      .where(and(eq(userEconomy.guildId, guildId), eq(userEconomy.userId, userId)))
      .orderBy(userEconomy.id)
      .limit(1)
      .for('update');
    if (!account) throw new Error(`applyPrestige: falta la cuenta económica ${guildId}:${userId}`);

    const [updated] = await tx
      .update(userEconomy)
      .set({ prestigeLevel: sql`COALESCE(${userEconomy.prestigeLevel}, 0) + 1` })
      .where(eq(userEconomy.id, account.id))
      .returning({ prestigeLevel: userEconomy.prestigeLevel });

    return { ok: true as const, prestigeLevel: updated?.prestigeLevel ?? 1 };
  });
}

// ===== Ranking =====

// Posición en el ranking de niveles (mismo orden que el top: nivel y luego XP). null si no tiene XP.
export async function getLevelRank(guildId: string, userId: string): Promise<number | null> {
  const row = await getLevelRow(guildId, userId);
  if (!row) return null;
  const level = row.level ?? 1;
  const xp = row.xp ?? 0;
  const [result] = await db
    .select({ ahead: sql<string>`COUNT(DISTINCT ${userLevels.userId})` })
    .from(userLevels)
    .where(and(
      eq(userLevels.guildId, guildId),
      or(gt(userLevels.level, level), and(eq(userLevels.level, level), gt(userLevels.xp, xp)))
    ));
  return Number(result?.ahead ?? 0) + 1;
}
