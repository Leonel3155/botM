// XP por estar en canales de voz (se activa en el panel, en Niveles). Cada minuto, quien está en un
// canal de voz con al menos otra persona (sin contar bots), sin ensordecerse y fuera del canal AFK,
// gana XP. Así no se puede farmear solo en un canal vacío.
import type { Client, Guild, VoiceBasedChannel } from 'discord.js';
import { eq, and, sql } from 'drizzle-orm';
import { userLevels } from '@shared/schema';
import { db } from '../../db';
import { storage } from '../../storage';
import { getExtrasSafe } from './extras';
import { awardXp } from './levels';

export const VOICE_XP_PER_MINUTE = 5;

/** Quiénes de ese canal ganan XP este minuto. */
export function eligibleVoiceMembers(channel: VoiceBasedChannel, afkChannelId: string | null): string[] {
  if (channel.id === afkChannelId) return [];
  const humans = channel.members.filter((member) => !member.user.bot);
  if (humans.size < 2) return [];
  return humans
    .filter((member) => !member.voice.selfDeaf && !member.voice.serverDeaf)
    .map((member) => member.id);
}

async function tickGuild(guild: Guild) {
  const extras = await getExtrasSafe(guild.id);
  if (!extras.voiceXpEnabled) return;
  await storage.ensureGuild(guild.id, guild.name, guild.ownerId);
  const channels = guild.channels.cache.filter((channel): channel is VoiceBasedChannel => channel.isVoiceBased());
  for (const channel of channels.values()) {
    for (const userId of eligibleVoiceMembers(channel, guild.afkChannelId)) {
      const member = channel.members.get(userId);
      if (!member) continue;
      await storage.upsertUser({ id: userId, username: member.user.username, avatar: member.user.avatar });
      await awardXp(guild.id, userId, VOICE_XP_PER_MINUTE);
      await db.update(userLevels)
        .set({ voiceTime: sql`coalesce(${userLevels.voiceTime}, 0) + 1` })
        .where(and(eq(userLevels.guildId, guild.id), eq(userLevels.userId, userId)));
    }
  }
}

let running = false;

/** Lo llama el programador cada minuto. */
export async function voiceXpTick(client: Client): Promise<void> {
  if (running) return;
  running = true;
  try {
    for (const guild of client.guilds.cache.values()) {
      try {
        await tickGuild(guild);
      } catch (error) {
        console.error(`[VOZ] Error dando XP por voz en ${guild.name}:`, error);
      }
    }
  } finally {
    running = false;
  }
}
