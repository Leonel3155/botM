import type { Express, Request, Response } from "express";
import { z } from "zod";
import { storage } from "../storage";
import {
  requireAuth,
  requireGuildAdmin,
  requireBotInGuild,
  getBotGuild,
  findGuildTextChannel,
  ensureGuildRow,
  parseBody,
  snowflakeSchema
} from "./middleware";

// Canal opcional: un ID de Discord, o null / "" para desactivarlo
const optionalChannelId = z
  .union([snowflakeSchema, z.literal(''), z.null()])
  .transform((value) => value || null);

const channelConfigSchema = z.object({
  contentChannelId: optionalChannelId,
  moderationChannelId: optionalChannelId,
  welcomeChannelId: optionalChannelId,
  redditEnabled: z.boolean(),
  twitterEnabled: z.boolean(),
  // La música se eliminó; el panel antiguo aún manda este campo. Se acepta y se ignora.
  musicChannelId: z.union([z.string(), z.null()])
}).partial().strict();

export function setupChannelRoutes(app: Express) {
  // Get guild channel configuration
  app.get('/api/guild/:guildId/channels', requireAuth, requireGuildAdmin, async (req: Request, res: Response) => {
    try {
      const { guildId } = req.params;
      console.log(`[CHANNELS-001] Getting channel config for guild: ${guildId}`);

      // Solo lectura: si el servidor aún no está en la BD devolvemos los valores por defecto
      const guild = await storage.getGuild(guildId);

      const channelConfig = {
        contentChannelId: guild?.contentChannelId || null,
        moderationChannelId: guild?.moderationChannelId || null,
        welcomeChannelId: guild?.welcomeChannelId || null,
        redditEnabled: guild?.redditEnabled || false,
        twitterEnabled: guild?.twitterEnabled || false
      };

      res.json(channelConfig);

    } catch (error) {
      console.error('[CHANNELS-ERROR-001] Failed to get channel config:', error);
      res.status(500).json({ error: 'No se pudo obtener la configuración de canales.' });
    }
  });

  // Update guild channel configuration
  app.put('/api/guild/:guildId/channels', requireAuth, requireGuildAdmin, requireBotInGuild, async (req: Request, res: Response) => {
    try {
      const { guildId } = req.params;
      const body = parseBody(channelConfigSchema, req, res);
      if (!body) return;

      console.log(`[CHANNELS-UPDATE-001] Updating channels for guild: ${guildId}`);

      const botGuild = getBotGuild(res);
      const channelFields = [
        ['contentChannelId', 'contenido'],
        ['moderationChannelId', 'moderación'],
        ['welcomeChannelId', 'bienvenida']
      ] as const;

      // Cada canal tiene que ser de texto y de ESTE servidor
      for (const [field, label] of channelFields) {
        const channelId = body[field];
        if (channelId && !findGuildTextChannel(botGuild, channelId)) {
          return res.status(400).json({
            error: `El canal de ${label} no existe en este servidor o no es un canal de texto.`
          });
        }
      }

      const updates: {
        contentChannelId?: string | null;
        moderationChannelId?: string | null;
        welcomeChannelId?: string | null;
        redditEnabled?: boolean;
        twitterEnabled?: boolean;
      } = {};
      if (body.contentChannelId !== undefined) updates.contentChannelId = body.contentChannelId;
      if (body.moderationChannelId !== undefined) updates.moderationChannelId = body.moderationChannelId;
      if (body.welcomeChannelId !== undefined) updates.welcomeChannelId = body.welcomeChannelId;
      if (body.redditEnabled !== undefined) updates.redditEnabled = body.redditEnabled;
      if (body.twitterEnabled !== undefined) updates.twitterEnabled = body.twitterEnabled;

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: 'No se envió ningún cambio.' });
      }

      await ensureGuildRow(botGuild);
      await storage.updateGuild(guildId, updates);

      console.log(`[CHANNELS-UPDATE-003] Successfully updated channel configuration`);
      res.json({ success: true });

    } catch (error) {
      console.error('[CHANNELS-UPDATE-ERROR]', error);
      res.status(500).json({ error: 'No se pudo guardar la configuración de canales.' });
    }
  });

  // Get available Discord channels for a guild (requires authentication)
  app.get('/api/guild/:guildId/discord-channels', requireAuth, requireGuildAdmin, requireBotInGuild, async (req: Request, res: Response) => {
    try {
      const { guildId } = req.params;

      console.log(`[DISCORD-CHANNELS-001] Fetching Discord channels for guild: ${guildId}`);

      // Fetch channels from Discord API
      const channelsResponse = await fetch(`https://discord.com/api/v10/guilds/${guildId}/channels`, {
        headers: {
          'Authorization': `Bot ${process.env.DISCORD_TOKEN}`,
          'Content-Type': 'application/json'
        }
      });

      if (!channelsResponse.ok) {
        console.error('[DISCORD-CHANNELS-002] Failed to fetch channels:', channelsResponse.status);
        return res.status(502).json({ error: 'No se pudieron obtener los canales de Discord.' });
      }

      const channels = await channelsResponse.json();

      // Filter and format channels
      const formattedChannels = channels
        .filter((channel: any) => channel.type === 0 || channel.type === 2) // Text (0) and Voice (2) channels
        .map((channel: any) => ({
          id: channel.id,
          name: channel.name,
          type: channel.type === 0 ? 'text' : 'voice',
          category: channel.parent_id ? channels.find((c: any) => c.id === channel.parent_id)?.name || 'No Category' : 'No Category'
        }))
        .sort((a: any, b: any) => a.name.localeCompare(b.name));

      console.log(`[DISCORD-CHANNELS-003] Found ${formattedChannels.length} channels`);
      res.json(formattedChannels);

    } catch (error) {
      console.error('[DISCORD-CHANNELS-ERROR]', error);
      res.status(500).json({ error: 'No se pudieron obtener los canales de Discord.' });
    }
  });
}
