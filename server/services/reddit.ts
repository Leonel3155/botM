import { XMLParser } from 'fast-xml-parser';
import type { MessageCreateOptions } from 'discord.js';
import { decodeEntities, stripDoctype } from './rss';
import { SafeFetchError, safeFetchText } from './safeFetch';

// Reddit cerró en 2026 la lectura sin cuenta de sus listas en JSON (error 403 con cualquier User-Agent).
// El RSS público (Atom) de cada subreddit sigue abierto y sin claves: de ahí salen los feeds de Reddit.
// Reddit contesta 429 si se le pide RSS muy seguido, así que las consultas van espaciadas, cada lista
// se reutiliza unos minutos y, si Reddit pide esperar, no se le pregunta nada hasta que pase ese rato.

export interface RedditPost {
  /** ID de Reddit sin el "t3_" (el mismo que daba el JSON: lo ya publicado no se repite). */
  id: string;
  title: string;
  /** A dónde apunta la publicación (la imagen, en las de imagen). */
  url: string;
  /** Ruta de la publicación en Reddit: /r/x/comments/... */
  permalink: string;
  author: string | null;
  subreddit: string;
  createdAt: Date | null;
  /** Miniatura que pone Reddit (no la pone en las NSFW ni en las de spoiler). */
  thumbnail: string | null;
}

export class RedditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RedditError';
  }
}

export interface RedditServiceOptions {
  baseUrl?: string;
  /** Espera mínima entre dos consultas a Reddit. */
  minGapMs?: number;
  /** Cuánto se reutiliza la lista de un subreddit antes de volver a pedirla. */
  cacheMs?: number;
  /** Solo para pruebas locales. */
  allowPrivateHosts?: boolean;
}

const REDDIT_TIMEOUT_MS = 15_000;
const MIN_GAP_MS = 20_000;
const CACHE_MS = 10 * 60_000;
// Si Reddit falla, se sigue usando la última lista leída mientras no tenga más de esto
const STALE_MS = 60 * 60_000;
// Tras un error con un subreddit (no existe, privado, caído) no se le vuelve a preguntar en este rato
const ERROR_BACKOFF_MS = 5 * 60_000;
// Pausa cuando Reddit contesta 429: la que pida (Retry-After) dentro de estos límites
const RATE_PAUSE_DEFAULT_MS = 5 * 60_000;
const RATE_PAUSE_MIN_MS = 60_000;
const RATE_PAUSE_MAX_MS = 30 * 60_000;
const LISTING_SIZE = 50;
const MAX_ENTRIES = 200;
const ATOM_ACCEPT = 'application/atom+xml, application/xml;q=0.9, text/xml;q=0.9, */*;q=0.1';
const IMAGE_PATH = /\.(jpe?g|png|gif|webp)$/i;
// Miniaturas de verdad (las que Reddit pone a modo de aviso vienen de redditstatic.com)
const REDDIT_MEDIA_HOST = /(^|\.)(redditmedia\.com|redd\.it)$/i;
const NSFW_TITLE = /\b(nsfw|nsfl)\b/i;
const REDDIT_ICON = 'https://www.redditstatic.com/desktop2x/img/favicon/favicon-32x32.png';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  processEntities: true,
  htmlEntities: true,
  isArray: (name) => ['entry', 'link', 'category', 'media:thumbnail'].includes(name),
});

type Node = Record<string, unknown>;

