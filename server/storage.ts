import type { GuildEngagementSettings } from '@shared/schema';
import { CUSTOM_COMMAND_LIMITS } from '@shared/api';
import { db } from './db';
import {
  users, guilds, userLevels, userEconomy, economyTransactions,
  moderationActions, raidEvents, contentFeeds, postedContent, customCommands,
  antiRaidConfigSchema, defaultAntiRaidConfig,
  type User, type Guild, type UserLevel, type UserEconomy,
  type InsertUser, type InsertGuild, type InsertUserLevel, type InsertUserEconomy,
  type ModerationAction, type InsertModerationAction, type RaidEvent, type InsertRaidEvent,
  type ContentFeed, type InsertContentFeed, type AntiRaidConfig, type AntiRaidSettings,
  type CustomCommand, type InsertCustomCommand
} from '@shared/schema';
import { eq, and, desc, sql, gte, ne, type SQL } from 'drizzle-orm';
import { alias, type PgColumn } from 'drizzle-orm/pg-core';

// Datos mínimos para registrar una acción de moderación (encaja con User/Guild de discord.js)
export interface ModerationLogEntry {
  guild: { id: string; name: string; ownerId: string };
  moderator: { id: string; username: string; avatar?: string | null };
  target: { id: string; username: string; avatar?: string | null };
  type: string; // warn, mute, unmute, kick, ban, clear, lockdown, unlock
  reason?: string | null;
  duration?: number | null; // minutos
  active?: boolean;
}

export type ContentFeedUpdate = Partial<Omit<ContentFeed, 'id' | 'guildId'>>;

export const MAX_CONTENT_FEEDS_PER_GUILD = 10;

export class ContentFeedLimitError extends Error {
  constructor(public readonly limit: number) {
    super(`Este servidor ya tiene el máximo de ${limit} feeds de contenido. Borra alguno antes de crear otro.`);
    this.name = 'ContentFeedLimitError';
  }
}

export const MAX_CUSTOM_COMMANDS_PER_GUILD = CUSTOM_COMMAND_LIMITS.maxPerGuild;

export class CustomCommandLimitError extends Error {
  constructor(public readonly limit: number) {
    super(`Este servidor ya tiene el máximo de ${limit} comandos personalizados. Borra alguno antes de crear otro.`);
    this.name = 'CustomCommandLimitError';
  }
}

export class CustomCommandNameTakenError extends Error {
  constructor(public readonly commandName: string) {
    super(`Ya existe un comando llamado "${commandName}" en este servidor.`);
    this.name = 'CustomCommandNameTakenError';
  }
}

export type CustomCommandUpdate = Partial<Pick<CustomCommand, 'name' | 'description' | 'response' | 'enabled'>>;

/** Lo mínimo que necesita el bot para responder un comando personalizado. */
export interface EnabledCustomCommand {
  id: string;
  name: string;
  response: string;
}

/**
 * Posición para paginar listas ordenadas por fecha (de la más nueva a la más vieja).
 * `createdAt` va truncada a milisegundos (lo que guarda un Date de JS) y `id` desempata.
 */
export interface PageCursor {
  createdAt: Date;
  id: string;
}

export interface ModerationActionFilters {
  type?: string;
  userId?: string;
  before?: PageCursor;
  limit?: number;
}

/** Acción de moderación con los nombres de la persona sancionada y de quien sancionó. */
export interface ModerationActionWithUsers {
  action: ModerationAction;
  user: { id: string; username: string | null; avatar: string | null };
  moderator: { id: string; username: string | null; avatar: string | null };
}

export interface RaidEventFilters {
  status?: 'all' | 'open' | 'resolved';
  before?: PageCursor;
  limit?: number;
}

export interface LevelLeaderboardRow {
  userId: string;
  username: string | null;
  avatar: string | null;
  level: number;
  xp: number;
  totalXp: number;
}

export interface WealthLeaderboardRow {
  userId: string;
  username: string | null;
  avatar: string | null;
  wallet: number;
  bank: number;
  total: number;
}

/** Contadores del resumen del panel (todo de la base de datos). */
export interface GuildDashboardCounts {
  usersWithLevels: number;
  usersWithEconomy: number;
  coinsInCirculation: number;
  moderationActions7d: number;
  moderationActions30d: number;
  warnings30d: number;
  warningsTotal: number;
  raidEvents30d: number;
  customCommands: number;
}

export interface IStorage {
  // User methods
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(insertUser: InsertUser): Promise<User>;
  upsertUser(insertUser: InsertUser): Promise<User>;
  ensureGuild(guildId: string, name: string, ownerId: string): Promise<void>;

  // Guild methods
  getGuild(guildId: string): Promise<Guild | undefined>;
  createGuild(insertGuild: InsertGuild): Promise<Guild>;
  updateGuild(guildId: string, updates: Partial<Guild>): Promise<void>;
  // Bienvenida, pregunta del día y zona horaria (columnas tipadas de guilds)
  updateEngagementSettings(guildId: string, updates: Partial<GuildEngagementSettings>): Promise<Guild | undefined>;
  getDailyQuestionGuilds(): Promise<Guild[]>;
  claimDailyQuestion(guildId: string, localDate: string, force?: boolean): Promise<{ index: number; used: unknown } | null>;
  releaseDailyQuestion(guildId: string, localDate: string, previousDate: string | null): Promise<void>;
  recordDailyQuestionUsed(guildId: string, questionKey: number, startNewCycle: boolean): Promise<void>;
  
