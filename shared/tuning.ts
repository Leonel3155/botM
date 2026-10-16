// Ajustes finos de cada servidor (XP, economía, juegos…) que se cambian desde el panel.
// Se guardan juntos en guild_extras.tuning (jsonb). Lo que no se guardó usa el valor de DEFAULT_TUNING,
// así que agregar un ajuste nuevo no necesita cambiar las tablas.
// Este archivo lo usan el bot, la API y el panel: los tres leen los mismos valores y límites.

export interface LevelRoleReward {
  level: number;
  roleId: string;
}

export interface GuildTuning {
  // ===== XP y niveles =====
  xpEnabled: boolean;              // apagado = nadie gana XP (ni por mensajes ni por voz)
  xpMin: number;                   // XP mínima por mensaje premiado
  xpMax: number;                   // XP máxima por mensaje premiado
  xpCooldownSeconds: number;       // espera entre mensajes que dan XP y monedas
  xpMinMessageLength: number;      // mensajes más cortos no dan XP (0 = cualquiera)
  xpMultiplierPercent: number;     // 100 = normal, 200 = doble XP para todo el servidor
  noXpChannelIds: string[];        // canales (de texto o voz) donde no se gana XP
  noXpRoleIds: string[];           // quien tenga uno de estos roles no gana XP
  voiceXpPerMinute: number;
  voiceXpMinMembers: number;       // personas (sin bots) que debe haber en el canal de voz
  levelUpChannelId: string | null; // null = en el canal donde escribió
  levelUpMessage: string | null;   // null = mensaje predeterminado
  levelUpPing: boolean;            // mencionar a la persona en el aviso
  levelRoleRewards: LevelRoleReward[];
  levelRoleStack: boolean;         // true = conserva los roles de niveles anteriores; false = solo el más alto
  prestigeMinLevel: number;
  prestigeBonusPercent: number;    // XP extra por cada prestigio
  prestigeMaxBonus: number;        // cuántos prestigios cuentan para el bono

  // ===== Economía =====
  startingBalance: number;         // monedas con las que empieza una cuenta nueva
  messageCoinsPercent: number;     // 100 = normal, 0 = platicar no da monedas
  levelUpCoinsFactor: number;      // premio al subir de nivel = nivel² × esto
  luckyChancePercent: number;      // probabilidad de "golpe de suerte" por mensaje premiado
  luckyCoins: number;
  dailyBase: number;
  dailyPerLevel: number;
  dailyCooldownHours: number;
  dailyStreakStepPercent: number;
  dailyStreakMaxDays: number;
  workCooldownMinutes: number;
  workPayPercent: number;          // 100 = paga normal de cada trabajo
  crimeEnabled: boolean;
  crimeCooldownMinutes: number;
  crimeSuccessPercent: number;
  crimeRiskPercent: number;        // parte de la cartera que se gana o se pierde
  slutEnabled: boolean;
  slutCooldownMinutes: number;
  slutSuccessPercent: number;
  robEnabled: boolean;
  robCooldownMinutes: number;
  robSuccessPercent: number;
  robFinePercent: number;
  robMinWallet: number;            // cartera mínima de quien roba y de la víctima

  // ===== Juegos =====
  gamblingEnabled: boolean;
  minBet: number;
  maxBet: number;                  // 0 = sin límite

  // ===== Otros =====
  customCommandCooldownSeconds: number;
  nsfwCooldownSeconds: number;
  welcomeBurstLimit: number;       // si entran más de estas personas en un minuto, deja de saludar
}

export const DEFAULT_TUNING: GuildTuning = {
  xpEnabled: true,
  xpMin: 15,
  xpMax: 25,
  xpCooldownSeconds: 60,
  xpMinMessageLength: 0,
  xpMultiplierPercent: 100,
  noXpChannelIds: [],
  noXpRoleIds: [],
  voiceXpPerMinute: 5,
  voiceXpMinMembers: 2,
  levelUpChannelId: null,
  levelUpMessage: null,
  levelUpPing: true,
  levelRoleRewards: [],
  levelRoleStack: true,
  prestigeMinLevel: 100,
  prestigeBonusPercent: 10,
  prestigeMaxBonus: 10,

  startingBalance: 0,
  messageCoinsPercent: 100,
  levelUpCoinsFactor: 50,
  luckyChancePercent: 0.5,
  luckyCoins: 100,
  dailyBase: 500,
  dailyPerLevel: 10,
  dailyCooldownHours: 24,
  dailyStreakStepPercent: 5,
  dailyStreakMaxDays: 10,
  workCooldownMinutes: 60,
  workPayPercent: 100,
  crimeEnabled: true,
  crimeCooldownMinutes: 120,
  crimeSuccessPercent: 50,
  crimeRiskPercent: 20,
  slutEnabled: true,
  slutCooldownMinutes: 120,
  slutSuccessPercent: 70,
  robEnabled: true,
  robCooldownMinutes: 240,
  robSuccessPercent: 60,
  robFinePercent: 5,
  robMinWallet: 100,

  gamblingEnabled: true,
  minBet: 1,
  maxBet: 0,

  customCommandCooldownSeconds: 5,
  nsfwCooldownSeconds: 5,
  welcomeBurstLimit: 8,
};

