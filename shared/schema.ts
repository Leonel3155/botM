import { sql, relations } from "drizzle-orm";
import { pgTable, text, varchar, integer, timestamp, boolean, jsonb, decimal, unique, primaryKey } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Users table for Discord users
export const users = pgTable("users", {
  id: varchar("id").primaryKey(), // Discord user ID
  username: text("username").notNull(),
  discriminator: text("discriminator"),
  avatar: text("avatar"),
  createdAt: timestamp("created_at").default(sql`now()`),
});

// Guilds table for Discord servers
export const guilds = pgTable("guilds", {
  id: varchar("id").primaryKey(), // Discord guild ID
  name: text("name").notNull(),
  icon: text("icon"),
  ownerId: varchar("owner_id").notNull(),
  prefix: varchar("prefix", { length: 5 }).default("&"),
  levelUpMessages: boolean("level_up_messages").default(true),
  economyEnabled: boolean("economy_enabled").default(true),
  antiRaidEnabled: boolean("anti_raid_enabled").default(false),
  // Channel configurations
  // Sin uso: la música se quitó. La columna se deja para que `npm run db:push` no pida confirmar
  // un borrado de datos; se puede eliminar más adelante.
  musicChannelId: varchar("music_channel_id"),
  contentChannelId: varchar("content_channel_id"), 
  moderationChannelId: varchar("moderation_channel_id"),
  welcomeChannelId: varchar("welcome_channel_id"),
  // Social media settings
  redditEnabled: boolean("reddit_enabled").default(false),
  twitterEnabled: boolean("twitter_enabled").default(false),
  // Bienvenida (el canal es welcomeChannelId, arriba). welcomeMessage null = mensaje predeterminado
  welcomeEnabled: boolean("welcome_enabled").default(false),
  welcomeMessage: text("welcome_message"),
  welcomeRoleId: varchar("welcome_role_id"),
  // Pregunta del día
  dailyQuestionEnabled: boolean("daily_question_enabled").default(false),
  dailyQuestionChannelId: varchar("daily_question_channel_id"),
  dailyQuestionHour: integer("daily_question_hour").default(18), // 0-23, hora local del servidor
  dailyQuestionThread: boolean("daily_question_thread").default(true), // abrir un hilo para las respuestas
  dailyQuestionIndex: integer("daily_question_index").default(0), // preguntas publicadas hasta ahora
  dailyQuestionUsed: jsonb("daily_question_used").default([]), // claves (hash del texto) de las que ya salieron en esta vuelta
  dailyQuestionLastPosted: varchar("daily_question_last_posted", { length: 10 }), // YYYY-MM-DD en la zona del servidor
  // Zona horaria IANA del servidor (pregunta del día y eventos)
  timezone: text("timezone").default("America/Mexico_City"),
  settings: jsonb("settings").default({}),
  createdAt: timestamp("created_at").default(sql`now()`),
});

// Ajustes de bienvenida, pregunta del día y zona horaria que se pueden cambiar desde el bot
export type GuildEngagementSettings = Pick<
  typeof guilds.$inferSelect,
  | "welcomeEnabled"
  | "welcomeChannelId"
  | "welcomeMessage"
  | "welcomeRoleId"
  | "dailyQuestionEnabled"
  | "dailyQuestionChannelId"
  | "dailyQuestionHour"
  | "dailyQuestionThread"
  | "dailyQuestionIndex"
  | "dailyQuestionLastPosted"
  | "timezone"
>;

// User levels per guild
export const userLevels = pgTable("user_levels", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  guildId: varchar("guild_id").notNull().references(() => guilds.id),
  xp: integer("xp").default(0),
  level: integer("level").default(1),
  totalXp: integer("total_xp").default(0),
  lastMessageAt: timestamp("last_message_at"),
  voiceTime: integer("voice_time").default(0), // in minutes
});

