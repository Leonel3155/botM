import type { Express, Request, Response } from "express";
import type { Guild as DiscordGuild } from "discord.js";
import { z } from "zod";
import type { Guild as GuildRow, GuildEngagementSettings } from "@shared/schema";
import {
  WELCOME_MESSAGE_MAX_LENGTH,
  type DiscordRolesResponse,
  type EngagementSettingsResponse,
  type EngagementUpdateResponse,
  type PostQuestionNowResponse,
  type TestWelcomeResponse,
} from "@shared/api";
import { storage } from "../storage";
import { PREGUNTAS_DEL_DIA } from "../bot/data/preguntasDelDia";
import { buildWelcomeMessage, checkWelcomeRole, DEFAULT_WELCOME_MESSAGE } from "../bot/services/welcome";
import { DEFAULT_DAILY_QUESTION_HOUR, dailyQuestions, remainingDailyQuestions } from "../bot/services/dailyQuestion";
import { canCreateThreads, checkMemberCanPost, resolveSendableChannel } from "../bot/services/channels";
import { normalizeTimezone, resolveTimezone } from "../bot/services/timezone";
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
  getCachedBotGuild,
  isDevRequest,
  nextDailyQuestionAt,
  plainDiscordText,
  releaseActionSlot,
  takeActionSlot,
  toIso,
} from "./helpers";

type Broadcast = (guildId: string, message: Record<string, unknown>) => void;

const guildAdmin = [requireAuth, requireGuildAdmin];
const guildAdminWithBot = [requireAuth, requireGuildAdmin, requireBotInGuild];

// Un doble clic no debe publicar dos veces
const TEST_WELCOME_COOLDOWN_MS = 15_000;
const POST_QUESTION_COOLDOWN_MS = 60_000;

// ===== Validación =====
// Canal / rol opcional: un ID de Discord, o null / "" para quitarlo
const optionalSnowflake = z
  .union([snowflakeSchema, z.literal(""), z.null()])
  .transform((value) => value || null);

const engagementUpdateSchema = z.object({
  welcome: z.object({
    enabled: z.boolean(),
    channelId: optionalSnowflake,
    message: z
      .union([
        z.string().max(WELCOME_MESSAGE_MAX_LENGTH, `El mensaje de bienvenida puede tener como máximo ${WELCOME_MESSAGE_MAX_LENGTH} caracteres.`),
        z.null(),
      ])
      .transform((value) => value?.trim() || null),
    roleId: optionalSnowflake,
  }).partial().strict().optional(),
  dailyQuestion: z.object({
    enabled: z.boolean(),
    channelId: optionalSnowflake,
    hour: z.number().int("La hora debe ser un número entero.").min(0, "La hora va de 0 a 23.").max(23, "La hora va de 0 a 23."),
    timezone: z.string().trim().min(1, "Escribe una zona horaria.").max(64, "La zona horaria es demasiado larga."),
    thread: z.boolean(),
  }).partial().strict().optional(),
}).strict();

const emptyBodySchema = z.object({}).strict();

// ===== Respuesta =====
function channelProblem(guild: DiscordGuild | null, channelId: string | null | undefined): string | null {
  if (!guild || !channelId) return null;
  const check = resolveSendableChannel(guild, channelId);
  return check.ok ? null : plainDiscordText(guild, check.reason);
}

function buildEngagementResponse(row: GuildRow | undefined, guild: DiscordGuild | null): EngagementSettingsResponse {
  const welcomeRoleId = row?.welcomeRoleId ?? null;
  const roleCheck = guild && welcomeRoleId ? checkWelcomeRole(guild, welcomeRoleId) : null;

  const questionChannelId = row?.dailyQuestionChannelId ?? null;
  const thread = row?.dailyQuestionThread ?? true;
  let threadProblem: string | null = null;
  if (guild && questionChannelId && thread) {
    const target = resolveSendableChannel(guild, questionChannelId);
    if (target.ok && !canCreateThreads(target.channel)) {
      threadProblem = "Me falta el permiso Crear hilos públicos en ese canal (o no admite hilos): publicaré la pregunta sin hilo.";
    }
  }

  return {
    welcome: {
      enabled: row?.welcomeEnabled ?? false,
      channelId: row?.welcomeChannelId ?? null,
      message: row?.welcomeMessage ?? null,
      roleId: welcomeRoleId,
      defaultMessage: DEFAULT_WELCOME_MESSAGE,
      channelProblem: channelProblem(guild, row?.welcomeChannelId),
      roleProblem: roleCheck && !roleCheck.ok ? plainDiscordText(guild, roleCheck.reason) : null,
    },
    dailyQuestion: {
      enabled: row?.dailyQuestionEnabled ?? false,
      channelId: questionChannelId,
      hour: row?.dailyQuestionHour ?? DEFAULT_DAILY_QUESTION_HOUR,
      timezone: resolveTimezone(row?.timezone),
      thread,
      lastPosted: row?.dailyQuestionLastPosted ?? null,
      postedCount: row?.dailyQuestionIndex ?? 0,
      remainingInCycle: remainingDailyQuestions(row?.dailyQuestionUsed),
      totalQuestions: PREGUNTAS_DEL_DIA.length,
      nextPostAt: toIso(nextDailyQuestionAt(row)),
      channelProblem: channelProblem(guild, questionChannelId),
      threadProblem,
    },
    botInGuild: !!guild,
  };
}

