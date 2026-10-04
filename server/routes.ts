import type { Express, Request, Response, NextFunction, RequestHandler } from "express";
import type { Store } from "express-session";
import { createServer, type IncomingMessage, type Server } from "http";
import type { Duplex } from "stream";
import type { Guild as DiscordGuild } from "discord.js";
import { WebSocketServer, WebSocket } from "ws";
import { storage } from "./storage";
import { z } from "zod";
import { bot } from "./bot/index";
import { setupAuthRoutes } from "./routes/auth";
import { setupChannelRoutes } from "./routes/channels";
import {
  type AppSession,
  requireAuth,
  requireGuildAdmin,
  requireBotInGuild,
  rejectCrossSiteWrites,
  getBotGuild,
  ensureGuildRow,
  findGuildTextChannel,
  getUserGuilds,
  canManageGuild,
  checkGuildAccess,
  discordErrorResult,
  isAllowedOrigin,
  isBotInGuild,
  isDevSession,
  isSessionAuthenticated,
  isSnowflake,
  onSessionEnded,
  parseBody,
  parseLimit,
  snowflakeSchema
} from "./routes/middleware";

interface WebSocketClient extends WebSocket {
  guildId?: string;
  userId?: string;
  /** Sesión con la que se abrió la conexión (para cerrarla al hacer logout o si caduca) */
  sessionId?: string;
  sessionStore?: Store;
  /** Respondió al último ping */
  isAlive?: boolean;
  /** Cuenta los "join" para que una respuesta vieja no pise a una nueva */
  joinSeq?: number;
}

// Petición HTTP del upgrade, ya con la sesión de express-session cargada
type SessionIncomingMessage = IncomingMessage & {
  session?: AppSession;
  sessionID?: string;
  sessionStore?: Store;
};

// Cada 30 s: ping a los WebSockets (los muertos se cierran) y repaso de que su sesión siga viva
const WS_HEARTBEAT_MS = 30_000;
// Protocolo con el que se conecta el cliente de HMR de Vite (solo en desarrollo)
const VITE_HMR_PROTOCOL = 'vite-hmr';

// Miembros y conectados de cada servidor: caché corta para no pedírselos a Discord en cada visita
const GUILD_COUNTS_TTL_MS = 60_000;

interface GuildCounts {
  fetchedAt: number;
  memberCount: number;
  presenceCount: number;
}

const guildCountsCache = new Map<string, GuildCounts>();
const pendingGuildCounts = new Map<string, Promise<GuildCounts>>();

/**
 * Pide los contadores aproximados del servidor con el cliente REST de discord.js
 * (respeta los rate limits y los Retry-After de Discord), como mucho una vez por
 * minuto y por servidor, y con las peticiones simultáneas agrupadas.
 */
async function getGuildCounts(guild: DiscordGuild): Promise<GuildCounts> {
  const cached = guildCountsCache.get(guild.id);
  if (cached && Date.now() - cached.fetchedAt < GUILD_COUNTS_TTL_MS) {
    return cached;
  }

  const pending = pendingGuildCounts.get(guild.id);
  if (pending) return pending;

  const request = (async () => {
    try {
      const fresh = await guild.fetch();
      const counts: GuildCounts = {
        fetchedAt: Date.now(),
        memberCount: fresh.approximateMemberCount ?? fresh.memberCount ?? 0,
        presenceCount: fresh.approximatePresenceCount ?? 0
      };
      guildCountsCache.set(guild.id, counts);
      return counts;
    } catch (error) {
      if (cached) {
        console.warn('[DASH] Discord no respondió; usando los contadores en caché:', (error as Error).message);
        return cached;
      }
      throw error;
    } finally {
      pendingGuildCounts.delete(guild.id);
    }
  })();

  pendingGuildCounts.set(guild.id, request);
  return request;
}

interface RegisterRoutesOptions {
  /** El mismo middleware de express-session que usa la app (para leer la sesión en el WebSocket) */
  sessionParser: RequestHandler;
}

