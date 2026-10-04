import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { storage } from "./storage";
import { z } from "zod";
import { setupAuthRoutes } from "./routes/auth";
import { setupChannelRoutes } from "./routes/channels";

interface SessionRequest extends Request {
  session: any;
}

interface WebSocketClient extends WebSocket {
  guildId?: string;
  userId?: string;
}

export async function registerRoutes(app: Express): Promise<Server> {
  const httpServer = createServer(app);

  // Setup authentication routes
  setupAuthRoutes(app);

  // Setup channel configuration routes
  setupChannelRoutes(app);

  // Endpoints de verificación OAuth (ChatGPT smoke test)
  app.get('/auth/status', (req: SessionRequest, res: Response) => {
    const user = req.session?.user || null;
    const loggedIn = req.session?.authenticated === true;
    res.json({ 
      loggedIn: loggedIn, 
      user: user ? { id: user.id, username: user.username, avatar: user.avatar } : null 
    });
  });

  app.get('/health', (_req: Request, res: Response) => {
    res.send('ok');
  });

  // Logging middleware para debug (ChatGPT recomendado)
  app.use((req: SessionRequest, res: Response, next: NextFunction) => {
    console.log(`${req.method} ${req.path} - SESSION:${req.session?.id} USER:${(req as any).user?.id || 'none'}`);
    next();
  });

  // WebSocket server for real-time updates
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  wss.on('connection', (ws: WebSocketClient) => {
    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message.toString());
        if (data.type === 'join' && data.guildId) {
          ws.guildId = data.guildId;
          ws.userId = data.userId;
        }
      } catch (error) {
        console.error('WebSocket message error:', error);
      }
    });
  });

  // =============================================
  // MIDDLEWARE DE AUTENTICACIÓN CENTRALIZADO
  // =============================================
  const requireAuth = (req: SessionRequest, res: Response, next: NextFunction) => {
    if (req.session?.authenticated && req.session?.discordToken) {
      req.session.touch(); // Extend session
      req.session.lastActivity = Date.now();
      return next();
    }
    return res.status(401).json({
      error: 'Authentication required',
      requireAuth: true,
      authUrl: '/auth/manual'
    });
  };

  // Auth status endpoint simplificado
  app.get('/api/auth/status', (req: SessionRequest, res) => {
    const isAuthenticated = req.session?.authenticated && req.session?.discordToken;

    if (isAuthenticated) {
      req.session.touch();
      req.session.lastActivity = Date.now();

      return res.json({
        authenticated: true,
        user: req.session.user || { username: 'Discord User' },
        sessionExtended: true,
        expiresIn: 30 * 60
      });
    }

    res.json({ authenticated: false });
  });

  // Guild configuration routes for prefix and bot settings
  app.get('/api/guild/:guildId/config', async (req: SessionRequest, res) => {
    console.log(`[GUILD-CONFIG-001] Guild config requested for: ${req.params.guildId}`);

    try {
      const guildId = req.params.guildId;

      let guild = await storage.getGuild(guildId);
      if (!guild) {
        guild = await storage.createGuild({
          id: guildId,
          name: 'Unknown Guild',
          ownerId: 'unknown',
          prefix: '&'
        });
        console.log(`[GUILD-CONFIG-002] Created new guild config with default prefix: &`);
      }

      console.log(`[GUILD-CONFIG-003] Retrieved guild config: prefix=${guild.prefix}`);
      res.json({
        prefix: guild.prefix || '&',
        levelUpMessages: guild.levelUpMessages ?? true,
        economyEnabled: guild.economyEnabled ?? true,
        antiRaidEnabled: guild.antiRaidEnabled ?? false
      });

    } catch (error) {
      console.error('[GUILD-CONFIG-ERROR]', error);
      res.status(500).json({ error: 'Failed to get guild configuration' });
    }
  });

  app.put('/api/guild/:guildId/config', async (req: SessionRequest, res) => {
    console.log(`[GUILD-CONFIG-UPDATE-001] Updating guild config for: ${req.params.guildId}`);
    console.log(`[GUILD-CONFIG-UPDATE-002] New config:`, req.body);

    try {
      const guildId = req.params.guildId;
      const { prefix, levelUpMessages, economyEnabled, antiRaidEnabled } = req.body;

      // Validate prefix
      if (prefix && (prefix.length > 5 || /\s/.test(prefix))) {
        console.log(`[GUILD-CONFIG-UPDATE-003] Invalid prefix: ${prefix}`);
        return res.status(400).json({ error: 'Prefix must be 1-5 characters and contain no spaces' });
      }

      let guild = await storage.getGuild(guildId);
      if (!guild) {
        guild = await storage.createGuild({
          id: guildId,
          name: 'Unknown Guild',
          ownerId: 'unknown',
          prefix: '&'
        });
      }

      await storage.updateGuild(guildId, {
        prefix: prefix || '&',
        levelUpMessages,
        economyEnabled,
        antiRaidEnabled
      });

      console.log(`[GUILD-CONFIG-UPDATE-004] Successfully updated guild config`);
      res.json({ success: true });

    } catch (error) {
      console.error('[GUILD-CONFIG-UPDATE-ERROR]', error);
      res.status(500).json({ error: 'Failed to update guild configuration' });
    }
  });

  // Dashboard stats - usando middleware de auth
  app.get('/api/dashboard/:guildId/stats', requireAuth, async (req: SessionRequest, res) => {
    try {
      const { guildId } = req.params;
      try {
        // Fetch real guild data from Discord API
        const guildResponse = await fetch(`https://discord.com/api/v10/guilds/${guildId}?with_counts=true`, {
          headers: {
            'Authorization': `Bot ${process.env.DISCORD_TOKEN}`,
            'Content-Type': 'application/json'
          }
        });

        if (guildResponse.ok) {
          const guildData = await guildResponse.json();

          const stats = {
            totalMembers: guildData.approximate_member_count || 0,
            activeUsers: Math.floor((guildData.approximate_presence_count || 0) * 0.7),
            commandsUsed: 15200,
            moderationActions: 47
          };

          return res.json(stats);
        }

        throw new Error('Discord API request failed');
      } catch (discordError) {
        console.error('Failed to fetch Discord data:', discordError);
        return res.status(503).json({
          error: 'Discord API unavailable',
          message: 'Unable to fetch real server data from Discord'
        });
      }
    } catch (error) {
      console.error('[DASH-ERROR] Dashboard stats error:', error);
      res.status(500).json({ error: 'Failed to fetch stats' });
    }
  });

  // Guild management
  app.get('/api/guilds/:guildId', async (req, res) => {
    try {
      const guild = await storage.getGuild(req.params.guildId);
      if (!guild) {
        return res.status(404).json({ error: 'Guild not found' });
      }
      res.json(guild);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch guild' });
    }
  });

  app.put('/api/guilds/:guildId/settings', async (req, res) => {
    try {
      const { guildId } = req.params;
      const settingsSchema = z.object({
        levelSystem: z.object({
          enabled: z.boolean(),
          xpPerMessage: z.array(z.number()).length(2),
          voiceMultiplier: z.number(),
          announcements: z.boolean()
        }).optional(),
        economy: z.object({
          enabled: z.boolean(),
          dailyReward: z.number(),
          workCooldown: z.number()
        }).optional(),
        moderation: z.object({
          automod: z.boolean(),
          spamDetection: z.boolean(),
          linkFiltering: z.boolean()
        }).optional()
      });

      const settings = settingsSchema.parse(req.body);
      await storage.updateGuildSettings(guildId, settings);

      // Assuming broadcast function is available globally or passed
      // broadcast(guildId, { type: 'settingsUpdated', settings });
      res.json({ success: true });
    } catch (error) {
      res.status(400).json({ error: 'Invalid settings data' });
    }
  });

  // Level system
  app.get('/api/levels/:guildId/top', async (req, res) => {
    try {
      const { guildId } = req.params;
      const limit = parseInt(req.query.limit as string) || 10;

      const topUsers = await storage.getTopUsersByLevel(guildId, limit);
      res.json(topUsers);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch top users' });
    }
  });

  app.get('/api/levels/:guildId/user/:userId', async (req, res) => {
    try {
      const { guildId, userId } = req.params;
      const userLevel = await storage.getUserLevel(userId, guildId);

      if (!userLevel) {
        return res.status(404).json({ error: 'User level not found' });
      }

      res.json(userLevel);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch user level' });
    }
  });

  // Economy system
  app.get('/api/economy/:guildId/user/:userId', async (req, res) => {
    try {
      const { guildId, userId } = req.params;
      const userEconomy = await storage.getUserEconomy(userId, guildId);

      if (!userEconomy) {
        return res.status(404).json({ error: 'User economy not found' });
      }

      res.json(userEconomy);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch user economy' });
    }
  });

  // Moderation
  app.get('/api/moderation/:guildId/actions', async (req, res) => {
    try {
      const { guildId } = req.params;
      const limit = parseInt(req.query.limit as string) || 50;

      const actions = await storage.getModerationActions(guildId, limit);
      res.json(actions);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch moderation actions' });
    }
  });

  // Content feeds
  app.get('/api/social/:guildId/feeds', async (req, res) => {
    try {
      const { guildId } = req.params;
      const feeds = await storage.getContentFeeds(guildId);
      res.json(feeds);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch content feeds' });
    }
  });

  app.post('/api/social/:guildId/feeds', async (req, res) => {
    try {
      const { guildId } = req.params;
      const feedSchema = z.object({
        channelId: z.string(),
        source: z.enum(['reddit', 'twitter']),
        sourceConfig: z.object({}).passthrough(),
        postInterval: z.number().min(1).max(1440)
      });

      const feedData = feedSchema.parse(req.body);
      const feed = await storage.createContentFeed({
        ...feedData,
        guildId,
        enabled: true
      });

      // Assuming broadcast function is available globally or passed
      // broadcast(guildId, { type: 'feedCreated', feed });
      res.json(feed);
    } catch (error) {
      res.status(400).json({ error: 'Invalid feed data' });
    }
  });

  // Protection routes
  app.get('/api/protection/:guildId/settings', async (req, res) => {
    try {
      const { guildId } = req.params;

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
      res.status(500).json({ error: 'Failed to fetch protection settings' });
    }
  });

  app.post('/api/protection/:guildId/lockdown', async (req, res) => {
    try {
      const { guildId } = req.params;
      const { enabled, reason } = req.body;

      // Assuming broadcast function is available globally or passed
      // broadcast(guildId, {
      //   type: 'lockdown_update',
      //   enabled,
      //   reason,
      //   timestamp: new Date()
      // });

      res.json({ success: true, enabled, reason });
    } catch (error) {
      res.status(500).json({ error: 'Failed to update lockdown' });
    }
  });

  // Manual auth routes ahora están en /routes/auth.ts - removido duplicado

  // OAuth callback ya está manejado en /routes/auth.ts - removido duplicado

  // Custom Commands API
  app.get('/api/custom-commands/:guildId', async (req, res) => {
    try {
      const { guildId } = req.params;

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
      res.status(500).json({ error: 'Failed to fetch custom commands' });
    }
  });

  app.post('/api/custom-commands/:guildId', async (req, res) => {
    try {
      const { guildId } = req.params;
      const { name, description, response } = req.body;

      // Mock creating command - replace with actual database insert
      const newCommand = {
        id: `cmd_${Date.now()}`,
        name,
        description: description || null,
        response,
        enabled: true,
        uses: 0,
        createdAt: new Date().toISOString()
      };

      res.json(newCommand);
    } catch (error) {
      res.status(500).json({ error: 'Failed to create custom command' });
    }
  });

  app.patch('/api/custom-commands/:guildId/:commandId', async (req, res) => {
    try {
      const { guildId, commandId } = req.params;
      const updateData = req.body;

      // Mock updating command - replace with actual database update
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: 'Failed to update custom command' });
    }
  });

  app.patch('/api/custom-commands/:guildId/:commandId/toggle', async (req, res) => {
    try {
      const { guildId, commandId } = req.params;
      const { enabled } = req.body;

      // Mock toggling command status - replace with actual database update
      res.json({ success: true, enabled });
    } catch (error) {
      res.status(500).json({ error: 'Failed to toggle custom command' });
    }
  });

  app.delete('/api/custom-commands/:guildId/:commandId', async (req, res) => {
    try {
      const { guildId, commandId } = req.params;

      // Mock deleting command - replace with actual database deletion
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: 'Failed to delete custom command' });
    }
  });

  // User's guilds API (for guild selector) - usando middleware
  app.get('/api/user/guilds', requireAuth, async (req: SessionRequest, res) => {
    try {
      try {
        const guildsResponse = await fetch('https://discord.com/api/v10/users/@me/guilds', {
          headers: {
            'Authorization': `Bearer ${req.session.discordToken}`,
            'Content-Type': 'application/json'
          }
        });

        if (guildsResponse.ok) {
          const realGuilds = await guildsResponse.json();

          // Filter to only guilds where user has admin permissions or is owner
          const adminGuilds = realGuilds.filter((guild: any) =>
            (parseInt(guild.permissions) & 0x8) === 0x8 || guild.owner
          );

          return res.json(adminGuilds);
        }

        throw new Error('Discord API request failed');
      } catch (discordError) {
        console.error('Failed to fetch Discord guilds:', discordError);

        // Try bot cache as fallback
        try {
          const { bot } = require('./bot/index');
          if (bot?.client?.guilds?.cache?.size > 0) {
            const guilds = bot.client.guilds.cache.map((guild: any) => ({
              id: guild.id,
              name: guild.name,
              icon: guild.icon,
              owner: false,
              permissions: "2147483647"
            }));
            return res.json(guilds);
          }
        } catch (error) {
          // Fallback failed
        }

        return res.status(503).json({
          error: 'Unable to fetch servers',
          message: 'Cannot retrieve server list from Discord'
        });
      }
    } catch (error) {
      console.error('Failed to fetch Discord guilds:', error);
      res.status(500).json({ error: 'Failed to fetch user guilds' });
    }
  });

  return httpServer;
}
