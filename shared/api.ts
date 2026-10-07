// Tipos de la API del panel: la única fuente de verdad para el servidor (server/routes*) y el panel (client/src).
// Este archivo no importa nada del servidor, así que el cliente lo puede usar sin problema.
// Convención: las fechas viajan como texto ISO 8601 en UTC (IsoDateString).

import type {
  AntiRaidAction,
  AntiRaidSettings,
  ContentFeed,
  Guild,
  UserEconomy,
  UserLevel,
} from "./schema";

// =============================================
// Utilidades
// =============================================

/** Fecha en formato ISO 8601 (UTC), p. ej. "2026-10-04T18:00:00.000Z". */
export type IsoDateString = string;

/** Lo que llega por JSON de un tipo con fechas (Date → string). */
export type Jsonify<T> = T extends Date
  ? string
  : T extends (infer U)[]
    ? Jsonify<U>[]
    : T extends object
      ? { [K in keyof T]: Jsonify<T[K]> }
      : T;

/** Cuerpo de cualquier respuesta de error (4xx / 5xx). */
export interface ApiErrorBody {
  /** Mensaje en español, listo para mostrar. */
  error: string;
  /** Errores de validación por campo (400). */
  details?: { field: string; message: string }[];
  /** 401: hay que iniciar sesión otra vez (authUrl lleva al login de Discord). */
  requireAuth?: boolean;
  authUrl?: string;
  /** 403: no administras ese servidor. */
  forbidden?: boolean;
  /** 404: el bot no está en ese servidor. */
  botMissing?: boolean;
  /** 503: Discord limitó las peticiones (segundos sugeridos por Discord). */
  retryAfter?: number | null;
  /** 429: segundos que faltan para poder repetir la acción (pruebas del panel). */
  retryAfterSeconds?: number;
}

export interface SuccessResponse {
  success: true;
}

/** Página de resultados: pide la siguiente con ?before=<nextCursor>. null = no hay más. */
export interface Paged {
  nextCursor: string | null;
}

/** Usuario de Discord tal como lo conoce la base de datos (username null si nunca lo vimos). */
export interface UserRef {
  id: string;
  username: string | null;
  avatar: string | null;
}

// =============================================
// Autenticación y servidores del usuario
// =============================================

export interface SessionUserInfo {
  id: string;
  username: string;
  globalName: string | null;
  avatar: string | null;
}

/** GET /api/auth/status */
export interface AuthStatusResponse {
  authenticated: boolean;
  user: SessionUserInfo | null;
  sessionExtended: boolean;
  /** Segundos hasta que caduca la sesión si no hay actividad. */
  expiresIn: number;
  /** Solo con el acceso de desarrollo (DEV_BYPASS_AUTH). */
  devMode?: boolean;
}

/** Elemento de GET /api/user/guilds (solo servidores que el usuario puede administrar). */
export interface UserGuildItem {
  id: string;
  name: string;
  icon: string | null;
  owner: boolean;
  permissions: string;
  botInGuild: boolean;
  /**
   * El bot está conectado a Discord ahora mismo. Si es false no se sabe en qué servidores está
   * (botInGuild llega en false): el panel debe decir "bot desconectado", no "invita al bot".
   */
  botOnline: boolean;
}
export type UserGuildsResponse = UserGuildItem[];

// =============================================
// Configuración general del servidor
// =============================================

/** GET /api/guild/:guildId/config */
export interface GuildConfigResponse {
  prefix: string;
  levelUpMessages: boolean;
  economyEnabled: boolean;
  antiRaidEnabled: boolean;
}
/** PUT /api/guild/:guildId/config (prefijo: 1-5 caracteres, sin espacios) */
export type GuildConfigUpdateRequest = Partial<GuildConfigResponse>;

/** GET /api/guilds/:guildId: la fila completa del servidor en la base de datos. */
export type GuildRowResponse = Jsonify<Guild>;

/** PUT /api/guilds/:guildId/settings (se mezcla con guilds.settings) */
export interface GuildSettingsUpdateRequest {
  levelSystem?: {
    enabled: boolean;
    /** [mínimo, máximo] de XP por mensaje (0-1000). */
    xpPerMessage: [number, number];
    voiceMultiplier: number;
    announcements: boolean;
  };
  economy?: {
    enabled: boolean;
    dailyReward: number;
    workCooldown: number;
  };
  moderation?: {
    automod: boolean;
    spamDetection: boolean;
    linkFiltering: boolean;
  };
}

