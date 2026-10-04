import { DiscordBot } from '../index';
import { Events, GuildMember, Message } from 'discord.js';
import { storage } from '../../storage';

// Tiempo mínimo entre mensajes que dan XP/monedas (evita farmear con spam)
const XP_COOLDOWN_MS = 60_000;
const lastRewardAt = new Map<string, number>();

export function setupEvents(bot: DiscordBot) {
  // Message XP system
  bot.client.on(Events.MessageCreate, async (message: Message) => {
    if (message.author.bot || !message.guild) return;

    const userId = message.author.id;
    const guildId = message.guild.id;

    const cooldownKey = `${guildId}:${userId}`;
    const now = Date.now();
    if (now - (lastRewardAt.get(cooldownKey) || 0) < XP_COOLDOWN_MS) return;
    lastRewardAt.set(cooldownKey, now);

    try {
      await storage.ensureGuild(guildId, message.guild.name, message.guild.ownerId);
      await storage.upsertUser({
        id: userId,
        username: message.author.username,
        avatar: message.author.avatar
      });

      const previousLevel = (await storage.getUserLevel(userId, guildId))?.level || 1;

      // Award XP (15-25 per message)
      const xpGain = Math.floor(Math.random() * 11) + 15;
      const updatedLevel = await storage.updateUserXP(userId, guildId, xpGain);
      const level = updatedLevel.level || 1;

      // Monedas y boletos por participar (escalan con el nivel)
      const coinGain = Math.floor(Math.random() * (level * 3)) + level;
      const ticketGain = Math.random() < 0.1 ? 2 : 1;
      await storage.addCoins(userId, guildId, coinGain);
      await storage.addLotteryTickets(userId, guildId, ticketGain);

      // Objeto raro (0.5% por mensaje)
      let rareDropMessage = '';
      if (Math.random() < 0.005) {
        const rareDrop = await storage.giveRandomRareItem(userId, guildId, level);
        if (rareDrop) {
          rareDropMessage = `\n✨ **RARE DROP!** ${rareDrop.emoji} ${rareDrop.name} (${rareDrop.rarity})`;
        }
      }

      if (level > previousLevel) {
        const levelReward = Math.floor(level * level * 50); // n² × 50 coins
        const bonusTickets = Math.floor(level / 5) + 1;
        const prestigeBonus = level >= 100 ? '\n🏆 **PRESTIGE ELIGIBLE!** Use `/prestige`' : '';

        await storage.addCoins(userId, guildId, levelReward);
        await storage.addLotteryTickets(userId, guildId, bonusTickets);

        let levelMessage = `🎉 <@${userId}> **LEVEL UP!** Level **${level}**!${prestigeBonus}`;

        if (level === 10) levelMessage += '\n🏆 **First milestone - Economy unlocked!**';
        else if (level === 25) levelMessage += '\n⭐ **Quarter century - VIP status!**';
        else if (level === 50) levelMessage += '\n🌟 **Halfway to prestige!**';
        else if (level === 75) levelMessage += '\n💎 **Diamond tier reached!**';
        else if (level === 100) levelMessage += '\n🚀 **MAX LEVEL! Prestige available!**';
        else if (level > 100) levelMessage += '\n🌌 **LEGENDARY STATUS!**';

        levelMessage += `\n💰 **+${levelReward.toLocaleString()} coins** • 🎫 **+${bonusTickets} tickets** • ⚡ **${level}x earning power!**`;

        if (message.channel.isSendable()) {
          await message.channel.send(levelMessage + rareDropMessage);
        }
      } else if (rareDropMessage && message.channel.isSendable()) {
        await message.channel.send(`<@${userId}>${rareDropMessage}`);
      }
    } catch (error) {
      console.error('XP system error:', error);
    }
  });

  // Nuevo miembro: registrarlo (upsert, así no falla si vuelve a entrar)
  bot.client.on(Events.GuildMemberAdd, async (member: GuildMember) => {
    try {
      await storage.ensureGuild(member.guild.id, member.guild.name, member.guild.ownerId);
      await storage.upsertUser({
        id: member.user.id,
        username: member.user.username,
        avatar: member.user.avatar
      });
    } catch (error) {
      console.error('GuildMemberAdd error:', error);
    }
  });
}
