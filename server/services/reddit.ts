import { XMLParser } from 'fast-xml-parser';
import type { IncomingHttpHeaders } from 'http';
import type { MessageCreateOptions } from 'discord.js';
import { decodeEntities, FeedError, parseFeed, stripDoctype, type ParsedFeed } from './rss';
import { SafeFetchError, safeFetchText, type SafeFetchResult } from './safeFetch';

// Reddit cerró en 2026 la lectura sin cuenta de sus listas en JSON (error 403 con cualquier User-Agent).
// El RSS público (Atom) de cada subreddit sigue abierto y sin claves: de ahí salen los feeds de Reddit.
// Ese RSS deja hacer más o menos una consulta por minuto (contando todos los subreddits juntos) y
// contesta 429 si se le pide más: las consultas van de una en una, al ritmo que marcan sus cabeceras
// x-ratelimit-*, cada lista se reutiliza unos minutos y, si Reddit pide esperar, se espera.
// Reddit anunció que apaga el RSS el 13 de noviembre de 2026.
//
// Con REDDIT_CLIENT_ID y REDDIT_CLIENT_SECRET en el .env (una app de Reddit del dueño del bot), los feeds
// usan la API oficial en vez del RSS: sigue funcionando después del apagado, deja unas 100 consultas por
// minuto y dice de verdad qué publicación es NSFW (over_18).

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
  /** Miniatura que pone Reddit (a quien lee sin cuenta no se la pone en las NSFW). */
  thumbnail: string | null;
  /** Lo que dice la API oficial (over_18, también en subreddits NSFW). El RSS no lo dice: undefined. */
  nsfw?: boolean;
}

export interface RedditCredentials {
  clientId: string;
  clientSecret: string;
  /** Tu usuario de Reddit: Reddit pide que vaya en el User-Agent de las apps. */
  username: string | null;
}

