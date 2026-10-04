import { 
  type User, 
  type InsertUser,
  type BotStats,
  type InsertBotStats,
  type SecurityEvent,
  type InsertSecurityEvent,
  type Server,
  type InsertServer,
  type Command,
  type InsertCommand,
  type ModerationLog,
  type InsertModerationLog,
  type BotConfig,
  type InsertBotConfig,
  type AuditLog,
  type InsertAuditLog,
  users,
  botStats,
  securityEvents,
  servers,
  commands,
  moderationLogs,
  botConfig,
  auditLogs,
} from "@shared/schema";
import { db } from "./db";
import { eq, desc, count } from "drizzle-orm";
import { randomUUID } from "crypto";

// Storage interface with all CRUD methods
export interface IStorage {
  // User methods
  getUser(id: string): Promise<User | undefined>;
  getUserByDiscordId(discordId: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;

  // Bot Stats methods
  getCurrentStats(): Promise<BotStats | undefined>;
  insertStats(stats: InsertBotStats): Promise<BotStats>;

  // Security Events methods
  getSecurityEvents(limit?: number): Promise<SecurityEvent[]>;
  getRecentSecurityEvents(count?: number): Promise<SecurityEvent[]>;
  insertSecurityEvent(event: InsertSecurityEvent): Promise<SecurityEvent>;

  // Server methods
  getServers(): Promise<Server[]>;
  getServer(id: string): Promise<Server | undefined>;
  createServer(server: InsertServer): Promise<Server>;
  updateServer(id: string, server: Partial<InsertServer>): Promise<Server | undefined>;

  // Command methods
  getCommands(serverId?: string, limit?: number): Promise<Command[]>;
  insertCommand(command: InsertCommand): Promise<Command>;
  getCommandStats(): Promise<{ commandName: string; count: number }[]>;

  // Moderation Log methods
  getModerationLogs(serverId?: string, limit?: number): Promise<ModerationLog[]>;
  insertModerationLog(log: InsertModerationLog): Promise<ModerationLog>;

  // Bot Config methods
  getConfig(key: string): Promise<BotConfig | undefined>;
  getAllConfig(): Promise<BotConfig[]>;
  setConfig(config: InsertBotConfig): Promise<BotConfig>;

  // Audit Log methods
  getAuditLogs(limit?: number): Promise<AuditLog[]>;
  insertAuditLog(log: InsertAuditLog): Promise<AuditLog>;
}

export class MemStorage implements IStorage {
  private users: Map<string, User>;
  private stats: BotStats | null;
  private securityEvents: SecurityEvent[];
  private servers: Map<string, Server>;

  constructor() {
    this.users = new Map();
    this.stats = null;
    this.securityEvents = [];
    this.servers = new Map();
    
    // Initialize with mock data for development
    this.initializeMockData();
  }

  private initializeMockData() {
    // Mock bot stats
    this.stats = {
      id: randomUUID(),
      serverCount: 142,
      userCount: 8547,
      uptimeSeconds: 3456789, // ~40 days
      memoryUsageMB: 256,
      commandsExecuted: 125843,
      timestamp: new Date(),
    };

    // Mock security events
    const mockEvents: InsertSecurityEvent[] = [
      {
        eventType: "login_success",
        severity: "info",
        description: "Successful dashboard login",
        ipAddress: "192.168.1.100",
      },
      {
        eventType: "bot_restart",
        severity: "warning",
        description: "Bot service restarted automatically",
        ipAddress: null,
      },
      {
        eventType: "login_failed",
        severity: "error",
        description: "Failed login attempt from unknown IP",
        ipAddress: "45.123.45.67",
      },
      {
        eventType: "permission_change",
        severity: "warning",
        description: "Bot permissions updated in server 'Gaming Community'",
        ipAddress: null,
      },
      {
        eventType: "login_success",
        severity: "info",
        description: "Successful dashboard login",
        ipAddress: "192.168.1.100",
      },
      {
        eventType: "bot_restart",
        severity: "info",
        description: "Bot service started",
        ipAddress: null,
      },
    ];

    // Insert mock events with timestamps
    const now = Date.now();
    mockEvents.forEach((event, index) => {
      const hoursAgo = Math.pow(2, index); // 1h, 2h, 4h, 8h, 16h, 32h
      this.securityEvents.push({
        id: randomUUID(),
        ...event,
        ipAddress: event.ipAddress ?? null,
        timestamp: new Date(now - hoursAgo * 60 * 60 * 1000),
      });
    });

    // Sort by timestamp descending (newest first)
    this.securityEvents.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    // Mock server data with engagement metrics
    const mockServers: Server[] = [
      {
        id: "123456789012345678",
        name: "Gaming Community",
        icon: null,
        memberCount: 2543,
        activeUsers: 1248, // 49% engagement - Excellent
        commandsUsed: 8734,
        botJoinedAt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000), // 90 days ago
        isActive: true,
        prefix: "!",
        lastActivityUpdate: new Date(),
      },
      {
        id: "234567890123456789",
        name: "Developer Hub",
        icon: null,
        memberCount: 1842,
        activeUsers: 421, // 23% engagement - Good
        commandsUsed: 3201,
        botJoinedAt: new Date(Date.now() - 120 * 24 * 60 * 60 * 1000), // 120 days ago
        isActive: true,
        prefix: "$",
        lastActivityUpdate: new Date(),
      },
      {
        id: "345678901234567890",
        name: "Music Lovers",
        icon: null,
        memberCount: 3127,
        activeUsers: 378, // 12% engagement - Moderate
        commandsUsed: 5829,
        botJoinedAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000), // 60 days ago
        isActive: true,
        prefix: "!",
        lastActivityUpdate: new Date(),
      },
      {
        id: "456789012345678901",
        name: "Anime Fans",
        icon: null,
        memberCount: 1000,
        activeUsers: 58, // 5.8% engagement - Low
        commandsUsed: 412,
        botJoinedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // 30 days ago
        isActive: true,
        prefix: ">",
        lastActivityUpdate: new Date(),
      },
    ];

