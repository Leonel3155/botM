import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  EmbedBuilder,
  MessageFlags,
  SlashCommandIntegerOption,
} from 'discord.js';
import { DiscordBot } from '../index';
import {
  AMOUNT_HINT,
  AmountRequest,
  BetResult,
  MAX_COINS,
  economyTask,
  ensureAccount,
  formatCoins,
  holdBet,
  parseAmount,
  playInstantBet,
  SettleError,
  settleBet,
} from '../services/economy';
import { resolveGuild, respond } from '../utils/interactions';

// ===== Blackjack =====
const suits = ['♠️', '♥️', '♦️', '♣️'];
const values = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

interface Card { value: string; suit: string }

function getDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of suits) {
    for (const value of values) deck.push({ value, suit });
  }
  // Fisher-Yates
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function cardPoints(card: Card): number {
  if (card.value === 'A') return 11;
  if (['K', 'Q', 'J'].includes(card.value)) return 10;
  return parseInt(card.value, 10);
}

export function handValue(hand: Card[]): number {
  let total = 0;
  let aces = 0;
  for (const card of hand) {
    total += cardPoints(card);
    if (card.value === 'A') aces++;
  }
  // Los ases valen 1 en vez de 11 si te pasas
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  return total;
}

function formatHand(hand: Card[]): string {
  return hand.map(c => `${c.value}${c.suit}`).join(' ');
}

// ===== Tragamonedas =====
// Pago total (incluye la apuesta). Retorno esperado ≈ 95 %.
export const slotSymbols = [
  { symbol: '🍒', triple: 3, pair: 1 },
  { symbol: '🍋', triple: 5, pair: 1 },
  { symbol: '🔔', triple: 8, pair: 1 },
  { symbol: '⭐', triple: 10, pair: 1.5 },
  { symbol: '💎', triple: 15, pair: 2 },
];

type SlotSymbol = typeof slotSymbols[number];

function spinSlot(): SlotSymbol {
  return slotSymbols[Math.floor(Math.random() * slotSymbols.length)];
}

export function slotsMultiplier(reels: SlotSymbol[]): { multiplier: number; kind: 'triple' | 'pair' | 'none'; symbol?: SlotSymbol } {
  const [a, b, c] = reels;
  if (a.symbol === b.symbol && b.symbol === c.symbol) return { multiplier: a.triple, kind: 'triple', symbol: a };
  const pairSymbol = a.symbol === b.symbol || a.symbol === c.symbol ? a : b.symbol === c.symbol ? b : undefined;
  if (pairSymbol) return { multiplier: pairSymbol.pair, kind: 'pair', symbol: pairSymbol };
  return { multiplier: 0, kind: 'none' };
}

// ===== Ruleta =====
const RED_NUMBERS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

type RouletteBet = { kind: 'number'; number: number } | { kind: 'rojo' | 'negro' | 'par' | 'impar' };

export function parseRouletteBet(raw: string): RouletteBet | null {
  const text = raw.trim().toLowerCase();
  if (/^\d{1,2}$/.test(text)) {
    const number = parseInt(text, 10);
    return number >= 0 && number <= 36 ? { kind: 'number', number } : null;
  }
  if (text === 'rojo' || text === 'negro' || text === 'par' || text === 'impar') return { kind: text };
  return null;
}

// Pago total de la ruleta europea: pleno 36x, color o paridad 2x (el 0 no es rojo, negro, par ni impar)
export function roulettePayoutMultiplier(bet: RouletteBet, winning: number): number {
  if (bet.kind === 'number') return bet.number === winning ? 36 : 0;
  if (winning === 0) return 0;
  const isRed = RED_NUMBERS.has(winning);
  const isEven = winning % 2 === 0;
  switch (bet.kind) {
    case 'rojo': return isRed ? 2 : 0;
    case 'negro': return !isRed ? 2 : 0;
    case 'par': return isEven ? 2 : 0;
    case 'impar': return !isEven ? 2 : 0;
  }
}

function betFailureMessage(result: Extract<BetResult<unknown>, { ok: false }>): string {
  if (result.reason === 'min') {
    return `❌ Necesitas al menos ${formatCoins(result.min ?? 1)} en la cartera para jugar esto.`;
  }
  if (result.reason === 'empty' || result.available <= 0) {
    return '❌ No tienes monedas en la cartera. Usa `/daily` o `/work` para conseguir algunas.';
  }
  return `❌ No te alcanza: en la cartera tienes ${formatCoins(result.available)}.`;
}

function signed(n: number): string {
  return `${n > 0 ? '+' : n < 0 ? '−' : ''}${formatCoins(Math.abs(n))}`;
}

