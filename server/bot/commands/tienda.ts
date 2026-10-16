import {
  EmbedBuilder,
  SlashCommandBuilder,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { SHOP_LIMITS } from '@shared/api';
import type { DiscordBot } from '../index';
import { formatCoins } from '../services/economy';
import { buyShopItem, getInventory, itemLabel, listShopItems } from '../services/shop';
import { truncate } from '../services/channels';
import { resolveGuild, respond } from '../utils/interactions';

const SHOP_COLOR = 0xFFD700;
const EMBED_BUDGET = 6000 - 100; // máximo de Discord por embed, menos lo que ocupa el pie

function stockText(stock: number | null): string | null {
  if (stock === null) return null;
  return stock === 0 ? 'Agotado' : `Quedan ${stock.toLocaleString('es-MX')}`;
}

export const tiendaCommands = [
  {
    data: new SlashCommandBuilder()
      .setName('tienda')
      .setDescription('🛒 Mira lo que puedes comprar con tus monedas'),

    async execute(interaction: ChatInputCommandInteraction, _bot: DiscordBot) {
      await interaction.deferReply();
      const items = await listShopItems(interaction.guildId!, { enabledOnly: true });

      const embed = new EmbedBuilder()
        .setColor(SHOP_COLOR)
        .setTitle('🛒 Tienda')
        .setTimestamp();

      if (items.length === 0) {
        embed.setDescription('La tienda está vacía por ahora. Un admin puede agregar artículos desde el panel.');
        await respond(interaction, { embeds: [embed] });
        return;
      }

      embed.setDescription('Compra con `/comprar` y revisa lo tuyo con `/inventario`. Se paga con lo que traes en la cartera.');
      let shown = 0;
      for (const item of items.slice(0, 25)) {
        const lines = [`**${formatCoins(item.price)}**`];
        if (item.description) lines.push(item.description);
        if (item.roleId) lines.push(`Te da el rol <@&${item.roleId}>`);
        const stock = stockText(item.stock);
        if (stock) lines.push(`_${stock}_`);
        const name = truncate(itemLabel(item), 256);
        const value = truncate(lines.join('\n'), 1024);
        // Discord rechaza embeds de más de 6000 caracteres en total; se deja espacio para el pie
        if (embed.length + name.length + value.length > EMBED_BUDGET) break;
        embed.addFields({ name, value });
        shown++;
      }
      const hidden = items.length - shown;
      if (hidden > 0) embed.setFooter({ text: `Y ${hidden} artículo(s) más: búscalos al escribir /comprar.` });

      await respond(interaction, { embeds: [embed] });
    },
  },

  {
    data: new SlashCommandBuilder()
      .setName('comprar')
      .setDescription('🛍️ Compra un artículo de la tienda')
      .addStringOption(option =>
        option.setName('articulo').setDescription('Qué quieres comprar').setRequired(true).setAutocomplete(true)
      )
      .addIntegerOption(option =>
        option.setName('cantidad').setDescription('Cuántos (1 si no dices nada)').setMinValue(1).setMaxValue(SHOP_LIMITS.maxPerPurchase)
      ),

    async autocomplete(interaction: AutocompleteInteraction) {
      const typed = interaction.options.getFocused().trim().toLowerCase();
      const items = await listShopItems(interaction.guildId!, { enabledOnly: true });
      const choices = items
        .filter(item => !typed || item.name.toLowerCase().includes(typed))
        .slice(0, 25)
        .map(item => ({
          name: truncate(`${item.name} · ${formatCoins(item.price)}${item.stock === 0 ? ' · agotado' : ''}`, 100),
          value: item.id,
        }));
      await interaction.respond(choices);
    },

    async execute(interaction: ChatInputCommandInteraction, _bot: DiscordBot) {
      const typed = interaction.options.getString('articulo', true).trim();
      const requested = interaction.options.getInteger('cantidad') ?? 1;

      await interaction.deferReply();
      const guild = await resolveGuild(interaction);

      // Normalmente llega el id (de las sugerencias); si alguien escribió el nombre, se busca por nombre
      const items = await listShopItems(guild.id, { enabledOnly: true });
      const item = items.find(candidate => candidate.id === typed)
        ?? items.find(candidate => candidate.name.toLowerCase() === typed.toLowerCase());
      if (!item) {
        await respond(interaction, '❌ No encontré ese artículo. Elige uno de la lista al escribir, o revisa `/tienda`.', { ephemeral: true });
        return;
      }

      const member = await guild.members.fetch(interaction.user.id);
      const result = await buyShopItem(member, item.id, requested);
      if (!result.ok) {
        let message: string;
        switch (result.reason) {
          case 'insufficient':
            message = `💸 No te alcanza: cuesta **${formatCoins(item.price * result.quantity)}** y traes **${formatCoins(result.available)}** en la cartera. Si tienes en el banco, sácalo con \`/withdraw\`.`;
            break;
          case 'has_role':
            message = `Ya tienes el rol de **${item.name}**, no hace falta comprarlo otra vez. 😉`;
            break;
          case 'unavailable':
            message = '❌ Ese artículo ya no está a la venta. Revisa `/tienda`.';
            break;
          case 'too_expensive':
            message = '❌ Esa compra pasa el máximo de monedas permitido. Prueba con menos unidades.';
            break;
          case 'role_problem':
            message = `❌ No puedo vender ese artículo ahora: ${result.message} Avísale a un admin.`;
            break;
          case 'rejected':
            message = `❌ ${result.message}`;
            break;
        }
        await respond(interaction, message, { ephemeral: true });
        return;
      }

      const bought = result.info;
      const quantityText = result.quantity > 1 ? `${result.quantity} × ` : '';
      const embed = new EmbedBuilder()
        .setColor(0x57F287)
        .setTitle('🛍️ Compra hecha')
        .setDescription(
          bought.roleId
            ? `**${interaction.user.displayName}** compró **${itemLabel(bought)}** y ya tiene el rol <@&${bought.roleId}>.`
            : `**${interaction.user.displayName}** compró **${quantityText}${itemLabel(bought)}**. Lo tienes en \`/inventario\`.`
        )
        .addFields(
          { name: 'Pagaste', value: formatCoins(bought.price * result.quantity), inline: true },
          { name: 'Tu cartera', value: formatCoins(result.balance), inline: true },
        )
        .setTimestamp();
      const stock = stockText(bought.stock);
      if (stock) embed.setFooter({ text: stock });
      await respond(interaction, { embeds: [embed] });
    },
  },

  {
    data: new SlashCommandBuilder()
      .setName('inventario')
      .setDescription('🎒 Lo que has comprado en la tienda')
      .addUserOption(option =>
        option.setName('usuario').setDescription('Ver el inventario de otra persona')
      ),

    async execute(interaction: ChatInputCommandInteraction, _bot: DiscordBot) {
      const target = interaction.options.getUser('usuario') ?? interaction.user;
      await interaction.deferReply();
      const entries = await getInventory(interaction.guildId!, target.id);

      const embed = new EmbedBuilder()
        .setColor(SHOP_COLOR)
        .setAuthor({ name: target.displayName, iconURL: target.displayAvatarURL() })
        .setTitle('🎒 Inventario')
        .setTimestamp();

      if (entries.length === 0) {
        embed.setDescription(
          target.id === interaction.user.id
            ? 'Todavía no tienes nada. Mira qué hay en `/tienda`.'
            : 'Todavía no tiene nada de la tienda.'
        );
      } else {
        const lines = entries.map(({ item, quantity }) => `${itemLabel(item)} × **${quantity.toLocaleString('es-MX')}**`);
        embed.setDescription(truncate(lines.join('\n'), 4096));
      }
      await respond(interaction, { embeds: [embed] });
    },
  },
];
