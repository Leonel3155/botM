// Tipos de las respuestas JSON de la API, derivados de shared/schema.ts.
// Solo se importan tipos: nada de drizzle llega al bundle del cliente.
import type { ContentFeed, Guild, ModerationAction, UserLevel } from "@shared/schema";

// Al pasar por JSON, los campos Date del servidor llegan como string ISO.
type JsonValue<V> = V extends Date ? string : V;
export type Serialized<T> = { [K in keyof T]: JsonValue<T[K]> };

// Contenido de la columna jsonb `guilds.settings`, según el esquema zod de
// PUT /api/guilds/:guildId/settings. Cada sección puede faltar.
export interface GuildSettings {
  levelSystem?: {
    enabled: boolean;
    xpPerMessage: number[];
    voiceMultiplier: number;
    announcements: boolean;
  };
  economy?: {
    enabled: boolean;
    dailyReward: number;
    workCooldown: number;
  };
  moderation?: {
    automod: boolean;
    spamDetection: boolean;
    linkFiltering: boolean;
  };
}

// GET /api/guilds/:guildId
export type GuildResponse = Omit<Serialized<Guild>, "settings"> & {
  settings: GuildSettings | null;
};

// GET /api/levels/:guildId/top
export type UserLevelResponse = Serialized<UserLevel>;

// GET /api/moderation/:guildId/actions
export type ModerationActionResponse = Serialized<ModerationAction>;

export interface ContentFeedSourceConfig {
  subreddit?: string;
  filterNSFW?: boolean;
  /** Noticias (source "rss"): el RSS que lee el bot y su nombre. */
  url?: string;
  title?: string;
  [key: string]: unknown;
}

// GET /api/social/:guildId/feeds
export type ContentFeedResponse = Omit<Serialized<ContentFeed>, "sourceConfig"> & {
  sourceConfig: ContentFeedSourceConfig | null;
};

// Cuerpo de POST /api/social/:guildId/feeds (ver feedSchema en server/routes.ts)
export interface NewContentFeed {
  channelId: string;
  source: "reddit" | "rss";
  sourceConfig: ContentFeedSourceConfig;
  postInterval: number;
}