function isNode(value: unknown): value is Node {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function first(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value;
}

function asList(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function textOf(value: unknown): string | null {
  const node = first(value);
  if (typeof node === 'string') return node.trim() || null;
  if (typeof node === 'number') return String(node);
  if (isNode(node)) return textOf(node['#text']);
  return null;
}

function attr(value: unknown, name: string): string | null {
  const node = first(value);
  if (!isNode(node)) return null;
  const raw = node[`@_${name}`];
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
}

function httpUrl(raw: string | null | undefined): URL | null {
  if (!raw) return null;
  try {
    const url = new URL(decodeEntities(raw.trim()));
    return (url.protocol === 'https:' || url.protocol === 'http:') && url.toString().length <= 2000 ? url : null;
  } catch {
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function minutes(ms: number): number {
  return Math.max(1, Math.ceil(ms / 60_000));
}

function shorten(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

/** Una entrada del Atom de Reddit → publicación (o null si no es una publicación). */
function parseEntry(entry: Node, fallbackSubreddit: string): RedditPost | null {
  const id = /^t3_([a-z0-9]{1,16})$/i.exec(textOf(entry.id) ?? '')?.[1]?.toLowerCase();
  if (!id) return null;

  // Cuerpo en HTML: "submitted by /u/x [link] [comments]"; [link] apunta a la imagen o al sitio enlazado
  const html = textOf(entry.content) ?? '';
  const linkHref = /<a\s[^>]*?href\s*=\s*"([^"]+)"[^>]*>\s*\[link\]\s*<\/a>/i.exec(html)?.[1];
  const imgSrc = /<img\b[^>]*?\ssrc\s*=\s*"([^"]+)"/i.exec(html)?.[1];

  const permalinkUrl = httpUrl(attr(entry.link, 'href'));
  const permalink =
    permalinkUrl && /(^|\.)reddit\.com$/i.test(permalinkUrl.hostname) ? permalinkUrl.pathname : `/comments/${id}/`;
  const target = httpUrl(linkHref) ?? permalinkUrl;
  if (!target) return null;

  const authorNode = first(entry.author);
  const author = isNode(authorNode) ? textOf(authorNode.name)?.replace(/^\/?u\//i, '') ?? null : null;
  const title = decodeEntities(textOf(entry.title) ?? '').replace(/\s+/g, ' ').trim();
  const published = textOf(entry.published) ?? textOf(entry.updated);
  const createdAt = published ? new Date(published) : null;

  return {
    id,
    title: title || 'Sin título',
    url: target.toString(),
    permalink,
    author: author || null,
    subreddit: attr(entry.category, 'term') ?? fallbackSubreddit,
    createdAt: createdAt && !Number.isNaN(createdAt.getTime()) ? createdAt : null,
    thumbnail: (httpUrl(attr(entry['media:thumbnail'], 'url')) ?? httpUrl(imgSrc))?.toString() ?? null,
  };
}

/** Lee el Atom de un subreddit. Devuelve null si el texto no es un feed (p. ej. la página de iniciar sesión). */
export function parseRedditFeed(xml: string, subreddit: string): RedditPost[] | null {
  let doc: unknown;
  try {
    doc = parser.parse(stripDoctype(xml.replace(/^﻿/, '')));
  } catch {
    return null;
  }
  const feed = isNode(doc) ? first(doc.feed) : null;
  if (!isNode(feed)) return null;

  const posts: RedditPost[] = [];
  const ids = new Set<string>();
  for (const raw of asList(feed.entry).slice(0, MAX_ENTRIES)) {
    if (!isNode(raw)) continue;
    const post = parseEntry(raw, subreddit);
    if (!post || ids.has(post.id)) continue;
    ids.add(post.id);
    posts.push(post);
  }
  return posts;
}

/** Enlace directo a una imagen (i.redd.it o cualquier .jpg/.png/.gif/.webp). */
export function isImagePost(post: RedditPost): boolean {
  const url = httpUrl(post.url);
  return !!url && IMAGE_PATH.test(url.pathname);
}

// El RSS no dice qué es NSFW. A quien lee sin cuenta, Reddit no le pone miniatura en las publicaciones
// NSFW ni en las de spoiler, así que solo pasan las que traen una miniatura de Reddit sin difuminar
// y no dicen NSFW/NSFL en el título.
export function looksSafeForWork(post: RedditPost): boolean {
  if (NSFW_TITLE.test(post.title)) return false;
  const thumbnail = httpUrl(post.thumbnail);
  if (!thumbnail || !REDDIT_MEDIA_HOST.test(thumbnail.hostname)) return false;
  return !thumbnail.searchParams.has('blur');
}

export class RedditService {
  private readonly baseUrl: string;
  private readonly minGapMs: number;
  private readonly cacheMs: number;
  private readonly allowPrivateHosts: boolean;
  private readonly lists = new Map<string, { posts: RedditPost[]; fetchedAt: number }>();
  private readonly failures = new Map<string, { message: string; until: number }>();
  private pausedUntil = 0;
  private lastRequestAt = 0;
  private queue: Promise<void> = Promise.resolve();

  constructor(options: RedditServiceOptions = {}) {
    this.baseUrl = (options.baseUrl ?? 'https://www.reddit.com').replace(/\/+$/, '');
    this.minGapMs = options.minGapMs ?? MIN_GAP_MS;
    this.cacheMs = options.cacheMs ?? CACHE_MS;
    this.allowPrivateHosts = options.allowPrivateHosts ?? false;
  }

  /** Publicaciones de "hot" con imagen y sin señales de NSFW (van a canales normales del servidor). */
  async getImagePosts(subreddit: string): Promise<RedditPost[]> {
    const posts = await this.getHotPosts(subreddit);
    return posts.filter((post) => isImagePost(post) && looksSafeForWork(post));
  }

  /** Lista "hot" del subreddit (todas las publicaciones). Lanza RedditError si no se puede leer. */
  async getHotPosts(subreddit: string): Promise<RedditPost[]> {
    const key = subreddit.toLowerCase();
    const cached = this.lists.get(key);
    if (cached && Date.now() - cached.fetchedAt < this.cacheMs) return cached.posts;

    try {
      const posts = await this.fetchListing(subreddit);
      this.forgetOldLists();
      this.lists.set(key, { posts, fetchedAt: Date.now() });
      return posts;
    } catch (error) {
      // Mejor la lista de hace un rato que nada (lo ya publicado no se repite)
      if (cached && Date.now() - cached.fetchedAt < STALE_MS) return cached.posts;
      throw error;
    }
  }

  private async fetchListing(subreddit: string): Promise<RedditPost[]> {
    const key = subreddit.toLowerCase();
    const failure = this.failures.get(key);
    if (failure && Date.now() < failure.until) throw new RedditError(failure.message);

    await this.waitTurn();
    try {
      const posts = await this.download(subreddit);
      this.failures.delete(key);
      return posts;
    } catch (error) {
      const message = error instanceof RedditError ? error.message : 'No pude leer Reddit.';
      // Un 429 ya pausa todas las consultas; lo demás se recuerda solo para este subreddit
      if (Date.now() >= this.pausedUntil) this.failures.set(key, { message, until: Date.now() + ERROR_BACKOFF_MS });
      throw error instanceof RedditError ? error : new RedditError(message);
    }
  }

  // Una consulta a la vez y con espacio entre ellas, para que Reddit no conteste 429
  private waitTurn(): Promise<void> {
    const turn = this.queue.then(async () => {
      this.throwIfPaused();
      const wait = this.lastRequestAt + this.minGapMs - Date.now();
      if (wait > 0) await sleep(wait);
      this.throwIfPaused();
      this.lastRequestAt = Date.now();
    });
    this.queue = turn.catch(() => undefined);
    return turn;
  }

  private throwIfPaused() {
    const left = this.pausedUntil - Date.now();
    if (left > 0) {
      throw new RedditError(`Reddit pidió esperar por demasiadas consultas; no le pregunto nada en ${minutes(left)} min.`);
    }
  }

  private async download(subreddit: string): Promise<RedditPost[]> {
    const url = `${this.baseUrl}/r/${encodeURIComponent(subreddit)}/hot/.rss?limit=${LISTING_SIZE}`;
    let page: Awaited<ReturnType<typeof safeFetchText>>;
    try {
      page = await safeFetchText(url, {
        accept: ATOM_ACCEPT,
        timeoutMs: REDDIT_TIMEOUT_MS,
        allowPrivateHosts: this.allowPrivateHosts,
      });
    } catch (error) {
      if (!(error instanceof SafeFetchError)) throw new RedditError('No pude conectar con Reddit.');
      if (error.status === 429) {
        const pause = Math.min(RATE_PAUSE_MAX_MS, Math.max(RATE_PAUSE_MIN_MS, error.retryAfterMs ?? RATE_PAUSE_DEFAULT_MS));
        this.pausedUntil = Date.now() + pause;
        throw new RedditError(`Reddit pidió esperar por demasiadas consultas; no le pregunto nada en ${minutes(pause)} min.`);
      }
      if (error.status === 401 || error.status === 403) {
        throw new RedditError(`Reddit no deja leer r/${subreddit} (error ${error.status}): puede ser privado, o Reddit está bloqueando la conexión.`);
      }
      if (error.status === 404 || error.status === 410) throw new RedditError(`r/${subreddit} no existe o fue cerrado.`);
      throw new RedditError(`No pude leer Reddit: ${error.message}`);
    }

    // Reddit manda a otra página (iniciar sesión, aviso +18, búsqueda) lo que no deja ver sin cuenta
    const unreadable = `Reddit no deja leer r/${subreddit} sin cuenta: no existe, es privado, NSFW o está en cuarentena.`;
    const finalPath = new URL(page.url).pathname.toLowerCase();
    if (!finalPath.startsWith(`/r/${subreddit.toLowerCase()}/`)) throw new RedditError(unreadable);
    const posts = parseRedditFeed(page.text, subreddit);
    if (!posts) throw new RedditError(unreadable);
    return posts;
  }

  private forgetOldLists() {
    const now = Date.now();
    for (const [key, entry] of this.lists) {
      if (now - entry.fetchedAt >= STALE_MS) this.lists.delete(key);
    }
  }

  formatPostForDiscord(post: RedditPost): MessageCreateOptions {
    return {
      embeds: [{
        color: 0xff4500, // naranja de Reddit
        title: shorten(post.title, 256),
        url: `https://www.reddit.com${post.permalink}`,
        image: { url: post.url },
        footer: {
          text: post.author ? `r/${post.subreddit} • u/${post.author}` : `r/${post.subreddit}`,
          icon_url: REDDIT_ICON,
        },
        ...(post.createdAt ? { timestamp: post.createdAt.toISOString() } : {}),
      }],
      allowedMentions: { parse: [] },
    };
  }
}

export const redditService = new RedditService();
