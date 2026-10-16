// /recordar, /encuesta, /confesar y /confesion (autor, solo admins)
import {
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  type GuildMember,
} from 'discord.js';
import { and, eq, sql } from 'drizzle-orm';
import { confessions, guildExtras, type GuildExtras } from '@shared/schema';
import { db } from '../../db';
import type { DiscordBot } from '../index';
import type { BotCommand } from './index';
import {
  countUserReminders,
  createReminder,
  deleteUserReminder,
  findReminderChannel,
  listUserReminders,
  parseDuration,
  REMINDER_LIMITS,
} from '../services/reminders';
import { getExtrasQuick, getExtrasSafe, forgetExtras } from '../services/extras';
import { checkMemberCanPost, resolveSendableChannel, truncate } from '../services/channels';
import { checkMessageText, type FilterHit } from '../services/autoMod';
import { storage } from '../../storage';

function unix(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

const FILTER_REASON: Record<FilterHit['kind'], string> = {
  word: 'tiene palabras que no están permitidas en este servidor',
  invite: 'tiene una invitación a otro servidor',
  link: 'tiene un enlace, y aquí no se permiten',
};

// Igual que el filtro del chat: quien gestiona mensajes y los roles exentos no pasan por él
function skipsFilter(member: GuildMember, extras: GuildExtras): boolean {
  if (member.permissions.has(PermissionFlagsBits.ManageMessages) || member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  return extras.filterExemptRoleIds.some((roleId) => member.roles.cache.has(roleId));
}

export const recordar: BotCommand = {
  data: new SlashCommandBuilder()
    .setName('recordar')
    .setDescription('⏰ Te recuerdo algo más tarde')
    .addSubcommand((sub) => sub
      .setName('crear')
      .setDescription('Crea un recordatorio')
      .addStringOption((option) => option.setName('en').setDescription('¿En cuánto tiempo? Ej.: 10m, 2h, 1d, 1h30m').setRequired(true).setMaxLength(40))
      .addStringOption((option) => option.setName('que').setDescription('¿Qué te recuerdo?').setRequired(true).setMaxLength(REMINDER_LIMITS.textMax)))
    .addSubcommand((sub) => sub.setName('lista').setDescription('Tus recordatorios pendientes'))
    .addSubcommand((sub) => sub
      .setName('borrar')
      .setDescription('Borra un recordatorio')
      .addStringOption((option) => option.setName('recordatorio').setDescription('¿Cuál?').setRequired(true).setAutocomplete(true))),

  async execute(interaction: ChatInputCommandInteraction, _bot: DiscordBot) {
    const guildId = interaction.guildId!;
    const subcommand = interaction.options.getSubcommand();
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (subcommand === 'crear') {
      const ms = parseDuration(interaction.options.getString('en', true));
      if (!ms || ms < 60_000) {
        await interaction.editReply('❌ No entendí el tiempo. Usa algo como `10m`, `2h`, `1d` o `1h30m` (mínimo 1 minuto).');
        return;
      }
      if (ms > REMINDER_LIMITS.maxDays * 86_400_000) {
        await interaction.editReply(`❌ Lo más lejano que puedo recordarte es en ${REMINDER_LIMITS.maxDays} días.`);
        return;
      }
      if (await countUserReminders(guildId, interaction.user.id) >= REMINDER_LIMITS.perUser) {
        await interaction.editReply(`❌ Ya tienes ${REMINDER_LIMITS.perUser} recordatorios pendientes. Borra alguno con \`/recordar borrar\`.`);
        return;
      }
      const text = interaction.options.getString('que', true).trim();
      // El bot lo publica después en este canal (y el filtro no revisa mensajes del bot): se revisa ahora
      const guild = interaction.guild;
      const member = guild ? guild.members.cache.get(interaction.user.id) ?? await guild.members.fetch(interaction.user.id).catch(() => null) : null;
      const here = guild?.channels.cache.get(interaction.channelId);
      if (!guild || !member || !here?.isTextBased()) {
        await interaction.editReply('❌ No pude revisar tus permisos en este canal. Intenta de nuevo en un momento.');
        return;
      }
      if (!checkMemberCanPost(member, here).ok) {
        await interaction.editReply('❌ No puedes escribir en este canal, así que no te dejo el recordatorio aquí. Úsalo en un canal donde sí puedas escribir.');
        return;
      }
      const extras = await getExtrasSafe(guildId);
      const hit = extras.filterEnabled && !skipsFilter(member, extras) ? checkMessageText(text, extras) : null;
      if (hit) {
        await interaction.editReply(`❌ Ese recordatorio ${FILTER_REASON[hit.kind]}.`);
        return;
      }
      const dueAt = new Date(Date.now() + ms);
      await createReminder({ guildId, channelId: interaction.channelId, userId: interaction.user.id, text, dueAt });
      const where = findReminderChannel(guild, interaction.channelId)
        ? 'en este canal'
        : 'por mensaje directo, porque no puedo escribir en este canal (revisa que tengas abiertos los mensajes directos de este servidor)';
      await interaction.editReply(`⏰ Listo, te lo recuerdo <t:${unix(dueAt)}:R> (<t:${unix(dueAt)}:f>) ${where}.`);
      return;
    }

    if (subcommand === 'lista') {
      const rows = await listUserReminders(guildId, interaction.user.id);
      if (rows.length === 0) {
        await interaction.editReply('No tienes recordatorios pendientes. Crea uno con `/recordar crear`.');
        return;
      }
      const lines = rows.map((row) => `• <t:${unix(row.dueAt)}:R>: ${truncate(row.text, 120)}`);
      await interaction.editReply(truncate(`⏰ **Tus recordatorios**\n${lines.join('\n')}`, 2000));
      return;
    }

    const removed = await deleteUserReminder(guildId, interaction.user.id, interaction.options.getString('recordatorio', true));
    await interaction.editReply(removed ? '🗑️ Recordatorio borrado.' : 'No encontré ese recordatorio (quizá ya se envió).');
  },

  async autocomplete(interaction: AutocompleteInteraction) {
    const typed = interaction.options.getFocused().toLowerCase();
    const rows = await listUserReminders(interaction.guildId!, interaction.user.id);
    await interaction.respond(rows
      .filter((row) => row.text.toLowerCase().includes(typed))
      .slice(0, 25)
      .map((row) => ({ name: truncate(`${row.dueAt.toISOString().slice(0, 16).replace('T', ' ')} UTC · ${row.text}`, 100), value: row.id })));
  },
};

export const encuesta: BotCommand = {
  data: new SlashCommandBuilder()
    .setName('encuesta')
    .setDescription('📊 Crea una encuesta con botones de Discord')
    .addStringOption((option) => option.setName('pregunta').setDescription('La pregunta').setRequired(true).setMaxLength(300))
    .addStringOption((option) => option.setName('opciones').setDescription('Opciones separadas con ; (de 2 a 10). Ej.: Pizza; Tacos; Sushi').setRequired(true).setMaxLength(600))
    .addIntegerOption((option) => option.setName('horas').setDescription('Cuánto dura (1 a 768 horas; 24 si lo dejas vacío)').setMinValue(1).setMaxValue(768))
    .addBooleanOption((option) => option.setName('varias').setDescription('¿Se puede votar por varias opciones?')),

  async execute(interaction: ChatInputCommandInteraction, _bot: DiscordBot) {
    const question = interaction.options.getString('pregunta', true).trim();
    const answers = interaction.options.getString('opciones', true)
      .split(';')
      .map((answer) => answer.trim())
      .filter(Boolean);
    const unique = [...new Map(answers.map((answer) => [answer.toLowerCase(), answer])).values()];
    if (unique.length < 2 || unique.length > 10) {
      await interaction.reply({ content: '❌ Pon entre 2 y 10 opciones distintas, separadas con `;`. Ej.: `Pizza; Tacos; Sushi`', flags: MessageFlags.Ephemeral });
      return;
    }
    const tooLong = unique.find((answer) => answer.length > 55);
    if (tooLong) {
      await interaction.reply({ content: `❌ Cada opción puede tener hasta 55 letras; "${truncate(tooLong, 60)}" es más larga.`, flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.reply({
      poll: {
        question: { text: question },
        answers: unique.map((text) => ({ text })),
        duration: interaction.options.getInteger('horas') ?? 24,
        allowMultiselect: interaction.options.getBoolean('varias') ?? false,
      },
    });
  },
};

export const confesar: BotCommand = {
  data: new SlashCommandBuilder()
    .setName('confesar')
    .setDescription('🤫 Manda una confesión anónima al canal de confesiones')
    .addStringOption((option) => option.setName('texto').setDescription('Tu confesión (nadie verá quién la escribió)').setRequired(true).setMaxLength(1500)),

  async execute(interaction: ChatInputCommandInteraction, _bot: DiscordBot) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const guild = interaction.guild;
    const guildId = interaction.guildId!;
    const extras = await getExtrasQuick(guildId);
    if (!guild || !extras.confessionsEnabled || !extras.confessionsChannelId) {
      await interaction.editReply('🤫 Las confesiones están apagadas en este servidor (un admin las activa en el panel, en Diversión).');
      return;
    }
    const text = interaction.options.getString('texto', true).trim();
    // Palabras, invitaciones y enlaces, igual que en el chat (el filtro no revisa lo que publica el bot)
    const hit = extras.filterEnabled ? checkMessageText(text, extras) : null;
    if (hit) {
      await interaction.editReply(`❌ Tu confesión ${FILTER_REASON[hit.kind]}.`);
      return;
    }
    const channel = resolveSendableChannel(guild, extras.confessionsChannelId);
    if (!channel.ok) {
      await interaction.editReply(`❌ No puedo publicar en el canal de confesiones: ${channel.reason}`);
      return;
    }
    const member = await guild.members.fetch(interaction.user.id).catch(() => null);
    if (member && !checkMemberCanPost(member, channel.channel).ok) {
      await interaction.editReply('❌ No tienes permiso para escribir en el canal de confesiones.');
      return;
    }

    // Número de la confesión (atómico) y registro privado del autor
    const [counter] = await db.update(guildExtras)
      .set({ confessionsCount: sql`${guildExtras.confessionsCount} + 1` })
      .where(eq(guildExtras.guildId, guildId))
      .returning({ number: guildExtras.confessionsCount });
    forgetExtras(guildId);
    const number = counter?.number ?? 1;
    const embed = new EmbedBuilder()
      .setColor(0x9B59B6)
      .setTitle(`🤫 Confesión #${number}`)
      .setDescription(text)
      .setFooter({ text: 'Manda la tuya con /confesar' })
      .setTimestamp();
    const sent = await channel.channel.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => null);
    if (!sent) {
      await interaction.editReply('❌ No pude publicar tu confesión. Avísale a un admin que revise mis permisos en ese canal.');
      return;
    }
    await db.insert(confessions).values({ guildId, number, userId: interaction.user.id, messageId: sent.id }).onConflictDoNothing();
    await interaction.editReply(`✅ Publiqué tu confesión #${number} en <#${channel.channel.id}>. Nadie más ve quién la escribió (solo los admins, en caso de abuso).`);
  },
};

export const confesion: BotCommand = {
  data: new SlashCommandBuilder()
    .setName('confesion')
    .setDescription('🔎 (Admins) Quién escribió una confesión, para casos de abuso')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((sub) => sub
      .setName('autor')
      .setDescription('Quién escribió una confesión')
      .addIntegerOption((option) => option.setName('numero').setDescription('Número de la confesión').setRequired(true).setMinValue(1))),

  async execute(interaction: ChatInputCommandInteraction, _bot: DiscordBot) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      await interaction.editReply('⛔ Solo los administradores pueden ver quién escribió una confesión.');
      return;
    }
    const number = interaction.options.getInteger('numero', true);
    const [row] = await db.select().from(confessions)
      .where(and(eq(confessions.guildId, interaction.guildId!), eq(confessions.number, number)));
    if (!row) {
      await interaction.editReply(`No encontré la confesión #${number}.`);
      return;
    }
    console.log(`[CONFESIONES] ${interaction.user.tag} consultó el autor de la confesión #${number} en ${interaction.guild?.name}.`);
    const author = await interaction.client.users.fetch(row.userId).catch(() => null);
    await storage.logModerationAction({
      guild: { id: interaction.guildId!, name: interaction.guild?.name ?? interaction.guildId!, ownerId: interaction.guild?.ownerId ?? '' },
      target: { id: row.userId, username: author?.username ?? row.userId, avatar: author?.avatar ?? null },
      moderator: interaction.user,
      type: 'confession_lookup',
      reason: `Consultó quién escribió la confesión #${number}`,
      active: false,
    }).catch(() => undefined);
    await interaction.editReply(`🔎 La confesión #${number} la escribió <@${row.userId}> (${row.userId}). Esta consulta quedó en el historial de moderación.`);
  },
};

export const comunidadExtraCommands: BotCommand[] = [recordar, encuesta, confesar, confesion];