// =============================================
// Canales y roles de Discord
// =============================================

/** GET /api/guild/:guildId/channels */
export interface ChannelConfigResponse {
  contentChannelId: string | null;
  moderationChannelId: string | null;
  welcomeChannelId: string | null;
  redditEnabled: boolean;
  twitterEnabled: boolean;
}
/** PUT /api/guild/:guildId/channels ("" o null = sin canal) */
export type ChannelConfigUpdateRequest = Partial<ChannelConfigResponse>;

export type DiscordChannelKind = "text" | "announcement" | "voice";

/** Elemento de GET /api/guild/:guildId/discord-channels (ordenados como en Discord). */
export interface DiscordChannelItem {
  id: string;
  name: string;
  type: DiscordChannelKind;
  category: string;
  /** El bot puede ver el canal y publicar mensajes con embeds (siempre false en canales de voz). */
  botCanPost: boolean;
}
export type DiscordChannelsResponse = DiscordChannelItem[];

/** Elemento de GET /api/guilds/:guildId/discord-roles (del más alto al más bajo, sin @everyone). */
export interface DiscordRoleItem {
  id: string;
  name: string;
  /** Color en "#rrggbb", o null si el rol no tiene color. */
  color: string | null;
  position: number;
  /** Lo administra una integración o un bot (no se puede asignar a mano). */
  managed: boolean;
  /** Se puede usar como rol automático de bienvenida (lo puede dar el bot y también tú). */
  assignable: boolean;
  /** Por qué no se puede usar (null si assignable). */
  reason: string | null;
}
export type DiscordRolesResponse = DiscordRoleItem[];

// =============================================
// Resumen (dashboard)
// =============================================

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  username: string | null;
  avatar: string | null;
  level: number;
  xp: number;
  totalXp: number;
}

export interface WealthEntry {
  rank: number;
  userId: string;
  username: string | null;
  avatar: string | null;
  wallet: number;
  bank: number;
  total: number;
}

export interface ModerationActionItem {
  id: string;
  /** warn, mute, unmute, kick, ban, clear, lockdown, unlock... (ver MODERATION_ACTION_LABELS) */
  type: string;
  reason: string | null;
  /** Minutos (solo acciones temporales como mute). */
  duration: number | null;
  /** La sanción sigue vigente (p. ej. un mute que no se ha quitado). */
  active: boolean;
  createdAt: IsoDateString | null;
  user: UserRef;
  moderator: UserRef;
}

/** GET /api/dashboard/:guildId/stats. Todo sale del bot o de la base de datos: nada inventado. */
export interface DashboardStatsResponse {
  guild: {
    id: string;
    name: string;
    icon: string | null;
    iconUrl: string | null;
    /** Miembros según el bot (null si el bot no está en el servidor o no está conectado). */
    memberCount: number | null;
    /** Miembros conectados según Discord (aproximado; null si no se pudo obtener). */
    onlineCount: number | null;
  };
  bot: {
    online: boolean;
    inGuild: boolean;
    /** Latencia con Discord en ms (null si aún no se mide). */
    pingMs: number | null;
    uptimeSeconds: number | null;
  };
  counts: {
    /** Personas con nivel en este servidor (escribieron al menos un mensaje). */
    usersWithLevels: number;
    /** Monedas en carteras + bancos. */
    coinsInCirculation: number;
    moderationActions7d: number;
    moderationActions30d: number;
    warnings30d: number;
    warningsTotal: number;
    raidEvents30d: number;
    customCommands: number;
  };
  /** Top 5 por nivel. */
  topLevels: LeaderboardEntry[];
  /** Las 5 acciones de moderación más recientes. */
  recentModeration: ModerationActionItem[];
  features: {
    welcome: { enabled: boolean; channelId: string | null };
    dailyQuestion: {
      enabled: boolean;
      channelId: string | null;
      hour: number;
      timezone: string;
      /** Próxima publicación (null si está apagada o sin canal). Si ya es la hora, sale en menos de un minuto. */
      nextPostAt: IsoDateString | null;
      /** Último día con pregunta, YYYY-MM-DD en la zona del servidor. */
      lastPosted: string | null;
    };
    antiRaid: {
      enabled: boolean;
      raidModeActive: boolean;
      raidModeEndsAt: IsoDateString | null;
    };
  };
  generatedAt: IsoDateString;
}

