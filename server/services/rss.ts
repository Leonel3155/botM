import { createHash } from 'crypto';
import { XMLParser } from 'fast-xml-parser';
import { escapeMarkdown, type MessageCreateOptions } from 'discord.js';
import { GOOGLE_NEWS_EDITION, NEWS_SECTION_LABELS, type NewsFeedConfig, type NewsSection } from '@shared/api';
import { SafeFetchError, safeFetchText, type SafeFetchOptions } from './safeFetch';

// Feeds de noticias: RSS 2.0, RSS 1.0 (RDF) y Atom. Sin claves ni cuentas.

export class FeedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FeedError';
  }
}

export interface FeedItem {
  /** ID estable para no repetir (hash del guid/id/enlace). */
  sourceId: string;
  title: string;
  link: string | null;
  summary: string | null;
  imageUrl: string | null;
  published: Date | null;
  /** Medio que publicó la nota (Google Noticias lo trae aparte). */
  sourceName: string | null;
}

export interface ParsedFeed {
  title: string | null;
  siteUrl: string | null;
  items: FeedItem[];
}

const FEED_ACCEPT = 'application/rss+xml, application/atom+xml, application/rdf+xml, application/xml;q=0.9, text/xml;q=0.9, text/html;q=0.5, */*;q=0.1';
const MAX_ITEMS = 100;
// Tope de entradas que se leen de un feed (el de tamaño de la descarga ya lo limita, esto es por si acaso)
const MAX_RAW_ITEMS = 2000;
const SUMMARY_MAX = 300;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  processEntities: true,
  htmlEntities: true,
  isArray: (name) =>
    ['item', 'entry', 'link', 'enclosure', 'media:content', 'media:thumbnail', 'media:group'].includes(name),
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
  if (typeof node === 'number' || typeof node === 'boolean') return String(node);
  if (isNode(node)) return textOf(node['#text']);
  return null;
}

function attr(value: unknown, name: string): string | null {
  const node = first(value);
  if (!isNode(node)) return null;
  const raw = node[`@_${name}`];
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
}

/** Solo enlaces http(s) que Discord acepta. */
function safeLink(raw: string | null | undefined, base?: string | null): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw.trim(), base ?? undefined);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    const text = url.toString();
    return text.length <= 2000 ? text : null;
  } catch {
    return null;
  }
}

function parseDate(raw: string | null): Date | null {
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–',
  laquo: '«', raquo: '»', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', iexcl: '¡', iquest: '¿',
  aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', ntilde: 'ñ', uuml: 'ü',
  Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', Ntilde: 'Ñ', Uuml: 'Ü', middot: '·', bull: '•',
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
    if (code[0] === '#') {
      const value = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(value) && value > 0 && value <= 0x10ffff ? String.fromCodePoint(value) : match;
    }
    return NAMED_ENTITIES[code] ?? match;
  });
}

/** HTML de la descripción → texto plano de una línea. */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style|iframe|noscript)\b[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>|<\/(p|div|li|h\d)>/gi, ' ')
      .replace(/<[^>]*>/g, ''),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

