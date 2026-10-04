import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder, MessageFlags, PermissionFlagsBits, User } from 'discord.js';
import { DiscordBot } from '../index';
import {
  AMOUNT_HINT,
  BankResult,
  DailyResult,
  EconomyRow,
  MAX_COINS,
  ROB_MIN_ROBBER,
  ROB_MIN_TARGET,
  adminAddCoins,
  adminAddCoinsToMany,
  adminRemoveCoins,
  adminResetAccount,
  attemptRob,
  claimDaily,
  deposit,
  economyStats,
  economyTask,
  ensureAccount,
  formatCoins,
  getAccount,
  parseAmount,
  runTimedAction,
  toCoins,
  topByWealth,
  transfer,
  withdraw,
} from '../services/economy';
import { ADMIN_ONLY, discordRelativeTime, isAdmin, resolveGuild, respond } from '../utils/interactions';

// ===== Mensajes compartidos con los comandos de prefijo (&bal, &daily, &dep, &with) =====

export function balanceEmbed(target: User, account: EconomyRow | undefined, requester?: User): EmbedBuilder {
  const wallet = toCoins(account?.balance);
  const bank = toCoins(account?.bank);
  const prestige = account?.prestigeLevel ?? 0;

  const embed = new EmbedBuilder()
    .setColor(0xFFD700)
    .setAuthor({ name: target.displayName, iconURL: target.displayAvatarURL() })
    .setTitle('💰 Saldo')
    .addFields(
      { name: '💵 Cartera', value: formatCoins(wallet), inline: true },
      { name: '🏦 Banco', value: formatCoins(bank), inline: true },
      { name: '💎 Total', value: formatCoins(wallet + bank), inline: true }
    )
    .setTimestamp();

  if (prestige > 0) {
    embed.addFields({ name: '🌟 Prestigio', value: `Nivel de prestigio **${prestige}**`, inline: true });
  }
  if (!account) {
    embed.setDescription(target.bot ? 'Los bots no juegan a la economía. 🤖' : 'Todavía no tiene monedas. ¡Con `/daily` se empieza!');
  }
  if (requester) {
    embed.setFooter({ text: `Consultado por ${requester.displayName}`, iconURL: requester.displayAvatarURL() });
  }
  return embed;
}

export function dailyEmbed(result: DailyResult): EmbedBuilder {
  if (!result.ok) {
    return new EmbedBuilder()
      .setColor(0xF39C12)
      .setTitle('⏳ Ya reclamaste tu recompensa diaria')
      .setDescription(`Podrás volver a reclamarla ${discordRelativeTime(result.retryInMs)}.`);
  }

  const streakText = result.streakLost
    ? `${result.streak} día (pasaron más de 48 h, así que la racha empezó de nuevo)`
    : `${result.streak} ${result.streak === 1 ? 'día' : 'días'} seguidos`;

  return new EmbedBuilder()
    .setColor(0x4CAF50)
    .setTitle('🎁 ¡Recompensa diaria reclamada!')
    .setDescription(`Recibiste **${formatCoins(result.reward)}**.`)
    .addFields(
      { name: '🔥 Racha', value: streakText, inline: true },
      { name: '🎯 Bono por nivel', value: `+${formatCoins(result.levelBonus)}`, inline: true },
      { name: '💵 Cartera', value: formatCoins(result.balance), inline: true }
    )
    .setFooter({ text: 'Vuelve mañana: si pasan más de 48 h, la racha se reinicia.' })
    .setTimestamp();
}

export function bankEmbed(kind: 'deposit' | 'withdraw', result: Extract<BankResult, { ok: true }>): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(kind === 'deposit' ? 0x2196F3 : 0x4CAF50)
    .setTitle(kind === 'deposit' ? '🏦 Depósito hecho' : '🏦 Retiro hecho')
    .setDescription(kind === 'deposit'
      ? `Guardaste **${formatCoins(result.amount)}** en el banco.`
      : `Sacaste **${formatCoins(result.amount)}** del banco.`)
    .addFields(
      { name: '💵 Cartera', value: formatCoins(result.balance), inline: true },
      { name: '🏦 Banco', value: formatCoins(result.bank), inline: true }
    )
    .setTimestamp();
}

