import type { Express, Request, Response } from "express";
import { PermissionFlagsBits, type Guild as DiscordGuild } from "discord.js";
import { z } from "zod";
import { and, count, eq, isNotNull } from "drizzle-orm";
import { birthdays, reminders, starboardPosts, type GuildExtras } from "@shared/schema";
import {
  EXTRAS_LIMITS,
  type GuildExtrasItem,
  type GuildExtrasResponse,
} from "@shared/api";
import { db } from "../db";
import {
  ALL_LOG_EVENTS,
  autoPunishRulesOf,
  getExtras,
  logEventsOf,
  updateExtras,
  type ExtrasPatch,
} from "../bot/services/extras";
import { DEFAULT_BIRTHDAY_MESSAGE } from "../bot/services/birthdays";
import { recentNsfwPosts } from "../bot/services/nsfw";
import { checkGrantableRole, isValidButtonEmoji } from "../bot/services/roles";
import {
  requireAuth,
  requireGuildAdmin,
  requireBotInGuild,
  getBotGuild,
  ensureGuildRow,
  parseBody,
  snowflakeSchema,
} from "./middleware";
import {
  checkMemberCanAssignRole,
  checkPanelUserCanUseChannel,
  fetchSessionMember,
  findPostableChannel,
  isDevRequest,
  plainDiscordText,
  toIso,
} from "./helpers";

type Broadcast = (guildId: string, message: Record<string, unknown>) => void;

const guildAdmin = [requireAuth, requireGuildAdmin];
const guildAdminWithBot = [requireAuth, requireGuildAdmin, requireBotInGuild];

const nullableChannel = z.union([snowflakeSchema, z.null()]);

const ruleSchema = z.object({
  warns: z.number().int().min(1, "Cada castigo necesita al menos 1 advertencia.").max(EXTRAS_LIMITS.autoPunishMaxWarns),
  action: z.enum(["timeout", "kick", "ban"]),
  minutes: z.number().int().min(1).max(EXTRAS_LIMITS.timeoutMaxMinutes).optional(),
}).strict();

const extrasSchema = z.object({
  interactionsEnabled: z.boolean(),
  birthdaysEnabled: z.boolean(),
  birthdayChannelId: nullableChannel,
  birthdayRoleId: nullableChannel,
  birthdayHour: z.number().int().min(0).max(23),
  birthdayMessage: z.union([z.string().max(EXTRAS_LIMITS.birthdayMessageMaxLength, `El mensaje de cumpleaños puede tener como máximo ${EXTRAS_LIMITS.birthdayMessageMaxLength} caracteres.`), z.null()])
    .transform((value) => value?.trim() || null),
  starboardEnabled: z.boolean(),
  starboardChannelId: nullableChannel,
  starboardEmoji: z.string().trim().min(1).max(EXTRAS_LIMITS.starboardEmojiMaxLength)
    .refine(isValidButtonEmoji, "El emoji del starboard no es válido: pon uno solo (por ejemplo ⭐) o uno del servidor como <:nombre:id>."),
  starboardThreshold: z.number().int().min(EXTRAS_LIMITS.starboardThresholdMin).max(EXTRAS_LIMITS.starboardThresholdMax),
  confessionsEnabled: z.boolean(),
  confessionsChannelId: nullableChannel,
  logsEnabled: z.boolean(),
  logsChannelId: nullableChannel,
  logEvents: z.array(z.enum(ALL_LOG_EVENTS as [string, ...string[]])).max(ALL_LOG_EVENTS.length)
    .transform((events) => [...new Set(events)]),
  filterEnabled: z.boolean(),
  filterWords: z.array(z.string().trim().max(EXTRAS_LIMITS.filterWordMaxLength, `Cada palabra del filtro puede tener como máximo ${EXTRAS_LIMITS.filterWordMaxLength} caracteres.`))
    .max(EXTRAS_LIMITS.filterMaxWords, `El filtro puede tener como máximo ${EXTRAS_LIMITS.filterMaxWords} palabras.`)
    .transform((words) => [...new Map(words.filter((word) => word.replace('*', '').trim().length >= 2).map((word) => [word.toLowerCase(), word])).values()]),
  filterInvites: z.boolean(),
  filterLinks: z.boolean(),
  filterExemptRoleIds: z.array(snowflakeSchema).max(EXTRAS_LIMITS.filterMaxExemptRoles).transform((ids) => [...new Set(ids)]),
  filterWarn: z.boolean(),
  autoPunishEnabled: z.boolean(),
  autoPunishRules: z.array(ruleSchema).max(EXTRAS_LIMITS.autoPunishMaxRules, `Puedes poner como máximo ${EXTRAS_LIMITS.autoPunishMaxRules} castigos.`)
    .refine((rules) => new Set(rules.map((rule) => rule.warns)).size === rules.length, "Hay dos castigos con la misma cantidad de advertencias.")
    .transform((rules) => [...rules].sort((a, b) => a.warns - b.warns)
      .map((rule) => rule.action === "timeout" ? { ...rule, minutes: rule.minutes ?? 60 } : { warns: rule.warns, action: rule.action })),
  voiceXpEnabled: z.boolean(),
  nsfwEnabled: z.boolean(),
  nsfwChannelIds: z.array(snowflakeSchema).max(EXTRAS_LIMITS.nsfwMaxChannels, `Puedes autorizar como máximo ${EXTRAS_LIMITS.nsfwMaxChannels} canales +18.`)
    .transform((ids) => [...new Set(ids)]),
}).strict().partial();

