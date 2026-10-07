import type { Express, Request, Response } from "express";
import { z } from "zod";
import type { ModerationActionsResponse } from "@shared/api";
import { storage } from "../storage";
import { requireAuth, requireGuildAdmin, isSnowflake, parseLimit, parseQuery } from "./middleware";
import { decodeCursor, encodeCursor, toModerationActionItem } from "./helpers";

const guildAdmin = [requireAuth, requireGuildAdmin];

// Tipos que guarda el bot: warn, mute, unmute, kick, ban, clear, lockdown, unlock... (solo letras y "_")
const ACTION_TYPE_REGEX = /^[a-z_]{1,32}$/;

/** Filtro opcional de la URL: si no viene o viene vacío, no se filtra. */
function optionalParam<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess((value) => (value === "" ? undefined : value), schema.optional());
}

// ?type=&userId=&moderatorId=&limit=&before=<nextCursor> (ver ModerationActionsQuery en shared/api.ts)
const moderationActionsQuerySchema = z.object({
  type: optionalParam(z.string().regex(ACTION_TYPE_REGEX, 'El filtro "type" no es válido.')),
  userId: optionalParam(z.string().refine(isSnowflake, "El ID del usuario no es válido.")),
  moderatorId: optionalParam(z.string().refine(isSnowflake, "El ID del moderador no es válido.")),
  // Un límite raro no es un error: se usa el de siempre (50, máximo 100)
  limit: z.unknown().transform((value) => parseLimit(value, 50, 100)),
  before: z.unknown().transform((value, ctx) => {
    const cursor = decodeCursor(value);
    if (cursor === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'El valor de "before" no es válido. Usa el nextCursor de la página anterior.',
      });
      return z.NEVER;
    }
    return cursor;
  }),
});

export function setupModerationRoutes(app: Express) {
  // Historial de moderación con filtros y páginas
  app.get("/api/moderation/:guildId/actions", ...guildAdmin, async (req: Request, res: Response) => {
    try {
      const { guildId } = req.params;
      const query = parseQuery(moderationActionsQuerySchema, req, res);
      if (!query) return;
      const { type, userId, moderatorId, before, limit } = query;

      // Pedimos uno de más para saber si hay otra página
      const rows = await storage.queryModerationActions(guildId, { type, userId, moderatorId, before, limit: limit + 1 });
      const page = rows.slice(0, limit);
      const last = page[page.length - 1];

      const body: ModerationActionsResponse = {
        actions: page.map(toModerationActionItem),
        nextCursor: rows.length > limit && last ? encodeCursor(last.action.createdAt, last.action.id) : null,
      };
      res.json(body);
    } catch (error) {
      console.error("[MODERATION-ACTIONS-ERROR]", error);
      res.status(500).json({ error: "No se pudieron obtener las acciones de moderación." });
    }
  });
}
