import type { Express, Request, Response, NextFunction, RequestHandler } from "express";
import type { Store } from "express-session";
import { createServer, type IncomingMessage, type Server } from "http";
import type { Duplex } from "stream";
import { WebSocketServer, WebSocket } from "ws";
import { storage, ContentFeedLimitError, type ContentFeedUpdate } from "./storage";
import { z } from "zod";
import type {
  ContentFeedResponse,
  ContentFeedsResponse,
  GuildConfigResponse,
  GuildRowResponse,
  SuccessResponse,
  UserEconomyResponse,
  UserGuildsResponse,
  UserLevelResponse,
} from "@shared/api";
import { bot } from "./bot/index";
import { invalidateAntiRaidConfig, liftLockdown } from "./bot/middleware/antiRaid";
import { invalidateCustomCommandsCache } from "./bot/customCommands";
import { setupAuthRoutes } from "./routes/auth";
import { setupChannelRoutes } from "./routes/channels";
import { setupDashboardRoutes } from "./routes/dashboard";
import { setupEngagementRoutes } from "./routes/engagement";
import { setupSecurityRoutes } from "./routes/security";
import { setupModerationRoutes } from "./routes/moderation";
import { setupCustomCommandRoutes } from "./routes/customCommands";
import { asJson, isRowId } from "./routes/helpers";
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

const postIntervalSchema = z.number()
  .int('El intervalo debe ser un número entero de minutos.')
  .min(1, 'El intervalo va de 1 a 1440 minutos.')
  .max(1440, 'El intervalo va de 1 a 1440 minutos.');

// Solo Reddit: Twitter/X no tiene acceso real a su API (publicaría contenido de relleno)
const contentFeedSchema = z.object({
  source: z.literal('reddit'),
  channelId: snowflakeSchema,
  sourceConfig: z.object({
    subreddit: z.string().regex(/^[A-Za-z0-9_]{2,21}$/, 'El nombre del subreddit no es válido.'),
    filterNSFW: z.boolean().optional()
  }).strict(),
  postInterval: postIntervalSchema
}).strict();