function shorten(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

function firstImageInHtml(html: string | null, base: string | null): string | null {
  if (!html) return null;
  const match = html.match(/<img\b[^>]*?\ssrc\s*=\s*["']([^"']+)["']/i);
  return match ? safeLink(decodeEntities(match[1]), base) : null;
}

function looksLikeImage(url: string | null, type: string | null, medium: string | null): boolean {
  if (!url) return false;
  if (medium === 'image') return true;
  if (type) return type.toLowerCase().startsWith('image/');
  return /\.(jpe?g|png|gif|webp)(\?|$)/i.test(url);
}

function imageOf(item: Node, base: string | null): string | null {
  const groups = asList(item['media:group']).filter(isNode);
  const holders: Node[] = [item, ...groups];
  for (const holder of holders) {
    for (const media of asList(holder['media:content'])) {
      const url = attr(media, 'url');
      if (looksLikeImage(url, attr(media, 'type'), attr(media, 'medium'))) return safeLink(url, base);
    }
    for (const thumb of asList(holder['media:thumbnail'])) {
      const url = safeLink(attr(thumb, 'url'), base);
      if (url) return url;
    }
  }
  for (const enclosure of asList(item.enclosure)) {
    const url = attr(enclosure, 'url');
    if (looksLikeImage(url, attr(enclosure, 'type'), null)) return safeLink(url, base);
  }
  const html = textOf(item['content:encoded']) ?? textOf(item.content) ?? textOf(item.description) ?? textOf(item.summary);
  return firstImageInHtml(html, base);
}

/** Enlace de una entrada Atom (rel="alternate" o sin rel). */
function atomLink(links: unknown, base: string | null): string | null {
  const list = asList(links);
  const preferred =
    list.find((link) => (attr(link, 'rel') ?? 'alternate') === 'alternate' && !/xml|json/i.test(attr(link, 'type') ?? '')) ??
    list.find((link) => (attr(link, 'rel') ?? 'alternate') === 'alternate');
  return safeLink(attr(preferred, 'href') ?? textOf(preferred), base);
}

function rssLink(links: unknown, base: string | null): string | null {
  for (const link of asList(links)) {
    const href = typeof link === 'string' ? link : attr(link, 'href') ?? textOf(link);
    const url = safeLink(href, base);
    if (url) return url;
  }
  return null;
}

function hashId(raw: string): string {
  return createHash('sha1').update(raw).digest('hex');
}

function buildItem(item: Node, base: string | null, atom: boolean): FeedItem | null {
  const groups = asList(item['media:group']).filter(isNode);
  const rawTitle = textOf(item.title) ?? textOf(groups[0]?.['media:title']);
  // En RSS el guid solo sirve de enlace si es una dirección completa (a veces es un número cualquiera)
  const guid = textOf(item.guid);
  const guidLink = guid && /^https?:\/\//i.test(guid) && attr(item.guid, 'isPermaLink') !== 'false' ? safeLink(guid) : null;
  const link = atom ? atomLink(item.link, base) : rssLink(item.link, base) ?? guidLink;
  const sourceName = textOf(item.source);

  let title = rawTitle ? htmlToText(rawTitle) : '';
  // Google Noticias: "Titular - Medio"
  if (sourceName && title.endsWith(` - ${sourceName}`)) title = title.slice(0, -(sourceName.length + 3)).trim();

  const html =
    textOf(item.description) ?? textOf(item.summary) ?? textOf(item['content:encoded']) ?? textOf(item.content) ??
    textOf(groups[0]?.['media:description']);
  let summary = html ? htmlToText(html) : '';
  // Hay feeds cuya descripción repite el título (y Google Noticias solo pone "Titular  Medio")
  if (title && summary.toLowerCase().startsWith(title.toLowerCase())) summary = summary.slice(title.length).trim();
  if (sourceName && summary === sourceName) summary = '';
  // Coletilla de WordPress: "The post X appeared first on Y." / "La entrada X se publicó primero en Y."
  summary = summary.replace(/\s*(The post|La entrada)\s.*\s(appeared first|se publicó primero|aparece primero)\b.*$/i, '').trim();
  // Google Noticias no trae el texto de la nota, solo titulares de otros medios: no sirve de resumen
  if (hostOf(link) === 'news.google.com') summary = '';
  if (summary.length < 25) summary = '';

  const idSource = guid ?? textOf(item.id) ?? textOf(item['yt:videoId']) ?? link ?? (title ? `${title}|${textOf(item.pubDate) ?? ''}` : null);
  if (!idSource || (!title && !link)) return null;

  return {
    sourceId: hashId(idSource),
    title: title || 'Sin título',
    link,
    summary: summary ? shorten(summary, SUMMARY_MAX) : null,
    imageUrl: imageOf(item, base),
    published: parseDate(textOf(item.pubDate) ?? textOf(item['dc:date']) ?? textOf(item.published) ?? textOf(item.updated)),
    sourceName: sourceName ? shorten(htmlToText(sourceName), 100) : null,
  };
}

// Un DOCTYPE con entidades propias no hace falta en un feed y es una forma conocida de hacer explotar un parser
export function stripDoctype(xml: string): string {
  return xml.replace(/<!DOCTYPE[^[>]*(\[[\s\S]*?\])?\s*>/gi, '');
}

/** Lee un RSS/Atom. Devuelve null si el texto no es un feed. */
export function parseFeed(xml: string, baseUrl: string | null = null): ParsedFeed | null {
  let doc: Node;
  try {
    doc = parser.parse(stripDoctype(xml.replace(/^﻿/, ''))) as Node;
  } catch {
    return null;
  }
  if (!isNode(doc)) return null;

  const rss = first(doc.rss);
  const rdf = first(doc['rdf:RDF']);
  const atomFeed = first(doc.feed);

  let title: string | null = null;
  let siteUrl: string | null = null;
  let rawItems: unknown[] = [];
  let atom = false;

  if (isNode(rss) && isNode(first(rss.channel))) {
    const channel = first(rss.channel) as Node;
    title = textOf(channel.title);
    siteUrl = rssLink(channel.link, baseUrl);
    rawItems = asList(channel.item);
  } else if (isNode(rdf)) {
    const channel = first(rdf.channel);
    if (isNode(channel)) {
      title = textOf(channel.title);
      siteUrl = rssLink(channel.link, baseUrl);
    }
    rawItems = asList(rdf.item);
  } else if (isNode(atomFeed)) {
    atom = true;
    title = textOf(atomFeed.title);
    siteUrl = atomLink(atomFeed.link, baseUrl);
    rawItems = asList(atomFeed.entry);
  } else {
    return null;
  }

  const items: FeedItem[] = [];
  const ids = new Set<string>();
  for (const raw of rawItems.slice(0, MAX_RAW_ITEMS)) {
    if (!isNode(raw)) continue;
    const item = buildItem(raw, siteUrl ?? baseUrl, atom);
    // La misma nota dos veces en el feed cuenta una sola vez
    if (!item || ids.has(item.sourceId)) continue;
    ids.add(item.sourceId);
    items.push(item);
  }
  // Casi todos los feeds van de lo más nuevo a lo más viejo; los que van al revés se voltean
  const dated = items.filter((item) => item.published);
  if (dated.length >= 2 && dated[0].published!.getTime() < dated[dated.length - 1].published!.getTime()) items.reverse();
  return {
    title: title ? shorten(htmlToText(title), 200) : null,
    siteUrl,
    items: items.slice(0, MAX_ITEMS),
  };
}

/** Enlaces a RSS/Atom que anuncia una página HTML (<link rel="alternate" type="application/rss+xml">). */
export function findFeedLinks(html: string, baseUrl: string): string[] {
  const found: string[] = [];
  const head = html.slice(0, 1_000_000);
  for (const tag of head.match(/<link\b[^>]*>/gi) ?? []) {
    const attrs: Record<string, string> = {};
    for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+))/g)) {
      attrs[match[1].toLowerCase()] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? '');
    }
    const rel = (attrs.rel ?? '').toLowerCase().split(/\s+/);
    const type = (attrs.type ?? '').toLowerCase();
    if (!rel.includes('alternate') || !/^application\/(rss|atom|rdf)\+xml/.test(type)) continue;
    const url = safeLink(attrs.href, baseUrl);
    if (url && !found.includes(url)) found.push(url);
  }
  // Primero los que no son de comentarios
  return found.sort((a, b) => Number(/comment/i.test(a)) - Number(/comment/i.test(b)));
}