    mockServers.forEach(server => {
      this.servers.set(server.id, server);
    });
  }

  // User methods
  async getUser(id: string): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByDiscordId(discordId: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      (user) => user.discordId === discordId,
    );
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const user: User = { 
      ...insertUser,
      discriminator: insertUser.discriminator ?? null,
      avatar: insertUser.avatar ?? null,
      email: insertUser.email ?? null,
      lastLogin: new Date() 
    };
    this.users.set(user.id, user);
    return user;
  }

  // Bot Stats methods
  async getCurrentStats(): Promise<BotStats | undefined> {
    return this.stats || undefined;
  }

  async insertStats(insertStats: InsertBotStats): Promise<BotStats> {
    const stats: BotStats = {
      id: randomUUID(),
      ...insertStats,
      timestamp: new Date(),
    };
    this.stats = stats;
    return stats;
  }

  // Security Events methods
  async getSecurityEvents(limit?: number): Promise<SecurityEvent[]> {
    if (limit) {
      return this.securityEvents.slice(0, limit);
    }
    return [...this.securityEvents];
  }

  async getRecentSecurityEvents(count: number = 5): Promise<SecurityEvent[]> {
    return this.securityEvents.slice(0, count);
  }

  async insertSecurityEvent(insertEvent: InsertSecurityEvent): Promise<SecurityEvent> {
    const event: SecurityEvent = {
      id: randomUUID(),
      ...insertEvent,
      ipAddress: insertEvent.ipAddress ?? null,
      timestamp: new Date(),
    };
    this.securityEvents.unshift(event); // Add to beginning
    return event;
  }

  // Server methods
  async getServers(): Promise<Server[]> {
    return Array.from(this.servers.values()).sort((a, b) => 
      b.botJoinedAt.getTime() - a.botJoinedAt.getTime()
    );
  }
  
  async getServer(id: string): Promise<Server | undefined> {
    return this.servers.get(id);
  }
  
  async createServer(insertServer: InsertServer): Promise<Server> {
    const server: Server = {
      ...insertServer,
      icon: insertServer.icon ?? null,
      activeUsers: insertServer.activeUsers ?? 0,
      commandsUsed: insertServer.commandsUsed ?? 0,
      botJoinedAt: new Date(),
      isActive: insertServer.isActive ?? true,
      prefix: insertServer.prefix ?? "!",
      lastActivityUpdate: new Date(),
    };
    this.servers.set(server.id, server);
    return server;
  }
  
  async updateServer(id: string, updateData: Partial<InsertServer>): Promise<Server | undefined> {
    const server = this.servers.get(id);
    if (!server) return undefined;
    
    const updated: Server = {
      ...server,
      ...updateData,
      lastActivityUpdate: new Date(),
    };
    this.servers.set(id, updated);
    return updated;
  }

  // Command methods (not implemented for MemStorage)
  async getCommands(serverId?: string, limit?: number): Promise<Command[]> { return []; }
  async insertCommand(command: InsertCommand): Promise<Command> { 
    throw new Error("Not implemented in MemStorage"); 
  }
  async getCommandStats(): Promise<{ commandName: string; count: number }[]> { return []; }

  // Moderation Log methods (not implemented for MemStorage)
  async getModerationLogs(serverId?: string, limit?: number): Promise<ModerationLog[]> { return []; }
  async insertModerationLog(log: InsertModerationLog): Promise<ModerationLog> { 
    throw new Error("Not implemented in MemStorage"); 
  }

  // Bot Config methods (not implemented for MemStorage)
  async getConfig(key: string): Promise<BotConfig | undefined> { return undefined; }
  async getAllConfig(): Promise<BotConfig[]> { return []; }
  async setConfig(config: InsertBotConfig): Promise<BotConfig> { 
    throw new Error("Not implemented in MemStorage"); 
  }

  // Audit Log methods (not implemented for MemStorage)
  async getAuditLogs(limit?: number): Promise<AuditLog[]> { return []; }
  async insertAuditLog(log: InsertAuditLog): Promise<AuditLog> { 
    throw new Error("Not implemented in MemStorage"); 
  }
}