export function bankErrorMessage(kind: 'deposit' | 'withdraw', result: Extract<BankResult, { ok: false }>): string {
  const where = kind === 'deposit' ? 'tu cartera' : 'el banco';
  switch (result.reason) {
    case 'empty':
      return kind === 'deposit' ? '❌ No tienes monedas en la cartera para depositar.' : '❌ No tienes monedas guardadas en el banco.';
    case 'insufficient':
      return `❌ No te alcanza: en ${where} tienes ${formatCoins(result.available)}.`;
    case 'full':
      return `❌ Esa cantidad supera el máximo permitido (${formatCoins(MAX_COINS)}).`;
  }
}

function insufficientMessage(available: number): string {
  return available <= 0
    ? '❌ No tienes monedas en la cartera. Usa `/daily` o `/work` para conseguir algunas.'
    : `❌ No te alcanza: en la cartera tienes ${formatCoins(available)}.`;
}

function cooldownEmbed(title: string, retryInMs: number): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0xF39C12)
    .setTitle(title)
    .setDescription(`Podrás intentarlo de nuevo ${discordRelativeTime(retryInMs)}.`);
}

function pick<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

const JOBS = {
  constructor: { emoji: '👷', min: 150, max: 300, name: 'Constructor' },
  oficinista: { emoji: '👨‍💼', min: 100, max: 250, name: 'Oficinista' },
  repartidor: { emoji: '🍕', min: 80, max: 200, name: 'Repartidor' },
  programador: { emoji: '🧑‍💻', min: 200, max: 500, name: 'Programador' },
  artista: { emoji: '🎨', min: 50, max: 400, name: 'Artista' },
} as const;

type JobKey = keyof typeof JOBS;

