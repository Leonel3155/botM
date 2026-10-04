import {
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
  type Guild,
  type GuildBasedChannel,
  type GuildTextBasedChannel,
} from 'discord.js';

// Nombres de permisos tal como aparecen en Discord (en español)
const PERMISSION_LABELS: Record<string, string> = {
  ViewChannel: 'Ver canal',
  SendMessages: 'Enviar mensajes',
  SendMessagesInThreads: 'Enviar mensajes en hilos',
  EmbedLinks: 'Insertar enlaces',
  CreatePublicThreads: 'Crear hilos públicos',
  ManageRoles: 'Gestionar roles',
  MentionEveryone: 'Mencionar @everyone, @here y todos los roles',
  ManageEvents: 'Gestionar eventos',
  CreateEvents: 'Crear eventos',
};

type PermissionName = keyof typeof PermissionFlagsBits;

export function permissionLabel(name: PermissionName): string {
  return PERMISSION_LABELS[name] || name;
}

export type SendableChannelResult =
  | { ok: true; channel: GuildTextBasedChannel }
  | { ok: false; reason: string };

// Comprueba que el bot pueda publicar embeds en un canal
export function checkSendableChannel(channel: GuildBasedChannel | null | undefined): SendableChannelResult {
  if (!channel) {
    return { ok: false, reason: 'El canal ya no existe o no lo puedo ver.' };
  }
  if (!channel.isTextBased()) {
    return { ok: false, reason: `${channel} no es un canal de texto.` };
  }

  const me = channel.guild.members.me;
  const permissions = me ? channel.permissionsFor(me) : null;
  if (!permissions) {
    return { ok: false, reason: `No pude revisar mis permisos en ${channel}.` };
  }

  const needed: PermissionName[] = [
    'ViewChannel',
    channel.isThread() ? 'SendMessagesInThreads' : 'SendMessages',
    'EmbedLinks',
  ];
  const missing = needed.filter(name => !permissions.has(PermissionFlagsBits[name]));
  if (missing.length > 0) {
    return {
      ok: false,
      reason: `Me faltan permisos en ${channel}: ${missing.map(name => `**${permissionLabel(name)}**`).join(', ')}.`,
    };
  }

  return { ok: true, channel };
}

export function resolveSendableChannel(guild: Guild, channelId: string | null | undefined): SendableChannelResult {
  if (!channelId) {
    return { ok: false, reason: 'Todavía no hay un canal configurado.' };
  }
  return checkSendableChannel(guild.channels.cache.get(channelId));
}

// Canales donde se pueden abrir hilos a partir de un mensaje
export function supportsThreads(channel: GuildTextBasedChannel): boolean {
  return channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement;
}

export function canCreateThreads(channel: GuildTextBasedChannel): boolean {
  const me = channel.guild.members.me;
  if (!me || !supportsThreads(channel)) return false;
  return channel.permissionsFor(me)?.has(PermissionFlagsBits.CreatePublicThreads) ?? false;
}

// Verificación en tiempo de ejecución (además de setDefaultMemberPermissions)
export async function ensureMemberPermission(
  interaction: ChatInputCommandInteraction<'cached'>,
  permissions: PermissionName[],
  message = '⛔ Necesitas el permiso **Gestionar servidor** para usar este comando.'
): Promise<boolean> {
  const allowed = permissions.some(name => interaction.memberPermissions.has(PermissionFlagsBits[name]));
  if (allowed) return true;

  await interaction.reply({ content: message, flags: MessageFlags.Ephemeral });
  return false;
}

export async function replyGuildOnly(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.reply({
    content: '❌ Este comando solo funciona dentro de un servidor.',
    flags: MessageFlags.Ephemeral,
  });
}

// Permite escribir saltos de línea como "\n" en las opciones de los comandos
export function withLineBreaks(text: string): string {
  return text.replace(/\\n/g, '\n');
}

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