// Economy system with psychological rewards
export const userEconomy = pgTable("user_economy", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  guildId: varchar("guild_id").notNull().references(() => guilds.id),
  balance: decimal("balance", { precision: 15, scale: 2 }).default("0"),
  bank: decimal("bank", { precision: 15, scale: 2 }).default("0"),
  dailyStreak: integer("daily_streak").default(0),
  lastDaily: timestamp("last_daily"),
  lastWork: timestamp("last_work"),
  lastRob: timestamp("last_rob"),
  lastCrime: timestamp("last_crime"),
  lastSlut: timestamp("last_slut"),
  bankSpace: decimal("bank_space", { precision: 15, scale: 2 }).default("10000"),
  totalEarned: decimal("total_earned", { precision: 15, scale: 2 }).default("0"),
  totalLost: decimal("total_lost", { precision: 15, scale: 2 }).default("0"),
  netWorth: decimal("net_worth", { precision: 15, scale: 2 }).default("0"),
  // New psychological elements
  lotteryTickets: integer("lottery_tickets").default(0),
  totalGambled: decimal("total_gambled", { precision: 15, scale: 2 }).default("0"),
  biggestWin: decimal("biggest_win", { precision: 15, scale: 2 }).default("0"),
  luckyStreak: integer("lucky_streak").default(0), // Consecutive wins
  lastLotteryWin: timestamp("last_lottery_win"),
  prestigeLevel: integer("prestige_level").default(0), // Prestige system
});

// Virtual collectibles and rare items
export const virtualItems = pgTable("virtual_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  type: text("type").notNull(), // 'badge', 'skin', 'emote', 'title', 'aura'
  rarity: text("rarity").notNull(), // 'common', 'rare', 'epic', 'legendary', 'mythic'
  description: text("description"),
  emoji: varchar("emoji", { length: 10 }),
  unlockLevel: integer("unlock_level"),
  dropChance: decimal("drop_chance", { precision: 5, scale: 4 }), // 0.0001 = 0.01% 
  price: decimal("price", { precision: 15, scale: 2 }), // Can be bought
  isLimited: boolean("is_limited").default(false), // Limited time items
  createdAt: timestamp("created_at").default(sql`now()`)
});

// Daily lottery system  
export const lotteryDraws = pgTable("lottery_draws", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  guildId: varchar("guild_id").notNull().references(() => guilds.id),
  drawDate: timestamp("draw_date").notNull(),
  totalPot: decimal("total_pot", { precision: 15, scale: 2 }).notNull(),
  winnerId: varchar("winner_id"),
  winnerPrize: decimal("winner_prize", { precision: 15, scale: 2 }),
  participants: integer("participants").default(0),
  isComplete: boolean("is_complete").default(false),
  createdAt: timestamp("created_at").default(sql`now()`)
});

// User achievements and milestones
export const userAchievements = pgTable("user_achievements", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  guildId: varchar("guild_id").notNull().references(() => guilds.id),
  achievementId: varchar("achievement_id").notNull(),
  unlockedAt: timestamp("unlocked_at").default(sql`now()`)
});

// User inventory for items
export const userInventory = pgTable("user_inventory", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  guildId: varchar("guild_id").notNull().references(() => guilds.id),
  itemId: varchar("item_id").notNull(),
  quantity: integer("quantity").default(1),
  obtainedAt: timestamp("obtained_at").default(sql`now()`),
});

// Economy items (shop items, collectibles)
export const economyItems = pgTable("economy_items", {
  id: varchar("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  price: decimal("price", { precision: 15, scale: 2 }).notNull(),
  sellPrice: decimal("sell_price", { precision: 15, scale: 2 }),
  category: text("category").notNull(), // tools, collectibles, consumables
  rarity: text("rarity").default("common"), // common, rare, epic, legendary
  emoji: text("emoji"),
  buyable: boolean("buyable").default(true),
  sellable: boolean("sellable").default(true),
  effects: jsonb("effects").default({}), // special effects like rob protection
});

// Economy transactions history
export const economyTransactions = pgTable("economy_transactions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  guildId: varchar("guild_id").notNull().references(() => guilds.id),
  type: text("type").notNull(), // daily, work, rob, crime, gamble, transfer
  amount: decimal("amount", { precision: 15, scale: 2 }).notNull(),
  targetUserId: varchar("target_user_id"), // for rob, transfer
  details: jsonb("details").default({}),
  createdAt: timestamp("created_at").default(sql`now()`),
});

