import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder, GuildMember, TextChannel, PermissionFlagsBits, MessageFlags, PermissionsString, PermissionOverwriteOptions } from 'discord.js';
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

// Tope del /mute: el auto-unmute usa setTimeout, que no admite más de ~24.8 días
// (con un valor mayor Node lo dispara de inmediato).
const MAX_MUTE_MINUTOS = 10080; // 1 semana

// Permisos que se niegan al rol "Muteado". SendMessages no cubre los hilos:
// escribir en hilos se controla con SendMessagesInThreads.
const MUTE_DENY: PermissionsString[] = [
  'SendMessages',
  'SendMessagesInThreads',
  'CreatePublicThreads',
  'CreatePrivateThreads',
  'AddReactions',
  'Speak',
  'Connect',
];

// Permisos que /lockdown quita a @everyone (incluye hilos del canal)
const LOCKDOWN_PERMS: PermissionsString[] = [
  'SendMessages',
  'SendMessagesInThreads',
  'CreatePublicThreads',
  'CreatePrivateThreads',
  'AddReactions',
];

function overwriteOptions(perms: PermissionsString[], value: boolean | null): PermissionOverwriteOptions {
  const options: PermissionOverwriteOptions = {};
  for (const perm of perms) options[perm] = value;
  return options;
}

