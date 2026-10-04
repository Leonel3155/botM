import { SlashCommandBuilder, ChatInputCommandInteraction, PermissionFlagsBits, EmbedBuilder, MessageFlags } from 'discord.js';
import { DiscordBot } from '../index';

// Solo se registra con NODE_ENV=development (ver commands/index.ts): muestra las URLs internas del servidor
export const data = new SlashCommandBuilder()
  .setName('oauth-test')
  .setDescription('🔐 [Desarrollo] Enlaces para probar el inicio de sesión del panel')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export async function execute(interaction: ChatInputCommandInteraction, bot: DiscordBot) {
  if (process.env.NODE_ENV !== 'development' || !interaction.memberPermissions?.has('Administrator')) {
    await interaction.reply({ content: '⛔ Este diagnóstico solo está disponible para administradores en modo desarrollo.', flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  
  // URLs para probar el OAuth
  const baseUrl = process.env.APP_URL || `http://localhost:${process.env.PORT || '5000'}`;
    
  const frontendUrl = process.env.FRONTEND_URL || baseUrl;
  
  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('🔐 Prueba de inicio de sesión (OAuth)')
    .setDescription('Enlaces para probar el flujo de OAuth con Discord')
    .addFields(
      { 
        name: '🌐 Panel', 
        value: `[Abrir el panel](${frontendUrl})`, 
        inline: false 
      },
      { 
        name: '🔑 Inicio de sesión directo', 
        value: `[Login con Discord](${baseUrl}/api/auth/discord)`, 
        inline: false 
      },
      { 
        name: '📊 Estado de la sesión', 
        value: `[Verificar Estado](${baseUrl}/auth/status)`, 
        inline: false 
      },
      { 
        name: '💚 Estado del servidor', 
        value: `[Health](${baseUrl}/health)`, 
        inline: false 
      }
    )
    .addFields(
      { name: '📋 URL del servidor', value: baseUrl, inline: true },
      { name: '🎨 URL del panel', value: frontendUrl, inline: true }
    )
    .setFooter({ 
      text: 'Para desarrollo: FRONTEND_URL debe ser http://localhost:5173', 
      iconURL: interaction.user.displayAvatarURL() 
    })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

export default { data, execute };