// Moderation actions
export const moderationActions = pgTable("moderation_actions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  guildId: varchar("guild_id").notNull().references(() => guilds.id),
  userId: varchar("user_id").notNull().references(() => users.id),
  moderatorId: varchar("moderator_id").notNull().references(() => users.id),
  type: text("type").notNull(), // warn, mute, kick, ban
  reason: text("reason"),
  duration: integer("duration"), // in minutes for temporary actions
  active: boolean("active").default(true),
  createdAt: timestamp("created_at").default(sql`now()`),
});

// Anti-raid events
export const raidEvents = pgTable("raid_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  guildId: varchar("guild_id").notNull().references(() => guilds.id),
  type: text("type").notNull(), // join_spam, suspicious_activity, mass_mention
  severity: text("severity").notNull(), // low, medium, high
  details: jsonb("details").default({}),
  resolved: boolean("resolved").default(false),
  createdAt: timestamp("created_at").default(sql`now()`),
});

// Anti-raid configuration. `enabled` lives in guilds.anti_raid_enabled (the dashboard toggles it);
// the rest is stored under guilds.settings.antiRaid (jsonb) so no extra columns are needed.
export const antiRaidActions = ["alert", "verification", "lockdown"] as const;
export type AntiRaidAction = typeof antiRaidActions[number];

export const antiRaidConfigSchema = z.object({
  joinThreshold: z.number().int().min(3).max(100),      // N entradas...
  joinWindowSeconds: z.number().int().min(5).max(300),  // ...en T segundos = raid
  action: z.enum(antiRaidActions),                      // qué hacer al detectar un raid
  logChannelId: z.string().nullable(),                  // canal de alertas (null = automático)
  minAccountAgeDays: z.number().int().min(0).max(365),  // cuentas más nuevas = sospechosas
  lockdownMinutes: z.number().int().min(1).max(1440),   // cuánto dura el modo raid
});
export type AntiRaidConfig = z.infer<typeof antiRaidConfigSchema>;
export type AntiRaidSettings = AntiRaidConfig & { enabled: boolean };

export const defaultAntiRaidConfig: AntiRaidConfig = {
  joinThreshold: 8,
  joinWindowSeconds: 15,
  action: "verification",
  logChannelId: null,
  minAccountAgeDays: 7,
  lockdownMinutes: 10,
};

// Social content feeds
export const contentFeeds = pgTable("content_feeds", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  guildId: varchar("guild_id").notNull().references(() => guilds.id),
  channelId: varchar("channel_id"), // Made nullable for configuration
  source: text("source").notNull(), // reddit, twitter
  sourceConfig: jsonb("source_config").default({}),
  enabled: boolean("enabled").notNull().default(true),
  lastPosted: timestamp("last_posted"),
  postInterval: integer("post_interval").notNull().default(30), // in minutes
});

// Posted content tracking
export const postedContent = pgTable("posted_content", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  feedId: varchar("feed_id").notNull().references(() => contentFeeds.id),
  sourceId: text("source_id").notNull(), // Reddit post ID or Tweet ID
  messageId: varchar("message_id"), // Discord message ID
  title: text("title"),
  url: text("url"),
  postedAt: timestamp("posted_at").default(sql`now()`),
});

// /lockdown: cómo estaban los permisos de @everyone en el canal antes de bloquearlo,
// para que /lockdown Desactivar los deje igual (también tras reiniciar el bot)
export const channelLockdowns = pgTable("channel_lockdowns", {
  guildId: varchar("guild_id").notNull(),
  channelId: varchar("channel_id").notNull(),
  // { permissions: { SendMessages: true | false | null, ... }, hadOverwrite: boolean }
  previous: jsonb("previous").notNull(),
  createdAt: timestamp("created_at").default(sql`now()`),
}, (table) => [
  primaryKey({ columns: [table.guildId, table.channelId] }),
]);

