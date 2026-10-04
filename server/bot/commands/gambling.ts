import { SlashCommandBuilder, ChatInputCommandInteraction, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, EmbedBuilder } from 'discord.js';
import { DiscordBot } from '../index';
import { storage } from '../../storage';

// Utilidades para blackjack
const suits = ['♠️', '♥️', '♦️', '♣️'];
const values = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

function getDeck() {
  const deck: string[] = [];
  for (const suit of suits) {
    for (const value of values) {
      deck.push(`${value}${suit}`);
    }
  }
  return deck;
}

function shuffle(deck: string[]) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
}

function getCardValue(card: string) {
  const value = card.slice(0, -2).replace(/[^A-Z0-9]/g, '') || card[0];
  if (value === 'A') return 11;
  if (['K', 'Q', 'J'].includes(value)) return 10;
  return parseInt(value);
}

function handValue(hand: string[]) {
  let total = 0;
  let aces = 0;
  for (const card of hand) {
    const val = getCardValue(card);
    total += val;
    if (card.startsWith('A')) aces++;
  }
  // Ajusta Ases de 11 a 1 si es necesario
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  return total;
}

function formatHand(hand: string[]) {
  return hand.join(' ');
}

// Símbolos para slot machine
const slotSymbols = [
  { symbol: '🍒', multiplier: 2 },
  { symbol: '🍋', multiplier: 3 },
  { symbol: '🔔', multiplier: 5 },
  { symbol: '⭐', multiplier: 10 },
  { symbol: '💎', multiplier: 20 }
];

function getRandomSymbol() {
  return slotSymbols[Math.floor(Math.random() * slotSymbols.length)];
}