// Database Storage implementation
export class DatabaseStorage implements IStorage {
  // User methods
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || undefined;
  }

  async getUserByDiscordId(discordId: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.discordId, discordId));
    return user || undefined;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values(insertUser).returning();
    return user;
  }

  // Bot Stats methods
  async getCurrentStats(): Promise<BotStats | undefined> {
    const [stats] = await db.select().from(botStats).orderBy(desc(botStats.timestamp)).limit(1);
    return stats || undefined;
  }

  async insertStats(insertStats: InsertBotStats): Promise<BotStats> {
    const [stats] = await db.insert(botStats).values(insertStats).returning();
    return stats;
  }

  // Security Events methods
  async getSecurityEvents(limit?: number): Promise<SecurityEvent[]> {
    if (limit) {
      return await db.select().from(securityEvents).orderBy(desc(securityEvents.timestamp)).limit(limit);
    }
    return await db.select().from(securityEvents).orderBy(desc(securityEvents.timestamp));
  }

  async getRecentSecurityEvents(count: number = 5): Promise<SecurityEvent[]> {
    return await db.select().from(securityEvents).orderBy(desc(securityEvents.timestamp)).limit(count);
  }

  async insertSecurityEvent(insertEvent: InsertSecurityEvent): Promise<SecurityEvent> {
    const [event] = await db.insert(securityEvents).values(insertEvent).returning();
    return event;
  }

  // Server methods
  async getServers(): Promise<Server[]> {
    return await db.select().from(servers).orderBy(desc(servers.botJoinedAt));
  }

  async getServer(id: string): Promise<Server | undefined> {
    const [server] = await db.select().from(servers).where(eq(servers.id, id));
    return server || undefined;
  }

  async createServer(insertServer: InsertServer): Promise<Server> {
    const [server] = await db.insert(servers).values(insertServer).returning();
    return server;
  }

  async updateServer(id: string, updateData: Partial<InsertServer>): Promise<Server | undefined> {
    const [server] = await db.update(servers).set(updateData).where(eq(servers.id, id)).returning();
    return server || undefined;
  }

  // Command methods
  async getCommands(serverId?: string, limit?: number): Promise<Command[]> {
    let query = db.select().from(commands).orderBy(desc(commands.executedAt));
    if (serverId) {
      query = query.where(eq(commands.serverId, serverId)) as any;
    }
    if (limit) {
      query = query.limit(limit) as any;
    }
    return await query;
  }

  async insertCommand(insertCommand: InsertCommand): Promise<Command> {
    const [command] = await db.insert(commands).values(insertCommand).returning();
    return command;
  }

  async getCommandStats(): Promise<{ commandName: string; count: number }[]> {
    const result = await db.select({
      commandName: commands.commandName,
      count: count(commands.id),
    })
    .from(commands)
    .groupBy(commands.commandName)
    .orderBy(desc(count(commands.id)));
    
    return result.map(r => ({ commandName: r.commandName, count: Number(r.count) }));
  }

  // Moderation Log methods
  async getModerationLogs(serverId?: string, limit?: number): Promise<ModerationLog[]> {
    let query = db.select().from(moderationLogs).orderBy(desc(moderationLogs.timestamp));
    if (serverId) {
      query = query.where(eq(moderationLogs.serverId, serverId)) as any;
    }
    if (limit) {
      query = query.limit(limit) as any;
    }
    return await query;
  }

  async insertModerationLog(insertLog: InsertModerationLog): Promise<ModerationLog> {
    const [log] = await db.insert(moderationLogs).values(insertLog).returning();
    return log;
  }

  // Bot Config methods
  async getConfig(key: string): Promise<BotConfig | undefined> {
    const [config] = await db.select().from(botConfig).where(eq(botConfig.key, key));
    return config || undefined;
  }

  async getAllConfig(): Promise<BotConfig[]> {
    return await db.select().from(botConfig).orderBy(botConfig.key);
  }

  async setConfig(insertConfig: InsertBotConfig): Promise<BotConfig> {
    const existing = await this.getConfig(insertConfig.key);
    if (existing) {
      const [config] = await db.update(botConfig)
        .set({ value: insertConfig.value, updatedAt: new Date(), updatedBy: insertConfig.updatedBy })
        .where(eq(botConfig.key, insertConfig.key))
        .returning();
      return config;
    } else {
      const [config] = await db.insert(botConfig).values(insertConfig).returning();
      return config;
    }
  }

  // Audit Log methods
  async getAuditLogs(limit?: number): Promise<AuditLog[]> {
    let query = db.select().from(auditLogs).orderBy(desc(auditLogs.timestamp));
    if (limit) {
      query = query.limit(limit) as any;
    }
    return await query;
  }

  async insertAuditLog(insertLog: InsertAuditLog): Promise<AuditLog> {
    const [log] = await db.insert(auditLogs).values(insertLog).returning();
    return log;
  }
}

export const storage = new DatabaseStorage();