function toItem(extras: GuildExtras): GuildExtrasItem {
  return {
    interactionsEnabled: extras.interactionsEnabled,
    birthdaysEnabled: extras.birthdaysEnabled,
    birthdayChannelId: extras.birthdayChannelId,
    birthdayRoleId: extras.birthdayRoleId,
    birthdayHour: extras.birthdayHour,
    birthdayMessage: extras.birthdayMessage,
    starboardEnabled: extras.starboardEnabled,
    starboardChannelId: extras.starboardChannelId,
    starboardEmoji: extras.starboardEmoji,
    starboardThreshold: extras.starboardThreshold,
    confessionsEnabled: extras.confessionsEnabled,
    confessionsChannelId: extras.confessionsChannelId,
    logsEnabled: extras.logsEnabled,
    logsChannelId: extras.logsChannelId,
    logEvents: logEventsOf(extras),
    filterEnabled: extras.filterEnabled,
    filterWords: extras.filterWords,
    filterInvites: extras.filterInvites,
    filterLinks: extras.filterLinks,
    filterExemptRoleIds: extras.filterExemptRoleIds,
    filterWarn: extras.filterWarn,
    autoPunishEnabled: extras.autoPunishEnabled,
    autoPunishRules: autoPunishRulesOf(extras),
    voiceXpEnabled: extras.voiceXpEnabled,
    nsfwEnabled: extras.nsfwEnabled,
    nsfwChannelIds: extras.nsfwChannelIds,
  };
}

async function buildResponse(guildId: string): Promise<GuildExtrasResponse> {
  const extras = await getExtras(guildId);
  const [[b], [s], [r]] = await Promise.all([
    db.select({ total: count() }).from(birthdays).where(and(eq(birthdays.guildId, guildId), isNotNull(birthdays.month))),
    db.select({ total: count() }).from(starboardPosts).where(eq(starboardPosts.guildId, guildId)),
    db.select({ total: count() }).from(reminders).where(eq(reminders.guildId, guildId)),
  ]);
  return {
    extras: toItem(extras),
    stats: { birthdays: b?.total ?? 0, confessions: extras.confessionsCount, starboardPosts: s?.total ?? 0, pendingReminders: r?.total ?? 0 },
    defaultBirthdayMessage: DEFAULT_BIRTHDAY_MESSAGE,
    nsfwLog: (await recentNsfwPosts(guildId)).map((row) => ({
      channelId: row.channelId,
      userId: row.userId,
      category: row.category,
      url: row.url,
      createdAt: toIso(row.createdAt),
    })),
  };
}

// Castigos automáticos: quien los pone necesita el mismo permiso que pide Discord para hacerlo a mano
// (si no, Gestionar servidor bastaría para que el bot banee por él)
const PUNISH_PERMS = {
  timeout: [PermissionFlagsBits.ModerateMembers, "Aislar temporalmente a miembros", "aislamiento"],
  kick: [PermissionFlagsBits.KickMembers, "Expulsar miembros", "expulsión"],
  ban: [PermissionFlagsBits.BanMembers, "Banear miembros", "baneo"],
} as const;

// Con "Advertir" encendido, cambiar el filtro decide a quién le caen advertencias (y castigos)
const FILTER_FIELDS = ["filterEnabled", "filterWords", "filterInvites", "filterLinks", "filterExemptRoleIds", "filterWarn"] as const;

const CHANNEL_LABELS: Record<string, string> = {
  birthdayChannelId: "El canal de cumpleaños",
  starboardChannelId: "El canal del starboard",
  confessionsChannelId: "El canal de confesiones",
  logsChannelId: "El canal de registro",
};

