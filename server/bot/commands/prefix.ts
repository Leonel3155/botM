import { Message, EmbedBuilder } from 'discord.js';
import { DiscordBot } from '../index';
import {
  AMOUNT_HINT,
  claimDaily,
  deposit,
  economyTask,
  ensureAccount,
  getAccount,
  parseAmount,
  withdraw,
} from '../services/economy';
import { ECONOMY_DISABLED_MESSAGE, getGuildSettings } from '../services/guildSettings';
import { balanceEmbed, bankEmbed, bankErrorMessage, dailyEmbed } from './economy';
import { buildLevelEmbed, buildLevelLeaderboard } from './level';

const ECONOMY_COMMANDS = new Set(['bal', 'balance', 'daily', 'dep', 'deposit', 'with', 'withdraw', 'lot', 'lottery']);

// Comandos con prefijo (como &bal, &lv, &dep todo). Comparten la lógica con los comandos de barra.
export class PrefixCommandHandler {
  private bot: DiscordBot;

  constructor(bot: DiscordBot) {
    this.bot = bot;
  }

  async handleMessage(message: Message) {
    if (message.author.bot || !message.guild) return;

    // Prefijo del servidor (por defecto &), con caché para no consultar la base de datos en cada mensaje
    const settings = await getGuildSettings(message.guild.id);
    const prefix = settings?.prefix || '&';
    if (!message.content.startsWith(prefix)) return;

    const args = message.content.slice(prefix.length).trim().split(/ +/);
    const commandName = args.shift()?.toLowerCase();
    if (!commandName) return;

    if (ECONOMY_COMMANDS.has(commandName) && settings?.economyEnabled === false) {
      await message.reply(ECONOMY_DISABLED_MESSAGE);
      return;
    }

    try {
      switch (commandName) {
        // Economía
        case 'bal':
        case 'balance':
          await this.handleBalance(message);
          break;
        case 'daily':
          await this.handleDaily(message);
          break;
        case 'dep':
        case 'deposit':
          await this.handleBank(message, args, 'deposit', prefix);
          break;
        case 'with':
        case 'withdraw':
          await this.handleBank(message, args, 'withdraw', prefix);
          break;
        case 'lot':
        case 'lottery':
          await this.handleLottery(message);
          break;

        // Niveles
        case 'lv':
        case 'level':
        case 'rank':
          await this.handleLevel(message);
          break;
        case 'lb':
        case 'leaderboard':
          await this.handleLeaderboard(message, args);
          break;

        // Ayuda
        case 'help':
        case 'commands':
        case 'ayuda':
          await this.handleHelp(message, prefix);
          break;

        default:
          // Comando desconocido: no respondemos para no hacer spam
          return;
      }
      console.log(`[PREFIJO] ${prefix}${commandName} usado por ${message.author.username} en ${message.guild.name}`);
    } catch (error) {
      console.error(`Error en el comando ${prefix}${commandName}:`, error);
      await message.reply('😵 Uy, algo salió mal con ese comando. Intenta de nuevo en un momento.').catch(() => undefined);
    }
  }

  private async handleBalance(message: Message) {
    const target = message.mentions.users.first() || message.author;
    const account = target.bot ? undefined : await getAccount(message.guild!.id, target.id);
    await message.reply({ embeds: [balanceEmbed(target, account)] });
  }

  private async handleDaily(message: Message) {
    const guildId = message.guild!.id;
    const userId = message.author.id;
    await ensureAccount(message.guild!, message.author);
    const result = await economyTask(guildId, userId, () => claimDaily(guildId, userId));
    await message.reply({ embeds: [dailyEmbed(result)] });
  }

  private async handleBank(message: Message, args: string[], kind: 'deposit' | 'withdraw', prefix: string) {
    const command = `${prefix}${kind === 'deposit' ? 'dep' : 'with'}`;
    const request = parseAmount(args[0]);
    if (!request) {
      await message.reply(`❌ Dime cuánto: por ejemplo \`${command} 100\` o \`${command} todo\`. ${AMOUNT_HINT}`);
      return;
    }

    const guildId = message.guild!.id;
    const userId = message.author.id;
    await ensureAccount(message.guild!, message.author);
    const result = await economyTask(guildId, userId, () =>
      kind === 'deposit' ? deposit(guildId, userId, request) : withdraw(guildId, userId, request)
    );

    if (!result.ok) {
      await message.reply(bankErrorMessage(kind, result));
      return;
    }
    await message.reply({ embeds: [bankEmbed(kind, result)] });
  }

  private async handleLevel(message: Message) {
    const target = message.mentions.users.first() || message.author;
    const embed = await buildLevelEmbed(message.guild!.id, target);
    await message.reply({ embeds: [embed] });
  }

  private async handleLeaderboard(message: Message, args: string[]) {
    const requested = parseInt(args[0] ?? '', 10);
    const limit = Number.isFinite(requested) ? Math.min(Math.max(requested, 1), 25) : 10;
    const embed = await buildLevelLeaderboard(message.guild!.id, limit);
    if (!embed) {
      await message.reply('Aún nadie tiene XP en este servidor. ¡El primer mensaje empieza la cuenta!');
      return;
    }
    await message.reply({ embeds: [embed] });
  }

  private async handleLottery(message: Message) {
    const account = await getAccount(message.guild!.id, message.author.id);
    const tickets = account?.lotteryTickets ?? 0;

    const embed = new EmbedBuilder()
      .setColor(0xFFD700)
      .setTitle('🎫 Tus boletos')
      .setDescription(`Tienes **${tickets.toLocaleString('es-MX')}** ${tickets === 1 ? 'boleto' : 'boletos'}.`)
      .addFields({
        name: '¿Cómo se consiguen?',
        value: 'Platicando en el servidor (1 o 2 por mensaje premiado) y al subir de nivel.',
        inline: false,
      })
      .setFooter({ text: 'Todavía no hay sorteos de lotería en el bot; por ahora los boletos solo se acumulan.' });

    await message.reply({ embeds: [embed] });
  }

  private async handleHelp(message: Message, prefix: string) {
    const dashboardUrl = process.env.FRONTEND_URL || process.env.APP_URL;

    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('🤖 Comandos rápidos')
      .setDescription(`Prefijo actual: \`${prefix}\` · También tienes todos los comandos de barra: escribe \`/\` para verlos.`)
      .addFields(
        {
          name: '💰 Economía',
          value: `\`${prefix}bal [@alguien]\` Saldo\n\`${prefix}daily\` Recompensa diaria\n\`${prefix}dep <cantidad|todo>\` Depositar\n\`${prefix}with <cantidad|todo>\` Retirar\n\`${prefix}lot\` Tus boletos`,
          inline: true
        },
        {
          name: '📊 Niveles',
          value: `\`${prefix}lv [@alguien]\` Nivel y puesto\n\`${prefix}rank [@alguien]\` Igual que lv\n\`${prefix}lb [cantidad]\` Ranking de niveles`,
          inline: true
        }
      )
      .setFooter({ text: dashboardUrl ? `Puedes cambiar el prefijo desde el panel: ${dashboardUrl}` : 'Puedes cambiar el prefijo desde el panel.' });

    await message.reply({ embeds: [embed] });
  }
}
