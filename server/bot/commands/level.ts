import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder, User } from 'discord.js';
import { DiscordBot } from '../index';
import { storage } from '../../storage';
import { getPrestigeLevel } from '../services/economy';
import { LevelRow, formatMultiplier, getLevelRank, getLevelRow, levelProgress, prestigeMultiplier, rowTotalXp } from '../services/levels';
import { respond } from '../utils/interactions';

function progressBar(current: number, total: number, size = 12): string {
  const ratio = total > 0 ? Math.min(Math.max(current / total, 0), 1) : 0;
  const filled = Math.round(ratio * size);
  return '▰'.repeat(filled) + '▱'.repeat(size - filled);
}

// Compartido con &lv y &rank
export async function buildLevelEmbed(guildId: string, target: User): Promise<EmbedBuilder> {
  const row: LevelRow | undefined = await getLevelRow(guildId, target.id);
  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setAuthor({ name: target.displayName, iconURL: target.displayAvatarURL() })
    .setThumbnail(target.displayAvatarURL());

  if (!row) {
    return embed
      .setTitle('📊 Nivel')
      .setDescription(target.bot ? 'Los bots no suben de nivel. 🤖' : `${target} todavía no tiene XP. ¡Cada mensaje cuenta!`);
  }

  const totalXp = rowTotalXp(row);
  const progress = levelProgress(totalXp);
  const level = progress.level;
  const [rank, prestige] = await Promise.all([
    getLevelRank(guildId, target.id),
    getPrestigeLevel(guildId, target.id),
  ]);

  embed
    .setTitle('📊 Nivel')
    .addFields(
      { name: '🎯 Nivel', value: level.toLocaleString('es-MX'), inline: true },
      { name: '⚡ XP total', value: totalXp.toLocaleString('es-MX'), inline: true },
      { name: '🏆 Puesto', value: rank ? `#${rank}` : '—', inline: true },
      {
        name: '📈 Progreso al siguiente nivel',
        value: `${progressBar(progress.intoLevel, progress.levelSize)}\n${progress.intoLevel.toLocaleString('es-MX')} / ${progress.levelSize.toLocaleString('es-MX')} XP (faltan ${progress.remaining.toLocaleString('es-MX')})`,
        inline: false,
      }
    );

  if (prestige > 0) {
    embed.addFields({ name: '🌟 Prestigio', value: `${prestige} (${formatMultiplier(prestigeMultiplier(prestige))} XP)`, inline: true });
  }
  return embed.setFooter({ text: '¡Sigue platicando para subir de nivel!' });
}

export async function buildLevelLeaderboard(guildId: string, limit: number): Promise<EmbedBuilder | null> {
  // El mismo ranking que el panel: una fila por persona aunque haya filas repetidas
  const top = await storage.getLevelLeaderboard(guildId, limit);
  if (top.length === 0) return null;

  const lines = top.map((entry, index) => {
    const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `**${index + 1}.**`;
    return `${medal} <@${entry.userId}> — Nivel ${entry.level} (${entry.totalXp.toLocaleString('es-MX')} XP)`;
  });

  return new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('🏆 Ranking de niveles')
    .setDescription(lines.join('\n'))
    .setTimestamp();
}

const levelData = (name: string, description: string) => new SlashCommandBuilder()
  .setName(name)
  .setDescription(description)
  .addUserOption(option =>
    option.setName('usuario')
      .setDescription('A quién consultar (opcional)')
      .setRequired(false)
  );

async function executeLevel(interaction: ChatInputCommandInteraction) {
  const target = interaction.options.getUser('usuario') || interaction.user;
  await interaction.deferReply();
  const embed = await buildLevelEmbed(interaction.guildId!, target);
  await respond(interaction, { embeds: [embed] });
}

export const levelCommands = [
  {
    data: levelData('level', '📊 Mira tu nivel y XP, o los de otra persona'),
    async execute(interaction: ChatInputCommandInteraction, bot: DiscordBot) {
      await executeLevel(interaction);
    }
  },

  // Atajo de /level
  {
    data: levelData('lv', '📊 Atajo de /level: tu nivel y XP'),
    async execute(interaction: ChatInputCommandInteraction, bot: DiscordBot) {
      await executeLevel(interaction);
    }
  },

  {
    data: new SlashCommandBuilder()
      .setName('lb')
      .setDescription('🏆 Ranking de niveles del servidor (para monedas usa /leaderboard)')
      .addIntegerOption(option =>
        option.setName('limite')
          .setDescription('Cuántas personas mostrar (máximo 25)')
          .setMinValue(1)
          .setMaxValue(25)
          .setRequired(false)
      ),

    async execute(interaction: ChatInputCommandInteraction, bot: DiscordBot) {
      const limit = interaction.options.getInteger('limite') || 10;
      await interaction.deferReply();
      const embed = await buildLevelLeaderboard(interaction.guildId!, limit);
      await respond(interaction, embed ? { embeds: [embed] } : 'Aún nadie tiene XP en este servidor. ¡El primer mensaje empieza la cuenta!');
    }
  }
];