// =============================================
// Niveles y economía
// =============================================

/** GET /api/levels/:guildId/top?limit=1..100 (por defecto 10). Una entrada por persona, mismo orden que /lb en Discord. */
export type LevelsTopResponse = LeaderboardEntry[];
/** GET /api/levels/:guildId/user/:userId */
export type UserLevelResponse = Jsonify<UserLevel>;
/**
 * GET /api/economy/:guildId/top?limit=1..100 (por defecto 10): cartera + banco.
 * Una entrada por persona (la cuenta que usa el bot) y solo quien tiene monedas, igual que /leaderboard en Discord.
 */
export type EconomyTopResponse = WealthEntry[];
/** GET /api/economy/:guildId/user/:userId */
export type UserEconomyResponse = Jsonify<UserEconomy>;

// =============================================
// Actividad: bienvenida y pregunta del día
// =============================================

export const WELCOME_PLACEHOLDERS = [
  { key: "{usuario}", description: "Menciona a la persona que entró" },
  { key: "{nombre}", description: "Su nombre de usuario" },
  { key: "{servidor}", description: "El nombre del servidor" },
  { key: "{miembros}", description: "Cuántos miembros hay ahora" },
] as const;

export const WELCOME_MESSAGE_MAX_LENGTH = 1500;

export interface WelcomeSettings {
  enabled: boolean;
  channelId: string | null;
  /** null = mensaje predeterminado (defaultMessage). */
  message: string | null;
  /** Rol que se da automáticamente al entrar (null = ninguno). */
  roleId: string | null;
}

export interface DailyQuestionSettings {
  enabled: boolean;
  channelId: string | null;
  /** Hora local (0-23) en la zona del servidor. */
  hour: number;
  /** Zona horaria IANA, p. ej. "America/Mexico_City". También la usa /evento. */
  timezone: string;
  /** Abrir un hilo para las respuestas. */
  thread: boolean;
}

/** GET /api/guilds/:guildId/engagement */
export interface EngagementSettingsResponse {
  welcome: WelcomeSettings & {
    defaultMessage: string;
    /** Problema actual con el canal (permisos, borrado...), o null si todo bien / no se pudo revisar. */
    channelProblem: string | null;
    roleProblem: string | null;
  };
  dailyQuestion: DailyQuestionSettings & {
    /** Último día con pregunta, YYYY-MM-DD en la zona del servidor. */
    lastPosted: string | null;
    /** Preguntas publicadas en total. */
    postedCount: number;
    /** Cuántas faltan antes de empezar a repetir. */
    remainingInCycle: number;
    totalQuestions: number;
    nextPostAt: IsoDateString | null;
    channelProblem: string | null;
    /** Aviso si se pidió hilo pero el bot no puede crearlo en ese canal. */
    threadProblem: string | null;
  };
  /** false: el bot no está en el servidor o no está conectado (los *Problem quedan en null). */
  botInGuild: boolean;
}

/**
 * PATCH /api/guilds/:guildId/engagement. Manda solo lo que cambió.
 * channelId / roleId / message: null (o "") para quitarlos. timezone acepta atajos como "CDMX".
 */
export interface EngagementUpdateRequest {
  welcome?: Partial<WelcomeSettings>;
  dailyQuestion?: Partial<DailyQuestionSettings>;
}
export type EngagementUpdateResponse = EngagementSettingsResponse & {
  /** Avisos que no impidieron guardar (p. ej. falta un permiso en el canal). */
  warnings: string[];
};

/** POST /api/guilds/:guildId/engagement/test-welcome (cuerpo vacío). Publica una bienvenida de prueba contigo. */
export interface TestWelcomeResponse {
  success: true;
  channelId: string;
  messageUrl: string;
}

/** POST /api/guilds/:guildId/engagement/post-question-now (cuerpo vacío). Cuenta como la pregunta de hoy. */
export interface PostQuestionNowResponse {
  success: true;
  channelId: string;
  messageUrl: string;
  questionNumber: number;
}