type KeysOfType<T, V> = { [K in keyof T]: T[K] extends V ? K : never }[keyof T];
export type TuningNumberKey = KeysOfType<GuildTuning, number>;
export type TuningBooleanKey = KeysOfType<GuildTuning, boolean>;

/** La XP total de una persona no pasa de aquí (la columna de la base es integer). */
export const MAX_TOTAL_XP = 2_000_000_000;

/**
 * Nivel más alto que se puede alcanzar con ese tope (153): pasar del nivel N-1 al N cuesta
 * floor(100 × 1.1^(N-2)) XP, la curva de server/bot/services/levels.ts.
 */
export const MAX_REACHABLE_LEVEL = (() => {
  let level = 1;
  let total = 0;
  while (total + Math.floor(100 * Math.pow(1.1, level - 1)) <= MAX_TOTAL_XP) {
    total += Math.floor(100 * Math.pow(1.1, level - 1));
    level++;
  }
  return level;
})();

/** Límites de cada número. `step` < 1 permite decimales. */
export const TUNING_NUMBER_LIMITS: Record<TuningNumberKey, { min: number; max: number; step?: number }> = {
  xpMin: { min: 0, max: 1000 },
  xpMax: { min: 0, max: 1000 },
  xpCooldownSeconds: { min: 5, max: 3600 },
  xpMinMessageLength: { min: 0, max: 200 },
  xpMultiplierPercent: { min: 0, max: 1000 },
  voiceXpPerMinute: { min: 0, max: 100 },
  voiceXpMinMembers: { min: 1, max: 10 },
  prestigeMinLevel: { min: 10, max: MAX_REACHABLE_LEVEL },
  prestigeBonusPercent: { min: 0, max: 100 },
  prestigeMaxBonus: { min: 0, max: 100 },

  startingBalance: { min: 0, max: 1_000_000 },
  messageCoinsPercent: { min: 0, max: 1000 },
  levelUpCoinsFactor: { min: 0, max: 10_000 },
  luckyChancePercent: { min: 0, max: 100, step: 0.1 },
  luckyCoins: { min: 0, max: 1_000_000 },
  dailyBase: { min: 0, max: 1_000_000 },
  dailyPerLevel: { min: 0, max: 100_000 },
  dailyCooldownHours: { min: 1, max: 168 },
  dailyStreakStepPercent: { min: 0, max: 100 },
  dailyStreakMaxDays: { min: 0, max: 365 },
  workCooldownMinutes: { min: 1, max: 1440 },
  workPayPercent: { min: 0, max: 1000 },
  crimeCooldownMinutes: { min: 1, max: 1440 },
  crimeSuccessPercent: { min: 1, max: 99 },
  crimeRiskPercent: { min: 1, max: 100 },
  slutCooldownMinutes: { min: 1, max: 1440 },
  slutSuccessPercent: { min: 1, max: 99 },
  robCooldownMinutes: { min: 1, max: 1440 },
  robSuccessPercent: { min: 1, max: 99 },
  robFinePercent: { min: 0, max: 100 },
  robMinWallet: { min: 0, max: 1_000_000 },

  minBet: { min: 1, max: 1_000_000_000 },
  maxBet: { min: 0, max: 1_000_000_000_000 },

  customCommandCooldownSeconds: { min: 0, max: 3600 },
  nsfwCooldownSeconds: { min: 0, max: 3600 },
  welcomeBurstLimit: { min: 1, max: 100 },
};

export const TUNING_LIMITS = {
  listMax: 25,          // canales o roles sin XP
  levelRolesMax: 25,    // roles por nivel
  levelUpMessageMax: 1000,
  maxLevel: MAX_REACHABLE_LEVEL,
} as const;

