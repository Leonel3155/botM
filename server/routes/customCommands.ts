import type { Express, NextFunction, Request, Response } from "express";
import { z } from "zod";
import type { CustomCommand } from "@shared/schema";
import {
  CUSTOM_COMMAND_LIMITS,
  RESERVED_CUSTOM_COMMAND_NAMES,
  type CustomCommandItem,
  type CustomCommandResponse,
  type CustomCommandsResponse,
  type SuccessResponse,
} from "@shared/api";
import {
  storage,
  CustomCommandLimitError,
  CustomCommandNameTakenError,
  type CustomCommandUpdate,
} from "../storage";
import { invalidateCustomCommandsCache, isReservedCommandName } from "../bot/customCommands";
import {
  requireAuth,
  requireGuildAdmin,
  requireBotInGuild,
  getBotGuild,
  ensureGuildRow,
  parseBody,
} from "./middleware";
import { isRowId, toIso } from "./helpers";

type Broadcast = (guildId: string, message: Record<string, unknown>) => void;

const guildAdmin = [requireAuth, requireGuildAdmin];
const guildAdminWithBot = [requireAuth, requireGuildAdmin, requireBotInGuild];

const NAME_REGEX = new RegExp(CUSTOM_COMMAND_LIMITS.namePattern);

// ===== Validación =====
const customCommandNameSchema = z.string()
  .trim()
  .toLowerCase()
  .min(1, "El nombre del comando es obligatorio.")
  .max(CUSTOM_COMMAND_LIMITS.nameMaxLength, `El nombre del comando puede tener como máximo ${CUSTOM_COMMAND_LIMITS.nameMaxLength} caracteres.`)
  .regex(NAME_REGEX, "El nombre solo puede tener letras minúsculas, números, guiones y guiones bajos (sin espacios ni el prefijo).")
  .refine(
    (name) => !isReservedCommandName(name),
    (name) => ({ message: `"${name}" ya es un comando del bot. Elige otro nombre.` })
  );

const customCommandResponseSchema = z.string()
  .trim()
  .min(1, "La respuesta es obligatoria.")
  .max(CUSTOM_COMMAND_LIMITS.responseMaxLength, `La respuesta puede tener como máximo ${CUSTOM_COMMAND_LIMITS.responseMaxLength} caracteres.`);

const customCommandDescriptionSchema = z
  .union([
    z.string().max(CUSTOM_COMMAND_LIMITS.descriptionMaxLength, `La descripción puede tener como máximo ${CUSTOM_COMMAND_LIMITS.descriptionMaxLength} caracteres.`),
    z.null(),
  ])
  .transform((value) => value?.trim() || null);

const customCommandCreateSchema = z.object({
  name: customCommandNameSchema,
  response: customCommandResponseSchema,
  description: customCommandDescriptionSchema.optional(),
}).strict();

const customCommandUpdateSchema = z.object({
  name: customCommandNameSchema,
  response: customCommandResponseSchema,
  description: customCommandDescriptionSchema,
  enabled: z.boolean(),
}).partial().strict()
  .refine((data) => Object.keys(data).length > 0, "No se envió ningún cambio.");

const customCommandToggleSchema = z.object({
  enabled: z.boolean()
}).strict();

function toItem(command: CustomCommand): CustomCommandItem {
  return {
    id: command.id,
    name: command.name,
    description: command.description ?? null,
    response: command.response,
    enabled: command.enabled ?? true,
    uses: command.uses ?? 0,
    createdBy: command.createdBy,
    createdAt: toIso(command.createdAt),
  };
}

function requireValidCommandId(req: Request, res: Response, next: NextFunction) {
  if (!isRowId(req.params.commandId)) {
    return res.status(400).json({ error: "El ID del comando no es válido." });
  }
  next();
}

/** Errores de reglas (límite, nombre repetido) como 409 con su mensaje; el resto, 500 genérico. */
function sendCommandError(res: Response, error: unknown, fallback: string) {
  if (error instanceof CustomCommandLimitError || error instanceof CustomCommandNameTakenError) {
    return res.status(409).json({ error: error.message });
  }
  console.error("[CUSTOM-COMMANDS-ERROR]", error);
  return res.status(500).json({ error: fallback });
}

