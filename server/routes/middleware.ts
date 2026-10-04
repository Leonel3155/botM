import type { NextFunction, Request, Response } from "express";
import type { IncomingHttpHeaders } from "http";
import type { Session, SessionData } from "express-session";
import type { Guild as DiscordGuild, GuildBasedChannel } from "discord.js";
import { z } from "zod";
import { bot } from "../bot/index";
import { storage } from "../storage";

// =============================================
// SESIÓN: qué guardamos (solo lo necesario)
// =============================================
export interface SessionUser {
  id: string;
  username: string;
  globalName: string | null;
  avatar: string | null;
}

declare module "express-session" {
  interface SessionData {
    authenticated?: boolean;
    /** Sesión creada con /auth/dev-login (solo válida en modo desarrollo) */
    devBypass?: boolean;
    user?: SessionUser;
    /** Access token OAuth de Discord (scopes: identify guilds) */
    discordToken?: string;
    /** Momento (ms) en que caduca el access token de Discord */
    discordTokenExpiresAt?: number;
  }
}

export type AppSession = Session & Partial<SessionData>;

export const SESSION_COOKIE_NAME = "connect.sid";

/**
 * El acceso de desarrollo (/auth/dev-login) SOLO funciona con DEV_BYPASS_AUTH=1
 * y NODE_ENV=development. En producción (o sin NODE_ENV) queda desactivado
 * aunque la variable esté puesta. Se revisa en cada petición, así que una
 * sesión de desarrollo deja de valer en cuanto se desactiva el modo.
 */
export function isDevBypassEnabled(): boolean {
  return process.env.DEV_BYPASS_AUTH === "1" && process.env.NODE_ENV === "development";
}

export function isSessionAuthenticated(session: Partial<SessionData> | null | undefined): boolean {
  if (!session?.authenticated || !session.user?.id) return false;
  if (session.devBypass) return isDevBypassEnabled();
  if (!session.discordToken) return false;
  if (session.discordTokenExpiresAt && Date.now() >= session.discordTokenExpiresAt) return false;
  return true;
}

export function isDevSession(session: Partial<SessionData> | null | undefined): boolean {
  return !!session?.devBypass && isSessionAuthenticated(session);
}

// =============================================
// Fin de una sesión (logout, nuevo login, token caducado o revocado)
// =============================================
type SessionEndedListener = (sessionId: string) => void;
const sessionEndedListeners = new Set<SessionEndedListener>();

/** Avísame cuando una sesión deje de ser válida (lo usa el WebSocket para cerrar sus conexiones). */
export function onSessionEnded(listener: SessionEndedListener): () => void {
  sessionEndedListeners.add(listener);
  return () => {
    sessionEndedListeners.delete(listener);
  };
}

/**
 * Esa sesión ya no vale: olvidamos su caché de servidores y avisamos a quien
 * tenga algo abierto con ella (las conexiones del WebSocket se cierran con 4401).
 */
export function endSession(sessionId: string | undefined): void {
  if (!sessionId) return;
  forgetUserGuilds(sessionId);
  sessionEndedListeners.forEach((listener) => {
    try {
      listener(sessionId);
    } catch (error) {
      console.error("[AUTH] Error al cerrar las conexiones de una sesión:", error);
    }
  });
}

/** Quita los datos de login de la sesión (token caducado/revocado, modo dev desactivado...). */
export function clearSessionAuth(session: AppSession | null | undefined): void {
  if (!session) return;
  endSession(session.id);
  delete session.authenticated;
  delete session.devBypass;
  delete session.user;
  delete session.discordToken;
  delete session.discordTokenExpiresAt;
}

export function authRequiredBody(error = "Necesitas iniciar sesión con Discord para usar el panel.") {
  return { error, requireAuth: true, authUrl: "/api/auth/discord" };
}

// =============================================
// requireAuth
// =============================================
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (isSessionAuthenticated(req.session)) {
    return next();
  }
  // Sesión que estaba logueada pero ya no es válida: la limpiamos
  if (req.session?.authenticated) {
    clearSessionAuth(req.session);
  }
  return res.status(401).json(authRequiredBody());
}

// =============================================
// Servidores del usuario (Discord) con caché por sesión
// =============================================
export interface DiscordPartialGuild {
  id: string;
  name: string;
  icon: string | null;
  owner: boolean;
  permissions: string;
}

