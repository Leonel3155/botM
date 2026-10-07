import type { Request, Response } from "express";
import {
  ChannelType,
  PermissionFlagsBits,
  type Guild as DiscordGuild,
  type GuildBasedChannel,
  type GuildMember,
  type Role,
} from "discord.js";
import type { Guild as GuildRow, RaidEvent } from "@shared/schema";
import type { Jsonify, ModerationActionItem, RaidEventDetails, RaidEventItem } from "@shared/api";
import type { ModerationActionWithUsers, PageCursor } from "../storage";
import { bot } from "../bot/index";
import { DEFAULT_DAILY_QUESTION_HOUR } from "../bot/services/dailyQuestion";
import { getLocalDateString, getZonedParts, resolveTimezone, zonedTimeToDate } from "../bot/services/timezone";
import { getActiveRaid } from "../bot/middleware/antiRaid";
import { checkMemberCanPost } from "../bot/services/channels";
import { isDevSession, isSnowflake } from "./middleware";

// =============================================
// Fechas y paginación
// =============================================

export function toIso(date: Date | null | undefined): string | null {
  return date ? date.toISOString() : null;
}

/** Una fila de la BD tal como llega al panel: res.json convierte cada Date en texto ISO. */
export function asJson<T>(value: T): Jsonify<T> {
  return value as unknown as Jsonify<T>;
}

// Los IDs de las filas son UUID (gen_random_uuid)
const ROW_ID_REGEX = /^[0-9a-fA-F-]{36}$/;

export function isRowId(value: unknown): value is string {
  return typeof value === "string" && ROW_ID_REGEX.test(value);
}

/** Cursor opaco para ?before=: "<milisegundos>_<id>" de la última fila de la página. */
export function encodeCursor(createdAt: Date | null | undefined, id: string): string | null {
  if (!createdAt) return null;
  return `${createdAt.getTime()}_${id}`;
}

/** undefined = no se mandó; null = no es válido. */
export function decodeCursor(value: unknown): PageCursor | null | undefined {
  if (value === undefined || value === "") return undefined;
  if (typeof value !== "string") return null;
  const separator = value.indexOf("_");
  if (separator <= 0) return null;
  const ms = Number(value.slice(0, separator));
  const id = value.slice(separator + 1);
  if (!Number.isSafeInteger(ms) || ms < 0 || !isRowId(id)) return null;
  return { createdAt: new Date(ms), id };
}

/** Lee ?limit=, ?before=, etc. como texto (Express puede dar arreglos si se repite el parámetro). */
export function queryString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

// =============================================
// Textos del bot → texto plano para el panel
// =============================================

/**
 * Los mensajes del bot traen menciones de Discord (<#id>, <@&id>, <@id>) y **negritas**.
 * En el panel se ven mejor como "#canal", "@rol" y sin asteriscos.
 */
export function plainDiscordText(guild: DiscordGuild | null | undefined, text: string): string {
  return text
    .replace(/<#(\d+)>/g, (_match, id: string) => {
      const channel = guild?.channels.cache.get(id);
      return channel ? `#${channel.name}` : "#canal-desconocido";
    })
    .replace(/<@&(\d+)>/g, (_match, id: string) => {
      const role = guild?.roles.cache.get(id);
      return role ? `@${role.name}` : "@rol-desconocido";
    })
    .replace(/<@!?(\d+)>/g, (_match, id: string) => {
      const member = guild?.members.cache.get(id);
      return member ? `@${member.user.username}` : "@usuario";
    })
    .replace(/\*\*/g, "");
}

// =============================================
// Discord: canales, roles y el usuario del panel
// =============================================

/** Canal de texto o de anuncios de ESE servidor (donde el bot puede publicar bienvenidas, preguntas o alertas). */
export function findPostableChannel(guild: DiscordGuild, channelId: string): GuildBasedChannel | null {
  const channel = guild.channels.cache.get(channelId);
  if (!channel) return null;
  return channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement ? channel : null;
}

/** Servidor de discord.js si el bot está conectado y dentro (sin exigirlo como requireBotInGuild). */
export function getCachedBotGuild(guildId: string): DiscordGuild | null {
  if (!bot.client.isReady()) return null;
  return bot.client.guilds.cache.get(guildId) ?? null;
}