// Apuestas retenidas de juegos con varios pasos (/blackjack). Si el bot se reinicia a mitad
// de una partida, al volver devuelve estas apuestas a la cartera.
export const pendingBets = pgTable("pending_bets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  guildId: varchar("guild_id").notNull(),
  userId: varchar("user_id").notNull(),
  amount: decimal("amount", { precision: 15, scale: 2 }).notNull(),
  createdAt: timestamp("created_at").notNull(),
});

// Comandos personalizados: el bot responde a "<prefijo><name>" con `response` (máx. 50 por servidor)
export const customCommands = pgTable("custom_commands", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  guildId: varchar("guild_id").notNull().references(() => guilds.id),
  name: text("name").notNull(), // minúsculas, números, "-" y "_" (1-32)
  description: text("description"), // nota para el panel (opcional)
  response: text("response").notNull(), // máx. 2000 caracteres, con {usuario} {servidor} {canal}...
  enabled: boolean("enabled").default(true),
  uses: integer("uses").default(0),
  createdBy: varchar("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at").default(sql`now()`),
}, (table) => [
  // Un nombre por servidor
  unique("custom_commands_guild_name_unique").on(table.guildId, table.name),
]);

// Autorroles: un mensaje con botones; cada botón da o quita un rol a quien lo pulsa
export interface RolePanelButton {
  roleId: string;
  label: string;
  emoji: string | null;
}

export const rolePanels = pgTable("role_panels", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  guildId: varchar("guild_id").notNull().references(() => guilds.id),
  channelId: varchar("channel_id").notNull(),
  messageId: varchar("message_id"), // null si todavía no se publicó o se borró
  title: text("title").notNull(),
  description: text("description"),
  roles: jsonb("roles").$type<RolePanelButton[]>().notNull().default([]),
  exclusive: boolean("exclusive").notNull().default(false), // solo un rol de este panel a la vez
  createdAt: timestamp("created_at").default(sql`now()`),
  updatedAt: timestamp("updated_at").default(sql`now()`),
});

// Tienda del servidor: se configura solo desde el panel; se compra con /comprar
export const shopItems = pgTable("shop_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  guildId: varchar("guild_id").notNull().references(() => guilds.id),
  name: text("name").notNull(),
  description: text("description"),
  emoji: text("emoji"),
  price: integer("price").notNull(),
  roleId: varchar("role_id"), // si tiene, al comprarlo se da este rol (una sola vez por persona)
  stock: integer("stock"), // null = ilimitado
  sold: integer("sold").notNull().default(0),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at").default(sql`now()`),
}, (table) => [
  unique("shop_items_guild_name_unique").on(table.guildId, table.name),
]);

// Lo que cada persona compró (los artículos que dan rol no se guardan aquí: el rol es el artículo)
export const shopInventory = pgTable("shop_inventory", {
  guildId: varchar("guild_id").notNull(),
  userId: varchar("user_id").notNull(),
  itemId: varchar("item_id").notNull().references(() => shopItems.id, { onDelete: "cascade" }),
  quantity: integer("quantity").notNull().default(0),
  updatedAt: timestamp("updated_at").default(sql`now()`),
}, (table) => [
  primaryKey({ columns: [table.guildId, table.userId, table.itemId] }),
]);

export type RolePanel = typeof rolePanels.$inferSelect;
export type ShopItem = typeof shopItems.$inferSelect;

// ===== Funciones extra (diversión y moderación automática) =====

export type LogEvent = "messageDelete" | "messageEdit" | "memberJoin" | "memberLeave" | "moderation" | "roles";

export interface AutoPunishRule {
  /** Con cuántos warns activos se aplica. */
  warns: number;
  action: "timeout" | "kick" | "ban";
  /** Solo para "timeout". */
  minutes?: number;
}

