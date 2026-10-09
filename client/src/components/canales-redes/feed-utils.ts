import {
  CONTENT_FEED_LIMITS as API_CONTENT_FEED_LIMITS,
  NEWS_SECTIONS,
  NEWS_SECTION_LABELS,
  type ContentFeedItem,
  type NewsSection,
} from "@shared/api";

export { NEWS_SECTIONS, NEWS_SECTION_LABELS, type NewsSection };

/**
 * Límites de los feeds (Reddit y noticias), sacados de shared/api.ts (los mismos que valida el servidor).
 * Aquí el patrón del subreddit va ya como RegExp para usarlo directo en los formularios.
 */
export const CONTENT_FEED_LIMITS = {
  /** Feeds por servidor (cuentan también los de Twitter/X viejos). */
  maxPerGuild: API_CONTENT_FEED_LIMITS.maxPerGuild,
  /** Nombre de subreddit válido (sin "r/"). */
  subredditPattern: new RegExp(API_CONTENT_FEED_LIMITS.subredditPattern),
  subredditMinLength: API_CONTENT_FEED_LIMITS.subredditMinLength,
  subredditMaxLength: API_CONTENT_FEED_LIMITS.subredditMaxLength,
  /** Minutos entre publicaciones. */
  postInterval: API_CONTENT_FEED_LIMITS.postInterval,
  /** Noticias: mínimo de minutos entre revisiones y cuántas publica por turno. */
  newsMinInterval: API_CONTENT_FEED_LIMITS.newsMinInterval,
  newsMaxPerTurn: API_CONTENT_FEED_LIMITS.newsMaxPerTurn,
  newsUrlMaxLength: API_CONTENT_FEED_LIMITS.newsUrlMaxLength,
  newsTopicMinLength: API_CONTENT_FEED_LIMITS.newsTopicMinLength,
  newsTopicMaxLength: API_CONTENT_FEED_LIMITS.newsTopicMaxLength,
} as const;

/** Temas que se proponen al crear un feed de noticias por tema. */
export const NEWS_TOPIC_SUGGESTIONS = ["Videojuegos", "Anime", "Inteligencia artificial", "Fútbol", "Fórmula 1", "Cine y series"] as const;

/** Intervalo propuesto para un feed nuevo. */
export const DEFAULT_POST_INTERVAL = 60;

/** Atajos de intervalo (minutos). */
export const POST_INTERVAL_PRESETS = [15, 30, 60, 120, 360, 720, 1440] as const;

/** Por debajo de esto el canal se llena rápido y Reddit puede empezar a limitar al bot. */
export const SHORT_INTERVAL_WARNING_MINUTES = 10;

