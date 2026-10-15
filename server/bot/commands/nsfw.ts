import { EmbedBuilder, MessageFlags, SlashCommandBuilder, type ChatInputCommandInteraction, type GuildTextBasedChannel } from 'discord.js';
import type { DiscordBot } from '../index';
import type { BotCommand } from './index';
import { getExtrasQuick } from '../services/extras';
import { checkNsfwAllowed, NSFW_CATEGORIES, nsfwSource, recordNsfwPost, type NsfwCategory } from '../services/nsfw';

// Una imagen cada 5 s por persona, para que nadie inunde el canal
const COOLDOWN_MS = 5_000;
const lastUse = new Map<string, number>();

export const nsfw: BotCommand = {
  data: new SlashCommandBuilder()
    .setName('nsfw')
    .setDescription('🔞 Imagen +18 (solo en canales +18 que un admin autorizó)')
    // Discord solo muestra el comando en canales con restricción de edad
    .setNSFW(true)
    .addStringOption((option) => option
      .setName('categoria')
      .setDescription('¿Qué tipo de imagen?')
      .setRequired(true)
      .addChoices(...NSFW_CATEGORIES.map((item) => ({ name: item.label, value: item.value })))),

  async execute(interaction: ChatInputCommandInteraction, _bot: DiscordBot) {
    const extras = await getExtrasQuick(interaction.guildId!);
    const channel = interaction.channel as GuildTextBasedChannel | null;
    const check = checkNsfwAllowed(extras, channel);
    if (!check.ok) {
      await interaction.reply({ content: check.reason, flags: MessageFlags.Ephemeral });
      return;
    }
    const key = `${interaction.guildId}:${interaction.user.id}`;
    const now = Date.now();
    if (now - (lastUse.get(key) ?? 0) < COOLDOWN_MS) {
      await interaction.reply({ content: '⏳ Espera unos segundos antes de pedir otra.', flags: MessageFlags.Ephemeral });
      return;
    }
    lastUse.set(key, now);
    if (lastUse.size > 5_000) lastUse.clear();

    await interaction.deferReply();
    const category = interaction.options.getString('categoria', true) as NsfwCategory;
    const url = await nsfwSource.image(category);
    if (!url) {
      await interaction.editReply('😵 No pude conseguir una imagen ahora. Intenta en un momento.');
      return;
    }
    const embed = new EmbedBuilder()
      .setColor(0xE91E63)
      .setImage(url)
      .setFooter({ text: `Pedido por ${interaction.user.displayName} · ${NSFW_CATEGORIES.find((item) => item.value === category)?.label}` });
    const message = await interaction.editReply({ embeds: [embed] });
    void recordNsfwPost({ guildId: interaction.guildId!, channelId: interaction.channelId, userId: interaction.user.id, category, url, messageId: message.id });
  },
};
