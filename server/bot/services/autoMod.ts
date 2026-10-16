// Moderación automática: filtro de palabras e invitaciones/enlaces, y castigos automáticos al juntar
// cierta cantidad de advertencias. Todo se configura desde el panel (Moderación → Automática).
import { PermissionFlagsBits, type Guild, type GuildMember, type Message } from 'discord.js';
import type { AutoPunishRule, GuildExtras } from '@shared/schema';
import { storage } from '../../storage';
import { autoPunishRulesOf, getExtrasSafe } from './extras';
import { logModeration } from './serverLog';

export const FILTER_LIMITS = { maxWords: 200, wordMax: 50 };

const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's', '!': 'i' };

const unleet = (chars: string) => chars.replace(/./g, (char) => LEET[char] ?? char);

/** Minúsculas y sin acentos. La ñ se queda: "año" no es "ano". */
function stripAccents(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/n\u0303/g, 'ñ')
    .replace(/[̀-ͯ]/g, '');
}

/** Minúsculas, sin acentos y sin trucos de números por letras ("h0l4" → "hola"). */
export function normalizeForFilter(text: string): string {
  return stripAccents(text).replace(/[0134557@$!]/g, unleet);
}

/**
 * Igual, pero "@", "$" y "!" solo cuentan como letras dentro de una palabra: así "idiota!" o "@idiota"
 * siguen siendo "idiota" (con normalizeForFilter quedarían "idiotai" y "aidiota").
 */
function normalizeKeepingPunctuation(text: string): string {
  return stripAccents(text)
    .replace(/[013457]/g, unleet)
    .replace(/(?<=[\p{L}\p{N}])[@$!]+(?=[\p{L}\p{N}])/gu, unleet);
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * La primera palabra prohibida que aparece en el texto (o null). Cuenta palabras completas; con "*" al
 * final cuenta también lo que empieza así ("tont*" atrapa "tonto" y "tontería").
 */
export function findFilterMatch(text: string, words: string[]): string | null {
  // Se prueban varias formas: "put@" solo sale con la primera e "idiota!" solo con la segunda. La tercera
  // es para "put@!": la "@" o "$" pegada al final de la palabra cuenta como letra y lo que sigue queda como signo
  const kept = normalizeKeepingPunctuation(text);
  const variants = [normalizeForFilter(text), kept, kept.replace(/(?<=[\p{L}\p{N}])[@$]/gu, unleet)];
  for (const raw of words) {
    const word = raw.trim();
    if (!word) continue;
    const prefix = word.endsWith('*');
    const base = normalizeForFilter(prefix ? word.slice(0, -1) : word).trim();
    if (base.length < 2) continue;
    const pattern = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegex(base).replace(/\s+/g, '\\s+')}${prefix ? '' : '(?=$|[^\\p{L}\\p{N}])'}`, 'u');
    if (variants.some((variant) => pattern.test(variant))) return word;
  }
  return null;
}

const INVITE = /(?:discord(?:app)?\.com\/invite|discord\.gg|dsc\.gg)\/[\w-]+/i;
const LINK = /\bhttps?:\/\/[^\s<]+/i;

export type FilterHit = { kind: 'word'; word: string } | { kind: 'invite' } | { kind: 'link' };

export function checkMessageText(text: string, extras: Pick<GuildExtras, 'filterWords' | 'filterInvites' | 'filterLinks'>): FilterHit | null {
  if (extras.filterInvites && INVITE.test(text)) return { kind: 'invite' };
  if (extras.filterLinks && LINK.test(text)) return { kind: 'link' };
  const word = findFilterMatch(text, extras.filterWords);
  return word ? { kind: 'word', word } : null;
}

function isExempt(member: GuildMember | null, extras: GuildExtras): boolean {
  if (!member) return false;
  if (member.permissions.has(PermissionFlagsBits.ManageMessages) || member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  return extras.filterExemptRoleIds.some((roleId) => member.roles.cache.has(roleId));
}

const HIT_TEXT: Record<FilterHit['kind'], string> = {
  word: 'tiene palabras que no están permitidas aquí',
  invite: 'tiene una invitación a otro servidor',
  link: 'tiene un enlace, y aquí no se permiten',
};

/** Revisa un mensaje nuevo o editado. Devuelve true si lo borró. */
export async function filterMessage(message: Message): Promise<boolean> {
  if (!message.inGuild() || message.author.bot || message.webhookId || !message.content) return false;
  const extras = await getExtrasSafe(message.guild.id);
  if (!extras.filterEnabled) return false;
  const member = message.member ?? await message.guild.members.fetch(message.author.id).catch(() => null);
  if (isExempt(member, extras)) return false;
  const hit = checkMessageText(message.content, extras);
  if (!hit) return false;

  const deleted = await message.delete().then(() => true).catch(() => false);
  if (!deleted) return false;

  if (message.channel.isSendable()) {
    const notice = await message.channel.send({
      content: `🚫 <@${message.author.id}>, tu mensaje se borró porque ${HIT_TEXT[hit.kind]}.`,
      allowedMentions: { users: [message.author.id] },
    }).catch(() => null);
    if (notice) setTimeout(() => void notice.delete().catch(() => undefined), 6_000).unref();
  }

  const reason = hit.kind === 'word' ? `Palabra prohibida ("${hit.word}")` : hit.kind === 'invite' ? 'Invitación a otro servidor' : 'Enlace no permitido';
  const botUser = message.client.user;
  if (extras.filterWarn) {
    await storage.logModerationAction({
      guild: { id: message.guild.id, name: message.guild.name, ownerId: message.guild.ownerId },
      moderator: { id: botUser.id, username: botUser.username, avatar: botUser.avatar },
      target: { id: message.author.id, username: message.author.username, avatar: message.author.avatar },
      type: 'warn',
      reason: `Filtro automático: ${reason}`,
    }).catch((error) => console.error('[FILTRO] No pude registrar la advertencia:', error));
    void logModeration(message.guild, { type: 'warn', targetId: message.author.id, moderatorId: botUser.id, reason: `Filtro automático: ${reason}`, automatic: true });
    void applyAutoPunish(message.guild, message.author.id);
  } else {
    void logModeration(message.guild, { type: 'filter', targetId: message.author.id, moderatorId: botUser.id, reason: `${reason} en <#${message.channelId}>`, automatic: true });
  }
  return true;
}

