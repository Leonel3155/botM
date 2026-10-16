// Lo que comparten la XP por mensajes y la de voz: quién gana XP, cuánta, el aviso al subir de nivel
// y los roles por nivel. Todo se ajusta por servidor en el panel (Niveles); ver shared/tuning.ts.
import {
  PermissionFlagsBits,
  escapeMarkdown,
  type Guild,
  type GuildMember,
  type GuildTextBasedChannel,
  type Role,
} from 'discord.js';
import { DEFAULT_LEVEL_UP_MESSAGE, type GuildTuning } from '@shared/tuning';
import { checkGrantableRole } from './roles';
import { truncate } from './channels';
import { formatCoins } from './economy';
import { prestigeMultiplier } from './levels';

/** ¿El canal (o el canal padre de un hilo) o la persona están en las listas "sin XP" del panel? */
export function isNoXp(
  tuning: GuildTuning,
  channel: { id: string; parentId?: string | null } | null,
  member: GuildMember | null,
): boolean {
  if (channel) {
    if (tuning.noXpChannelIds.includes(channel.id)) return true;
    if (channel.parentId && tuning.noXpChannelIds.includes(channel.parentId)) return true;
  }
  if (member && tuning.noXpRoleIds.length > 0) {
    return member.roles.cache.some((role) => tuning.noXpRoleIds.includes(role.id));
  }
  return false;
}

/** XP final: base × bono de prestigio × multiplicador del servidor. */
export function scaleXp(baseXp: number, tuning: GuildTuning, prestige: number): number {
  return Math.round((baseXp * prestigeMultiplier(prestige, tuning) * tuning.xpMultiplierPercent) / 100);
}

function milestoneText(level: number, goal: number): string {
  if (level === goal) return `\n🚀 ¡Nivel ${goal}! Ya puedes usar \`/prestige\`.`;
  if (level > goal) return '\n🌌 ¡Leyenda del servidor! Recuerda que puedes usar `/prestige`.';
  if (level === 10) return '\n🏆 ¡Primer gran logro!';
  if (goal >= 40) {
    if (level === Math.round(goal / 4)) return '\n⭐ ¡Ya llevas un cuarto del camino al prestigio!';
    if (level === Math.round(goal / 2)) return '\n🌟 ¡Mitad del camino al prestigio!';
    if (level === Math.round((goal * 3) / 4)) return `\n💎 ¡Nivel ${level}, qué constancia!`;
  }
  return '';
}

function canSendText(channel: GuildTextBasedChannel): boolean {
  const me = channel.guild.members.me;
  const permissions = me ? channel.permissionsFor(me) : null;
  const write = channel.isThread() ? PermissionFlagsBits.SendMessagesInThreads : PermissionFlagsBits.SendMessages;
  return !!permissions?.has([PermissionFlagsBits.ViewChannel, write]);
}

/** Canal del aviso: el que eligieron en el panel si el bot puede escribir ahí; si no, `fallback`. */
function noticeChannel(guild: Guild, tuning: GuildTuning, fallback: GuildTextBasedChannel | null): GuildTextBasedChannel | null {
  if (tuning.levelUpChannelId) {
    const chosen = guild.channels.cache.get(tuning.levelUpChannelId);
    if (chosen?.isTextBased() && canSendText(chosen)) return chosen;
  }
  return fallback && canSendText(fallback) ? fallback : null;
}

export interface LevelUpNotice {
  guild: Guild;
  userId: string;
  displayName: string;
  level: number;
  /** null si la economía está apagada (no se ganó nada) */
  reward: { coins: number; tickets: number } | null;
  /** Roles por nivel que se acaban de dar */
  newRoles: Role[];
  /** Donde se habló (o el canal de voz); se usa si no hay canal de avisos */
  fallbackChannel: GuildTextBasedChannel | null;
  tuning: GuildTuning;
  /** Texto extra al final (p. ej. el golpe de suerte) */
  extra?: string;
}