function looksLikeHtml(text: string): boolean {
  return /<html[\s>]|<!doctype html/i.test(text.slice(0, 2000));
}

/** URL de Google Noticias para una sección o un tema. */
export function googleNewsUrl(choice: { section: NewsSection } | { topic: string }): string {
  const edition = `hl=${GOOGLE_NEWS_EDITION.hl}&gl=${GOOGLE_NEWS_EDITION.gl}&ceid=${GOOGLE_NEWS_EDITION.ceid}`;
  if ('section' in choice) {
    return choice.section === 'TOP'
      ? `https://news.google.com/rss?${edition}`
      : `https://news.google.com/rss/headlines/section/topic/${choice.section}?${edition}`;
  }
  // when:2d: solo notas de los últimos dos días (si no, Google mezcla noticias viejas)
  return `https://news.google.com/rss/search?q=${encodeURIComponent(`${choice.topic} when:2d`)}&${edition}`;
}

/** youtube.com/channel/UC… → su RSS directo (sin descargar la página). */
function youtubeChannelFeed(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (!/(^|\.)youtube\.com$/i.test(url.hostname)) return null;
    const match = url.pathname.match(/^\/channel\/(UC[\w-]{10,40})/);
    return match ? `https://www.youtube.com/feeds/videos.xml?channel_id=${match[1]}` : null;
  } catch {
    return null;
  }
}

function explain(error: unknown): string {
  if (error instanceof SafeFetchError || error instanceof FeedError) return error.message;
  return 'No se pudo leer ese enlace.';
}

/** Descarga y lee un feed que ya se sabe que es RSS/Atom (lo que hace el bot en cada turno). */
export async function loadFeed(url: string, options: SafeFetchOptions = {}): Promise<ParsedFeed> {
  const page = await safeFetchText(url, { accept: FEED_ACCEPT, ...options });
  const feed = parseFeed(page.text, page.url);
  if (!feed) throw new FeedError('Ese enlace ya no devuelve un RSS válido.');
  return feed;
}

