import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder, GuildMember, TextChannel, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { storage } from '../../storage';
import { DiscordBot } from '../index';

// Helper function to check if a member has moderator permissions
function hasModeratorPermissions(member: GuildMember): boolean {
  if (!member) return false;

  // Define the roles that have moderator privileges
  const moderatorRoleNames = ['Moderador', 'Admin', 'Staff'];
  const hasRole = member.roles.cache.some(role => moderatorRoleNames.includes(role.name));

  // Alternatively, you can check for specific permissions if roles are not strictly defined
  const hasPermission = member.permissions.has(PermissionFlagsBits.ManageMessages) ||
                        member.permissions.has(PermissionFlagsBits.KickMembers) ||
                        member.permissions.has(PermissionFlagsBits.BanMembers) ||
                        member.permissions.has(PermissionFlagsBits.ManageRoles) ||
                        member.permissions.has(PermissionFlagsBits.ManageChannels);

  return hasRole || hasPermission;
}

// Complete moderation system with Carl-bot style commands
export const moderationCommands = [
  {
    data: new SlashCommandBuilder()
      .setName('clear')
      .setDescription('🧹 Borra mensajes en el canal actual')
      .addIntegerOption(option =>
        option.setName('cantidad').setDescription('Cantidad de mensajes a borrar (máx 100)').setRequired(true)
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

    async execute(interaction: ChatInputCommandInteraction, bot: DiscordBot) {
      const member = interaction.member as GuildMember;

      // Verificar si tiene rol de moderador
      if (!hasModeratorPermissions(member)) {
        await interaction.reply({
          content: '⛔ **Acceso Denegado**\n' +
                   'Solo usuarios con roles de **Moderador**, **Admin** o **Staff** pueden borrar mensajes.',
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      const cantidad = interaction.options.getInteger('cantidad', true);

      if (cantidad < 1 || cantidad > 100) {
        await interaction.reply({ content: '❌ Solo puedes borrar entre 1 y 100 mensajes.', flags: MessageFlags.Ephemeral });
        return;
      }

      const canal = interaction.channel as TextChannel;
      if (!canal || !canal.bulkDelete) {
        await interaction.reply({ content: '❌ No puedo borrar mensajes en este canal.', flags: MessageFlags.Ephemeral });
        return;
      }

      if (!interaction.guild?.members.me?.permissions.has('ManageMessages')) {
        await interaction.reply({ content: '❌ No tengo permisos para borrar mensajes.', flags: MessageFlags.Ephemeral });
        return;
      }

      const mensajesBorrados = await canal.bulkDelete(cantidad, true).catch(() => null);

      if (!mensajesBorrados) {
        await interaction.reply({ content: '❌ No pude borrar los mensajes. Quizá son demasiado antiguos (más de 14 días).', flags: MessageFlags.Ephemeral });
        return;
      }

      await interaction.reply({ content: `🧹 Listo, borré **${mensajesBorrados.size}** mensajes.`, flags: MessageFlags.Ephemeral });
    }
  },

  {
    data: new SlashCommandBuilder()
      .setName('kick')
      .setDescription('👢 Expulsar a un miembro')
      .addUserOption(option =>
        option.setName('usuario').setDescription('Usuario a expulsar').setRequired(true)
      )
      .addStringOption(option =>
        option.setName('razon').setDescription('Razón de la expulsión').setRequired(false)
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers),

    async execute(interaction: ChatInputCommandInteraction, bot: DiscordBot) {
      if (!interaction.guild) {
        await interaction.reply({ content: 'Comando solo en servidores.', flags: MessageFlags.Ephemeral });
        return;
      }

      const member = interaction.member as GuildMember;
      const usuario = interaction.options.getUser('usuario', true);
      const razon = interaction.options.getString('razon') || 'No especificada';

      // Verificar si tiene rol de moderador
      if (!hasModeratorPermissions(member)) {
        await interaction.reply({
          content: '⛔ **Acceso Denegado**\n' +
                   'Solo usuarios con roles de **Moderador**, **Admin** o **Staff** pueden expulsar miembros.',
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      if (usuario.id === interaction.user.id || usuario.id === interaction.client.user?.id || usuario.id === interaction.guild.ownerId) {
        await interaction.reply({ content: '⛔ No puedes expulsarte a ti mismo, al bot ni al dueño del servidor.', flags: MessageFlags.Ephemeral });
        return;
      }

      if (!interaction.guild.members.me?.permissions.has('KickMembers')) {
        await interaction.reply({ content: '❌ No tengo permisos para expulsar miembros.', flags: MessageFlags.Ephemeral });
        return;
      }

      const targetMember = await interaction.guild.members.fetch(usuario.id).catch(() => null);
      if (!targetMember) {
        await interaction.reply({ content: 'No se encontró el usuario.', flags: MessageFlags.Ephemeral });
        return;
      }

      if (!targetMember.kickable) {
        await interaction.reply({ content: 'No puedo expulsar a ese usuario.', flags: MessageFlags.Ephemeral });
        return;
      }

      await targetMember.kick(razon);
      await interaction.reply({ content: `✅ **${usuario.tag}** fue expulsado. Razón: ${razon}`, flags: MessageFlags.Ephemeral });
    }
  },

  {
    data: new SlashCommandBuilder()
      .setName('ban')
      .setDescription('🔨 Banear a un miembro')
      .addUserOption(option =>
        option.setName('usuario').setDescription('Usuario a banear').setRequired(true)
      )
      .addStringOption(option =>
        option.setName('razon').setDescription('Razón del baneo').setRequired(false)
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),

    async execute(interaction: ChatInputCommandInteraction, bot: DiscordBot) {
      if (!interaction.guild) {
        await interaction.reply({ content: 'Comando solo en servidores.', flags: MessageFlags.Ephemeral });
        return;
      }

      const member = interaction.member as GuildMember;
      const usuario = interaction.options.getUser('usuario', true);
      const razon = interaction.options.getString('razon') || 'No especificada';

      // Verificar si tiene rol de moderador
      if (!hasModeratorPermissions(member)) {
        await interaction.reply({
          content: '⛔ **Acceso Denegado**\n' +
                   'Solo usuarios con roles de **Moderador**, **Admin** o **Staff** pueden banear miembros.',
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      if (usuario.id === interaction.user.id || usuario.id === interaction.client.user?.id || usuario.id === interaction.guild.ownerId) {
        await interaction.reply({ content: '⛔ No puedes banearte a ti mismo, al bot ni al dueño del servidor.', flags: MessageFlags.Ephemeral });
        return;
      }

      if (!interaction.guild.members.me?.permissions.has('BanMembers')) {
        await interaction.reply({ content: '❌ No tengo permisos para banear miembros.', flags: MessageFlags.Ephemeral });
        return;
      }

      const targetMember = await interaction.guild.members.fetch(usuario.id).catch(() => null);
      if (!targetMember) {
        await interaction.reply({ content: 'No se encontró el usuario.', flags: MessageFlags.Ephemeral });
        return;
      }

      if (!targetMember.bannable) {
        await interaction.reply({ content: 'No puedo banear a ese usuario.', flags: MessageFlags.Ephemeral });
        return;
      }

      await targetMember.ban({ reason: razon });
      await interaction.reply({ content: `✅ **${usuario.tag}** fue baneado. Razón: ${razon}`, flags: MessageFlags.Ephemeral });
    }
  },

  {
    data: new SlashCommandBuilder()
      .setName('mute')
      .setDescription('🔇 Silenciar temporalmente a un miembro')
      .addUserOption(option =>
        option.setName('usuario').setDescription('Usuario a silenciar').setRequired(true)
      )
      .addIntegerOption(option =>
        option.setName('minutos').setDescription('Minutos a silenciar').setRequired(true)
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

    async execute(interaction: ChatInputCommandInteraction, bot: DiscordBot) {
      if (!interaction.guild) {
        await interaction.reply({ content: 'Comando solo en servidores.', flags: MessageFlags.Ephemeral });
        return;
      }

      const member = interaction.member as GuildMember;
      const usuario = interaction.options.getUser('usuario', true);
      const minutos = interaction.options.getInteger('minutos', true);

      // Verificar si tiene rol de moderador
      if (!hasModeratorPermissions(member)) {
        await interaction.reply({
          content: '⛔ **Acceso Denegado**\n' +
                   'Solo usuarios con roles de **Moderador**, **Admin** o **Staff** pueden silenciar miembros.',
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      if (usuario.id === interaction.user.id || usuario.id === interaction.client.user?.id || usuario.id === interaction.guild.ownerId) {
        await interaction.reply({ content: '⛔ No puedes mutearte a ti mismo, al bot ni al dueño del servidor.', flags: MessageFlags.Ephemeral });
        return;
      }

      if (!interaction.guild.members.me?.permissions.has('ManageRoles')) {
        await interaction.reply({ content: '❌ No tengo permisos para gestionar roles.', flags: MessageFlags.Ephemeral });
        return;
      }

      const targetMember = await interaction.guild.members.fetch(usuario.id).catch(() => null);
      if (!targetMember) {
        await interaction.reply({ content: 'No se encontró el usuario.', flags: MessageFlags.Ephemeral });
        return;
      }

      // Busca o crea el rol "Muteado"
      let muteRole = interaction.guild.roles.cache.find(r => r.name === 'Muteado');
      if (!muteRole) {
        muteRole = await interaction.guild.roles.create({
          name: 'Muteado',
          color: 0x808080,
          reason: 'Rol autogenerado para silenciar usuarios',
        });

        // Configurar permisos en canales (los hilos no tienen overwrites propios:
        // heredan los permisos de su canal padre, así que se omiten)
        for (const channel of Array.from(interaction.guild.channels.cache.values())) {
          if (channel.isThread()) continue;
          if (channel.isTextBased() || channel.isVoiceBased()) {
            await channel.permissionOverwrites.edit(muteRole, {
              SendMessages: false,
              AddReactions: false,
              Speak: false,
              Connect: false,
            }).catch(() => {});
          }
        }
      }

      await targetMember.roles.add(muteRole);
      await interaction.reply({ content: `🔇 **${usuario.tag}** fue silenciado por ${minutos} minuto(s).`, flags: MessageFlags.Ephemeral });

      // Auto-unmute después del tiempo especificado
      setTimeout(async () => {
        try {
          await targetMember.roles.remove(muteRole!);
        } catch (e) {
          console.error('Error al quitar el mute:', e);
        }
      }, minutos * 60 * 1000);
    }
  },

  {
    data: new SlashCommandBuilder()
      .setName('unmute')
      .setDescription('🔊 Quita el mute a un miembro')
      .addUserOption(option =>
        option.setName('usuario').setDescription('Usuario al que quitar el mute').setRequired(true)
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

    async execute(interaction: ChatInputCommandInteraction, bot: DiscordBot) {
      if (!interaction.guild) {
        await interaction.reply({ content: 'Comando solo en servidores.', flags: MessageFlags.Ephemeral });
        return;
      }

      const member = interaction.member as GuildMember;
      const usuario = interaction.options.getUser('usuario', true);

      // Verificar si tiene rol de moderador
      if (!hasModeratorPermissions(member)) {
        await interaction.reply({
          content: '⛔ **Acceso Denegado**\n' +
                   'Solo usuarios con roles de **Moderador**, **Admin** o **Staff** pueden quitar mutes.',
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      if (!interaction.guild.members.me?.permissions.has('ManageRoles')) {
        await interaction.reply({ content: '❌ No tengo permisos para gestionar roles.', flags: MessageFlags.Ephemeral });
        return;
      }

      const targetMember = await interaction.guild.members.fetch(usuario.id).catch(() => null);
      if (!targetMember) {
        await interaction.reply({ content: 'No se encontró el usuario.', flags: MessageFlags.Ephemeral });
        return;
      }

      const muteRole = interaction.guild.roles.cache.find(r => r.name === 'Muteado');
      if (!muteRole) {
        await interaction.reply({ content: '❌ El rol "Muteado" no existe en este servidor.', flags: MessageFlags.Ephemeral });
        return;
      }

      if (!targetMember.roles.cache.has(muteRole.id)) {
        await interaction.reply({ content: '❌ Ese usuario no está muteado.', flags: MessageFlags.Ephemeral });
        return;
      }

      await targetMember.roles.remove(muteRole);
      await interaction.reply({ content: `🔊 Se quitó el mute a **${usuario.tag}**.`, flags: MessageFlags.Ephemeral });
    }
  },

  {
    data: new SlashCommandBuilder()
      .setName('lockdown')
      .setDescription('🔒 Bloquea el canal actual para que solo staff pueda escribir')
      .addStringOption(option =>
        option.setName('accion')
          .setDescription('Activar o desactivar lockdown')
          .setRequired(true)
          .addChoices(
            { name: 'Activar', value: 'lock' },
            { name: 'Desactivar', value: 'unlock' }
          )
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

    async execute(interaction: ChatInputCommandInteraction, bot: DiscordBot) {
      if (!interaction.guild) {
        await interaction.reply({ content: 'Comando solo en servidores.', flags: MessageFlags.Ephemeral });
        return;
      }

      const member = interaction.member as GuildMember;
      const accion = interaction.options.getString('accion', true);
      const canal = interaction.channel;

      // Verificar si tiene rol de moderador
      if (!hasModeratorPermissions(member)) {
        await interaction.reply({
          content: '⛔ **Acceso Denegado**\n' +
                   'Solo usuarios con roles de **Moderador**, **Admin** o **Staff** pueden bloquear canales.',
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      if (!canal || canal.isDMBased()) {
        await interaction.reply({ content: '❌ No puedo modificar permisos en este canal.', flags: MessageFlags.Ephemeral });
        return;
      }

      // Los hilos no tienen overwrites propios (heredan del canal padre)
      if (canal.isThread()) {
        await interaction.reply({
          content: '❌ Este comando no funciona dentro de hilos. Úsalo en el canal principal o bloquea el hilo desde sus opciones.',
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      if (!interaction.guild.members.me?.permissions.has('ManageChannels')) {
        await interaction.reply({ content: '❌ No tengo permisos para gestionar canales.', flags: MessageFlags.Ephemeral });
        return;
      }

      const everyoneRole = interaction.guild.roles.everyone;

      if (accion === 'lock') {
        await canal.permissionOverwrites.edit(everyoneRole, {
          SendMessages: false,
          AddReactions: false
        });
        await interaction.reply({ content: `🔒 Canal bloqueado. Solo el staff puede escribir.`, flags: MessageFlags.Ephemeral });
      } else {
        await canal.permissionOverwrites.edit(everyoneRole, {
          SendMessages: null,
          AddReactions: null
        });
        await interaction.reply({ content: `🔓 Canal desbloqueado. Todos pueden escribir de nuevo.`, flags: MessageFlags.Ephemeral });
      }
    }
  },

  {
    data: new SlashCommandBuilder()
      .setName('warn')
      .setDescription('⚠️ Advertir a un miembro')
      .addUserOption(option =>
        option.setName('usuario').setDescription('Usuario a advertir').setRequired(true)
      )
      .addStringOption(option =>
        option.setName('razon').setDescription('Razón de la advertencia').setRequired(false)
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

    async execute(interaction: ChatInputCommandInteraction, bot: DiscordBot) {
      if (!interaction.guild) {
        await interaction.reply({ content: 'Comando solo en servidores.', flags: MessageFlags.Ephemeral });
        return;
      }

      const member = interaction.member as GuildMember;
      const usuario = interaction.options.getUser('usuario', true);
      const razon = interaction.options.getString('razon') || 'No especificada';

      // Verificar si tiene rol de moderador
      if (!hasModeratorPermissions(member)) {
        await interaction.reply({
          content: '⛔ **Acceso Denegado**\n' +
                   'Solo usuarios con roles de **Moderador**, **Admin** o **Staff** pueden advertir miembros.',
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      if (usuario.id === interaction.user.id || usuario.id === interaction.client.user?.id || usuario.id === interaction.guild.ownerId) {
        await interaction.reply({ content: '⛔ No puedes advertirte a ti mismo, al bot ni al dueño del servidor.', flags: MessageFlags.Ephemeral });
        return;
      }

      // TODO: Save to database when moderation schema is ready
      await interaction.reply({ content: `⚠️ **${usuario.tag}** fue advertido. Razón: ${razon}`, flags: MessageFlags.Ephemeral });
    }
  },

  {
    data: new SlashCommandBuilder()
      .setName('warnings')
      .setDescription('📋 Ver historial de advertencias de un miembro')
      .addUserOption(option =>
        option.setName('usuario').setDescription('Usuario a consultar').setRequired(true)
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

    async execute(interaction: ChatInputCommandInteraction, bot: DiscordBot) {
      if (!interaction.guild) {
        await interaction.reply({ content: 'Comando solo en servidores.', flags: MessageFlags.Ephemeral });
        return;
      }

      const member = interaction.member as GuildMember;
      const usuario = interaction.options.getUser('usuario', true);

      // Verificar si tiene rol de moderador
      if (!hasModeratorPermissions(member)) {
        await interaction.reply({
          content: '⛔ **Acceso Denegado**\n' +
                   'Solo usuarios con roles de **Moderador**, **Admin** o **Staff** pueden ver advertencias.',
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      // TODO: Load from database when moderation schema is ready
      const embed = new EmbedBuilder()
        .setTitle(`📋 Advertencias de ${usuario.tag}`)
        .setDescription('✅ Este usuario no tiene advertencias registradas.')
        .setColor(0x00ff00)
        .setTimestamp();

      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
  }
];