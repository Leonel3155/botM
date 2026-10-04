import { DiscordBot } from './index';
import { storage } from '../storage';
import { redditService } from '../services/reddit';
import { twitterService } from '../services/twitter';

export class ContentScheduler {
  private bot: DiscordBot;
  private scheduledJobs: Map<string, NodeJS.Timeout> = new Map();

  constructor(bot: DiscordBot) {
    this.bot = bot;
  }

  async startScheduler() {
    console.log('🕐 Content scheduler started');
    
    // Check for scheduled content every minute
    setInterval(async () => {
      await this.checkScheduledContent();
    }, 60000);

    // Initial check
    await this.checkScheduledContent();
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
        // For Twitter, use mock content if API not available
        const mockContent = twitterService.getMockTweet();
        await channel.send(mockContent);
        
        console.log(`Posted Twitter content to ${guild.name}`);
      }

      // Update last posted time
      // This would need a new method in storage to update the feed
      // For now, we'll just log success

    } catch (error) {
      console.error(`Error posting content for feed ${feed.id}:`, error);
    }
  }

  stopScheduler() {
    // Clear all scheduled jobs
    for (const [feedId, timeout] of this.scheduledJobs) {
      clearTimeout(timeout);
    }
    this.scheduledJobs.clear();
    
    console.log('🛑 Content scheduler stopped');
  }
}
