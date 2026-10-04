import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Bot Statistics Schema
export const botStats = pgTable("bot_stats", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  serverCount: integer("server_count").notNull(),
  userCount: integer("user_count").notNull(),
  uptimeSeconds: integer("uptime_seconds").notNull(),
  memoryUsageMB: integer("memory_usage_mb").notNull(),
  commandsExecuted: integer("commands_executed").notNull(),
  timestamp: timestamp("timestamp").notNull().defaultNow(),
});

// Security Events Schema
export const securityEvents = pgTable("security_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  eventType: text("event_type").notNull(), // 'login_success', 'login_failed', 'bot_restart', 'permission_change', etc.
  severity: text("severity").notNull(), // 'info', 'warning', 'error'
  description: text("description").notNull(),
  ipAddress: text("ip_address"),
  timestamp: timestamp("timestamp").notNull().defaultNow(),
});

// User Schema (for Discord OAuth)
export const users = pgTable("users", {
  id: varchar("id").primaryKey(),
  discordId: text("discord_id").notNull().unique(),
  username: text("username").notNull(),
  discriminator: text("discriminator"),
  avatar: text("avatar"),
  email: text("email"),
  lastLogin: timestamp("last_login").notNull().defaultNow(),
});

// Servers Schema (Discord servers where bot is active)
export const servers = pgTable("servers", {
  id: varchar("id").primaryKey(), // Discord server ID
  name: text("name").notNull(),
  icon: text("icon"),
  memberCount: integer("member_count").notNull(),
  activeUsers: integer("active_users").notNull().default(0), // Unique users who used bot in last 30 days
  commandsUsed: integer("commands_used").notNull().default(0), // Total commands used in last 30 days
  botJoinedAt: timestamp("bot_joined_at").notNull().defaultNow(),
  isActive: boolean("is_active").notNull().default(true),
  prefix: text("prefix").default("!"),
  lastActivityUpdate: timestamp("last_activity_update").defaultNow(),
});

// Commands Schema (for analytics)
export const commands = pgTable("commands", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  commandName: text("command_name").notNull(),
  serverId: varchar("server_id").references(() => servers.id),
  userId: text("user_id"),
  executedAt: timestamp("executed_at").notNull().defaultNow(),
  success: boolean("success").notNull().default(true),
  errorMessage: text("error_message"),
});

// Moderation Logs Schema
export const moderationLogs = pgTable("moderation_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  serverId: varchar("server_id").notNull().references(() => servers.id),
  moderatorId: text("moderator_id").notNull(),
  moderatorName: text("moderator_name").notNull(),
  targetUserId: text("target_user_id").notNull(),
  targetUsername: text("target_username").notNull(),
  action: text("action").notNull(), // 'ban', 'kick', 'mute', 'warn', etc.
  reason: text("reason"),
  timestamp: timestamp("timestamp").notNull().defaultNow(),
});

// Bot Configuration Schema
export const botConfig = pgTable("bot_config", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  key: text("key").notNull().unique(),
  value: text("value").notNull(),
  description: text("description"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  updatedBy: varchar("updated_by").references(() => users.id),
});

// Audit Logs Schema (dashboard actions)
export const auditLogs = pgTable("audit_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  username: text("username").notNull(),
  action: text("action").notNull(), // 'config_update', 'server_manage', 'user_action', etc.
  details: text("details").notNull(),
  ipAddress: text("ip_address"),
  timestamp: timestamp("timestamp").notNull().defaultNow(),
});

// Insert Schemas
export const insertBotStatsSchema = createInsertSchema(botStats).omit({ id: true, timestamp: true });
export const insertSecurityEventSchema = createInsertSchema(securityEvents).omit({ id: true, timestamp: true });
export const insertUserSchema = createInsertSchema(users).omit({ lastLogin: true });
export const insertServerSchema = createInsertSchema(servers).omit({ botJoinedAt: true, lastActivityUpdate: true });
export const insertCommandSchema = createInsertSchema(commands).omit({ id: true, executedAt: true });
export const insertModerationLogSchema = createInsertSchema(moderationLogs).omit({ id: true, timestamp: true });
export const insertBotConfigSchema = createInsertSchema(botConfig).omit({ id: true, updatedAt: true });
export const insertAuditLogSchema = createInsertSchema(auditLogs).omit({ id: true, timestamp: true });

// Types
export type BotStats = typeof botStats.$inferSelect;
export type InsertBotStats = z.infer<typeof insertBotStatsSchema>;

export type SecurityEvent = typeof securityEvents.$inferSelect;
export type InsertSecurityEvent = z.infer<typeof insertSecurityEventSchema>;

export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;

export type Server = typeof servers.$inferSelect;
export type InsertServer = z.infer<typeof insertServerSchema>;

export type Command = typeof commands.$inferSelect;
export type InsertCommand = z.infer<typeof insertCommandSchema>;

export type ModerationLog = typeof moderationLogs.$inferSelect;
export type InsertModerationLog = z.infer<typeof insertModerationLogSchema>;

export type BotConfig = typeof botConfig.$inferSelect;
export type InsertBotConfig = z.infer<typeof insertBotConfigSchema>;

export type AuditLog = typeof auditLogs.$inferSelect;
export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;

// Serialized types for API responses (Date fields become strings after JSON serialization)
export type SerializedCommand = Omit<Command, "executedAt"> & { executedAt: string };
export type SerializedBotStats = Omit<BotStats, "timestamp"> & { timestamp: string };
export type SerializedSecurityEvent = Omit<SecurityEvent, "timestamp"> & { timestamp: string };
export type SerializedServer = Omit<Server, "botJoinedAt" | "lastActivityUpdate"> & { 
  botJoinedAt: string;
  lastActivityUpdate: string | null;
  engagementPercentage?: number; // Calculated on frontend
};
export type SerializedUser = Omit<User, "lastLogin"> & { lastLogin: string };
export type SerializedModerationLog = Omit<ModerationLog, "timestamp"> & { timestamp: string };
export type SerializedBotConfig = Omit<BotConfig, "updatedAt"> & { updatedAt: string };
export type SerializedAuditLog = Omit<AuditLog, "timestamp"> & { timestamp: string };
