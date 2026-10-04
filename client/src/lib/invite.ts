/**
 * Enlace para invitar al bot a un servidor.
 *
 * Hoy el servidor no expone un endpoint con el enlace, así que se arma aquí con
 * VITE_DISCORD_CLIENT_ID (el "Application ID" del bot en el Discord Developer Portal).
 * Es un dato público, no un secreto. Vite lo lee en el build: ponlo en client/.env
 * o como variable de entorno al ejecutar `npm run dev` / `npm run build`.
 */

// Permisos que usa el bot (calculados a partir de lo que piden sus comandos y servicios)
const PERMISSIONS = {
  KickMembers: 1n << 1n, // /kick y anti-raid
  BanMembers: 1n << 2n, // /ban y anti-raid
  ManageChannels: 1n << 4n, // bloqueo de canales (lockdown)
  ManageGuild: 1n << 5n, // anti-raid: subir el nivel de verificación
  AddReactions: 1n << 6n,
  ViewChannel: 1n << 10n,
  SendMessages: 1n << 11n,
  ManageMessages: 1n << 13n, // /clear
  EmbedLinks: 1n << 14n, // bienvenida, anuncios, alertas
  AttachFiles: 1n << 15n,
  ReadMessageHistory: 1n << 16n,
  MentionEveryone: 1n << 17n, // /anuncio con @everyone
  UseExternalEmojis: 1n << 18n,
  ManageRoles: 1n << 28n, // rol de bienvenida y silencios
  ManageEvents: 1n << 33n, // /evento
  CreatePublicThreads: 1n << 35n, // hilo de la pregunta del día
  SendMessagesInThreads: 1n << 38n,
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