// =============================================
// Seguridad: anti-raid
// =============================================

/** Límites de cada ajuste (iguales a los del bot). */
export const ANTI_RAID_LIMITS = {
  joinThreshold: { min: 3, max: 100 },
  joinWindowSeconds: { min: 5, max: 300 },
  minAccountAgeDays: { min: 0, max: 365 },
  lockdownMinutes: { min: 1, max: 1440 },
} as const;

export interface ActiveRaidInfo {
  action: AntiRaidAction;
  startedAt: IsoDateString;
  endsAt: IsoDateString;
  joinsDuringRaid: number;
  kicked: number;
}

/** GET /api/guilds/:guildId/antiraid */
export interface AntiRaidResponse {
  config: AntiRaidSettings;
  actions: { value: AntiRaidAction; label: string }[];
  /** Modo raid en curso (null = todo tranquilo). */
  activeRaid: ActiveRaidInfo | null;
}

/** PATCH /api/guilds/:guildId/antiraid. logChannelId null = automático. Desactivar también termina el modo raid. */
export type AntiRaidUpdateRequest = Partial<AntiRaidSettings>;
export type AntiRaidUpdateResponse = AntiRaidResponse & {
  warnings: string[];
  /** Se terminó un modo raid activo al desactivar la protección. */
  liftedRaid: boolean;
};

/** POST /api/guilds/:guildId/antiraid/lift (cuerpo vacío): termina ya el modo raid activo. */
export interface AntiRaidLiftResponse {
  success: true;
  /** false si no había ningún modo raid activo. */
  lifted: boolean;
}

/** Datos que el bot guarda en cada evento (todos opcionales: dependen del tipo y de la versión). */
export interface RaidEventDetails {
  joins?: number;
  windowSeconds?: number;
  threshold?: number;
  newAccounts?: number;
  userIds?: string[];
  action?: AntiRaidAction;
  /** Cuándo terminaba el modo raid (ms). */
  liftAt?: number;
  kickedAtStart?: number;
  joinsDuringRaid?: number;
  kicked?: number;
  /** Cuándo terminó (ms) y quién: "auto", "restart" o el ID de un usuario. */
  liftedAt?: number;
  liftedBy?: string;
  /**
   * Cuándo se cerró el evento (ms) y quién: el ID de un usuario, "auto" o "restart".
   * Lo escribe cualquier cierre (fin del modo raid, /antiraid levantar, el panel o un reinicio).
   * Eventos viejos cerrados desde el panel solo traen resolvedAt/resolvedBy (sin liftedAt).
   */
  resolvedAt?: number;
  resolvedBy?: string;
  /** Cuándo (ms) y quién (ID de Discord) lo marcó como revisado desde el panel. */
  reviewedAt?: number;
  reviewedBy?: string;
  [key: string]: unknown;
}

export interface RaidEventItem {
  id: string;
  /** join_spam (ráfaga de entradas) por ahora. */
  type: string;
  severity: "low" | "medium" | "high" | string;
  resolved: boolean;
  /** Es el modo raid que está activo ahora mismo. */
  isActive: boolean;
  createdAt: IsoDateString | null;
  /** Cuándo se cerró (null si sigue abierto o no se sabe). */
  resolvedAt: IsoDateString | null;
  /** Alguien del staff lo marcó como revisado desde el panel (esté cerrado o no). */
  reviewed: boolean;
  reviewedAt: IsoDateString | null;
  /** ID de Discord de quien lo revisó (null si no se sabe). */
  reviewedBy: string | null;
  details: RaidEventDetails;
}

/**
 * Filtros de ?status= del historial de raids:
 * all (todos), open (sin cerrar), resolved (cerrados), unreviewed (nadie los ha revisado, cerrados o no).
 */
export const RAID_EVENT_STATUS_FILTERS = ["all", "open", "resolved", "unreviewed"] as const;
export type RaidEventStatusFilter = (typeof RAID_EVENT_STATUS_FILTERS)[number];

/** GET /api/guilds/:guildId/raid-events?status=all|open|resolved|unreviewed&limit=1..100&before=<cursor> */
export interface RaidEventsResponse extends Paged {
  events: RaidEventItem[];
}

