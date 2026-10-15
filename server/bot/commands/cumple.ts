import { EmbedBuilder, MessageFlags, SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import type { DiscordBot } from '../index';
import type { BotCommand } from './index';
import {
  daysUntil,
  formatBirthday,
  getBirthday,
  isValidBirthday,
  listBirthdays,
  MONTH_NAMES,
  removeBirthday,
  setBirthday,
} from '../services/birthdays';
import { getExtrasQuick } from '../services/extras';
import { getGuildSettings } from '../services/guildSettings';
import { getZonedParts, resolveTimezone } from '../services/timezone';

export const cumple: BotCommand = {
  data: new SlashCommandBuilder()
    .setName('cumple')
    .setDescription('🎂 Cumpleaños del servidor')
    .addSubcommand((sub) => sub
      .setName('guardar')
      .setDescription('Guarda tu fecha de cumpleaños (sin el año)')
      .addIntegerOption((option) => option.setName('dia').setDescription('Día (1-31)').setRequired(true).setMinValue(1).setMaxValue(31))
      .addIntegerOption((option) => option.setName('mes').setDescription('Mes').setRequired(true)
        .addChoices(...MONTH_NAMES.map((name, index) => ({ name, value: index + 1 })))))
    .addSubcommand((sub) => sub.setName('borrar').setDescription('Borra tu fecha de cumpleaños'))
    .addSubcommand((sub) => sub
      .setName('ver')
      .setDescription('Mira el cumpleaños de alguien')
      .addUserOption((option) => option.setName('usuario').setDescription('¿De quién? (tú si lo dejas vacío)')))
    .addSubcommand((sub) => sub.setName('proximos').setDescription('Los próximos cumpleaños del servidor')),

  async execute(interaction: ChatInputCommandInteraction, _bot: DiscordBot) {
    const guildId = interaction.guildId!;
    const subcommand = interaction.options.getSubcommand();
    const extras = await getExtrasQuick(guildId);
    const off = extras.birthdaysEnabled ? '' : '\n\nℹ️ Los cumpleaños todavía están apagados en este servidor: un admin los activa en el panel (Diversión).';

    if (subcommand === 'guardar') {
      const day = interaction.options.getInteger('dia', true);
      const month = interaction.options.getInteger('mes', true);
      if (!isValidBirthday(month, day)) {
        await interaction.reply({ content: `❌ ${MONTH_NAMES[month - 1]} no tiene ${day} días.`, flags: MessageFlags.Ephemeral });
        return;
      }
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      await setBirthday(guildId, interaction.user.id, month, day);
      await interaction.editReply(`🎂 Listo, guardé tu cumpleaños: **${formatBirthday(month, day)}**.${off}`);
      return;
    }

    if (subcommand === 'borrar') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const removed = await removeBirthday(guildId, interaction.user.id);
      await interaction.editReply(removed ? '🗑️ Borré tu fecha de cumpleaños.' : 'No tenías un cumpleaños guardado.');
      return;
    }

    if (subcommand === 'ver') {
      const user = interaction.options.getUser('usuario') ?? interaction.user;
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const row = await getBirthday(guildId, user.id);
      const who = user.id === interaction.user.id ? 'Tu cumpleaños' : `El cumpleaños de **${user.displayName}**`;
      await interaction.editReply(row
        ? `🎂 ${who} es el **${formatBirthday(row.month, row.day)}**.`
        : user.id === interaction.user.id
          ? 'No has guardado tu cumpleaños. Usa `/cumple guardar`.'
          : `**${user.displayName}** no ha guardado su cumpleaños.`);
      return;
    }

    // proximos
    await interaction.deferReply();
    const settings = await getGuildSettings(guildId);
    const local = getZonedParts(new Date(), resolveTimezone(settings?.timezone));
    const rows = (await listBirthdays(guildId))
      .filter((row) => interaction.guild?.members.cache.has(row.userId) ?? true)
      .map((row) => ({ row, days: daysUntil(row, local.year, local.month, local.day) }))
      .sort((a, b) => a.days - b.days)
      .slice(0, 10);
    if (rows.length === 0) {
      await interaction.editReply(`Nadie ha guardado su cumpleaños todavía. ¡Sé el primero con \`/cumple guardar\`!${off}`);
      return;
    }
    const lines = rows.map(({ row, days }) => {
      const when = days === 0 ? '**¡hoy!** 🎉' : days === 1 ? 'mañana' : `en ${days} días`;
      return `• <@${row.userId}>: ${formatBirthday(row.month, row.day)} (${when})`;
    });
    const embed = new EmbedBuilder().setColor(0xFF6FAE).setTitle('🎂 Próximos cumpleaños').setDescription(lines.join('\n') + off);
    await interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } });
  },
};