// Todas las rutas con :guildId exigen sesión + permisos de administración en ese servidor.
// Las que usan datos del bot exigen además que el bot esté en el servidor.
const guildAdmin: RequestHandler[] = [requireAuth, requireGuildAdmin];
const guildAdminWithBot: RequestHandler[] = [requireAuth, requireGuildAdmin, requireBotInGuild];

// ===== Esquemas de validación de los cuerpos (zod) =====
const guildConfigSchema = z.object({
  prefix: z.string()
    .trim()
    .min(1, 'El prefijo debe tener entre 1 y 5 caracteres.')
    .max(5, 'El prefijo debe tener entre 1 y 5 caracteres.')
    .regex(/^\S+$/, 'El prefijo no puede tener espacios.'),
  levelUpMessages: z.boolean(),
  economyEnabled: z.boolean(),
  antiRaidEnabled: z.boolean()
}).partial().strict();

const guildSettingsSchema = z.object({
  levelSystem: z.object({
    enabled: z.boolean(),
    xpPerMessage: z.tuple([z.number().int().min(0).max(1000), z.number().int().min(0).max(1000)])
      .refine(([min, max]) => min <= max, 'El XP mínimo no puede ser mayor que el máximo.'),
    voiceMultiplier: z.number().min(0).max(10),
    announcements: z.boolean()
  }).strict().optional(),
  economy: z.object({
    enabled: z.boolean(),
    dailyReward: z.number().int().min(0).max(1_000_000_000),
    workCooldown: z.number().int().min(0).max(10_000_000)
  }).strict().optional(),
  moderation: z.object({
    automod: z.boolean(),
    spamDetection: z.boolean(),
    linkFiltering: z.boolean()
  }).strict().optional()
}).strict();

const postIntervalSchema = z.number().int().min(1).max(1440);

const contentFeedSchema = z.discriminatedUnion('source', [
  z.object({
    source: z.literal('reddit'),
    channelId: snowflakeSchema,
    sourceConfig: z.object({
      subreddit: z.string().regex(/^[A-Za-z0-9_]{2,21}$/, 'El nombre del subreddit no es válido.'),
      filterNSFW: z.boolean().optional()
    }).strict(),
    postInterval: postIntervalSchema
  }).strict(),
  z.object({
    source: z.literal('twitter'),
    channelId: snowflakeSchema,
    sourceConfig: z.object({
      username: z.string().regex(/^[A-Za-z0-9_]{1,15}$/, 'El usuario de Twitter no es válido.').optional()
    }).strict(),
    postInterval: postIntervalSchema
  }).strict()
]);

const lockdownSchema = z.object({
  enabled: z.boolean(),
  reason: z.string().trim().max(512, 'El motivo puede tener como máximo 512 caracteres.').optional()
}).strict();

const customCommandNameSchema = z.string()
  .min(1, 'El nombre del comando es obligatorio.')
  .max(32, 'El nombre del comando puede tener como máximo 32 caracteres.')
  .regex(/^[a-z0-9_-]+$/, 'El nombre solo puede tener minúsculas, números, guiones y guiones bajos.');

const customCommandSchema = z.object({
  name: customCommandNameSchema,
  description: z.string().max(100, 'La descripción puede tener como máximo 100 caracteres.').optional(),
  response: z.string()
    .min(1, 'La respuesta es obligatoria.')
    .max(2000, 'La respuesta puede tener como máximo 2000 caracteres.')
}).strict();

const customCommandUpdateSchema = customCommandSchema.partial().strict()
  .refine((data) => Object.keys(data).length > 0, 'No se envió ningún cambio.');

const customCommandToggleSchema = z.object({
  enabled: z.boolean()
}).strict();

const COMMAND_ID_REGEX = /^[A-Za-z0-9_-]{1,64}$/;

