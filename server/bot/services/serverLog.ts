// Registro (logs) en un canal: mensajes borrados y editados, entradas y salidas, cambios de roles y
// acciones de moderación. Se activa y se elige qué anotar desde el panel (Moderación → Registro).
import { EmbedBuilder, type Guild } from 'discord.js';
import type { LogEvent } from '@shared/schema';
import { getExtrasSafe, logEventsOf } from './extras';
import { resolveSendableChannel, truncate } from './channels';

export const LOG_COLORS: Record<LogEvent, number> = {
  messageDelete: 0xED4245,
  messageEdit: 0xFEE75C,
  memberJoin: 0x57F287,
  memberLeave: 0x99AAB5,
  moderation: 0xEB459E,
  roles: 0x5865F2,
};

/** Manda una entrada al canal de registro si ese tipo de evento está activado. Nunca lanza. */
export async function sendServerLog(guild: Guild, event: LogEvent, build: (embed: EmbedBuilder) => EmbedBuilder | null): Promise<void> {
  try {
    const extras = await getExtrasSafe(guild.id);
    if (!extras.logsEnabled || !extras.logsChannelId || !logEventsOf(extras).includes(event)) return;
    const channel = resolveSendableChannel(guild, extras.logsChannelId);
    if (!channel.ok) return;
    const embed = build(new EmbedBuilder().setColor(LOG_COLORS[event]).setTimestamp());
    if (!embed) return;
    await channel.channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
  } catch (error) {
    console.warn(`[REGISTRO] No pude anotar en el registro de ${guild.name}:`, error instanceof Error ? error.message : error);
  }
}

const ACTION_LABELS: Record<string, string> = {
  warn: '⚠️ Advertencia',
  mute: '🔇 Silencio',
  unmute: '🔊 Quitó el silencio',
  kick: '👢 Expulsión',
  ban: '🔨 Baneo',
  unban: '🕊️ Desbaneo',
  clear: '🧹 Borró mensajes',
  lockdown: '🔒 Bloqueo de canal',
  unlock: '🔓 Desbloqueo de canal',
  clearwarns: '🧽 Borró advertencias',
  filter: '🚫 Filtro de palabras',
  confession_lookup: '🔎 Consultó autor de confesión',
};

export function moderationLabel(type: string): string {
  return ACTION_LABELS[type] ?? type;
}

export function logModeration(guild: Guild, entry: { type: string; targetId: string; moderatorId: string; reason?: string | null; duration?: number | null; automatic?: boolean }): Promise<void> {
  return sendServerLog(guild, 'moderation', (embed) => embed
    .setTitle(`${moderationLabel(entry.type)}${entry.automatic ? ' (automática)' : ''}`)
    .addFields(
      { name: 'Miembro', value: `<@${entry.targetId}> (${entry.targetId})`, inline: true },
      { name: 'Por', value: `<@${entry.moderatorId}>`, inline: true },
      ...(entry.duration ? [{ name: 'Duración', value: `${entry.duration} min`, inline: true }] : []),
      { name: 'Razón', value: truncate(entry.reason || 'No especificada', 1000) },
    ));
}