/**
 * POST /api/guilds/:guildId/raid-events/:eventId/resolve (cuerpo vacío).
 * Lo marca como revisado (aunque ya estuviera cerrado), lo cierra si seguía abierto y,
 * si es el modo raid activo, lo termina.
 */
export interface RaidEventResolveResponse {
  success: true;
  event: RaidEventItem;
  liftedRaid: boolean;
}

// =============================================
// Moderación
// =============================================

export const MODERATION_ACTION_LABELS: Record<string, string> = {
  warn: "Advertencia",
  mute: "Silencio",
  unmute: "Fin del silencio",
  kick: "Expulsión",
  ban: "Baneo",
  unban: "Desbaneo",
  clear: "Borrado de mensajes",
  lockdown: "Canal bloqueado",
  unlock: "Canal desbloqueado",
};

/** GET /api/moderation/:guildId/actions?type=&userId=&moderatorId=&limit=1..100&before=<cursor> */
export interface ModerationActionsQuery {
  type?: string;
  /** Persona sancionada (ID de Discord). */
  userId?: string;
  /** Quien aplicó la acción (ID de Discord). */
  moderatorId?: string;
  limit?: number;
  before?: string;
}
export interface ModerationActionsResponse extends Paged {
  actions: ModerationActionItem[];
}

// =============================================
// Comandos personalizados
// =============================================

export const CUSTOM_COMMAND_LIMITS = {
  maxPerGuild: 50,
  nameMaxLength: 32,
  /** Minúsculas, números, "-" y "_". */
  namePattern: "^[a-z0-9_-]+$",
  descriptionMaxLength: 100,
  responseMaxLength: 2000,
  /** Segundos que espera cada persona entre un comando personalizado y otro. */
  cooldownSeconds: 5,
} as const;

export const CUSTOM_COMMAND_PLACEHOLDERS = [
  { key: "{usuario}", description: "Menciona a quien usó el comando" },
  { key: "{nombre}", description: "Su nombre en el servidor (sin mención)" },
  { key: "{servidor}", description: "El nombre del servidor" },
  { key: "{canal}", description: "Menciona el canal donde se usó" },
  { key: "{miembros}", description: "Cuántos miembros hay ahora" },
] as const;

/**
 * Nombres que no se pueden usar: los comandos de prefijo que ya trae el bot (y sus variantes
 * en español), para que un comando personalizado nunca tape a uno del bot.
 */
export const RESERVED_CUSTOM_COMMAND_NAMES: readonly string[] = [
  // Comandos de prefijo actuales del bot
  "bal", "balance", "daily", "dep", "deposit", "with", "withdraw",
  "lv", "level", "lb", "leaderboard", "lot", "lottery", "col", "collection",
  "rank", "help", "commands",
  // Variantes en español y comandos de economía que podrían tener prefijo
  "ayuda", "comandos", "saldo", "dinero", "cartera", "banco", "diario", "depositar", "retirar",
  "nivel", "niveles", "top", "ranking", "rango", "clasificacion", "loteria", "coleccion",
  "perfil", "trabajar", "work", "robar", "rob", "crimen", "crime", "slut", "apostar", "slots",
  "blackjack", "ruleta", "dado", "tienda", "store", "shop", "comprar", "buy", "vender", "sell",
  "inventario", "inventory", "inv", "prestigio", "prestige", "pagar", "pay", "give", "dar",
  "xp", "xpinfo", "warnings", "advertencias",
];

export interface CustomCommandItem {
  id: string;
  /** Sin prefijo: se usa como <prefijo><name>, p. ej. "&reglas". */
  name: string;
  description: string | null;
  response: string;
  enabled: boolean;
  uses: number;
  /** ID de Discord de quien lo creó. */
  createdBy: string;
  createdAt: IsoDateString | null;
}

/** GET /api/custom-commands/:guildId */
export interface CustomCommandsResponse {
  commands: CustomCommandItem[];
  /** Prefijo actual del servidor (por defecto "&"). */
  prefix: string;
  maxCommands: number;
  reservedNames: readonly string[];
}

