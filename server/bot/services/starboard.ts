// Starboard: cuando un mensaje junta suficientes reacciones con el emoji elegido (⭐ por defecto), el bot
// lo copia al canal de "lo mejor" y va actualizando el contador. Se configura en el panel (Diversión).
import {
  EmbedBuilder,
  type Message,
  type MessageReaction,
  type PartialMessageReaction,
} from 'discord.js';
import { and, eq } from 'drizzle-orm';
import { starboardPosts } from '@shared/schema';
import { db } from '../../db';
import { getExtrasSafe } from './extras';
import { resolveSendableChannel, truncate } from './channels';

/** ¿La reacción es el emoji elegido? Acepta un emoji normal ("⭐") o uno del servidor ("<:nombre:id>"). */
export function emojiMatches(configured: string, reaction: { id: string | null; name: string | null }): boolean {
  const custom = /^<a?:\w+:(\d+)>$/.exec(configured.trim());
  if (custom) return reaction.id === custom[1];
  return !reaction.id && reaction.name === configured.trim();
}

function isAgeRestricted(channel: unknown): boolean {
  return !!channel && typeof channel === 'object' && 'nsfw' in channel && (channel as { nsfw: boolean }).nsfw === true;
}

function buildStarEmbed(message: Message, emoji: string, count: number): { content: string; embeds: EmbedBuilder[] } {
  const embed = new EmbedBuilder()
    .setColor(0xFFD700)
    .setAuthor({ name: message.member?.displayName ?? message.author.displayName, iconURL: message.author.displayAvatarURL() })
    .setDescription(truncate(message.content || '*(sin texto)*', 4000))
    .addFields({ name: 'Original', value: `[Ir al mensaje](${message.url})` })
    .setTimestamp(message.createdAt);
  const image = message.attachments.find((file) => file.contentType?.startsWith('image/'));
  if (image) embed.setImage(image.url);
  return { content: `${emoji} **${count}** · <#${message.channelId}>`, embeds: [embed] };
}

// Una actualización a la vez por mensaje (muchas reacciones juntas no deben duplicar la copia)
const queues = new Map<string, Promise<void>>();

export function handleStarReaction(reaction: MessageReaction | PartialMessageReaction): Promise<void> {
  const key = reaction.message.id;
  const next = (queues.get(key) ?? Promise.resolve()).then(() => updateStarboard(reaction)).catch((error) => {
    console.warn('[STARBOARD] No pude actualizar el starboard:', error instanceof Error ? error.message : error);
  });
  queues.set(key, next);
  void next.finally(() => {
    if (queues.get(key) === next) queues.delete(key);
  });
  return next;
}

async function updateStarboard(partial: MessageReaction | PartialMessageReaction) {
  const guild = partial.message.guild;
  if (!guild) return;
  const extras = await getExtrasSafe(guild.id);
  if (!extras.starboardEnabled || !extras.starboardChannelId) return;
  if (!emojiMatches(extras.starboardEmoji, partial.emoji)) return;

  const reaction = partial.partial ? await partial.fetch() : partial;
  const message = reaction.message.partial ? await reaction.message.fetch() : reaction.message;
  if (!message.inGuild() || message.channelId === extras.starboardChannelId) return;
  const target = resolveSendableChannel(guild, extras.starboardChannelId);
  if (!target.ok) return;
  // Nada de un canal +18 a un canal normal
  if (isAgeRestricted(message.channel) && !isAgeRestricted(target.channel)) return;

  // No cuenta la reacción del propio autor
  let count = reaction.count ?? 0;
  if (count > 0 && (await reaction.users.fetch().catch(() => null))?.has(message.author.id)) count--;

  const [existing] = await db.select().from(starboardPosts)
    .where(and(eq(starboardPosts.guildId, guild.id), eq(starboardPosts.messageId, message.id)));

  if (existing?.starMessageId) {
    const starMessage = await target.channel.messages.fetch(existing.starMessageId).catch(() => null);
    if (starMessage) await starMessage.edit(buildStarEmbed(message, extras.starboardEmoji, count)).catch(() => undefined);
    await db.update(starboardPosts).set({ count })
      .where(and(eq(starboardPosts.guildId, guild.id), eq(starboardPosts.messageId, message.id)));
    return;
  }
  if (count < extras.starboardThreshold) return;

  const sent = await target.channel.send({ ...buildStarEmbed(message, extras.starboardEmoji, count), allowedMentions: { parse: [] } });
  await db.insert(starboardPosts)
    .values({ guildId: guild.id, messageId: message.id, starMessageId: sent.id, count })
    .onConflictDoUpdate({ target: [starboardPosts.guildId, starboardPosts.messageId], set: { starMessageId: sent.id, count } });
}