export function setupCustomCommandRoutes(app: Express, { broadcast }: { broadcast: Broadcast }) {
  const changed = (guildId: string) => {
    invalidateCustomCommandsCache(guildId);
    broadcast(guildId, { type: "customCommandsUpdated" });
  };

  app.get("/api/custom-commands/:guildId", ...guildAdmin, async (req: Request, res: Response) => {
    try {
      const { guildId } = req.params;
      const [commands, guild] = await Promise.all([
        storage.getCustomCommands(guildId),
        storage.getGuild(guildId),
      ]);

      const body: CustomCommandsResponse = {
        commands: commands.map(toItem),
        prefix: guild?.prefix || "&",
        maxCommands: CUSTOM_COMMAND_LIMITS.maxPerGuild,
        reservedNames: RESERVED_CUSTOM_COMMAND_NAMES,
      };
      res.json(body);
    } catch (error) {
      sendCommandError(res, error, "No se pudieron obtener los comandos personalizados.");
    }
  });

  app.post("/api/custom-commands/:guildId", ...guildAdminWithBot, async (req: Request, res: Response) => {
    try {
      const { guildId } = req.params;
      const body = parseBody(customCommandCreateSchema, req, res);
      if (!body) return;

      const user = req.session.user;
      if (!user) {
        return res.status(401).json({ error: "Necesitas iniciar sesión con Discord para usar el panel." });
      }

      // created_by y guild_id son llaves foráneas: el usuario y el servidor deben existir en la BD
      await ensureGuildRow(getBotGuild(res));
      await storage.upsertUser({ id: user.id, username: user.username, avatar: user.avatar });

      const command = await storage.createCustomCommand({
        guildId,
        name: body.name,
        description: body.description ?? null,
        response: body.response,
        enabled: true,
        createdBy: user.id,
      });

      changed(guildId);
      const result: CustomCommandResponse = toItem(command);
      res.status(201).json(result);
    } catch (error) {
      sendCommandError(res, error, "No se pudo crear el comando personalizado.");
    }
  });

  app.patch("/api/custom-commands/:guildId/:commandId", ...guildAdmin, requireValidCommandId, async (req: Request, res: Response) => {
    try {
      const { guildId, commandId } = req.params;
      const body = parseBody(customCommandUpdateSchema, req, res);
      if (!body) return;

      const updates: CustomCommandUpdate = {};
      if (body.name !== undefined) updates.name = body.name;
      if (body.response !== undefined) updates.response = body.response;
      if (body.description !== undefined) updates.description = body.description;
      if (body.enabled !== undefined) updates.enabled = body.enabled;

      const command = await storage.updateCustomCommand(guildId, commandId, updates);
      if (!command) {
        return res.status(404).json({ error: "Ese comando no existe en este servidor." });
      }

      changed(guildId);
      const result: CustomCommandResponse = toItem(command);
      res.json(result);
    } catch (error) {
      sendCommandError(res, error, "No se pudo actualizar el comando personalizado.");
    }
  });

  app.patch("/api/custom-commands/:guildId/:commandId/toggle", ...guildAdmin, requireValidCommandId, async (req: Request, res: Response) => {
    try {
      const { guildId, commandId } = req.params;
      const body = parseBody(customCommandToggleSchema, req, res);
      if (!body) return;

      const command = await storage.setCustomCommandEnabled(guildId, commandId, body.enabled);
      if (!command) {
        return res.status(404).json({ error: "Ese comando no existe en este servidor." });
      }

      changed(guildId);
      const result: CustomCommandResponse = toItem(command);
      res.json(result);
    } catch (error) {
      sendCommandError(res, error, "No se pudo cambiar el estado del comando.");
    }
  });

  app.delete("/api/custom-commands/:guildId/:commandId", ...guildAdmin, requireValidCommandId, async (req: Request, res: Response) => {
    try {
      const { guildId, commandId } = req.params;
      const deleted = await storage.deleteCustomCommand(guildId, commandId);
      if (!deleted) {
        return res.status(404).json({ error: "Ese comando no existe en este servidor." });
      }

      changed(guildId);
      const result: SuccessResponse = { success: true };
      res.json(result);
    } catch (error) {
      sendCommandError(res, error, "No se pudo eliminar el comando personalizado.");
    }
  });
}
