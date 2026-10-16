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
  applyPrestige,
  formatMultiplier,
  getLevelRow,
  levelUpReward,
  prestigeMultiplier,
  rowTotalXp,
  xpForLevelStep,
  xpToReachLevel,
} from '../services/levels';
import { isEconomyEnabledQuick } from '../services/guildSettings';
import { resolveGuild, respond } from '../utils/interactions';
import { getExtrasQuick, getTuning, tuningOf } from '../services/extras';
import { truncate } from '../services/channels';
import { formatWaitSeconds } from '@shared/tuning';

const CONFIRM_TIMEOUT_MS = 30_000;

export const prestigeCommands = [
  {
    data: new SlashCommandBuilder()
      .setName('prestige')
      .setDescription('🌟 Reinicia tu nivel a cambio de más XP para siempre'),

    async execute(interaction: ChatInputCommandInteraction, bot: DiscordBot) {
      const userId = interaction.user.id;
      const guildId = interaction.guildId!;

      await interaction.deferReply();
      const [row, tuning] = await Promise.all([getLevelRow(guildId, userId), getTuning(guildId)]);
      const currentLevel = row?.level ?? 1;
      const minLevel = tuning.prestigeMinLevel;

      if (currentLevel < minLevel) {
        const missing = Math.max(xpToReachLevel(minLevel) - rowTotalXp(row), 0);
        await respond(
          interaction,
          `🔒 Necesitas llegar al nivel **${minLevel}** para prestigiar. Vas en el nivel **${currentLevel}** (te faltan ${missing.toLocaleString('es-MX')} XP). ¡Sigue platicando!`,
          { ephemeral: true }
        );
        return;
      }

      await ensureAccount(await resolveGuild(interaction), interaction.user);
      const prestige = await getPrestigeLevel(guildId, userId);
      const before = prestigeMultiplier(prestige, tuning);
      const after = prestigeMultiplier(prestige + 1, tuning);
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

      // El UPDATE es condicional (nivel >= el mínimo): dos clics o dos /prestige a la vez solo prestigian una vez
      const result = await economyTask(guildId, userId, () => applyPrestige(guildId, userId, minLevel));
      if (!result.ok) {
        await interaction.editReply({
          content: `ℹ️ No se hizo ningún cambio: ya no estás en el nivel ${minLevel} o más (¿ya prestigiaste?).`,
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
          { name: '🚀 XP por mensaje', value: formatMultiplier(prestigeMultiplier(result.prestigeLevel, tuning)), inline: true }
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
      const guildId = interaction.guildId!;
      // Con la economía apagada desde el panel no se dan monedas ni boletos (el prestigio y los roles sí siguen)
      const [economyOn, tuning] = await Promise.all([isEconomyEnabledQuick(guildId), getTuning(guildId)]);
      const prestigeField = { name: `🌟 Nivel ${tuning.prestigeMinLevel}`, value: 'Desbloqueas `/prestige`: vuelves al nivel 1 y ganas más XP por mensaje.', inline: false };
      const rolesField = tuning.levelRoleRewards.length > 0
        ? {
          name: '🏅 Roles por nivel',
          value: truncate(tuning.levelRoleRewards.map((rule) => `**Nivel ${rule.level}:** <@&${rule.roleId}>`).join('\n'), 1024),
          inline: false,
        }
        : null;
      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('🎁 Premios por subir de nivel');

      if (!economyOn) {
        embed
          .setDescription('💤 La economía está desactivada en este servidor: al subir de nivel no ganas monedas ni boletos.')
          .addFields(...(rolesField ? [rolesField] : []), prestigeField);
        await interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
        return;
      }

      const examples = [5, 10, 25, 50, 100].map(level => {
        const reward = levelUpReward(level, tuning);
        return `**Nivel ${level}:** ${formatCoins(reward.coins)} + ${reward.tickets} ${reward.tickets === 1 ? 'boleto' : 'boletos'}`;
      });

      embed
        .setDescription(`Cada vez que subes de nivel recibes automáticamente:\n• **nivel² × ${tuning.levelUpCoinsFactor.toLocaleString('es-MX')}** monedas\n• **nivel ÷ 5 + 1** boletos (redondeado hacia abajo)`)
        .addFields(
          { name: 'Ejemplos', value: examples.join('\n'), inline: false },
          ...(rolesField ? [rolesField] : []),
          prestigeField
        );
      if (tuning.messageCoinsPercent > 0) {
        embed.setFooter({ text: 'Además, cada mensaje te da unas cuantas monedas (más cuanto más alto sea tu nivel).' });
      }

      await interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
    }
  },

  {
    data: new SlashCommandBuilder()
      .setName('xpinfo')
      .setDescription('⚡ Cómo funciona el sistema de XP y niveles'),

    async execute(interaction: ChatInputCommandInteraction, bot: DiscordBot) {
      const extras = await getExtrasQuick(interaction.guildId!);
      const tuning = tuningOf(extras);
      const goal = tuning.prestigeMinLevel;
      const steps = [2, 10, 50, 100].map(level => `• Nivel ${level}: ${xpForLevelStep(level).toLocaleString('es-MX')} XP`).join('\n');
      const maxBonus = tuning.prestigeBonusPercent * tuning.prestigeMaxBonus;

      const howTo = tuning.xpEnabled
        ? [
          `• Cada mensaje da entre ${tuning.xpMin} y ${tuning.xpMax} XP`,
          `• Solo cuenta un mensaje cada ${formatWaitSeconds(tuning.xpCooldownSeconds)} (para que el spam no sirva)`,
          ...(tuning.xpMinMessageLength > 0 ? [`• Los mensajes de menos de ${tuning.xpMinMessageLength} caracteres no cuentan`] : []),
          ...(tuning.xpMultiplierPercent !== 100 ? [`• Ahora mismo el servidor da ${formatMultiplier(tuning.xpMultiplierPercent / 100)} de XP`] : []),
          ...(extras.voiceXpEnabled && tuning.voiceXpPerMinute > 0 ? [`• En canales de voz: ${tuning.voiceXpPerMinute} XP por minuto si hay al menos ${tuning.voiceXpMinMembers} ${tuning.voiceXpMinMembers === 1 ? 'persona' : 'personas'}`] : []),
          ...(tuning.noXpChannelIds.length > 0 || tuning.noXpRoleIds.length > 0 ? ['• Algunos canales o roles no ganan XP'] : []),
        ].join('\n')
        : '💤 La XP está apagada en este servidor por ahora: nadie sube de nivel.';

      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('⚡ Sistema de XP')
        .addFields(
          { name: '📈 Cómo se gana', value: howTo, inline: false },
          { name: '📊 Cada nivel pide 10 % más XP', value: `XP para subir a…\n${steps}\n• Para llegar al nivel ${goal} hacen falta ${xpToReachLevel(goal).toLocaleString('es-MX')} XP en total`, inline: false },
          {
            name: '🌟 Prestigio',
            value: tuning.prestigeBonusPercent > 0 && tuning.prestigeMaxBonus > 0
              ? `Desde el nivel ${goal} puedes usar \`/prestige\`: vuelves al nivel 1 y cada prestigio te da +${tuning.prestigeBonusPercent} % de XP por mensaje (máximo +${maxBonus} %).`
              : `Desde el nivel ${goal} puedes usar \`/prestige\` para volver al nivel 1 y sumar un prestigio.`,
            inline: false,
          }
        )
        .setFooter({ text: 'Usa /level para ver tu progreso.' });

      await interaction.reply({ embeds: [embed] });
    }
  }
];
