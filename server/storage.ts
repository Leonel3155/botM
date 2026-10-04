import type { GuildEngagementSettings } from '@shared/schema';
import { db } from './db';
import { 
  users, guilds, userLevels, userEconomy, economyTransactions, musicQueue,
  type User, type Guild, type UserLevel, type UserEconomy,
  type InsertUser, type InsertGuild, type InsertUserLevel, type InsertUserEconomy
} from '@shared/schema';
import { eq, and, desc, sql } from 'drizzle-orm';

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
  claimDailyQuestion(guildId: string, localDate: string, force?: boolean): Promise<number | null>;
  releaseDailyQuestion(guildId: string, localDate: string, previousDate: string | null): Promise<void>;
  
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
  
  // Music methods (placeholder for now)
  getMusicQueue(guildId: string): Promise<any[]>;
  addToQueue(song: any): Promise<any>;
  clearQueue(guildId: string): Promise<void>;
  
  // Moderation methods (placeholder)
  getModerationActions(guildId: string, limit?: number): Promise<any[]>;
  getRecentRaidEvents(guildId: string, timeWindow?: number): Promise<any[]>;
  createRaidEvent(data: any): Promise<any>;
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
  // Devuelve el índice de la pregunta a publicar, o null si ya se publicó hoy (o está desactivada).
  // Con force=true (comando "ahora") se publica aunque ya haya salido una hoy.
  async claimDailyQuestion(guildId: string, localDate: string, force: boolean = false): Promise<number | null> {
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
      .returning({ index: guilds.dailyQuestionIndex });

    if (!row) return null;
    return Math.max((row.index ?? 1) - 1, 0);
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

  // ===== MUSIC METHODS (Mock for now) =====
  async getMusicQueue(guildId: string): Promise<any[]> {
    // TODO: Implement with real database when music schema is ready
    return [];
  }

  async addToQueue(song: any): Promise<any> {
    // TODO: Implement with real database when music schema is ready
    return song;
  }

  async clearQueue(guildId: string): Promise<void> {
    // TODO: Implement with real database when music schema is ready
  }

  // ===== MODERATION METHODS (Mock for now) =====
  async getModerationActions(guildId: string, limit: number = 50): Promise<any[]> {
    // TODO: Implement with real database when moderation schema is ready
    return [];
  }

  async getRecentRaidEvents(guildId: string, timeWindow: number = 300000): Promise<any[]> {
    // TODO: Implement with real database when raid schema is ready
    return [];
  }

  async createRaidEvent(data: any): Promise<any> {
    // TODO: Implement with real database when raid schema is ready
    return { id: Date.now().toString(), ...data };
  }

  async getContentFeeds(guildId: string): Promise<any[]> {
    // TODO: Implement with real database when content feed schema is ready
    return [];
  }

  async createContentFeed(feedData: any): Promise<any> {
    // TODO: Implement with real database when content feed schema is ready
    return feedData;
  }

  async updateGuildSettings(guildId: string, settings: any): Promise<void> {
    // Mezcla los ajustes nuevos con el JSON guardado (guilds.settings) y crea el servidor si aún no existe
    const patch = settings && typeof settings === 'object' && !Array.isArray(settings) ? settings : {};
    await db
      .insert(guilds)
      .values({ id: guildId, name: 'Unknown Guild', ownerId: 'unknown', settings: patch })
      .onConflictDoUpdate({
        target: guilds.id,
        set: { settings: sql`COALESCE(${guilds.settings}, '{}'::jsonb) || excluded.settings` },
      });
  }
}

export const storage = new DatabaseStorage();