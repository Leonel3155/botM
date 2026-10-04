import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder, MessageFlags } from 'discord.js';
import { storage } from '../../storage';
import { DiscordBot } from '../index';
import { globalQueue, economyQueueFor } from '../services/queues';
import { lockForUser } from '../services/locks';
import { db } from '../../db';
import { sql } from 'drizzle-orm';

// Complete economy system with all UnbelievaBoat-style commands
export const economyCommands = [
  {
    data: new SlashCommandBuilder()
      .setName('balance')
      .setDescription('💰 Ver tu saldo actual o el de otro usuario')
      .addUserOption(option =>
        option.setName('usuario')
          .setDescription('Usuario para consultar (opcional)')
          .setRequired(false)
      ),
    
    async execute(interaction: ChatInputCommandInteraction, bot: DiscordBot) {
      const targetUser = interaction.options.getUser('usuario') || interaction.user;
      
      let userEcon = await storage.getUserEconomy(targetUser.id, interaction.guildId!);
      if (!userEcon) {
        userEcon = await storage.createUserEconomy({
          userId: targetUser.id,
          guildId: interaction.guildId!,
          balance: "0",
          bank: "0"
        });
      }
      
      const balance = parseFloat(userEcon.balance || "0");
      const bank = parseFloat(userEcon.bank || "0");
      const total = balance + bank;
      
      const embed = new EmbedBuilder()
        .setColor(0xFFD700)
        .setAuthor({ 
          name: targetUser.displayName, 
          iconURL: targetUser.displayAvatarURL() 
        })
        .setTitle('💰 Balance')
        .addFields(
          { name: '💵 En cartera', value: `${balance.toLocaleString()} monedas`, inline: true },
          { name: '🏦 En banco', value: `${bank.toLocaleString()} monedas`, inline: true },
          { name: '💎 Total', value: `${total.toLocaleString()} monedas`, inline: true }
        )
        .setFooter({ 
          text: `Solicitado por ${interaction.user.displayName}`, 
          iconURL: interaction.user.displayAvatarURL() 
        })
        .setTimestamp();
      
      await interaction.reply({ 
        embeds: [embed],
        flags: targetUser.id !== interaction.user.id ? MessageFlags.Ephemeral : undefined
      });
    }
  },

  {
    data: new SlashCommandBuilder()
      .setName('daily')
      .setDescription('🎁 Reclama tu recompensa diaria'),
    
    async execute(interaction: ChatInputCommandInteraction, bot: DiscordBot) {
      // Patrón de concurrencia de ChatGPT - Ack temprano + colas + locks
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      
      await globalQueue.add(() =>
        economyQueueFor(interaction.guildId!).add(async () =>
          lockForUser(interaction.user.id).runExclusive(async () => {
            const userId = interaction.user.id;
            
            // Transacción atómica con advisory lock
            try {
              let userEcon = await storage.getUserEconomy(userId, interaction.guildId!);
              if (!userEcon) {
                userEcon = await storage.createUserEconomy({
                  userId: userId,
                  guildId: interaction.guildId!,
                  balance: "0",
                  bank: "0"
                });
              }
              
              // Verificar cooldown de 24 horas
              const now = new Date();
              const lastDaily = userEcon.lastDaily ? new Date(userEcon.lastDaily) : new Date(0);
              const cooldown = 24 * 60 * 60 * 1000; // 24 horas
              
              if (now.getTime() - lastDaily.getTime() < cooldown) {
                const timeLeft = cooldown - (now.getTime() - lastDaily.getTime());
                const hours = Math.floor(timeLeft / (1000 * 60 * 60));
                const minutes = Math.floor((timeLeft % (1000 * 60 * 60)) / (1000 * 60));
                const seconds = Math.floor((timeLeft % (1000 * 60)) / 1000);
                
                const embed = new EmbedBuilder()
                  .setColor(0xf39c12)
                  .setTitle('⏳ Daily en Cooldown')
                  .setDescription(`¡Ya reclamaste tu daily!\nVuelve en **${hours}h ${minutes}m ${seconds}s**.`);
                
                await interaction.editReply({ embeds: [embed] });
                return;
              }
              
              const dailyAmount = 500;
              const newBalance = parseFloat(userEcon.balance || "0") + dailyAmount;
              const newStreak = (userEcon.dailyStreak || 0) + 1;
              
              // Operación atómica - no puede haber race conditions
              await storage.updateUserEconomy(userId, interaction.guildId!, {
                balance: newBalance.toString(),
                lastDaily: now,
                dailyStreak: newStreak
              });
              
              const embed = new EmbedBuilder()
                .setColor(0x4CAF50)
                .setTitle('🎁 ¡Daily Reclamado!')
                .setDescription(`Has recibido **${dailyAmount.toLocaleString()}** monedas.\nTu nuevo saldo es **${newBalance.toLocaleString()}** monedas.`)
                .addFields(
                  { name: '🔥 Racha diaria', value: `${newStreak} días`, inline: true },
                  { name: '💰 Ganancia', value: `+${dailyAmount.toLocaleString()} monedas`, inline: true }
                )
                .setTimestamp();
              
              await interaction.editReply({ embeds: [embed] });
              
            } catch (error) {
              console.error('Daily command error:', error);
              await interaction.editReply('❌ Error al procesar daily. Intenta de nuevo.');
            }
          })
        )
      );
    }
  },

  {
    data: new SlashCommandBuilder()
      .setName('work')
      .setDescription('💼 Trabaja para ganar dinero')
      .addStringOption(option =>
        option.setName('trabajo')
          .setDescription('Tipo de trabajo que quieres hacer')
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
      const userId = interaction.user.id;
      const jobType = interaction.options.getString('trabajo') || 'random';
      
      let userEcon = await storage.getUserEconomy(userId, interaction.guildId!);
      if (!userEcon) {
        userEcon = await storage.createUserEconomy({
          userId: userId,
          guildId: interaction.guildId!,
          balance: "0",
          bank: "0"
        });
      }
      
      const jobs = {
        constructor: { emoji: '👷', min: 150, max: 300, name: 'Constructor' },
        oficinista: { emoji: '👨‍💼', min: 100, max: 250, name: 'Oficinista' },
        repartidor: { emoji: '🍕', min: 80, max: 200, name: 'Repartidor' },
        programador: { emoji: '🧑‍💻', min: 200, max: 500, name: 'Programador' },
        artista: { emoji: '🎨', min: 50, max: 400, name: 'Artista' }
      };
      
      const selectedJob = jobType === 'random' ? 
        Object.values(jobs)[Math.floor(Math.random() * Object.values(jobs).length)] :
        jobs[jobType as keyof typeof jobs];
      
      const amount = Math.floor(Math.random() * (selectedJob.max - selectedJob.min + 1)) + selectedJob.min;
      const newBalance = parseFloat(userEcon.balance || "0") + amount;
      
      await storage.updateUserEconomy(userId, interaction.guildId!, {
        balance: newBalance.toString()
      });
      
      const embed = new EmbedBuilder()
        .setColor(0x4CAF50)
        .setTitle(`${selectedJob.emoji} Trabajo: ${selectedJob.name}`)
        .setDescription(`Has trabajado como **${selectedJob.name}** y ganaste **${amount.toLocaleString()} monedas**.`)
        .addFields(
          { name: '💰 Nuevo saldo', value: `${newBalance.toLocaleString()} monedas`, inline: true }
        )
        .setTimestamp();
      
      await interaction.reply({ embeds: [embed] });
    }
  },

  {
    data: new SlashCommandBuilder()
      .setName('deposit')
      .setDescription('🏦 Depositar dinero en el banco')
      .addStringOption(option =>
        option.setName('cantidad')
          .setDescription('Cantidad a depositar o "all" para depositar todo')
          .setRequired(true)
      ),
    
    async execute(interaction: ChatInputCommandInteraction, bot: DiscordBot) {
      const userId = interaction.user.id;
      const amountInput = interaction.options.getString('cantidad', true);
      
      let userEcon = await storage.getUserEconomy(userId, interaction.guildId!);
      if (!userEcon) {
        await interaction.reply('❌ No tienes una cuenta económica. Trabaja primero para crear una.');
        return;
      }
      
      const balance = parseFloat(userEcon.balance || "0");
      let amount: number;
      
      if (amountInput.toLowerCase() === 'all') {
        amount = balance;
      } else {
        amount = parseInt(amountInput);
        if (isNaN(amount) || amount <= 0) {
          await interaction.reply('❌ Cantidad inválida. Usa un número positivo o "all".');
          return;
        }
      }
      
      if (balance < amount) {
        await interaction.reply(`❌ No tienes suficiente dinero en tu cartera. Tienes ${balance.toLocaleString()} monedas.`);
        return;
      }
      
      const newBalance = balance - amount;
      const newBank = parseFloat(userEcon.bank || "0") + amount;
      
      await storage.updateUserEconomy(userId, interaction.guildId!, {
        balance: newBalance.toString(),
        bank: newBank.toString()
      });
      
      const embed = new EmbedBuilder()
        .setColor(0x2196F3)
        .setTitle('🏦 Depósito Realizado')
        .setDescription(`Has depositado **${amount.toLocaleString()} monedas** en el banco.`)
        .addFields(
          { name: '💵 En cartera', value: `${newBalance.toLocaleString()} monedas`, inline: true },
          { name: '🏦 En banco', value: `${newBank.toLocaleString()} monedas`, inline: true }
        )
        .setTimestamp();
      
      await interaction.reply({ embeds: [embed] });
    }
  },

  {
    data: new SlashCommandBuilder()
      .setName('withdraw')
      .setDescription('🏦 Retirar dinero del banco')
      .addStringOption(option =>
        option.setName('cantidad')
          .setDescription('Cantidad a retirar o "all" para retirar todo')
          .setRequired(true)
      ),
    
    async execute(interaction: ChatInputCommandInteraction, bot: DiscordBot) {
      const userId = interaction.user.id;
      const amountInput = interaction.options.getString('cantidad', true);
      
      let userEcon = await storage.getUserEconomy(userId, interaction.guildId!);
      if (!userEcon) {
        await interaction.reply('❌ No tienes una cuenta económica.');
        return;
      }
      
      const bank = parseFloat(userEcon.bank || "0");
      let amount: number;
      
      if (amountInput.toLowerCase() === 'all') {
        amount = bank;
      } else {
        amount = parseInt(amountInput);
        if (isNaN(amount) || amount <= 0) {
          await interaction.reply('❌ Cantidad inválida. Usa un número positivo o "all".');
          return;
        }
      }
      
      if (bank < amount) {
        await interaction.reply(`❌ No tienes suficiente dinero en el banco. Tienes ${bank.toLocaleString()} monedas guardadas.`);
        return;
      }
      
      const newBank = bank - amount;
      const newBalance = parseFloat(userEcon.balance || "0") + amount;
      
      await storage.updateUserEconomy(userId, interaction.guildId!, {
        balance: newBalance.toString(),
        bank: newBank.toString()
      });
      
      const embed = new EmbedBuilder()
        .setColor(0x4CAF50)
        .setTitle('🏦 Retiro Realizado')
        .setDescription(`Has retirado **${amount.toLocaleString()} monedas** del banco.`)
        .addFields(
          { name: '💵 En cartera', value: `${newBalance.toLocaleString()} monedas`, inline: true },
          { name: '🏦 En banco', value: `${newBank.toLocaleString()} monedas`, inline: true }
        )
        .setTimestamp();
      
      await interaction.reply({ embeds: [embed] });
    }
  },

  {
    data: new SlashCommandBuilder()
      .setName('crime')
      .setDescription('🔫 Arriesga el 20% de tu saldo cometiendo un crimen'),
    
    async execute(interaction: ChatInputCommandInteraction, bot: DiscordBot) {
      const userId = interaction.user.id;
      const guildId = interaction.guildId!;
      
      let userEcon = await storage.getUserEconomy(userId, guildId);
      if (!userEcon) {
        await interaction.reply('❌ No tienes una cuenta económica. Escribe algo en el chat primero.');
        return;
      }
      
      const balance = parseFloat(userEcon.balance || "0");
      const riskAmount = Math.floor(balance * 0.2);
      
      if (riskAmount <= 0) {
        await interaction.reply({ content: '❌ No tienes saldo suficiente para arriesgar.', flags: MessageFlags.Ephemeral });
        return;
      }
      
      const winChance = Math.random() < 0.5;
      const winMessages = [
        '¡Lograste robar un banco y ganaste **{amount} monedas**!',
        '¡Asaltaste una tienda y obtuviste **{amount} monedas**!',
        '¡Cometiste un crimen perfecto y te llevaste **{amount} monedas**!'
      ];
      
      const loseMessages = [
        '¡Te atrapó la policía y perdiste **{amount} monedas**!',
        '¡El crimen salió mal y te quitaron **{amount} monedas**!',
        '¡Te descubrieron y perdiste **{amount} monedas**!'
      ];
      
      let newBalance: number;
      let resultMsg: string;
      let color: number;
      
      if (winChance) {
        newBalance = balance + riskAmount;
        resultMsg = winMessages[Math.floor(Math.random() * winMessages.length)].replace('{amount}', riskAmount.toString());
        color = 0x4CAF50;
      } else {
        newBalance = balance - riskAmount;
        resultMsg = loseMessages[Math.floor(Math.random() * loseMessages.length)].replace('{amount}', riskAmount.toString());
        color = 0xF44336;
      }
      
      await storage.updateUserEconomy(userId, guildId, {
        balance: newBalance.toString()
      });
      
      const embed = new EmbedBuilder()
        .setColor(color)
        .setTitle('🔫 Crime')
        .setDescription(resultMsg)
        .addFields(
          { name: 'Cantidad arriesgada', value: `${riskAmount} monedas`, inline: true },
          { name: 'Nuevo saldo', value: `${newBalance} monedas`, inline: true }
        )
        .setTimestamp();
      
      await interaction.reply({ embeds: [embed] });
    }
  },

  {
    data: new SlashCommandBuilder()
      .setName('give')
      .setDescription('💸 Envía monedas a otro usuario')
      .addUserOption(option =>
        option.setName('usuario').setDescription('Usuario a quien dar monedas').setRequired(true)
      )
      .addIntegerOption(option =>
        option.setName('cantidad').setDescription('Cantidad de monedas a enviar').setRequired(true)
      ),
    
    async execute(interaction: ChatInputCommandInteraction, bot: DiscordBot) {
      const from = interaction.user;
      const to = interaction.options.getUser('usuario', true);
      const amount = interaction.options.getInteger('cantidad', true);
      const guildId = interaction.guildId!;
      
      if (to.id === from.id) {
        await interaction.reply({ content: '⛔ No puedes enviarte monedas a ti mismo.', flags: MessageFlags.Ephemeral });
        return;
      }
      
      if (amount <= 0) {
        await interaction.reply({ content: 'La cantidad debe ser mayor a 0.', flags: MessageFlags.Ephemeral });
        return;
      }
      
      // Verificar saldo del remitente
      let fromEcon = await storage.getUserEconomy(from.id, guildId);
      if (!fromEcon) {
        await interaction.reply({ content: '❌ No tienes una cuenta económica.', flags: MessageFlags.Ephemeral });
        return;
      }
      
      const fromBalance = parseFloat(fromEcon.balance || "0");
      if (fromBalance < amount) {
        await interaction.reply({ content: '❌ No tienes suficiente saldo.', flags: MessageFlags.Ephemeral });
        return;
      }
      
      // Crear cuenta del receptor si no existe
      let toEcon = await storage.getUserEconomy(to.id, guildId);
      if (!toEcon) {
        toEcon = await storage.createUserEconomy({
          userId: to.id,
          guildId: guildId,
          balance: "0",
          bank: "0"
        });
      }
      
      const toBalance = parseFloat(toEcon.balance || "0");
      
      // Realizar transferencia
      await storage.updateUserEconomy(from.id, guildId, {
        balance: (fromBalance - amount).toString()
      });
      
      await storage.updateUserEconomy(to.id, guildId, {
        balance: (toBalance + amount).toString()
      });
      
      const embed = new EmbedBuilder()
        .setColor(0x00C3FF)
        .setTitle('💸 Transferencia')
        .setDescription(`**${from.username}** ha enviado **${amount.toLocaleString()} monedas** a **${to.username}**`)
        .setTimestamp();
      
      await interaction.reply({ embeds: [embed] });
    }
  },

  {
    data: new SlashCommandBuilder()
      .setName('rob')
      .setDescription('🥷 Intenta robar monedas a otro usuario')
      .addUserOption(option =>
        option.setName('usuario').setDescription('Usuario a robar').setRequired(true)
      ),
    
    async execute(interaction: ChatInputCommandInteraction, bot: DiscordBot) {
      const robber = interaction.user;
      const target = interaction.options.getUser('usuario', true);
      const guildId = interaction.guildId!;
      
      if (target.id === robber.id) {
        await interaction.reply({ content: '⛔ No puedes robarte a ti mismo.', flags: MessageFlags.Ephemeral });
        return;
      }
      
      // Verificar balances
      let robberEcon = await storage.getUserEconomy(robber.id, guildId);
      let targetEcon = await storage.getUserEconomy(target.id, guildId);
      
      if (!robberEcon) {
        await interaction.reply({ content: '❌ No tienes una cuenta económica.', flags: MessageFlags.Ephemeral });
        return;
      }
      
      if (!targetEcon) {
        await interaction.reply({ content: '❌ El usuario objetivo no tiene una cuenta económica.', flags: MessageFlags.Ephemeral });
        return;
      }
      
      const robberBalance = parseFloat(robberEcon.balance || "0");
      const targetBalance = parseFloat(targetEcon.balance || "0");
      
      if (targetBalance < 100) {
        await interaction.reply({ content: '❌ El usuario objetivo no tiene suficiente dinero para ser robado (mínimo 100).', flags: MessageFlags.Ephemeral });
        return;
      }
      
      if (robberBalance < 100) {
        await interaction.reply({ content: '❌ Necesitas al menos 100 monedas para intentar robar.', flags: MessageFlags.Ephemeral });
        return;
      }
      
      // 60% éxito, 40% fallo
      const success = Math.random() < 0.6;
      const maxSteal = Math.min(targetBalance * 0.1, 1000); // Máximo 10% o 1000
      const amount = Math.floor(Math.random() * maxSteal) + 50;
      
      let embed: EmbedBuilder;
      
      if (success) {
        // Robo exitoso
        await storage.updateUserEconomy(robber.id, guildId, {
          balance: (robberBalance + amount).toString()
        });
        
        await storage.updateUserEconomy(target.id, guildId, {
          balance: (targetBalance - amount).toString()
        });
        
        embed = new EmbedBuilder()
          .setColor(0x4CAF50)
          .setTitle('💰 Robo Exitoso')
          .setDescription(`**${robber.username}** logró robar **${amount} monedas** a **${target.username}**`)
          .addFields(
            { name: 'Tu nuevo saldo', value: `${(robberBalance + amount).toLocaleString()} monedas`, inline: true }
          );
      } else {
        // Robo fallido - el ladrón pierde dinero
        const penalty = Math.floor(robberBalance * 0.05); // Pierde 5%
        
        await storage.updateUserEconomy(robber.id, guildId, {
          balance: (robberBalance - penalty).toString()
        });
        
        embed = new EmbedBuilder()
          .setColor(0xF44336)
          .setTitle('🚔 Robo Fallido')
          .setDescription(`**${robber.username}** falló al robar a **${target.username}** y perdió **${penalty} monedas** como multa`)
          .addFields(
            { name: 'Tu nuevo saldo', value: `${(robberBalance - penalty).toLocaleString()} monedas`, inline: true }
          );
      }
      
      await interaction.reply({ embeds: [embed] });
    }
  },

  {
    data: new SlashCommandBuilder()
      .setName('slut')
      .setDescription('💋 Trabajo de alto riesgo con mayor recompensa'),
    
    async execute(interaction: ChatInputCommandInteraction, bot: DiscordBot) {
      const userId = interaction.user.id;
      const guildId = interaction.guildId!;
      
      let userEcon = await storage.getUserEconomy(userId, guildId);
      if (!userEcon) {
        userEcon = await storage.createUserEconomy({
          userId: userId,
          guildId: guildId,
          balance: "0",
          bank: "0"
        });
      }
      
      const balance = parseFloat(userEcon.balance || "0");
      
      // 70% chance de éxito, recompensas más altas que work normal
      const success = Math.random() < 0.7;
      const baseAmount = Math.floor(Math.random() * 800) + 200; // 200-1000
      
      const successMessages = [
        '💋 Tuviste una noche exitosa y ganaste **{amount} monedas**',
        '💄 Cliente generoso te dio **{amount} monedas**',
        '✨ Trabajo bien pagado, obtuviste **{amount} monedas**'
      ];
      
      const failMessages = [
        '🚔 La policía te multó y perdiste **{amount} monedas**',
        '😠 Cliente problemático, perdiste **{amount} monedas**',
        '💸 Noche sin suerte, perdiste **{amount} monedas**'
      ];
      
      let newBalance: number;
      let resultMsg: string;
      let color: number;
      
      if (success) {
        newBalance = balance + baseAmount;
        resultMsg = successMessages[Math.floor(Math.random() * successMessages.length)].replace('{amount}', baseAmount.toString());
        color = 0xFF69B4;
      } else {
        const lossAmount = Math.min(Math.floor(balance * 0.1), 300); // Máximo 10% o 300
        newBalance = balance - lossAmount;
        resultMsg = failMessages[Math.floor(Math.random() * failMessages.length)].replace('{amount}', lossAmount.toString());
        color = 0xF44336;
      }
      
      await storage.updateUserEconomy(userId, guildId, {
        balance: newBalance.toString()
      });
      
      const embed = new EmbedBuilder()
        .setColor(color)
        .setTitle('💋 Trabajo Nocturno')
        .setDescription(resultMsg)
        .addFields(
          { name: 'Nuevo saldo', value: `${newBalance.toLocaleString()} monedas`, inline: true }
        )
        .setTimestamp();
      
      await interaction.reply({ embeds: [embed] });
    }
  },

  {
    data: new SlashCommandBuilder()
      .setName('leaderboard')
      .setDescription('🏆 Ver el ranking económico del servidor')
      .addIntegerOption(option =>
        option.setName('limite')
          .setDescription('Número de usuarios a mostrar (máximo 25)')
          .setMinValue(1)
          .setMaxValue(25)
          .setRequired(false)
      ),
    
    async execute(interaction: ChatInputCommandInteraction, bot: DiscordBot) {
      const limit = interaction.options.getInteger('limite') || 10;
      const guildId = interaction.guildId!;

      const topUsers = await storage.getTopUsersByEconomy(guildId, limit);
      
      if (topUsers.length === 0) {
        await interaction.reply('No hay usuarios con dinero en este servidor aún.');
        return;
      }

      const embed = new EmbedBuilder()
        .setColor(0xFFD700)
        .setTitle(`🏆 Leaderboard Económico`)
        .setDescription('Top usuarios por dinero total (cartera + banco)');

      const leaderboardText = topUsers.map((user: any, index: number) => {
        const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`;
        const total = parseFloat(user.balance || "0") + parseFloat(user.bank || "0");
        return `${medal} <@${user.userId}> - ${total.toLocaleString()} monedas`;
      }).join('\n');

      embed.setDescription(leaderboardText);

      await interaction.reply({ embeds: [embed] });
    }
  },

  // Admin commands for economy management
  {
    data: new SlashCommandBuilder()
      .setName('add-money')
      .setDescription('⚙️ Añade dinero a un usuario (solo admins)')
      .addUserOption(option =>
        option.setName('usuario').setDescription('Usuario a quien añadir dinero').setRequired(true)
      )
      .addIntegerOption(option =>
        option.setName('cantidad').setDescription('Cantidad a añadir').setRequired(true)
      ),
    
    async execute(interaction: ChatInputCommandInteraction, bot: DiscordBot) {
      if (!interaction.memberPermissions?.has('Administrator')) {
        await interaction.reply({ content: '⛔ Solo administradores pueden usar este comando.', flags: MessageFlags.Ephemeral });
        return;
      }
      
      const usuario = interaction.options.getUser('usuario', true);
      const cantidad = interaction.options.getInteger('cantidad', true);
      const guildId = interaction.guildId!;
      
      if (cantidad <= 0) {
        await interaction.reply({ content: 'La cantidad debe ser mayor a 0.', flags: MessageFlags.Ephemeral });
        return;
      }
      
      let userEcon = await storage.getUserEconomy(usuario.id, guildId);
      if (!userEcon) {
        userEcon = await storage.createUserEconomy({
          userId: usuario.id,
          guildId: guildId,
          balance: "0",
          bank: "0"
        });
      }
      
      const newBalance = parseFloat(userEcon.balance || "0") + cantidad;
      await storage.updateUserEconomy(usuario.id, guildId, {
        balance: newBalance.toString()
      });
      
      await interaction.reply({ content: `✅ Añadido ${cantidad.toLocaleString()} monedas a ${usuario.tag}.`, flags: MessageFlags.Ephemeral });
    }
  },

  {
    data: new SlashCommandBuilder()
      .setName('remove-money')
      .setDescription('⚙️ Quita dinero a un usuario (solo admins)')
      .addUserOption(option =>
        option.setName('usuario').setDescription('Usuario a quien quitar dinero').setRequired(true)
      )
      .addStringOption(option =>
        option.setName('cantidad').setDescription('Cantidad a quitar o "all"').setRequired(true)
      ),
    
    async execute(interaction: ChatInputCommandInteraction, bot: DiscordBot) {
      if (!interaction.memberPermissions?.has('Administrator')) {
        await interaction.reply({ content: '⛔ Solo administradores pueden usar este comando.', flags: MessageFlags.Ephemeral });
        return;
      }
      
      const usuario = interaction.options.getUser('usuario', true);
      const cantidadRaw = interaction.options.getString('cantidad', true);
      const guildId = interaction.guildId!;
      
      let userEcon = await storage.getUserEconomy(usuario.id, guildId);
      if (!userEcon) {
        await interaction.reply({ content: `❌ ${usuario.tag} no tiene una cuenta económica.`, flags: MessageFlags.Ephemeral });
        return;
      }
      
      const saldo = parseFloat(userEcon.balance || "0");
      let cantidad: number;
      
      if (cantidadRaw === 'all') {
        cantidad = saldo;
      } else {
        cantidad = parseInt(cantidadRaw, 10);
        if (isNaN(cantidad) || cantidad <= 0) {
          await interaction.reply({ content: 'La cantidad debe ser mayor a 0 o "all".', flags: MessageFlags.Ephemeral });
          return;
        }
      }
      
      const newBalance = Math.max(0, saldo - cantidad);
      await storage.updateUserEconomy(usuario.id, guildId, {
        balance: newBalance.toString()
      });
      
      await interaction.reply({ content: `✅ Quitado ${cantidad.toLocaleString()} monedas a ${usuario.tag}.`, flags: MessageFlags.Ephemeral });
    }
  },

  {
    data: new SlashCommandBuilder()
      .setName('reset-money')
      .setDescription('⚙️ Resetea el balance de un usuario (solo admins)')
      .addUserOption(option =>
        option.setName('usuario').setDescription('Usuario a resetear').setRequired(true)
      ),
    
    async execute(interaction: ChatInputCommandInteraction, bot: DiscordBot) {
      if (!interaction.memberPermissions?.has('Administrator')) {
        await interaction.reply({ content: '⛔ Solo administradores pueden usar este comando.', flags: MessageFlags.Ephemeral });
        return;
      }
      
      const usuario = interaction.options.getUser('usuario', true);
      const guildId = interaction.guildId!;
      
      let userEcon = await storage.getUserEconomy(usuario.id, guildId);
      if (!userEcon) {
        await interaction.reply({ content: `❌ ${usuario.tag} no tiene una cuenta económica.`, flags: MessageFlags.Ephemeral });
        return;
      }
      
      await storage.updateUserEconomy(usuario.id, guildId, {
        balance: "0",
        bank: "0"
      });
      
      await interaction.reply({ content: `✅ Balance de ${usuario.tag} reseteado completamente.`, flags: MessageFlags.Ephemeral });
    }
  },

  {
    data: new SlashCommandBuilder()
      .setName('economy-stats')
      .setDescription('📊 Muestra estadísticas generales de la economía del servidor'),
    
    async execute(interaction: ChatInputCommandInteraction, bot: DiscordBot) {
      const guildId = interaction.guildId!;
      
      try {
        const allUsers = await storage.getAllUserEconomies(guildId);
        
        if (allUsers.length === 0) {
          await interaction.reply('No hay usuarios con cuentas económicas en este servidor.');
          return;
        }
        
        let totalCash = 0;
        let totalBank = 0;
        
        for (const user of allUsers) {
          totalCash += parseFloat(user.balance || "0");
          totalBank += parseFloat(user.bank || "0");
        }
        
        const embed = new EmbedBuilder()
          .setColor(0x2ecc71)
          .setTitle('📊 Estadísticas de la Economía')
          .addFields(
            { name: 'Usuarios con saldo', value: allUsers.length.toString(), inline: true },
            { name: 'Total en efectivo', value: totalCash.toLocaleString(), inline: true },
            { name: 'Total en banco', value: totalBank.toLocaleString(), inline: true },
            { name: 'Total global', value: (totalCash + totalBank).toLocaleString(), inline: true }
          )
          .setTimestamp();
        
        await interaction.reply({ embeds: [embed] });
      } catch (error) {
        console.error('Error getting economy stats:', error);
        await interaction.reply('❌ Error al obtener estadísticas de la economía.');
      }
    }
  },

  {
    data: new SlashCommandBuilder()
      .setName('add-money-role')
      .setDescription('⚙️ Añade dinero a todos los miembros de un rol (solo admins)')
      .addRoleOption(option =>
        option.setName('rol').setDescription('Rol al que añadir dinero').setRequired(true)
      )
      .addIntegerOption(option =>
        option.setName('cantidad').setDescription('Cantidad a añadir').setRequired(true)
      ),
    
    async execute(interaction: ChatInputCommandInteraction, bot: DiscordBot) {
      if (!interaction.memberPermissions?.has('Administrator')) {
        await interaction.reply({ content: '⛔ Solo administradores pueden usar este comando.', flags: MessageFlags.Ephemeral });
        return;
      }
      
      if (!interaction.guild) {
        await interaction.reply({ content: 'Este comando solo funciona en servidores.', flags: MessageFlags.Ephemeral });
        return;
      }
      
      const rol = interaction.options.getRole('rol', true);
      const cantidad = interaction.options.getInteger('cantidad', true);
      const guildId = interaction.guildId!;
      
      if (cantidad <= 0) {
        await interaction.reply({ content: 'La cantidad debe ser mayor a 0.', flags: MessageFlags.Ephemeral });
        return;
      }
      
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      
      const members = await interaction.guild.members.fetch();
      let count = 0;
      
      for (const member of members.values()) {
        if (member.roles.cache.has(rol.id) && !member.user.bot) {
          let userEcon = await storage.getUserEconomy(member.id, guildId);
          if (!userEcon) {
            userEcon = await storage.createUserEconomy({
              userId: member.id,
              guildId: guildId,
              balance: "0",
              bank: "0"
            });
          }
          
          const newBalance = parseFloat(userEcon.balance || "0") + cantidad;
          await storage.updateUserEconomy(member.id, guildId, {
            balance: newBalance.toString()
          });
          count++;
        }
      }
      
      await interaction.editReply({ content: `✅ Añadido ${cantidad.toLocaleString()} monedas a ${count} miembros con el rol ${rol.name}.` });
    }
  }
];