async function startBet(interaction: ChatInputCommandInteraction): Promise<{ guildId: string; userId: string }> {
  await interaction.deferReply();
  await ensureAccount(await resolveGuild(interaction), interaction.user);
  return { guildId: interaction.guildId!, userId: interaction.user.id };
}

function amountOption(description: string) {
  return (option: SlashCommandIntegerOption) =>
    option.setName('cantidad').setDescription(description).setRequired(true).setMinValue(1).setMaxValue(MAX_COINS);
}

export const gamblingCommands = [
  {
    data: new SlashCommandBuilder()
      .setName('blackjack')
      .setDescription('🃏 Juega blackjack contra el bot (gana 1:1, blackjack natural paga 3:2)')
      .addStringOption(option =>
        option.setName('cantidad')
          .setDescription('Cuánto apostar, o "todo"')
          .setRequired(true)
      ),

    async execute(interaction: ChatInputCommandInteraction, bot: DiscordBot) {
      const request: AmountRequest | null = parseAmount(interaction.options.getString('cantidad', true));
      if (!request) {
        await respond(interaction, `❌ Apuesta no válida. ${AMOUNT_HINT}`, { ephemeral: true });
        return;
      }

      const { guildId, userId } = await startBet(interaction);

      // La apuesta se retiene al empezar, así no se puede gastar en otra cosa durante la partida
      const hold = await economyTask(guildId, userId, () => holdBet(guildId, userId, request));
      if (!hold.ok) {
        await respond(interaction, betFailureMessage(hold), { ephemeral: true });
        return;
      }
      const bet = hold.bet;
      let settled = false;

      try {
        const deck = getDeck();
        const player = [deck.pop()!, deck.pop()!];
        const dealer = [deck.pop()!, deck.pop()!];
        let timedOut = false;

        const ids = { hit: `bj:hit:${interaction.id}`, stand: `bj:stand:${interaction.id}` };
        const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId(ids.hit).setLabel('Pedir carta').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(ids.stand).setLabel('Plantarse').setStyle(ButtonStyle.Secondary)
        );

        const tableEmbed = () => new EmbedBuilder()
          .setTitle('🃏 Blackjack')
          .setColor(0x2ECC40)
          .addFields(
            { name: 'Tu mano', value: `${formatHand(player)}\nTotal: **${handValue(player)}**`, inline: false },
            { name: 'Mano del crupier', value: `${formatHand([dealer[0]])} ❓`, inline: false },
            { name: 'Apuesta', value: formatCoins(bet), inline: true }
          )
          .setFooter({ text: 'Tienes 60 segundos por jugada; si no eliges, te plantas.' });

        const naturalBlackjack = handValue(player) === 21;

        if (!naturalBlackjack) {
          const message = await interaction.editReply({ embeds: [tableEmbed()], components: [buttons] });

          await new Promise<void>((resolve) => {
            let finished = false;
            const collector = message.createMessageComponentCollector({
              componentType: ComponentType.Button,
              idle: 60_000,
              time: 10 * 60_000,
            });

            collector.on('collect', async (click) => {
              try {
                if (click.user.id !== userId) {
                  await click.reply({ content: 'Esta partida no es tuya. Empieza la tuya con `/blackjack`. 🃏', flags: MessageFlags.Ephemeral });
                  return;
                }
                if (finished) {
                  await click.deferUpdate();
                  return;
                }
                if (click.customId === ids.hit) {
                  player.push(deck.pop()!);
                  if (handValue(player) >= 21) {
                    finished = true;
                    collector.stop('done');
                    await click.deferUpdate();
                    return;
                  }
                  await click.update({ embeds: [tableEmbed()], components: [buttons] });
                } else if (click.customId === ids.stand) {
                  finished = true;
                  collector.stop('done');
                  await click.deferUpdate();
                }
              } catch (error) {
                console.error('Blackjack: error al responder un botón:', error);
              }
            });

            collector.on('end', (_collected, reason) => {
              timedOut = reason === 'idle' || reason === 'time';
              resolve();
            });
          });
        }

        // Turno del crupier (pide hasta 17) si el jugador no se pasó
        const playerTotal = handValue(player);
        const playerBusted = playerTotal > 21;
        if (!playerBusted && !naturalBlackjack) {
          while (handValue(dealer) < 17) dealer.push(deck.pop()!);
        }
        const dealerTotal = handValue(dealer);
        const dealerNatural = dealer.length === 2 && dealerTotal === 21;

        let result: string;
        let payout: number;
        if (naturalBlackjack) {
          if (dealerNatural) {
            result = '🤝 ¡Los dos tienen blackjack! Empate: recuperas tu apuesta.';
            payout = bet;
          } else {
            result = '🌟 ¡BLACKJACK natural! Pagamos 3:2.';
            payout = bet + Math.floor(bet * 1.5);
          }
        } else if (playerBusted) {
          result = '💥 Te pasaste de 21. Perdiste.';
          payout = 0;
        } else if (dealerNatural) {
          result = '💥 El crupier tiene blackjack natural. Perdiste.';
          payout = 0;
        } else if (dealerTotal > 21) {
          result = '🎉 ¡El crupier se pasó! Ganaste.';
          payout = bet * 2;
        } else if (playerTotal > dealerTotal) {
          result = '🎉 ¡Ganaste!';
          payout = bet * 2;
        } else if (playerTotal < dealerTotal) {
          result = '💥 El crupier gana. Perdiste.';
          payout = 0;
        } else {
          result = '🤝 Empate: recuperas tu apuesta.';
          payout = bet;
        }
        if (timedOut) result = `⏰ Se acabó el tiempo y te plantaste automáticamente.\n${result}`;

        settled = true;
        const balance = await settleWithRetry(guildId, userId, bet, payout);
        const net = payout - bet;

        const finalEmbed = new EmbedBuilder()
          .setTitle('🃏 Blackjack: resultado')
          .setColor(net > 0 ? 0x27AE60 : net < 0 ? 0xE74C3C : 0xF39C12)
          .addFields(
            { name: 'Tu mano', value: `${formatHand(player)}\nTotal: **${playerTotal}**`, inline: true },
            { name: 'Mano del crupier', value: `${formatHand(dealer)}\nTotal: **${dealerTotal}**`, inline: true },
            { name: 'Resultado', value: result, inline: false },
            { name: 'Apuesta', value: formatCoins(bet), inline: true },
            { name: 'Ganancia/pérdida', value: signed(net), inline: true },
            {
              name: '💵 Cartera',
              value: balance === null
                ? `⚠️ No pude registrar el resultado en tu saldo. Avisa a un admin (apuesta ${formatCoins(bet)}, pago ${formatCoins(payout)}).`
                : formatCoins(balance),
              inline: true,
            }
          );

        await interaction.editReply({ embeds: [finalEmbed], components: [] });
      } finally {
        // Si algo falló antes de pagar (p. ej. Discord no respondió), devolvemos la apuesta
        if (!settled) {
          await settleWithRetry(guildId, userId, bet, bet);
        }
      }
    }
  },

  {
    data: new SlashCommandBuilder()
      .setName('slots')
      .setDescription('🎰 Juega en la tragamonedas')
      .addIntegerOption(amountOption('Cuánto apostar')),

    async execute(interaction: ChatInputCommandInteraction, bot: DiscordBot) {
      const amount = interaction.options.getInteger('cantidad', true);
      if (!Number.isSafeInteger(amount) || amount < 1) {
        await respond(interaction, '❌ La apuesta debe ser un número entero mayor que 0.', { ephemeral: true });
        return;
      }

      const { guildId, userId } = await startBet(interaction);
      const result = await economyTask(guildId, userId, () => playInstantBet(guildId, userId, { all: false, amount }, (bet) => {
        const reels = [spinSlot(), spinSlot(), spinSlot()];
        const outcome = slotsMultiplier(reels);
        return { payout: Math.floor(bet * outcome.multiplier), info: { reels, outcome } };
      }));

      if (!result.ok) {
        await respond(interaction, betFailureMessage(result), { ephemeral: true });
        return;
      }

      const { reels, outcome } = result.info;
      let text: string;
      if (outcome.kind === 'triple') text = `🎉 ¡TRIPLE ${outcome.symbol!.symbol}! Pago x${outcome.multiplier}.`;
      else if (outcome.kind === 'pair' && outcome.multiplier > 1) text = `✨ ¡Par de ${outcome.symbol!.symbol}! Pago x${outcome.multiplier}.`;
      else if (outcome.kind === 'pair') text = `😌 Par de ${outcome.symbol!.symbol}: recuperas tu apuesta.`;
      else text = '💥 Sin suerte esta vez.';

      const embed = new EmbedBuilder()
        .setTitle('🎰 Tragamonedas')
        .setDescription(`**[ ${reels.map(r => r.symbol).join(' | ')} ]**`)
        .addFields(
          { name: 'Resultado', value: text, inline: false },
          { name: 'Apuesta', value: formatCoins(result.bet), inline: true },
          { name: 'Ganancia/pérdida', value: signed(result.net), inline: true },
          { name: '💵 Cartera', value: formatCoins(result.balance), inline: true }
        )
        .setFooter({ text: 'Triples: 🍒x3 🍋x5 🔔x8 ⭐x10 💎x15 · Pares: ⭐x1.5 💎x2, los demás devuelven la apuesta' })
        .setColor(result.net > 0 ? 0x27AE60 : result.net < 0 ? 0xE74C3C : 0xF39C12);
      await respond(interaction, { embeds: [embed] });
    }
  },

  {
    data: new SlashCommandBuilder()
      .setName('ruleta')
      .setDescription('🎲 Ruleta europea: número (paga x36), rojo, negro, par o impar (pagan x2)')
      .addStringOption(option =>
        option.setName('apuesta')
          .setDescription('Un número del 0 al 36, o: rojo, negro, par, impar')
          .setRequired(true)
      )
      .addIntegerOption(amountOption('Cuánto apostar')),

    async execute(interaction: ChatInputCommandInteraction, bot: DiscordBot) {
      const rawBet = interaction.options.getString('apuesta', true);
      const betType = parseRouletteBet(rawBet);
      const amount = interaction.options.getInteger('cantidad', true);

      if (!betType) {
        await respond(interaction, '❗ Apuestas válidas: un número del 0 al 36, `rojo`, `negro`, `par` o `impar`.', { ephemeral: true });
        return;
      }
      if (!Number.isSafeInteger(amount) || amount < 1) {
        await respond(interaction, '❌ La apuesta debe ser un número entero mayor que 0.', { ephemeral: true });
        return;
      }

      const { guildId, userId } = await startBet(interaction);
      const result = await economyTask(guildId, userId, () => playInstantBet(guildId, userId, { all: false, amount }, (bet) => {
        const winning = Math.floor(Math.random() * 37); // 0-36
        return { payout: bet * roulettePayoutMultiplier(betType, winning), info: { winning } };
      }));

      if (!result.ok) {
        await respond(interaction, betFailureMessage(result), { ephemeral: true });
        return;
      }

      const winning = result.info.winning;
      const color = winning === 0 ? '🟢' : RED_NUMBERS.has(winning) ? '🔴' : '⚫';
      const won = result.payout > 0;
      const betLabel = betType.kind === 'number' ? `al ${betType.number}` : `a ${betType.kind}`;

      const embed = new EmbedBuilder()
        .setTitle('🎲 Ruleta europea')
        .setDescription(`Salió el **${color} ${winning}**`)
        .addFields(
          { name: 'Tu apuesta', value: `${formatCoins(result.bet)} ${betLabel}`, inline: true },
          { name: 'Resultado', value: won ? '🎉 ¡Ganaste!' : '💥 Perdiste', inline: true },
          { name: 'Ganancia/pérdida', value: signed(result.net), inline: true },
          { name: '💵 Cartera', value: formatCoins(result.balance), inline: true }
        )
        .setColor(won ? 0x27AE60 : 0xE74C3C);
      await respond(interaction, { embeds: [embed] });
    }
  },

  {
    data: new SlashCommandBuilder()
      .setName('dado')
      .setDescription('🎲 Tira un dado: si sale 6 ganas 6 veces lo que apostaste')
      .addIntegerOption(option =>
        option.setName('cantidad')
          .setDescription('Cuánto apostar (opcional; sin apuesta solo tiras por diversión)')
          .setRequired(false)
          .setMinValue(1)
          .setMaxValue(MAX_COINS)
      ),

    async execute(interaction: ChatInputCommandInteraction, bot: DiscordBot) {
      const amount = interaction.options.getInteger('cantidad');

      if (!amount) {
        const roll = Math.floor(Math.random() * 6) + 1;
        const embed = new EmbedBuilder()
          .setTitle('🎲 Dado de la suerte')
          .setDescription(`Salió: **${roll}**`)
          .addFields({ name: 'Estado', value: roll === 6 ? '🎉 ¡Salió 6!' : '🎲 Intenta de nuevo', inline: true })
          .setColor(roll === 6 ? 0x27AE60 : 0x95A5A6);
        await respond(interaction, { embeds: [embed] });
        return;
      }
      if (!Number.isSafeInteger(amount) || amount < 1) {
        await respond(interaction, '❌ La apuesta debe ser un número entero mayor que 0.', { ephemeral: true });
        return;
      }

      const { guildId, userId } = await startBet(interaction);
      const result = await economyTask(guildId, userId, () => playInstantBet(guildId, userId, { all: false, amount }, (bet) => {
        const roll = Math.floor(Math.random() * 6) + 1;
        return { payout: roll === 6 ? bet * 6 : 0, info: { roll } };
      }));

      if (!result.ok) {
        await respond(interaction, betFailureMessage(result), { ephemeral: true });
        return;
      }

      const won = result.info.roll === 6;
      const embed = new EmbedBuilder()
        .setTitle('🎲 Dado de la suerte')
        .setDescription(`Salió: **${result.info.roll}**`)
        .addFields(
          { name: 'Apuesta', value: formatCoins(result.bet), inline: true },
          { name: 'Resultado', value: won ? '🎉 ¡Salió 6! Ganaste' : '💥 No salió 6. Perdiste', inline: true },
          { name: 'Ganancia/pérdida', value: signed(result.net), inline: true },
          { name: '💵 Cartera', value: formatCoins(result.balance), inline: true }
        )
        .setColor(won ? 0x27AE60 : 0xE74C3C);
      await respond(interaction, { embeds: [embed] });
    }
  },

  {
    data: new SlashCommandBuilder()
      .setName('ruleta-rusa')
      .setDescription('💥 Apuestas TODA tu cartera: con más cámaras es más seguro, pero ganas menos')
      .addIntegerOption(option =>
        option.setName('camaras')
          .setDescription('Cámaras del revólver (2 a 12, por defecto 6). Con 2 cámaras duplicas.')
          .setRequired(false)
          .setMinValue(2)
          .setMaxValue(12)
      ),

    async execute(interaction: ChatInputCommandInteraction, bot: DiscordBot) {
      const chambers = interaction.options.getInteger('camaras') || 6;
      const minBet = 100;

      const { guildId, userId } = await startBet(interaction);
      // Juego justo: sobrevives con probabilidad (c-1)/c y ganas 1/(c-1) de lo apostado
      const result = await economyTask(guildId, userId, () => playInstantBet(guildId, userId, { all: true }, (bet) => {
        const bulletChamber = Math.floor(Math.random() * chambers) + 1;
        const firedChamber = Math.floor(Math.random() * chambers) + 1;
        const survived = bulletChamber !== firedChamber;
        return {
          payout: survived ? bet + Math.floor(bet / (chambers - 1)) : 0,
          info: { survived, bulletChamber, firedChamber },
        };
      }, minBet));

      if (!result.ok) {
        const message = result.reason === 'min' || result.reason === 'empty'
          ? `❌ Necesitas al menos ${formatCoins(minBet)} en la cartera para jugar a la ruleta rusa.`
          : betFailureMessage(result);
        await respond(interaction, message, { ephemeral: true });
        return;
      }

      const { survived, bulletChamber, firedChamber } = result.info;
      const text = survived
        ? `🎉 ¡SOBREVIVISTE! La bala estaba en la cámara ${bulletChamber} y se disparó la ${firedChamber}.`
        : `💥 ¡BANG! La bala estaba justo en la cámara ${bulletChamber}. Perdiste todo lo de tu cartera.`;

      const embed = new EmbedBuilder()
        .setTitle('💥 Ruleta rusa')
        .setDescription(`Revólver de ${chambers} cámaras con 1 bala`)
        .addFields(
          { name: 'Apostaste (toda tu cartera)', value: formatCoins(result.bet), inline: true },
          { name: 'Probabilidad de sobrevivir', value: `${(((chambers - 1) / chambers) * 100).toFixed(1)} %`, inline: true },
          { name: 'Resultado', value: text, inline: false },
          { name: 'Ganancia/pérdida', value: signed(result.net), inline: true },
          { name: '💵 Cartera', value: formatCoins(result.balance), inline: true }
        )
        .setFooter({ text: 'Tip: lo que tienes en el banco no se apuesta.' })
        .setColor(survived ? 0x27AE60 : 0xE74C3C);
      await respond(interaction, { embeds: [embed] });
    }
  }
];

// Paga el resultado de una apuesta retenida. Reintenta una vez, pero solo si es seguro que el primer
// intento no guardó nada (SettleError.safeToRetry); ante la duda no reintenta, para no pagar dos veces.
async function settleWithRetry(guildId: string, userId: string, bet: number, payout: number): Promise<number | null> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      return await economyTask(guildId, userId, () => settleBet(guildId, userId, bet, payout));
    } catch (error) {
      const retry = attempt < 2 && error instanceof SettleError && error.safeToRetry;
      console.error(
        `Blackjack: no se pudo pagar (intento ${attempt}${retry ? ', se reintenta' : ', sin reintento'}) a ${userId} en ${guildId}: apuesta ${bet}, pago ${payout}`,
        error
      );
      if (!retry) break;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  return null;
}
