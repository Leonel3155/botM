import { SlashCommandBuilder, ChatInputCommandInteraction, PermissionFlagsBits, EmbedBuilder, MessageFlags } from 'discord.js';
import { DiscordBot } from '../index';

export const data = new SlashCommandBuilder()
  .setName('oauth-test')
  .setDescription('🔐 Test OAuth dashboard login URLs')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export async function execute(interaction: ChatInputCommandInteraction, bot: DiscordBot) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  
  // URLs para testing OAuth
  const baseUrl = process.env.APP_URL || `http://localhost:${process.env.PORT || '5000'}`;
    
  const frontendUrl = process.env.FRONTEND_URL || baseUrl;
  
  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('🔐 OAuth Dashboard Test')
    .setDescription('Enlaces para probar el flujo de OAuth con Discord')
    .addFields(
      { 
        name: '🌐 Dashboard Frontend', 
        value: `[Abrir Dashboard](${frontendUrl})`, 
        inline: false 
      },
      { 
        name: '🔑 Login Direct', 
        value: `[Login con Discord](${baseUrl}/api/auth/discord)`, 
        inline: false 
      },
      { 
        name: '📊 Auth Status', 
        value: `[Verificar Estado](${baseUrl}/auth/status)`, 
        inline: false 
      },
      { 
        name: '💚 Health Check', 
        value: `[Health](${baseUrl}/health)`, 
        inline: false 
      }
    )
    .addFields(
      { name: '📋 Backend URL', value: baseUrl, inline: true },
      { name: '🎨 Frontend URL', value: frontendUrl, inline: true }
    )
    .setFooter({ 
      text: 'Para desarrollo: FRONTEND_URL debe ser http://localhost:5173', 
      iconURL: interaction.user.displayAvatarURL() 
    })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

export default { data, execute };