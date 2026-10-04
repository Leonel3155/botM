import { DiscordBot } from './index';
import { storage } from '../storage';
import { redditService } from '../services/reddit';
import { dailyQuestions } from './services/dailyQuestion';

export class ContentScheduler {
  private bot: DiscordBot;
  private scheduledJobs: Map<string, NodeJS.Timeout> = new Map();
  private interval: NodeJS.Timeout | null = null;

  constructor(bot: DiscordBot) {
    this.bot = bot;
  }

  async startScheduler() {
    console.log('🕐 Content scheduler started');
    
    // Check for scheduled content and the daily question every minute
    this.interval = setInterval(async () => {
      await this.runChecks();
    }, 60000);

    // Initial check
    await this.runChecks();
  }

  private async runChecks() {
    await Promise.all([
      this.checkScheduledContent(),
      this.checkDailyQuestions(),
    ]);
  }

  // Pregunta del día: publica a la hora configurada en la zona horaria de cada servidor
  private async checkDailyQuestions() {
    try {
      await dailyQuestions.tick(this.bot.client);
    } catch (error) {
      console.error('Error checking daily questions:', error);
    }
  }

  private async checkScheduledContent() {
    try {
      // Get all guilds the bot is in
      for (const [guildId, guild] of this.bot.client.guilds.cache) {
        const feeds = await storage.getContentFeeds(guildId);
        
        for (const feed of feeds) {
          if (!feed.enabled) continue;
          
          const now = Date.now();
          const lastPosted = feed.lastPosted ? new Date(feed.lastPosted).getTime() : 0;
          const intervalMs = feed.postInterval * 60 * 1000; // Convert minutes to milliseconds
          
          if (now - lastPosted >= intervalMs) {
            await this.postContent(guild, feed);
          }
        }
      }
    } catch (error) {
      console.error('Error checking scheduled content:', error);
    }
  }

  private async postContent(guild: any, feed: any) {
    try {
      const channel = guild.channels.cache.get(feed.channelId);
      if (!channel || !channel.isTextBased()) {
        console.warn(`Channel ${feed.channelId} not found or not text-based`);
        return;
      }

      let content = null;

      if (feed.source === 'reddit') {
        const subreddit = feed.sourceConfig?.subreddit || 'memes';
        content = await redditService.getRandomMeme([subreddit]);
        
        if (content) {
          const embed = redditService.formatPostForDiscord(content);
          await channel.send(embed);
          
          console.log(`Posted Reddit content from r/${subreddit} to ${guild.name}`);
        }
      } else if (feed.source === 'twitter') {
        // No hay integración real con Twitter/X: nunca publicamos contenido inventado
        console.warn(`Feed ${feed.id} (${guild.name}): las publicaciones de Twitter/X todavía no están disponibles; no se publica nada.`);
      }

      // Guardamos la hora para respetar postInterval (sin esto el feed publicaría cada minuto).
      // También cuenta un intento sin contenido (p. ej. Reddit no respondió) para no reintentar cada minuto.
      await storage.updateContentFeed(feed.id, guild.id, { lastPosted: new Date() });

    } catch (error) {
      console.error(`Error posting content for feed ${feed.id}:`, error);
    }
  }

  stopScheduler() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }

    // Clear all scheduled jobs
    for (const [feedId, timeout] of this.scheduledJobs) {
      clearTimeout(timeout);
    }
    this.scheduledJobs.clear();
    
    console.log('🛑 Content scheduler stopped');
  }
}
