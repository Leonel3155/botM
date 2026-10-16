import type { Express, Request, Response } from "express";
import type { Guild as DiscordGuild } from "discord.js";
import { z } from "zod";
import {
  DEFAULT_TUNING,
  TUNING_LIMITS,
  TUNING_NUMBER_LABELS,
  TUNING_NUMBER_LIMITS,
  resolveTuning,
  tuningDiff,
  type GuildTuning,
  type TuningNumberKey,
} from "@shared/tuning";
import type { GuildTuningResponse } from "@shared/api";
import { getExtras, tuningOf, updateExtras } from "../bot/services/extras";
import { lockForGuild } from "../bot/services/locks";
import { checkGrantableRole } from "../bot/services/roles";
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
} from "./helpers";

type Broadcast = (guildId: string, message: Record<string, unknown>) => void;

const guildAdmin = [requireAuth, requireGuildAdmin];
const guildAdminWithBot = [requireAuth, requireGuildAdmin, requireBotInGuild];

function numberField(key: TuningNumberKey) {
  const { min, max, step } = TUNING_NUMBER_LIMITS[key];
  const label = TUNING_NUMBER_LABELS[key];
  const message = `${label}: debe estar entre ${min.toLocaleString("es-MX")} y ${max.toLocaleString("es-MX")}.`;
  const base = z.number({ invalid_type_error: `${label}: escribe un número.` }).min(min, message).max(max, message);
  return step && step < 1 ? base : base.int(`${label}: escribe un número entero.`);
}

const numberShape = Object.fromEntries(
  (Object.keys(TUNING_NUMBER_LIMITS) as TuningNumberKey[]).map((key) => [key, numberField(key)]),
);
const booleanShape = Object.fromEntries(
  (Object.keys(DEFAULT_TUNING) as (keyof GuildTuning)[])
    .filter((key) => typeof DEFAULT_TUNING[key] === "boolean")
    .map((key) => [key, z.boolean()]),
);

const tuningSchema = z.object({
  ...numberShape,
  ...booleanShape,
  noXpChannelIds: z.array(snowflakeSchema).max(TUNING_LIMITS.listMax, `Puedes poner como máximo ${TUNING_LIMITS.listMax} canales sin XP.`)
    .transform((ids) => [...new Set(ids)]),
  noXpRoleIds: z.array(snowflakeSchema).max(TUNING_LIMITS.listMax, `Puedes poner como máximo ${TUNING_LIMITS.listMax} roles sin XP.`)
    .transform((ids) => [...new Set(ids)]),
  levelUpChannelId: z.union([snowflakeSchema, z.null()]),
  levelUpMessage: z.union([
    z.string().max(TUNING_LIMITS.levelUpMessageMax, `El aviso de subir de nivel puede tener como máximo ${TUNING_LIMITS.levelUpMessageMax} caracteres.`),
    z.null(),
  ]).transform((value) => value?.trim() || null),
  levelRoleRewards: z.array(z.object({
    level: z.number().int("El nivel de cada rol debe ser un número entero.")
      .min(2, "Los roles por nivel empiezan desde el nivel 2.")
      .max(TUNING_LIMITS.maxLevel, `El nivel más alto que puedes poner es ${TUNING_LIMITS.maxLevel}.`),
    roleId: snowflakeSchema,
  }).strict())
    .max(TUNING_LIMITS.levelRolesMax, `Puedes poner como máximo ${TUNING_LIMITS.levelRolesMax} roles por nivel.`)
    .refine((rules) => new Set(rules.map((rule) => rule.level)).size === rules.length, "Hay dos roles para el mismo nivel.")
    .refine((rules) => new Set(rules.map((rule) => rule.roleId)).size === rules.length, "El mismo rol está en dos niveles.")
    .transform((rules) => [...rules].sort((a, b) => a.level - b.level)),
}).strict().partial();

type TuningPatch = Partial<GuildTuning>;

