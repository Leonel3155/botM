import type { Express, Request, Response } from "express";
import { z } from "zod";
import { antiRaidActions, antiRaidConfigSchema, type AntiRaidSettings } from "@shared/schema";
import {
  ANTI_RAID_LIMITS,
  RAID_EVENT_STATUS_FILTERS,
  type ActiveRaidInfo,
  type AntiRaidLiftResponse,
  type AntiRaidResponse,
  type AntiRaidUpdateResponse,
  type RaidEventResolveResponse,
  type RaidEventsResponse,
} from "@shared/api";
import { storage } from "../storage";
import {
  ANTI_RAID_ACTION_LABELS,
  getActiveRaid,
  invalidateAntiRaidConfig,
  liftLockdown,
} from "../bot/middleware/antiRaid";
import { resolveSendableChannel } from "../bot/services/channels";
import {
  requireAuth,
  requireGuildAdmin,
  requireBotInGuild,
  getBotGuild,
  ensureGuildRow,
  parseBody,
  parseLimit,
  snowflakeSchema,
} from "./middleware";
import {
  decodeCursor,
  encodeCursor,
  checkPanelUserCanUseChannel,
  findPostableChannel,
  isActiveRaidEvent,
  isRowId,
  plainDiscordText,
  queryString,
  raidEventReview,
  sessionUserId,
  toRaidEventItem,
} from "./helpers";

type Broadcast = (guildId: string, message: Record<string, unknown>) => void;

const guildAdmin = [requireAuth, requireGuildAdmin];
const guildAdminWithBot = [requireAuth, requireGuildAdmin, requireBotInGuild];

// Número entero dentro de los mismos rangos que /antiraid configurar, con un mensaje claro
function rangeSchema(label: string, { min, max }: { min: number; max: number }) {
  const message = `${label} debe ser un número entero entre ${min} y ${max}.`;
  return z.number().int(message).min(min, message).max(max, message);
}

// logChannelId: null o "" = automático
const antiRaidUpdateSchema = antiRaidConfigSchema
  .extend({
    enabled: z.boolean(),
    joinThreshold: rangeSchema("El número de entradas", ANTI_RAID_LIMITS.joinThreshold),
    joinWindowSeconds: rangeSchema("Los segundos de la ventana", ANTI_RAID_LIMITS.joinWindowSeconds),
    minAccountAgeDays: rangeSchema("La antigüedad mínima de la cuenta (días)", ANTI_RAID_LIMITS.minAccountAgeDays),
    lockdownMinutes: rangeSchema("La duración del modo raid (minutos)", ANTI_RAID_LIMITS.lockdownMinutes),
    logChannelId: z.union([snowflakeSchema, z.literal(""), z.null()]).transform((value) => value || null),
  })
  .partial()
  .strict();

const emptyBodySchema = z.object({}).strict();

function activeRaidInfo(guildId: string): ActiveRaidInfo | null {
  const raid = getActiveRaid(guildId);
  if (!raid) return null;
  return {
    action: raid.action,
    startedAt: new Date(raid.startedAt).toISOString(),
    endsAt: new Date(raid.liftAt).toISOString(),
    joinsDuringRaid: raid.joinsDuringRaid,
    kicked: raid.kicked,
  };
}

function buildAntiRaidResponse(guildId: string, config: AntiRaidSettings): AntiRaidResponse {
  return {
    config,
    actions: antiRaidActions.map((value) => ({ value, label: ANTI_RAID_ACTION_LABELS[value] })),
    activeRaid: activeRaidInfo(guildId),
  };
}

/** Quién levantó el modo raid (para el aviso del bot): el ID de Discord del usuario del panel. */
function liftedBy(req: Request): string {
  return sessionUserId(req) ?? "manual";
}