  // User level methods
  getUserLevel(userId: string, guildId: string): Promise<UserLevel | undefined>;
  createUserLevel(insertUserLevel: InsertUserLevel): Promise<UserLevel>;
  updateUserLevel(userId: string, guildId: string, data: Partial<UserLevel>): Promise<void>;
  updateUserXP(userId: string, guildId: string, xpGain: number): Promise<UserLevel>;
  getTopUsersByLevel(guildId: string, limit?: number): Promise<UserLevel[]>;
  
  // Economy helper methods
  addCoins(userId: string, guildId: string, amount: number): Promise<void>;
  addLotteryTickets(userId: string, guildId: string, tickets: number): Promise<void>;
  giveRandomRareItem(userId: string, guildId: string, level: number): Promise<any>;
  getMessageCount(userId: string, guildId: string): Promise<number>;
  
  // Economy methods
  getUserEconomy(userId: string, guildId: string): Promise<UserEconomy | undefined>;
  createUserEconomy(insertUserEconomy: InsertUserEconomy): Promise<UserEconomy>;
  updateUserEconomy(userId: string, guildId: string, data: Partial<UserEconomy>): Promise<void>;
  getAllUserEconomies(guildId: string): Promise<UserEconomy[]>;
  getTopUsersByEconomy(guildId: string, limit?: number): Promise<UserEconomy[]>;
  
  // Moderation methods
  createModerationAction(data: InsertModerationAction): Promise<ModerationAction>;
  logModerationAction(entry: ModerationLogEntry): Promise<ModerationAction>;
  getModerationActions(guildId: string, limit?: number): Promise<ModerationAction[]>;
  getUserModerationActions(guildId: string, userId: string, type?: string, limit?: number): Promise<ModerationAction[]>;
  deactivateModerationActions(guildId: string, userId: string, type: string): Promise<number>;

  // Anti-raid methods
  createRaidEvent(data: InsertRaidEvent): Promise<RaidEvent>;
  getRecentRaidEvents(guildId: string, timeWindow?: number): Promise<RaidEvent[]>;
  getRaidEvents(guildId: string, limit?: number): Promise<RaidEvent[]>;
  getUnresolvedRaidEvents(guildId: string): Promise<RaidEvent[]>;
  resolveRaidEvent(id: string, extraDetails?: Record<string, unknown>): Promise<RaidEvent | undefined>;
  updateRaidEventDetails(id: string, extraDetails: Record<string, unknown>): Promise<RaidEvent | undefined>;
  getAntiRaidConfig(guildId: string): Promise<AntiRaidSettings>;
  setAntiRaidConfig(guildId: string, updates: Partial<AntiRaidSettings>): Promise<AntiRaidSettings>;

  getRaidEvent(guildId: string, id: string): Promise<RaidEvent | undefined>;
  queryRaidEvents(guildId: string, filters?: RaidEventFilters): Promise<RaidEvent[]>;

  // Panel: listas con nombres de usuario, contadores y analíticas
  queryModerationActions(guildId: string, filters?: ModerationActionFilters): Promise<ModerationActionWithUsers[]>;
  getLevelLeaderboard(guildId: string, limit?: number): Promise<LevelLeaderboardRow[]>;
  getWealthLeaderboard(guildId: string, limit?: number): Promise<WealthLeaderboardRow[]>;
  getGuildDashboardCounts(guildId: string): Promise<GuildDashboardCounts>;
  getLevelCounts(guildId: string): Promise<{ level: number; users: number }[]>;
  getModerationActivitySince(guildId: string, since: Date): Promise<{ type: string; createdAt: Date | null }[]>;

  // Custom commands
  getCustomCommands(guildId: string): Promise<CustomCommand[]>;
  getCustomCommand(guildId: string, id: string): Promise<CustomCommand | undefined>;
  getEnabledCustomCommands(guildId: string): Promise<EnabledCustomCommand[]>;
  createCustomCommand(data: InsertCustomCommand): Promise<CustomCommand>;
  updateCustomCommand(guildId: string, id: string, updates: CustomCommandUpdate): Promise<CustomCommand | undefined>;
  setCustomCommandEnabled(guildId: string, id: string, enabled: boolean): Promise<CustomCommand | undefined>;
  deleteCustomCommand(guildId: string, id: string): Promise<boolean>;
  incrementCustomCommandUses(id: string): Promise<void>;

