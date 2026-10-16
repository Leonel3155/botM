// XP por estar en canales de voz (se activa en el panel, en Niveles). Cada minuto, quien está en un
// canal de voz con al menos otra persona (sin contar bots; el mínimo se ajusta en el panel), sin
// ensordecerse y fuera del canal AFK, gana XP. Así no se puede farmear solo en un canal vacío.
import type { Client, Guild, GuildMember, VoiceBasedChannel } from 'discord.js';
import { eq, and, sql } from 'drizzle-orm';
import { userLevels } from '@shared/schema';
import { db } from '../../db';
import { storage } from '../../storage';
import { getExtrasSafe, tuningOf } from './extras';
import { awardXp, levelUpReward } from './levels';
import { ensureAccount, grantActivityRewards } from './economy';
import { getGuildSettings } from './guildSettings';
import { applyLevelRoles, isNoXp, scaleXp, sendLevelUpNotice } from './levelUp';
import type { GuildTuning } from '@shared/tuning';

/** Quiénes de ese canal ganan XP este minuto. */
export function eligibleVoiceMembers(channel: VoiceBasedChannel, afkChannelId: string | null, minMembers = 2): string[] {
  if (channel.id === afkChannelId) return [];
  const humans = channel.members.filter((member) => !member.user.bot);
  if (humans.size < minMembers) return [];
  return humans
    .filter((member) => !member.voice.selfDeaf && !member.voice.serverDeaf)
    .map((member) => member.id);
}

// Subir de nivel en voz da el mismo premio que por mensajes. Si no se paga aquí se pierde: el siguiente
// mensaje ya ve el nivel nuevo guardado y no lo cuenta como subida.
async function rewardVoiceLevelUp(channel: VoiceBasedChannel, member: GuildMember, level: number, tuning: GuildTuning) {
  const guild = channel.guild;
  const settings = await getGuildSettings(guild.id);
  const economyOn = settings?.economyEnabled !== false;
  const reward = levelUpReward(level, tuning);
  if (economyOn) {
    // Quien solo entra a voz puede no tener cuenta de economía todavía
    await ensureAccount(guild, member.user);
    await grantActivityRewards(guild.id, member.id, reward.coins, reward.tickets);
  }

  // Roles por nivel: se dan aunque los avisos estén apagados
  const newRoles = await applyLevelRoles(member, level, tuning);

  // El panel permite apagar los avisos del bot en el chat
  if (settings?.levelUpMessages === false) return;
  await sendLevelUpNotice({
    guild,
    userId: member.id,
    displayName: member.displayName,
    level,
    reward: economyOn ? reward : null,
    newRoles,
    // Sin canal de avisos elegido, se anuncia en el chat del canal de voz
    fallbackChannel: channel.isTextBased() ? channel : null,
    tuning,
  });
}

async function tickGuild(guild: Guild) {
  const extras = await getExtrasSafe(guild.id);
  if (!extras.voiceXpEnabled) return;
  const tuning = tuningOf(extras);
  if (!tuning.xpEnabled || tuning.voiceXpPerMinute <= 0) return;
  await storage.ensureGuild(guild.id, guild.name, guild.ownerId);
  const channels = guild.channels.cache.filter((channel): channel is VoiceBasedChannel => channel.isVoiceBased());
  for (const channel of channels.values()) {
    if (isNoXp(tuning, channel, null)) continue;
    for (const userId of eligibleVoiceMembers(channel, guild.afkChannelId, tuning.voiceXpMinMembers)) {
      const member = channel.members.get(userId);
      if (!member || isNoXp(tuning, null, member)) continue;
      await storage.upsertUser({ id: userId, username: member.user.username, avatar: member.user.avatar });
      // El multiplicador del servidor (doble XP) también cuenta en voz; el bono de prestigio es solo por mensajes
      const xp = scaleXp(tuning.voiceXpPerMinute, tuning, 0);
      const { previousLevel, level } = await awardXp(guild.id, userId, xp);
      await db.update(userLevels)
        .set({ voiceTime: sql`coalesce(${userLevels.voiceTime}, 0) + 1` })
        .where(and(eq(userLevels.guildId, guild.id), eq(userLevels.userId, userId)));
      if (level > previousLevel) await rewardVoiceLevelUp(channel, member, level, tuning);
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