export function guildIconUrl(guild: DiscordGuild | null, guildId: string, icon: string | null | undefined): string | null {
  if (guild) return guild.iconURL({ size: 128 }) ?? null;
  return icon ? `https://cdn.discordapp.com/icons/${guildId}/${icon}.png?size=128` : null;
}

/** ID de Discord del usuario logueado en el panel. */
export function sessionUserId(req: Request): string | null {
  return req.session.user?.id ?? null;
}

/** El usuario del panel como miembro del servidor (null si no está o es la sesión de desarrollo). */
export async function fetchSessionMember(req: Request, guild: DiscordGuild): Promise<GuildMember | null> {
  const userId = sessionUserId(req);
  if (!isSnowflake(userId)) return null;
  try {
    return await guild.members.fetch(userId);
  } catch {
    return null;
  }
}

/**
 * Igual que /bienvenida rol: quien configura el rol automático también debe poder darlo a mano
 * (Gestionar roles y el rol por debajo de su rol más alto), salvo el dueño del servidor.
 * Devuelve el motivo si no puede, o null si sí.
 */
export function checkMemberCanAssignRole(
  guild: DiscordGuild,
  member: GuildMember | null,
  role: Role,
  devSession: boolean
): string | null {
  if (devSession) return null;
  if (!member) return "No te encontré como miembro de este servidor.";
  if (member.id === guild.ownerId) return null;
  if (!member.permissions.has(PermissionFlagsBits.ManageRoles)) {
    return "Para elegir el rol automático también necesitas el permiso Gestionar roles.";
  }
  if (member.roles.highest.comparePositionTo(role) <= 0) {
    return `Solo puedes elegir un rol que esté por debajo de tu rol más alto, y @${role.name} no lo está.`;
  }
  return null;
}

export function isDevRequest(req: Request): boolean {
  return isDevSession(req.session);
}

/**
 * Canales que se eligen en el panel (bienvenida, pregunta del día, feeds, alertas): igual que con
 * /anuncio, quien los elige también debe poder ver el canal y escribir en él, para que nadie use
 * al bot para publicar donde no puede. Devuelve el motivo si no puede, o null si sí.
 */
export async function checkPanelUserCanUseChannel(req: Request, guild: DiscordGuild, channelId: string): Promise<string | null> {
  if (isDevRequest(req)) return null;
  const channel = guild.channels.cache.get(channelId);
  if (!channel?.isTextBased()) return null; // quien llama ya comprobó que exista y sea de texto
  const member = await fetchSessionMember(req, guild);
  if (!member) return "No te encontré como miembro de este servidor.";
  const check = checkMemberCanPost(member, channel);
  return check.ok ? null : `Solo puedes elegir canales donde tú puedes escribir. ${plainDiscordText(guild, check.reason)}`;
}

// =============================================
// Pregunta del día: cuándo sale la siguiente
// =============================================

/**
 * Misma regla que el bot (server/bot/services/dailyQuestion.ts): sale cuando la hora local llega a
 * `dailyQuestionHour` y aún no hubo pregunta hoy. Si ya pasó la hora y no ha salido, sale en el
 * próximo minuto (devolvemos "ahora"). null si está apagada o no tiene canal.
 */
export function nextDailyQuestionAt(row: GuildRow | null | undefined, now: Date = new Date()): Date | null {
  if (!row?.dailyQuestionEnabled || !row.dailyQuestionChannelId) return null;

  const timezone = resolveTimezone(row.timezone);
  const hour = row.dailyQuestionHour ?? DEFAULT_DAILY_QUESTION_HOUR;
  const local = getZonedParts(now, timezone);
  const postedToday = row.dailyQuestionLastPosted === getLocalDateString(now, timezone);

  if (!postedToday && local.hour >= hour) return now;

  const day = new Date(Date.UTC(local.year, local.month - 1, local.day + (postedToday ? 1 : 0)));
  const year = day.getUTCFullYear();
  const month = day.getUTCMonth() + 1;
  const date = day.getUTCDate();
  // Si esa hora no existe ese día (cambio de horario), el bot publica en cuanto pasa: probamos la siguiente
  for (let candidate = hour; candidate <= 23; candidate++) {
    const at = zonedTimeToDate(year, month, date, candidate, 0, timezone);
    if (at) return at;
  }
  return null;
}

// =============================================
// Conversión a los tipos de shared/api.ts
// =============================================