async function checkInput(req: Request, guild: DiscordGuild, input: TuningPatch, merged: GuildTuning, saved: GuildTuning): Promise<string | null> {
  if (merged.xpMax < merged.xpMin) return "La XP máxima por mensaje no puede ser menor que la mínima.";
  if (merged.maxBet !== 0 && merged.maxBet < merged.minBet) return "La apuesta máxima no puede ser menor que la mínima (usa 0 para quitar el límite).";

  if (input.levelUpChannelId) {
    if (!findPostableChannel(guild, input.levelUpChannelId)) return "El canal de avisos de nivel no existe o no es un canal de texto de este servidor.";
    const problem = await checkPanelUserCanUseChannel(req, guild, input.levelUpChannelId);
    if (problem) return problem;
  }
  for (const channelId of input.noXpChannelIds ?? []) {
    if (!guild.channels.cache.has(channelId)) return "Uno de los canales sin XP ya no existe.";
  }
  for (const roleId of input.noXpRoleIds ?? []) {
    if (!guild.roles.cache.has(roleId)) return "Uno de los roles sin XP ya no existe.";
  }

  // Roles por nivel: se revisa todo lo que hace un rol más fácil de conseguir (uno nuevo o uno que baja de
  // nivel). Con roles acumulables, quitar uno o subirlo de nivel siempre se permite aunque ya no se pueda dar.
  const savedLevel = new Map(saved.levelRoleRewards.map((rule) => [rule.roleId, rule.level]));
  const added = (input.levelRoleRewards ?? []).filter((rule) => {
    const before = savedLevel.get(rule.roleId);
    return before === undefined || rule.level < before;
  });
  // Con "solo el más alto" el bot da y quita los roles por nivel unos por otros: cualquier cambio en la lista
  // (o en ese ajuste) cambia a quién da o quita cada uno, así que quien lo cambia debe poder manejarlos todos
  const rolesChanged = input.levelRoleRewards !== undefined && JSON.stringify(input.levelRoleRewards) !== JSON.stringify(saved.levelRoleRewards);
  const stackChanged = input.levelRoleStack !== undefined && input.levelRoleStack !== saved.levelRoleStack;
  const checkAll = (merged.levelRoleStack === false || saved.levelRoleStack === false) && (rolesChanged || stackChanged);
  if (added.length === 0 && !checkAll) return null;

  const devSession = isDevRequest(req);
  const member = devSession ? null : await fetchSessionMember(req, guild);
  const memberText = (problem: string) => problem.replace("Para elegir el rol automático también", "Para elegir ese rol");
  for (const rule of added) {
    const check = checkGrantableRole(guild, rule.roleId);
    if (!check.ok) return `Rol del nivel ${rule.level}: ${plainDiscordText(guild, check.reason)}`;
    const memberProblem = checkMemberCanAssignRole(guild, member, check.role, devSession);
    if (memberProblem) return `Rol del nivel ${rule.level}: ${memberText(memberProblem)}`;
  }
  if (checkAll) {
    for (const rule of merged.levelRoleRewards) {
      // Un rol que el bot no puede manejar no lo da ni lo quita
      const check = checkGrantableRole(guild, rule.roleId);
      if (!check.ok) continue;
      const memberProblem = checkMemberCanAssignRole(guild, member, check.role, devSession);
      if (memberProblem) return `Con "solo el rol más alto" el bot da y quita los roles por nivel unos por otros. Rol del nivel ${rule.level}: ${memberText(memberProblem)}`;
    }
  }
  return null;
}

async function buildResponse(guildId: string): Promise<GuildTuningResponse> {
  return { tuning: tuningOf(await getExtras(guildId)) };
}

export function setupTuningRoutes(app: Express, { broadcast }: { broadcast: Broadcast }) {
  app.get("/api/guilds/:guildId/tuning", ...guildAdmin, async (req: Request, res: Response) => {
    try {
      res.json(await buildResponse(req.params.guildId));
    } catch (error) {
      console.error("[TUNING-ERROR]", error);
      res.status(500).json({ error: "No se pudieron leer los ajustes." });
    }
  });

  app.patch("/api/guilds/:guildId/tuning", ...guildAdminWithBot, async (req: Request, res: Response) => {
    const guild = getBotGuild(res);
    try {
      const input = parseBody(tuningSchema, req, res) as TuningPatch | null;
      if (!input) return;
      // Se guarda el bloque completo: dos guardados a la vez (dos páginas o dos admins) van en fila y cada
      // uno parte de lo último guardado, así ninguno borra lo que cambió el otro
      // (updateExtras deja la caché al día y getExtras no la tapa con una lectura más vieja, así que aquí
      // dentro se lee lo último guardado)
      const problem = await lockForGuild(`tuning:${guild.id}`).runExclusive(async () => {
        const saved = tuningOf(await getExtras(guild.id));
        const merged = resolveTuning({ ...saved, ...input });
        const problem = await checkInput(req, guild, input, { ...saved, ...input } as GuildTuning, saved);
        if (problem) return problem;
        await ensureGuildRow(guild);
        await updateExtras(guild.id, { tuning: tuningDiff(merged) });
        return null;
      });
      if (problem) return res.status(400).json({ error: problem });

      broadcast(guild.id, { type: "tuningUpdated" });
      res.json(await buildResponse(guild.id));
    } catch (error) {
      console.error("[TUNING-ERROR]", error);
      res.status(500).json({ error: "No se pudieron guardar los ajustes." });
    }
  });
}