export async function registerRoutes(app: Express, { sessionParser }: RegisterRoutesOptions): Promise<Server> {
  const httpServer = createServer(app);

  app.get('/health', (_req: Request, res: Response) => {
    res.send('ok');
  });

  // Escrituras desde otro sitio web: fuera (además de la cookie SameSite=Lax)
  app.use('/api', rejectCrossSiteWrites);

  // Rutas públicas de autenticación: login OAuth, callback, estado y logout
  setupAuthRoutes(app);

  // Red de seguridad: cualquier otra ruta /api exige sesión iniciada.
  // (Las rutas de servidores además llevan requireGuildAdmin explícitamente.)
  app.use('/api', (req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith('/auth/')) return next();
    return requireAuth(req, res, next);
  });

  // Setup channel configuration routes
  setupChannelRoutes(app);

  // =============================================
  // WebSocket (tiempo real): solo sesiones válidas y solo servidores que administras
  // =============================================
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4 * 1024 });

  const rejectUpgrade = (socket: Duplex, status: number, message: string) => {
    socket.write(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    socket.destroy();
  };

  // En desarrollo Vite atiende sus propios upgrades (HMR) en este mismo servidor
  const isDevServer = app.get('env') === 'development';

  httpServer.on('upgrade', (req: SessionIncomingMessage, socket: Duplex, head: Buffer) => {
    // Lo primero: sin este listener, un ECONNRESET en el socket tumbaría todo el proceso
    socket.on('error', (error) => console.warn('[WS] Error en el socket:', error.message));

    let pathname = '';
    try {
      pathname = new URL(req.url || '/', 'http://localhost').pathname;
    } catch {
      // URL inválida: no es nuestra
    }

    if (pathname !== '/ws') {
      // El HMR de Vite (solo en desarrollo) lo atiende su propio listener
      if (isDevServer && req.headers['sec-websocket-protocol'] === VITE_HMR_PROTOCOL) return;
      // Cualquier otro upgrade se rechaza: no lo dejamos colgado
      return rejectUpgrade(socket, 400, 'Bad Request');
    }

    if (!isAllowedOrigin(req.headers.origin, req.headers)) {
      return rejectUpgrade(socket, 403, 'Forbidden');
    }

    // Cargamos la sesión con el mismo middleware de express-session
    try {
      sessionParser(req as unknown as Request, {} as Response, () => {
        try {
          if (!isSessionAuthenticated(req.session)) {
            return rejectUpgrade(socket, 401, 'Unauthorized');
          }
          wss.handleUpgrade(req, socket, head, (ws) => {
            wss.emit('connection', ws, req);
          });
        } catch (error) {
          console.error('[WS] Error al aceptar la conexión:', error);
          rejectUpgrade(socket, 500, 'Internal Server Error');
        }
      });
    } catch (error) {
      console.error('[WS] Error al leer la sesión:', error);
      rejectUpgrade(socket, 500, 'Internal Server Error');
    }
  });

  const sendWs = (ws: WebSocket, message: Record<string, unknown>) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  };

  // Sesión cerrada o ya no válida: fuera del tiempo real (el cliente debe volver a iniciar sesión)
  const closeUnauthorized = (ws: WebSocketClient, reason = 'Sesion no valida') => {
    ws.guildId = undefined;
    ws.userId = undefined;
    if (ws.readyState === WebSocket.OPEN) {
      ws.close(4401, reason);
    }
  };

  // Logout, nuevo login o token caducado/revocado: cerramos los WebSockets de esa sesión
  onSessionEnded((sessionId) => {
    wss.clients.forEach((client) => {
      const wsClient = client as WebSocketClient;
      if (wsClient.sessionId === sessionId) {
        closeUnauthorized(wsClient, 'Sesion cerrada');
      }
    });
  });

  // ¿La sesión de una conexión ya abierta sigue existiendo y con login válido?
  const revalidateSocketSession = (ws: WebSocketClient) => {
    const { sessionId, sessionStore } = ws;
    if (!sessionId || !sessionStore) {
      return closeUnauthorized(ws);
    }
    try {
      sessionStore.get(sessionId, (error, data) => {
        if (error) {
          console.warn('[WS] No se pudo comprobar la sesión:', error);
          return closeUnauthorized(ws);
        }
        if (!isSessionAuthenticated(data)) {
          closeUnauthorized(ws, 'Sesion caducada');
        }
      });
    } catch (error) {
      console.warn('[WS] No se pudo comprobar la sesión:', error);
      closeUnauthorized(ws);
    }
  };

  const heartbeat = setInterval(() => {
    wss.clients.forEach((client) => {
      const wsClient = client as WebSocketClient;
      if (wsClient.isAlive === false) {
        // No contestó al ping anterior: conexión muerta
        wsClient.terminate();
        return;
      }
      wsClient.isAlive = false;
      try {
        wsClient.ping();
      } catch {
        wsClient.terminate();
        return;
      }
      revalidateSocketSession(wsClient);
    });
  }, WS_HEARTBEAT_MS);
  heartbeat.unref();
  wss.on('close', () => clearInterval(heartbeat));

  wss.on('connection', (ws: WebSocketClient, req: SessionIncomingMessage) => {
    // Sin este listener, un mensaje demasiado grande o un frame inválido tumbaría el proceso
    ws.on('error', (error) => {
      console.warn('[WS] Error del cliente:', error.message);
      ws.terminate();
    });

    ws.isAlive = true;
    ws.on('pong', () => {
      ws.isAlive = true;
    });

    ws.sessionId = req.sessionID;
    ws.sessionStore = req.sessionStore;
    ws.joinSeq = 0;

    ws.on('message', (message) => {
      let data: any;
      try {
        data = JSON.parse(message.toString());
      } catch (error) {
        return sendWs(ws, { type: 'error', error: 'Mensaje no válido.' });
      }

      if (data?.type !== 'join') return;

      const guildId = data.guildId;
      const session = req.session;
      if (!session) {
        return closeUnauthorized(ws);
      }

      const joinSeq = (ws.joinSeq ?? 0) + 1;
      ws.joinSeq = joinSeq;

      // Recargamos la sesión: si cerró sesión o caducó desde que conectó, fuera
      session.reload(async (reloadError) => {
        try {
          const currentSession = req.session;
          if (reloadError || !currentSession || !isSessionAuthenticated(currentSession)) {
            return closeUnauthorized(ws);
          }

          const access = await checkGuildAccess(currentSession, guildId);
          if (!access.ok && access.status === 401) {
            // Discord rechazó el token: la sesión ya se limpió; la guardamos así y fuera
            currentSession.save(() => closeUnauthorized(ws));
            return;
          }

          // Ya se cerró la conexión o llegó otro "join" mientras esperábamos a Discord
          if (ws.readyState !== WebSocket.OPEN || ws.joinSeq !== joinSeq) return;

          if (!access.ok) {
            ws.guildId = undefined;
            return sendWs(ws, { type: 'error', status: access.status, ...access.body });
          }

          // El userId sale de la sesión; el que manda el cliente se ignora
          ws.guildId = guildId;
          ws.userId = currentSession.user?.id;
          sendWs(ws, { type: 'joined', guildId });
        } catch (error) {
          console.error('[WS] Error al unirse a un servidor:', error);
          sendWs(ws, { type: 'error', error: 'No se pudo suscribir a este servidor.' });
        }
      });
    });
  });

  // Avisa a los paneles abiertos de ese servidor
  const broadcast = (guildId: string, message: Record<string, unknown>) => {
    wss.clients.forEach((client) => {
      const wsClient = client as WebSocketClient;
      if (wsClient.guildId === guildId) {
        sendWs(wsClient, message);
      }
    });
  };

  // =============================================
  // Servidores del usuario (selector de servidor)
  // =============================================
  app.get('/api/user/guilds', requireAuth, async (req: Request, res: Response) => {
    // Modo desarrollo: no hay token de Discord, mostramos los servidores del bot
    if (isDevSession(req.session)) {
      const guilds = bot.client.isReady()
        ? bot.client.guilds.cache.map((guild) => ({
            id: guild.id,
            name: guild.name,
            icon: guild.icon,
            owner: true,
            permissions: '8',
            botInGuild: true
          }))
        : [];
      return res.json(guilds);
    }

    try {
      const guilds = await getUserGuilds(req.session);

      // Solo servidores donde es dueño o tiene Administrador / Gestionar servidor
      const adminGuilds = guilds
        .filter(canManageGuild)
        .map((guild) => ({
          id: guild.id,
          name: guild.name,
          icon: guild.icon,
          owner: guild.owner,
          permissions: guild.permissions,
          botInGuild: isBotInGuild(guild.id)
        }));

      return res.json(adminGuilds);
    } catch (error) {
      const { status, body } = discordErrorResult(req.session, error);
      return res.status(status).json(body);
    }
  });

  // =============================================
  // Configuración del servidor (prefijo y módulos)
  // =============================================
  app.get('/api/guild/:guildId/config', ...guildAdmin, async (req: Request, res: Response) => {
    try {
      const { guildId } = req.params;

      // Solo lectura: si el servidor aún no está en la BD devolvemos los valores por defecto
      const guild = await storage.getGuild(guildId);

      res.json({
        prefix: guild?.prefix || '&',
        levelUpMessages: guild?.levelUpMessages ?? true,
        economyEnabled: guild?.economyEnabled ?? true,
        antiRaidEnabled: guild?.antiRaidEnabled ?? false
      });

    } catch (error) {
      console.error('[GUILD-CONFIG-ERROR]', error);
      res.status(500).json({ error: 'No se pudo obtener la configuración del servidor.' });
    }
  });

  app.put('/api/guild/:guildId/config', ...guildAdminWithBot, async (req: Request, res: Response) => {
    try {
      const { guildId } = req.params;
      const body = parseBody(guildConfigSchema, req, res);
      if (!body) return;

      const updates: {
        prefix?: string;
        levelUpMessages?: boolean;
        economyEnabled?: boolean;
        antiRaidEnabled?: boolean;
      } = {};
      if (body.prefix !== undefined) updates.prefix = body.prefix;
      if (body.levelUpMessages !== undefined) updates.levelUpMessages = body.levelUpMessages;
      if (body.economyEnabled !== undefined) updates.economyEnabled = body.economyEnabled;
      if (body.antiRaidEnabled !== undefined) updates.antiRaidEnabled = body.antiRaidEnabled;

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: 'No se envió ningún cambio.' });
      }

      await ensureGuildRow(getBotGuild(res));
      await storage.updateGuild(guildId, updates);

      console.log(`[GUILD-CONFIG-UPDATE] Updated guild config for ${guildId}:`, updates);
      res.json({ success: true });

    } catch (error) {
      console.error('[GUILD-CONFIG-UPDATE-ERROR]', error);
      res.status(500).json({ error: 'No se pudo guardar la configuración del servidor.' });
    }
  });

  // Dashboard stats
  app.get('/api/dashboard/:guildId/stats', ...guildAdminWithBot, async (_req: Request, res: Response) => {
    try {
      // Datos reales del servidor (con caché y respetando los rate limits de Discord)
      const counts = await getGuildCounts(getBotGuild(res));

      const stats = {
        totalMembers: counts.memberCount,
        activeUsers: Math.floor(counts.presenceCount * 0.7),
        commandsUsed: 15200,
        moderationActions: 47
      };

      return res.json(stats);
    } catch (discordError) {
      console.error('[DASH-ERROR] Failed to fetch Discord data:', discordError);
      return res.status(503).json({
        error: 'No se pudieron obtener los datos del servidor desde Discord.'
      });
    }
  });

  // Guild management
  app.get('/api/guilds/:guildId', ...guildAdmin, async (req: Request, res: Response) => {
    try {
      const guild = await storage.getGuild(req.params.guildId);
      if (!guild) {
        return res.status(404).json({ error: 'Servidor no encontrado.' });
      }
      res.json(guild);
    } catch (error) {
      res.status(500).json({ error: 'No se pudo obtener el servidor.' });
    }
  });

  app.put('/api/guilds/:guildId/settings', ...guildAdminWithBot, async (req: Request, res: Response) => {
    try {
      const { guildId } = req.params;
      const settings = parseBody(guildSettingsSchema, req, res);
      if (!settings) return;

      await ensureGuildRow(getBotGuild(res));
      await storage.updateGuildSettings(guildId, settings);

      broadcast(guildId, { type: 'settingsUpdated' });
      res.json({ success: true });
    } catch (error) {
      console.error('[GUILD-SETTINGS-ERROR]', error);
      res.status(500).json({ error: 'No se pudieron guardar los ajustes.' });
    }
  });

  // Level system
  app.get('/api/levels/:guildId/top', ...guildAdmin, async (req: Request, res: Response) => {
    try {
      const { guildId } = req.params;
      const limit = parseLimit(req.query.limit, 10, 100);

      const topUsers = await storage.getTopUsersByLevel(guildId, limit);
      res.json(topUsers);
    } catch (error) {
      res.status(500).json({ error: 'No se pudo obtener el ranking de niveles.' });
    }
  });

  app.get('/api/levels/:guildId/user/:userId', ...guildAdmin, async (req: Request, res: Response) => {
    try {
      const { guildId, userId } = req.params;
      if (!isSnowflake(userId)) {
        return res.status(400).json({ error: 'El ID del usuario no es válido.' });
      }
      const userLevel = await storage.getUserLevel(userId, guildId);

      if (!userLevel) {
        return res.status(404).json({ error: 'Ese usuario aún no tiene nivel en este servidor.' });
      }

      res.json(userLevel);
    } catch (error) {
      res.status(500).json({ error: 'No se pudo obtener el nivel del usuario.' });
    }
  });

  // Economy system
  app.get('/api/economy/:guildId/user/:userId', ...guildAdmin, async (req: Request, res: Response) => {
    try {
      const { guildId, userId } = req.params;
      if (!isSnowflake(userId)) {
        return res.status(400).json({ error: 'El ID del usuario no es válido.' });
      }
      const userEconomy = await storage.getUserEconomy(userId, guildId);

      if (!userEconomy) {
        return res.status(404).json({ error: 'Ese usuario aún no tiene economía en este servidor.' });
      }

      res.json(userEconomy);
    } catch (error) {
      res.status(500).json({ error: 'No se pudo obtener la economía del usuario.' });
    }
  });

  // Moderation
  app.get('/api/moderation/:guildId/actions', ...guildAdmin, async (req: Request, res: Response) => {
    try {
      const { guildId } = req.params;
      const limit = parseLimit(req.query.limit, 50, 200);

      const actions = await storage.getModerationActions(guildId, limit);
      res.json(actions);
    } catch (error) {
      res.status(500).json({ error: 'No se pudieron obtener las acciones de moderación.' });
    }
  });

  // Content feeds
  app.get('/api/social/:guildId/feeds', ...guildAdmin, async (req: Request, res: Response) => {
    try {
      const { guildId } = req.params;
      const feeds = await storage.getContentFeeds(guildId);
      res.json(feeds);
    } catch (error) {
      res.status(500).json({ error: 'No se pudieron obtener los feeds de contenido.' });
    }
  });

  app.post('/api/social/:guildId/feeds', ...guildAdminWithBot, async (req: Request, res: Response) => {
    try {
      const { guildId } = req.params;
      const feedData = parseBody(contentFeedSchema, req, res);
      if (!feedData) return;

      const botGuild = getBotGuild(res);
      if (!findGuildTextChannel(botGuild, feedData.channelId)) {
        return res.status(400).json({ error: 'Ese canal no existe en este servidor o no es un canal de texto.' });
      }

      await ensureGuildRow(botGuild);
      const feed = await storage.createContentFeed({
        ...feedData,
        guildId,
        enabled: true
      });

      broadcast(guildId, { type: 'feedCreated' });
      res.json(feed);
    } catch (error) {
      console.error('[SOCIAL-FEED-ERROR]', error);
      res.status(500).json({ error: 'No se pudo crear el feed de contenido.' });
    }
  });

  // Protection routes
  app.get('/api/protection/:guildId/settings', ...guildAdmin, async (req: Request, res: Response) => {
    try {
      const settings = {
        lockdownEnabled: false,
        lockdownReason: '',
        autoRoles: [
          { id: '1', name: 'Member', roleId: '987654321', enabled: true },
          { id: '2', name: 'Verified', roleId: '876543210', enabled: false }
        ],
        reactionRoles: [
          {
            id: '1',
            messageId: '123456789',
            channelId: '456789123',
            title: 'Choose your roles!',
            description: 'React to get roles',
            reactions: [
              { emoji: '🎮', roleId: '111111111', roleName: 'Gamer' },
              { emoji: '🎵', roleId: '222222222', roleName: 'Music Lover' }
            ]
          }
        ],
        nsfwChannels: ['654321987'],
        massRoleHistory: []
      };

      res.json(settings);
    } catch (error) {
      res.status(500).json({ error: 'No se pudieron obtener los ajustes de protección.' });
    }
  });

  app.post('/api/protection/:guildId/lockdown', ...guildAdminWithBot, async (req: Request, res: Response) => {
    try {
      const { guildId } = req.params;
      const body = parseBody(lockdownSchema, req, res);
      if (!body) return;

      broadcast(guildId, {
        type: 'lockdown_update',
        enabled: body.enabled,
        reason: body.reason ?? '',
        timestamp: new Date().toISOString()
      });

      res.json({ success: true, enabled: body.enabled, reason: body.reason ?? '' });
    } catch (error) {
      res.status(500).json({ error: 'No se pudo actualizar el bloqueo.' });
    }
  });

  // Custom Commands API
  const requireValidCommandId = (req: Request, res: Response, next: NextFunction) => {
    if (!COMMAND_ID_REGEX.test(req.params.commandId || '')) {
      return res.status(400).json({ error: 'El ID del comando no es válido.' });
    }
    next();
  };

  app.get('/api/custom-commands/:guildId', ...guildAdmin, async (req: Request, res: Response) => {
    try {
      // Mock data for now - replace with actual database query
      const commands = [
        {
          id: "cmd1",
          name: "hello",
          description: "Say hello to users",
          response: "Hello {user}! Welcome to our server!",
          enabled: true,
          uses: 42,
          createdAt: new Date().toISOString()
        },
        {
          id: "cmd2",
          name: "rules",
          description: "Display server rules",
          response: "Please read our rules in #rules-channel",
          enabled: true,
          uses: 18,
          createdAt: new Date().toISOString()
        }
      ];

      res.json(commands);
    } catch (error) {
      res.status(500).json({ error: 'No se pudieron obtener los comandos personalizados.' });
    }
  });

  app.post('/api/custom-commands/:guildId', ...guildAdmin, async (req: Request, res: Response) => {
    try {
      const body = parseBody(customCommandSchema, req, res);
      if (!body) return;

      // Mock creating command - replace with actual database insert
      const newCommand = {
        id: `cmd_${Date.now()}`,
        name: body.name,
        description: body.description || null,
        response: body.response,
        enabled: true,
        uses: 0,
        createdAt: new Date().toISOString()
      };

      res.json(newCommand);
    } catch (error) {
      res.status(500).json({ error: 'No se pudo crear el comando personalizado.' });
    }
  });

  app.patch('/api/custom-commands/:guildId/:commandId', ...guildAdmin, requireValidCommandId, async (req: Request, res: Response) => {
    try {
      const body = parseBody(customCommandUpdateSchema, req, res);
      if (!body) return;

      // Mock updating command - replace with actual database update
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: 'No se pudo actualizar el comando personalizado.' });
    }
  });

  app.patch('/api/custom-commands/:guildId/:commandId/toggle', ...guildAdmin, requireValidCommandId, async (req: Request, res: Response) => {
    try {
      const body = parseBody(customCommandToggleSchema, req, res);
      if (!body) return;

      // Mock toggling command status - replace with actual database update
      res.json({ success: true, enabled: body.enabled });
    } catch (error) {
      res.status(500).json({ error: 'No se pudo cambiar el estado del comando.' });
    }
  });

  app.delete('/api/custom-commands/:guildId/:commandId', ...guildAdmin, requireValidCommandId, async (req: Request, res: Response) => {
    try {
      // Mock deleting command - replace with actual database deletion
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: 'No se pudo eliminar el comando personalizado.' });
    }
  });

  // Cualquier otra ruta /api: 404 en JSON (en vez de caer en el index.html del panel)
  app.use('/api', (_req: Request, res: Response) => {
    res.status(404).json({ error: 'Ruta de la API no encontrada.' });
  });

  return httpServer;
}