export function setupSecurityRoutes(app: Express, { broadcast }: { broadcast: Broadcast }) {
  // =============================================
  // Anti-raid: configuración y estado
  // =============================================
  app.get("/api/guilds/:guildId/antiraid", ...guildAdmin, async (req: Request, res: Response) => {
    try {
      const { guildId } = req.params;
      const config = await storage.getAntiRaidConfig(guildId);
      res.json(buildAntiRaidResponse(guildId, config));
    } catch (error) {
      console.error("[ANTIRAID-ERROR]", error);
      res.status(500).json({ error: "No se pudo obtener la configuración anti-raid." });
    }
  });

  app.patch("/api/guilds/:guildId/antiraid", ...guildAdminWithBot, async (req: Request, res: Response) => {
    try {
      const { guildId } = req.params;
      const body = parseBody(antiRaidUpdateSchema, req, res);
      if (!body) return;

      if (Object.keys(body).length === 0) {
        return res.status(400).json({ error: "No se envió ningún cambio." });
      }

      const guild = getBotGuild(res);
      const warnings: string[] = [];

      if (body.logChannelId) {
        if (!findPostableChannel(guild, body.logChannelId)) {
          return res.status(400).json({ error: "El canal de alertas no existe en este servidor o no es un canal de texto." });
        }
        const current = await storage.getAntiRaidConfig(guildId);
        if (body.logChannelId !== current.logChannelId) {
          const userProblem = await checkPanelUserCanUseChannel(req, guild, body.logChannelId);
          if (userProblem) {
            return res.status(403).json({ error: `Canal de alertas: ${userProblem}` });
          }
        }
        const check = resolveSendableChannel(guild, body.logChannelId);
        if (!check.ok) {
          warnings.push(`Canal de alertas: ${plainDiscordText(guild, check.reason)} Mientras tanto avisaré por otro canal del staff o por mensaje directo al dueño.`);
        }
      }

      await ensureGuildRow(guild);
      const config = await storage.setAntiRaidConfig(guildId, body);
      // El bot guarda la configuración en caché unos segundos: que aplique ya
      invalidateAntiRaidConfig(guildId);

      // Igual que /antiraid desactivar: apagar la protección también termina el modo raid
      const liftedRaid = body.enabled === false ? await liftLockdown(guildId, liftedBy(req)) : false;

      broadcast(guildId, { type: "settingsUpdated" });
      const result: AntiRaidUpdateResponse = { ...buildAntiRaidResponse(guildId, config), warnings, liftedRaid };
      res.json(result);
    } catch (error) {
      console.error("[ANTIRAID-UPDATE-ERROR]", error);
      res.status(500).json({ error: "No se pudo guardar la configuración anti-raid." });
    }
  });

  // Terminar ya el modo raid activo (igual que /antiraid levantar)
  app.post("/api/guilds/:guildId/antiraid/lift", ...guildAdmin, async (req: Request, res: Response) => {
    try {
      const { guildId } = req.params;
      if (!parseBody(emptyBodySchema, req, res)) return;

      const lifted = await liftLockdown(guildId, liftedBy(req));
      if (lifted) broadcast(guildId, { type: "settingsUpdated" });
      const body: AntiRaidLiftResponse = { success: true, lifted };
      res.json(body);
    } catch (error) {
      console.error("[ANTIRAID-LIFT-ERROR]", error);
      res.status(500).json({ error: "No se pudo terminar el modo raid." });
    }
  });

  // =============================================
  // Historial de raids
  // =============================================
  app.get("/api/guilds/:guildId/raid-events", ...guildAdmin, async (req: Request, res: Response) => {
    try {
      const { guildId } = req.params;
      const limit = parseLimit(req.query.limit, 20, 100);

      const statusParam = queryString(req.query.status) ?? "all";
      const status = RAID_EVENT_STATUS_FILTERS.find((value) => value === statusParam);
      if (!status) {
        return res.status(400).json({ error: 'El filtro "status" debe ser all, open, resolved o unreviewed.' });
      }

      const before = decodeCursor(req.query.before);
      if (before === null) {
        return res.status(400).json({ error: 'El valor de "before" no es válido. Usa el nextCursor de la página anterior.' });
      }

      // Pedimos uno de más para saber si hay otra página
      const rows = await storage.queryRaidEvents(guildId, { status, before, limit: limit + 1 });
      const page = rows.slice(0, limit);
      const last = page[page.length - 1];

      const body: RaidEventsResponse = {
        events: page.map(toRaidEventItem),
        nextCursor: rows.length > limit && last ? encodeCursor(last.createdAt, last.id) : null,
      };
      res.json(body);
    } catch (error) {
      console.error("[RAID-EVENTS-ERROR]", error);
      res.status(500).json({ error: "No se pudo obtener el historial de raids." });
    }
  });

  // Marcar un raid como revisado (aunque ya estuviera cerrado). Si seguía abierto se cierra y,
  // si es el modo raid activo, se termina (restaura la verificación y avisa).
  app.post("/api/guilds/:guildId/raid-events/:eventId/resolve", ...guildAdmin, async (req: Request, res: Response) => {
    try {
      const { guildId, eventId } = req.params;
      if (!isRowId(eventId)) {
        return res.status(400).json({ error: "El ID del evento no es válido." });
      }
      if (!parseBody(emptyBodySchema, req, res)) return;

      const event = await storage.getRaidEvent(guildId, eventId);
      if (!event) {
        return res.status(404).json({ error: "Ese evento de raid no existe en este servidor." });
      }

      const reviewer = liftedBy(req);
      let liftedRaid = false;
      let changed = false;
      if (!event.resolved) {
        if (isActiveRaidEvent(event)) {
          liftedRaid = await liftLockdown(guildId, reviewer);
        }
        // Si no era el activo (o alguien lo levantó justo antes), lo cerramos aquí
        const fresh = await storage.getRaidEvent(guildId, eventId);
        if (fresh && !fresh.resolved) {
          await storage.resolveRaidEvent(eventId, { resolvedAt: Date.now(), resolvedBy: reviewer });
        }
        changed = true;
      }

      // Revisado siempre, esté cerrado o no (si ya lo estaba se conserva la primera revisión)
      if (!raidEventReview(event).reviewed) {
        await storage.markRaidEventReviewed(guildId, eventId, reviewer);
        changed = true;
      }
      if (changed) broadcast(guildId, { type: "settingsUpdated" });

      const updated = await storage.getRaidEvent(guildId, eventId);
      const body: RaidEventResolveResponse = {
        success: true,
        event: toRaidEventItem(updated ?? event),
        liftedRaid,
      };
      res.json(body);
    } catch (error) {
      console.error("[RAID-EVENT-RESOLVE-ERROR]", error);
      res.status(500).json({ error: "No se pudo marcar el raid como revisado." });
    }
  });
}