/** Canales, roles y castigos elegidos: que existan y que quien usa el panel pueda usarlos. */
async function checkInput(req: Request, guild: DiscordGuild, input: ExtrasPatch, merged: GuildExtras): Promise<string | null> {
  for (const [field, label] of Object.entries(CHANNEL_LABELS)) {
    const channelId = input[field as keyof ExtrasPatch] as string | null | undefined;
    if (!channelId) continue;
    if (!findPostableChannel(guild, channelId)) return `${label} no existe o no es un canal de texto de este servidor.`;
    const problem = await checkPanelUserCanUseChannel(req, guild, channelId);
    if (problem) return problem;
  }
  // Para encender algo hace falta su canal
  if (merged.birthdaysEnabled && !merged.birthdayChannelId) return "Elige el canal donde felicito los cumpleaños.";
  if (merged.starboardEnabled && !merged.starboardChannelId) return "Elige el canal del starboard.";
  if (merged.confessionsEnabled && !merged.confessionsChannelId) return "Elige el canal de las confesiones.";
  if (merged.logsEnabled && !merged.logsChannelId) return "Elige el canal del registro.";

  if (input.birthdayRoleId) {
    const check = checkGrantableRole(guild, input.birthdayRoleId);
    if (!check.ok) return `Rol de cumpleañero: ${plainDiscordText(guild, check.reason)}`;
    const devSession = isDevRequest(req);
    const member = devSession ? null : await fetchSessionMember(req, guild);
    const memberProblem = checkMemberCanAssignRole(guild, member, check.role, devSession);
    if (memberProblem) return `Rol de cumpleañero: ${memberProblem.replace("Para elegir el rol automático también", "Para elegir ese rol")}`;
  }
  // Doble candado: solo canales marcados en Discord como +18
  for (const channelId of input.nsfwChannelIds ?? []) {
    const channel = findPostableChannel(guild, channelId);
    if (!channel) return "Uno de los canales +18 ya no existe o no es un canal de texto.";
    if (!("nsfw" in channel) || channel.nsfw !== true) {
      return `#${channel.name} no está marcado como "con restricción de edad" en Discord. Márcalo primero (Editar canal → Canal con restricción de edad).`;
    }
    const problem = await checkPanelUserCanUseChannel(req, guild, channelId);
    if (problem) return problem;
  }
  if (merged.nsfwEnabled && merged.nsfwChannelIds.length === 0) return "Elige al menos un canal +18 donde se permita.";
  for (const roleId of input.filterExemptRoleIds ?? []) {
    if (!guild.roles.cache.has(roleId)) return "Uno de los roles que no pasan por el filtro ya no existe.";
  }
  // Castigos automáticos: el dueño y Administrador tienen todos los permisos; apagarlos siempre se puede
  const touchesRules = input.autoPunishEnabled !== undefined || input.autoPunishRules !== undefined;
  const touchesFilter = merged.filterEnabled && merged.filterWarn && FILTER_FIELDS.some((field) => input[field] !== undefined);
  if (merged.autoPunishEnabled && (touchesRules || touchesFilter) && !isDevRequest(req)) {
    const member = await fetchSessionMember(req, guild);
    if (!member) return "No te encontré como miembro de este servidor.";
    for (const rule of autoPunishRulesOf(merged)) {
      const [flag, label, noun] = PUNISH_PERMS[rule.action];
      if (member.permissions.has(flag)) continue;
      return touchesRules
        ? `Para poner castigos de ${noun} necesitas el permiso ${label}.`
        : `El filtro da advertencias y los castigos automáticos incluyen ${noun}: para cambiar el filtro necesitas el permiso ${label}.`;
    }
  }
  return null;
}

export function setupExtrasRoutes(app: Express, { broadcast }: { broadcast: Broadcast }) {
  app.get("/api/guilds/:guildId/extras", ...guildAdmin, async (req: Request, res: Response) => {
    try {
      res.json(await buildResponse(req.params.guildId));
    } catch (error) {
      console.error("[EXTRAS-ERROR]", error);
      res.status(500).json({ error: "No se pudieron leer los ajustes." });
    }
  });

  app.patch("/api/guilds/:guildId/extras", ...guildAdminWithBot, async (req: Request, res: Response) => {
    const guild = getBotGuild(res);
    try {
      const input = parseBody(extrasSchema, req, res) as ExtrasPatch | null;
      if (!input) return;
      const current = await getExtras(guild.id);
      const merged = { ...current, ...input } as GuildExtras;
      const problem = await checkInput(req, guild, input, merged);
      if (problem) return res.status(400).json({ error: problem });

      await ensureGuildRow(guild);
      await updateExtras(guild.id, input);
      broadcast(guild.id, { type: "extrasUpdated" });
      res.json(await buildResponse(guild.id));
    } catch (error) {
      console.error("[EXTRAS-ERROR]", error);
      res.status(500).json({ error: "No se pudieron guardar los ajustes." });
    }
  });
}