/** El token ya no sirve (401/403 de Discord): hay que volver a iniciar sesión. */
export class DiscordAuthError extends Error {}

/** Discord no respondió bien (rate limit, caída, respuesta rara). */
export class DiscordUnavailableError extends Error {
  constructor(message: string, public status: number, public retryAfter?: number) {
    super(message);
  }
}

const DISCORD_API = "https://discord.com/api/v10";
const GUILD_CACHE_TTL_MS = 60_000;
// Si Discord falla o nos limita, aceptamos la última lista si no es muy vieja
const GUILD_CACHE_STALE_MS = 5 * 60_000;
const GUILD_CACHE_MAX_ENTRIES = 500;

interface GuildCacheEntry {
  token: string;
  fetchedAt: number;
  guilds: DiscordPartialGuild[];
}

const guildCache = new Map<string, GuildCacheEntry>();
const pendingGuildFetches = new Map<string, Promise<DiscordPartialGuild[]>>();

export function forgetUserGuilds(sessionId: string | undefined): void {
  if (!sessionId) return;
  guildCache.delete(sessionId);
}

function pruneGuildCache() {
  if (guildCache.size <= GUILD_CACHE_MAX_ENTRIES) return;
  const now = Date.now();
  guildCache.forEach((entry, key) => {
    if (now - entry.fetchedAt > GUILD_CACHE_STALE_MS) guildCache.delete(key);
  });
}

async function fetchDiscordUserGuilds(token: string): Promise<DiscordPartialGuild[]> {
  const response = await fetch(`${DISCORD_API}/users/@me/guilds`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10_000),
  });

  if (response.status === 401 || response.status === 403) {
    throw new DiscordAuthError(`Discord rechazó el token (${response.status})`);
  }
  if (response.status === 429) {
    const body = await response.json().catch(() => null);
    const retryAfter = typeof body?.retry_after === "number" ? body.retry_after : undefined;
    throw new DiscordUnavailableError("Discord está limitando las solicitudes", 429, retryAfter);
  }
  if (!response.ok) {
    throw new DiscordUnavailableError(`Discord respondió ${response.status}`, response.status);
  }

  const data: unknown = await response.json();
  if (!Array.isArray(data)) {
    throw new DiscordUnavailableError("Respuesta inesperada de Discord", 502);
  }

  return data.map((g: any) => ({
    id: String(g.id),
    name: String(g.name ?? ""),
    icon: typeof g.icon === "string" ? g.icon : null,
    owner: g.owner === true,
    permissions: String(g.permissions ?? "0"),
  }));
}

/**
 * Lista de servidores del usuario logueado (GET /users/@me/guilds), cacheada
 * ~60 s por sesión y con peticiones simultáneas deduplicadas para no chocar
 * con el rate limit de Discord.
 */
export async function getUserGuilds(session: AppSession): Promise<DiscordPartialGuild[]> {
  const token = session.discordToken;
  if (!token) {
    throw new DiscordAuthError("La sesión no tiene token de Discord");
  }

  const key = session.id;
  const cached = guildCache.get(key);
  if (cached && cached.token === token && Date.now() - cached.fetchedAt < GUILD_CACHE_TTL_MS) {
    return cached.guilds;
  }

  const pending = pendingGuildFetches.get(key);
  if (pending) return pending;

  const request = (async () => {
    try {
      const guilds = await fetchDiscordUserGuilds(token);
      guildCache.set(key, { token, fetchedAt: Date.now(), guilds });
      pruneGuildCache();
      return guilds;
    } catch (error) {
      if (error instanceof DiscordAuthError) {
        guildCache.delete(key);
        throw error;
      }
      if (cached && cached.token === token && Date.now() - cached.fetchedAt < GUILD_CACHE_STALE_MS) {
        console.warn("[AUTH] Discord no respondió; usando la lista de servidores en caché:", (error as Error).message);
        return cached.guilds;
      }
      throw error;
    } finally {
      pendingGuildFetches.delete(key);
    }
  })();

  pendingGuildFetches.set(key, request);
  return request;
}

const ADMINISTRATOR = BigInt(0x8);
const MANAGE_GUILD = BigInt(0x20);

/** Dueño, o permiso de Administrador (0x8) o Gestionar servidor (0x20). */
export function canManageGuild(guild: DiscordPartialGuild): boolean {
  if (guild.owner) return true;
  try {
    const permissions = BigInt(guild.permissions);
    return (permissions & ADMINISTRATOR) === ADMINISTRATOR || (permissions & MANAGE_GUILD) === MANAGE_GUILD;
  } catch {
    return false;
  }
}

