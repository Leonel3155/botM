import type { Express, Request, Response } from "express";
import type { Guild as DiscordGuild } from "discord.js";
import type {
  AnalyticsResponse,
  DashboardStatsResponse,
  EconomyTopResponse,
  LeaderboardEntry,
  LevelBucket,
  LevelsTopResponse,
  ModerationDay,
  WealthEntry,
} from "@shared/api";
import { storage, type LevelLeaderboardRow, type WealthLeaderboardRow } from "../storage";
import { bot } from "../bot/index";
import { getActiveRaid } from "../bot/middleware/antiRaid";
import { DEFAULT_DAILY_QUESTION_HOUR } from "../bot/services/dailyQuestion";
import { getLocalDateString, getZonedParts, resolveTimezone } from "../bot/services/timezone";
import { requireAuth, requireGuildAdmin, parseLimit, type DiscordPartialGuild } from "./middleware";
import {
  getCachedBotGuild,
  guildIconUrl,
  nextDailyQuestionAt,
  toIso,
  toModerationActionItem,
} from "./helpers";

const guildAdmin = [requireAuth, requireGuildAdmin];

// =============================================
// Conectados ahora: Discord da un número aproximado al pedir el servidor con contadores.
// Caché corta para no pedírselo en cada visita (y peticiones simultáneas agrupadas).
// =============================================
const GUILD_COUNTS_TTL_MS = 60_000;

interface GuildCounts {
  fetchedAt: number;
  presenceCount: number | null;
}

const guildCountsCache = new Map<string, GuildCounts>();
const pendingGuildCounts = new Map<string, Promise<GuildCounts>>();

async function getGuildCounts(guild: DiscordGuild): Promise<GuildCounts> {
  const cached = guildCountsCache.get(guild.id);
  if (cached && Date.now() - cached.fetchedAt < GUILD_COUNTS_TTL_MS) {
    return cached;
  }

  const pending = pendingGuildCounts.get(guild.id);
  if (pending) return pending;

  const request = (async () => {
    try {
      // El cliente REST de discord.js respeta los rate limits y los Retry-After de Discord
      const fresh = await guild.fetch();
      const counts: GuildCounts = {
        fetchedAt: Date.now(),
        presenceCount: typeof fresh.approximatePresenceCount === "number" ? fresh.approximatePresenceCount : null,
      };
      guildCountsCache.set(guild.id, counts);
      return counts;
    } catch (error) {
      if (cached) {
        console.warn("[DASH] Discord no respondió; usando los contadores en caché:", (error as Error).message);
        return cached;
      }
      // Sin dato: lo recordamos como "desconocido" un minuto para no insistirle a Discord en cada visita
      console.warn("[DASH] No se pudo obtener cuántos miembros están conectados:", (error as Error).message);
      const unknown: GuildCounts = { fetchedAt: Date.now(), presenceCount: null };
      guildCountsCache.set(guild.id, unknown);
      return unknown;
    } finally {
      pendingGuildCounts.delete(guild.id);
    }
  })();

  pendingGuildCounts.set(guild.id, request);
  return request;
}

async function getOnlineCount(guild: DiscordGuild | null): Promise<number | null> {
  if (!guild) return null;
  return (await getGuildCounts(guild)).presenceCount;
}

function botPing(): number | null {
  if (!bot.client.isReady()) return null;
  const ping = bot.client.ws.ping;
  return Number.isFinite(ping) && ping >= 0 ? Math.round(ping) : null;
}

function toLeaderboard(rows: LevelLeaderboardRow[]): LeaderboardEntry[] {
  return rows.map((row, index) => ({ rank: index + 1, ...row }));
}

function toWealth(rows: WealthLeaderboardRow[]): WealthEntry[] {
  return rows.map((row, index) => ({ rank: index + 1, ...row }));
}

