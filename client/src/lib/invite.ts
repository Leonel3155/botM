/**
 * Enlace para invitar al bot a un servidor.
 *
 * Hoy el servidor no expone un endpoint con el enlace, así que se arma aquí con
 * VITE_DISCORD_CLIENT_ID (el "Application ID" del bot en el Discord Developer Portal).
 * Es un dato público, no un secreto. Vite lo lee en el build: ponlo en client/.env
 * o como variable de entorno al ejecutar `npm run dev` / `npm run build`.
 */

// Permisos que usa el bot (calculados a partir de lo que piden sus comandos y servicios).
//
// OJO con los permisos de canal: Discord solo deja que el bot permita o niegue en un
// canal un permiso que él mismo tiene. Por eso aquí tiene que estar TODO lo que el bot
// escribe en los permisos de un canal: MUTE_DENY (rol "Muteado" de /mute) y
// LOCKDOWN_PERMS (/lockdown) de server/bot/commands/moderation.ts. Si se añade algo a
// esas listas, añádelo también aquí o /mute y /lockdown fallarán por falta de permisos.
const PERMISSIONS = {
  KickMembers: 1n << 1n, // /kick y anti-raid
  BanMembers: 1n << 2n, // /ban y anti-raid
  ManageChannels: 1n << 4n, // bloqueo de canales (lockdown)
  ManageGuild: 1n << 5n, // anti-raid: subir el nivel de verificación
  AddReactions: 1n << 6n, // también se niega en /mute y /lockdown
  ViewChannel: 1n << 10n,
  SendMessages: 1n << 11n, // también se niega en /mute y /lockdown
  ManageMessages: 1n << 13n, // /clear
  EmbedLinks: 1n << 14n, // bienvenida, anuncios, alertas
  AttachFiles: 1n << 15n,
  ReadMessageHistory: 1n << 16n,
  MentionEveryone: 1n << 17n, // /anuncio con @everyone
  UseExternalEmojis: 1n << 18n,
  Connect: 1n << 20n, // se niega al rol "Muteado" en los canales de voz (/mute)
  Speak: 1n << 21n, // se niega al rol "Muteado" en los canales de voz (/mute)
  ManageRoles: 1n << 28n, // rol de bienvenida, rol "Muteado" y permisos de canal
  ManageEvents: 1n << 33n, // /evento
  CreatePublicThreads: 1n << 35n, // hilo de la pregunta del día; se niega en /mute y /lockdown
  CreatePrivateThreads: 1n << 36n, // se niega en /mute y /lockdown
  SendMessagesInThreads: 1n << 38n, // se niega en /mute y /lockdown
  ModerateMembers: 1n << 40n, // aislar (timeout) miembros
} as const;

export const BOT_INVITE_PERMISSIONS = Object.values(PERMISSIONS)
  .reduce((total, bit) => total | bit, 0n)
  .toString();

function getClientId(): string | null {
  const raw = import.meta.env.VITE_DISCORD_CLIENT_ID;
  const value = typeof raw === "string" ? raw.trim() : "";
  return /^\d{17,20}$/.test(value) ? value : null;
}

/** ¿Se puede generar el enlace de invitación? (falta VITE_DISCORD_CLIENT_ID si no) */
export function canBuildInviteUrl(): boolean {
  return getClientId() !== null;
}

/**
 * URL de invitación (scopes bot + applications.commands). Si se pasa guildId,
 * Discord abre directamente ese servidor.
 */
export function getBotInviteUrl(guildId?: string | null): string | null {
  const clientId = getClientId();
  if (!clientId) return null;

  const params = new URLSearchParams({
    client_id: clientId,
    scope: "bot applications.commands",
    permissions: BOT_INVITE_PERMISSIONS,
  });
  if (guildId && /^\d{17,20}$/.test(guildId)) {
    params.set("guild_id", guildId);
    params.set("disable_guild_select", "true");
  }
  return `https://discord.com/oauth2/authorize?${params.toString()}`;
}
