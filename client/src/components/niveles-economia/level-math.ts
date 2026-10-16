/**
 * Curva de niveles del bot (igual que server/bot/services/levels.ts). Los demás valores (XP por mensaje,
 * prestigio, premios…) son ajustes de cada servidor: vienen de GET /api/guilds/:id/tuning (shared/tuning.ts).
 */
import { levelUpCoins, prestigeMultiplierFor, type GuildTuning } from "@shared/tuning";

/** XP para subir del nivel anterior a `level`: floor(100 × 1.1^(nivel − 2)). */
export function xpForLevelStep(level: number): number {
  if (level <= 1) return 0;
  return Math.floor(100 * Math.pow(1.1, level - 2));
}

/** XP total acumulada que hace falta para llegar a `level`. */
export function xpToReachLevel(level: number): number {
  let total = 0;
  for (let i = 2; i <= level; i++) total += xpForLevelStep(i);
  return total;
}

// Tope de seguridad: con XP absurda (o Infinity) el bucle nunca terminaría.
// La columna del bot topa en 2.000 millones de XP, que es ~nivel 150.
const MAX_LEVEL_SCAN = 1_000;

/** Nivel que corresponde a una XP total (null si el dato no es un número válido). */
export function levelFromTotalXp(totalXp: number): number | null {
  if (!Number.isFinite(totalXp) || totalXp < 0) return null;
  let level = 1;
  let required = 0;
  while (level < MAX_LEVEL_SCAN) {
    const next = required + xpForLevelStep(level + 1);
    if (next > totalXp) return level;
    required = next;
    level++;
  }
  return null;
}

export interface LevelProgress {
  level: number;
  /** XP ganada dentro del nivel actual. */
  intoLevel: number;
  /** XP que pide el nivel actual para pasar al siguiente. */
  levelSize: number;
  /** XP que falta para el siguiente nivel. */
  remaining: number;
  /** 0-100 */
  percent: number;
}

/** Progreso dentro del nivel, igual que el que muestra /level en Discord. */
export function levelProgress(totalXp: number): LevelProgress | null {
  const level = levelFromTotalXp(totalXp);
  if (level === null) return null;
  const start = xpToReachLevel(level);
  const levelSize = xpForLevelStep(level + 1);
  const intoLevel = totalXp - start;
  return {
    level,
    intoLevel,
    levelSize,
    remaining: Math.max(start + levelSize - totalXp, 0),
    percent: levelSize > 0 ? Math.min(Math.max((intoLevel / levelSize) * 100, 0), 100) : 0,
  };
}

/** Multiplicador de XP según los prestigios. */
export function prestigeMultiplier(prestigeLevel: number, tuning: GuildTuning): number {
  return prestigeMultiplierFor(tuning, prestigeLevel);
}

/** Premio por subir a `level` (solo si la economía está activada). */
export function levelUpReward(level: number, tuning: GuildTuning): { coins: number; tickets: number } {
  return { coins: levelUpCoins(tuning, level), tickets: Math.floor(level / 5) + 1 };
}

/** Monedas por mensaje premiado según el nivel: entre nivel y 4 × nivel − 1, escalado por el ajuste del servidor. */
export function messageCoinRange(level: number, tuning: GuildTuning): { min: number; max: number } {
  const scale = tuning.messageCoinsPercent / 100;
  return { min: Math.floor(level * scale), max: Math.floor((level * 4 - 1) * scale) };
}