/** Arma y manda el aviso de subida de nivel con el mensaje del panel. Nunca lanza. */
export async function sendLevelUpNotice(notice: LevelUpNotice): Promise<void> {
  const { guild, userId, displayName, level, reward, newRoles, tuning } = notice;
  const channel = noticeChannel(guild, tuning, notice.fallbackChannel);
  if (!channel) return;

  const ticketsText = reward ? `${reward.tickets} ${reward.tickets === 1 ? 'boleto' : 'boletos'}` : '';
  const rewardText = reward ? `💰 +${formatCoins(reward.coins)} • 🎫 +${ticketsText}` : '';
  const name = escapeMarkdown(displayName);
  const template = tuning.levelUpMessage ?? DEFAULT_LEVEL_UP_MESSAGE;
  const values: Record<string, string> = {
    usuario: tuning.levelUpPing ? `<@${userId}>` : `**${name}**`,
    nombre: name,
    nivel: level.toLocaleString('es-MX'),
    premio: rewardText,
  };
  // De una sola pasada, así un apodo que contenga "{nivel}" no se reemplaza
  const body = template.replace(/\{(usuario|nombre|nivel|premio)\}/g, (_, key: string) => values[key]);
  const rewardLine = rewardText && !template.includes('{premio}') ? `\n${rewardText}` : '';
  const rolesLine = newRoles.length > 0
    ? `\n🏅 ${newRoles.length === 1 ? 'Nuevo rol' : 'Nuevos roles'}: ${newRoles.map((role) => `<@&${role.id}>`).join(', ')}`
    : '';

  const content = truncate(`${body}${milestoneText(level, tuning.prestigeMinLevel)}${rewardLine}${rolesLine}${notice.extra ?? ''}`, 2000);
  await channel.send({
    content,
    // Solo puede avisar a quien subió de nivel (y solo si el panel lo permite), aunque el mensaje
    // escrito en el panel traiga otras menciones, @everyone o roles
    allowedMentions: { parse: [], users: tuning.levelUpPing ? [userId] : [] },
  }).catch((error) => console.warn(`[NIVELES] No se pudo avisar la subida de nivel en #${channel.name}:`, error));
}

/**
 * Da los roles por nivel que le tocan a quien llegó a `level` (incluye los de niveles que se saltó) y,
 * si no se acumulan, quita los de niveles más bajos. Devuelve los roles que se dieron. Nunca lanza.
 */
export async function applyLevelRoles(member: GuildMember, level: number, tuning: GuildTuning): Promise<Role[]> {
  const earned = tuning.levelRoleRewards.filter((rule) => rule.level <= level);
  if (earned.length === 0) return [];
  // Las reglas vienen ordenadas por nivel: la última es la más alta alcanzada
  const keep = tuning.levelRoleStack ? earned : earned.slice(-1);
  const keepIds = new Set(keep.map((rule) => rule.roleId));

  const toAdd: Role[] = [];
  for (const rule of keep) {
    if (member.roles.cache.has(rule.roleId)) continue;
    const check = checkGrantableRole(member.guild, rule.roleId);
    if (check.ok) toAdd.push(check.role);
    else console.warn(`[NIVELES] No pude dar el rol del nivel ${rule.level} en ${member.guild.name}: ${check.reason}`);
  }
  const toRemove: Role[] = [];
  if (!tuning.levelRoleStack) {
    for (const rule of tuning.levelRoleRewards) {
      if (keepIds.has(rule.roleId) || !member.roles.cache.has(rule.roleId)) continue;
      const check = checkGrantableRole(member.guild, rule.roleId);
      if (check.ok) toRemove.push(check.role);
    }
  }

  try {
    if (toAdd.length > 0) await member.roles.add(toAdd, `Llegó al nivel ${level}`);
  } catch (error) {
    console.warn(`[NIVELES] No se pudieron dar los roles por nivel en ${member.guild.name}:`, error);
    return [];
  }
  if (toRemove.length > 0) {
    await member.roles.remove(toRemove, 'Rol de un nivel anterior (solo se conserva el más alto)')
      .catch((error) => console.warn(`[NIVELES] No se pudieron quitar roles de niveles anteriores en ${member.guild.name}:`, error));
  }
  return toAdd;
}