  // Content feed methods
  updateContentFeed(id: string, guildId: string, updates: ContentFeedUpdate): Promise<ContentFeed | undefined>;
  deleteContentFeed(id: string, guildId: string): Promise<boolean>;
  getContentFeeds(guildId: string): Promise<any[]>;
  createContentFeed(feedData: any): Promise<any>;
  updateGuildSettings(guildId: string, settings: any): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  // ===== USER METHODS =====
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || undefined;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user || undefined;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values(insertUser)
      .returning();
    return user;
  }

  // Crea el usuario o actualiza su nombre/avatar si ya existe (evita el error al volver a entrar)
  async upsertUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values(insertUser)
      .onConflictDoUpdate({
        target: users.id,
        set: { username: insertUser.username, avatar: insertUser.avatar ?? null },
      })
      .returning();
    return user;
  }

  // Garantiza que el servidor exista en la base de datos (las tablas de niveles/economía dependen de él)
  async ensureGuild(guildId: string, name: string, ownerId: string): Promise<void> {
    await db
      .insert(guilds)
      .values({ id: guildId, name, ownerId })
      .onConflictDoNothing();
  }

  // ===== GUILD METHODS =====
  async getGuild(guildId: string): Promise<Guild | undefined> {
    const [guild] = await db.select().from(guilds).where(eq(guilds.id, guildId));
    return guild || undefined;
  }

  async createGuild(insertGuild: InsertGuild): Promise<Guild> {
    const [guild] = await db
      .insert(guilds)
      .values(insertGuild)
      .returning();
    return guild;
  }

  async updateGuild(guildId: string, updates: Partial<Guild>): Promise<void> {
    await db
      .update(guilds)
      .set(updates)
      .where(eq(guilds.id, guildId));
  }

  // ===== ENGAGEMENT (bienvenida / pregunta del día) =====
  async updateEngagementSettings(guildId: string, updates: Partial<GuildEngagementSettings>): Promise<Guild | undefined> {
    const [guild] = await db
      .update(guilds)
      .set(updates)
      .where(eq(guilds.id, guildId))
      .returning();
    return guild || undefined;
  }

  async getDailyQuestionGuilds(): Promise<Guild[]> {
    return await db
      .select()
      .from(guilds)
      .where(eq(guilds.dailyQuestionEnabled, true));
  }

  // Reserva la pregunta del día de forma atómica: marca la fecha local y avanza el contador.
  // Devuelve el número de la pregunta (desde 0) y las que ya salieron en esta vuelta,
  // o null si ya se publicó hoy (o está desactivada).
  // Con force=true (comando "ahora") se publica aunque ya haya salido una hoy.
  async claimDailyQuestion(
    guildId: string,
    localDate: string,
    force: boolean = false
  ): Promise<{ index: number; used: unknown } | null> {
    const condition = force
      ? eq(guilds.id, guildId)
      : and(
          eq(guilds.id, guildId),
          eq(guilds.dailyQuestionEnabled, true),
          sql`${guilds.dailyQuestionLastPosted} IS DISTINCT FROM ${localDate}`
        );

    const [row] = await db
      .update(guilds)
      .set({
        dailyQuestionLastPosted: localDate,
        dailyQuestionIndex: sql`COALESCE(${guilds.dailyQuestionIndex}, 0) + 1`,
      })
      .where(condition)
      .returning({ index: guilds.dailyQuestionIndex, used: guilds.dailyQuestionUsed });

    if (!row) return null;
    // used es JSON tal cual (un arreglo de números); el bot lo valida al elegir la pregunta
    return { index: Math.max((row.index ?? 1) - 1, 0), used: row.used };
  }

  // Deshace una reserva si no se pudo publicar, para reintentar más tarde
  async releaseDailyQuestion(guildId: string, localDate: string, previousDate: string | null): Promise<void> {
    await db
      .update(guilds)
      .set({
        dailyQuestionLastPosted: previousDate,
        dailyQuestionIndex: sql`GREATEST(COALESCE(${guilds.dailyQuestionIndex}, 0) - 1, 0)`,
      })
      .where(and(eq(guilds.id, guildId), eq(guilds.dailyQuestionLastPosted, localDate)));
  }

  // Anota qué pregunta salió (por su clave). Con startNewCycle (ya habían salido todas) se empieza la lista de cero
  async recordDailyQuestionUsed(guildId: string, questionKey: number, startNewCycle: boolean): Promise<void> {
    const entry = JSON.stringify([questionKey]);
    await db
      .update(guilds)
      .set({
        dailyQuestionUsed: startNewCycle
          ? sql`${entry}::jsonb`
          : sql`COALESCE(${guilds.dailyQuestionUsed}, '[]'::jsonb) || ${entry}::jsonb`,
      })
      .where(eq(guilds.id, guildId));
  }

  // ===== USER LEVEL METHODS =====
  async getUserLevel(userId: string, guildId: string): Promise<UserLevel | undefined> {
    const [userLevel] = await db
      .select()
      .from(userLevels)
      .where(and(eq(userLevels.userId, userId), eq(userLevels.guildId, guildId)));
    return userLevel || undefined;
  }

  async createUserLevel(insertUserLevel: InsertUserLevel): Promise<UserLevel> {
    const [userLevel] = await db
      .insert(userLevels)
      .values(insertUserLevel)
      .returning();
    return userLevel;
  }

  async updateUserLevel(userId: string, guildId: string, data: Partial<UserLevel>): Promise<void> {
    await db
      .update(userLevels)
      .set(data)
      .where(and(eq(userLevels.userId, userId), eq(userLevels.guildId, guildId)));
  }

  async updateUserXP(userId: string, guildId: string, xpGain: number): Promise<UserLevel> {
    // Get or create user level
    let userLevel = await this.getUserLevel(userId, guildId);
    if (!userLevel) {
      userLevel = await this.createUserLevel({
        userId,
        guildId,
        xp: xpGain,
        totalXp: xpGain,
        level: 1,
        lastMessageAt: new Date()
      });
    } else {
      const newXP = (userLevel.totalXp || userLevel.xp || 0) + xpGain;
      // Message count tracking would need additional schema field
      
      // Calculate new level based on exponential XP system
      const calculateLevel = (totalXp: number) => {
        let level = 1;
        let xpRequired = 0;
        
        while (xpRequired <= totalXp) {
          level++;
          xpRequired += Math.floor(100 * Math.pow(1.1, level - 2));
        }
        
        return level - 1;
      };
      
      const newLevel = calculateLevel(newXP);
      
      const now = new Date();
      await this.updateUserLevel(userId, guildId, {
        xp: newXP,
        totalXp: newXP,
        level: newLevel,
        lastMessageAt: now
      });

      userLevel.xp = newXP;
      userLevel.totalXp = newXP;
      userLevel.level = newLevel;
      userLevel.lastMessageAt = now;
    }
    
    return userLevel;
  }

  // Economy helper methods
  async addCoins(userId: string, guildId: string, amount: number): Promise<void> {
    let userEcon = await this.getUserEconomy(userId, guildId);
    if (!userEcon) {
      userEcon = await this.createUserEconomy({
        userId,
        guildId,
        balance: amount.toString(),
        bank: "0"
      });
    } else {
      const newBalance = parseFloat(userEcon.balance || "0") + amount;
      await this.updateUserEconomy(userId, guildId, {
        balance: newBalance.toString()
      });
    }
  }

  async addLotteryTickets(userId: string, guildId: string, tickets: number): Promise<void> {
    let userEcon = await this.getUserEconomy(userId, guildId);
    if (!userEcon) {
      userEcon = await this.createUserEconomy({
        userId,
        guildId,
        balance: "0",
        bank: "0",
        lotteryTickets: tickets
      });
    } else {
      const newTickets = (userEcon.lotteryTickets || 0) + tickets;
      await this.updateUserEconomy(userId, guildId, {
        lotteryTickets: newTickets
      });
    }
  }

  async getLotteryTickets(userId: string, guildId: string): Promise<number> {
    const userEcon = await this.getUserEconomy(userId, guildId);
    return userEcon?.lotteryTickets || 0;
  }

  async giveRandomRareItem(userId: string, guildId: string, level: number): Promise<any> {
    // Simple rare item system
    const rareItems = [
      { name: "Golden Ticket", emoji: "🎫", rarity: "Legendary" },
      { name: "Diamond Ring", emoji: "💍", rarity: "Epic" },
      { name: "Magic Scroll", emoji: "📜", rarity: "Rare" },
      { name: "Lucky Coin", emoji: "🪙", rarity: "Uncommon" }
    ];
    
    const randomItem = rareItems[Math.floor(Math.random() * rareItems.length)];
    
    // Add to user's rare items (simplified - would need proper inventory system)
    let userEcon = await this.getUserEconomy(userId, guildId);
    if (!userEcon) {
      userEcon = await this.createUserEconomy({
        userId,
        guildId,
        balance: "0",
        bank: "0"
      });
    } else {
      // Rare items would need additional schema field - for now just add coins
      const bonusCoins = 100;
      const newBalance = parseFloat(userEcon.balance || "0") + bonusCoins;
      await this.updateUserEconomy(userId, guildId, {
        balance: newBalance.toString()
      });
    }
    
    return randomItem;
  }

  async getMessageCount(userId: string, guildId: string): Promise<number> {
    // Simplified - would need additional schema field for precise tracking
    const userLevel = await this.getUserLevel(userId, guildId);
    return Math.floor((userLevel?.xp || 0) / 20); // Approximate from XP
  }

  async getTopUsersByLevel(guildId: string, limit: number = 10): Promise<UserLevel[]> {
    return await db
      .select()
      .from(userLevels)
      .where(eq(userLevels.guildId, guildId))
      .orderBy(desc(userLevels.level), desc(userLevels.xp))
      .limit(limit);
  }

  // ===== ECONOMY METHODS =====
  async getUserEconomy(userId: string, guildId: string): Promise<UserEconomy | undefined> {
    const [economy] = await db
      .select()
      .from(userEconomy)
      .where(and(eq(userEconomy.userId, userId), eq(userEconomy.guildId, guildId)));
    return economy || undefined;
  }

  async createUserEconomy(insertUserEconomy: InsertUserEconomy): Promise<UserEconomy> {
    const [economy] = await db
      .insert(userEconomy)
      .values(insertUserEconomy)
      .returning();
    return economy;
  }

  async updateUserEconomy(userId: string, guildId: string, data: Partial<UserEconomy>): Promise<void> {
    await db
      .update(userEconomy)
      .set(data)
      .where(and(eq(userEconomy.userId, userId), eq(userEconomy.guildId, guildId)));
  }

  async getAllUserEconomies(guildId: string): Promise<UserEconomy[]> {
    return await db
      .select()
      .from(userEconomy)
      .where(eq(userEconomy.guildId, guildId));
  }

  async getTopUsersByEconomy(guildId: string, limit: number = 10): Promise<UserEconomy[]> {
    return await db.select()
      .from(userEconomy)
      .where(eq(userEconomy.guildId, guildId))
      .orderBy(desc(sql`CAST(${userEconomy.balance} AS NUMERIC) + CAST(${userEconomy.bank} AS NUMERIC)`))
      .limit(limit);
  }

  // ===== MODERATION METHODS =====
  async createModerationAction(data: InsertModerationAction): Promise<ModerationAction> {
    const [action] = await db.insert(moderationActions).values(data).returning();
    return action;
  }

  // Guarda la acción asegurando antes que existan el servidor y ambos usuarios (las FKs lo exigen)
  async logModerationAction(entry: ModerationLogEntry): Promise<ModerationAction> {
    await this.ensureGuild(entry.guild.id, entry.guild.name, entry.guild.ownerId);
    const people = entry.moderator.id === entry.target.id ? [entry.moderator] : [entry.moderator, entry.target];
    for (const person of people) {
      await this.upsertUser({ id: person.id, username: person.username, avatar: person.avatar ?? null });
    }

    return this.createModerationAction({
      guildId: entry.guild.id,
      userId: entry.target.id,
      moderatorId: entry.moderator.id,
      type: entry.type,
      reason: entry.reason ?? null,
      duration: entry.duration ?? null,
      active: entry.active ?? true,
    });
  }

  async getModerationActions(guildId: string, limit: number = 50): Promise<ModerationAction[]> {
    return await db
      .select()
      .from(moderationActions)
      .where(eq(moderationActions.guildId, guildId))
      .orderBy(desc(moderationActions.createdAt))
      .limit(clampLimit(limit, 50));
  }

  async getUserModerationActions(guildId: string, userId: string, type?: string, limit: number = 100): Promise<ModerationAction[]> {
    const conditions = [eq(moderationActions.guildId, guildId), eq(moderationActions.userId, userId)];
    if (type) conditions.push(eq(moderationActions.type, type));

    return await db
      .select()
      .from(moderationActions)
      .where(and(...conditions))
      .orderBy(desc(moderationActions.createdAt))
      .limit(clampLimit(limit, 100));
  }

  // Marca como inactivas las acciones vigentes de un tipo (p. ej. el mute al quitarlo)
  async deactivateModerationActions(guildId: string, userId: string, type: string): Promise<number> {
    const updated = await db
      .update(moderationActions)
      .set({ active: false })
      .where(and(
        eq(moderationActions.guildId, guildId),
        eq(moderationActions.userId, userId),
        eq(moderationActions.type, type),
        eq(moderationActions.active, true)
      ))
      .returning({ id: moderationActions.id });
    return updated.length;
  }

  // ===== ANTI-RAID METHODS =====
  async createRaidEvent(data: InsertRaidEvent): Promise<RaidEvent> {
    const [event] = await db.insert(raidEvents).values(data).returning();
    return event;
  }

  // Eventos de los últimos `timeWindow` ms (por defecto 5 minutos), del más nuevo al más viejo
  async getRecentRaidEvents(guildId: string, timeWindow: number = 300000): Promise<RaidEvent[]> {
    const since = new Date(Date.now() - timeWindow);
    return await db
      .select()
      .from(raidEvents)
      .where(and(eq(raidEvents.guildId, guildId), gte(raidEvents.createdAt, since)))
      .orderBy(desc(raidEvents.createdAt))
      .limit(100);
  }

  async getRaidEvents(guildId: string, limit: number = 50): Promise<RaidEvent[]> {
    return await db
      .select()
      .from(raidEvents)
      .where(eq(raidEvents.guildId, guildId))
      .orderBy(desc(raidEvents.createdAt))
      .limit(clampLimit(limit, 50));
  }

  async getUnresolvedRaidEvents(guildId: string): Promise<RaidEvent[]> {
    return await db
      .select()
      .from(raidEvents)
      .where(and(eq(raidEvents.guildId, guildId), eq(raidEvents.resolved, false)))
      .orderBy(desc(raidEvents.createdAt));
  }

  // Marca el evento como resuelto y mezcla datos extra en `details`
  async resolveRaidEvent(id: string, extraDetails: Record<string, unknown> = {}): Promise<RaidEvent | undefined> {
    const [event] = await db
      .update(raidEvents)
      .set({
        resolved: true,
        details: sql`${jsonObjectOrEmpty(raidEvents.details)} || ${JSON.stringify(extraDetails)}::jsonb`,
      })
      .where(eq(raidEvents.id, id))
      .returning();
    return event || undefined;
  }

  // Mezcla datos en `details` sin cambiar si está resuelto (p. ej. el nivel de verificación previo)
  async updateRaidEventDetails(id: string, extraDetails: Record<string, unknown>): Promise<RaidEvent | undefined> {
    const [event] = await db
      .update(raidEvents)
      .set({ details: sql`${jsonObjectOrEmpty(raidEvents.details)} || ${JSON.stringify(extraDetails)}::jsonb` })
      .where(eq(raidEvents.id, id))
      .returning();
    return event || undefined;
  }

  // `enabled` sale de guilds.anti_raid_enabled (el mismo switch del dashboard);
  // el resto de guilds.settings.antiRaid, con valores por defecto para lo que falte
  async getAntiRaidConfig(guildId: string): Promise<AntiRaidSettings> {
    const [row] = await db
      .select({ enabled: guilds.antiRaidEnabled, settings: guilds.settings })
      .from(guilds)
      .where(eq(guilds.id, guildId));

    const stored = (row?.settings as Record<string, unknown> | null | undefined)?.antiRaid;
    return { enabled: row?.enabled ?? false, ...normalizeAntiRaidConfig(stored) };
  }

  // Solo toca la llave `antiRaid` del jsonb, sin pisar otros ajustes guardados en settings.
  // El servidor debe existir ya en la tabla guilds (usa ensureGuild antes).
  async setAntiRaidConfig(guildId: string, updates: Partial<AntiRaidSettings>): Promise<AntiRaidSettings> {
    const { enabled, ...configUpdates } = updates;
    const current = await this.getAntiRaidConfig(guildId);
    const merged = normalizeAntiRaidConfig({ ...current, ...configUpdates });
    const hasConfigUpdates = Object.keys(configUpdates).length > 0;

    if (enabled !== undefined || hasConfigUpdates) {
      await db
        .update(guilds)
        .set({
          ...(enabled !== undefined ? { antiRaidEnabled: enabled } : {}),
          ...(hasConfigUpdates
            ? { settings: sql`${jsonObjectOrEmpty(guilds.settings)} || jsonb_build_object('antiRaid', ${JSON.stringify(merged)}::jsonb)` }
            : {}),
        })
        .where(eq(guilds.id, guildId));
    }

    return { ...merged, enabled: enabled ?? current.enabled };
  }

  // Un evento de ESE servidor (nunca de otro, aunque se conozca su ID)
  async getRaidEvent(guildId: string, id: string): Promise<RaidEvent | undefined> {
    const [event] = await db
      .select()
      .from(raidEvents)
      .where(and(eq(raidEvents.guildId, guildId), eq(raidEvents.id, id)));
    return event || undefined;
  }

  // Eventos del más nuevo al más viejo, por páginas (before = el último de la página anterior)
  async queryRaidEvents(guildId: string, filters: RaidEventFilters = {}): Promise<RaidEvent[]> {
    const conditions: SQL[] = [eq(raidEvents.guildId, guildId)];
    if (filters.status === 'open') conditions.push(eq(raidEvents.resolved, false));
    if (filters.status === 'resolved') conditions.push(eq(raidEvents.resolved, true));
    if (filters.before) conditions.push(beforeCursor(raidEvents.createdAt, raidEvents.id, filters.before));

    return await db
      .select()
      .from(raidEvents)
      .where(and(...conditions))
      .orderBy(...newestFirst(raidEvents.createdAt, raidEvents.id))
      .limit(clampLimit(filters.limit ?? 50, 50));
  }

  // ===== PANEL: LISTAS, CONTADORES Y ANALÍTICAS =====
  async queryModerationActions(guildId: string, filters: ModerationActionFilters = {}): Promise<ModerationActionWithUsers[]> {
    const target = alias(users, 'target_user');
    const moderator = alias(users, 'moderator_user');

    const conditions: SQL[] = [eq(moderationActions.guildId, guildId)];
    if (filters.type) conditions.push(eq(moderationActions.type, filters.type));
    if (filters.userId) conditions.push(eq(moderationActions.userId, filters.userId));
    if (filters.before) conditions.push(beforeCursor(moderationActions.createdAt, moderationActions.id, filters.before));

    const rows = await db
      .select({
        action: moderationActions,
        targetUsername: target.username,
        targetAvatar: target.avatar,
        moderatorUsername: moderator.username,
        moderatorAvatar: moderator.avatar,
      })
      .from(moderationActions)
      .leftJoin(target, eq(target.id, moderationActions.userId))
      .leftJoin(moderator, eq(moderator.id, moderationActions.moderatorId))
      .where(and(...conditions))
      .orderBy(...newestFirst(moderationActions.createdAt, moderationActions.id))
      .limit(clampLimit(filters.limit ?? 50, 50));

    return rows.map((row) => ({
      action: row.action,
      user: { id: row.action.userId, username: row.targetUsername ?? null, avatar: row.targetAvatar ?? null },
      moderator: { id: row.action.moderatorId, username: row.moderatorUsername ?? null, avatar: row.moderatorAvatar ?? null },
    }));
  }

  async getLevelLeaderboard(guildId: string, limit: number = 10): Promise<LevelLeaderboardRow[]> {
    const rows = await db
      .select({
        userId: userLevels.userId,
        username: users.username,
        avatar: users.avatar,
        level: userLevels.level,
        xp: userLevels.xp,
        totalXp: userLevels.totalXp,
      })
      .from(userLevels)
      .leftJoin(users, eq(users.id, userLevels.userId))
      .where(eq(userLevels.guildId, guildId))
      .orderBy(desc(userLevels.level), desc(userLevels.xp), userLevels.userId)
      .limit(clampLimit(limit, 10));

    return rows.map((row) => ({
      userId: row.userId,
      username: row.username ?? null,
      avatar: row.avatar ?? null,
      level: row.level ?? 1,
      xp: row.xp ?? 0,
      totalXp: row.totalXp ?? 0,
    }));
  }

  // Cartera + banco (lo que de verdad tiene cada quien ahora mismo)
  async getWealthLeaderboard(guildId: string, limit: number = 10): Promise<WealthLeaderboardRow[]> {
    const total = sql<string>`(coalesce(${userEconomy.balance}, 0) + coalesce(${userEconomy.bank}, 0))`;
    const rows = await db
      .select({
        userId: userEconomy.userId,
        username: users.username,
        avatar: users.avatar,
        wallet: userEconomy.balance,
        bank: userEconomy.bank,
        total,
      })
      .from(userEconomy)
      .leftJoin(users, eq(users.id, userEconomy.userId))
      .where(eq(userEconomy.guildId, guildId))
      .orderBy(desc(total), userEconomy.userId)
      .limit(clampLimit(limit, 10));

    return rows.map((row) => ({
      userId: row.userId,
      username: row.username ?? null,
      avatar: row.avatar ?? null,
      wallet: toNumber(row.wallet),
      bank: toNumber(row.bank),
      total: toNumber(row.total),
    }));
  }

  async getGuildDashboardCounts(guildId: string): Promise<GuildDashboardCounts> {
    const now = Date.now();
    const since7d = new Date(now - 7 * DAY_MS).toISOString();
    const since30d = new Date(now - 30 * DAY_MS);
    const since30dIso = since30d.toISOString();
    const count = sql<number>`count(*)::int`;

    const [levelRows, economyRows, moderationRows, raidRows, commandRows] = await Promise.all([
      db.select({ total: count }).from(userLevels).where(eq(userLevels.guildId, guildId)),
      db
        .select({
          users: count,
          coins: sql<string>`coalesce(sum(coalesce(${userEconomy.balance}, 0) + coalesce(${userEconomy.bank}, 0)), 0)`,
        })
        .from(userEconomy)
        .where(eq(userEconomy.guildId, guildId)),
      db
        .select({
          last7d: sql<number>`(count(*) filter (where ${moderationActions.createdAt} >= ${since7d}::timestamp))::int`,
          last30d: sql<number>`(count(*) filter (where ${moderationActions.createdAt} >= ${since30dIso}::timestamp))::int`,
          warnings30d: sql<number>`(count(*) filter (where ${moderationActions.type} = 'warn' and ${moderationActions.createdAt} >= ${since30dIso}::timestamp))::int`,
          warningsTotal: sql<number>`(count(*) filter (where ${moderationActions.type} = 'warn'))::int`,
        })
        .from(moderationActions)
        .where(eq(moderationActions.guildId, guildId)),
      db
        .select({ total: count })
        .from(raidEvents)
        .where(and(eq(raidEvents.guildId, guildId), gte(raidEvents.createdAt, since30d))),
      db.select({ total: count }).from(customCommands).where(eq(customCommands.guildId, guildId)),
    ]);

    return {
      usersWithLevels: levelRows[0]?.total ?? 0,
      usersWithEconomy: economyRows[0]?.users ?? 0,
      coinsInCirculation: toNumber(economyRows[0]?.coins),
      moderationActions7d: moderationRows[0]?.last7d ?? 0,
      moderationActions30d: moderationRows[0]?.last30d ?? 0,
      warnings30d: moderationRows[0]?.warnings30d ?? 0,
      warningsTotal: moderationRows[0]?.warningsTotal ?? 0,
      raidEvents30d: raidRows[0]?.total ?? 0,
      customCommands: commandRows[0]?.total ?? 0,
    };
  }

  // Cuántas personas hay en cada nivel (para la distribución de niveles)
  async getLevelCounts(guildId: string): Promise<{ level: number; users: number }[]> {
    const level = sql<number>`coalesce(${userLevels.level}, 1)`;
    return await db
      .select({ level, users: sql<number>`count(*)::int` })
      .from(userLevels)
      .where(eq(userLevels.guildId, guildId))
      .groupBy(level)
      .orderBy(level);
  }

  // Tipo y fecha de las acciones desde `since` (para agruparlas por día en la zona del servidor)
  async getModerationActivitySince(guildId: string, since: Date): Promise<{ type: string; createdAt: Date | null }[]> {
    return await db
      .select({ type: moderationActions.type, createdAt: moderationActions.createdAt })
      .from(moderationActions)
      .where(and(eq(moderationActions.guildId, guildId), gte(moderationActions.createdAt, since)))
      .orderBy(desc(moderationActions.createdAt))
      .limit(MAX_ANALYTICS_ROWS);
  }

  // ===== CUSTOM COMMANDS =====
  async getCustomCommands(guildId: string): Promise<CustomCommand[]> {
    return await db
      .select()
      .from(customCommands)
      .where(eq(customCommands.guildId, guildId))
      .orderBy(customCommands.name);
  }

  async getCustomCommand(guildId: string, id: string): Promise<CustomCommand | undefined> {
    const [command] = await db
      .select()
      .from(customCommands)
      .where(and(eq(customCommands.guildId, guildId), eq(customCommands.id, id)));
    return command || undefined;
  }

  async getEnabledCustomCommands(guildId: string): Promise<EnabledCustomCommand[]> {
    return await db
      .select({ id: customCommands.id, name: customCommands.name, response: customCommands.response })
      .from(customCommands)
      .where(and(eq(customCommands.guildId, guildId), eq(customCommands.enabled, true)))
      .limit(MAX_CUSTOM_COMMANDS_PER_GUILD * 2);
  }

  // Máximo 50 por servidor y un nombre por servidor (comprobado aquí y con la restricción única de la tabla)
  async createCustomCommand(data: InsertCustomCommand): Promise<CustomCommand> {
    try {
      return await db.transaction(async (tx) => {
        // Serializa los cambios del mismo servidor para que varias peticiones a la vez no se salten las reglas
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`custom_commands:${data.guildId}`}))`);

        const [{ total }] = await tx
          .select({ total: sql<number>`count(*)::int` })
          .from(customCommands)
          .where(eq(customCommands.guildId, data.guildId));
        if (total >= MAX_CUSTOM_COMMANDS_PER_GUILD) throw new CustomCommandLimitError(MAX_CUSTOM_COMMANDS_PER_GUILD);

        const [existing] = await tx
          .select({ id: customCommands.id })
          .from(customCommands)
          .where(and(eq(customCommands.guildId, data.guildId), eq(customCommands.name, data.name)));
        if (existing) throw new CustomCommandNameTakenError(data.name);

        const [command] = await tx.insert(customCommands).values(data).returning();
        return command;
      });
    } catch (error) {
      throw mapUniqueViolation(error, data.name);
    }
  }

  async updateCustomCommand(guildId: string, id: string, updates: CustomCommandUpdate): Promise<CustomCommand | undefined> {
    if (Object.keys(updates).length === 0) {
      return this.getCustomCommand(guildId, id);
    }

    try {
      return await db.transaction(async (tx) => {
        if (updates.name !== undefined) {
          await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`custom_commands:${guildId}`}))`);
          const [clash] = await tx
            .select({ id: customCommands.id })
            .from(customCommands)
            .where(and(eq(customCommands.guildId, guildId), eq(customCommands.name, updates.name), ne(customCommands.id, id)));
          if (clash) throw new CustomCommandNameTakenError(updates.name);
        }

        const [command] = await tx
          .update(customCommands)
          .set(updates)
          .where(and(eq(customCommands.guildId, guildId), eq(customCommands.id, id)))
          .returning();
        return command || undefined;
      });
    } catch (error) {
      throw mapUniqueViolation(error, updates.name ?? '');
    }
  }

  async setCustomCommandEnabled(guildId: string, id: string, enabled: boolean): Promise<CustomCommand | undefined> {
    const [command] = await db
      .update(customCommands)
      .set({ enabled })
      .where(and(eq(customCommands.guildId, guildId), eq(customCommands.id, id)))
      .returning();
    return command || undefined;
  }

  async deleteCustomCommand(guildId: string, id: string): Promise<boolean> {
    const deleted = await db
      .delete(customCommands)
      .where(and(eq(customCommands.guildId, guildId), eq(customCommands.id, id)))
      .returning({ id: customCommands.id });
    return deleted.length > 0;
  }

  async incrementCustomCommandUses(id: string): Promise<void> {
    await db
      .update(customCommands)
      .set({ uses: sql`coalesce(${customCommands.uses}, 0) + 1` })
      .where(eq(customCommands.id, id));
  }

  // ===== CONTENT FEED METHODS =====
  async getContentFeeds(guildId: string): Promise<ContentFeed[]> {
    return await db
      .select()
      .from(contentFeeds)
      .where(eq(contentFeeds.guildId, guildId));
  }

  // Cada feed publica solo y gasta llamadas a Reddit/Discord, así que hay un máximo por servidor
  async createContentFeed(feedData: InsertContentFeed): Promise<ContentFeed> {
    return await db.transaction(async (tx) => {
      // Serializa las altas del mismo servidor para que varias peticiones a la vez no se salten el límite
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`content_feeds:${feedData.guildId}`}))`);
      const [{ total }] = await tx
        .select({ total: sql<number>`count(*)::int` })
        .from(contentFeeds)
        .where(eq(contentFeeds.guildId, feedData.guildId));
      if (total >= MAX_CONTENT_FEEDS_PER_GUILD) throw new ContentFeedLimitError(MAX_CONTENT_FEEDS_PER_GUILD);

      const [feed] = await tx.insert(contentFeeds).values(feedData).returning();
      return feed;
    });
  }

  async updateContentFeed(id: string, guildId: string, updates: ContentFeedUpdate): Promise<ContentFeed | undefined> {
    const where = and(eq(contentFeeds.id, id), eq(contentFeeds.guildId, guildId));

    if (Object.keys(updates).length === 0) {
      const [feed] = await db.select().from(contentFeeds).where(where);
      return feed || undefined;
    }

    const [feed] = await db.update(contentFeeds).set(updates).where(where).returning();
    return feed || undefined;
  }

  // Borra también el historial de publicaciones del feed (posted_content tiene FK hacia el feed)
  async deleteContentFeed(id: string, guildId: string): Promise<boolean> {
    return await db.transaction(async (tx) => {
      const [feed] = await tx
        .select({ id: contentFeeds.id })
        .from(contentFeeds)
        .where(and(eq(contentFeeds.id, id), eq(contentFeeds.guildId, guildId)));
      if (!feed) return false;

      await tx.delete(postedContent).where(eq(postedContent.feedId, id));
      await tx.delete(contentFeeds).where(eq(contentFeeds.id, id));
      return true;
    });
  }

  async updateGuildSettings(guildId: string, settings: any): Promise<void> {
    // Mezcla los ajustes nuevos con el JSON guardado (guilds.settings).
    // Solo actualiza servidores que ya existen: nunca crea filas para IDs desconocidos
    // (quien llama debe asegurarse antes de que el servidor exista, p. ej. con ensureGuild).
    const patch = settings && typeof settings === 'object' && !Array.isArray(settings) ? settings : {};
    await db
      .update(guilds)
      .set({ settings: sql`COALESCE(${guilds.settings}, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb` })
      .where(eq(guilds.id, guildId));
  }
}


const DAY_MS = 24 * 60 * 60 * 1000;
// Tope de filas para las analíticas (de sobra para 30 días de moderación de un servidor)
const MAX_ANALYTICS_ROWS = 20_000;

// numeric de Postgres llega como texto: lo pasamos a número (0 si no es válido)
function toNumber(value: string | number | null | undefined): number {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(value ?? '0');
  return Number.isFinite(parsed) ? parsed : 0;
}

// Fecha de creación truncada a milisegundos (Postgres guarda microsegundos; un Date de JS solo milisegundos)
function createdAtKey(createdAt: PgColumn) {
  return sql`date_trunc('milliseconds', ${createdAt})`;
}

// Orden estable de lo más nuevo a lo más viejo (el id desempata)
function newestFirst(createdAt: PgColumn, id: PgColumn): SQL[] {
  return [desc(createdAtKey(createdAt)), desc(id)];
}

// Filas que van después del cursor en ese orden. La fecha va como texto ISO (UTC), igual que la guarda drizzle.
function beforeCursor(createdAt: PgColumn, id: PgColumn, cursor: PageCursor): SQL {
  const key = createdAtKey(createdAt);
  const at = cursor.createdAt.toISOString();
  return sql`(${key} < ${at}::timestamp or (${key} = ${at}::timestamp and ${id} < ${cursor.id}))`;
}

// La restricción única de custom_commands (dos altas a la vez con el mismo nombre) como error claro
function mapUniqueViolation(error: unknown, commandName: string): unknown {
  if (error && typeof error === 'object' && (error as { code?: unknown }).code === '23505') {
    return new CustomCommandNameTakenError(commandName);
  }
  return error;
}

// Limita el tamaño de las consultas (evita ?limit=999999 o valores negativos)
function clampLimit(limit: number, fallback: number): number {
  if (!Number.isFinite(limit) || limit < 1) return fallback;
  return Math.min(Math.floor(limit), 500);
}

// La columna jsonb como objeto (o {} si está vacía / no es objeto) para poder mezclarla con ||
function jsonObjectOrEmpty(column: typeof guilds.settings | typeof raidEvents.details) {
  return sql`(case when jsonb_typeof(${column}) = 'object' then ${column} else '{}'::jsonb end)`;
}

// Valida la config guardada campo por campo; lo inválido o ausente toma el valor por defecto
export function normalizeAntiRaidConfig(raw: unknown): AntiRaidConfig {
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const result: Record<string, unknown> = { ...defaultAntiRaidConfig };
  const fields = antiRaidConfigSchema.shape;

  for (const key of Object.keys(fields) as (keyof AntiRaidConfig)[]) {
    const parsed = fields[key].safeParse(source[key]);
    if (parsed.success) result[key] = parsed.data;
  }
  return result as AntiRaidConfig;
}

export const storage = new DatabaseStorage();