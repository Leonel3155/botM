import type { GuildMember } from 'discord.js';
import { and, asc, count, eq, gte, isNull, or, sql } from 'drizzle-orm';
import { SHOP_LIMITS } from '@shared/api';
import { shopInventory, shopItems, type ShopItem } from '@shared/schema';
import { db } from '../../db';
import { ensureAccount, economyTask, MAX_COINS, PurchaseRejected, spendFromWallet, type PurchaseResult, type Tx } from './economy';
import { checkGrantableRole } from './roles';

export interface ShopItemInput {
  name: string;
  description: string | null;
  emoji: string | null;
  price: number;
  roleId: string | null;
  stock: number | null;
  enabled: boolean;
}

export class ShopItemLimitError extends Error {
  constructor(public readonly limit: number) {
    super(`La tienda ya tiene el máximo de ${limit} artículos. Borra alguno antes de crear otro.`);
    this.name = 'ShopItemLimitError';
  }
}

export class ShopItemNameTakenError extends Error {
  constructor(name: string) {
    super(`Ya hay un artículo que se llama "${name}". Elige otro nombre.`);
    this.name = 'ShopItemNameTakenError';
  }
}

function isUniqueViolation(error: unknown): boolean {
  const code = (error as { code?: unknown; cause?: { code?: unknown } } | null);
  return code?.code === '23505' || code?.cause?.code === '23505';
}

/** "🎟️ Boleto VIP" (con el emoji si tiene). */
export function itemLabel(item: Pick<ShopItem, 'name' | 'emoji'>): string {
  return item.emoji ? `${item.emoji} ${item.name}` : item.name;
}

// ===== Artículos =====

export function listShopItems(guildId: string, options: { enabledOnly?: boolean } = {}): Promise<ShopItem[]> {
  const where = options.enabledOnly
    ? and(eq(shopItems.guildId, guildId), eq(shopItems.enabled, true))
    : eq(shopItems.guildId, guildId);
  return db.select().from(shopItems).where(where).orderBy(asc(shopItems.price), asc(shopItems.name));
}

export async function getShopItem(guildId: string, itemId: string): Promise<ShopItem | undefined> {
  const [item] = await db
    .select()
    .from(shopItems)
    .where(and(eq(shopItems.guildId, guildId), eq(shopItems.id, itemId)));
  return item;
}

/** El nombre no se puede repetir (sin distinguir mayúsculas), para que /comprar no sea ambiguo. */
async function nameTaken(tx: Tx, guildId: string, name: string, exceptId?: string): Promise<boolean> {
  const rows = await tx
    .select({ id: shopItems.id })
    .from(shopItems)
    .where(and(eq(shopItems.guildId, guildId), sql`lower(${shopItems.name}) = lower(${name})`));
  return rows.some((row) => row.id !== exceptId);
}

export async function createShopItem(guildId: string, input: ShopItemInput): Promise<ShopItem> {
  return db.transaction(async (tx) => {
    // Dos altas a la vez no se saltan el límite ni repiten nombre
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`shop_items:${guildId}`}))`);
    const [{ total }] = await tx.select({ total: count() }).from(shopItems).where(eq(shopItems.guildId, guildId));
    if (total >= SHOP_LIMITS.maxItemsPerGuild) throw new ShopItemLimitError(SHOP_LIMITS.maxItemsPerGuild);
    if (await nameTaken(tx, guildId, input.name)) throw new ShopItemNameTakenError(input.name);
    const [item] = await tx.insert(shopItems).values({ guildId, ...input }).returning();
    return item;
  });
}

export async function updateShopItem(guildId: string, itemId: string, patch: Partial<ShopItemInput>): Promise<ShopItem | undefined> {
  if (Object.keys(patch).length === 0) return getShopItem(guildId, itemId);
  try {
    return await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`shop_items:${guildId}`}))`);
      if (patch.name !== undefined && await nameTaken(tx, guildId, patch.name, itemId)) {
        throw new ShopItemNameTakenError(patch.name);
      }
      const [item] = await tx
        .update(shopItems)
        .set(patch)
        .where(and(eq(shopItems.guildId, guildId), eq(shopItems.id, itemId)))
        .returning();
      return item;
    });
  } catch (error) {
    if (isUniqueViolation(error) && patch.name) throw new ShopItemNameTakenError(patch.name);
    throw error;
  }
}

