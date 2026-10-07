import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  GuildMember,
  TextChannel,
  PermissionFlagsBits,
  PermissionsBitField,
  MessageFlags,
  PermissionsString,
  PermissionOverwriteOptions,
  DiscordAPIError,
  RESTJSONErrorCodes,
  type Client,
} from 'discord.js';
import { storage, type ChannelLockdownSnapshot } from '../../storage';
import { DiscordBot } from '../index';

// Cada comando exige en el código el mismo permiso que pide en Discord (setDefaultMemberPermissions):
// así, aunque un admin abra el comando a otro rol en Ajustes → Integraciones, solo lo usa quien
// tiene ese permiso. memberPermissions ya tiene en cuenta los permisos del canal donde se usa.
async function requirePermission(
  interaction: ChatInputCommandInteraction,
  permission: bigint,
  label: string,
  action: string
): Promise<boolean> {
  if (interaction.memberPermissions?.has(permission)) return true;
  await interaction.reply({
    content: `⛔ **Acceso denegado**\nNecesitas el permiso **${label}** para ${action}.`,
    flags: MessageFlags.Ephemeral,
  });
  return false;
}

// Quien usa el comando, como miembro del servidor (con sus roles)
async function fetchModerator(interaction: ChatInputCommandInteraction): Promise<GuildMember | null> {
  if (interaction.inCachedGuild()) return interaction.member;
  if (!interaction.guild) return null;
  return interaction.guild.members.fetch(interaction.user.id).catch(() => null);
}

// Igual que en Discord: solo puedes moderar a quien tiene su rol más alto por debajo del tuyo
// (el dueño del servidor puede con todos). Responde y devuelve false si no.
async function ensureOutranks(interaction: ChatInputCommandInteraction, target: GuildMember): Promise<boolean> {
  if (interaction.user.id === target.guild.ownerId) return true;
  const moderator = await fetchModerator(interaction);
  if (moderator && moderator.roles.highest.comparePositionTo(target.roles.highest) > 0) return true;
  await interaction.reply({
    content: '⛔ No puedes moderar a alguien con un rol igual o más alto que el tuyo.',
    flags: MessageFlags.Ephemeral,
  });
  return false;
}

function isUnknownMember(error: unknown): boolean {
  return error instanceof DiscordAPIError && error.code === RESTJSONErrorCodes.UnknownMember;
}

// Tope del /mute. Discord permite aislar hasta 28 días; aquí se deja en 1 semana.
const MAX_MUTE_MINUTOS = 10080; // 1 semana
const MAX_TIMEOUT_MS = 28 * 24 * 60 * 60 * 1000;

// Antes /mute daba un rol "Muteado" y lo quitaba con un temporizador en memoria (se perdía al
// reiniciar). Ahora usa el aislamiento de Discord; el rol viejo solo se quita a quien aún lo tenga.
const LEGACY_MUTE_ROLE = 'Muteado';

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

/**
 * Al arrancar el bot: los mutes del sistema viejo (rol "Muteado") que siguen vigentes pasan a ser
 * un aislamiento de Discord por el tiempo que les quedaba, y se quita el rol. Los mutes que ya
 * terminaron se marcan como inactivos en el historial.
 */