export const LEVEL_UP_PLACEHOLDERS = ['{usuario}', '{nombre}', '{nivel}', '{premio}'] as const;
export const DEFAULT_LEVEL_UP_MESSAGE = '🎉 ¡{usuario} subió al nivel **{nivel}**!';

const SNOWFLAKE = /^\d{17,20}$/;

/** Redondea al paso del ajuste (enteros, o p. ej. décimas) sin dejar restos como 0.30000000000000004. */
export function roundToStep(value: number, step = 1): number {
  if (step >= 1) return Math.round(value);
  const decimals = Math.max(0, Math.ceil(-Math.log10(step)));
  return Number((Math.round(value / step + 1e-9) * step).toFixed(decimals));
}

function cleanNumber(key: TuningNumberKey, value: unknown): number {
  const limits = TUNING_NUMBER_LIMITS[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_TUNING[key];
  return Math.min(Math.max(roundToStep(value, limits.step), limits.min), limits.max);
}

function cleanIds(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((id): id is string => typeof id === 'string' && SNOWFLAKE.test(id)))].slice(0, max);
}

function cleanLevelRoles(value: unknown): LevelRoleReward[] {
  if (!Array.isArray(value)) return [];
  const byLevel = new Map<number, LevelRoleReward>();
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const { level, roleId } = item as Record<string, unknown>;
    if (typeof level !== 'number' || !Number.isInteger(level) || level < 2 || level > TUNING_LIMITS.maxLevel) continue;
    if (typeof roleId !== 'string' || !SNOWFLAKE.test(roleId)) continue;
    byLevel.set(level, { level, roleId });
  }
  return [...byLevel.values()].sort((a, b) => a.level - b.level).slice(0, TUNING_LIMITS.levelRolesMax);
}

/**
 * Convierte lo guardado (puede venir incompleto, de una versión anterior o con valores fuera de rango)
 * en ajustes completos y válidos. Nunca lanza error.
 */
export function resolveTuning(raw: unknown): GuildTuning {
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const result = { ...DEFAULT_TUNING };
  for (const key of Object.keys(TUNING_NUMBER_LIMITS) as TuningNumberKey[]) {
    if (key in source) result[key] = cleanNumber(key, source[key]);
  }
  for (const key of Object.keys(DEFAULT_TUNING) as (keyof GuildTuning)[]) {
    if (typeof DEFAULT_TUNING[key] === 'boolean' && typeof source[key] === 'boolean') {
      (result as Record<string, unknown>)[key] = source[key];
    }
  }
  if ('noXpChannelIds' in source) result.noXpChannelIds = cleanIds(source.noXpChannelIds, TUNING_LIMITS.listMax);
  if ('noXpRoleIds' in source) result.noXpRoleIds = cleanIds(source.noXpRoleIds, TUNING_LIMITS.listMax);
  if ('levelRoleRewards' in source) result.levelRoleRewards = cleanLevelRoles(source.levelRoleRewards);
  if (typeof source.levelUpChannelId === 'string' && SNOWFLAKE.test(source.levelUpChannelId)) {
    result.levelUpChannelId = source.levelUpChannelId;
  }
  if (typeof source.levelUpMessage === 'string' && source.levelUpMessage.trim()) {
    result.levelUpMessage = source.levelUpMessage.slice(0, TUNING_LIMITS.levelUpMessageMax);
  }
  // El máximo nunca queda por debajo del mínimo
  if (result.xpMax < result.xpMin) result.xpMax = result.xpMin;
  if (result.maxBet !== 0 && result.maxBet < result.minBet) result.maxBet = result.minBet;
  return result;
}

// ===== Fórmulas que comparten el bot y el panel =====

/** Monedas al subir a `level`. */
export function levelUpCoins(tuning: Pick<GuildTuning, 'levelUpCoinsFactor'>, level: number): number {
  return level * level * tuning.levelUpCoinsFactor;
}

/** Multiplicador de XP por prestigio (1 = sin bono). */
export function prestigeMultiplierFor(tuning: Pick<GuildTuning, 'prestigeBonusPercent' | 'prestigeMaxBonus'>, prestigeLevel: number): number {
  const counted = Math.min(Math.max(Math.floor(prestigeLevel || 0), 0), tuning.prestigeMaxBonus);
  return 1 + (counted * tuning.prestigeBonusPercent) / 100;
}