// Rangos para la distribución de niveles (los vacíos también salen, con 0)
const LEVEL_BUCKETS: { minLevel: number; maxLevel: number | null }[] = [
  { minLevel: 1, maxLevel: 4 },
  { minLevel: 5, maxLevel: 9 },
  { minLevel: 10, maxLevel: 19 },
  { minLevel: 20, maxLevel: 29 },
  { minLevel: 30, maxLevel: 49 },
  { minLevel: 50, maxLevel: 74 },
  { minLevel: 75, maxLevel: 99 },
  { minLevel: 100, maxLevel: null },
];

function buildLevelDistribution(levels: { level: number; users: number }[]): LevelBucket[] {
  const buckets: LevelBucket[] = LEVEL_BUCKETS.map(({ minLevel, maxLevel }) => ({
    label: maxLevel === null ? `${minLevel}+` : `${minLevel}-${maxLevel}`,
    minLevel,
    maxLevel,
    users: 0,
  }));
  for (const { level, users } of levels) {
    const bucket = buckets.find((b) => b.maxLevel === null || level <= b.maxLevel) ?? buckets[buckets.length - 1];
    bucket.users += users;
  }
  return buckets;
}

const ANALYTICS_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Los últimos `days` días (YYYY-MM-DD en la zona del servidor), del más viejo a hoy. */
function lastLocalDays(now: Date, timezone: string, days: number): string[] {
  const today = getZonedParts(now, timezone);
  const result: string[] = [];
  for (let offset = days - 1; offset >= 0; offset--) {
    const day = new Date(Date.UTC(today.year, today.month - 1, today.day - offset));
    result.push(day.toISOString().slice(0, 10));
  }
  return result;
}