// Sistema de economía: todos los cambios de saldo pasan por services/economy (transacciones con bloqueo)
export const economyCommands = [
  {
    data: new SlashCommandBuilder()
      .setName('balance')
      .setDescription('💰 Mira tu saldo o el de otra persona')
      .addUserOption(option =>
        option.setName('usuario')
          .setDescription('A quién quieres consultar (opcional)')
          .setRequired(false)
      ),

    async execute(interaction: ChatInputCommandInteraction, bot: DiscordBot) {
      const target = interaction.options.getUser('usuario') || interaction.user;
      const isSelf = target.id === interaction.user.id;

      await interaction.deferReply({ flags: isSelf ? undefined : MessageFlags.Ephemeral });
      const account = target.bot ? undefined : await getAccount(interaction.guildId!, target.id);
      await interaction.editReply({ embeds: [balanceEmbed(target, account, interaction.user)] });
    }
  },

  {
    data: new SlashCommandBuilder()
      .setName('daily')
      .setDescription('🎁 Reclama tu recompensa diaria (la racha se pierde si pasan más de 48 h)'),

    async execute(interaction: ChatInputCommandInteraction, bot: DiscordBot) {
      await interaction.deferReply();
      const guildId = interaction.guildId!;
      const userId = interaction.user.id;

      await ensureAccount(await resolveGuild(interaction), interaction.user);
      const result = await economyTask(guildId, userId, () => claimDaily(guildId, userId));
      await respond(interaction, { embeds: [dailyEmbed(result)] }, { ephemeral: !result.ok });
    }
  },

  {
    data: new SlashCommandBuilder()
      .setName('work')
      .setDescription('💼 Trabaja para ganar monedas (una vez por hora)')
      .addStringOption(option =>
        option.setName('trabajo')
          .setDescription('Qué trabajo quieres hacer (si no eliges, te toca uno al azar)')
          .setRequired(false)
          .addChoices(
            { name: '👷 Constructor', value: 'constructor' },
            { name: '👨‍💼 Oficinista', value: 'oficinista' },
            { name: '🍕 Repartidor', value: 'repartidor' },
            { name: '🧑‍💻 Programador', value: 'programador' },
            { name: '🎨 Artista', value: 'artista' }
          )
      ),

    async execute(interaction: ChatInputCommandInteraction, bot: DiscordBot) {
      const choice = interaction.options.getString('trabajo');
      const jobKey: JobKey = choice && choice in JOBS ? choice as JobKey : pick(Object.keys(JOBS) as JobKey[]);
      const job = JOBS[jobKey];
      const guildId = interaction.guildId!;
      const userId = interaction.user.id;

      await interaction.deferReply();
      await ensureAccount(await resolveGuild(interaction), interaction.user);

      const result = await economyTask(guildId, userId, () => runTimedAction(guildId, userId, 'work', () => ({
        delta: Math.floor(Math.random() * (job.max - job.min + 1)) + job.min,
        info: null,
      })));

      if (!result.ok) {
        const embed = 'retryInMs' in result
          ? cooldownEmbed('⏳ Todavía estás cansado del último turno', result.retryInMs)
          : new EmbedBuilder().setColor(0xF39C12).setDescription(result.blocked);
        await respond(interaction, { embeds: [embed] }, { ephemeral: true });
        return;
      }

      const embed = new EmbedBuilder()
        .setColor(0x4CAF50)
        .setTitle(`${job.emoji} Trabajo: ${job.name}`)
        .setDescription(`Trabajaste como **${job.name}** y ganaste **${formatCoins(result.delta)}**.`)
        .addFields({ name: '💵 Cartera', value: formatCoins(result.balance), inline: true })
        .setFooter({ text: 'Puedes volver a trabajar en 1 hora.' })
        .setTimestamp();
      await respond(interaction, { embeds: [embed] });
    }
  },

  {
    data: new SlashCommandBuilder()
      .setName('deposit')
      .setDescription('🏦 Guarda monedas en el banco (ahí nadie te las puede robar)')
      .addStringOption(option =>
        option.setName('cantidad')
          .setDescription('Cuánto depositar, o "todo"')
          .setRequired(true)
      ),

    async execute(interaction: ChatInputCommandInteraction, bot: DiscordBot) {
      const request = parseAmount(interaction.options.getString('cantidad', true));
      if (!request) {
        await respond(interaction, `❌ Cantidad no válida. ${AMOUNT_HINT}`, { ephemeral: true });
        return;
      }
      const guildId = interaction.guildId!;
      const userId = interaction.user.id;

      await interaction.deferReply();
      await ensureAccount(await resolveGuild(interaction), interaction.user);
      const result = await economyTask(guildId, userId, () => deposit(guildId, userId, request));

      if (!result.ok) {
        await respond(interaction, bankErrorMessage('deposit', result), { ephemeral: true });
        return;
      }
      await respond(interaction, { embeds: [bankEmbed('deposit', result)] });
    }
  },

  {
    data: new SlashCommandBuilder()
      .setName('withdraw')
      .setDescription('🏦 Saca monedas del banco a tu cartera')
      .addStringOption(option =>
        option.setName('cantidad')
          .setDescription('Cuánto retirar, o "todo"')
          .setRequired(true)
      ),

    async execute(interaction: ChatInputCommandInteraction, bot: DiscordBot) {
      const request = parseAmount(interaction.options.getString('cantidad', true));
      if (!request) {
        await respond(interaction, `❌ Cantidad no válida. ${AMOUNT_HINT}`, { ephemeral: true });
        return;
      }
      const guildId = interaction.guildId!;
      const userId = interaction.user.id;

      await interaction.deferReply();
      await ensureAccount(await resolveGuild(interaction), interaction.user);
      const result = await economyTask(guildId, userId, () => withdraw(guildId, userId, request));

      if (!result.ok) {
        await respond(interaction, bankErrorMessage('withdraw', result), { ephemeral: true });
        return;
      }
      await respond(interaction, { embeds: [bankEmbed('withdraw', result)] });
    }
  },

  {
    data: new SlashCommandBuilder()
      .setName('crime')
      .setDescription('🔫 Arriesga el 20 % de tu cartera en un crimen (50 % de salir bien, cada 2 horas)'),

    async execute(interaction: ChatInputCommandInteraction, bot: DiscordBot) {
      const guildId = interaction.guildId!;
      const userId = interaction.user.id;

      await interaction.deferReply();
      await ensureAccount(await resolveGuild(interaction), interaction.user);

      const result = await economyTask(guildId, userId, () => runTimedAction<{ risk: number }>(guildId, userId, 'crime', (wallet) => {
        const risk = Math.floor(wallet * 0.2);
        if (risk <= 0) return { blocked: '❌ Necesitas al menos 5 monedas en la cartera para arriesgarte.' };
        const won = Math.random() < 0.5;
        return { delta: won ? risk : -risk, info: { risk } };
      }));

      if (!result.ok) {
        const embed = 'retryInMs' in result
          ? cooldownEmbed('🚓 La policía todavía te anda buscando', result.retryInMs)
          : new EmbedBuilder().setColor(0xF39C12).setDescription(result.blocked);
        await respond(interaction, { embeds: [embed] }, { ephemeral: true });
        return;
      }

      const amount = formatCoins(Math.abs(result.delta));
      const won = result.delta > 0;
      const text = won
        ? pick([
          `¡Asaltaste un banco y te llevaste **${amount}**!`,
          `¡Robaste una tienda y obtuviste **${amount}**!`,
          `¡Cometiste el crimen perfecto y ganaste **${amount}**!`,
        ])
        : pick([
          `¡Te atrapó la policía y perdiste **${amount}**!`,
          `¡El plan salió mal y te quitaron **${amount}**!`,
          `¡Te descubrieron y perdiste **${amount}**!`,
        ]);

      const embed = new EmbedBuilder()
        .setColor(won ? 0x4CAF50 : 0xF44336)
        .setTitle('🔫 Crimen')
        .setDescription(text)
        .addFields(
          { name: 'Arriesgaste', value: formatCoins(result.info.risk), inline: true },
          { name: '💵 Cartera', value: formatCoins(result.balance), inline: true }
        )
        .setFooter({ text: 'Puedes volver a intentarlo en 2 horas.' })
        .setTimestamp();
      await respond(interaction, { embeds: [embed] });
    }
  },

  {
    data: new SlashCommandBuilder()
      .setName('give')
      .setDescription('💸 Regálale monedas de tu cartera a otra persona')
      .addUserOption(option =>
        option.setName('usuario').setDescription('A quién le das las monedas').setRequired(true)
      )
      .addIntegerOption(option =>
        option.setName('cantidad').setDescription('Cuántas monedas').setRequired(true).setMinValue(1).setMaxValue(MAX_COINS)
      ),

    async execute(interaction: ChatInputCommandInteraction, bot: DiscordBot) {
      const from = interaction.user;
      const to = interaction.options.getUser('usuario', true);
      const amount = interaction.options.getInteger('cantidad', true);
      const guildId = interaction.guildId!;

      if (to.id === from.id) {
        await respond(interaction, '⛔ No puedes darte monedas a ti mismo.', { ephemeral: true });
        return;
      }
      if (to.bot) {
        await respond(interaction, '🤖 Los bots no usan monedas; elige a una persona.', { ephemeral: true });
        return;
      }
      if (!Number.isSafeInteger(amount) || amount <= 0) {
        await respond(interaction, '❌ La cantidad debe ser un número entero mayor que 0.', { ephemeral: true });
        return;
      }

      await interaction.deferReply();
      const guild = await resolveGuild(interaction);
      await ensureAccount(guild, from);
      await ensureAccount(guild, to);

      const result = await economyTask(guildId, from.id, () => transfer(guildId, from.id, to.id, amount));
      if (!result.ok) {
        const message = result.reason === 'insufficient'
          ? insufficientMessage(result.available)
          : `❌ ${to.displayName} ya tiene el máximo de monedas permitido en la cartera.`;
        await respond(interaction, message, { ephemeral: true });
        return;
      }

      const embed = new EmbedBuilder()
        .setColor(0x00C3FF)
        .setTitle('💸 Transferencia')
        .setDescription(`**${from.displayName}** le dio **${formatCoins(amount)}** a ${to}.`)
        .addFields({ name: 'Tu cartera', value: formatCoins(result.fromBalance), inline: true })
        .setTimestamp();
      await respond(interaction, { embeds: [embed] });
    }
  },

  {
    data: new SlashCommandBuilder()
      .setName('rob')
      .setDescription('🥷 Intenta robarle monedas de la cartera a alguien (cada 4 horas)')
      .addUserOption(option =>
        option.setName('usuario').setDescription('A quién intentas robar').setRequired(true)
      ),

    async execute(interaction: ChatInputCommandInteraction, bot: DiscordBot) {
      const robber = interaction.user;
      const target = interaction.options.getUser('usuario', true);
      const guildId = interaction.guildId!;

      if (target.id === robber.id) {
        await respond(interaction, '⛔ No puedes robarte a ti mismo.', { ephemeral: true });
        return;
      }
      if (target.bot) {
        await respond(interaction, '🤖 Los bots no tienen cartera que robar.', { ephemeral: true });
        return;
      }

      await interaction.deferReply();
      const guild = await resolveGuild(interaction);
      await ensureAccount(guild, robber);
      await ensureAccount(guild, target);

      const result = await economyTask(guildId, robber.id, () => attemptRob(guildId, robber.id, target.id));
      if (!result.ok) {
        if (result.reason === 'cooldown') {
          await respond(interaction, { embeds: [cooldownEmbed('🚔 Mejor espera a que se calme la cosa', result.retryInMs)] }, { ephemeral: true });
        } else if (result.reason === 'target_poor') {
          await respond(interaction, `❌ ${target.displayName} no trae suficiente dinero en la cartera (mínimo ${formatCoins(ROB_MIN_TARGET)}).`, { ephemeral: true });
        } else {
          await respond(interaction, `❌ Necesitas al menos ${formatCoins(ROB_MIN_ROBBER)} en la cartera para intentar un robo.`, { ephemeral: true });
        }
        return;
      }

      const embed = result.success
        ? new EmbedBuilder()
          .setColor(0x4CAF50)
          .setTitle('💰 ¡Robo exitoso!')
          .setDescription(`**${robber.displayName}** le robó **${formatCoins(result.amount)}** a ${target}.`)
          .addFields({ name: 'Tu cartera', value: formatCoins(result.robberBalance), inline: true })
        : new EmbedBuilder()
          .setColor(0xF44336)
          .setTitle('🚔 Robo fallido')
          .setDescription(`**${robber.displayName}** intentó robarle a ${target}, lo atraparon y pagó una multa de **${formatCoins(result.fine)}**.`)
          .addFields({ name: 'Tu cartera', value: formatCoins(result.robberBalance), inline: true });
      embed.setFooter({ text: 'Consejo: lo que guardas en el banco no se puede robar.' }).setTimestamp();
      await respond(interaction, { embeds: [embed] });
    }
  },

  {
    data: new SlashCommandBuilder()
      .setName('slut')
      .setDescription('💋 Trabajo nocturno de alto riesgo y mejor paga (cada 2 horas)'),

    async execute(interaction: ChatInputCommandInteraction, bot: DiscordBot) {
      const guildId = interaction.guildId!;
      const userId = interaction.user.id;

      await interaction.deferReply();
      await ensureAccount(await resolveGuild(interaction), interaction.user);

      // 70 % gana entre 200 y 1,000; 30 % pierde el 10 % de la cartera (máx. 300)
      const result = await economyTask(guildId, userId, () => runTimedAction(guildId, userId, 'slut', (wallet) => {
        if (Math.random() < 0.7) {
          return { delta: Math.floor(Math.random() * 801) + 200, info: null };
        }
        return { delta: -Math.min(Math.floor(wallet * 0.1), 300), info: null };
      }));

      if (!result.ok) {
        const embed = 'retryInMs' in result
          ? cooldownEmbed('😴 Necesitas descansar un rato', result.retryInMs)
          : new EmbedBuilder().setColor(0xF39C12).setDescription(result.blocked);
        await respond(interaction, { embeds: [embed] }, { ephemeral: true });
        return;
      }

      const amount = formatCoins(Math.abs(result.delta));
      let text: string;
      if (result.delta > 0) {
        text = pick([
          `💋 Tuviste una noche exitosa y ganaste **${amount}**.`,
          `💄 Un cliente generoso te dio **${amount}**.`,
          `✨ Trabajo bien pagado: obtuviste **${amount}**.`,
        ]);
      } else if (result.delta < 0) {
        text = pick([
          `🚔 La policía te multó y perdiste **${amount}**.`,
          `😠 Cliente problemático: perdiste **${amount}**.`,
          `💸 Noche sin suerte: perdiste **${amount}**.`,
        ]);
      } else {
        text = '💸 Noche sin suerte, pero como no traías dinero no perdiste nada.';
      }

      const embed = new EmbedBuilder()
        .setColor(result.delta > 0 ? 0xFF69B4 : 0xF44336)
        .setTitle('💋 Trabajo nocturno')
        .setDescription(text)
        .addFields({ name: '💵 Cartera', value: formatCoins(result.balance), inline: true })
        .setFooter({ text: 'Puedes volver a intentarlo en 2 horas.' })
        .setTimestamp();
      await respond(interaction, { embeds: [embed] });
    }
  },

  {
    data: new SlashCommandBuilder()
      .setName('leaderboard')
      .setDescription('🏆 Ranking de las personas con más monedas (cartera + banco)')
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

      const top = await topByWealth(interaction.guildId!, limit);
      if (top.length === 0) {
        await respond(interaction, 'Aún no hay nadie con monedas en este servidor. ¡Usa `/daily` para empezar!');
        return;
      }

      const lines = top.map((entry, index) => {
        const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `**${index + 1}.**`;
        return `${medal} <@${entry.userId}> — ${formatCoins(entry.total)}`;
      });

      const embed = new EmbedBuilder()
        .setColor(0xFFD700)
        .setTitle('🏆 Ranking de monedas')
        .setDescription(lines.join('\n'))
        .setFooter({ text: 'Cuenta cartera + banco' })
        .setTimestamp();
      await respond(interaction, { embeds: [embed] });
    }
  },

  // ===== Administración de la economía =====
  {
    data: new SlashCommandBuilder()
      .setName('add-money')
      .setDescription('⚙️ Dale monedas a alguien (solo admins)')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addUserOption(option =>
        option.setName('usuario').setDescription('A quién darle monedas').setRequired(true)
      )
      .addIntegerOption(option =>
        option.setName('cantidad').setDescription('Cuántas monedas').setRequired(true).setMinValue(1).setMaxValue(MAX_COINS)
      ),

    async execute(interaction: ChatInputCommandInteraction, bot: DiscordBot) {
      if (!isAdmin(interaction)) {
        await respond(interaction, ADMIN_ONLY, { ephemeral: true });
        return;
      }
      const target = interaction.options.getUser('usuario', true);
      const amount = interaction.options.getInteger('cantidad', true);
      const guildId = interaction.guildId!;

      if (target.bot) {
        await respond(interaction, '🤖 Los bots no usan monedas.', { ephemeral: true });
        return;
      }
      if (!Number.isSafeInteger(amount) || amount <= 0) {
        await respond(interaction, '❌ La cantidad debe ser mayor que 0.', { ephemeral: true });
        return;
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      await ensureAccount(await resolveGuild(interaction), target);
      const balance = await economyTask(guildId, target.id, () => adminAddCoins(guildId, target.id, amount));
      await respond(interaction, `✅ Le diste ${formatCoins(amount)} a ${target}. Su cartera ahora tiene ${formatCoins(balance)}.`);
    }
  },

  {
    data: new SlashCommandBuilder()
      .setName('remove-money')
      .setDescription('⚙️ Quítale monedas de la cartera a alguien (solo admins)')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addUserOption(option =>
        option.setName('usuario').setDescription('A quién quitarle monedas').setRequired(true)
      )
      .addStringOption(option =>
        option.setName('cantidad').setDescription('Cuántas monedas, o "todo"').setRequired(true)
      ),

    async execute(interaction: ChatInputCommandInteraction, bot: DiscordBot) {
      if (!isAdmin(interaction)) {
        await respond(interaction, ADMIN_ONLY, { ephemeral: true });
        return;
      }
      const target = interaction.options.getUser('usuario', true);
      const request = parseAmount(interaction.options.getString('cantidad', true));
      const guildId = interaction.guildId!;

      if (!request) {
        await respond(interaction, `❌ Cantidad no válida. ${AMOUNT_HINT}`, { ephemeral: true });
        return;
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const account = await getAccount(guildId, target.id);
      if (!account) {
        await respond(interaction, `❌ ${target} todavía no tiene cuenta en la economía.`);
        return;
      }
      const result = await economyTask(guildId, target.id, () => adminRemoveCoins(guildId, target.id, request));
      await respond(interaction, `✅ Le quitaste ${formatCoins(result.removed)} a ${target}. Su cartera ahora tiene ${formatCoins(result.balance)}.`);
    }
  },

  {
    data: new SlashCommandBuilder()
      .setName('reset-money')
      .setDescription('⚙️ Deja en cero la cartera y el banco de alguien (solo admins)')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addUserOption(option =>
        option.setName('usuario').setDescription('A quién reiniciar').setRequired(true)
      ),

    async execute(interaction: ChatInputCommandInteraction, bot: DiscordBot) {
      if (!isAdmin(interaction)) {
        await respond(interaction, ADMIN_ONLY, { ephemeral: true });
        return;
      }
      const target = interaction.options.getUser('usuario', true);
      const guildId = interaction.guildId!;

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const account = await getAccount(guildId, target.id);
      if (!account) {
        await respond(interaction, `❌ ${target} todavía no tiene cuenta en la economía.`);
        return;
      }
      await economyTask(guildId, target.id, () => adminResetAccount(guildId, target.id));
      await respond(interaction, `✅ La cartera y el banco de ${target} quedaron en cero.`);
    }
  },

  {
    data: new SlashCommandBuilder()
      .setName('economy-stats')
      .setDescription('📊 Estadísticas generales de la economía del servidor'),

    async execute(interaction: ChatInputCommandInteraction, bot: DiscordBot) {
      await interaction.deferReply();
      const stats = await economyStats(interaction.guildId!);

      if (stats.accounts === 0) {
        await respond(interaction, 'Aún no hay datos: nadie ha usado la economía en este servidor.');
        return;
      }

      const embed = new EmbedBuilder()
        .setColor(0x2ECC71)
        .setTitle('📊 Economía del servidor')
        .addFields(
          { name: '👥 Cuentas', value: stats.accounts.toLocaleString('es-MX'), inline: true },
          { name: '💰 Con monedas', value: stats.withMoney.toLocaleString('es-MX'), inline: true },
          { name: '​', value: '​', inline: true },
          { name: '💵 En carteras', value: formatCoins(stats.cash), inline: true },
          { name: '🏦 En bancos', value: formatCoins(stats.bank), inline: true },
          { name: '💎 Total', value: formatCoins(stats.cash + stats.bank), inline: true }
        )
        .setTimestamp();
      await respond(interaction, { embeds: [embed] });
    }
  },

  {
    data: new SlashCommandBuilder()
      .setName('add-money-role')
      .setDescription('⚙️ Dale monedas a todas las personas con un rol (solo admins)')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addRoleOption(option =>
        option.setName('rol').setDescription('Rol que recibe las monedas').setRequired(true)
      )
      .addIntegerOption(option =>
        option.setName('cantidad').setDescription('Cuántas monedas para cada persona').setRequired(true).setMinValue(1).setMaxValue(MAX_COINS)
      ),

    async execute(interaction: ChatInputCommandInteraction, bot: DiscordBot) {
      if (!isAdmin(interaction)) {
        await respond(interaction, ADMIN_ONLY, { ephemeral: true });
        return;
      }
      const role = interaction.options.getRole('rol', true);
      const amount = interaction.options.getInteger('cantidad', true);
      const guildId = interaction.guildId!;

      if (!Number.isSafeInteger(amount) || amount <= 0) {
        await respond(interaction, '❌ La cantidad debe ser mayor que 0.', { ephemeral: true });
        return;
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const guild = await resolveGuild(interaction);
      const members = await guild.members.fetch();
      const recipients = [...members.values()].filter(m => !m.user.bot && m.roles.cache.has(role.id));

      if (recipients.length === 0) {
        await respond(interaction, `Nadie (que no sea bot) tiene el rol ${role.name}.`);
        return;
      }

      for (const member of recipients) {
        await ensureAccount(guild, member.user);
      }
      await adminAddCoinsToMany(guildId, recipients.map(m => m.id), amount);

      await respond(interaction, `✅ Le diste ${formatCoins(amount)} a ${recipients.length.toLocaleString('es-MX')} ${recipients.length === 1 ? 'persona' : 'personas'} con el rol ${role.name}.`);
    }
  }
];