/** "x1.15", "x2.0"… con hasta dos decimales (el bono por prestigio puede ser p. ej. 5 %). */
export function formatMultiplier(multiplier: number): string {
  return `x${Number(multiplier.toFixed(2)).toLocaleString('es-MX', { minimumFractionDigits: 1, maximumFractionDigits: 2 })}`;
}

/** Bono de /daily por racha, como fracción (0.25 = +25 %). */
export function streakBonusFraction(tuning: Pick<GuildTuning, 'dailyStreakStepPercent' | 'dailyStreakMaxDays'>, streak: number): number {
  const days = Math.min(Math.max(streak - 1, 0), tuning.dailyStreakMaxDays);
  return (days * tuning.dailyStreakStepPercent) / 100;
}

/** Nombre corto de cada número, para los mensajes de error y el panel. */
export const TUNING_NUMBER_LABELS: Record<TuningNumberKey, string> = {
  xpMin: 'XP mínima por mensaje',
  xpMax: 'XP máxima por mensaje',
  xpCooldownSeconds: 'Espera entre mensajes que dan XP',
  xpMinMessageLength: 'Largo mínimo del mensaje',
  xpMultiplierPercent: 'Multiplicador de XP',
  voiceXpPerMinute: 'XP por minuto en voz',
  voiceXpMinMembers: 'Personas mínimas en el canal de voz',
  prestigeMinLevel: 'Nivel para prestigiar',
  prestigeBonusPercent: 'Bono de XP por prestigio',
  prestigeMaxBonus: 'Prestigios que cuentan para el bono',
  startingBalance: 'Monedas iniciales',
  messageCoinsPercent: 'Monedas por platicar',
  levelUpCoinsFactor: 'Premio por subir de nivel',
  luckyChancePercent: 'Probabilidad de golpe de suerte',
  luckyCoins: 'Monedas del golpe de suerte',
  dailyBase: 'Monedas base de /daily',
  dailyPerLevel: 'Monedas extra de /daily por nivel',
  dailyCooldownHours: 'Espera de /daily',
  dailyStreakStepPercent: 'Bono por día de racha',
  dailyStreakMaxDays: 'Días de racha que cuentan',
  workCooldownMinutes: 'Espera de /work',
  workPayPercent: 'Paga de /work',
  crimeCooldownMinutes: 'Espera de /crime',
  crimeSuccessPercent: 'Probabilidad de que /crime salga bien',
  crimeRiskPercent: 'Parte de la cartera en juego en /crime',
  slutCooldownMinutes: 'Espera de /slut',
  slutSuccessPercent: 'Probabilidad de que /slut salga bien',
  robCooldownMinutes: 'Espera de /rob',
  robSuccessPercent: 'Probabilidad de que /rob salga bien',
  robFinePercent: 'Multa de /rob',
  robMinWallet: 'Cartera mínima para robar',
  minBet: 'Apuesta mínima',
  maxBet: 'Apuesta máxima',
  customCommandCooldownSeconds: 'Espera de los comandos personalizados',
  nsfwCooldownSeconds: 'Espera de /nsfw',
  welcomeBurstLimit: 'Entradas por minuto antes de dejar de saludar',
};

/** Guarda solo lo que cambió respecto a los valores predeterminados (así un cambio de versión los actualiza). */
export function tuningDiff(tuning: GuildTuning): Partial<GuildTuning> {
  const diff: Record<string, unknown> = {};
  for (const key of Object.keys(DEFAULT_TUNING) as (keyof GuildTuning)[]) {
    if (JSON.stringify(tuning[key]) !== JSON.stringify(DEFAULT_TUNING[key])) diff[key] = tuning[key];
  }
  return diff as Partial<GuildTuning>;
}

/** "1 hora", "90 minutos", "2 horas"… para los textos del bot y del panel. */
export function formatWaitMinutes(minutes: number): string {
  if (minutes >= 60 && minutes % 60 === 0) {
    const hours = minutes / 60;
    return hours === 1 ? '1 hora' : `${hours} horas`;
  }
  return minutes === 1 ? '1 minuto' : `${minutes} minutos`;
}

/** Igual que formatWaitMinutes, para esperas en segundos. */
export function formatWaitSeconds(seconds: number): string {
  if (seconds >= 60 && seconds % 60 === 0) return formatWaitMinutes(seconds / 60);
  return seconds === 1 ? '1 segundo' : `${seconds} segundos`;
}