const contentFeedUpdateSchema = z.object({
  channelId: snowflakeSchema,
  enabled: z.boolean(),
  postInterval: postIntervalSchema
}).partial().strict()
  .refine((data) => Object.keys(data).length > 0, 'No se envió ningún cambio.');

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
      const guilds: UserGuildsResponse = bot.client.isReady()
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
      const adminGuilds: UserGuildsResponse = guilds
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

      const config: GuildConfigResponse = {
        prefix: guild?.prefix || '&',
        levelUpMessages: guild?.levelUpMessages ?? true,
        economyEnabled: guild?.economyEnabled ?? true,
        antiRaidEnabled: guild?.antiRaidEnabled ?? false
      };
      res.json(config);

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

      // El bot guarda en memoria el prefijo (comandos personalizados) y la config anti-raid: que apliquen ya
      if (updates.prefix !== undefined) invalidateCustomCommandsCache(guildId);
      if (updates.antiRaidEnabled !== undefined) {
        invalidateAntiRaidConfig(guildId);
        // Igual que /antiraid desactivar: apagar la protección también termina el modo raid activo
        if (!updates.antiRaidEnabled) await liftLockdown(guildId, req.session.user?.id ?? 'manual');
      }

      console.log(`[GUILD-CONFIG-UPDATE] Updated guild config for ${guildId}:`, updates);
      broadcast(guildId, { type: 'settingsUpdated' });
      const result: SuccessResponse = { success: true };
      res.json(result);

    } catch (error) {
      console.error('[GUILD-CONFIG-UPDATE-ERROR]', error);
      res.status(500).json({ error: 'No se pudo guardar la configuración del servidor.' });
    }
  });

  // Guild management
  app.get('/api/guilds/:guildId', ...guildAdmin, async (req: Request, res: Response) => {
    try {
      const guild = await storage.getGuild(req.params.guildId);
      if (!guild) {
        return res.status(404).json({ error: 'Este servidor aún no tiene configuración guardada.' });
      }
      const body: GuildRowResponse = asJson(guild);
      res.json(body);
    } catch (error) {
      console.error('[GUILD-ERROR]', error);
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
      const result: SuccessResponse = { success: true };
      res.json(result);
    } catch (error) {
      console.error('[GUILD-SETTINGS-ERROR]', error);
      res.status(500).json({ error: 'No se pudieron guardar los ajustes.' });
    }
  });

  // Level system
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

      const body: UserLevelResponse = asJson(userLevel);
      res.json(body);
    } catch (error) {
      console.error('[LEVEL-USER-ERROR]', error);
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

      const body: UserEconomyResponse = asJson(userEconomy);
      res.json(body);
    } catch (error) {
      console.error('[ECONOMY-USER-ERROR]', error);
      res.status(500).json({ error: 'No se pudo obtener la economía del usuario.' });
    }
  });

  // Content feeds
  app.get('/api/social/:guildId/feeds', ...guildAdmin, async (req: Request, res: Response) => {
    try {
      const { guildId } = req.params;
      const feeds = await storage.getContentFeeds(guildId);
      const body: ContentFeedsResponse = asJson(feeds);
      res.json(body);
    } catch (error) {
      console.error('[SOCIAL-FEEDS-ERROR]', error);
      res.status(500).json({ error: 'No se pudieron obtener los feeds de contenido.' });
    }
  });

  app.post('/api/social/:guildId/feeds', ...guildAdminWithBot, async (req: Request, res: Response) => {
    try {
      const { guildId } = req.params;
      if (req.body?.source === 'twitter') {
        return res.status(400).json({ error: 'Twitter/X todavía no está disponible: por ahora solo se puede usar Reddit.' });
      }
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
      const body: ContentFeedResponse = asJson(feed);
      res.status(201).json(body);
    } catch (error) {
      if (error instanceof ContentFeedLimitError) {
        return res.status(409).json({ error: error.message });
      }
      console.error('[SOCIAL-FEED-ERROR]', error);
      res.status(500).json({ error: 'No se pudo crear el feed de contenido.' });
    }
  });

  app.patch('/api/social/:guildId/feeds/:feedId', ...guildAdminWithBot, async (req: Request, res: Response) => {
    try {
      const { guildId, feedId } = req.params;
      if (!isRowId(feedId)) {
        return res.status(400).json({ error: 'El ID del feed no es válido.' });
      }
      const body = parseBody(contentFeedUpdateSchema, req, res);
      if (!body) return;

      if (body.channelId && !findGuildTextChannel(getBotGuild(res), body.channelId)) {
        return res.status(400).json({ error: 'Ese canal no existe en este servidor o no es un canal de texto.' });
      }

      const updates: ContentFeedUpdate = {};
      if (body.channelId !== undefined) updates.channelId = body.channelId;
      if (body.enabled !== undefined) updates.enabled = body.enabled;
      if (body.postInterval !== undefined) updates.postInterval = body.postInterval;

      const feed = await storage.updateContentFeed(feedId, guildId, updates);
      if (!feed) {
        return res.status(404).json({ error: 'Ese feed no existe en este servidor.' });
      }

      broadcast(guildId, { type: 'feedsUpdated' });
      const result: ContentFeedResponse = asJson(feed);
      res.json(result);
    } catch (error) {
      console.error('[SOCIAL-FEED-UPDATE-ERROR]', error);
      res.status(500).json({ error: 'No se pudo actualizar el feed de contenido.' });
    }
  });

  app.delete('/api/social/:guildId/feeds/:feedId', ...guildAdmin, async (req: Request, res: Response) => {
    try {
      const { guildId, feedId } = req.params;
      if (!isRowId(feedId)) {
        return res.status(400).json({ error: 'El ID del feed no es válido.' });
      }

      const deleted = await storage.deleteContentFeed(feedId, guildId);
      if (!deleted) {
        return res.status(404).json({ error: 'Ese feed no existe en este servidor.' });
      }

      broadcast(guildId, { type: 'feedsUpdated' });
      const result: SuccessResponse = { success: true };
      res.json(result);
    } catch (error) {
      console.error('[SOCIAL-FEED-DELETE-ERROR]', error);
      res.status(500).json({ error: 'No se pudo eliminar el feed de contenido.' });
    }
  });

  // Resumen, rankings y analíticas
  setupDashboardRoutes(app);
  // Bienvenida, pregunta del día y roles de Discord
  setupEngagementRoutes(app, { broadcast });
  // Anti-raid e historial de raids
  setupSecurityRoutes(app, { broadcast });
  // Historial de moderación
  setupModerationRoutes(app);
  // Comandos personalizados
  setupCustomCommandRoutes(app, { broadcast });

  // Cualquier otra ruta /api: 404 en JSON (en vez de caer en el index.html del panel)
  app.use('/api', (_req: Request, res: Response) => {
    res.status(404).json({ error: 'Ruta de la API no encontrada.' });
  });

  return httpServer;
}