export async function migrateLegacyMutes(client: Client): Promise<void> {
  let rows;
  try {
    rows = await storage.getActiveModerationActionsByType('mute');
  } catch (error) {
    console.error('[MUTE] No se pudieron revisar los mutes vigentes:', error);
    return;
  }

  const now = Date.now();
  const seen = new Set<string>();
  // Vienen del más nuevo al más viejo: cuenta el último mute de cada persona
  for (const row of rows) {
    const key = `${row.guildId}:${row.userId}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const endsAt = row.createdAt && row.duration ? row.createdAt.getTime() + row.duration * 60_000 : null;
    const guild = client.guilds.cache.get(row.guildId);
    const legacyRole = guild?.roles.cache.find(r => r.name === LEGACY_MUTE_ROLE);

    if (guild && legacyRole) {
      const member = await guild.members.fetch(row.userId).catch(() => null);
      if (member?.roles.cache.has(legacyRole.id)) {
        try {
          const remaining = endsAt !== null ? endsAt - now : 0;
          if (remaining > 0) {
            if (!member.moderatable) {
              console.warn(`[MUTE] No puedo aislar a ${member.user.tag} en ${guild.name}; le dejo el rol "${LEGACY_MUTE_ROLE}" (quítaselo a mano cuando toque).`);
              continue;
            }
            await member.timeout(Math.min(remaining, MAX_TIMEOUT_MS), 'El mute del rol "Muteado" pasa a ser un aislamiento de Discord');
          }
          await member.roles.remove(legacyRole, 'Ahora /mute usa el aislamiento de Discord');
        } catch (error) {
          console.error(`[MUTE] No se pudo pasar el mute de ${row.userId} en ${guild.name} al aislamiento de Discord:`, error);
          continue;
        }
      }
    }

    if (endsAt !== null && endsAt <= now) {
      await storage.deactivateModerationActions(row.guildId, row.userId, 'mute').catch((error) => {
        console.error('[MUTE] No se pudo marcar un mute terminado:', error);
      });
    }
  }
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
      if (!(await requirePermission(interaction, PermissionFlagsBits.ManageMessages, 'Gestionar mensajes', 'borrar mensajes'))) return;

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

      const usuario = interaction.options.getUser('usuario', true);
      const razon = interaction.options.getString('razon') || 'No especificada';

      if (!(await requirePermission(interaction, PermissionFlagsBits.KickMembers, 'Expulsar miembros', 'expulsar miembros'))) return;

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

      if (!(await ensureOutranks(interaction, targetMember))) return;

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

      const usuario = interaction.options.getUser('usuario', true);
      const razon = interaction.options.getString('razon') || 'No especificada';

      if (!(await requirePermission(interaction, PermissionFlagsBits.BanMembers, 'Banear miembros', 'banear miembros'))) return;

      if (usuario.id === interaction.user.id || usuario.id === interaction.client.user?.id || usuario.id === interaction.guild.ownerId) {
        await interaction.reply({ content: '⛔ No puedes banearte a ti mismo, al bot ni al dueño del servidor.', flags: MessageFlags.Ephemeral });
        return;
      }

      if (!interaction.guild.members.me?.permissions.has('BanMembers')) {
        await interaction.reply({ content: '❌ No tengo permisos para banear miembros.', flags: MessageFlags.Ephemeral });
        return;
      }

      let targetMember: GuildMember | null;
      try {
        targetMember = await interaction.guild.members.fetch(usuario.id);
      } catch (error) {
        if (!isUnknownMember(error)) throw error;
        targetMember = null; // ya no está en el servidor
      }

      if (targetMember) {
        if (!(await ensureOutranks(interaction, targetMember))) return;

        if (!targetMember.bannable) {
          await interaction.reply({ content: 'No puedo banear a ese usuario.', flags: MessageFlags.Ephemeral });
          return;
        }

        await targetMember.ban({ reason: razon });
      } else {
        // Se fue (o lo sacó el anti-raid): Discord deja banear por ID para que no pueda volver
        try {
          await interaction.guild.bans.create(usuario.id, { reason: razon });
        } catch (error) {
          console.error(`No se pudo banear por ID a ${usuario.id}:`, error);
          await interaction.reply({ content: '❌ No pude banear a ese usuario. Revisa que mi rol tenga el permiso **Banear miembros**.', flags: MessageFlags.Ephemeral });
          return;
        }
      }

      const fuera = targetMember ? '' : ' Ya no estaba en el servidor, pero no podrá volver a entrar.';
      await interaction.reply({ content: `✅ **${usuario.tag}** fue baneado.${fuera} Razón: ${razon}`, flags: MessageFlags.Ephemeral });
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
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

    async execute(interaction: ChatInputCommandInteraction, bot: DiscordBot) {
      if (!interaction.guild) {
        await interaction.reply({ content: 'Comando solo en servidores.', flags: MessageFlags.Ephemeral });
        return;
      }

      const usuario = interaction.options.getUser('usuario', true);
      const minutos = interaction.options.getInteger('minutos', true);

      if (!(await requirePermission(interaction, PermissionFlagsBits.ModerateMembers, 'Aislar temporalmente a miembros', 'silenciar miembros'))) return;

      if (usuario.id === interaction.user.id || usuario.id === interaction.client.user?.id || usuario.id === interaction.guild.ownerId) {
        await interaction.reply({ content: '⛔ No puedes mutearte a ti mismo, al bot ni al dueño del servidor.', flags: MessageFlags.Ephemeral });
        return;
      }

      if (minutos < 1 || minutos > MAX_MUTE_MINUTOS) {
        await interaction.reply({ content: `❌ Puedes silenciar entre 1 y ${MAX_MUTE_MINUTOS} minutos (1 semana).`, flags: MessageFlags.Ephemeral });
        return;
      }

      if (!interaction.guild.members.me?.permissions.has('ModerateMembers')) {
        await interaction.reply({ content: '❌ Me falta el permiso **Aislar temporalmente a miembros**.', flags: MessageFlags.Ephemeral });
        return;
      }

      const targetMember = await interaction.guild.members.fetch(usuario.id).catch(() => null);
      if (!targetMember) {
        await interaction.reply({ content: 'No se encontró el usuario.', flags: MessageFlags.Ephemeral });
        return;
      }

      if (!(await ensureOutranks(interaction, targetMember))) return;

      // El aislamiento lo quita Discord solo al terminar: sobrevive a reinicios del bot y a salir y
      // volver a entrar, y un /mute nuevo reemplaza al anterior
      if (!targetMember.moderatable) {
        await interaction.reply({
          content: '❌ No puedo silenciar a ese usuario: tiene **Administrador** o un rol igual o más alto que el mío.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await targetMember.timeout(minutos * 60_000, `Silenciado con /mute por ${interaction.user.tag}`);

      const termina = Math.floor((Date.now() + minutos * 60_000) / 1000);
      await interaction.reply({
        content: `🔇 **${usuario.tag}** fue silenciado por ${minutos} minuto(s). Discord le quitará el silencio <t:${termina}:R>.`,
        flags: MessageFlags.Ephemeral,
      });
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
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

    async execute(interaction: ChatInputCommandInteraction, bot: DiscordBot) {
      if (!interaction.guild) {
        await interaction.reply({ content: 'Comando solo en servidores.', flags: MessageFlags.Ephemeral });
        return;
      }

      const usuario = interaction.options.getUser('usuario', true);

      if (!(await requirePermission(interaction, PermissionFlagsBits.ModerateMembers, 'Aislar temporalmente a miembros', 'quitar silencios'))) return;

      if (!interaction.guild.members.me?.permissions.has('ModerateMembers')) {
        await interaction.reply({ content: '❌ Me falta el permiso **Aislar temporalmente a miembros**.', flags: MessageFlags.Ephemeral });
        return;
      }

      const targetMember = await interaction.guild.members.fetch(usuario.id).catch(() => null);
      if (!targetMember) {
        await interaction.reply({ content: 'No se encontró el usuario.', flags: MessageFlags.Ephemeral });
        return;
      }

      // Mutes de antes del cambio: el rol "Muteado"
      const legacyRole = interaction.guild.roles.cache.find(r => r.name === LEGACY_MUTE_ROLE);
      const hasLegacyRole = !!legacyRole && targetMember.roles.cache.has(legacyRole.id);
      const timedOut = targetMember.isCommunicationDisabled();

      if (!timedOut && !hasLegacyRole) {
        // Quizá el silencio ya terminó solo: que el historial deje de mostrarlo como vigente
        await storage.deactivateModerationActions(interaction.guild.id, usuario.id, 'mute').catch((error) => {
          console.error('No se pudo marcar el mute como terminado:', error);
        });
        await interaction.reply({ content: '❌ Ese usuario no está silenciado.', flags: MessageFlags.Ephemeral });
        return;
      }

      if (!(await ensureOutranks(interaction, targetMember))) return;

      const motivo = `Mute quitado con /unmute por ${interaction.user.tag}`;
      if (timedOut) {
        if (!targetMember.moderatable) {
          await interaction.reply({ content: '❌ No puedo quitarle el silencio: tiene un rol igual o más alto que el mío.', flags: MessageFlags.Ephemeral });
          return;
        }
        await targetMember.timeout(null, motivo);
      }
      let aviso = '';
      if (hasLegacyRole && legacyRole) {
        try {
          await targetMember.roles.remove(legacyRole, motivo);
        } catch (error) {
          console.error('No se pudo quitar el rol "Muteado":', error);
          aviso = `\n⚠️ No pude quitarle el rol **${LEGACY_MUTE_ROLE}**; quítaselo a mano.`;
        }
      }

      await interaction.reply({ content: `🔊 Se quitó el mute a **${usuario.tag}**.${aviso}`, flags: MessageFlags.Ephemeral });
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

      const accion = interaction.options.getString('accion', true);
      const canal = interaction.channel;

      if (!(await requirePermission(interaction, PermissionFlagsBits.ManageChannels, 'Gestionar canales', 'bloquear canales'))) return;

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

      // Guardar y leer los permisos previos (base de datos) puede tardar más de los 3 s que da Discord
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const guild = interaction.guild;
      const everyoneRole = guild.roles.everyone;
      const overwrite = canal.permissionOverwrites.cache.get(everyoneRole.id);
      // Bloqueado = @everyone tiene negados todos los permisos del lockdown
      const lockedNow = LOCKDOWN_PERMS.every(perm => overwrite?.deny.has(perm));
      const motivo = `/lockdown por ${interaction.user.tag}`;
      const permisosError = '❌ No pude cambiar los permisos de este canal. Revisa que tenga **Gestionar roles** y los permisos de hilos aquí.';

      let respuesta: string;
      if (accion === 'lock') {
        let aviso = '';
        // Se guarda cómo estaba @everyone para dejarlo igual al desbloquear. Si ya estaba bloqueado,
        // se conserva lo guardado en el primer bloqueo.
        if (!lockedNow) {
          const snapshot: ChannelLockdownSnapshot = {
            permissions: Object.fromEntries(LOCKDOWN_PERMS.map(perm => [
              perm,
              overwrite?.allow.has(perm) ? true : overwrite?.deny.has(perm) ? false : null,
            ])),
            hadOverwrite: !!overwrite,
          };
          try {
            await storage.saveChannelLockdown(guild.id, canal.id, snapshot);
          } catch (error) {
            console.error('Lockdown: no se pudieron guardar los permisos previos:', error);
            aviso = '\n⚠️ No pude guardar cómo estaban los permisos; al desbloquear solo quitaré las restricciones del bloqueo.';
          }
        }

        try {
          await canal.permissionOverwrites.edit(everyoneRole, overwriteOptions(LOCKDOWN_PERMS, false), { reason: motivo });
        } catch (e) {
          console.error('Error en lockdown:', e);
          await interaction.editReply(permisosError);
          return;
        }
        respuesta = `🔒 Canal y sus hilos bloqueados. Solo el staff puede escribir.${aviso}`;
      } else {
        let snapshot: ChannelLockdownSnapshot | undefined;
        try {
          snapshot = await storage.getChannelLockdown(guild.id, canal.id);
        } catch (error) {
          console.error('Lockdown: no se pudieron leer los permisos previos:', error);
        }

        if (!snapshot && !lockedNow) {
          await interaction.editReply('ℹ️ Este canal no está bloqueado con /lockdown, así que no cambié nada.');
          return;
        }

        // Con lo guardado se deja todo como estaba; sin eso, solo se quitan los permisos que niega el bloqueo
        const options: PermissionOverwriteOptions = {};
        for (const perm of LOCKDOWN_PERMS) options[perm] = snapshot ? snapshot.permissions[perm] ?? null : null;

        // Si @everyone no tenía permisos propios antes del bloqueo y no le queda ninguno, se quitan del todo
        // (así el canal vuelve a seguir los permisos de su categoría)
        const lockdownBits = PermissionsBitField.resolve(LOCKDOWN_PERMS);
        const otrosPermisos = ((overwrite?.allow.bitfield ?? 0n) | (overwrite?.deny.bitfield ?? 0n)) & ~lockdownBits;
        const quedaVacio = otrosPermisos === 0n && LOCKDOWN_PERMS.every(perm => options[perm] === null);

        try {
          if (snapshot && !snapshot.hadOverwrite && quedaVacio) {
            if (overwrite) await canal.permissionOverwrites.delete(everyoneRole, motivo);
          } else {
            await canal.permissionOverwrites.edit(everyoneRole, options, { reason: motivo });
          }
        } catch (e) {
          console.error('Error en lockdown:', e);
          await interaction.editReply(permisosError);
          return;
        }

        if (snapshot) {
          await storage.deleteChannelLockdown(guild.id, canal.id).catch((error) => {
            console.error('Lockdown: no se pudieron borrar los permisos guardados:', error);
          });
          respuesta = '🔓 Canal desbloqueado: los permisos de @everyone quedaron como estaban antes del bloqueo.';
        } else {
          respuesta = '🔓 Canal desbloqueado.\n⚠️ No tenía guardado cómo estaban los permisos antes del bloqueo, así que solo quité las restricciones del bloqueo a @everyone. Revisa los permisos del canal si antes tenía alguna limitación.';
        }
      }

      await interaction.editReply(respuesta);
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

      const usuario = interaction.options.getUser('usuario', true);
      const razon = interaction.options.getString('razon') || 'No especificada';

      if (!(await requirePermission(interaction, PermissionFlagsBits.ModerateMembers, 'Aislar temporalmente a miembros', 'advertir miembros'))) return;

      if (usuario.id === interaction.user.id || usuario.id === interaction.client.user?.id || usuario.id === interaction.guild.ownerId) {
        await interaction.reply({ content: '⛔ No puedes advertirte a ti mismo, al bot ni al dueño del servidor.', flags: MessageFlags.Ephemeral });
        return;
      }

      // Si sigue en el servidor, misma regla de roles que el resto de la moderación
      const targetMember = await interaction.guild.members.fetch(usuario.id).catch(() => null);
      if (targetMember && !(await ensureOutranks(interaction, targetMember))) return;

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

      const usuario = interaction.options.getUser('usuario', true);

      if (!(await requirePermission(interaction, PermissionFlagsBits.ModerateMembers, 'Aislar temporalmente a miembros', 'ver advertencias'))) return;

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