// Guarda la acción en el historial de moderación (si la BD falla, el comando sigue funcionando).
// `deactivate` marca antes como inactivas las acciones vigentes de ese tipo (p. ej. el mute al quitarlo).
async function registrarAccion(
  interaction: ChatInputCommandInteraction,
  type: string,
  target: { id: string; username: string; avatar: string | null },
  extra: { reason?: string; duration?: number; active?: boolean; deactivate?: string } = {}
) {
  if (!interaction.guild) return;
  const { deactivate, ...details } = extra;
  try {
    if (deactivate) await storage.deactivateModerationActions(interaction.guild.id, target.id, deactivate);
    await storage.logModerationAction({
      guild: { id: interaction.guild.id, name: interaction.guild.name, ownerId: interaction.guild.ownerId },
      moderator: interaction.user,
      target,
      type,
      ...details,
    });
  } catch (error) {
    console.error(`No se pudo registrar la acción de moderación (${type}):`, error);
  }
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
      // Acción sobre un canal: se registra con el propio moderador como "objetivo"
      await registrarAccion(interaction, 'clear', interaction.user, { reason: `Borró ${mensajesBorrados.size} mensajes en #${canal.name}`, active: false });
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
      await registrarAccion(interaction, 'kick', usuario, { reason: razon, active: false });
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
      await registrarAccion(interaction, 'ban', usuario, { reason: razon });
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
        option.setName('minutos').setDescription('Minutos a silenciar (máx. 1 semana)').setRequired(true)
          .setMinValue(1).setMaxValue(MAX_MUTE_MINUTOS)
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

      if (minutos < 1 || minutos > MAX_MUTE_MINUTOS) {
        await interaction.reply({ content: `❌ Puedes silenciar entre 1 y ${MAX_MUTE_MINUTOS} minutos (1 semana).`, flags: MessageFlags.Ephemeral });
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

      // Configurar el rol y los canales puede tardar más de los 3 s que da Discord
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      // Busca o crea el rol "Muteado"
      let muteRole = interaction.guild.roles.cache.find(r => r.name === 'Muteado');
      if (!muteRole) {
        muteRole = await interaction.guild.roles.create({
          name: 'Muteado',
          color: 0x808080,
          reason: 'Rol autogenerado para silenciar usuarios',
        });
      }
      const rolMute = muteRole;

      // Niega los permisos del mute en cada canal (también categorías y foros) donde
      // aún no estén puestos; así se cubren canales nuevos y roles creados antes.
      // Los hilos no tienen overwrites propios: heredan los del canal padre.
      // Solo se tocan permisos sin valor: si un admin permitió algo a propósito, se respeta.
      const ediciones: Promise<unknown>[] = [];
      for (const channel of Array.from(interaction.guild.channels.cache.values())) {
        if (channel.isThread()) continue;
        const actual = channel.permissionOverwrites.cache.get(rolMute.id);
        const faltantes = MUTE_DENY.filter(p => !actual?.deny.has(p) && !actual?.allow.has(p));
        if (faltantes.length === 0) continue;
        ediciones.push(channel.permissionOverwrites.edit(rolMute, overwriteOptions(faltantes, false)));
      }
      const fallidas = (await Promise.allSettled(ediciones)).filter(r => r.status === 'rejected').length;

      await targetMember.roles.add(rolMute);

      // Auto-unmute después del tiempo especificado (se programa antes de responder
      // para que un fallo al contestar no deje al usuario muteado para siempre)
      setTimeout(async () => {
        try {
          await targetMember.roles.remove(rolMute);
          await storage.deactivateModerationActions(targetMember.guild.id, usuario.id, 'mute');
        } catch (e) {
          console.error('Error al quitar el mute:', e);
        }
      }, minutos * 60 * 1000);

      const aviso = fallidas > 0
        ? `\n⚠️ No pude aplicar el mute en ${fallidas} canal(es); revisa mis permisos ahí.`
        : '';
      await interaction.editReply({ content: `🔇 **${usuario.tag}** fue silenciado por ${minutos} minuto(s).${aviso}` });
      await registrarAccion(interaction, 'mute', usuario, { reason: `Silenciado por ${minutos} minuto(s)`, duration: minutos, deactivate: 'mute' });
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
      await registrarAccion(interaction, 'unmute', usuario, { active: false, deactivate: 'mute' });
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

      // Los hilos no tienen overwrites propios: heredan los del canal padre, y el
      // lockdown del padre también niega SendMessagesInThreads
      if (canal.isThread()) {
        await interaction.reply({
          content: '❌ Este comando no funciona dentro de hilos. Úsalo en el canal principal: al bloquearlo también se bloquean sus hilos.',
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      if (!interaction.guild.members.me?.permissions.has('ManageChannels')) {
        await interaction.reply({ content: '❌ No tengo permisos para gestionar canales.', flags: MessageFlags.Ephemeral });
        return;
      }

      const everyoneRole = interaction.guild.roles.everyone;

      const bloquear = accion === 'lock';
      try {
        await canal.permissionOverwrites.edit(everyoneRole, overwriteOptions(LOCKDOWN_PERMS, bloquear ? false : null));
      } catch (e) {
        console.error('Error en lockdown:', e);
        await interaction.reply({ content: '❌ No pude cambiar los permisos de este canal. Revisa que tenga **Gestionar roles** y los permisos de hilos aquí.', flags: MessageFlags.Ephemeral });
        return;
      }

      if (bloquear) {
        await interaction.reply({ content: `🔒 Canal y sus hilos bloqueados. Solo el staff puede escribir.`, flags: MessageFlags.Ephemeral });
      } else {
        await interaction.reply({ content: `🔓 Canal desbloqueado. Todos pueden escribir de nuevo.`, flags: MessageFlags.Ephemeral });
      }
      // Acción sobre un canal: se registra con el propio moderador como "objetivo"
      await registrarAccion(interaction, accion === 'lock' ? 'lockdown' : 'unlock', interaction.user, {
        reason: `${accion === 'lock' ? 'Bloqueó' : 'Desbloqueó'} el canal #${canal.name}`,
        active: false,
      });
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

      await interaction.reply({ content: `⚠️ **${usuario.tag}** fue advertido. Razón: ${razon}`, flags: MessageFlags.Ephemeral });
      await registrarAccion(interaction, 'warn', usuario, { reason: razon });
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

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const historial = await storage.getUserModerationActions(interaction.guild.id, usuario.id, undefined, 500);
      const advertencias = historial.filter(accion => accion.type === 'warn');
      const contar = (tipo: string) => historial.filter(accion => accion.type === tipo).length;

      const embed = new EmbedBuilder()
        .setTitle(`📋 Advertencias de ${usuario.tag}`)
        .setThumbnail(usuario.displayAvatarURL())
        .setTimestamp();

      if (advertencias.length === 0) {
        embed
          .setDescription('✅ Este usuario no tiene advertencias registradas.')
          .setColor(0x00ff00);
      } else {
        embed
          .setDescription(`Tiene **${advertencias.length}** advertencia(s) registrada(s).`)
          .setColor(advertencias.length >= 3 ? 0xED4245 : 0xFEE75C)
          .addFields(advertencias.slice(0, 10).map((warn, i) => ({
            name: `⚠️ Advertencia #${advertencias.length - i}`,
            value: `${(warn.reason || 'Sin razón').slice(0, 400)}\nPor <@${warn.moderatorId}>` +
              (warn.createdAt ? ` • <t:${Math.floor(warn.createdAt.getTime() / 1000)}:R>` : ''),
          })));

        if (advertencias.length > 10) {
          embed.setFooter({ text: `Mostrando las 10 más recientes de ${advertencias.length}` });
        }
      }

      embed.addFields({
        name: '📁 Otros registros',
        value: `🔇 Mutes: ${contar('mute')} • 👢 Expulsiones: ${contar('kick')} • 🔨 Baneos: ${contar('ban')}`,
      });

      await interaction.editReply({ embeds: [embed] });
    }
  }
];