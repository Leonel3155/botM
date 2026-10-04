import type { Express, Request, Response } from "express";
import { ChannelType, type GuildBasedChannel } from "discord.js";
import { z } from "zod";
import type {
  ChannelConfigResponse,
  DiscordChannelKind,
  DiscordChannelsResponse,
  SuccessResponse,
} from "@shared/api";
import { storage } from "../storage";
import { checkSendableChannel } from "../bot/services/channels";
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
  // La música se eliminó, pero la página de canales actual aún manda este campo: se acepta y se ignora.
  // Quitarlo cuando la página nueva deje de enviarlo.
  musicChannelId: z.union([z.string(), z.null()])
}).partial().strict();

// Canales que se muestran en el panel
const CHANNEL_KINDS: Partial<Record<ChannelType, DiscordChannelKind>> = {
  [ChannelType.GuildText]: 'text',
  [ChannelType.GuildAnnouncement]: 'announcement',
  [ChannelType.GuildVoice]: 'voice'
};

export function setupChannelRoutes(app: Express) {
  // Get guild channel configuration
  app.get('/api/guild/:guildId/channels', requireAuth, requireGuildAdmin, async (req: Request, res: Response) => {
    try {
      const { guildId } = req.params;
      console.log(`[CHANNELS-001] Getting channel config for guild: ${guildId}`);

      // Solo lectura: si el servidor aún no está en la BD devolvemos los valores por defecto
      const guild = await storage.getGuild(guildId);

      const channelConfig: ChannelConfigResponse = {
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
      const result: SuccessResponse = { success: true };
      res.json(result);

    } catch (error) {
      console.error('[CHANNELS-UPDATE-ERROR]', error);
      res.status(500).json({ error: 'No se pudo guardar la configuración de canales.' });
    }
  });

  // Get available Discord channels for a guild (requires authentication)
  app.get('/api/guild/:guildId/discord-channels', requireAuth, requireGuildAdmin, requireBotInGuild, async (req: Request, res: Response) => {
    try {
      const { guildId } = req.params;

      console.log(`[DISCORD-CHANNELS-001] Listing Discord channels for guild: ${guildId}`);

      // Canales de la caché del bot (llegan por el gateway): sin llamar a la API REST
      // de Discord en cada visita, así no gastamos el rate limit del token del bot.
      // Orden como en Discord: por categoría y luego por posición dentro de ella.
      const sortKey = (channel: GuildBasedChannel) => [
        channel.parent?.rawPosition ?? -1,
        'rawPosition' in channel ? channel.rawPosition : 0
      ];
      const formattedChannels: DiscordChannelsResponse = getBotGuild(res).channels.cache
        .filter((channel) => CHANNEL_KINDS[channel.type] !== undefined)
        .sort((a, b) => {
          const [parentA, positionA] = sortKey(a);
          const [parentB, positionB] = sortKey(b);
          return parentA - parentB || positionA - positionB || a.name.localeCompare(b.name);
        })
        .map((channel) => {
          const type = CHANNEL_KINDS[channel.type] as DiscordChannelKind;
          return {
            id: channel.id,
            name: channel.name,
            type,
            category: channel.parent?.name || 'Sin categoría',
            botCanPost: type !== 'voice' && checkSendableChannel(channel).ok
          };
        });

      console.log(`[DISCORD-CHANNELS-003] Found ${formattedChannels.length} channels`);
      res.json(formattedChannels);

    } catch (error) {
      console.error('[DISCORD-CHANNELS-ERROR]', error);
      res.status(500).json({ error: 'No se pudieron obtener los canales de Discord.' });
    }
  });
}