interface ErrorResult {
  status: number;
  body: Record<string, unknown>;
}

/** Convierte un error al consultar Discord en una respuesta HTTP (y limpia la sesión si el token ya no vale). */
export function discordErrorResult(session: AppSession | null | undefined, error: unknown): ErrorResult {
  if (error instanceof DiscordAuthError) {
    clearSessionAuth(session);
    return { status: 401, body: authRequiredBody("Tu sesión de Discord expiró o fue revocada. Vuelve a iniciar sesión.") };
  }
  if (error instanceof DiscordUnavailableError && error.status === 429) {
    return {
      status: 503,
      body: {
        error: "Discord está limitando las solicitudes. Intenta de nuevo en unos segundos.",
        retryAfter: error.retryAfter ?? null,
      },
    };
  }
  console.error("[AUTH] Error consultando Discord:", error);
  return {
    status: 502,
    body: { error: "No pudimos verificar tus permisos con Discord. Intenta de nuevo en un momento." },
  };
}

// =============================================
// requireGuildAdmin
// =============================================
const SNOWFLAKE_REGEX = /^\d{17,20}$/;

export function isSnowflake(value: unknown): value is string {
  return typeof value === "string" && SNOWFLAKE_REGEX.test(value);
}

export const snowflakeSchema = z.string().regex(SNOWFLAKE_REGEX, "El ID de Discord no es válido.");

export type GuildAccessResult =
  | { ok: true; guild: DiscordPartialGuild | null }
  | ({ ok: false } & ErrorResult);

/**
 * ¿Puede esta sesión administrar el servidor guildId? Lo usan las rutas HTTP
 * (requireGuildAdmin) y el WebSocket.
 */
export async function checkGuildAccess(
  session: AppSession | null | undefined,
  guildId: unknown,
): Promise<GuildAccessResult> {
  if (!isSnowflake(guildId)) {
    return { ok: false, status: 400, body: { error: "El ID del servidor no es válido." } };
  }
  if (!session || !isSessionAuthenticated(session)) {
    if (session?.authenticated) clearSessionAuth(session);
    return { ok: false, status: 401, body: authRequiredBody() };
  }

  // Modo desarrollo: el usuario de prueba puede ver cualquier servidor
  if (isDevSession(session)) {
    return { ok: true, guild: null };
  }

  try {
    const guilds = await getUserGuilds(session);
    const guild = guilds.find((g) => g.id === guildId);
    if (!guild || !canManageGuild(guild)) {
      return {
        ok: false,
        status: 403,
        body: {
          error: "No tienes permiso para administrar este servidor. Necesitas ser el dueño o tener el permiso de Administrador o Gestionar servidor.",
          forbidden: true,
        },
      };
    }
    return { ok: true, guild };
  } catch (error) {
    return { ok: false, ...discordErrorResult(session, error) };
  }
}

/** Solo deja pasar si el usuario administra el servidor de :guildId. Usar después de requireAuth. */
export async function requireGuildAdmin(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await checkGuildAccess(req.session, req.params.guildId);
    if (!result.ok) {
      return res.status(result.status).json(result.body);
    }
    res.locals.discordGuild = result.guild;
    return next();
  } catch (error) {
    return next(error);
  }
}

// =============================================
// requireBotInGuild: para rutas que usan datos del bot
// =============================================
export function requireBotInGuild(req: Request, res: Response, next: NextFunction) {
  if (!bot.client.isReady()) {
    return res.status(503).json({ error: "El bot no está conectado en este momento. Intenta de nuevo en unos segundos." });
  }
  const guild = bot.client.guilds.cache.get(req.params.guildId);
  if (!guild) {
    return res.status(404).json({
      error: "El bot no está en este servidor. Invítalo primero para poder configurarlo.",
      botMissing: true,
    });
  }
  res.locals.botGuild = guild;
  return next();
}

/** Servidor de discord.js que dejó requireBotInGuild. */
export function getBotGuild(res: Response): DiscordGuild {
  return res.locals.botGuild as DiscordGuild;
}

export function isBotInGuild(guildId: string): boolean {
  return bot.client.isReady() && bot.client.guilds.cache.has(guildId);
}

