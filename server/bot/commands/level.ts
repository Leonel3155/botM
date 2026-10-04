import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { DiscordBot } from '../index';
import { storage } from '../../storage';

export const levelCommands = [
  {
    data: new SlashCommandBuilder()
      .setName('level')
      .setDescription('Check your level and XP')
      .addUserOption(option =>
        option.setName('user')
          .setDescription('User to check level for (optional)')
          .setRequired(false)
      ),
    
    async execute(interaction: ChatInputCommandInteraction, bot: DiscordBot) {
      const targetUser = interaction.options.getUser('user') || interaction.user;
      const guildId = interaction.guildId!;

      let user = await storage.getUser(targetUser.id);
      if (!user) {
        user = await storage.createUser({
          id: targetUser.id,
          username: targetUser.username,
          avatar: targetUser.avatar || null
        });
      }

      const userLevel = await storage.getUserLevel(targetUser.id, guildId);
      
      if (!userLevel) {
        const embed = new EmbedBuilder()
          .setColor(0x5865F2)
          .setTitle('Level Information')
          .setDescription(`${targetUser} hasn't gained any XP yet!`)
          .setThumbnail(targetUser.displayAvatarURL());
        
        await interaction.reply({ embeds: [embed] });
        return;
      }

      // Fixed level system with proper null checks
      const totalXp = userLevel.totalXp || 0;
      const level = userLevel.level || 1;
      
      // Exponential XP system - each level requires more XP but balanced for level 100
      const getXpForLevel = (lvl: number) => {
        if (lvl <= 1) return 0;
        let totalRequired = 0;
        for (let i = 2; i <= lvl; i++) {
          // Progressive system: starts at 100 XP, increases by 10% each level
          totalRequired += Math.floor(100 * Math.pow(1.1, i - 2));
        }
        return totalRequired;
      };
      
      const xpForThisLevel = getXpForLevel(level);
      const xpForNextLevel = getXpForLevel(level + 1);
      const xpProgress = totalXp - xpForThisLevel;
      const xpNeeded = xpForNextLevel - totalXp;
      const xpRequiredForNext = xpForNextLevel - xpForThisLevel;

      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('Level Information')
        .setDescription(`**${targetUser.username}**'s level stats`)
        .addFields(
          { name: '📊 Level', value: level.toString(), inline: true },
          { name: '⚡ Total XP', value: totalXp.toString(), inline: true },
          { name: '🎯 XP to Next Level', value: xpNeeded.toString(), inline: true },
          { name: '🎤 Voice Time', value: `${Math.floor((userLevel.voiceTime || 0) / 60)}h ${(userLevel.voiceTime || 0) % 60}m`, inline: true }
        )
        .setThumbnail(targetUser.displayAvatarURL())
        .setFooter({ text: `Progress: ${xpProgress}/${xpRequiredForNext} XP | Level ${level}${level >= 100 ? '+' : ''}` });

      await interaction.reply({ embeds: [embed] });
    }
  },

  // Abbreviated version: /lv for /level
  {
    data: new SlashCommandBuilder()
      .setName('lv')
      .setDescription('Check your level (short for /level)')
      .addUserOption(option =>
        option.setName('user')
          .setDescription('User to check level for (optional)')
          .setRequired(false)
      ),
    
    async execute(interaction: ChatInputCommandInteraction, bot: DiscordBot) {
      const targetUser = interaction.options.getUser('user') || interaction.user;
      const guildId = interaction.guildId!;

      let user = await storage.getUser(targetUser.id);
      if (!user) {
        user = await storage.createUser({
          id: targetUser.id,
          username: targetUser.username,
          avatar: targetUser.avatar || null
        });
      }

      const userLevel = await storage.getUserLevel(targetUser.id, guildId);
      
      if (!userLevel) {
        const embed = new EmbedBuilder()
          .setColor(0x5865F2)
          .setTitle('Level Information')
          .setDescription(`${targetUser} hasn't gained any XP yet!`)
          .setThumbnail(targetUser.displayAvatarURL())
          .setFooter({ text: 'Tip: /lv is short for /level!' });
        
        await interaction.reply({ embeds: [embed] });
        return;
      }

      const totalXp = userLevel.totalXp || 0;
      const level = userLevel.level || 1;
      
      const getXpForLevel = (lvl: number) => {
        if (lvl <= 1) return 0;
        let totalRequired = 0;
        for (let i = 2; i <= lvl; i++) {
          totalRequired += Math.floor(100 * Math.pow(1.1, i - 2));
        }
        return totalRequired;
      };
      
      const xpForThisLevel = getXpForLevel(level);
      const xpForNextLevel = getXpForLevel(level + 1);
      const xpNeeded = xpForNextLevel - totalXp;

      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('Level Information (Quick Check)')
        .setDescription(`**${targetUser.username}**'s level stats`)
        .addFields(
          { name: '📊 Level', value: level.toString(), inline: true },
          { name: '⚡ Total XP', value: totalXp.toString(), inline: true },
          { name: '🎯 XP to Next Level', value: xpNeeded.toString(), inline: true }
        )
        .setThumbnail(targetUser.displayAvatarURL())
        .setFooter({ text: 'Tip: /lv is short for /level!' });

      await interaction.reply({ embeds: [embed] });
    }
  },

  // Abbreviated version: /lb for /leaderboard  
  {
    data: new SlashCommandBuilder()
      .setName('lb')
      .setDescription('View server leaderboard (short for /leaderboard)')
      .addIntegerOption(option =>
        option.setName('limit')
          .setDescription('Number of users to show (max 25)')
          .setMinValue(1)
          .setMaxValue(25)
          .setRequired(false)
      ),
    
    async execute(interaction: ChatInputCommandInteraction, bot: DiscordBot) {
      const limit = interaction.options.getInteger('limit') || 10;
      const guildId = interaction.guildId!;

      const topUsers = await storage.getTopUsersByLevel(guildId, limit);
      
      if (topUsers.length === 0) {
        await interaction.reply('No users have gained XP in this server yet!');
        return;
      }

      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle(`🏆 Server Leaderboard`)
        .setDescription('Top users by total XP');

      const leaderboardText = topUsers.map((user: any, index: number) => {
        const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`;
        return `${medal} <@${user.userId}> - Level ${user.level || 1} (${user.totalXp || 0} XP)`;
      }).join('\n');

      embed.setDescription(leaderboardText)
        .setFooter({ text: 'Tip: /lb is short for /leaderboard!' });

      await interaction.reply({ embeds: [embed] });
    }
  }
];