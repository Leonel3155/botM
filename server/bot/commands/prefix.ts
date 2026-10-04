import { Message, EmbedBuilder } from 'discord.js';
import { storage } from '../../storage';
import { DiscordBot } from '../index';

// Prefix-based commands (like &bal, &lv, &dep all)
export class PrefixCommandHandler {
  private bot: DiscordBot;
  
  constructor(bot: DiscordBot) {
    this.bot = bot;
  }

  async handleMessage(message: Message) {
    if (message.author.bot || !message.guild) return;

    // Get guild prefix (default is &)
    await storage.ensureGuild(message.guild.id, message.guild.name, message.guild.ownerId);
    const guild = await storage.getGuild(message.guild.id);

    const prefix = guild?.prefix || '&';
    if (!message.content.startsWith(prefix)) return;

    const args = message.content.slice(prefix.length).trim().split(/ +/);
    const commandName = args.shift()?.toLowerCase();
    if (!commandName) return;

    console.log(`[PREFIX-CMD] Command: ${prefix}${commandName} | Args: [${args.join(', ')}] | User: ${message.author.username}`);

    // Route to appropriate command handler
    switch (commandName) {
      // Economy commands
      case 'bal':
      case 'balance':
        await this.handleBalance(message, args);
        break;
      case 'daily':
        await this.handleDaily(message);
        break;
      case 'dep':
      case 'deposit':
        await this.handleDeposit(message, args);
        break;
      case 'with':
      case 'withdraw':
        await this.handleWithdraw(message, args);
        break;

      // Level commands  
      case 'lv':
      case 'level':
        await this.handleLevel(message, args);
        break;
      case 'lb':
      case 'leaderboard':
        await this.handleLeaderboard(message, args);
        break;

      // Psychology commands
      case 'lot':
      case 'lottery':
        await this.handleLottery(message);
        break;
      case 'col':
      case 'collection':
        await this.handleCollection(message);
        break;
      case 'rank':
        await this.handleRank(message, args);
        break;

      // Help command
      case 'help':
      case 'commands':
        await this.handleHelp(message);
        break;

      default:
        // Command not found - don't spam, just ignore
        break;
    }
  }

  private async handleBalance(message: Message, args: string[]) {
    const targetUser = message.mentions.users.first() || message.author;
    const guildId = message.guild!.id;

    let economy = await storage.getUserEconomy(targetUser.id, guildId);
    if (!economy) {
      economy = await storage.createUserEconomy({
        userId: targetUser.id,
        guildId: guildId,
        balance: '0',
        bank: '0'
      });
    }

    const embed = new EmbedBuilder()
      .setColor(0xFFD700)
      .setTitle('💰 Balance')
      .setDescription(`**${targetUser.username}**'s economy`)
      .addFields(
        { name: '💵 Wallet', value: `${economy.balance} coins`, inline: true },
        { name: '🏦 Bank', value: `${economy.bank} coins`, inline: true },
        { name: '💎 Total', value: `${parseInt(economy.balance || '0') + parseInt(economy.bank || '0')} coins`, inline: true }
      )
      .setThumbnail(targetUser.displayAvatarURL())
      .setFooter({ text: 'Quick command used! Use &help for all commands' });

    await message.reply({ embeds: [embed] });
  }

  private async handleDaily(message: Message) {
    const userId = message.author.id;
    const guildId = message.guild!.id;

    let economy = await storage.getUserEconomy(userId, guildId);
    if (!economy) {
      economy = await storage.createUserEconomy({
        userId: userId,
        guildId: guildId,
        balance: '0',
        bank: '0'
      });
    }

    const now = new Date();
    const lastDaily = economy.lastDaily ? new Date(economy.lastDaily) : null;
    
    if (lastDaily && now.toDateString() === lastDaily.toDateString()) {
      await message.reply('⏰ You already claimed your daily reward! Try again tomorrow.');
      return;
    }

    // Calculate daily reward (higher level = more coins)
    const level = await storage.getUserLevel(userId, guildId);
    const baseReward = 100;
    const levelBonus = (level?.level || 1) * 10;
    const reward = baseReward + levelBonus;

    // Update economy
    const newBalance = parseInt(economy.balance || '0') + reward;
    const newStreak = economy.dailyStreak ? economy.dailyStreak + 1 : 1;

    await storage.updateUserEconomy(userId, guildId, {
      balance: newBalance.toString(),
      lastDaily: now.toISOString(),
      dailyStreak: newStreak,
      totalEarned: (parseInt(economy.totalEarned || '0') + reward).toString()
    });

    const embed = new EmbedBuilder()
      .setColor(0x00FF00)
      .setTitle('🎁 Daily Reward Claimed!')
      .setDescription(`You received **${reward} coins**!`)
      .addFields(
        { name: '💰 New Balance', value: `${newBalance} coins`, inline: true },
        { name: '🔥 Streak', value: `${newStreak} days`, inline: true },
        { name: '🎯 Level Bonus', value: `+${levelBonus} coins`, inline: true }
      )
      .setFooter({ text: 'Come back tomorrow for another reward!' });

    await message.reply({ embeds: [embed] });
  }