export interface ResolvedFeed {
  /** Lo que se guarda en sourceConfig. */
  config: NewsFeedConfig;
  feed: ParsedFeed;
}

/**
 * Para crear un feed: revisa que se pueda leer y, si es la página de un sitio, busca su RSS.
 * Lanza FeedError con un mensaje para mostrar en el panel.
 */
export async function resolveNewsFeed(
  choice: { section: NewsSection } | { topic: string } | { url: string },
  options: SafeFetchOptions = {},
): Promise<ResolvedFeed> {
  try {
    if ('section' in choice || 'topic' in choice) {
      const url = googleNewsUrl(choice);
      const feed = await loadFeed(url, options);
      const config: NewsFeedConfig =
        'section' in choice
          ? { url, title: `Google Noticias · ${NEWS_SECTION_LABELS[choice.section]}`, section: choice.section, siteUrl: 'https://news.google.com/' }
          : { url, title: `Google Noticias · ${choice.topic}`, topic: choice.topic, siteUrl: 'https://news.google.com/' };
      return { config, feed };
    }

    let input = choice.url.trim();
    if (!/^[a-z][\w+.-]*:\/\//i.test(input)) input = `https://${input}`;
    input = youtubeChannelFeed(input) ?? input;

    const page = await safeFetchText(input, { accept: FEED_ACCEPT, ...options });
    const direct = parseFeed(page.text, page.url);
    if (direct) {
      return { config: withTitle({ url: input, siteUrl: direct.siteUrl ?? undefined }, direct, page.url), feed: direct };
    }
    if (!looksLikeHtml(page.text)) {
      throw new FeedError('Ese enlace no es un RSS ni una página web. Revisa que esté bien copiado.');
    }

    const candidates = findFeedLinks(page.text, page.url).slice(0, 2);
    if (candidates.length === 0) {
      throw new FeedError('Esa página no tiene RSS. Busca en el sitio un enlace que diga "RSS" o "Feed", o prueba con un tema de Google Noticias.');
    }
    let lastError: unknown = null;
    for (const candidate of candidates) {
      try {
        const feed = await loadFeed(candidate, options);
        return { config: withTitle({ url: candidate, siteUrl: feed.siteUrl ?? page.url }, feed, candidate), feed };
      } catch (error) {
        lastError = error;
      }
    }
    throw new FeedError(`Encontré el RSS de esa página, pero no se pudo leer: ${explain(lastError)}`);
  } catch (error) {
    if (error instanceof FeedError) throw error;
    throw new FeedError(explain(error));
  }
}

function withTitle(config: NewsFeedConfig, feed: ParsedFeed, fallbackUrl: string): NewsFeedConfig {
  let title = feed.title;
  if (!title) {
    try {
      title = new URL(fallbackUrl).hostname.replace(/^www\./, '');
    } catch {
      title = null;
    }
  }
  return title ? { ...config, title } : config;
}

function hostOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

function isYoutubeVideo(link: string | null): boolean {
  const host = hostOf(link);
  return !!host && (/(^|\.)youtube\.com$/.test(host) || host === 'youtu.be');
}

const NEWS_COLOR = 0xfacc15; // amarillo del panel

/** Mensaje de Discord para una noticia. */
export function formatNewsItem(feedName: string, item: FeedItem): MessageCreateOptions {
  // Los videos de YouTube van como enlace: así Discord muestra el reproductor
  if (item.link && isYoutubeVideo(item.link)) {
    return {
      content: `📺 **${escapeMarkdown(shorten(feedName, 100))}** subió un video: **${escapeMarkdown(shorten(item.title, 200))}**\n${item.link}`,
      allowedMentions: { parse: [] },
    };
  }

  const published = item.published && item.published.getTime() <= Date.now() + 60_000 ? item.published : null;
  const footer = item.sourceName ?? hostOf(item.link) ?? feedName;
  return {
    embeds: [
      {
        color: NEWS_COLOR,
        author: { name: `📰 ${shorten(feedName, 240)}` },
        title: shorten(item.title, 256),
        ...(item.link ? { url: item.link } : {}),
        ...(item.summary ? { description: item.summary } : {}),
        ...(item.imageUrl ? { image: { url: item.imageUrl } } : {}),
        footer: { text: shorten(footer, 200) },
        ...(published ? { timestamp: published.toISOString() } : {}),
      },
    ],
    allowedMentions: { parse: [] },
  };
}