/** Borra el artículo y lo que la gente tenía de él (los roles ya dados se quedan). */
export async function deleteShopItem(guildId: string, itemId: string): Promise<boolean> {
  const rows = await db
    .delete(shopItems)
    .where(and(eq(shopItems.guildId, guildId), eq(shopItems.id, itemId)))
    .returning({ id: shopItems.id });
  return rows.length > 0;
}

// ===== Compras =====

export type BuyResult =
  | PurchaseResult<ShopItem>
  | { ok: false; reason: 'unavailable' | 'has_role' | 'too_expensive' }
  | { ok: false; reason: 'role_problem'; message: string };

export async function buyShopItem(member: GuildMember, itemId: string, requested: number): Promise<BuyResult & { quantity: number }> {
  const guild = member.guild;
  const item = await getShopItem(guild.id, itemId);
  if (!item || !item.enabled) return { ok: false, reason: 'unavailable', quantity: 0 };

  // Un artículo con rol se compra una sola vez
  const quantity = item.roleId ? 1 : Math.min(Math.max(Math.floor(requested), 1), SHOP_LIMITS.maxPerPurchase);
  let role = null;
  if (item.roleId) {
    const check = checkGrantableRole(guild, item.roleId);
    if (!check.ok) return { ok: false, reason: 'role_problem', message: check.reason, quantity };
    if (member.roles.cache.has(check.role.id)) return { ok: false, reason: 'has_role', quantity };
    role = check.role;
  }

  const cost = item.price * quantity;
  if (!Number.isSafeInteger(cost) || cost > MAX_COINS) return { ok: false, reason: 'too_expensive', quantity };

  await ensureAccount(guild, member.user);
  const result = await economyTask(guild.id, member.id, () =>
    spendFromWallet(guild.id, member.id, cost, async (tx) => {
      // Se descuenta la existencia solo si hay suficiente y el artículo sigue igual (activo y con el mismo precio)
      const [updated] = await tx
        .update(shopItems)
        .set({
          stock: sql`case when ${shopItems.stock} is null then null else ${shopItems.stock} - ${quantity} end`,
          sold: sql`${shopItems.sold} + ${quantity}`,
        })
        .where(and(
          eq(shopItems.id, item.id),
          eq(shopItems.guildId, guild.id),
          eq(shopItems.enabled, true),
          eq(shopItems.price, item.price),
          or(isNull(shopItems.stock), gte(shopItems.stock, quantity)),
        ))
        .returning();
      if (!updated) {
        throw new PurchaseRejected('Ya no quedan suficientes unidades o el artículo acaba de cambiar. Revisa `/tienda` y vuelve a intentarlo.');
      }

      if (role) {
        // Dentro de la transacción: si Discord no deja dar el rol, no se cobra
        try {
          await member.roles.add(role, `Compra en la tienda: ${item.name}`);
        } catch (error) {
          console.error(`[TIENDA] No se pudo dar el rol ${role.name} en ${guild.name}:`, error);
          throw new PurchaseRejected('No pude darte el rol, así que no te cobré nada. Avísale a un admin.');
        }
      } else {
        await tx
          .insert(shopInventory)
          .values({ guildId: guild.id, userId: member.id, itemId: item.id, quantity })
          .onConflictDoUpdate({
            target: [shopInventory.guildId, shopInventory.userId, shopInventory.itemId],
            set: { quantity: sql`${shopInventory.quantity} + ${quantity}`, updatedAt: new Date() },
          });
      }
      return updated;
    })
  );
  return { ...result, quantity };
}

export interface InventoryEntry {
  item: ShopItem;
  quantity: number;
}

export async function getInventory(guildId: string, userId: string): Promise<InventoryEntry[]> {
  const rows = await db
    .select({ item: shopItems, quantity: shopInventory.quantity })
    .from(shopInventory)
    .innerJoin(shopItems, eq(shopItems.id, shopInventory.itemId))
    .where(and(eq(shopInventory.guildId, guildId), eq(shopInventory.userId, userId), gte(shopInventory.quantity, 1)))
    .orderBy(asc(shopItems.name));
  return rows;
}