  private async handleDeposit(message: Message, args: string[]) {
    const userId = message.author.id;
    const guildId = message.guild!.id;
    const amountArg = args[0];

    if (!amountArg) {
      await message.reply('❌ Please specify an amount! Example: `&dep 100` or `&dep all`');
      return;
    }

    let economy = await storage.getUserEconomy(userId, guildId);
    if (!economy) {
      economy = await storage.createUserEconomy({
        userId: userId,
        guildId: guildId,
        balance: '0',
        bank: '0'
      });
    }

    const currentBalance = parseInt(economy.balance || '0');
    let depositAmount: number;

    if (amountArg.toLowerCase() === 'all') {
      depositAmount = currentBalance;
    } else {
      depositAmount = parseInt(amountArg);
      if (isNaN(depositAmount) || depositAmount <= 0) {
        await message.reply('❌ Please enter a valid amount or "all"!');
        return;
      }
    }

    if (depositAmount > currentBalance) {
      await message.reply(`❌ You only have ${currentBalance} coins in your wallet!`);
      return;
    }

    const newBalance = currentBalance - depositAmount;
    const newBank = parseInt(economy.bank || '0') + depositAmount;

    await storage.updateUserEconomy(userId, guildId, {
      balance: newBalance.toString(),
      bank: newBank.toString()
    });

    const embed = new EmbedBuilder()
      .setColor(0x00FF00)
      .setTitle('🏦 Deposit Successful')
      .setDescription(`Deposited **${depositAmount.toLocaleString()} coins** to your bank!`)
      .addFields(
        { name: '💵 New Wallet', value: `${newBalance.toLocaleString()} coins`, inline: true },
        { name: '🏦 New Bank', value: `${newBank.toLocaleString()} coins`, inline: true }
      )
      .setFooter({ text: 'Your coins are safe in the bank!' });

    await message.reply({ embeds: [embed] });
  }

  private async handleWithdraw(message: Message, args: string[]) {
    const userId = message.author.id;
    const guildId = message.guild!.id;
    const amountArg = args[0];

    if (!amountArg) {
      await message.reply('❌ Please specify an amount! Example: `&with 100` or `&with all`');
      return;
    }

    let economy = await storage.getUserEconomy(userId, guildId);
    if (!economy) {
      economy = await storage.createUserEconomy({
        userId: userId,
        guildId: guildId,
        balance: '0',
        bank: '0'
      });
    }

    const currentBank = parseInt(economy.bank || '0');
    let withdrawAmount: number;

    if (amountArg.toLowerCase() === 'all') {
      withdrawAmount = currentBank;
    } else {
      withdrawAmount = parseInt(amountArg);
      if (isNaN(withdrawAmount) || withdrawAmount <= 0) {
        await message.reply('❌ Please enter a valid amount or "all"!');
        return;
      }
    }

    if (withdrawAmount > currentBank) {
      await message.reply(`❌ You only have ${currentBank} coins in your bank!`);
      return;
    }

    const newBank = currentBank - withdrawAmount;
    const newBalance = parseInt(economy.balance || '0') + withdrawAmount;

    await storage.updateUserEconomy(userId, guildId, {
      balance: newBalance.toString(),
      bank: newBank.toString()
    });

    const embed = new EmbedBuilder()
      .setColor(0x00FF00)
      .setTitle('💸 Withdrawal Successful')
      .setDescription(`Withdrew **${withdrawAmount.toLocaleString()} coins** from your bank!`)
      .addFields(
        { name: '💵 New Wallet', value: `${newBalance.toLocaleString()} coins`, inline: true },
        { name: '🏦 New Bank', value: `${newBank.toLocaleString()} coins`, inline: true }
      )
      .setFooter({ text: 'Spend wisely!' });

    await message.reply({ embeds: [embed] });
  }

