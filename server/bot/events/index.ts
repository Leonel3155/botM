import { DiscordBot } from '../index';
import { Events, Guild, GuildMember, Message, PartialGuildMember, type PartialMessage } from 'discord.js';
import { storage } from '../../storage';
import { getGuildSettings, warmGuildSettings } from '../services/guildSettings';
import { handleMemberAvailable, handleMemberPassedScreening, handleMemberWelcome } from '../services/welcome';
import { ensureAccount, formatCoins, getPrestigeLevel, grantActivityRewards } from '../services/economy';
import { filterMessage } from '../services/autoMod';
import { handleStarReaction } from '../services/starboard';
import { sendServerLog } from '../services/serverLog';
import { truncate } from '../services/channels';
import { awardXp, getLevelRow, levelUpReward, randomMessageXp } from '../services/levels';
import { getTuning } from '../services/extras';
import { applyLevelRoles, isNoXp, scaleXp, sendLevelUpNotice } from '../services/levelUp';
import { TUNING_NUMBER_LIMITS } from '@shared/tuning';

// Último mensaje premiado de cada persona: la espera entre mensajes que dan XP/monedas se ajusta en el
// panel (evita farmear con spam)
const lastRewardAt = new Map<string, number>();
// Al limpiar la memoria se usa la espera más larga que permite el panel
const MAX_XP_COOLDOWN_MS = TUNING_NUMBER_LIMITS.xpCooldownSeconds.max * 1000;

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

  // Carga los miembros de cada servidor: sin ellos en caché, discord.js no sabe cómo estaba alguien
  // antes de un cambio y se pierden el registro de roles y el fin de un aislamiento quitado desde Discord
  const loadMembers = (guild: Guild) => {
    guild.members.fetch().catch((error) =>
      console.warn(`No se pudieron cargar los miembros de ${guild.name}:`, error));
  };
  const loadAllMembers = () => {
    for (const guild of bot.client.guilds.cache.values()) {
      if (guild.available) loadMembers(guild);
    }
  };
  if (bot.client.isReady()) loadAllMembers();
  else bot.client.once(Events.ClientReady, loadAllMembers);
  bot.client.on(Events.GuildCreate, loadMembers);
  // Servidor que vuelve después de una caída o reconexión (al arrancar ya lo cubre ClientReady)
  bot.client.on(Events.GuildAvailable, (guild) => {
    if (bot.client.isReady()) loadMembers(guild);
  });

  // XP y monedas por participar
  bot.client.on(Events.MessageCreate, async (message: Message) => {
    if (message.author.bot || !message.guild) return;

    // Filtro de palabras e invitaciones: un mensaje borrado no da XP
    try {
      if (await filterMessage(message)) return;
    } catch (error) {
      console.error('Error en el filtro de mensajes:', error);
    }

    const userId = message.author.id;
    const guildId = message.guild.id;

    try {
      // Reglas del panel (Niveles y Economía): canales y roles sin XP, largo mínimo, espera, cantidades…
      const tuning = await getTuning(guildId);
      if (isNoXp(tuning, message.channel, message.member)) return;
      if (message.content.trim().length < tuning.xpMinMessageLength) return;

      const cooldownKey = `${guildId}:${userId}`;
      const now = Date.now();
      if (now - (lastRewardAt.get(cooldownKey) || 0) < tuning.xpCooldownSeconds * 1000) return;
      lastRewardAt.set(cooldownKey, now);
      // Limpieza ocasional para que el mapa no crezca sin límite
      if (lastRewardAt.size > 10_000) {
        for (const [key, at] of lastRewardAt) {
          if (now - at >= MAX_XP_COOLDOWN_MS) lastRewardAt.delete(key);
        }
      }

      // Crea servidor, usuario y cuenta si faltan
      await ensureAccount(message.guild, message.author);

      // XP al azar entre el mínimo y el máximo, con el bono de prestigio y el multiplicador del servidor.
      // Con la XP apagada en el panel no se gana XP, pero las monedas por platicar siguen.
      let previousLevel: number;
      let level: number;
      if (tuning.xpEnabled) {
        const prestige = await getPrestigeLevel(guildId, userId);
        ({ previousLevel, level } = await awardXp(guildId, userId, scaleXp(randomMessageXp(tuning), tuning, prestige)));
      } else {
        previousLevel = level = (await getLevelRow(guildId, userId))?.level ?? 1;
      }
      const leveledUp = level > previousLevel;

      // Monedas y boletos por participar (escalan con el nivel), más los premios de subir de nivel.
      // Si la economía está apagada desde el panel, solo se gana XP.
      const settings = await getGuildSettings(guildId);
      const economyOn = settings?.economyEnabled !== false;
      const lucky = economyOn && tuning.luckyCoins > 0 && Math.random() * 100 < tuning.luckyChancePercent;
      const reward = leveledUp ? levelUpReward(level, tuning) : { coins: 0, tickets: 0 };
      if (economyOn) {
        const coinGain = Math.floor(((Math.floor(Math.random() * (level * 3)) + level) * tuning.messageCoinsPercent) / 100);
        const ticketGain = Math.random() < 0.1 ? 2 : 1;
        await grantActivityRewards(
          guildId,
          userId,
          coinGain + (lucky ? tuning.luckyCoins : 0) + reward.coins,
          ticketGain + reward.tickets
        );
      }

      // Roles por nivel: se dan aunque los avisos estén apagados
      const member = leveledUp && tuning.levelRoleRewards.length > 0
        ? message.member ?? await message.guild.members.fetch(userId).catch(() => null)
        : null;
      const newRoles = member ? await applyLevelRoles(member, level, tuning) : [];

      if (!leveledUp && !lucky) return;
      // El panel permite apagar los avisos del bot en el chat
      if (settings?.levelUpMessages === false) return;

      const luckyText = lucky ? `\n🍀 ¡Golpe de suerte! Encontraste **${formatCoins(tuning.luckyCoins)}** extra.` : '';

      if (leveledUp) {
        await sendLevelUpNotice({
          guild: message.guild,
          userId,
          displayName: message.member?.displayName ?? message.author.displayName,
          level,
          reward: economyOn ? reward : null,
          newRoles,
          fallbackChannel: message.inGuild() ? message.channel : null,
          tuning,
          extra: luckyText,
        });
      } else if (message.channel.isSendable()) {
        await message.channel.send({
          content: `<@${userId}>${luckyText}`,
          allowedMentions: { users: tuning.levelUpPing ? [userId] : [] },
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
    try {
      // Miembro que no estaba en caché (p. ej. tras reiniciar el bot): no se sabe si antes estaba
      // pendiente, así que se revisa si le falta el rol automático (con Partials.GuildMember
      // discord.js ya no emite GuildMemberAvailable en este caso)
      if (oldMember.partial) {
        await handleMemberAvailable(newMember);
        return;
      }
      if (!oldMember.pending || newMember.pending) return;
      await handleMemberPassedScreening(newMember);
    } catch (error) {
      console.error('Welcome role error:', error);
    }
  });

  // Un mensaje editado también pasa por el filtro, y la edición queda en el registro
  bot.client.on(Events.MessageUpdate, async (oldMessage, newMessage) => {
    if (!newMessage.guild) return;
    try {
      const message = newMessage.partial ? await newMessage.fetch() : newMessage;
      if (message.author.bot) return;
      if (await filterMessage(message)) return;
      if (oldMessage.partial || oldMessage.content === message.content) return;
      void sendServerLog(message.guild!, 'messageEdit', (embed) => embed
        .setTitle('✏️ Mensaje editado')
        .setDescription(`<@${message.author.id}> en <#${message.channelId}> · [Ir al mensaje](${message.url})`)
        .addFields(
          { name: 'Antes', value: truncate(oldMessage.content || '*(vacío)*', 1000) },
          { name: 'Ahora', value: truncate(message.content || '*(vacío)*', 1000) },
        ));
    } catch (error) {
      console.error('Error al revisar un mensaje editado:', error);
    }
  });

  bot.client.on(Events.MessageDelete, async (message: Message | PartialMessage) => {
    if (!message.guild || message.author?.bot) return;
    void sendServerLog(message.guild, 'messageDelete', (embed) => {
      embed.setTitle('🗑️ Mensaje borrado');
      if (message.partial) {
        return embed.setDescription(`En <#${message.channelId}>. Era de antes de que el bot arrancara, así que no sé qué decía.`);
      }
      const files = message.attachments.map((file) => file.name).join(', ');
      return embed
        .setDescription(`De <@${message.author.id}> en <#${message.channelId}>`)
        .addFields(
          { name: 'Mensaje', value: truncate(message.content || '*(sin texto)*', 1000) },
          ...(files ? [{ name: 'Archivos', value: truncate(files, 1000) }] : []),
        );
    });
  });

  bot.client.on(Events.GuildMemberAdd, (member: GuildMember) => {
    const created = Math.floor(member.user.createdTimestamp / 1000);
    void sendServerLog(member.guild, 'memberJoin', (embed) => embed
      .setTitle('📥 Entró alguien')
      .setThumbnail(member.user.displayAvatarURL())
      .setDescription(`<@${member.id}> (${member.user.tag})
Cuenta creada <t:${created}:R>`)
      .setFooter({ text: `Ahora son ${member.guild.memberCount}` }));
  });

  bot.client.on(Events.GuildMemberRemove, (member: GuildMember | PartialGuildMember) => {
    const roles = member.partial ? '' : member.roles.cache.filter((role) => role.id !== member.guild.id).map((role) => `<@&${role.id}>`).join(' ');
    void sendServerLog(member.guild, 'memberLeave', (embed) => embed
      .setTitle('📤 Se fue alguien')
      .setThumbnail(member.user.displayAvatarURL())
      .setDescription(`<@${member.id}> (${member.user.tag})${roles ? `
Tenía: ${truncate(roles, 900)}` : ''}`)
      .setFooter({ text: `Ahora son ${member.guild.memberCount}` }));
  });

  bot.client.on(Events.GuildMemberUpdate, (oldMember: GuildMember | PartialGuildMember, newMember: GuildMember) => {
    if (oldMember.partial) return;
    const added = newMember.roles.cache.filter((role) => !oldMember.roles.cache.has(role.id));
    const removed = oldMember.roles.cache.filter((role) => !newMember.roles.cache.has(role.id));
    if (added.size === 0 && removed.size === 0) return;
    void sendServerLog(newMember.guild, 'roles', (embed) => embed
      .setTitle('🎭 Cambiaron sus roles')
      .setDescription(`<@${newMember.id}>`)
      .addFields(
        ...(added.size ? [{ name: 'Agregados', value: truncate(added.map((role) => `<@&${role.id}>`).join(' '), 1000) }] : []),
        ...(removed.size ? [{ name: 'Quitados', value: truncate(removed.map((role) => `<@&${role.id}>`).join(' '), 1000) }] : []),
      ));
  });

  // Starboard
  bot.client.on(Events.MessageReactionAdd, (reaction) => {
    void handleStarReaction(reaction);
  });
  bot.client.on(Events.MessageReactionRemove, (reaction) => {
    void handleStarReaction(reaction);
  });
}
