import { Events, PermissionFlagsBits, type Message } from 'discord.js';
import { CUSTOM_COMMAND_LIMITS, RESERVED_CUSTOM_COMMAND_NAMES } from '@shared/api';
import { storage, type EnabledCustomCommand } from '../storage';
import type { DiscordBot } from './index';

// Comandos personalizados del panel: el bot responde a "<prefijo><nombre>" con el texto guardado.
// Nunca tapan a los comandos de prefijo del bot (esos nombres están reservados) y solo pueden
// mencionar usuarios: nada de @everyone, @here ni roles aunque el texto los incluya.

const DEFAULT_PREFIX = '&';
// La configuración de cada servidor se guarda en memoria un rato (el panel la invalida al cambiarla)
const CACHE_TTL_MS = 60_000;
// Si la BD falla, se vuelve a intentar pasado este tiempo
const ERROR_RETRY_MS = 30_000;
const COOLDOWN_MS = CUSTOM_COMMAND_LIMITS.cooldownSeconds * 1000;
const MAX_MESSAGE_LENGTH = 2000;

const RESERVED = new Set(RESERVED_CUSTOM_COMMAND_NAMES);

interface GuildCommands {
  loadedAt: number;
  prefix: string;
  commands: Map<string, EnabledCustomCommand>;
}

const cache = new Map<string, GuildCommands>();
const pending = new Map<string, Promise<GuildCommands>>();
// Versión por servidor: si se invalida mientras se lee la BD, esa lectura no se guarda
const versions = new Map<string, number>();
const lastUsedAt = new Map<string, number>();

/** Llamar después de crear, editar, borrar o activar un comando, o de cambiar el prefijo. */
export function invalidateCustomCommandsCache(guildId: string): void {
  cache.delete(guildId);
  pending.delete(guildId);
  versions.set(guildId, (versions.get(guildId) ?? 0) + 1);
}

export function isReservedCommandName(name: string): boolean {
  return RESERVED.has(name.toLowerCase());
}

async function loadGuildCommands(guildId: string): Promise<GuildCommands> {
  const cached = cache.get(guildId);
  if (cached && Date.now() - cached.loadedAt < CACHE_TTL_MS) return cached;

  const inFlight = pending.get(guildId);
  if (inFlight) return inFlight;

  const request: Promise<GuildCommands> = readGuildCommands(guildId, cached).finally(() => {
    if (pending.get(guildId) === request) pending.delete(guildId);
  });
  pending.set(guildId, request);
  return request;
}

async function readGuildCommands(guildId: string, previous: GuildCommands | undefined): Promise<GuildCommands> {
  const version = versions.get(guildId) ?? 0;
  try {
    const [guild, commands] = await Promise.all([
      storage.getGuild(guildId),
      storage.getEnabledCustomCommands(guildId),
    ]);
    const entry: GuildCommands = {
      loadedAt: Date.now(),
      prefix: guild?.prefix || DEFAULT_PREFIX,
      commands: new Map(commands.map((command) => [command.name, command])),
    };
    if ((versions.get(guildId) ?? 0) === version) cache.set(guildId, entry);
    return entry;
  } catch (error) {
    // Sin BD seguimos con lo último que sabíamos (o sin comandos) y reintentamos en un rato,
    // en vez de consultar la BD (y llenar el log de errores) con cada mensaje
    console.error(`[COMANDOS] No se pudieron leer los comandos personalizados de ${guildId}:`, error);
    const fallback: GuildCommands = {
      loadedAt: Date.now() - CACHE_TTL_MS + ERROR_RETRY_MS,
      prefix: previous?.prefix ?? DEFAULT_PREFIX,
      commands: previous?.commands ?? new Map(),
    };
    if ((versions.get(guildId) ?? 0) === version) cache.set(guildId, fallback);
    return fallback;
  }
}

/** Variables del texto: {usuario} {nombre} {servidor} {canal} {miembros}. */
export function renderCustomCommand(template: string, message: Message<true>): string {
  // Reemplazos con función: así un "$" en el nombre del servidor o del usuario se copia tal cual
  const text = template
    .replace(/\{usuario\}/gi, () => `<@${message.author.id}>`)
    .replace(/\{nombre\}/gi, () => message.member?.displayName ?? message.author.username)
    .replace(/\{servidor\}/gi, () => message.guild.name)
    .replace(/\{canal\}/gi, () => `<#${message.channelId}>`)
    .replace(/\{miembros\}/gi, () => message.guild.memberCount.toLocaleString('es-MX'));
  return text.length <= MAX_MESSAGE_LENGTH ? text : `${text.slice(0, MAX_MESSAGE_LENGTH - 1)}…`;
}

// Una respuesta cada pocos segundos por persona (en ese servidor)
function onCooldown(guildId: string, userId: string): boolean {
  const key = `${guildId}:${userId}`;
  const now = Date.now();
  if (now - (lastUsedAt.get(key) ?? 0) < COOLDOWN_MS) return true;
  lastUsedAt.set(key, now);

  if (lastUsedAt.size > 5000) {
    lastUsedAt.forEach((at, entry) => {
      if (now - at >= COOLDOWN_MS) lastUsedAt.delete(entry);
    });
  }
  return false;
}

async function handleMessage(message: Message): Promise<void> {
  if (message.author.bot || message.webhookId || message.system || !message.inGuild()) return;
  if (!message.content) return;

  const { prefix, commands } = await loadGuildCommands(message.guildId);
  if (commands.size === 0 || !message.content.startsWith(prefix)) return;

  // Igual que los comandos de prefijo del bot: "&nombre argumentos..."
  const name = message.content.slice(prefix.length).trim().split(/\s+/)[0]?.toLowerCase();
  if (!name || isReservedCommandName(name)) return;

  const command = commands.get(name);
  if (!command) return;

  if (!message.channel.isSendable()) return;
  const me = message.guild.members.me;
  const permissions = me ? message.channel.permissionsFor(me) : null;
  const canWrite = message.channel.isThread() ? PermissionFlagsBits.SendMessagesInThreads : PermissionFlagsBits.SendMessages;
  if (!permissions?.has([PermissionFlagsBits.ViewChannel, canWrite])) return;

  if (onCooldown(message.guildId, message.author.id)) return;

  await message.channel.send({
    content: renderCustomCommand(command.response, message),
    // Solo menciones de usuarios: nunca @everyone, @here ni roles
    allowedMentions: { parse: ['users'] },
  });

  storage.incrementCustomCommandUses(command.id).catch((error) => {
    console.error('[COMANDOS] No se pudo contar el uso de un comando personalizado:', error);
  });
}

export function setupCustomCommands(bot: DiscordBot): void {
  bot.client.on(Events.MessageCreate, (message) => {
    handleMessage(message).catch((error) => {
      console.error(`[COMANDOS] Error al responder un comando personalizado en ${message.guildId}:`, error);
    });
  });
}
