import type { Express, NextFunction, Request, Response } from "express";
import type { Guild as DiscordGuild } from "discord.js";
import { z } from "zod";
import type { RolePanel } from "@shared/schema";
import {
  ROLE_PANEL_LIMITS,
  type RolePanelDeleteResponse,
  type RolePanelItem,
  type RolePanelsResponse,
} from "@shared/api";
import {
  createRolePanel,
  deleteRolePanel,
  listRolePanels,
  RolePanelLimitError,
  RolePanelPublishError,
  updateRolePanel,
  type RolePanelInput,
} from "../bot/services/rolePanels";
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
  getCachedBotGuild,
  isDevRequest,
  isRowId,
  plainDiscordText,
  toIso,
} from "./helpers";

type Broadcast = (guildId: string, message: Record<string, unknown>) => void;

const guildAdmin = [requireAuth, requireGuildAdmin];
const guildAdminWithBot = [requireAuth, requireGuildAdmin, requireBotInGuild];

// ===== Validación =====
const buttonSchema = z.object({
  roleId: snowflakeSchema,
  label: z.string()
    .trim()
    .min(1, "Cada botón necesita un texto.")
    .max(ROLE_PANEL_LIMITS.labelMaxLength, `El texto de un botón puede tener como máximo ${ROLE_PANEL_LIMITS.labelMaxLength} caracteres.`),
  emoji: z.union([z.string(), z.null()])
    .transform((value) => value?.trim() || null)
    .refine((value) => value === null || (value.length <= ROLE_PANEL_LIMITS.emojiMaxLength && isValidButtonEmoji(value)),
      "Un emoji no es válido: pon uno solo (por ejemplo 🎮) o uno del servidor como <:nombre:id>."),
}).strict();

const panelSchema = z.object({
  channelId: snowflakeSchema,
  title: z.string()
    .trim()
    .min(1, "Ponle un título al panel.")
    .max(ROLE_PANEL_LIMITS.titleMaxLength, `El título puede tener como máximo ${ROLE_PANEL_LIMITS.titleMaxLength} caracteres.`),
  description: z.union([
    z.string().max(ROLE_PANEL_LIMITS.descriptionMaxLength, `La descripción puede tener como máximo ${ROLE_PANEL_LIMITS.descriptionMaxLength} caracteres.`),
    z.null(),
  ]).transform((value) => value?.trim() || null),
  exclusive: z.boolean(),
  roles: z.array(buttonSchema)
    .min(1, "Agrega al menos un rol.")
    .max(ROLE_PANEL_LIMITS.maxRoles, `Un panel puede tener como máximo ${ROLE_PANEL_LIMITS.maxRoles} roles.`)
    .refine((roles) => new Set(roles.map((role) => role.roleId)).size === roles.length, "Hay un rol repetido en el panel."),
}).strict();

function toItem(panel: RolePanel): RolePanelItem {
  return {
    id: panel.id,
    channelId: panel.channelId,
    messageId: panel.messageId ?? null,
    messageUrl: panel.messageId
      ? `https://discord.com/channels/${panel.guildId}/${panel.channelId}/${panel.messageId}`
      : null,
    title: panel.title,
    description: panel.description ?? null,
    roles: panel.roles ?? [],
    exclusive: panel.exclusive,
    updatedAt: toIso(panel.updatedAt ?? panel.createdAt),
  };
}

function requireValidPanelId(req: Request, res: Response, next: NextFunction) {
  if (!isRowId(req.params.panelId)) {
    return res.status(400).json({ error: "El ID del panel no es válido." });
  }
  next();
}

/**
 * Canal donde el bot y quien usa el panel pueden escribir, y roles que el bot puede dar y que la persona
 * también podría dar (para que nadie use el panel para repartir roles que están por encima de los suyos).
 */
