/**
 * Reglas de niveles del bot, copiadas TAL CUAL de server/bot/services/levels.ts y
 * server/bot/events/index.ts (el panel no puede importar código del bot).
 * Si cambias algo allá, cámbialo aquí también; lo ideal sería moverlas a shared/.
 */

/** XP mínima y máxima que da un mensaje premiado (antes del bono de prestigio). */
export const MESSAGE_XP_MIN = 15;
export const MESSAGE_XP_MAX = 25;
/** Solo un mensaje por persona da XP cada 60 s (XP_COOLDOWN_MS en el bot). */
export const XP_COOLDOWN_SECONDS = 60;

/** Desde este nivel se puede usar /prestige. */
export const PRESTIGE_MIN_LEVEL = 100;
/** +10 % de XP por cada prestigio… */
export const PRESTIGE_XP_BONUS = 0.1;
/** …contando como mucho 10 prestigios (x2 en total). */
export const PRESTIGE_MAX_BONUS_LEVELS = 10;

/** Probabilidad de un "golpe de suerte" por mensaje premiado y cuántas monedas da. */
export const LUCKY_CHANCE = 0.005;
export const LUCKY_COINS = 100;

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

/** Multiplicador de XP según los prestigios (x1.0 … x2.0). */
export function prestigeMultiplier(prestigeLevel: number): number {
  const levels = Math.min(Math.max(Math.floor(prestigeLevel || 0), 0), PRESTIGE_MAX_BONUS_LEVELS);
  return 1 + levels * PRESTIGE_XP_BONUS;
}

/** Premio por subir a `level` (solo si la economía está activada). */
export function levelUpReward(level: number): { coins: number; tickets: number } {
  return { coins: level * level * 50, tickets: Math.floor(level / 5) + 1 };
}

/** Monedas por mensaje premiado según el nivel: entre nivel y 4 × nivel − 1. */
export function messageCoinRange(level: number): { min: number; max: number } {
  return { min: level, max: level * 4 - 1 };
}
