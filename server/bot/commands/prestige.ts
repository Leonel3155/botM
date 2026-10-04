import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  MessageFlags,
} from 'discord.js';
import { DiscordBot } from '../index';
import { economyTask, ensureAccount, formatCoins, getPrestigeLevel } from '../services/economy';
import {
  MESSAGE_XP_MAX,
  MESSAGE_XP_MIN,
  PRESTIGE_MAX_BONUS_LEVELS,
  PRESTIGE_MIN_LEVEL,
  PRESTIGE_XP_BONUS,
  applyPrestige,
  formatMultiplier,
  getLevelRow,
  levelUpReward,
  prestigeMultiplier,
  rowTotalXp,
  xpForLevelStep,
  xpToReachLevel,
} from '../services/levels';
import { resolveGuild, respond } from '../utils/interactions';

const CONFIRM_TIMEOUT_MS = 30_000;

export const prestigeCommands = [
  {
    data: new SlashCommandBuilder()
      .setName('prestige')
      .setDescription(`🌟 Reinicia tu nivel a cambio de más XP para siempre (desde el nivel ${PRESTIGE_MIN_LEVEL})`),

    async execute(interaction: ChatInputCommandInteraction, bot: DiscordBot) {
      const userId = interaction.user.id;
      const guildId = interaction.guildId!;

      await interaction.deferReply();
      const row = await getLevelRow(guildId, userId);
      const currentLevel = row?.level ?? 1;

      if (currentLevel < PRESTIGE_MIN_LEVEL) {
        const missing = Math.max(xpToReachLevel(PRESTIGE_MIN_LEVEL) - rowTotalXp(row), 0);
        await respond(
          interaction,
          `🔒 Necesitas llegar al nivel **${PRESTIGE_MIN_LEVEL}** para prestigiar. Vas en el nivel **${currentLevel}** (te faltan ${missing.toLocaleString('es-MX')} XP). ¡Sigue platicando!`,
          { ephemeral: true }
        );
        return;
      }

      await ensureAccount(await resolveGuild(interaction), interaction.user);
      const prestige = await getPrestigeLevel(guildId, userId);
      const before = prestigeMultiplier(prestige);
      const after = prestigeMultiplier(prestige + 1);
      const bonusText = after > before
        ? `${formatMultiplier(before)} → **${formatMultiplier(after)}**`
        : `**${formatMultiplier(after)}** (ya tienes el máximo)`;

      const ids = { confirm: `prestige:yes:${interaction.id}`, cancel: `prestige:no:${interaction.id}` };
      const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(ids.confirm).setLabel('Sí, prestigiar').setEmoji('🌟').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(ids.cancel).setLabel('Cancelar').setStyle(ButtonStyle.Secondary)
      );

      const confirmEmbed = new EmbedBuilder()
        .setColor(0xFFD700)
        .setTitle('🌟 ¿Seguro que quieres prestigiar?')
        .setDescription(`Estás en el nivel **${currentLevel}**. Si confirmas, vuelves al nivel 1 y obtienes el prestigio **${prestige + 1}**.`)
        .addFields(
          { name: '✅ Conservas', value: '• Tus monedas (cartera y banco)\n• Tus boletos', inline: false },
          { name: '❌ Pierdes', value: '• Tu nivel (vuelves al 1)\n• Tu XP acumulada', inline: false },
          { name: '🚀 XP por mensaje', value: bonusText, inline: false }
        )
        .setFooter({ text: 'Tienes 30 segundos para confirmar.' });

      const message = await interaction.editReply({ embeds: [confirmEmbed], components: [buttons] });

      const choice = await new Promise<'confirm' | 'cancel' | 'timeout'>((resolve) => {
        let decided = false;
        const collector = message.createMessageComponentCollector({ componentType: ComponentType.Button, time: CONFIRM_TIMEOUT_MS });

        collector.on('collect', async (click) => {
          try {
            if (click.user.id !== userId) {
              await click.reply({ content: 'Solo quien usó `/prestige` puede responder aquí.', flags: MessageFlags.Ephemeral });
              return;
            }
            if (!decided) {
              decided = true;
              collector.stop(click.customId === ids.confirm ? 'confirm' : 'cancel');
            }
            await click.deferUpdate();
          } catch (error) {
            console.error('Prestigio: error al responder un botón:', error);
          }
        });

        collector.on('end', (_collected, reason) => {
          resolve(reason === 'confirm' ? 'confirm' : reason === 'cancel' ? 'cancel' : 'timeout');
        });
      });

      if (choice !== 'confirm') {
        await interaction.editReply({
          content: choice === 'cancel' ? '👌 Cancelado: no cambió nada.' : '⏰ Se acabó el tiempo: no cambió nada.',
          embeds: [],
          components: [],
        });
        return;
      }

      // El UPDATE es condicional (nivel >= 100): dos clics o dos /prestige a la vez solo prestigian una vez
      const result = await economyTask(guildId, userId, () => applyPrestige(guildId, userId));
      if (!result.ok) {
        await interaction.editReply({
          content: `ℹ️ No se hizo ningún cambio: ya no estás en el nivel ${PRESTIGE_MIN_LEVEL} o más (¿ya prestigiaste?).`,
          embeds: [],
          components: [],
        });
        return;
      }

      const doneEmbed = new EmbedBuilder()
        .setColor(0x57F287)
        .setTitle('🌟 ¡Prestigio conseguido!')
        .setDescription(`¡Felicidades, ${interaction.user}! Dejaste atrás el nivel **${currentLevel}** y ahora tienes el prestigio **${result.prestigeLevel}**.`)
        .addFields(
          { name: '⭐ Nivel', value: '1', inline: true },
          { name: '🚀 XP por mensaje', value: formatMultiplier(prestigeMultiplier(result.prestigeLevel)), inline: true }
        )
        .setTimestamp();
      await interaction.editReply({ content: '', embeds: [doneEmbed], components: [] });
    }
  },

  {
    data: new SlashCommandBuilder()
      .setName('levelrewards')
      .setDescription('🎁 Mira qué ganas al subir de nivel'),

    async execute(interaction: ChatInputCommandInteraction, bot: DiscordBot) {
      const examples = [5, 10, 25, 50, 100].map(level => {
        const reward = levelUpReward(level);
        return `**Nivel ${level}:** ${formatCoins(reward.coins)} + ${reward.tickets} ${reward.tickets === 1 ? 'boleto' : 'boletos'}`;
      });

      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('🎁 Premios por subir de nivel')
        .setDescription('Cada vez que subes de nivel recibes automáticamente:\n• **nivel² × 50** monedas\n• **nivel ÷ 5 + 1** boletos (redondeado hacia abajo)')
        .addFields(
          { name: 'Ejemplos', value: examples.join('\n'), inline: false },
          { name: `🌟 Nivel ${PRESTIGE_MIN_LEVEL}`, value: 'Desbloqueas `/prestige`: vuelves al nivel 1 y ganas más XP por mensaje.', inline: false }
        )
        .setFooter({ text: 'Además, cada mensaje te da unas cuantas monedas (más cuanto más alto sea tu nivel).' });

      await interaction.reply({ embeds: [embed] });
    }
  },

  {
    data: new SlashCommandBuilder()
      .setName('xpinfo')
      .setDescription('⚡ Cómo funciona el sistema de XP y niveles'),

    async execute(interaction: ChatInputCommandInteraction, bot: DiscordBot) {
      const steps = [2, 10, 50, 100].map(level => `• Nivel ${level}: ${xpForLevelStep(level).toLocaleString('es-MX')} XP`).join('\n');
      const maxBonus = Math.round(PRESTIGE_XP_BONUS * PRESTIGE_MAX_BONUS_LEVELS * 100);

      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('⚡ Sistema de XP')
        .addFields(
          { name: '📈 Cómo se gana', value: `• Cada mensaje da entre ${MESSAGE_XP_MIN} y ${MESSAGE_XP_MAX} XP\n• Solo cuenta un mensaje por minuto (para que el spam no sirva)`, inline: false },
          { name: '📊 Cada nivel pide 10 % más XP', value: `XP para subir a…\n${steps}\n• Para llegar al nivel ${PRESTIGE_MIN_LEVEL} hacen falta ${xpToReachLevel(PRESTIGE_MIN_LEVEL).toLocaleString('es-MX')} XP en total`, inline: false },
          { name: '🌟 Prestigio', value: `Desde el nivel ${PRESTIGE_MIN_LEVEL} puedes usar \`/prestige\`: vuelves al nivel 1 y cada prestigio te da +${Math.round(PRESTIGE_XP_BONUS * 100)} % de XP por mensaje (máximo +${maxBonus} %).`, inline: false }
        )
        .setFooter({ text: 'Usa /level para ver tu progreso.' });

      await interaction.reply({ embeds: [embed] });
    }
  }
];
