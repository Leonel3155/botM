import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  ChannelType,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
} from 'discord.js';
import { DiscordBot } from '../index';
import { storage } from '../../storage';
import {
  ensureMemberPermission,
  replyGuildOnly,
  resolveSendableChannel,
  withLineBreaks,
} from '../services/channels';
import {
  WELCOME_PLACEHOLDERS_HELP,
  buildWelcomeEmbed,
  buildWelcomeMessage,
  checkWelcomeRole,
} from '../services/welcome';

const TEXT_CHANNEL_TYPES = [ChannelType.GuildText, ChannelType.GuildAnnouncement] as const;

export const bienvenidaCommands = [
  {
    data: new SlashCommandBuilder()
      .setName('bienvenida')
      .setDescription('👋 Configura los mensajes de bienvenida para nuevos miembros')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .setContexts(InteractionContextType.Guild)
      .addSubcommand(subcommand =>
        subcommand
          .setName('canal')
          .setDescription('Elige el canal donde se da la bienvenida')
          .addChannelOption(option =>
            option.setName('canal')
              .setDescription('Canal de bienvenida')
              .addChannelTypes(...TEXT_CHANNEL_TYPES)
              .setRequired(true)
          )
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('mensaje')
          .setDescription('Cambia el texto de bienvenida (déjalo vacío para usar el predeterminado)')
          .addStringOption(option =>
            option.setName('texto')
              .setDescription('Usa {usuario}, {nombre}, {servidor} y {miembros}. Escribe \\n para un salto de línea')
              .setMaxLength(1500)
              .setRequired(false)
          )
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('rol')
          .setDescription('Rol que se da automáticamente al entrar (déjalo vacío para quitarlo)')
          .addRoleOption(option =>
            option.setName('rol')
              .setDescription('Rol automático para los nuevos miembros')
              .setRequired(false)
          )
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('activar')
          .setDescription('Activa los mensajes de bienvenida')
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('desactivar')
          .setDescription('Desactiva los mensajes de bienvenida')
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('probar')
          .setDescription('Muestra una vista previa con tu usuario y revisa la configuración')
          .addBooleanOption(option =>
            option.setName('publicar')
              .setDescription('Publicar la prueba en el canal de bienvenida (por defecto solo la ves tú)')
              .setRequired(false)
          )
      ),

    async execute(interaction: ChatInputCommandInteraction, bot: DiscordBot) {
      if (!interaction.inCachedGuild()) {
        await replyGuildOnly(interaction);
        return;
      }
      if (!(await ensureMemberPermission(interaction, ['ManageGuild']))) return;

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const guild = interaction.guild;
      const subcommand = interaction.options.getSubcommand();

      try {
        await storage.ensureGuild(guild.id, guild.name, guild.ownerId);
        const settings = await storage.getGuild(guild.id);

        switch (subcommand) {
          case 'canal': {
            const channelId = interaction.options.getChannel('canal', true, [...TEXT_CHANNEL_TYPES]).id;
            await storage.updateEngagementSettings(guild.id, { welcomeChannelId: channelId });

            const check = resolveSendableChannel(guild, channelId);
            const lines = [`✅ Daré la bienvenida en <#${channelId}>.`];
            if (!check.ok) lines.push(`⚠️ ${check.reason}`);
            if (!settings?.welcomeEnabled) lines.push('Cuando quieras encenderla usa `/bienvenida activar`.');
            await interaction.editReply(lines.join('\n'));
            break;
          }

          case 'mensaje': {
            const rawText = interaction.options.getString('texto');
            const template = rawText ? withLineBreaks(rawText).trim() : '';
            await storage.updateEngagementSettings(guild.id, { welcomeMessage: template || null });

            await interaction.editReply({
              content: template
                ? `✅ Mensaje de bienvenida actualizado. Así se verá (puedes usar ${WELCOME_PLACEHOLDERS_HELP}):`
                : '✅ Volví al mensaje de bienvenida predeterminado. Así se verá:',
              embeds: [buildWelcomeEmbed(interaction.member, template || null)],
            });
            break;
          }

          case 'rol': {
            const role = interaction.options.getRole('rol');
            if (!role) {
              await storage.updateEngagementSettings(guild.id, { welcomeRoleId: null });
              await interaction.editReply('✅ Listo, ya no daré un rol automático a los nuevos miembros.');
              break;
            }

            // Quien configura el rol también debe poder darlo a mano (igual que en Discord),
            // para que el bot no reparta roles que esa persona no podría asignar
            const member = interaction.member;
            if (member.id !== guild.ownerId) {
              if (!member.permissions.has(PermissionFlagsBits.ManageRoles)) {
                await interaction.editReply('⛔ Para elegir el rol automático también necesitas el permiso **Gestionar roles**.');
                break;
              }
              if (member.roles.highest.comparePositionTo(role) <= 0) {
                await interaction.editReply(
                  `⛔ Solo puedes elegir un rol que esté **por debajo** de tu rol más alto, y ${role} no lo está.`
                );
                break;
              }
            }

            const check = checkWelcomeRole(guild, role.id);
            if (!check.ok) {
              await interaction.editReply(`❌ No puedo usar ese rol: ${check.reason}`);
              break;
            }

            await storage.updateEngagementSettings(guild.id, { welcomeRoleId: role.id });
            await interaction.editReply(`✅ Los nuevos miembros recibirán el rol ${role} al entrar.`);
            break;
          }

          case 'activar': {
            let channelId = settings?.welcomeChannelId ?? null;
            let usedCurrentChannel = false;
            if (!channelId || !guild.channels.cache.has(channelId)) {
              // Sin canal configurado: usamos el canal donde se escribió el comando
              const current = interaction.channel;
              if (!current || !TEXT_CHANNEL_TYPES.some(type => type === current.type)) {
                await interaction.editReply('❌ Primero elige un canal con `/bienvenida canal`.');
                break;
              }
              channelId = current.id;
              usedCurrentChannel = true;
            }

            const check = resolveSendableChannel(guild, channelId);
            if (!check.ok) {
              await interaction.editReply(`❌ No puedo dar la bienvenida en <#${channelId}>. ${check.reason}`);
              break;
            }

            await storage.updateEngagementSettings(guild.id, { welcomeEnabled: true, welcomeChannelId: channelId });
            await interaction.editReply(
              `✅ ¡Bienvenidas activadas en <#${channelId}>!` +
              (usedCurrentChannel ? ' (usé este canal porque no había uno configurado)' : '') +
              '\nPrueba cómo se ve con `/bienvenida probar`.'
            );
            break;
          }

          case 'desactivar': {
            await storage.updateEngagementSettings(guild.id, { welcomeEnabled: false });
            await interaction.editReply(
              '✅ Bienvenidas desactivadas.' +
              (settings?.welcomeRoleId ? '\nEl rol automático sigue activo; quítalo con `/bienvenida rol` sin elegir rol.' : '')
            );
            break;
          }

          case 'probar': {
            const publish = interaction.options.getBoolean('publicar') ?? false;
            const channelCheck = resolveSendableChannel(guild, settings?.welcomeChannelId);
            const roleCheck = settings?.welcomeRoleId ? checkWelcomeRole(guild, settings.welcomeRoleId) : null;

            const status = [
              `**Estado:** ${settings?.welcomeEnabled ? '🟢 Activada' : '🔴 Desactivada (usa `/bienvenida activar`)'}`,
              `**Canal:** ${settings?.welcomeChannelId ? `<#${settings.welcomeChannelId}>` : 'sin configurar'}` +
                (channelCheck.ok ? ' ✅' : ` ⚠️ ${channelCheck.reason}`),
              `**Rol automático:** ${
                !roleCheck ? 'ninguno' : roleCheck.ok ? `${roleCheck.role} ✅` : `⚠️ ${roleCheck.reason}`
              }`,
              `**Mensaje:** ${settings?.welcomeMessage ? 'personalizado' : 'predeterminado'}`,
            ];

            if (publish) {
              if (!channelCheck.ok) {
                status.push('', `❌ No pude publicar la prueba: ${channelCheck.reason}`);
              } else {
                const sent = await channelCheck.channel.send(buildWelcomeMessage(interaction.member, settings?.welcomeMessage));
                status.push('', `📨 Publiqué la prueba aquí: ${sent.url}`);
              }
            }

            await interaction.editReply({
              content: `👀 **Vista previa de la bienvenida**\n${status.join('\n')}`,
              embeds: [buildWelcomeEmbed(interaction.member, settings?.welcomeMessage)],
            });
            break;
          }
        }
      } catch (error) {
        console.error('[BIENVENIDA] Error en el comando:', error);
        await interaction.editReply({
          content: '❌ Algo salió mal al guardar la configuración. Intenta de nuevo en un momento.',
          embeds: [],
        }).catch(() => {});
      }
    }
  }
];
