// Ajustes de las funciones extra (interacciones, cumpleaños, starboard, confesiones, registro, filtro,
// castigos automáticos y XP por voz). Se guardan desde el panel; el bot los lee con una caché corta para
// no consultar la base en cada mensaje o reacción.
import { eq } from 'drizzle-orm';
import { guildExtras, type AutoPunishRule, type GuildExtras, type LogEvent } from '@shared/schema';
import { db } from '../../db';

const TTL_MS = 15_000;
const cache = new Map<string, { at: number; extras: GuildExtras }>();

export const ALL_LOG_EVENTS: LogEvent[] = ['messageDelete', 'messageEdit', 'memberJoin', 'memberLeave', 'moderation', 'roles'];

export const DEFAULT_AUTO_PUNISH_RULES: AutoPunishRule[] = [
  { warns: 3, action: 'timeout', minutes: 60 },
  { warns: 5, action: 'kick' },
];

/** Lo que vale para un servidor que nunca guardó nada (igual que los valores por defecto de la tabla). */
export function defaultExtras(guildId: string): GuildExtras {
  return {
    guildId,
    interactionsEnabled: true,
    birthdaysEnabled: false,
    birthdayChannelId: null,
    birthdayRoleId: null,
    birthdayHour: 9,
    birthdayMessage: null,
    starboardEnabled: false,
    starboardChannelId: null,
    starboardEmoji: '⭐',
    starboardThreshold: 3,
    confessionsEnabled: false,
    confessionsChannelId: null,
    confessionsCount: 0,
    logsEnabled: false,
    logsChannelId: null,
    logEvents: null,
    filterEnabled: false,
    filterWords: [],
    filterInvites: true,
    filterLinks: false,
    filterExemptRoleIds: [],
    filterWarn: false,
    autoPunishEnabled: false,
    autoPunishRules: null,
    voiceXpEnabled: false,
    nsfwEnabled: false,
    nsfwChannelIds: [],
    updatedAt: null,
  };
}

export async function getExtras(guildId: string): Promise<GuildExtras> {
  const hit = cache.get(guildId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.extras;
  const startedAt = Date.now();
  const [row] = await db.select().from(guildExtras).where(eq(guildExtras.guildId, guildId));
  const extras = row ?? defaultExtras(guildId);
  cache.set(guildId, { at: startedAt, extras });
  if (cache.size > 5_000) {
    for (const [id, entry] of cache) if (Date.now() - entry.at >= TTL_MS) cache.delete(id);
  }
  return extras;
}

/** Igual que getExtras, pero si la base falla devuelve los valores por defecto (para eventos de Discord). */
export async function getExtrasSafe(guildId: string): Promise<GuildExtras> {
  try {
    return await getExtras(guildId);
  } catch (error) {
    console.error('[EXTRAS] No pude leer los ajustes extra:', error);
    return cache.get(guildId)?.extras ?? defaultExtras(guildId);
  }
}

/**
 * Para comandos que revisan un ajuste antes de deferReply (Discord da 3 s para la primera respuesta):
 * si la base tarda más de `budgetMs`, usa lo último conocido o los valores por defecto.
 */
export async function getExtrasQuick(guildId: string, budgetMs = 1_200): Promise<GuildExtras> {
  const hit = cache.get(guildId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.extras;
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), budgetMs);
  });
  const result = await Promise.race([getExtrasSafe(guildId), late]);
  clearTimeout(timer);
  return result ?? cache.get(guildId)?.extras ?? defaultExtras(guildId);
}

export type ExtrasPatch = Partial<Omit<GuildExtras, 'guildId' | 'updatedAt' | 'confessionsCount'>>;

/** Guarda cambios (crea el renglón si no existe). El servidor ya debe existir en la tabla guilds. */
export async function updateExtras(guildId: string, patch: ExtrasPatch): Promise<GuildExtras> {
  const values = { ...patch, updatedAt: new Date() };
  const [row] = await db
    .insert(guildExtras)
    .values({ guildId, ...values })
    .onConflictDoUpdate({ target: guildExtras.guildId, set: values })
    .returning();
  cache.set(guildId, { at: Date.now(), extras: row });
  return row;
}

export function forgetExtras(guildId: string): void {
  cache.delete(guildId);
}

export function logEventsOf(extras: GuildExtras): LogEvent[] {
  return extras.logEvents ?? ALL_LOG_EVENTS;
}

export function autoPunishRulesOf(extras: GuildExtras): AutoPunishRule[] {
  return extras.autoPunishRules ?? DEFAULT_AUTO_PUNISH_RULES;
}