async function checkPanelInput(req: Request, guild: DiscordGuild, input: RolePanelInput): Promise<string | null> {
  if (!findPostableChannel(guild, input.channelId)) {
    return "Ese canal no existe o no es un canal de texto de este servidor.";
  }
  const channelProblem = await checkPanelUserCanUseChannel(req, guild, input.channelId);
  if (channelProblem) return channelProblem;

  const devSession = isDevRequest(req);
  const member = devSession ? null : await fetchSessionMember(req, guild);
  for (const button of input.roles) {
    const check = checkGrantableRole(guild, button.roleId);
    if (!check.ok) return `"${button.label}": ${plainDiscordText(guild, check.reason)}`;
    const memberProblem = checkMemberCanAssignRole(guild, member, check.role, devSession);
    if (memberProblem) {
      return `"${button.label}": ${memberProblem.replace("Para elegir el rol automático también", "Para repartir roles")}`;
    }
  }
  return null;
}

function sendPanelError(res: Response, guild: DiscordGuild | null, error: unknown, fallback: string) {
  if (error instanceof RolePanelLimitError) return res.status(409).json({ error: error.message });
  if (error instanceof RolePanelPublishError) return res.status(400).json({ error: plainDiscordText(guild, error.message) });
  console.error("[ROLE-PANELS-ERROR]", error);
  return res.status(500).json({ error: fallback });
}

export function setupRolePanelRoutes(app: Express, { broadcast }: { broadcast: Broadcast }) {
  const changed = (guildId: string) => broadcast(guildId, { type: "rolePanelsUpdated" });

  app.get("/api/role-panels/:guildId", ...guildAdmin, async (req: Request, res: Response) => {
    try {
      const panels = await listRolePanels(req.params.guildId);
      const body: RolePanelsResponse = { panels: panels.map(toItem), maxPanels: ROLE_PANEL_LIMITS.maxPerGuild };
      res.json(body);
    } catch (error) {
      sendPanelError(res, null, error, "No se pudieron obtener los paneles de autorroles.");
    }
  });

  app.post("/api/role-panels/:guildId", ...guildAdminWithBot, async (req: Request, res: Response) => {
    const guild = getBotGuild(res);
    try {
      const input = parseBody(panelSchema, req, res);
      if (!input) return;
      const problem = await checkPanelInput(req, guild, input);
      if (problem) return res.status(400).json({ error: problem });

      await ensureGuildRow(guild);
      const panel = await createRolePanel(guild, input);
      changed(guild.id);
      res.status(201).json(toItem(panel));
    } catch (error) {
      sendPanelError(res, guild, error, "No se pudo crear el panel de autorroles.");
    }
  });

  app.put("/api/role-panels/:guildId/:panelId", ...guildAdminWithBot, requireValidPanelId, async (req: Request, res: Response) => {
    const guild = getBotGuild(res);
    try {
      const input = parseBody(panelSchema, req, res);
      if (!input) return;
      const problem = await checkPanelInput(req, guild, input);
      if (problem) return res.status(400).json({ error: problem });

      const panel = await updateRolePanel(guild, req.params.panelId, input);
      if (!panel) return res.status(404).json({ error: "Ese panel no existe en este servidor." });
      changed(guild.id);
      res.json(toItem(panel));
    } catch (error) {
      sendPanelError(res, guild, error, "No se pudo guardar el panel de autorroles.");
    }
  });

  // Sin el bot conectado también se puede borrar (el mensaje se queda en Discord, con botones que ya no hacen nada)
  app.delete("/api/role-panels/:guildId/:panelId", ...guildAdmin, requireValidPanelId, async (req: Request, res: Response) => {
    const { guildId, panelId } = req.params;
    try {
      const result = await deleteRolePanel(getCachedBotGuild(guildId), guildId, panelId);
      if (!result) return res.status(404).json({ error: "Ese panel no existe en este servidor." });
      changed(guildId);
      const body: RolePanelDeleteResponse = { success: true, messageDeleted: result.messageDeleted };
      res.json(body);
    } catch (error) {
      sendPanelError(res, null, error, "No se pudo borrar el panel de autorroles.");
    }
  });
}
