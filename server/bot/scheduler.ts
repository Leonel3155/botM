import type { Guild } from 'discord.js';
import type { ContentFeed } from '@shared/schema';
import { CONTENT_FEED_LIMITS } from '@shared/api';
import { DiscordBot } from './index';
import { storage } from '../storage';
import { redditService } from '../services/reddit';
import { dailyQuestions } from './services/dailyQuestion';
import { resolveSendableChannel } from './services/channels';

const SUBREDDIT_REGEX = new RegExp(CONTENT_FEED_LIMITS.subredditPattern);

export class ContentScheduler {
  private bot: DiscordBot;
  private interval: NodeJS.Timeout | null = null;
  // Evita dos repasos de feeds a la vez si uno tarda más de un minuto (Reddit lento)
  private checkingContent = false;

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
    if (this.checkingContent) return;
    this.checkingContent = true;
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
      console.error('[FEEDS] Error al revisar los feeds de contenido:', error);
    } finally {
      this.checkingContent = false;
    }
  }

  // Cada turno del feed cuenta como un intento (lastPosted = "último intento" en el panel), salga bien o mal:
  // si falla (canal borrado, sin permisos, Reddit sin respuesta o error al enviar) el siguiente intento
  // espera el intervalo completo del feed en vez de repetirse cada minuto.
  private async postContent(guild: Guild, feed: ContentFeed) {
    const label = `Feed ${feed.id} (${guild.name})`;

    // Primero se marca el intento: así ni un error ni un reinicio a medias hacen que se reintente enseguida
    try {
      await storage.updateContentFeed(feed.id, guild.id, { lastPosted: new Date() });
    } catch (error) {
      console.error(`[FEEDS] ${label}: no se pudo guardar la hora del intento; lo dejo para el próximo minuto.`, error);
      return;
    }

    try {
      if (feed.source !== 'reddit') {
        // No hay integración real con Twitter/X: nunca publicamos contenido inventado
        console.warn(`[FEEDS] ${label}: las publicaciones de ${feed.source === 'twitter' ? 'Twitter/X' : feed.source} todavía no están disponibles; no se publica nada.`);
        return;
      }

      // Antes de pedirle nada a Reddit: ¿puedo publicar en ese canal?
      const check = resolveSendableChannel(guild, feed.channelId);
      if (!check.ok) {
        console.warn(`[FEEDS] ${label}: no puedo publicar en el canal ${feed.channelId ?? '(sin canal)'}: ${plainReason(check.reason)} Lo vuelvo a intentar en ${feed.postInterval} min.`);
        return;
      }

      const subreddit = subredditOf(feed);
      if (!subreddit || !SUBREDDIT_REGEX.test(subreddit)) {
        console.warn(`[FEEDS] ${label}: el feed no tiene un subreddit válido configurado; no se publica nada.`);
        return;
      }

      const content = await redditService.getRandomMeme([subreddit]);
      if (!content) {
        console.warn(`[FEEDS] ${label}: Reddit no devolvió ninguna imagen de r/${subreddit}; lo vuelvo a intentar en ${feed.postInterval} min.`);
        return;
      }

      await check.channel.send(redditService.formatPostForDiscord(content));
      console.log(`[FEEDS] Publiqué contenido de r/${subreddit} en ${guild.name}.`);
    } catch (error) {
      console.error(`[FEEDS] ${label}: no se pudo publicar; lo vuelvo a intentar en ${feed.postInterval} min.`, error);
    }
  }

  stopScheduler() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }

    console.log('🛑 Content scheduler stopped');
  }
}

// sourceConfig es JSON libre: el subreddit se lee con cuidado
function subredditOf(feed: ContentFeed): string | null {
  const config = feed.sourceConfig;
  if (!config || typeof config !== 'object' || Array.isArray(config)) return null;
  const value = (config as Record<string, unknown>).subreddit;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

// Los motivos de channels.ts vienen con formato de Discord (**negritas**); en el log van en texto plano
function plainReason(reason: string): string {
  return reason.replace(/\*\*/g, '');
}
