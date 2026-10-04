import type { Express, Request, Response } from "express";
import { storage } from "../storage";

// Extend Request type to include session
interface SessionRequest extends Request {
  session: any;
}

export function setupChannelRoutes(app: Express) {
  // Get guild channel configuration
  app.get('/api/guild/:guildId/channels', async (req: SessionRequest, res: Response) => {
    try {
      const { guildId } = req.params;
      console.log(`[CHANNELS-001] Getting channel config for guild: ${guildId}`);
      
      let guild = await storage.getGuild(guildId);
      if (!guild) {
        guild = await storage.createGuild({
          id: guildId,
          name: 'Unknown Guild',
          ownerId: 'unknown',
          prefix: '&'
        });
      }
      
      const channelConfig = {
        musicChannelId: guild.musicChannelId || null,
        contentChannelId: guild.contentChannelId || null,
        moderationChannelId: guild.moderationChannelId || null,
        welcomeChannelId: guild.welcomeChannelId || null,
        redditEnabled: guild.redditEnabled || false,
        twitterEnabled: guild.twitterEnabled || false
      };
      
      console.log(`[CHANNELS-002] Returning channel config:`, channelConfig);
      res.json(channelConfig);
      
    } catch (error) {
      console.error('[CHANNELS-ERROR-001] Failed to get channel config:', error);
      res.status(500).json({ error: 'Failed to get channel configuration' });
    }
  });

  // Update guild channel configuration
  app.put('/api/guild/:guildId/channels', async (req: SessionRequest, res: Response) => {
    try {
      const { guildId } = req.params;
      const { 
        musicChannelId, 
        contentChannelId, 
        moderationChannelId, 
        welcomeChannelId,
        redditEnabled,
        twitterEnabled 
      } = req.body;
      
      console.log(`[CHANNELS-UPDATE-001] Updating channels for guild: ${guildId}`);
      console.log(`[CHANNELS-UPDATE-002] New config:`, req.body);
      
      // Validate channel IDs (Discord snowflake format: 17-19 digits)
      const validateChannelId = (id: string | null) => {
        if (!id) return true; // null is valid (disabled)
        return /^\d{17,19}$/.test(id);
      };
      
      if (musicChannelId && !validateChannelId(musicChannelId)) {
        return res.status(400).json({ error: 'Invalid music channel ID format' });
      }
      
      if (contentChannelId && !validateChannelId(contentChannelId)) {
        return res.status(400).json({ error: 'Invalid content channel ID format' });
      }
      
      if (moderationChannelId && !validateChannelId(moderationChannelId)) {
        return res.status(400).json({ error: 'Invalid moderation channel ID format' });
      }
      
      if (welcomeChannelId && !validateChannelId(welcomeChannelId)) {
        return res.status(400).json({ error: 'Invalid welcome channel ID format' });
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
        musicChannelId: musicChannelId || null,
        contentChannelId: contentChannelId || null,
        moderationChannelId: moderationChannelId || null,
        welcomeChannelId: welcomeChannelId || null,
        redditEnabled: !!redditEnabled,
        twitterEnabled: !!twitterEnabled
      });
      
      console.log(`[CHANNELS-UPDATE-003] Successfully updated channel configuration`);
      res.json({ success: true });
      
    } catch (error) {
      console.error('[CHANNELS-UPDATE-ERROR]', error);
      res.status(500).json({ error: 'Failed to update channel configuration' });
    }
  });

  // Get available Discord channels for a guild (requires authentication)
  app.get('/api/guild/:guildId/discord-channels', async (req: SessionRequest, res: Response) => {
    try {
      const { guildId } = req.params;
      
      if (!req.session?.authenticated || !req.session?.discordToken) {
        return res.status(401).json({ 
          error: 'Authentication required to fetch Discord channels' 
        });
      }
      
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
        return res.status(500).json({ error: 'Failed to fetch Discord channels' });
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
      res.status(500).json({ error: 'Failed to fetch Discord channels' });
    }
  });
}