/**
 * ¿Sigue vigente? Un mute es un aislamiento de Discord que se quita solo al pasar su duración
 * (Discord no avisa al bot), así que desde entonces cuenta como terminado.
 */
function isActionActive(action: ModerationActionWithUsers["action"], now = Date.now()): boolean {
  if (!action.active) return false;
  if (action.type === "mute" && action.duration && action.createdAt) {
    return action.createdAt.getTime() + action.duration * 60_000 > now;
  }
  return true;
}

export function toModerationActionItem(row: ModerationActionWithUsers): ModerationActionItem {
  const { action } = row;
  return {
    id: action.id,
    type: action.type,
    reason: action.reason ?? null,
    duration: action.duration ?? null,
    active: isActionActive(action),
    createdAt: toIso(action.createdAt),
    user: row.user,
    moderator: row.moderator,
  };
}

function raidDetails(event: RaidEvent): RaidEventDetails {
  const details = event.details;
  return details && typeof details === "object" && !Array.isArray(details) ? (details as RaidEventDetails) : {};
}

/** ¿Es el evento del modo raid que está activo ahora? (mismo liftAt que guardó el bot al empezarlo) */
export function isActiveRaidEvent(event: RaidEvent): boolean {
  if (event.resolved) return false;
  const active = getActiveRaid(event.guildId);
  return !!active && raidDetails(event).liftAt === active.liftAt;
}

function msToIso(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * Revisión desde el panel: details.reviewedAt/reviewedBy. Los eventos de antes de existir ese campo
 * que se cerraron desde el panel solo traen resolvedAt/resolvedBy sin liftedAt (los que cerró el bot
 * siempre traen liftedAt), y también cuentan como revisados.
 * Misma regla que raidEventReviewedSql en server/storage.ts (filtro ?status=unreviewed).
 */
export function raidEventReview(event: RaidEvent): { reviewed: boolean; reviewedAt: string | null; reviewedBy: string | null } {
  const details = raidDetails(event);
  if (typeof details.reviewedAt === "number") {
    return {
      reviewed: true,
      reviewedAt: msToIso(details.reviewedAt),
      reviewedBy: typeof details.reviewedBy === "string" ? details.reviewedBy : null,
    };
  }
  if (typeof details.resolvedAt === "number" && typeof details.liftedAt !== "number") {
    return {
      reviewed: true,
      reviewedAt: msToIso(details.resolvedAt),
      reviewedBy: typeof details.resolvedBy === "string" ? details.resolvedBy : null,
    };
  }
  return { reviewed: false, reviewedAt: null, reviewedBy: null };
}

export function toRaidEventItem(event: RaidEvent): RaidEventItem {
  const details = raidDetails(event);
  const resolved = event.resolved ?? false;
  return {
    id: event.id,
    type: event.type,
    severity: event.severity,
    resolved,
    isActive: isActiveRaidEvent(event),
    createdAt: toIso(event.createdAt),
    // Los eventos cerrados antes de guardar resolvedAt solo tienen liftedAt
    resolvedAt: resolved ? msToIso(details.resolvedAt) ?? msToIso(details.liftedAt) : null,
    ...raidEventReview(event),
    details,
  };
}

// =============================================
// Acciones con espera (para que un doble clic no publique dos veces)
// =============================================

const actionCooldowns = new Map<string, number>();

/**
 * Si la acción `key` se usó hace menos de `ms`, responde 429 con los segundos que faltan y devuelve false.
 * Si no, la marca como usada y devuelve true.
 */
export function takeActionSlot(res: Response, key: string, ms: number, message: string): boolean {
  const now = Date.now();
  const until = actionCooldowns.get(key) ?? 0;
  if (until > now) {
    const retryAfterSeconds = Math.ceil((until - now) / 1000);
    res.status(429).json({ error: `${message} Espera ${retryAfterSeconds} s.`, retryAfterSeconds });
    return false;
  }
  actionCooldowns.set(key, now + ms);
  if (actionCooldowns.size > 1000) {
    actionCooldowns.forEach((expiry, entry) => {
      if (expiry <= now) actionCooldowns.delete(entry);
    });
  }
  return true;
}

/** Libera la espera si la acción falló (para poder reintentar enseguida). */
export function releaseActionSlot(key: string): void {
  actionCooldowns.delete(key);
}