/** "r/memes", "/r/memes/", "https://www.reddit.com/r/memes/..." → "memes" (sin validar). */
export function normalizeSubreddit(input: string): string {
  let value = input.trim();
  value = value.replace(/^https?:\/\/(?:[a-z0-9-]+\.)?reddit\.com/i, "");
  value = value.replace(/^\/+/, "");
  value = value.replace(/^r\//i, "");
  value = value.split(/[/?#]/)[0] ?? "";
  return value.trim();
}

export function isValidSubreddit(name: string): boolean {
  return CONTENT_FEED_LIMITS.subredditPattern.test(name);
}

export function subredditUrl(name: string): string {
  return `https://www.reddit.com/r/${encodeURIComponent(name)}/`;
}

/** "cada 15 min", "cada hora", "cada 2 h 30 min", "una vez al día". */
export function formatInterval(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return "—";
  if (minutes === 1440) return "una vez al día";
  if (minutes < 60) return minutes === 1 ? "cada minuto" : `cada ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (rest === 0) return hours === 1 ? "cada hora" : `cada ${hours} horas`;
  return `cada ${hours} h ${rest} min`;
}

/** Texto corto para un botón de atajo: "15 min", "1 h", "24 h". */
export function formatIntervalShort(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  return Number.isInteger(hours) ? `${hours} h` : `${Math.floor(hours)} h ${minutes % 60} min`;
}

export type FeedKind = "reddit" | "rss" | "twitter" | "unknown";

export function feedKind(feed: Pick<ContentFeedItem, "source">): FeedKind {
  if (feed.source === "reddit") return "reddit";
  if (feed.source === "rss") return "rss";
  if (feed.source === "twitter") return "twitter";
  return "unknown";
}

/** Reddit y noticias publican; los demás (Twitter/X viejos) solo se pueden apagar o borrar. */
export function isSupportedKind(kind: FeedKind): boolean {
  return kind === "reddit" || kind === "rss";
}

/** sourceConfig llega como JSON libre: se lee con cuidado. */
function configString(feed: Pick<ContentFeedItem, "sourceConfig">, key: string): string | null {
  const config = feed.sourceConfig;
  if (!config || typeof config !== "object" || Array.isArray(config)) return null;
  const value = (config as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function feedSubreddit(feed: Pick<ContentFeedItem, "sourceConfig">): string | null {
  return configString(feed, "subreddit");
}

function hostname(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function isNewsSection(value: string | null): value is NewsSection {
  return !!value && (NEWS_SECTIONS as readonly string[]).includes(value);
}

/** Lo que guardó el servidor para un feed de noticias (sourceConfig). */
export function feedNews(feed: Pick<ContentFeedItem, "sourceConfig">) {
  const section = configString(feed, "section");
  return {
    url: configString(feed, "url"),
    title: configString(feed, "title"),
    siteUrl: configString(feed, "siteUrl"),
    topic: configString(feed, "topic"),
    section: isNewsSection(section) ? section : null,
  };
}

/** Enlace para abrir el origen del feed (el subreddit o el sitio de noticias). */
export function feedLink(feed: ContentFeedItem): string | null {
  const kind = feedKind(feed);
  if (kind === "reddit") {
    const subreddit = feedSubreddit(feed);
    return subreddit ? subredditUrl(subreddit) : null;
  }
  if (kind === "rss") {
    const news = feedNews(feed);
    const link = news.siteUrl ?? news.url;
    return link && /^https?:\/\//i.test(link) ? link : null;
  }
  return null;
}

/** Nombre para mostrar: "r/memes", "Noticias · Tecnología", el nombre del sitio, o algo genérico para feeds viejos. */
export function feedTitle(feed: ContentFeedItem): string {
  const kind = feedKind(feed);
  if (kind === "reddit") {
    const subreddit = feedSubreddit(feed);
    return subreddit ? `r/${subreddit}` : "Feed de Reddit sin subreddit";
  }
  if (kind === "rss") {
    const news = feedNews(feed);
    if (news.section) return `Noticias · ${NEWS_SECTION_LABELS[news.section]}`;
    if (news.topic) return `Noticias · ${news.topic}`;
    return news.title ?? hostname(news.url) ?? "Feed de noticias";
  }
  if (kind === "twitter") {
    const account = configString(feed, "username") ?? configString(feed, "account");
    return account ? `Twitter/X · @${account.replace(/^@/, "")}` : "Feed de Twitter/X";
  }
  return `Feed de ${feed.source || "origen desconocido"}`;
}

/** Orden estable: noticias, Reddit (por nombre) y luego el resto. */
export function sortFeeds(feeds: ContentFeedItem[]): ContentFeedItem[] {
  const rank: Record<FeedKind, number> = { rss: 0, reddit: 1, twitter: 2, unknown: 3 };
  return [...feeds].sort((a, b) => {
    const byKind = rank[feedKind(a)] - rank[feedKind(b)];
    if (byKind !== 0) return byKind;
    const byName = feedTitle(a).localeCompare(feedTitle(b), "es", { sensitivity: "base" });
    return byName !== 0 ? byName : a.id.localeCompare(b.id);
  });
}

export function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