// Un renglón por servidor, creado la primera vez que se guarda algo desde el panel
export const guildExtras = pgTable("guild_extras", {
  guildId: varchar("guild_id").primaryKey().references(() => guilds.id),
  // Interacciones con GIFs (/abrazar, /besar…)
  interactionsEnabled: boolean("interactions_enabled").notNull().default(true),
  // Cumpleaños: felicitación a la hora elegida (zona del servidor) y rol por 24 h
  birthdaysEnabled: boolean("birthdays_enabled").notNull().default(false),
  birthdayChannelId: varchar("birthday_channel_id"),
  birthdayRoleId: varchar("birthday_role_id"),
  birthdayHour: integer("birthday_hour").notNull().default(9),
  birthdayMessage: text("birthday_message"), // null = mensaje predeterminado
  // Starboard: los mensajes con suficientes reacciones se copian a un canal
  starboardEnabled: boolean("starboard_enabled").notNull().default(false),
  starboardChannelId: varchar("starboard_channel_id"),
  starboardEmoji: text("starboard_emoji").notNull().default("⭐"),
  starboardThreshold: integer("starboard_threshold").notNull().default(3),
  // Confesiones anónimas (/confesar)
  confessionsEnabled: boolean("confessions_enabled").notNull().default(false),
  confessionsChannelId: varchar("confessions_channel_id"),
  confessionsCount: integer("confessions_count").notNull().default(0),
  // Registro (logs) en un canal
  logsEnabled: boolean("logs_enabled").notNull().default(false),
  logsChannelId: varchar("logs_channel_id"),
  logEvents: jsonb("log_events").$type<LogEvent[]>(), // null = todos
  // Filtro de palabras y enlaces
  filterEnabled: boolean("filter_enabled").notNull().default(false),
  filterWords: jsonb("filter_words").$type<string[]>().notNull().default([]),
  filterInvites: boolean("filter_invites").notNull().default(true),
  filterLinks: boolean("filter_links").notNull().default(false),
  filterExemptRoleIds: jsonb("filter_exempt_role_ids").$type<string[]>().notNull().default([]),
  filterWarn: boolean("filter_warn").notNull().default(false), // además de borrar, dar un warn
  // Castigos automáticos por warns
  autoPunishEnabled: boolean("auto_punish_enabled").notNull().default(false),
  autoPunishRules: jsonb("auto_punish_rules").$type<AutoPunishRule[]>(), // null = las predeterminadas
  // XP por estar en canales de voz
  voiceXpEnabled: boolean("voice_xp_enabled").notNull().default(false),
  // Contenido +18: solo con el interruptor encendido Y en canales de esta lista que además estén marcados
  // en Discord como "con restricción de edad". Nunca en canales normales.
  nsfwEnabled: boolean("nsfw_enabled").notNull().default(false),
  nsfwChannelIds: jsonb("nsfw_channel_ids").$type<string[]>().notNull().default([]),
  // Ajustes finos (XP, economía, juegos…): ver shared/tuning.ts. Lo que falta usa el valor predeterminado
  tuning: jsonb("tuning").$type<Record<string, unknown>>().notNull().default({}),
  updatedAt: timestamp("updated_at").default(sql`now()`),
});

export const birthdays = pgTable("birthdays", {
  guildId: varchar("guild_id").notNull(),
  userId: varchar("user_id").notNull(),
  // null = lo borró con /cumple borrar, pero la fila se queda un tiempo para no festejarlo dos veces seguidas
  month: integer("month"), // 1-12
  day: integer("day"), // 1-31
  lastCelebrated: varchar("last_celebrated", { length: 10 }), // YYYY-MM-DD en la zona del servidor
  roleGivenAt: timestamp("role_given_at"),
  roleGivenId: varchar("role_given_id"), // el rol que se le dio (por si en el panel cambian el rol mientras lo trae)
}, (table) => [
  primaryKey({ columns: [table.guildId, table.userId] }),
]);

export const reminders = pgTable("reminders", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  guildId: varchar("guild_id").notNull(),
  channelId: varchar("channel_id").notNull(),
  userId: varchar("user_id").notNull(),
  text: text("text").notNull(),
  dueAt: timestamp("due_at").notNull(),
  createdAt: timestamp("created_at").default(sql`now()`),
});

export const starboardPosts = pgTable("starboard_posts", {
  guildId: varchar("guild_id").notNull(),
  messageId: varchar("message_id").notNull(), // mensaje original
  starMessageId: varchar("star_message_id"), // copia en el canal de starboard
  count: integer("count").notNull().default(0),
}, (table) => [
  primaryKey({ columns: [table.guildId, table.messageId] }),
]);