/** 400 con un mensaje claro (y corta el handler devolviendo null). */
function badRequest(res: Response, error: string): null {
  res.status(400).json({ error });
  return null;
}

export function setupEngagementRoutes(app: Express, { broadcast }: { broadcast: Broadcast }) {
  // =============================================
  // Ajustes de bienvenida y pregunta del día
  // =============================================
  app.get("/api/guilds/:guildId/engagement", ...guildAdmin, async (req: Request, res: Response) => {
    try {
      const { guildId } = req.params;
      const row = await storage.getGuild(guildId);
      res.json(buildEngagementResponse(row, getCachedBotGuild(guildId)));
    } catch (error) {
      console.error("[ENGAGEMENT-ERROR]", error);
      res.status(500).json({ error: "No se pudieron obtener los ajustes de bienvenida y pregunta del día." });
    }
  });

  app.patch("/api/guilds/:guildId/engagement", ...guildAdminWithBot, async (req: Request, res: Response) => {
    try {
      const { guildId } = req.params;
      const body = parseBody(engagementUpdateSchema, req, res);
      if (!body) return;

      const guild = getBotGuild(res);
      await ensureGuildRow(guild);
      const current = await storage.getGuild(guildId);
      if (!current) {
        return res.status(500).json({ error: "No se pudo preparar el servidor en la base de datos." });
      }

      const updates: Partial<GuildEngagementSettings> = {};
      const warnings: string[] = [];

      // ----- Bienvenida -----
      if (body.welcome) {
        const welcome = body.welcome;

        if (welcome.channelId !== undefined && welcome.channelId !== current.welcomeChannelId) {
          if (welcome.channelId && !findPostableChannel(guild, welcome.channelId)) {
            return badRequest(res, "El canal de bienvenida no existe en este servidor o no es un canal de texto o de anuncios.");
          }
          const userProblem = welcome.channelId ? await checkPanelUserCanUseChannel(req, guild, welcome.channelId) : null;
          if (userProblem) {
            return res.status(403).json({ error: `Canal de bienvenida: ${userProblem}` });
          }
          updates.welcomeChannelId = welcome.channelId;
        }

        if (welcome.message !== undefined) updates.welcomeMessage = welcome.message;

        if (welcome.roleId !== undefined && welcome.roleId !== current.welcomeRoleId) {
          if (welcome.roleId) {
            const check = checkWelcomeRole(guild, welcome.roleId);
            if (!check.ok) {
              return badRequest(res, `No puedo usar ese rol: ${plainDiscordText(guild, check.reason)}`);
            }
            const member = await fetchSessionMember(req, guild);
            const userProblem = checkMemberCanAssignRole(guild, member, check.role, isDevRequest(req));
            if (userProblem) {
              return res.status(403).json({ error: userProblem });
            }
          }
          updates.welcomeRoleId = welcome.roleId;
        }

        if (welcome.enabled !== undefined) updates.welcomeEnabled = welcome.enabled;

        const enabled = welcome.enabled ?? current.welcomeEnabled ?? false;
        const channelId = updates.welcomeChannelId !== undefined ? updates.welcomeChannelId : current.welcomeChannelId;
        if (enabled) {
          if (!channelId) {
            return badRequest(res, "Elige un canal de bienvenida antes de activarla.");
          }
          const target = resolveSendableChannel(guild, channelId);
          const turningOn = welcome.enabled === true && !current.welcomeEnabled;
          if (!target.ok) {
            const reason = plainDiscordText(guild, target.reason);
            // Al encenderla o cambiar de canal exigimos que el bot pueda publicar; si no, solo avisamos
            if (turningOn || updates.welcomeChannelId !== undefined) {
              return badRequest(res, `No puedo dar la bienvenida en ese canal. ${reason}`);
            }
            warnings.push(`Bienvenida: ${reason}`);
          }
        }
      }

      // ----- Pregunta del día -----
      if (body.dailyQuestion) {
        const question = body.dailyQuestion;

        if (question.channelId !== undefined && question.channelId !== current.dailyQuestionChannelId) {
          if (question.channelId && !findPostableChannel(guild, question.channelId)) {
            return badRequest(res, "El canal de la pregunta del día no existe en este servidor o no es un canal de texto o de anuncios.");
          }
          const userProblem = question.channelId ? await checkPanelUserCanUseChannel(req, guild, question.channelId) : null;
          if (userProblem) {
            return res.status(403).json({ error: `Canal de la pregunta del día: ${userProblem}` });
          }
          updates.dailyQuestionChannelId = question.channelId;
        }

        if (question.hour !== undefined) updates.dailyQuestionHour = question.hour;
        if (question.thread !== undefined) updates.dailyQuestionThread = question.thread;

        if (question.timezone !== undefined) {
          const timezone = normalizeTimezone(question.timezone);
          if (!timezone) {
            return badRequest(
              res,
              `No reconozco la zona horaria "${question.timezone}". Usa un nombre como America/Mexico_City, America/Bogota o Europe/Madrid (también acepto atajos como CDMX, Colombia o España).`
            );
          }
          updates.timezone = timezone;
        }

        if (question.enabled !== undefined) updates.dailyQuestionEnabled = question.enabled;

        const enabled = question.enabled ?? current.dailyQuestionEnabled ?? false;
        const channelId = updates.dailyQuestionChannelId !== undefined
          ? updates.dailyQuestionChannelId
          : current.dailyQuestionChannelId;
        if (enabled) {
          if (!channelId) {
            return badRequest(res, "Elige un canal para la pregunta del día antes de activarla.");
          }
          const target = resolveSendableChannel(guild, channelId);
          const turningOn = question.enabled === true && !current.dailyQuestionEnabled;
          if (!target.ok) {
            const reason = plainDiscordText(guild, target.reason);
            if (turningOn || updates.dailyQuestionChannelId !== undefined) {
              return badRequest(res, `No puedo publicar la pregunta del día en ese canal. ${reason}`);
            }
            warnings.push(`Pregunta del día: ${reason}`);
          }
        }
      }

      if (Object.keys(updates).length === 0) {
        return badRequest(res, "No se envió ningún cambio.");
      }

      const updated = await storage.updateEngagementSettings(guildId, updates);
      // La pregunta del día guarda su configuración en memoria: la actualizamos para que aplique ya.
      // (La bienvenida lee la base de datos en cada entrada, no tiene caché.)
      dailyQuestions.syncGuild(updated);

      const response = buildEngagementResponse(updated ?? current, guild);
      if (response.dailyQuestion.threadProblem && body.dailyQuestion?.thread === true) {
        warnings.push(`Pregunta del día: ${response.dailyQuestion.threadProblem}`);
      }

      broadcast(guildId, { type: "settingsUpdated" });
      const result: EngagementUpdateResponse = { ...response, warnings };
      res.json(result);
    } catch (error) {
      console.error("[ENGAGEMENT-UPDATE-ERROR]", error);
      res.status(500).json({ error: "No se pudieron guardar los ajustes de bienvenida y pregunta del día." });
    }
  });

  // =============================================
  // Probar la bienvenida: la publica en el canal configurado usando a quien la prueba
  // =============================================
  app.post("/api/guilds/:guildId/engagement/test-welcome", ...guildAdminWithBot, async (req: Request, res: Response) => {
    const { guildId } = req.params;
    const slot = `test-welcome:${guildId}`;
    try {
      if (!parseBody(emptyBodySchema, req, res)) return;

      const guild = getBotGuild(res);
      const settings = await storage.getGuild(guildId);
      if (!settings?.welcomeChannelId) {
        return badRequest(res, "Primero elige el canal de bienvenida.");
      }

      const target = resolveSendableChannel(guild, settings.welcomeChannelId);
      if (!target.ok) {
        return badRequest(res, `No puedo publicar la prueba. ${plainDiscordText(guild, target.reason)}`);
      }

      const member = await fetchSessionMember(req, guild);
      if (!member) {
        return badRequest(res, "Para probar la bienvenida tienes que ser miembro del servidor (la prueba se hace contigo).");
      }
      // La prueba publica el texto de bienvenida del panel: solo en un canal donde tú también puedes escribir
      const memberCheck = checkMemberCanPost(member, target.channel);
      if (!memberCheck.ok) {
        return res.status(403).json({
          error: `Solo puedes probar la bienvenida en un canal donde tú puedes escribir. ${plainDiscordText(guild, memberCheck.reason)}`,
        });
      }

      if (!takeActionSlot(res, slot, TEST_WELCOME_COOLDOWN_MS, "Acabas de publicar una prueba.")) return;

      try {
        const message = await target.channel.send(buildWelcomeMessage(member, settings.welcomeMessage));
        const body: TestWelcomeResponse = { success: true, channelId: target.channel.id, messageUrl: message.url };
        res.json(body);
      } catch (error) {
        releaseActionSlot(slot);
        throw error;
      }
    } catch (error) {
      console.error("[TEST-WELCOME-ERROR]", error);
      res.status(500).json({ error: "No se pudo publicar la bienvenida de prueba." });
    }
  });

  // =============================================
  // Publicar la pregunta del día ahora (cuenta como la de hoy, igual que /pregunta-del-dia ahora)
  // =============================================
  app.post("/api/guilds/:guildId/engagement/post-question-now", ...guildAdminWithBot, async (req: Request, res: Response) => {
    const { guildId } = req.params;
    const slot = `post-question:${guildId}`;
    try {
      if (!parseBody(emptyBodySchema, req, res)) return;

      const guild = getBotGuild(res);
      await ensureGuildRow(guild);
      const settings = await storage.getGuild(guildId);
      if (!settings) {
        return res.status(500).json({ error: "No se pudo preparar el servidor en la base de datos." });
      }
      if (!settings.dailyQuestionChannelId) {
        return badRequest(res, "Primero elige el canal de la pregunta del día.");
      }

      const target = resolveSendableChannel(guild, settings.dailyQuestionChannelId);
      if (!target.ok) {
        return badRequest(res, `No puedo publicar la pregunta. ${plainDiscordText(guild, target.reason)}`);
      }

      if (!takeActionSlot(res, slot, POST_QUESTION_COOLDOWN_MS, "Acabas de publicar una pregunta.")) return;

      try {
        const { message, number } = await dailyQuestions.postNow(guild, settings, target.channel);
        broadcast(guildId, { type: "settingsUpdated" });
        const body: PostQuestionNowResponse = {
          success: true,
          channelId: target.channel.id,
          messageUrl: message.url,
          questionNumber: number,
        };
        res.json(body);
      } catch (error) {
        releaseActionSlot(slot);
        throw error;
      }
    } catch (error) {
      console.error("[POST-QUESTION-ERROR]", error);
      res.status(500).json({ error: "No se pudo publicar la pregunta del día." });
    }
  });

  // =============================================
  // Roles del servidor (para elegir el rol automático de bienvenida)
  // =============================================
  app.get("/api/guilds/:guildId/discord-roles", ...guildAdminWithBot, async (req: Request, res: Response) => {
    try {
      const guild = getBotGuild(res);
      const member = await fetchSessionMember(req, guild);
      const devSession = isDevRequest(req);

      const roles: DiscordRolesResponse = guild.roles.cache
        .filter((role) => role.id !== guild.id) // @everyone
        .sort((a, b) => b.position - a.position)
        .map((role) => {
          const botCheck = checkWelcomeRole(guild, role.id);
          const reason = botCheck.ok
            ? checkMemberCanAssignRole(guild, member, role, devSession)
            : plainDiscordText(guild, botCheck.reason);
          return {
            id: role.id,
            name: role.name,
            color: role.color ? `#${role.color.toString(16).padStart(6, "0")}` : null,
            position: role.position,
            managed: role.managed,
            assignable: reason === null,
            reason,
          };
        });

      res.json(roles);
    } catch (error) {
      console.error("[DISCORD-ROLES-ERROR]", error);
      res.status(500).json({ error: "No se pudieron obtener los roles del servidor." });
    }
  });
}