/** Claves de la app de Reddit del .env (o null si faltan). */
export function credentialsFromEnv(env: NodeJS.ProcessEnv = process.env): RedditCredentials | null {
  const clientId = env.REDDIT_CLIENT_ID?.trim();
  const clientSecret = env.REDDIT_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  const username = env.REDDIT_USERNAME?.trim().replace(/^\/?u\//i, '');
  return { clientId, clientSecret, username: username && /^[\w-]{3,20}$/.test(username) ? username : null };
}

export class RedditError extends Error {
  /** No se llegó a leer porque Reddit está ocupado o pidió esperar: el feed puede volver a intentarlo pronto. */
  readonly retrySoon: boolean;

  constructor(message: string, options: { retrySoon?: boolean } = {}) {
    super(message);
    this.name = 'RedditError';
    this.retrySoon = options.retrySoon ?? false;
  }
}

export interface RedditServiceOptions {
  baseUrl?: string;
  /** Espera entre dos consultas cuando Reddit no dice cuántas quedan. */
  minGapMs?: number;
  /** Lo más que una consulta espera su turno; si falta más, se deja para el siguiente minuto. */
  maxWaitMs?: number;
  /** Cuánto se reutiliza la lista de un subreddit antes de volver a pedirla. */
  cacheMs?: number;
  /** Solo para pruebas locales. */
  allowPrivateHosts?: boolean;
  /** Claves de la API oficial. Sin pasarlas se leen del .env; con null se usa el RSS. */
  credentials?: RedditCredentials | null;
  apiBaseUrl?: string;
  tokenUrl?: string;
}

const REDDIT_TIMEOUT_MS = 15_000;
// Sin cabeceras de límite, una consulta por minuto (lo que deja Reddit desde 2026)
const MIN_GAP_MS = 60_000;
// Con cabeceras que dicen que aún quedan consultas, apenas un respiro entre una y otra
const SHORT_GAP_MS = 2_000;
const MAX_WAIT_MS = 20_000;
const CACHE_MS = 10 * 60_000;
// Si Reddit falla, se sigue usando la última lista leída mientras no tenga más de esto
const STALE_MS = 60 * 60_000;
// Tras un error con un subreddit (no existe, privado, caído) no se le vuelve a preguntar en este rato
const ERROR_BACKOFF_MS = 5 * 60_000;
// Pausa tras un 429: la que diga Reddit; si no dice, 2 min y el doble cada vez que se repite
const RATE_PAUSE_BASE_MS = 2 * 60_000;
const RATE_PAUSE_MIN_MS = 60_000;
const RATE_PAUSE_MAX_MS = 30 * 60_000;
const LISTING_SIZE = 50;
const MAX_ENTRIES = 200;
const ATOM_ACCEPT = 'application/atom+xml, application/xml;q=0.9, text/xml;q=0.9, */*;q=0.1';
const IMAGE_PATH = /\.(jpe?g|png|gif|webp)$/i;
// Solo imágenes subidas a Reddit: la miniatura que se revisa es de esa misma imagen
const IMAGE_HOST = 'i.redd.it';
// Miniaturas de verdad (las que Reddit pone a modo de aviso vienen de redditstatic.com)
const REDDIT_MEDIA_HOST = /(^|\.)(redditmedia\.com|redd\.it)$/i;
const NSFW_TITLE = /\b(nsfw|nsfl)\b/i;
// Subreddits que por el nombre son claramente para adultos (dentro de uno NSFW, Reddit no marca nada)
const NSFW_SUBREDDIT_NAME = /nsfw|porn|gonewild|hentai|rule34|nude|onlyfans|xxx/i;
/** Reddit apaga su RSS público este día (anunciado en septiembre de 2026). */
export const REDDIT_RSS_SHUTDOWN_AT = Date.UTC(2026, 10, 13);
export const REDDIT_RSS_SHUTDOWN_MESSAGE = 'Reddit apagó su RSS público el 13 de noviembre de 2026: los feeds de Reddit ya no pueden publicar.';
const FEED_ACCEPT = 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.9, */*;q=0.1';
const API_BASE_URL = 'https://oauth.reddit.com';
const TOKEN_URL = 'https://www.reddit.com/api/v1/access_token';
// La API deja unas 100 consultas por minuto; sin cabeceras de límite, una por segundo
const API_MIN_GAP_MS = 1_000;
// El permiso dura 24 h; se pide uno nuevo un rato antes de que venza
const TOKEN_MARGIN_MS = 5 * 60_000;
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

function headerValue(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
}

/** Una entrada del Atom de Reddit → publicación (o null si no es una publicación). */
function parseEntry(entry: Node, fallbackSubreddit: string): RedditPost | null {
  const id = /^t3_([a-z0-9]{1,16})$/i.exec(textOf(entry.id) ?? '')?.[1]?.toLowerCase();
  if (!id) return null;

  // Cuerpo en HTML: [miniatura] [texto del post] "submitted by /u/x [link] [comments]". El [link] que vale es
  // el del pie que pone Reddit (apunta a la imagen o al sitio enlazado); el texto del post, que escribe
  // cualquiera, se quita antes para que no pueda colar otro "[link]".
  const html = (textOf(entry.content) ?? '').replace(/<!--\s*SC_OFF\s*-->[\s\S]*?<!--\s*SC_ON\s*-->/gi, ' ');
  const links = [...html.matchAll(/<a\s[^>]*?href\s*=\s*"([^"]+)"[^>]*>\s*\[link\]\s*<\/a>/gi)];
  const linkHref = links.at(-1)?.[1];
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

/** Respuesta de /r/x/hot de la API oficial → publicaciones (o null si no es una lista de Reddit). */
export function parseRedditListing(json: string, subreddit: string): RedditPost[] | null {
  let doc: unknown;
  try {
    doc = JSON.parse(json);
  } catch {
    return null;
  }
  if (!isNode(doc) || doc.kind !== 'Listing' || !isNode(doc.data) || !Array.isArray(doc.data.children)) return null;

  const posts: RedditPost[] = [];
  const ids = new Set<string>();
  for (const child of doc.data.children.slice(0, MAX_ENTRIES)) {
    if (!isNode(child) || child.kind !== 't3' || !isNode(child.data)) continue;
    const data = child.data;
    const id = typeof data.id === 'string' && /^[a-z0-9]{1,16}$/i.test(data.id) ? data.id.toLowerCase() : null;
    const target = httpUrl(typeof data.url === 'string' ? data.url : null);
    if (!id || !target || ids.has(id)) continue;
    ids.add(id);
    const permalink = typeof data.permalink === 'string' && data.permalink.startsWith('/') ? data.permalink : `/comments/${id}/`;
    const title = typeof data.title === 'string' ? data.title.replace(/\s+/g, ' ').trim() : '';
    const author = typeof data.author === 'string' && data.author !== '[deleted]' ? data.author : null;
    const created = typeof data.created_utc === 'number' ? new Date(data.created_utc * 1000) : null;
    posts.push({
      id,
      title: title || 'Sin título',
      url: target.toString(),
      permalink,
      author,
      subreddit: typeof data.subreddit === 'string' ? data.subreddit : subreddit,
      createdAt: created && !Number.isNaN(created.getTime()) ? created : null,
      thumbnail: httpUrl(typeof data.thumbnail === 'string' ? data.thumbnail : null)?.toString() ?? null,
      // Ante la duda (falta el dato, o es spoiler), se trata como NSFW
      nsfw: data.over_18 !== false || data.spoiler === true,
    });
  }
  return posts;
}

/** Imagen subida a Reddit (https://i.redd.it/....jpg/.png/.gif/.webp). */
export function isImagePost(post: RedditPost): boolean {
  const url = httpUrl(post.url);
  return !!url && url.protocol === 'https:' && url.hostname.toLowerCase() === IMAGE_HOST && IMAGE_PATH.test(url.pathname);
}

/** Por el nombre, un subreddit para adultos (el filtro por miniaturas no sirve dentro de esos). */
export function looksLikeNsfwSubreddit(name: string): boolean {
  return NSFW_SUBREDDIT_NAME.test(name);
}

/** ¿Es una dirección de Reddit? (también sus feeds RSS de noticias van al ritmo de Reddit) */
export function isRedditUrl(raw: string): boolean {
  try {
    const host = new URL(raw).hostname.toLowerCase();
    return host === 'reddit.com' || host.endsWith('.reddit.com');
  } catch {
    return false;
  }
}

function afterShutdown(): boolean {
  return Date.now() >= REDDIT_RSS_SHUTDOWN_AT;
}

// El RSS no dice qué es NSFW. A quien lee sin cuenta, Reddit no le pone miniatura a las publicaciones
// NSFW (fuera de subreddits NSFW), así que solo pasan las que traen una miniatura de Reddit sin difuminar
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
  private readonly maxWaitMs: number;
  private readonly cacheMs: number;
  private readonly allowPrivateHosts: boolean;
  private readonly credentials: RedditCredentials | null;
  private readonly apiBaseUrl: string;
  private readonly tokenUrl: string;
  private token: { value: string; expiresAt: number } | null = null;
  private tokenRequest: Promise<string> | null = null;
  private readonly lists = new Map<string, { posts: RedditPost[]; fetchedAt: number }>();
  private readonly failures = new Map<string, { message: string; until: number }>();
  // Cuándo se puede volver a consultar (por el ritmo normal o por una pausa tras un 429)
  private nextRequestAt = 0;
  private pausedUntil = 0;
  private rateLimitStreak = 0;
  private queue: Promise<void> = Promise.resolve();

  constructor(options: RedditServiceOptions = {}) {
    this.baseUrl = (options.baseUrl ?? 'https://www.reddit.com').replace(/\/+$/, '');
    this.credentials = options.credentials === undefined ? credentialsFromEnv() : options.credentials;
    this.apiBaseUrl = (options.apiBaseUrl ?? API_BASE_URL).replace(/\/+$/, '');
    this.tokenUrl = options.tokenUrl ?? TOKEN_URL;
    this.minGapMs = options.minGapMs ?? (this.credentials ? API_MIN_GAP_MS : MIN_GAP_MS);
    this.maxWaitMs = options.maxWaitMs ?? MAX_WAIT_MS;
    this.cacheMs = options.cacheMs ?? CACHE_MS;
    this.allowPrivateHosts = options.allowPrivateHosts ?? false;
  }

  /** Publicaciones de "hot" con imagen y sin señales de NSFW (van a canales normales del servidor). */
  async getImagePosts(subreddit: string): Promise<RedditPost[]> {
    if (looksLikeNsfwSubreddit(subreddit)) {
      throw new RedditError(`r/${subreddit} parece un subreddit para adultos; no publico de ahí en canales normales.`);
    }
    const posts = await this.getHotPosts(subreddit);
    const images = posts.filter(isImagePost);
    // La API dice qué es NSFW (también todo lo de un subreddit NSFW): no hacen falta las miniaturas
    if (this.usesApi) return images.filter((post) => post.nsfw === false && !NSFW_TITLE.test(post.title));
    // Hay subreddits que no muestran miniaturas a quien no tiene cuenta: ahí no hay forma de saber qué es NSFW
    if (images.length > 0 && !posts.some((post) => post.thumbnail)) {
      throw new RedditError(`r/${subreddit} no muestra miniaturas a quien no tiene cuenta, y sin ellas no puedo saber qué es NSFW; por seguridad no publico de ahí.`);
    }
    return images.filter(looksSafeForWork);
  }

  /** Hay claves de Reddit en el .env: los feeds leen la API oficial en vez del RSS. */
  get usesApi(): boolean {
    return this.credentials !== null;
  }

  /** Revisa que las claves de Reddit funcionen (pide permiso a Reddit). Lanza RedditError si no. */
  async checkCredentials(): Promise<void> {
    if (!this.credentials) throw new RedditError('No hay claves de Reddit (REDDIT_CLIENT_ID y REDDIT_CLIENT_SECRET) en el .env.');
    await this.getToken();
  }

  private userAgent(): string {
    // El formato que pide Reddit: plataforma:app:versión (by /u/usuario)
    const by = this.credentials?.username ? ` (by /u/${this.credentials.username})` : '';
    return `discord:botm:1.0${by}`;
  }

  private getToken(): Promise<string> {
    if (this.token && Date.now() < this.token.expiresAt) return Promise.resolve(this.token.value);
    this.tokenRequest ??= this.requestToken().finally(() => {
      this.tokenRequest = null;
    });
    return this.tokenRequest;
  }

  // Permiso "solo de la app" (client_credentials): lee lo público, sin entrar con tu cuenta
  private async requestToken(): Promise<string> {
    const credentials = this.credentials!;
    const basic = Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`).toString('base64');
    let page: SafeFetchResult;
    try {
      page = await safeFetchText(this.tokenUrl, {
        form: 'grant_type=client_credentials',
        headers: { Authorization: `Basic ${basic}`, 'User-Agent': this.userAgent() },
        accept: 'application/json',
        timeoutMs: REDDIT_TIMEOUT_MS,
        allowPrivateHosts: this.allowPrivateHosts,
      });
    } catch (error) {
      if (error instanceof SafeFetchError && (error.status === 401 || error.status === 403)) {
        throw new RedditError('Reddit no aceptó tus claves (REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET). Revisa que estén bien copiadas y que la app sea de tipo "script".');
      }
      if (error instanceof SafeFetchError && error.status === 429) {
        throw new RedditError('Reddit pidió esperar antes de dar permiso; lo vuelvo a intentar en un rato.', { retrySoon: true });
      }
      throw new RedditError(`No pude pedirle permiso a Reddit: ${error instanceof Error ? error.message : String(error)}`);
    }
    let body: unknown;
    try {
      body = JSON.parse(page.text);
    } catch {
      body = null;
    }
    const value = isNode(body) && typeof body.access_token === 'string' ? body.access_token : null;
    if (!value) {
      throw new RedditError('Reddit no aceptó tus claves (REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET). Revisa que estén bien copiadas y que la app sea de tipo "script".');
    }
    const expiresIn = isNode(body) && typeof body.expires_in === 'number' && body.expires_in > 0 ? body.expires_in * 1000 : 60 * 60_000;
    this.token = { value, expiresAt: Date.now() + Math.max(60_000, expiresIn - TOKEN_MARGIN_MS) };
    return value;
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

    try {
      const posts = await this.download(subreddit);
      this.failures.delete(key);
      return posts;
    } catch (error) {
      const redditError = error instanceof RedditError ? error : new RedditError('No pude leer Reddit.');
      // Lo que no es "espera un poco" se recuerda un rato para este subreddit, para no insistir
      if (!redditError.retrySoon) this.failures.set(key, { message: redditError.message, until: Date.now() + ERROR_BACKOFF_MS });
      throw redditError;
    }
  }

  // Una consulta a la vez y al ritmo que deja Reddit. Si el turno tarda, mejor dejarlo para el siguiente minuto
  // que frenar los demás feeds.
  private waitTurn(): Promise<void> {
    const turn = this.queue.then(async () => {
      const paused = this.pausedUntil - Date.now();
      if (paused > 0) {
        throw new RedditError(`Reddit pidió esperar; vuelvo a preguntarle en ${minutes(paused)} min.`, { retrySoon: true });
      }
      const wait = this.nextRequestAt - Date.now();
      if (wait > this.maxWaitMs) throw new RedditError('Reddit está atendiendo otra consulta.', { retrySoon: true });
      if (wait > 0) await sleep(wait);
      // Mientras no se sepa qué contestó Reddit, la siguiente espera lo normal
      this.nextRequestAt = Date.now() + this.minGapMs;
    });
    this.queue = turn.catch(() => undefined);
    return turn;
  }

  // x-ratelimit-remaining / x-ratelimit-reset: cuántas consultas quedan y en cuántos segundos se renuevan
  private paceFrom(headers: IncomingHttpHeaders) {
    const remaining = Number(headerValue(headers, 'x-ratelimit-remaining'));
    const reset = Number(headerValue(headers, 'x-ratelimit-reset'));
    if (!Number.isFinite(remaining)) return;
    if (remaining >= 1) {
      this.nextRequestAt = Date.now() + SHORT_GAP_MS;
    } else if (Number.isFinite(reset) && reset >= 0) {
      this.nextRequestAt = Date.now() + Math.min(RATE_PAUSE_MAX_MS, (reset + 1) * 1000);
    }
  }

  private pauseAfterRateLimit(error: SafeFetchError): number {
    this.rateLimitStreak++;
    const reset = Number(headerValue(error.headers, 'x-ratelimit-reset'));
    const told = Number.isFinite(reset) && reset > 0 ? (reset + 1) * 1000 : error.retryAfterMs;
    const pause = told && told > 0 ? told : RATE_PAUSE_BASE_MS * 2 ** (this.rateLimitStreak - 1);
    const clamped = Math.min(RATE_PAUSE_MAX_MS, Math.max(RATE_PAUSE_MIN_MS, pause));
    this.pausedUntil = Date.now() + clamped;
    this.nextRequestAt = this.pausedUntil;
    return clamped;
  }

  /**
   * Descarga una página de Reddit al ritmo que deja Reddit (una consulta a la vez, pausa tras un 429).
   * Lanza RedditError con retrySoon si toca esperar, y SafeFetchError si Reddit contestó con otro error.
   */
  async fetchPaced(url: string, accept = ATOM_ACCEPT, headers?: Record<string, string>): Promise<SafeFetchResult> {
    await this.waitTurn();
    try {
      const page = await safeFetchText(url, { accept, headers, timeoutMs: REDDIT_TIMEOUT_MS, allowPrivateHosts: this.allowPrivateHosts });
      this.rateLimitStreak = 0;
      this.paceFrom(page.headers);
      return page;
    } catch (error) {
      if (error instanceof SafeFetchError && error.status === 429) {
        const pause = this.pauseAfterRateLimit(error);
        console.warn(`[REDDIT] Reddit pidió esperar (demasiadas consultas); vuelvo a preguntarle en ${minutes(pause)} min.`);
        throw new RedditError(`Reddit pidió esperar; vuelvo a preguntarle en ${minutes(pause)} min.`, { retrySoon: true });
      }
      if (error instanceof SafeFetchError) this.paceFrom(error.headers);
      throw error;
    }
  }

  /** Un feed de noticias que está en reddit.com: se lee al mismo ritmo que los feeds de Reddit. */
  async loadNewsFeed(url: string): Promise<ParsedFeed> {
    let page: SafeFetchResult;
    try {
      page = await this.fetchPaced(url, FEED_ACCEPT);
    } catch (error) {
      if (error instanceof RedditError) throw error;
      if (afterShutdown()) throw new FeedError(REDDIT_RSS_SHUTDOWN_MESSAGE);
      if (error instanceof SafeFetchError) throw new FeedError(error.message);
      throw new FeedError('No se pudo leer ese enlace.');
    }
    const feed = parseFeed(page.text, page.url);
    if (!feed) throw new FeedError(afterShutdown() ? REDDIT_RSS_SHUTDOWN_MESSAGE : 'Ese enlace ya no devuelve un RSS válido.');
    return feed;
  }

  private async download(subreddit: string): Promise<RedditPost[]> {
    return this.usesApi ? this.downloadFromApi(subreddit) : this.downloadFromRss(subreddit);
  }

  private async fetchFromApi(url: string): Promise<SafeFetchResult> {
    for (let attempt = 0; ; attempt++) {
      const token = await this.getToken();
      try {
        return await this.fetchPaced(url, 'application/json', { Authorization: `bearer ${token}`, 'User-Agent': this.userAgent() });
      } catch (error) {
        // El permiso venció antes de tiempo: se pide otro una vez
        if (attempt === 0 && error instanceof SafeFetchError && error.status === 401) {
          this.token = null;
          continue;
        }
        throw error;
      }
    }
  }

  private async downloadFromApi(subreddit: string): Promise<RedditPost[]> {
    const url = `${this.apiBaseUrl}/r/${encodeURIComponent(subreddit)}/hot?limit=${LISTING_SIZE}&raw_json=1`;
    let page: SafeFetchResult;
    try {
      page = await this.fetchFromApi(url);
    } catch (error) {
      if (error instanceof RedditError) throw error;
      if (!(error instanceof SafeFetchError)) throw new RedditError('No pude conectar con Reddit.');
      if (error.status === 401) throw new RedditError('Reddit no aceptó el permiso de tus claves. Revisa REDDIT_CLIENT_ID y REDDIT_CLIENT_SECRET.');
      if (error.status === 403) throw new RedditError(`Reddit no deja leer r/${subreddit} (error 403): es privado, está en cuarentena o fue suspendido.`);
      if (error.status === 404 || error.status === 410) throw new RedditError(`r/${subreddit} no existe o fue cerrado.`);
      throw new RedditError(`No pude leer Reddit: ${error.message}`);
    }
    // Un subreddit que no existe a veces manda a la búsqueda en vez de dar 404
    if (!new URL(page.url).pathname.toLowerCase().startsWith(`/r/${subreddit.toLowerCase()}/`)) {
      throw new RedditError(`r/${subreddit} no existe o fue cerrado.`);
    }
    const posts = parseRedditListing(page.text, subreddit);
    if (!posts) throw new RedditError(`Reddit contestó algo raro al pedir r/${subreddit}; lo vuelvo a intentar después.`);
    return posts;
  }

  private async downloadFromRss(subreddit: string): Promise<RedditPost[]> {
    // obey_over18: que Reddit quite de la lista lo marcado NSFW (si lo hace caso, es un filtro más)
    const url = `${this.baseUrl}/r/${encodeURIComponent(subreddit)}/hot/.rss?limit=${LISTING_SIZE}&obey_over18=true`;
    let page: SafeFetchResult;
    try {
      page = await this.fetchPaced(url);
    } catch (error) {
      if (error instanceof RedditError) throw error;
      // Después del apagado del RSS, cualquier error es por eso y no por el subreddit
      if (afterShutdown()) throw new RedditError(REDDIT_RSS_SHUTDOWN_MESSAGE);
      if (!(error instanceof SafeFetchError)) throw new RedditError('No pude conectar con Reddit.');
      if (error.status === 401 || error.status === 403) {
        throw new RedditError(`Reddit no deja leer r/${subreddit} (error ${error.status}): puede ser privado o estar en cuarentena, o Reddit está bloqueando la conexión.`);
      }
      if (error.status === 404 || error.status === 410) throw new RedditError(`r/${subreddit} no existe o fue cerrado.`);
      throw new RedditError(`No pude leer Reddit: ${error.message}`);
    }

    // Reddit manda a otra página (iniciar sesión, búsqueda) lo que no deja ver sin cuenta
    const unreadable = afterShutdown()
      ? REDDIT_RSS_SHUTDOWN_MESSAGE
      : `Reddit no deja leer r/${subreddit} sin cuenta: no existe, es privado o está en cuarentena.`;
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