// Quién escribió cada confesión: solo lo ven los admins con /confesion autor (para casos de abuso)
export const confessions = pgTable("confessions", {
  guildId: varchar("guild_id").notNull(),
  number: integer("number").notNull(),
  userId: varchar("user_id").notNull(),
  messageId: varchar("message_id"),
  createdAt: timestamp("created_at").default(sql`now()`),
}, (table) => [
  primaryKey({ columns: [table.guildId, table.number] }),
]);

export const interactionCounts = pgTable("interaction_counts", {
  guildId: varchar("guild_id").notNull(),
  userId: varchar("user_id").notNull(),
  targetId: varchar("target_id").notNull(),
  action: varchar("action", { length: 20 }).notNull(),
  count: integer("count").notNull().default(0),
}, (table) => [
  primaryKey({ columns: [table.guildId, table.userId, table.targetId, table.action] }),
]);

// Registro de lo publicado con /nsfw (el panel muestra lo último por si hay que borrar algo)
export const nsfwLog = pgTable("nsfw_log", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  guildId: varchar("guild_id").notNull(),
  channelId: varchar("channel_id").notNull(),
  userId: varchar("user_id").notNull(),
  category: varchar("category", { length: 30 }).notNull(),
  url: text("url").notNull(),
  messageId: varchar("message_id"),
  createdAt: timestamp("created_at").default(sql`now()`),
});

export type GuildExtras = typeof guildExtras.$inferSelect;
export type Birthday = typeof birthdays.$inferSelect;
export type Reminder = typeof reminders.$inferSelect;

// Relations
export const usersRelations = relations(users, ({ many }) => ({
  levels: many(userLevels),
  economy: many(userEconomy),
  moderationActions: many(moderationActions),
  customCommands: many(customCommands),
}));

export const guildsRelations = relations(guilds, ({ many }) => ({
  levels: many(userLevels),
  economy: many(userEconomy),
  moderationActions: many(moderationActions),
  raidEvents: many(raidEvents),
  contentFeeds: many(contentFeeds),
  customCommands: many(customCommands),
}));

export const contentFeedsRelations = relations(contentFeeds, ({ many }) => ({
  postedContent: many(postedContent),
}));

// Insert schemas
export const insertUserSchema = createInsertSchema(users).omit({ createdAt: true });
export const insertGuildSchema = createInsertSchema(guilds).omit({ createdAt: true });
export const insertUserLevelSchema = createInsertSchema(userLevels).omit({ id: true });
export const insertUserEconomySchema = createInsertSchema(userEconomy).omit({ id: true });
export const insertModerationActionSchema = createInsertSchema(moderationActions).omit({ id: true, createdAt: true });
export const insertContentFeedSchema = createInsertSchema(contentFeeds).omit({ id: true, lastPosted: true });
export const insertRaidEventSchema = createInsertSchema(raidEvents).omit({ id: true, createdAt: true });
export const insertCustomCommandSchema = createInsertSchema(customCommands).omit({ id: true, createdAt: true, uses: true });

// Types
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type InsertGuild = z.infer<typeof insertGuildSchema>;
export type Guild = typeof guilds.$inferSelect;
export type InsertUserLevel = z.infer<typeof insertUserLevelSchema>;
export type UserLevel = typeof userLevels.$inferSelect;
export type InsertUserEconomy = z.infer<typeof insertUserEconomySchema>;
export type UserEconomy = typeof userEconomy.$inferSelect;
export type InsertModerationAction = z.infer<typeof insertModerationActionSchema>;
export type ModerationAction = typeof moderationActions.$inferSelect;
export type InsertContentFeed = z.infer<typeof insertContentFeedSchema>;
export type ContentFeed = typeof contentFeeds.$inferSelect;
export type InsertRaidEvent = z.infer<typeof insertRaidEventSchema>;
export type InsertCustomCommand = z.infer<typeof insertCustomCommandSchema>;
export type CustomCommand = typeof customCommands.$inferSelect;
export type RaidEvent = typeof raidEvents.$inferSelect;
export type PostedContent = typeof postedContent.$inferSelect;
