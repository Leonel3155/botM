import type { Express, NextFunction, Request, Response } from "express";
import type { Guild as DiscordGuild } from "discord.js";
import { z } from "zod";
import type { ShopItem } from "@shared/schema";
import { SHOP_LIMITS, type ShopItemItem, type ShopItemsResponse, type SuccessResponse } from "@shared/api";
import { storage } from "../storage";
import {
  createShopItem,
  deleteShopItem,
  listShopItems,
  ShopItemLimitError,
  ShopItemNameTakenError,
  updateShopItem,
} from "../bot/services/shop";
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
import { checkMemberCanAssignRole, fetchSessionMember, isDevRequest, isRowId, plainDiscordText, toIso } from "./helpers";

type Broadcast = (guildId: string, message: Record<string, unknown>) => void;

const guildAdmin = [requireAuth, requireGuildAdmin];
const guildAdminWithBot = [requireAuth, requireGuildAdmin, requireBotInGuild];

// ===== Validación =====
const itemFields = {
  name: z.string()
    .trim()
    .min(1, "Ponle un nombre al artículo.")
    .max(SHOP_LIMITS.nameMaxLength, `El nombre puede tener como máximo ${SHOP_LIMITS.nameMaxLength} caracteres.`),
  description: z.union([
    z.string().max(SHOP_LIMITS.descriptionMaxLength, `La descripción puede tener como máximo ${SHOP_LIMITS.descriptionMaxLength} caracteres.`),
    z.null(),
  ]).transform((value) => value?.trim() || null),
  emoji: z.union([z.string(), z.null()])
    .transform((value) => value?.trim() || null)
    .refine((value) => value === null || (value.length <= SHOP_LIMITS.emojiMaxLength && isValidButtonEmoji(value)),
      "El emoji no es válido: pon uno solo (por ejemplo 🎟️) o uno del servidor como <:nombre:id>."),
  price: z.number()
    .int("El precio debe ser un número entero.")
    .min(1, "El precio debe ser de al menos 1 moneda.")
    .max(SHOP_LIMITS.maxPrice, `El precio puede ser como máximo ${SHOP_LIMITS.maxPrice.toLocaleString("es-MX")} monedas.`),
  roleId: z.union([snowflakeSchema, z.literal(""), z.null()]).transform((value) => value || null),
  stock: z.union([
    z.number()
      .int("Las unidades deben ser un número entero.")
      .min(0, "Las unidades no pueden ser negativas.")
      .max(SHOP_LIMITS.maxStock, `Como máximo ${SHOP_LIMITS.maxStock.toLocaleString("es-MX")} unidades.`),
    z.null(),
  ]),
  enabled: z.boolean(),
};

const createSchema = z.object(itemFields).strict();
const updateSchema = z.object(itemFields).partial().strict()
  .refine((data) => Object.keys(data).length > 0, "No se envió ningún cambio.");

function toItem(item: ShopItem): ShopItemItem {
  return {
    id: item.id,
    name: item.name,
    description: item.description ?? null,
    emoji: item.emoji ?? null,
    price: item.price,
    roleId: item.roleId ?? null,
    stock: item.stock ?? null,
    sold: item.sold,
    enabled: item.enabled,
    createdAt: toIso(item.createdAt),
  };
}

function requireValidItemId(req: Request, res: Response, next: NextFunction) {
  if (!isRowId(req.params.itemId)) {
    return res.status(400).json({ error: "El ID del artículo no es válido." });
  }
  next();
}

/** El bot tiene que poder dar el rol, y quien lo pone a la venta también (no por encima de su rol más alto). */
async function checkItemRole(req: Request, guild: DiscordGuild, roleId: string): Promise<string | null> {
  const check = checkGrantableRole(guild, roleId);
  if (!check.ok) return plainDiscordText(guild, check.reason);
  const devSession = isDevRequest(req);
  const member = devSession ? null : await fetchSessionMember(req, guild);
  const problem = checkMemberCanAssignRole(guild, member, check.role, devSession);
  return problem?.replace("Para elegir el rol automático también", "Para vender roles") ?? null;
}

function sendShopError(res: Response, error: unknown, fallback: string) {
  if (error instanceof ShopItemLimitError || error instanceof ShopItemNameTakenError) {
    return res.status(409).json({ error: error.message });
  }
  console.error("[SHOP-ERROR]", error);
  return res.status(500).json({ error: fallback });
}

export function setupShopRoutes(app: Express, { broadcast }: { broadcast: Broadcast }) {
  const changed = (guildId: string) => broadcast(guildId, { type: "shopUpdated" });

  app.get("/api/shop/:guildId", ...guildAdmin, async (req: Request, res: Response) => {
    try {
      const { guildId } = req.params;
      const [items, guild] = await Promise.all([listShopItems(guildId), storage.getGuild(guildId)]);
      const body: ShopItemsResponse = {
        items: items.map(toItem),
        maxItems: SHOP_LIMITS.maxItemsPerGuild,
        economyEnabled: guild?.economyEnabled ?? true,
      };
      res.json(body);
    } catch (error) {
      sendShopError(res, error, "No se pudo obtener la tienda.");
    }
  });

  app.post("/api/shop/:guildId", ...guildAdminWithBot, async (req: Request, res: Response) => {
    try {
      const guild = getBotGuild(res);
      const body = parseBody(createSchema, req, res);
      if (!body) return;
      if (body.roleId) {
        const problem = await checkItemRole(req, guild, body.roleId);
        if (problem) return res.status(400).json({ error: problem });
      }

      await ensureGuildRow(guild);
      const item = await createShopItem(guild.id, body);
      changed(guild.id);
      res.status(201).json(toItem(item));
    } catch (error) {
      sendShopError(res, error, "No se pudo crear el artículo.");
    }
  });

  app.patch("/api/shop/:guildId/:itemId", ...guildAdminWithBot, requireValidItemId, async (req: Request, res: Response) => {
    try {
      const guild = getBotGuild(res);
      const body = parseBody(updateSchema, req, res);
      if (!body) return;
      if (body.roleId) {
        const problem = await checkItemRole(req, guild, body.roleId);
        if (problem) return res.status(400).json({ error: problem });
      }

      const item = await updateShopItem(guild.id, req.params.itemId, body);
      if (!item) return res.status(404).json({ error: "Ese artículo no existe en este servidor." });
      changed(guild.id);
      res.json(toItem(item));
    } catch (error) {
      sendShopError(res, error, "No se pudo guardar el artículo.");
    }
  });

  app.delete("/api/shop/:guildId/:itemId", ...guildAdmin, requireValidItemId, async (req: Request, res: Response) => {
    try {
      const { guildId, itemId } = req.params;
      const deleted = await deleteShopItem(guildId, itemId);
      if (!deleted) return res.status(404).json({ error: "Ese artículo no existe en este servidor." });
      changed(guildId);
      const body: SuccessResponse = { success: true };
      res.json(body);
    } catch (error) {
      sendShopError(res, error, "No se pudo borrar el artículo.");
    }
  });
}
