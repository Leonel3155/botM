import type { Express, Request, Response } from "express";
import type { ModerationActionsResponse } from "@shared/api";
import { storage } from "../storage";
import { requireAuth, requireGuildAdmin, isSnowflake, parseLimit } from "./middleware";
import { decodeCursor, encodeCursor, queryString, toModerationActionItem } from "./helpers";

const guildAdmin = [requireAuth, requireGuildAdmin];

// Tipos que guarda el bot: warn, mute, unmute, kick, ban, clear, lockdown, unlock... (solo letras y "_")
const ACTION_TYPE_REGEX = /^[a-z_]{1,32}$/;

export function setupModerationRoutes(app: Express) {
  // Historial de moderación con filtros y páginas: ?type=&userId=&limit=&before=<nextCursor>
  app.get("/api/moderation/:guildId/actions", ...guildAdmin, async (req: Request, res: Response) => {
    try {
      const { guildId } = req.params;
      const limit = parseLimit(req.query.limit, 50, 100);

      const type = queryString(req.query.type) || undefined;
      if (type !== undefined && !ACTION_TYPE_REGEX.test(type)) {
        return res.status(400).json({ error: 'El filtro "type" no es válido.' });
      }

      const userId = queryString(req.query.userId) || undefined;
      if (userId !== undefined && !isSnowflake(userId)) {
        return res.status(400).json({ error: "El ID del usuario no es válido." });
      }

      const before = decodeCursor(req.query.before);
      if (before === null) {
        return res.status(400).json({ error: 'El valor de "before" no es válido. Usa el nextCursor de la página anterior.' });
      }

      // Pedimos uno de más para saber si hay otra página
      const rows = await storage.queryModerationActions(guildId, { type, userId, before, limit: limit + 1 });
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