/** Canal de texto que pertenece a ese servidor (para no configurar canales de otro servidor). */
export function findGuildTextChannel(guild: DiscordGuild, channelId: string): GuildBasedChannel | null {
  const channel = guild.channels.cache.get(channelId);
  return channel && channel.isTextBased() ? channel : null;
}

/** Crea la fila del servidor en la BD si aún no existe, con los datos reales del bot. */
export async function ensureGuildRow(guild: DiscordGuild): Promise<void> {
  await storage.ensureGuild(guild.id, guild.name, guild.ownerId);
}

// =============================================
// Origen de la petición (CSRF / WebSocket hijacking)
// =============================================
function hostOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

/**
 * Sin cabecera Origin (curl, navegación normal) se permite; si viene, tiene que
 * ser el propio panel (APP_URL, FRONTEND_URL o el mismo host de la petición).
 */
export function isAllowedOrigin(origin: string | undefined, headers: IncomingHttpHeaders): boolean {
  if (!origin) return true;
  const originHost = hostOf(origin);
  if (!originHost) return false;

  const allowed = new Set<string>();
  for (const url of [process.env.APP_URL, process.env.FRONTEND_URL]) {
    const host = hostOf(url);
    if (host) allowed.add(host);
  }
  if (headers.host) allowed.add(headers.host);
  const forwardedHost = headers["x-forwarded-host"];
  if (typeof forwardedHost === "string" && forwardedHost) {
    allowed.add(forwardedHost.split(",")[0].trim());
  }

  return allowed.has(originHost);
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Rechaza escrituras (POST/PUT/PATCH/DELETE) que vengan de otro sitio. */
export function rejectCrossSiteWrites(req: Request, res: Response, next: NextFunction) {
  if (SAFE_METHODS.has(req.method) || isAllowedOrigin(req.headers.origin, req.headers)) {
    return next();
  }
  console.warn(`[SECURITY] Escritura bloqueada desde origen no permitido: ${req.headers.origin} ${req.method} ${req.originalUrl}`);
  return res.status(403).json({ error: "Origen no permitido." });
}

// =============================================
// Validación de cuerpos con zod (mensajes en español)
// =============================================
const spanishErrorMap: z.ZodErrorMap = (issue, ctx) => {
  const field = issue.path.length ? `"${issue.path.join(".")}"` : "de la solicitud";
  switch (issue.code) {
    case z.ZodIssueCode.invalid_type:
      if (issue.received === "undefined") {
        return { message: `Falta el campo ${field}.` };
      }
      return { message: `El campo ${field} tiene un tipo inválido (se esperaba ${issue.expected}).` };
    case z.ZodIssueCode.unrecognized_keys:
      return { message: `Campos no permitidos: ${issue.keys.join(", ")}.` };
    case z.ZodIssueCode.invalid_enum_value:
    case z.ZodIssueCode.invalid_literal:
    case z.ZodIssueCode.invalid_union_discriminator:
      return { message: `El valor del campo ${field} no es válido.` };
    case z.ZodIssueCode.too_small:
    case z.ZodIssueCode.too_big:
      return { message: `El campo ${field} está fuera del rango permitido.` };
    default:
      return { message: issue.message ?? ctx.defaultError };
  }
};

/**
 * Valida req.body con el esquema. Si no es válido responde 400 y devuelve null.
 * Los esquemas de escritura usan .strict(): campos desconocidos (como un
 * guildId en el cuerpo) se rechazan; el servidor siempre sale de la URL.
 */
export function parseBody<T extends z.ZodTypeAny>(schema: T, req: Request, res: Response): z.output<T> | null {
  const result = schema.safeParse(req.body ?? {}, { errorMap: spanishErrorMap });
  if (result.success) {
    return result.data;
  }
  const issues = result.error.issues.map((issue) => ({
    field: issue.path.join("."),
    message: issue.message,
  }));
  res.status(400).json({
    error: issues[0]?.message ?? "Los datos enviados no son válidos.",
    details: issues,
  });
  return null;
}

/** ?limit=N acotado a [1, max]; si no es un número válido se usa el valor por defecto. */
export function parseLimit(value: unknown, defaultValue: number, max: number): number {
  const parsed = typeof value === "string" ? Number.parseInt(value, 10) : NaN;
  if (!Number.isFinite(parsed) || parsed < 1) return defaultValue;
  return Math.min(parsed, max);
}