export function setupDashboardRoutes(app: Express) {
  // =============================================
  // Resumen del servidor: solo datos reales (bot + base de datos)
  // =============================================
  app.get("/api/dashboard/:guildId/stats", ...guildAdmin, async (req: Request, res: Response) => {
    try {
      const { guildId } = req.params;
      const botGuild = getCachedBotGuild(guildId);
      const userGuild = res.locals.discordGuild as DiscordPartialGuild | null | undefined;

      const [row, counts, topLevels, recentModeration, antiRaid, onlineCount] = await Promise.all([
        storage.getGuild(guildId),
        storage.getGuildDashboardCounts(guildId),
        storage.getLevelLeaderboard(guildId, 5),
        storage.queryModerationActions(guildId, { limit: 5 }),
        storage.getAntiRaidConfig(guildId),
        getOnlineCount(botGuild),
      ]);

      const activeRaid = getActiveRaid(guildId);
      const nextQuestion = nextDailyQuestionAt(row);
      const icon = botGuild?.icon ?? row?.icon ?? userGuild?.icon ?? null;

      const stats: DashboardStatsResponse = {
        guild: {
          id: guildId,
          name: botGuild?.name ?? row?.name ?? userGuild?.name ?? "Servidor",
          icon,
          iconUrl: guildIconUrl(botGuild, guildId, icon),
          memberCount: botGuild?.memberCount ?? null,
          onlineCount,
        },
        bot: {
          online: bot.client.isReady(),
          inGuild: !!botGuild,
          pingMs: botPing(),
          uptimeSeconds: bot.client.uptime !== null ? Math.floor(bot.client.uptime / 1000) : null,
        },
        counts: {
          usersWithLevels: counts.usersWithLevels,
          coinsInCirculation: Math.round(counts.coinsInCirculation),
          moderationActions7d: counts.moderationActions7d,
          moderationActions30d: counts.moderationActions30d,
          warnings30d: counts.warnings30d,
          warningsTotal: counts.warningsTotal,
          raidEvents30d: counts.raidEvents30d,
          customCommands: counts.customCommands,
        },
        topLevels: toLeaderboard(topLevels),
        recentModeration: recentModeration.map(toModerationActionItem),
        features: {
          welcome: {
            enabled: row?.welcomeEnabled ?? false,
            channelId: row?.welcomeChannelId ?? null,
          },
          dailyQuestion: {
            enabled: row?.dailyQuestionEnabled ?? false,
            channelId: row?.dailyQuestionChannelId ?? null,
            hour: row?.dailyQuestionHour ?? DEFAULT_DAILY_QUESTION_HOUR,
            timezone: resolveTimezone(row?.timezone),
            nextPostAt: toIso(nextQuestion),
            lastPosted: row?.dailyQuestionLastPosted ?? null,
          },
          antiRaid: {
            enabled: antiRaid.enabled,
            raidModeActive: !!activeRaid,
            raidModeEndsAt: activeRaid ? new Date(activeRaid.liftAt).toISOString() : null,
          },
        },
        generatedAt: new Date().toISOString(),
      };

      res.json(stats);
    } catch (error) {
      console.error("[DASH-ERROR]", error);
      res.status(500).json({ error: "No se pudo obtener el resumen del servidor." });
    }
  });

  // =============================================
  // Rankings
  // =============================================
  app.get("/api/levels/:guildId/top", ...guildAdmin, async (req: Request, res: Response) => {
    try {
      const limit = parseLimit(req.query.limit, 10, 100);
      const rows = await storage.getLevelLeaderboard(req.params.guildId, limit);
      const body: LevelsTopResponse = toLeaderboard(rows);
      res.json(body);
    } catch (error) {
      console.error("[LEVELS-TOP-ERROR]", error);
      res.status(500).json({ error: "No se pudo obtener el ranking de niveles." });
    }
  });

  app.get("/api/economy/:guildId/top", ...guildAdmin, async (req: Request, res: Response) => {
    try {
      const limit = parseLimit(req.query.limit, 10, 100);
      const rows = await storage.getWealthLeaderboard(req.params.guildId, limit);
      const body: EconomyTopResponse = toWealth(rows);
      res.json(body);
    } catch (error) {
      console.error("[ECONOMY-TOP-ERROR]", error);
      res.status(500).json({ error: "No se pudo obtener el ranking de monedas." });
    }
  });

  // =============================================
  // Analíticas: solo lo que guarda la base de datos (sin métricas inventadas)
  // =============================================
  app.get("/api/guilds/:guildId/analytics", ...guildAdmin, async (req: Request, res: Response) => {
    try {
      const { guildId } = req.params;
      const now = new Date();
      const row = await storage.getGuild(guildId);
      const timezone = resolveTimezone(row?.timezone);

      // Un día de margen: los días se cuentan en la zona del servidor, no en UTC
      const since = new Date(now.getTime() - (ANALYTICS_DAYS + 1) * DAY_MS);
      const [levels, topEarners, activity, counts] = await Promise.all([
        storage.getLevelCounts(guildId),
        storage.getWealthLeaderboard(guildId, 10),
        storage.getModerationActivitySince(guildId, since),
        storage.getGuildDashboardCounts(guildId),
      ]);

      const days = lastLocalDays(now, timezone, ANALYTICS_DAYS);
      const perDay = new Map<string, ModerationDay>(days.map((date) => [date, { date, total: 0, byType: {} }]));
      const byType: Record<string, number> = {};
      let moderationActions30d = 0;

      for (const action of activity) {
        if (!action.createdAt) continue;
        const day = perDay.get(getLocalDateString(action.createdAt, timezone));
        if (!day) continue; // fuera de los 30 días
        day.total++;
        day.byType[action.type] = (day.byType[action.type] ?? 0) + 1;
        byType[action.type] = (byType[action.type] ?? 0) + 1;
        moderationActions30d++;
      }

      const body: AnalyticsResponse = {
        timezone,
        levelDistribution: buildLevelDistribution(levels),
        topEarners: toWealth(topEarners),
        moderationPerDay: days.map((date) => perDay.get(date)!),
        moderationByType30d: byType,
        totals: {
          usersWithLevels: counts.usersWithLevels,
          usersWithEconomy: counts.usersWithEconomy,
          coinsInCirculation: Math.round(counts.coinsInCirculation),
          moderationActions30d,
          raidEvents30d: counts.raidEvents30d,
        },
        generatedAt: now.toISOString(),
      };

      res.json(body);
    } catch (error) {
      console.error("[ANALYTICS-ERROR]", error);
      res.status(500).json({ error: "No se pudieron obtener las analíticas del servidor." });
    }
  });
}
