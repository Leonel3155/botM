import { DiscordBot } from '../index';
import { Events, GuildMember, Message, PartialGuildMember } from 'discord.js';
import { storage } from '../../storage';
import { getGuildSettings, warmGuildSettings } from '../services/guildSettings';
import { handleMemberAvailable, handleMemberPassedScreening, handleMemberWelcome } from '../services/welcome';
import { ensureAccount, formatCoins, getPrestigeLevel, grantActivityRewards } from '../services/economy';
import { MESSAGE_XP_MAX, MESSAGE_XP_MIN, PRESTIGE_MIN_LEVEL, awardXp, levelUpReward, prestigeMultiplier } from '../services/levels';

// Tiempo mínimo entre mensajes que dan XP/monedas (evita farmear con spam)
const XP_COOLDOWN_MS = 60_000;
const lastRewardAt = new Map<string, number>();

// Probabilidad de un "golpe de suerte" (monedas extra) por mensaje premiado
const LUCKY_CHANCE = 0.005;
const LUCKY_COINS = 100;

function milestoneText(level: number): string {
  if (level === 10) return '\n🏆 ¡Primer gran logro!';
  if (level === 25) return '\n⭐ ¡Ya llevas un cuarto del camino al prestigio!';
  if (level === 50) return '\n🌟 ¡Mitad del camino al prestigio!';
  if (level === 75) return '\n💎 ¡Nivel 75, qué constancia!';
  if (level === PRESTIGE_MIN_LEVEL) return '\n🚀 ¡Nivel 100! Ya puedes usar `/prestige`.';
  if (level > PRESTIGE_MIN_LEVEL) return '\n🌌 ¡Leyenda del servidor! Recuerda que puedes usar `/prestige`.';
  return '';
}

export function setupEvents(bot: DiscordBot) {
  // Precarga los ajustes de cada servidor para que el filtro de economía de los comandos de barra
  // responda desde memoria (corre antes de deferReply, dentro de los 3 s que da Discord)
  const warmAll = () => {
    void warmGuildSettings([...bot.client.guilds.cache.keys()]);
  };
  if (bot.client.isReady()) warmAll();
  else bot.client.once(Events.ClientReady, warmAll);
  bot.client.on(Events.GuildCreate, (guild) => {
    void warmGuildSettings([guild.id]);
  });

  // XP y monedas por participar
  bot.client.on(Events.MessageCreate, async (message: Message) => {
    if (message.author.bot || !message.guild) return;

    const userId = message.author.id;
    const guildId = message.guild.id;

    const cooldownKey = `${guildId}:${userId}`;
    const now = Date.now();
    if (now - (lastRewardAt.get(cooldownKey) || 0) < XP_COOLDOWN_MS) return;
    lastRewardAt.set(cooldownKey, now);
    // Limpieza ocasional para que el mapa no crezca sin límite
    if (lastRewardAt.size > 10_000) {
      for (const [key, at] of lastRewardAt) {
        if (now - at >= XP_COOLDOWN_MS) lastRewardAt.delete(key);
      }
    }

    try {
      // Crea servidor, usuario y cuenta si faltan
      await ensureAccount(message.guild, message.author);

      // XP (15-25 por mensaje) con el bono de prestigio: +10 % por prestigio, máximo x2
      const prestige = await getPrestigeLevel(guildId, userId);
      const baseXp = Math.floor(Math.random() * (MESSAGE_XP_MAX - MESSAGE_XP_MIN + 1)) + MESSAGE_XP_MIN;
      const xpGain = Math.round(baseXp * prestigeMultiplier(prestige));
      const { previousLevel, level } = await awardXp(guildId, userId, xpGain);
      const leveledUp = level > previousLevel;

      // Monedas y boletos por participar (escalan con el nivel), más los premios de subir de nivel.
      // Si la economía está apagada desde el panel, solo se gana XP.
      const settings = await getGuildSettings(guildId);
      const economyOn = settings?.economyEnabled !== false;
      const lucky = economyOn && Math.random() < LUCKY_CHANCE;
      const reward = leveledUp ? levelUpReward(level) : { coins: 0, tickets: 0 };
      if (economyOn) {
        const coinGain = Math.floor(Math.random() * (level * 3)) + level;
        const ticketGain = Math.random() < 0.1 ? 2 : 1;
        await grantActivityRewards(
          guildId,
          userId,
          coinGain + (lucky ? LUCKY_COINS : 0) + reward.coins,
          ticketGain + reward.tickets
        );
      }

      if (!leveledUp && !lucky) return;
      // El panel permite apagar los avisos del bot en el chat
      if (settings?.levelUpMessages === false) return;
      if (!message.channel.isSendable()) return;

      const luckyText = lucky ? `\n🍀 ¡Golpe de suerte! Encontraste **${formatCoins(LUCKY_COINS)}** extra.` : '';

      if (leveledUp) {
        const ticketsText = `${reward.tickets} ${reward.tickets === 1 ? 'boleto' : 'boletos'}`;
        const rewardText = economyOn ? `\n💰 +${formatCoins(reward.coins)} • 🎫 +${ticketsText}` : '';
        await message.channel.send({
          content: `🎉 ¡<@${userId}> subió al nivel **${level}**!${milestoneText(level)}${rewardText}${luckyText}`,
          allowedMentions: { users: [userId] },
        });
      } else {
        await message.channel.send({
          content: `<@${userId}>${luckyText}`,
          allowedMentions: { users: [userId] },
        });
      }
    } catch (error) {
      console.error('Error en el sistema de XP:', error);
    }
  });

  // Nuevo miembro: registrarlo (upsert, así no falla si vuelve a entrar) y darle la bienvenida
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

    try {
      await handleMemberWelcome(member);
    } catch (error) {
      console.error('Welcome error:', error);
    }
  });

  // Le quitaron el aislamiento antes de tiempo desde Discord (sin /unmute): su mute ya no está vigente.
  // (Cuando termina solo, Discord no avisa; el panel lo da por terminado al pasar su duración.)
  bot.client.on(Events.GuildMemberUpdate, async (oldMember: GuildMember | PartialGuildMember, newMember: GuildMember) => {
    const wasTimedOut = (oldMember.communicationDisabledUntilTimestamp ?? 0) > Date.now();
    if (!wasTimedOut || newMember.isCommunicationDisabled()) return;
    try {
      await storage.deactivateModerationActions(newMember.guild.id, newMember.id, 'mute');
    } catch (error) {
      console.error('No se pudo marcar el mute como terminado:', error);
    }
  });

  // Si el servidor pide aceptar las reglas, el rol automático se da al aceptarlas
  bot.client.on(Events.GuildMemberUpdate, async (oldMember: GuildMember | PartialGuildMember, newMember: GuildMember) => {
    if (!oldMember.pending || newMember.pending) return;
    try {
      await handleMemberPassedScreening(newMember);
    } catch (error) {
      console.error('Welcome role error:', error);
    }
  });

  // Mismo caso, pero cuando el miembro no estaba en caché (p. ej. tras reiniciar el bot):
  // discord.js no emite GuildMemberUpdate sino GuildMemberAvailable
  bot.client.on(Events.GuildMemberAvailable, async (member: GuildMember | PartialGuildMember) => {
    if (member.partial || member.pending) return;
    try {
      await handleMemberAvailable(member);
    } catch (error) {
      console.error('Welcome role error:', error);
    }
  });
}
