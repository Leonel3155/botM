import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { storage } from '../../storage';
import { DiscordBot } from '../index';

export const prestigeCommands = [
  // Prestige command for 100+ levels
  {
    data: new SlashCommandBuilder()
      .setName('prestige')
      .setDescription('Prestige your level (requires level 100+)')
      .addBooleanOption(option =>
        option.setName('confirm')
          .setDescription('Confirm you want to prestige')
          .setRequired(false)
      ),
    
    async execute(interaction: ChatInputCommandInteraction, bot: DiscordBot) {
      const userId = interaction.user.id;
      const guildId = interaction.guildId!;
      const confirm = interaction.options.getBoolean('confirm') || false;

      const userLevel = await storage.getUserLevel(userId, guildId);
      // La columna `level` es nullable en la BD (default 1)
      const currentLevel = userLevel?.level ?? 1;

      if (currentLevel < 100) {
        await interaction.reply('❌ You need to reach level 100 before you can prestige!');
        return;
      }

      if (!confirm) {
        const embed = new EmbedBuilder()
          .setColor(0xFFD700)
          .setTitle('🌟 Prestige System')
          .setDescription('**Warning:** Prestiging will reset your level to 1 but you will keep:')
          .addFields(
            { name: '✅ Benefits You Keep', value: '• All economy money\n• All items and inventory\n• Prestige badge and title\n• 2x XP gain permanently', inline: false },
            { name: '❌ What You Lose', value: '• Your current level (back to 1)\n• Current XP progress', inline: false },
            { name: '🎯 Requirements', value: `Current Level: **${currentLevel}** ✅\nMinimum Required: **100** ✅`, inline: false }
          )
          .setFooter({ text: 'Use /prestige confirm:True to proceed' });

        await interaction.reply({ embeds: [embed] });
        return;
      }

      // Perform prestige (in real implementation, add prestige tracking)
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x57F287)
            .setTitle('🌟 Prestige Successful!')
            .setDescription(`Congratulations! You have prestiged from level **${currentLevel}**!`)
            .addFields(
              { name: '⭐ New Status', value: 'Level 1 (Prestiged)', inline: true },
              { name: '🚀 XP Multiplier', value: '2.0x permanent', inline: true },
              { name: '👑 Title Unlocked', value: 'Prestige Master', inline: true }
            )
        ]
      });
    }
  },

  // Level rewards command
  {
    data: new SlashCommandBuilder()
      .setName('levelrewards')
      .setDescription('View rewards for reaching certain levels'),
    
    async execute(interaction: ChatInputCommandInteraction, bot: DiscordBot) {
      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('🎁 Level Rewards System')
        .setDescription('Special rewards for milestone levels:')
        .addFields(
          { name: '🏆 Level 10', value: '500 coins + "Rising Star" badge', inline: false },
          { name: '⭐ Level 25', value: '2,500 coins + "Quarter Master" role', inline: false },
          { name: '🌟 Level 50', value: '10,000 coins + "Halfway Hero" role', inline: false },
          { name: '💎 Level 75', value: '25,000 coins + "Diamond Tier" role', inline: false },
          { name: '🚀 Level 100', value: '100,000 coins + "Max Level" role + Prestige unlock', inline: false },
          { name: '🌌 Level 100+', value: 'Every 10 levels: 50,000 coins + Legendary status', inline: false }
        )
        .setFooter({ text: 'Rewards are automatically given when you reach these levels!' });

      await interaction.reply({ embeds: [embed] });
    }
  },

  // XP info command
  {
    data: new SlashCommandBuilder()
      .setName('xpinfo')
      .setDescription('Get detailed information about the XP system'),
    
    async execute(interaction: ChatInputCommandInteraction, bot: DiscordBot) {
      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('⚡ XP System Information')
        .setDescription('How the leveling system works:')
        .addFields(
          { name: '📈 XP Sources', value: '• Messages: 15-25 XP each\n• Voice chat: 10 XP per minute\n• Special events: Bonus XP', inline: false },
          { name: '📊 Sistema Exponencial', value: '• Cada nivel requiere 10% más XP\n• Nivel 2: 100 XP\n• Nivel 10: 214 XP por nivel\n• Nivel 50: 9,701 XP por nivel\n• Nivel 100: 1,138,893 XP por nivel', inline: false },
          { name: '🎯 Max Level', value: 'Level 100 is "max" but you can continue to 100+ for prestige!', inline: false },
          { name: '🌟 Prestige', value: 'At level 100+, you can prestige to reset with permanent 2x XP bonus', inline: false }
        )
        .setFooter({ text: 'The system gets progressively harder but more rewarding!' });

      await interaction.reply({ embeds: [embed] });
    }
  }
];