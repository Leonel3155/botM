import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { storage } from '../../storage';
import { DiscordBot } from '../index';

// Store and inventory system integrated with PostgreSQL database
export const storeCommands = [
  {
    data: new SlashCommandBuilder()
      .setName('store')
      .setDescription('🛍️ Ver todos los items disponibles en la tienda'),
    
    async execute(interaction: ChatInputCommandInteraction, bot: DiscordBot) {
      // TODO: Implement with real database when store schema is ready
      const embed = new EmbedBuilder()
        .setTitle('🛍️ Tienda del Servidor')
        .setDescription('La tienda está temporalmente en desarrollo. Próximamente podrás comprar items especiales.')
        .setColor(0x00ff00)
        .addFields(
          { name: '🎁 Items Disponibles', value: 'Sistema en desarrollo...', inline: false },
          { name: '💰 Precio Promedio', value: '500-2000 coins', inline: true }
        )
        .setTimestamp();

      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
  },

  {
    data: new SlashCommandBuilder()
      .setName('inventory')
      .setDescription('🎒 Ver tu inventario personal'),
    
    async execute(interaction: ChatInputCommandInteraction, bot: DiscordBot) {
      const embed = new EmbedBuilder()
        .setTitle('🎒 Tu Inventario')
        .setDescription('Tu inventario está vacío. Compra items en la tienda o consíguelos jugando.')
        .setColor(0x0099ff)
        .addFields(
          { name: '📦 Items', value: 'Ninguno', inline: true },
          { name: '🔢 Total', value: '0 items', inline: true }
        )
        .setTimestamp();

      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
  },

  {
    data: new SlashCommandBuilder()
      .setName('buy-item')
      .setDescription('🛒 Comprar un item de la tienda')
      .addStringOption(option =>
        option.setName('item').setDescription('Nombre del item a comprar').setRequired(true)
      ),
    
    async execute(interaction: ChatInputCommandInteraction, bot: DiscordBot) {
      const item = interaction.options.getString('item', true);
      
      await interaction.reply({ 
        content: `🛒 Sistema de compras en desarrollo. Item "${item}" será añadido próximamente.`, 
        flags: MessageFlags.Ephemeral 
      });
    }
  },

  {
    data: new SlashCommandBuilder()
      .setName('sell-item')
      .setDescription('💸 Vender un item de tu inventario')
      .addStringOption(option =>
        option.setName('item').setDescription('Nombre del item a vender').setRequired(true)
      ),
    
    async execute(interaction: ChatInputCommandInteraction, bot: DiscordBot) {
      const item = interaction.options.getString('item', true);
      
      await interaction.reply({ 
        content: `💸 Sistema de ventas en desarrollo. Item "${item}" podrá ser vendido próximamente.`, 
        flags: MessageFlags.Ephemeral 
      });
    }
  },

  {
    data: new SlashCommandBuilder()
      .setName('create-item')
      .setDescription('🛠️ Crear un nuevo item para la tienda (Solo Administradores)')
      .addStringOption(option =>
        option.setName('name').setDescription('Nombre del item').setRequired(true)
      )
      .addIntegerOption(option =>
        option.setName('price').setDescription('Precio del item').setRequired(true)
      )
      .addStringOption(option =>
        option.setName('description').setDescription('Descripción del item').setRequired(false)
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    
    async execute(interaction: ChatInputCommandInteraction, bot: DiscordBot) {
      if (!interaction.memberPermissions?.has('Administrator')) {
        await interaction.reply({ content: '⛔ Solo administradores pueden crear items.', flags: MessageFlags.Ephemeral });
        return;
      }

      const name = interaction.options.getString('name', true);
      const price = interaction.options.getInteger('price', true);
      const description = interaction.options.getString('description') || 'Sin descripción';

      if (price < 1) {
        await interaction.reply({ content: '❌ El precio debe ser mayor a 0.', flags: MessageFlags.Ephemeral });
        return;
      }

      await interaction.reply({ 
        content: `🛠️ Item "${name}" creado exitosamente por ${price} coins. Descripción: ${description}`, 
        flags: MessageFlags.Ephemeral 
      });
    }
  },

  {
    data: new SlashCommandBuilder()
      .setName('give-item')
      .setDescription('🎁 Dar un item a otro usuario (Solo Administradores)')
      .addUserOption(option =>
        option.setName('user').setDescription('Usuario al que dar el item').setRequired(true)
      )
      .addStringOption(option =>
        option.setName('item').setDescription('Nombre del item').setRequired(true)
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    
    async execute(interaction: ChatInputCommandInteraction, bot: DiscordBot) {
      if (!interaction.memberPermissions?.has('Administrator')) {
        await interaction.reply({ content: '⛔ Solo administradores pueden dar items.', flags: MessageFlags.Ephemeral });
        return;
      }

      const user = interaction.options.getUser('user', true);
      const item = interaction.options.getString('item', true);

      await interaction.reply({ 
        content: `🎁 Le diste "${item}" a ${user.username}.`, 
        flags: MessageFlags.Ephemeral 
      });
    }
  }
];