import { db } from './db';
import { 
  users, guilds, userLevels, userEconomy, economyTransactions,
  moderationActions, raidEvents, contentFeeds, postedContent,
  antiRaidConfigSchema, defaultAntiRaidConfig,
  type User, type Guild, type UserLevel, type UserEconomy,
  type InsertUser, type InsertGuild, type InsertUserLevel, type InsertUserEconomy,
  type ModerationAction, type InsertModerationAction, type RaidEvent, type InsertRaidEvent,
  type ContentFeed, type InsertContentFeed, type AntiRaidConfig, type AntiRaidSettings
} from '@shared/schema';
import { eq, and, desc, sql, gte } from 'drizzle-orm';

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
  getAntiRaidConfig(guildId: string): Promise<AntiRaidSettings>;
  setAntiRaidConfig(guildId: string, updates: Partial<AntiRaidSettings>): Promise<AntiRaidSettings>;

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

  // ===== CONTENT FEED METHODS =====
  async getContentFeeds(guildId: string): Promise<ContentFeed[]> {
    return await db
      .select()
      .from(contentFeeds)
      .where(eq(contentFeeds.guildId, guildId));
  }

  async createContentFeed(feedData: InsertContentFeed): Promise<ContentFeed> {
    const [feed] = await db.insert(contentFeeds).values(feedData).returning();
    return feed;
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
    // TODO: Implement with real database when guild settings schema is ready
  }
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