  private async handleLevel(message: Message, args: string[]) {
    const targetUser = message.mentions.users.first() || message.author;
    const guildId = message.guild!.id;

    const userLevel = await storage.getUserLevel(targetUser.id, guildId);
    
    if (!userLevel) {
      await message.reply(`${targetUser} hasn't gained any XP yet!`);
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
    
    const xpForNextLevel = getXpForLevel(level + 1);
    const xpNeeded = xpForNextLevel - totalXp;

    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('📊 Level Info')
      .setDescription(`**${targetUser.username}**'s progress`)
      .addFields(
        { name: '🎯 Level', value: level.toString(), inline: true },
        { name: '⚡ Total XP', value: totalXp.toLocaleString(), inline: true },
        { name: '📈 XP Needed', value: xpNeeded.toLocaleString(), inline: true }
      )
      .setThumbnail(targetUser.displayAvatarURL())
      .setFooter({ text: 'Keep chatting to level up!' });

    await message.reply({ embeds: [embed] });
  }

  private async handleLeaderboard(message: Message, args: string[]) {
    const limit = parseInt(args[0]) || 10;
    const guildId = message.guild!.id;

    const topUsers = await storage.getTopUsersByLevel(guildId, Math.min(limit, 25));
    
    if (topUsers.length === 0) {
      await message.reply('No users have gained XP in this server yet!');
      return;
    }

    const leaderboardText = topUsers.map((user: any, index: number) => {
      const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`;
      return `${medal} <@${user.userId}> - Lvl ${user.level} (${(user.totalXp || 0).toLocaleString()} XP)`;
    }).join('\n');

    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle(`🏆 Top ${topUsers.length} Users`)
      .setDescription(leaderboardText)
      .setFooter({ text: `Server: ${message.guild!.name}` });

    await message.reply({ embeds: [embed] });
  }

  private async handleLottery(message: Message) {
    const userId = message.author.id;
    const guildId = message.guild!.id;
    
    const tickets = await storage.getLotteryTickets(userId, guildId);
    const todaysPot = Math.floor(Math.random() * 50000) + 25000;
    const winChance = Math.min(tickets * 2, 50);
    
    const embed = new EmbedBuilder()
      .setColor(0xFFD700)
      .setTitle('🎰 Lottery Status')
      .addFields(
        { name: '🎫 Your Tickets', value: tickets.toLocaleString(), inline: true },
        { name: '🏆 Today\'s Pot', value: `${todaysPot.toLocaleString()} coins`, inline: true },
        { name: '📊 Win Chance', value: `~${winChance}%`, inline: true }
      )
      .setFooter({ text: 'Every message = 1 ticket! Keep chatting!' });

    await message.reply({ embeds: [embed] });
  }

  private async handleCollection(message: Message) {
    const embed = new EmbedBuilder()
      .setColor(0x9B59B6)
      .setTitle('✨ Collection System')
      .setDescription('Rare items drop while chatting!')
      .addFields(
        { name: '🎲 Drop Rates', value: '0.5% per message\nHigher level = better items', inline: true },
        { name: '💎 Rarities', value: '🤍 Common\n💚 Rare\n💙 Epic\n💜 Legendary', inline: true }
      )
      .setFooter({ text: 'Coming soon - full collection system!' });

    await message.reply({ embeds: [embed] });
  }

  private async handleRank(message: Message, args: string[]) {
    const targetUser = message.mentions.users.first() || message.author;
    const guildId = message.guild!.id;

    const userLevel = await storage.getUserLevel(targetUser.id, guildId);
    const topUsers = await storage.getTopUsersByLevel(guildId, 100);
    const userRank = topUsers.findIndex((u: any) => u.userId === targetUser.id) + 1;
    
    const embed = new EmbedBuilder()
      .setColor(0xFF6B35)
      .setTitle('🏆 Server Ranking')
      .setDescription(`**${targetUser.username}**'s position`)
      .addFields(
        { name: '📍 Rank', value: userRank > 0 ? `#${userRank}` : 'Unranked', inline: true },
        { name: '📊 Level', value: (userLevel?.level || 0).toString(), inline: true },
        { name: '⚡ Total XP', value: (userLevel?.totalXp || 0).toLocaleString(), inline: true }
      )
      .setThumbnail(targetUser.displayAvatarURL());

    await message.reply({ embeds: [embed] });
  }

  private async handleHelp(message: Message) {
    const guild = await storage.getGuild(message.guild!.id);
    const prefix = guild?.prefix || '&';

    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('🤖 Bot Commands')
      .setDescription(`**Current prefix:** \`${prefix}\``)
      .addFields(
        { 
          name: '💰 Economy', 
          value: `\`${prefix}bal\` - Check balance\n\`${prefix}daily\` - Daily reward\n\`${prefix}dep <amount/all>\` - Deposit coins\n\`${prefix}with <amount/all>\` - Withdraw coins`, 
          inline: true 
        },
        { 
          name: '📊 Levels', 
          value: `\`${prefix}lv\` - Check level\n\`${prefix}lb [limit]\` - Leaderboard\n\`${prefix}rank\` - Your server rank`, 
          inline: true 
        },
        { 
          name: '🎰 Fun', 
          value: `\`${prefix}lot\` - Lottery status\n\`${prefix}col\` - Collection info`, 
          inline: true 
        }
      )
      .setFooter({ text: `Change prefix in dashboard: ${process.env.FRONTEND_URL || 'Dashboard'}` });

    await message.reply({ embeds: [embed] });
  }
}