/** La regla que toca con exactamente esa cantidad de advertencias (cada umbral se aplica una sola vez). */
export function ruleForWarns(rules: AutoPunishRule[], warns: number): AutoPunishRule | null {
  return rules.find((rule) => rule.warns === warns) ?? null;
}

/**
 * Después de una advertencia: si la persona llegó a un umbral, aplica el castigo (aislar, expulsar o
 * banear) y lo anota en el historial. Nunca lanza.
 */
export async function applyAutoPunish(guild: Guild, userId: string): Promise<void> {
  try {
    const extras = await getExtrasSafe(guild.id);
    if (!extras.autoPunishEnabled) return;
    const warns = (await storage.getUserModerationActions(guild.id, userId, 'warn', 500)).filter((action) => action.active !== false).length;
    const rule = ruleForWarns(autoPunishRulesOf(extras), warns);
    if (!rule) return;

    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) return;
    const me = guild.members.me;
    if (member.id === guild.ownerId || !me || member.roles.highest.position >= me.roles.highest.position) {
      console.warn(`[CASTIGOS] ${guild.name}: no puedo castigar a ${member.user.tag} (su rol está arriba del mío o es el dueño).`);
      return;
    }
    const reason = `Castigo automático: llegó a ${warns} advertencias`;
    let duration: number | null = null;
    if (rule.action === 'timeout') {
      duration = Math.min(Math.max(rule.minutes ?? 60, 1), 40_320);
      // No se acorta un aislamiento que ya dura más (p. ej. un /mute de una semana)
      if ((member.communicationDisabledUntilTimestamp ?? 0) > Date.now() + duration * 60_000) {
        console.log(`[CASTIGOS] ${guild.name}: ${member.user.tag} ya está aislado por más tiempo; se queda ese aislamiento.`);
        return;
      }
      await member.timeout(duration * 60_000, reason);
      // Igual que /mute: el aislamiento nuevo reemplaza al anterior en el historial
      await storage.deactivateModerationActions(guild.id, member.id, 'mute').catch(() => 0);
    } else if (rule.action === 'kick') {
      await member.kick(reason);
    } else {
      await member.ban({ reason });
    }
    const type = rule.action === 'timeout' ? 'mute' : rule.action;
    const botUser = guild.client.user;
    await storage.logModerationAction({
      guild: { id: guild.id, name: guild.name, ownerId: guild.ownerId },
      moderator: { id: botUser.id, username: botUser.username, avatar: botUser.avatar },
      target: { id: member.id, username: member.user.username, avatar: member.user.avatar },
      type,
      reason,
      duration,
      active: rule.action !== 'kick',
    });
    void logModeration(guild, { type, targetId: member.id, moderatorId: botUser.id, reason, duration, automatic: true });
    console.log(`[CASTIGOS] ${guild.name}: ${member.user.tag} → ${rule.action} (${warns} advertencias).`);
  } catch (error) {
    console.error('[CASTIGOS] No pude aplicar el castigo automático:', error);
  }
}
