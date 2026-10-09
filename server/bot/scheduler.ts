import type { Guild, GuildTextBasedChannel } from 'discord.js';
import type { ContentFeed } from '@shared/schema';
import { CONTENT_FEED_LIMITS, type NewsFeedConfig } from '@shared/api';
import { DiscordBot } from './index';
import { storage } from '../storage';
import { redditService } from '../services/reddit';
import { formatNewsItem, loadFeed, type FeedItem } from '../services/rss';
import { dailyQuestions } from './services/dailyQuestion';
import { resolveSendableChannel } from './services/channels';

const SUBREDDIT_REGEX = new RegExp(CONTENT_FEED_LIMITS.subredditPattern);
// Noticias de más de 3 días no se publican (salvo la primera vez, para que se vea que el feed funciona)
const NEWS_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;

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
      if (feed.source !== 'reddit' && feed.source !== 'rss') {
        // No hay integración real con Twitter/X: nunca publicamos contenido inventado
        console.warn(`[FEEDS] ${label}: las publicaciones de ${feed.source === 'twitter' ? 'Twitter/X' : feed.source} todavía no están disponibles; no se publica nada.`);
        return;
      }

      // Antes de pedirle nada a Reddit o al sitio de noticias: ¿puedo publicar en ese canal?
      const check = resolveSendableChannel(guild, feed.channelId);
      if (!check.ok) {
        console.warn(`[FEEDS] ${label}: no puedo publicar en el canal ${feed.channelId ?? '(sin canal)'}: ${plainReason(check.reason)} Lo vuelvo a intentar en ${feed.postInterval} min.`);
        return;
      }

      if (feed.source === 'rss') {
        await this.postNews(guild, feed, check.channel, label);
        return;
      }

      const subreddit = subredditOf(feed);
      if (!subreddit || !SUBREDDIT_REGEX.test(subreddit)) {
        console.warn(`[FEEDS] ${label}: el feed no tiene un subreddit válido configurado; no se publica nada.`);
        return;
      }

      const posts = await redditService.getImagePosts(subreddit);
      if (posts.length === 0) {
        console.warn(`[FEEDS] ${label}: Reddit no devolvió ninguna imagen de r/${subreddit}; lo vuelvo a intentar en ${feed.postInterval} min.`);
        return;
      }

      // Nada que ya haya salido en este feed (posted_content)
      const alreadyPosted = await storage.getPostedSourceIds(feed.id, posts.map(post => post.id));
      const fresh = posts.filter(post => !alreadyPosted.has(post.id));
      if (fresh.length === 0) {
        console.log(`[FEEDS] ${label}: ya publiqué todas las imágenes que hay ahora en r/${subreddit}; espero a que salgan nuevas (${feed.postInterval} min).`);
        return;
      }
      const content = fresh[Math.floor(Math.random() * fresh.length)];

      const sent = await check.channel.send(redditService.formatPostForDiscord(content));
      console.log(`[FEEDS] Publiqué contenido de r/${subreddit} en ${guild.name}.`);

      await storage.recordPostedContent({
        feedId: feed.id,
        sourceId: content.id,
        messageId: sent.id,
        title: content.title.slice(0, 300),
        url: `https://reddit.com${content.permalink}`,
      }).catch((error) => {
        console.error(`[FEEDS] ${label}: no se pudo apuntar la publicación (podría repetirse):`, error);
      });
    } catch (error) {
      console.error(`[FEEDS] ${label}: no se pudo publicar; lo vuelvo a intentar en ${feed.postInterval} min.`, error);
    }
  }

  // Noticias: publica lo nuevo del feed (como mucho newsMaxPerTurn, de lo más viejo a lo más nuevo)
  // y da por visto todo lo demás, para no llenar el canal ni repetir.
  private async postNews(guild: Guild, feed: ContentFeed, channel: GuildTextBasedChannel, label: string) {
    const config = newsConfigOf(feed);
    if (!config) {
      console.warn(`[FEEDS] ${label}: el feed de noticias no tiene un enlace guardado; no se publica nada.`);
      return;
    }
    const name = config.title ?? 'Noticias';

    let items: FeedItem[];
    try {
      items = (await loadFeed(config.url)).items;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.warn(`[FEEDS] ${label}: no pude leer ${name}: ${reason} Lo vuelvo a intentar en ${feed.postInterval} min.`);
      return;
    }
    if (items.length === 0) {
      console.log(`[FEEDS] ${label}: ${name} no tiene noticias ahora; lo vuelvo a revisar en ${feed.postInterval} min.`);
      return;
    }

    const firstTime = !(await storage.hasPostedContent(feed.id));
    const seen = await storage.getPostedSourceIds(feed.id, items.map(item => item.sourceId));
    if (seen.size > 0) await storage.touchPostedContent(feed.id, [...seen]);

    const fresh = newestFirst(items.filter(item => !seen.has(item.sourceId)));
    if (fresh.length === 0) {
      console.log(`[FEEDS] ${label}: nada nuevo en ${name}; lo vuelvo a revisar en ${feed.postInterval} min.`);
      return;
    }

    const now = Date.now();
    const toPost = firstTime
      ? fresh.slice(0, 1)
      : fresh
          .filter(item => !item.published || now - item.published.getTime() <= NEWS_MAX_AGE_MS)
          .slice(0, CONTENT_FEED_LIMITS.newsMaxPerTurn);
    const postIds = new Set(toPost.map(item => item.sourceId));
    const skipped = fresh.filter(item => !postIds.has(item.sourceId)).map(item => item.sourceId);
    if (skipped.length > 0) await storage.recordSeenContent(feed.id, skipped);

    let posted = 0;
    for (const item of [...toPost].reverse()) {
      let messageId: string | null = null;
      try {
        const sent = await channel.send(formatNewsItem(name, item));
        messageId = sent.id;
        posted++;
      } catch (error) {
        // Se apunta igual como vista: si Discord la rechaza, reintentarla cada turno no la arregla
        console.error(`[FEEDS] ${label}: Discord no aceptó la noticia "${item.title.slice(0, 80)}":`, error);
      }
      await storage.recordPostedContent({
        feedId: feed.id,
        sourceId: item.sourceId,
        messageId,
        title: item.title.slice(0, 300),
        url: item.link,
      }).catch((error) => {
        console.error(`[FEEDS] ${label}: no se pudo apuntar la noticia (podría repetirse):`, error);
      });
    }
    if (posted > 0) {
      console.log(`[FEEDS] Publiqué ${posted} ${posted === 1 ? 'noticia' : 'noticias'} de ${name} en ${guild.name}.`);
    } else if (toPost.length === 0) {
      console.log(`[FEEDS] ${label}: lo nuevo de ${name} tiene más de 3 días; no lo publico.`);
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

// sourceConfig de un feed de noticias: { url, title?, ... } (lo arma el servidor al crearlo)
function newsConfigOf(feed: ContentFeed): NewsFeedConfig | null {
  const config = feed.sourceConfig;
  if (!config || typeof config !== 'object' || Array.isArray(config)) return null;
  const { url, title } = config as Record<string, unknown>;
  if (typeof url !== 'string' || !url) return null;
  return { url, title: typeof title === 'string' && title.trim() ? title.trim() : undefined };
}

// Lo más nuevo primero. Si alguna noticia no trae fecha, se respeta el orden del feed (casi siempre ya va así)
function newestFirst(items: FeedItem[]): FeedItem[] {
  if (items.some(item => !item.published)) return items;
  return [...items].sort((a, b) => b.published!.getTime() - a.published!.getTime());
}

// Los motivos de channels.ts vienen con formato de Discord (**negritas**); en el log van en texto plano
function plainReason(reason: string): string {
  return reason.replace(/\*\*/g, '');
}