/** POST /api/custom-commands/:guildId (el nombre se pasa a minúsculas) */
export interface CustomCommandCreateRequest {
  name: string;
  response: string;
  description?: string | null;
}
/** PATCH /api/custom-commands/:guildId/:commandId */
export type CustomCommandUpdateRequest = Partial<CustomCommandCreateRequest & { enabled: boolean }>;
/** PATCH /api/custom-commands/:guildId/:commandId/toggle */
export interface CustomCommandToggleRequest {
  enabled: boolean;
}
/** Respuesta de POST, PATCH y toggle: el comando como quedó guardado. */
export type CustomCommandResponse = CustomCommandItem;

// =============================================
// Contenido automático (Reddit)
// =============================================

/** Límites de los feeds de contenido (los mismos para el servidor y el panel). */
export const CONTENT_FEED_LIMITS = {
  /** Feeds por servidor (cuentan también los de Twitter/X viejos). */
  maxPerGuild: 10,
  /** Nombre de subreddit válido, sin "r/": letras, números y "_" (úsalo con new RegExp). */
  subredditPattern: "^[A-Za-z0-9_]{2,21}$",
  subredditMinLength: 2,
  subredditMaxLength: 21,
  /** Minutos entre publicaciones. */
  postInterval: { min: 1, max: 1440 },
} as const;

export type ContentFeedItem = Jsonify<ContentFeed>;
/** GET /api/social/:guildId/feeds */
export type ContentFeedsResponse = ContentFeedItem[];

/** POST /api/social/:guildId/feeds (máximo CONTENT_FEED_LIMITS.maxPerGuild por servidor; Twitter/X aún no está disponible) */
export interface ContentFeedCreateRequest {
  source: "reddit";
  channelId: string;
  sourceConfig: { subreddit: string; filterNSFW?: boolean };
  /** Minutos entre publicaciones (CONTENT_FEED_LIMITS.postInterval). */
  postInterval: number;
}
/**
 * PATCH /api/social/:guildId/feeds/:feedId
 * Feeds viejos con source "twitter": solo aceptan { enabled: false } (400 con cualquier otro cambio);
 * se pueden borrar con DELETE.
 */
export interface ContentFeedUpdateRequest {
  channelId?: string;
  enabled?: boolean;
  postInterval?: number;
}
/** Respuesta de POST y PATCH: el feed como quedó guardado. */
export type ContentFeedResponse = ContentFeedItem;

// =============================================
// Analíticas (solo datos reales de la base de datos)
// =============================================

export interface LevelBucket {
  /** Texto para la gráfica, p. ej. "1-4" o "100+". */
  label: string;
  minLevel: number;
  /** null = sin tope. */
  maxLevel: number | null;
  users: number;
}

export interface ModerationDay {
  /** YYYY-MM-DD en la zona horaria del servidor. */
  date: string;
  total: number;
  byType: Record<string, number>;
}

/** GET /api/guilds/:guildId/analytics */
export interface AnalyticsResponse {
  timezone: string;
  /** Personas por rango de nivel (rangos vacíos incluidos, para graficar). */
  levelDistribution: LevelBucket[];
  /** Top 10 por monedas (cartera + banco). */
  topEarners: WealthEntry[];
  /** Últimos 30 días, del más viejo al más nuevo (días sin acciones con total 0). */
  moderationPerDay: ModerationDay[];
  moderationByType30d: Record<string, number>;
  totals: {
    usersWithLevels: number;
    usersWithEconomy: number;
    coinsInCirculation: number;
    moderationActions30d: number;
    raidEvents30d: number;
  };
  generatedAt: IsoDateString;
}

// =============================================
// Tiempo real (WebSocket /ws)
// =============================================

/** El cliente manda { type: "join", guildId } para recibir los avisos de ese servidor. */
export interface WsJoinMessage {
  type: "join";
  guildId: string;
}

/**
 * Avisos del servidor para el servidor de Discord al que el cliente se unió con "join".
 * Qué consultas refresca cada uno lo decide GUILD_INVALIDATIONS en client/src/lib/websocket.ts.
 */
export type WsServerMessage =
  | { type: "joined"; guildId: string }
  | { type: "error"; error: string; status?: number }
  | { type: "settingsUpdated" }
  | { type: "feedCreated" }
  | { type: "feedsUpdated" }
  | { type: "customCommandsUpdated" };