export const gamblingCommands = [
  {
    data: new SlashCommandBuilder()
      .setName('blackjack')
      .setDescription('🃏 Juega blackjack contra el bot')
      .addStringOption(option =>
        option.setName('cantidad')
          .setDescription('Cantidad a apostar o "all" para apostar todo')
          .setRequired(true)
      ),
    
    async execute(interaction: ChatInputCommandInteraction, bot: DiscordBot) {
      const amountInput = interaction.options.getString('cantidad', true).toLowerCase();
      const userId = interaction.user.id;
      
      console.log(`[BLACKJACK-001] ${interaction.user.tag} iniciando blackjack con apuesta: ${amountInput}`);
      
      // Obtener economia del usuario
      let userEcon = await storage.getUserEconomy(userId, interaction.guildId!);
      if (!userEcon) {
        userEcon = await storage.createUserEconomy({
          userId: userId,
          guildId: interaction.guildId!,
          balance: "0",
          bank: "0"
        });
      }
      
      const balance = parseFloat(userEcon.balance || "0");
      let amount: number;
      
      if (amountInput === 'all') {
        if (balance < 1) {
          await interaction.reply('❌ No tienes dinero para apostar.');
          return;
        }
        amount = balance;
      } else {
        amount = parseInt(amountInput);
        if (isNaN(amount) || amount < 1) {
          await interaction.reply('❗ La apuesta debe ser mayor a 0 o "all".');
          return;
        }
        if (balance < amount) {
          await interaction.reply(`❌ No tienes suficiente dinero. Tu saldo: **${balance}** monedas.`);
          return;
        }
      }
      
      // Inicializar el juego
      const deck = getDeck();
      shuffle(deck);
      const playerHand = [deck.pop()!, deck.pop()!];
      const dealerHand = [deck.pop()!, deck.pop()!];
      
      const embed = new EmbedBuilder()
        .setTitle('🃏 Blackjack')
        .addFields(
          { name: 'Tu mano', value: `${formatHand(playerHand)}\nTotal: **${handValue(playerHand)}**`, inline: false },
          { name: 'Mano del dealer', value: `${dealerHand[0]} ❓`, inline: false },
          { name: 'Apuesta', value: `${amount} monedas`, inline: true }
        )
        .setColor(0x2ecc40);
      
      const row = new ActionRowBuilder<ButtonBuilder>()
        .addComponents(
          new ButtonBuilder().setCustomId('hit').setLabel('Pedir Carta').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('stand').setLabel('Plantarse').setStyle(ButtonStyle.Secondary)
        );
      
      await interaction.reply({ embeds: [embed], components: [row] });
      
      let currentHand = [...playerHand];
      let playerDone = false;
      let playerBusted = false;
      
      while (!playerDone) {
        const btnInteraction = await interaction.channel!.awaitMessageComponent({
          filter: i => i.user.id === interaction.user.id && ['hit', 'stand'].includes(i.customId),
          time: 60000,
          componentType: ComponentType.Button
        }).catch(() => null);
        
        if (!btnInteraction) {
          await interaction.editReply({ content: '⏰ Tiempo agotado. Juego cancelado.', components: [] });
          return;
        }
        
        if (btnInteraction.customId === 'hit') {
          currentHand.push(deck.pop()!);
          const playerTotal = handValue(currentHand);
          
          if (playerTotal > 21) {
            playerBusted = true;
            playerDone = true;
          }
          
          const updatedEmbed = new EmbedBuilder()
            .setTitle('🃏 Blackjack')
            .addFields(
              { name: 'Tu mano', value: `${formatHand(currentHand)}\nTotal: **${playerTotal}**${playerTotal > 21 ? ' ¡PASADO!' : ''}`, inline: false },
              { name: 'Mano del dealer', value: `${dealerHand[0]} ❓`, inline: false },
              { name: 'Apuesta', value: `${amount} monedas`, inline: true }
            )
            .setColor(playerTotal > 21 ? 0xe74c3c : 0x2ecc40);
          
          if (playerTotal > 21) {
            await btnInteraction.update({ embeds: [updatedEmbed], components: [] });
          } else {
            await btnInteraction.update({ embeds: [updatedEmbed], components: [row] });
          }
        } else if (btnInteraction.customId === 'stand') {
          playerDone = true;
          await btnInteraction.update({ components: [] });
        }
      }
      
      // Turno del dealer si el jugador no se pasó
      if (!playerBusted) {
        let dealerTotal = handValue(dealerHand);
        while (dealerTotal < 17) {
          dealerHand.push(deck.pop()!);
          dealerTotal = handValue(dealerHand);
        }
      }
      
      // Determinar resultado
      const playerTotal = handValue(currentHand);
      const dealerTotal = handValue(dealerHand);
      let result = '';
      let winAmount = 0;
      let color = 0xe74c3c;
      
      if (playerBusted) {
        result = '💥 ¡Te pasaste! Perdiste.';
        winAmount = -amount;
      } else if (dealerTotal > 21) {
        result = '🎉 ¡El dealer se pasó! ¡Ganaste!';
        winAmount = amount;
        color = 0x27ae60;
      } else if (playerTotal > dealerTotal) {
        result = '🎉 ¡Ganaste!';
        winAmount = amount;
        color = 0x27ae60;
      } else if (playerTotal < dealerTotal) {
        result = '💥 Perdiste.';
        winAmount = -amount;
      } else {
        result = '🤝 ¡Empate!';
        winAmount = 0;
        color = 0xf39c12;
      }
      
      // Actualizar saldo
      const newBalance = balance + winAmount;
      await storage.updateUserEconomy(userId, interaction.guildId!, {
        balance: newBalance.toString()
      });
      
      const finalEmbed = new EmbedBuilder()
        .setTitle('🃏 Blackjack - Resultado')
        .addFields(
          { name: 'Tu mano', value: `${formatHand(currentHand)}\nTotal: **${playerTotal}**`, inline: true },
          { name: 'Mano del dealer', value: `${formatHand(dealerHand)}\nTotal: **${dealerTotal}**`, inline: true },
          { name: 'Resultado', value: result, inline: false },
          { name: 'Cambio en saldo', value: `${winAmount > 0 ? '+' : ''}${winAmount} monedas`, inline: true },
          { name: 'Nuevo saldo', value: `${newBalance} monedas`, inline: true }
        )
        .setColor(color);
      
      await interaction.followUp({ embeds: [finalEmbed] });
      
      console.log(`[BLACKJACK-002] ${interaction.user.tag} resultado: ${result} - Ganancia: ${winAmount}`);
    }
  },

  {
    data: new SlashCommandBuilder()
      .setName('slots')
      .setDescription('🎰 Juega en la máquina tragamonedas')
      .addIntegerOption(option =>
        option.setName('cantidad')
          .setDescription('Cantidad a apostar')
          .setRequired(true)
          .setMinValue(1)
      ),
    
    async execute(interaction: ChatInputCommandInteraction, bot: DiscordBot) {
      const amount = interaction.options.getInteger('cantidad', true);
      const userId = interaction.user.id;
      
      console.log(`[SLOTS-001] ${interaction.user.tag} jugando slots con apuesta: ${amount}`);
      
      // Obtener economia del usuario
      let userEcon = await storage.getUserEconomy(userId, interaction.guildId!);
      if (!userEcon) {
        userEcon = await storage.createUserEconomy({
          userId: userId,
          guildId: interaction.guildId!,
          balance: "0",
          bank: "0"
        });
      }
      
      const balance = parseFloat(userEcon.balance || "0");
      
      if (balance < amount) {
        await interaction.reply(`❌ No tienes suficiente dinero. Tu saldo: **${balance}** monedas.`);
        return;
      }
      
      // Generar resultado
      const slot1 = getRandomSymbol();
      const slot2 = getRandomSymbol();
      const slot3 = getRandomSymbol();
      
      let winAmount = 0;
      let result = '';
      
      if (slot1.symbol === slot2.symbol && slot2.symbol === slot3.symbol) {
        // Triple match
        winAmount = amount * slot1.multiplier;
        result = `🎉 ¡TRIPLE ${slot1.symbol}! ¡Ganaste ${winAmount} monedas!`;
      } else if (slot1.symbol === slot2.symbol || slot2.symbol === slot3.symbol || slot1.symbol === slot3.symbol) {
        // Double match  
        const matchSymbol = slot1.symbol === slot2.symbol ? slot1 : 
                           slot2.symbol === slot3.symbol ? slot2 : slot1;
        winAmount = Math.floor(amount * (matchSymbol.multiplier * 0.5));
        result = `✨ ¡Doble ${matchSymbol.symbol}! ¡Ganaste ${winAmount} monedas!`;
      } else {
        // No match
        winAmount = -amount;
        result = '💥 Sin suerte esta vez. Perdiste.';
      }
      
      // Actualizar saldo
      const newBalance = balance + winAmount;
      await storage.updateUserEconomy(userId, interaction.guildId!, {
        balance: newBalance.toString()
      });
      
      const embed = new EmbedBuilder()
        .setTitle('🎰 Máquina Tragamonedas')
        .setDescription(`${slot1.symbol} | ${slot2.symbol} | ${slot3.symbol}`)
        .addFields(
          { name: 'Resultado', value: result, inline: false },
          { name: 'Apuesta', value: `${amount} monedas`, inline: true },
          { name: 'Ganancia/Pérdida', value: `${winAmount > 0 ? '+' : ''}${winAmount} monedas`, inline: true },
          { name: 'Nuevo saldo', value: `${newBalance} monedas`, inline: true }
        )
        .setColor(winAmount > 0 ? 0x27ae60 : 0xe74c3c);
      
      await interaction.reply({ embeds: [embed] });
      
      console.log(`[SLOTS-002] ${interaction.user.tag} resultado: ${result} - Ganancia: ${winAmount}`);
    }
  },

  {
    data: new SlashCommandBuilder()
      .setName('ruleta')
      .setDescription('🎲 Juega ruleta europea')
      .addStringOption(option =>
        option.setName('apuesta')
          .setDescription('Tipo de apuesta: número (0-36), rojo, negro, par, impar')
          .setRequired(true)
      )
      .addIntegerOption(option =>
        option.setName('cantidad')
          .setDescription('Cantidad a apostar')
          .setRequired(true)
          .setMinValue(1)
      ),
    
    async execute(interaction: ChatInputCommandInteraction, bot: DiscordBot) {
      const betType = interaction.options.getString('apuesta', true).toLowerCase();
      const amount = interaction.options.getInteger('cantidad', true);
      const userId = interaction.user.id;
      
      console.log(`[RULETA-001] ${interaction.user.tag} jugando ruleta: ${betType} por ${amount}`);
      
      // Obtener economia del usuario
      let userEcon = await storage.getUserEconomy(userId, interaction.guildId!);
      if (!userEcon) {
        userEcon = await storage.createUserEconomy({
          userId: userId,
          guildId: interaction.guildId!,
          balance: "0",
          bank: "0"
        });
      }
      
      const balance = parseFloat(userEcon.balance || "0");
      
      if (balance < amount) {
        await interaction.reply(`❌ No tienes suficiente dinero. Tu saldo: **${balance}** monedas.`);
        return;
      }
      
      // Generar número ganador
      const winningNumber = Math.floor(Math.random() * 37); // 0-36
      const redNumbers = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];
      const isRed = redNumbers.includes(winningNumber);
      const isEven = winningNumber !== 0 && winningNumber % 2 === 0;
      
      let winAmount = 0;
      let won = false;
      
      // Verificar tipo de apuesta
      if (!isNaN(parseInt(betType))) {
        // Apuesta a número específico
        const betNumber = parseInt(betType);
        if (betNumber < 0 || betNumber > 36) {
          await interaction.reply('❗ Los números deben estar entre 0 y 36.');
          return;
        }
        if (betNumber === winningNumber) {
          winAmount = amount * 36;
          won = true;
        }
      } else if (betType === 'rojo') {
        if (isRed && winningNumber !== 0) {
          winAmount = amount * 2;
          won = true;
        }
      } else if (betType === 'negro') {
        if (!isRed && winningNumber !== 0) {
          winAmount = amount * 2;
          won = true;
        }
      } else if (betType === 'par') {
        if (isEven) {
          winAmount = amount * 2;
          won = true;
        }
      } else if (betType === 'impar') {
        if (!isEven && winningNumber !== 0) {
          winAmount = amount * 2;
          won = true;
        }
      } else {
        await interaction.reply('❗ Apuestas válidas: número (0-36), rojo, negro, par, impar.');
        return;
      }
      
      if (!won) {
        winAmount = -amount;
      }
      
      // Actualizar saldo
      const newBalance = balance + winAmount;
      await storage.updateUserEconomy(userId, interaction.guildId!, {
        balance: newBalance.toString()
      });
      
      const color = winningNumber === 0 ? '🟢' : isRed ? '🔴' : '⚫';
      const result = won ? '🎉 ¡GANASTE!' : '💥 Perdiste';
      
      const embed = new EmbedBuilder()
        .setTitle('🎲 Ruleta Europea')
        .setDescription(`Número ganador: **${color} ${winningNumber}**`)
        .addFields(
          { name: 'Tu apuesta', value: `${betType} por ${amount} monedas`, inline: true },
          { name: 'Resultado', value: result, inline: true },
          { name: 'Ganancia/Pérdida', value: `${winAmount > 0 ? '+' : ''}${winAmount} monedas`, inline: true },
          { name: 'Nuevo saldo', value: `${newBalance} monedas`, inline: true }
        )
        .setColor(won ? 0x27ae60 : 0xe74c3c);
      
      await interaction.reply({ embeds: [embed] });
      
      console.log(`[RULETA-002] ${interaction.user.tag} número: ${winningNumber}, ${won ? 'ganó' : 'perdió'} - Ganancia: ${winAmount}`);
    }
  },

  {
    data: new SlashCommandBuilder()
      .setName('dado')
      .setDescription('🎲 Tira un dado, gana solo si sale 6')
      .addIntegerOption(option =>
        option.setName('cantidad')
          .setDescription('Cantidad a apostar (opcional, sin apuesta solo muestra el resultado)')
          .setRequired(false)
          .setMinValue(1)
      ),
    
    async execute(interaction: ChatInputCommandInteraction, bot: DiscordBot) {
      const amount = interaction.options.getInteger('cantidad');
      const userId = interaction.user.id;
      
      console.log(`[DADO-001] ${interaction.user.tag} tirando dado${amount ? ` con apuesta: ${amount}` : ' gratis'}`);
      
      // Generar resultado del dado
      const diceResult = Math.floor(Math.random() * 6) + 1;
      const won = diceResult === 6;
      
      if (!amount) {
        // Solo mostrar resultado sin apostar
        const embed = new EmbedBuilder()
          .setTitle('🎲 Dado de la Suerte')
          .setDescription(`Resultado: **${diceResult}**`)
          .addFields(
            { name: 'Estado', value: won ? '🎉 ¡Salió 6!' : '🎲 Intenta de nuevo', inline: true }
          )
          .setColor(won ? 0x27ae60 : 0x95a5a6);
        
        await interaction.reply({ embeds: [embed] });
        return;
      }
      
      // Obtener economia del usuario para apostar
      let userEcon = await storage.getUserEconomy(userId, interaction.guildId!);
      if (!userEcon) {
        userEcon = await storage.createUserEconomy({
          userId: userId,
          guildId: interaction.guildId!,
          balance: "0",
          bank: "0"
        });
      }
      
      const balance = parseFloat(userEcon.balance || "0");
      
      if (balance < amount) {
        await interaction.reply(`❌ No tienes suficiente dinero. Tu saldo: **${balance}** monedas.`);
        return;
      }
      
      let winAmount = 0;
      if (won) {
        winAmount = amount * 6; // x6 multiplier si sale 6
      } else {
        winAmount = -amount;
      }
      
      // Actualizar saldo
      const newBalance = balance + winAmount;
      await storage.updateUserEconomy(userId, interaction.guildId!, {
        balance: newBalance.toString()
      });
      
      const result = won ? '🎉 ¡GANASTE! Salió 6!' : `💥 Salió ${diceResult}. Perdiste.`;
      
      const embed = new EmbedBuilder()
        .setTitle('🎲 Dado de la Suerte')
        .setDescription(`Resultado: **${diceResult}**`)
        .addFields(
          { name: 'Apuesta', value: `${amount} monedas`, inline: true },
          { name: 'Resultado', value: result, inline: true },
          { name: 'Ganancia/Pérdida', value: `${winAmount > 0 ? '+' : ''}${winAmount} monedas`, inline: true },
          { name: 'Nuevo saldo', value: `${newBalance} monedas`, inline: true }
        )
        .setColor(won ? 0x27ae60 : 0xe74c3c);
      
      await interaction.reply({ embeds: [embed] });
      
      console.log(`[DADO-002] ${interaction.user.tag} dado: ${diceResult}, ${won ? 'ganó' : 'perdió'} - Ganancia: ${winAmount}`);
    }
  },

  {
    data: new SlashCommandBuilder()
      .setName('ruleta-rusa')
      .setDescription('💥 Apuesta TODO tu dinero, sobrevive y lo duplicas')
      .addIntegerOption(option =>
        option.setName('camaras')
          .setDescription('Número de cámaras del revólver (2-12, default: 6)')
          .setRequired(false)
          .setMinValue(2)
          .setMaxValue(12)
      ),
    
    async execute(interaction: ChatInputCommandInteraction, bot: DiscordBot) {
      const chambers = interaction.options.getInteger('camaras') || 6;
      const userId = interaction.user.id;
      
      console.log(`[RULETA-RUSA-001] ${interaction.user.tag} jugando ruleta rusa con ${chambers} cámaras`);
      
      // Obtener economia del usuario
      let userEcon = await storage.getUserEconomy(userId, interaction.guildId!);
      if (!userEcon) {
        userEcon = await storage.createUserEconomy({
          userId: userId,
          guildId: interaction.guildId!,
          balance: "0",
          bank: "0"
        });
      }
      
      const balance = parseFloat(userEcon.balance || "0");
      
      if (balance < 100) {
        await interaction.reply('❌ Necesitas al menos 100 monedas para jugar ruleta rusa.');
        return;
      }
      
      // Generar resultado (1 cámara tiene bala)
      const bulletChamber = Math.floor(Math.random() * chambers) + 1;
      const playerChamber = Math.floor(Math.random() * chambers) + 1;
      const survived = bulletChamber !== playerChamber;
      
      let newBalance: number;
      let result: string;
      let color: number;
      
      if (survived) {
        newBalance = balance * 2; // Duplica el dinero
        result = `🎉 ¡SOBREVIVISTE! La bala estaba en la cámara ${bulletChamber}, tú elegiste la ${playerChamber}.`;
        color = 0x27ae60;
      } else {
        newBalance = 0; // Pierde todo
        result = `💥 ¡LA BALA! Ambos elegisteis la cámara ${bulletChamber}. Perdiste todo tu dinero.`;
        color = 0xe74c3c;
      }
      
      // Actualizar saldo
      await storage.updateUserEconomy(userId, interaction.guildId!, {
        balance: newBalance.toString()
      });
      
      const embed = new EmbedBuilder()
        .setTitle('💥 Ruleta Rusa')
        .setDescription(`Revólver con ${chambers} cámaras, 1 bala`)
        .addFields(
          { name: 'Saldo apostado', value: `${balance} monedas (TODO)`, inline: true },
          { name: 'Resultado', value: result, inline: false },
          { name: 'Nuevo saldo', value: `${newBalance} monedas`, inline: true },
          { name: 'Probabilidad de supervivencia', value: `${((chambers - 1) / chambers * 100).toFixed(1)}%`, inline: true }
        )
        .setColor(color);
      
      await interaction.reply({ embeds: [embed] });
      
      console.log(`[RULETA-RUSA-002] ${interaction.user.tag} ${survived ? 'sobrevivió' : 'murió'} - Saldo: ${balance} -> ${newBalance}`);
    }
  }
];