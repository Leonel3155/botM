import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Guild, User } from 'discord.js';
import { db } from '../../db';
import { storage } from '../../storage';
import { userEconomy, userLevels } from '@shared/schema';
import { globalQueue, economyQueueFor } from './queues';
import { lockForUser } from './locks';

// ===== Reglas generales =====
// Todos los cambios de saldo pasan por aquí: cada operación bloquea la fila del usuario
// (SELECT ... FOR UPDATE dentro de una transacción) o usa un UPDATE relativo, así que dos
// comandos al mismo tiempo nunca pueden gastar el mismo dinero dos veces.

// La columna es numeric(15,2) (hasta ~10 billones). Topamos cartera y banco en 1 billón.
export const MAX_COINS = 1_000_000_000_000;

export const DAILY_COOLDOWN_MS = 24 * 60 * 60 * 1000;
// Si pasan más de 48 h desde el último daily, la racha vuelve a empezar
export const DAILY_STREAK_WINDOW_MS = 48 * 60 * 60 * 1000;
export const DAILY_BASE_REWARD = 500;
export const DAILY_REWARD_PER_LEVEL = 10;

export type EconomyRow = typeof userEconomy.$inferSelect;
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// ===== Utilidades =====

export function toCoins(value: string | number | null | undefined): number {
  const n = typeof value === 'number' ? value : parseFloat(value ?? '0');
  return Number.isFinite(n) ? Math.floor(n) : 0;
}

function clampCoins(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(Math.max(Math.floor(n), 0), MAX_COINS);
}

export function formatCoins(n: number): string {
  const value = Math.floor(n);
  return `${value.toLocaleString('es-MX')} ${Math.abs(value) === 1 ? 'moneda' : 'monedas'}`;
}

// Cantidad escrita por el usuario: un entero positivo ("1500", "1,500", "1.500") o "todo"/"all"
export type AmountRequest = { all: true } | { all: false; amount: number };

export function parseAmount(raw: string | null | undefined): AmountRequest | null {
  if (!raw) return null;
  const text = raw.trim().toLowerCase().replace(/\s+/g, '');
  if (['all', 'todo', 'todos', 'toda'].includes(text)) return { all: true };

  let digits: string;
  if (/^\d+$/.test(text)) digits = text;
  else if (/^\d{1,3}([.,]\d{3})+$/.test(text)) digits = text.replace(/[.,]/g, '');
  else return null;

  const amount = Number(digits);
  if (!Number.isSafeInteger(amount) || amount <= 0) return null;
  return { all: false, amount };
}

export const AMOUNT_HINT = 'Escribe un número entero positivo (por ejemplo `500`) o `todo`.';

// Serializa las operaciones económicas: cola global → cola del servidor → candado del usuario.
// Sin límite de tiempo a propósito (timeout: undefined anula los 120 s de la cola global): ese límite
// solo rechaza la promesa, no cancela la transacción, que seguiría en la cola y se aplicaría después de
// decirle al usuario que hubo un error (o dos veces si alguien reintenta). Así, la promesa termina
// únicamente cuando la base de datos confirmó o descartó el cambio.
export function economyTask<T>(guildId: string, userId: string, fn: () => Promise<T>): Promise<T> {
  return globalQueue.add(
    () => economyQueueFor(guildId).add(
      () => lockForUser(`${guildId}:${userId}`).runExclusive(fn),
      { timeout: undefined, throwOnTimeout: true }
    ),
    { timeout: undefined, throwOnTimeout: true }
  );
}

// ===== Cuentas =====

// Cuentas que ya sabemos que existen (evita consultas repetidas)
const knownAccounts = new Set<string>();

// Crea (si falta) el servidor, el usuario y su cuenta económica. Las claves foráneas lo exigen.
export async function ensureAccount(guild: Pick<Guild, 'id' | 'name' | 'ownerId'>, user: Pick<User, 'id' | 'username' | 'avatar'>): Promise<void> {
  const key = `${guild.id}:${user.id}`;
  if (knownAccounts.has(key)) return;

  await storage.ensureGuild(guild.id, guild.name, guild.ownerId);
  await storage.upsertUser({ id: user.id, username: user.username, avatar: user.avatar ?? null });

  // La tabla no tiene índice único (usuario, servidor): un candado consultivo evita crear dos filas
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`econ:${key}`}))`);
    const [existing] = await tx
      .select({ id: userEconomy.id })
      .from(userEconomy)
      .where(and(eq(userEconomy.guildId, guild.id), eq(userEconomy.userId, user.id)))
      .limit(1);
    if (!existing) {
      await tx.insert(userEconomy).values({ userId: user.id, guildId: guild.id, balance: '0', bank: '0' });
    }
  });

  if (knownAccounts.size > 50_000) knownAccounts.clear();
  knownAccounts.add(key);
}

function accountWhere(guildId: string, userId: string) {
  return and(eq(userEconomy.guildId, guildId), eq(userEconomy.userId, userId));
}

// Lee la cuenta sin bloquearla (para mostrar datos)
export async function getAccount(guildId: string, userId: string): Promise<EconomyRow | undefined> {
  const [row] = await db
    .select()
    .from(userEconomy)
    .where(accountWhere(guildId, userId))
    .orderBy(userEconomy.id)
    .limit(1);
  return row;
}

// Bloquea la fila hasta el final de la transacción
async function lockAccount(tx: Tx, guildId: string, userId: string): Promise<EconomyRow> {
  const [row] = await tx
    .select()
    .from(userEconomy)
    .where(accountWhere(guildId, userId))
    .orderBy(userEconomy.id)
    .limit(1)
    .for('update');
  if (!row) {
    // Se olvida de la caché para que el próximo comando vuelva a crear la cuenta
    knownAccounts.delete(`${guildId}:${userId}`);
    throw new Error(`No existe la cuenta económica ${guildId}:${userId} (falta ensureAccount)`);
  }
  return row;
}

interface AccountPatch {
  balance?: number;
  bank?: number;
  earned?: number;   // suma a totalEarned
  lost?: number;     // suma a totalLost
  gambled?: number;  // suma a totalGambled
  win?: number;      // candidato a biggestWin
  dailyStreak?: number;
  lastDaily?: Date;
  lastWork?: Date;
  lastCrime?: Date;
  lastSlut?: Date;
  lastRob?: Date;
}

async function saveAccount(tx: Tx, row: EconomyRow, patch: AccountPatch): Promise<void> {
  const set: Partial<typeof userEconomy.$inferInsert> = {};
  if (patch.balance !== undefined) set.balance = String(clampCoins(patch.balance));
  if (patch.bank !== undefined) set.bank = String(clampCoins(patch.bank));
  if (patch.earned) set.totalEarned = String(clampCoins(toCoins(row.totalEarned) + patch.earned));
  if (patch.lost) set.totalLost = String(clampCoins(toCoins(row.totalLost) + patch.lost));
  if (patch.gambled) set.totalGambled = String(clampCoins(toCoins(row.totalGambled) + patch.gambled));
  if (patch.win && patch.win > toCoins(row.biggestWin)) set.biggestWin = String(clampCoins(patch.win));
  if (patch.dailyStreak !== undefined) set.dailyStreak = patch.dailyStreak;
  if (patch.lastDaily) set.lastDaily = patch.lastDaily;
  if (patch.lastWork) set.lastWork = patch.lastWork;
  if (patch.lastCrime) set.lastCrime = patch.lastCrime;
  if (patch.lastSlut) set.lastSlut = patch.lastSlut;
  if (patch.lastRob) set.lastRob = patch.lastRob;
  if (Object.keys(set).length === 0) return;
  await tx.update(userEconomy).set(set).where(eq(userEconomy.id, row.id));
}

async function getUserLevelNumber(guildId: string, userId: string): Promise<number> {
  const [row] = await db
    .select({ level: userLevels.level })
    .from(userLevels)
    .where(and(eq(userLevels.guildId, guildId), eq(userLevels.userId, userId)))
    .orderBy(desc(userLevels.level))
    .limit(1);
  return row?.level ?? 1;
}

// ===== Recompensa diaria (la usan /daily y &daily) =====

export type DailyResult =
  | { ok: true; reward: number; levelBonus: number; streak: number; streakLost: boolean; balance: number }
  | { ok: false; retryInMs: number };

export function dailyRewardFor(level: number): { reward: number; levelBonus: number } {
  const levelBonus = Math.max(1, Math.floor(level)) * DAILY_REWARD_PER_LEVEL;
  return { reward: DAILY_BASE_REWARD + levelBonus, levelBonus };
}

// Decide si se puede reclamar y cómo queda la racha (lógica pura, sin base de datos)
export function evaluateDaily(lastDaily: Date | null | undefined, currentStreak: number | null | undefined, now: number):
  | { ok: true; streak: number; streakLost: boolean }
  | { ok: false; retryInMs: number } {
  const last = lastDaily ? lastDaily.getTime() : null;
  if (last !== null && now - last < DAILY_COOLDOWN_MS) {
    return { ok: false, retryInMs: last + DAILY_COOLDOWN_MS - now };
  }
  const keepsStreak = last !== null && now - last <= DAILY_STREAK_WINDOW_MS;
  const previous = currentStreak ?? 0;
  return {
    ok: true,
    streak: keepsStreak ? previous + 1 : 1,
    streakLost: !keepsStreak && previous > 0,
  };
}

export async function claimDaily(guildId: string, userId: string): Promise<DailyResult> {
  const level = await getUserLevelNumber(guildId, userId);
  const { reward, levelBonus } = dailyRewardFor(level);

  return db.transaction(async (tx) => {
    const row = await lockAccount(tx, guildId, userId);
    const now = Date.now();
    const check = evaluateDaily(row.lastDaily, row.dailyStreak, now);
    if (!check.ok) return check;

    const balance = clampCoins(toCoins(row.balance) + reward);
    await saveAccount(tx, row, {
      balance,
      earned: reward,
      dailyStreak: check.streak,
      lastDaily: new Date(now),
    });
    return { ok: true as const, reward, levelBonus, streak: check.streak, streakLost: check.streakLost, balance };
  });
}

// ===== Banco =====

export type BankResult =
  | { ok: true; amount: number; balance: number; bank: number }
  | { ok: false; reason: 'empty' | 'insufficient' | 'full'; available: number };

async function moveCoins(guildId: string, userId: string, request: AmountRequest, direction: 'deposit' | 'withdraw'): Promise<BankResult> {
  return db.transaction(async (tx) => {
    const row = await lockAccount(tx, guildId, userId);
    const wallet = toCoins(row.balance);
    const bank = toCoins(row.bank);
    const from = direction === 'deposit' ? wallet : bank;
    const to = direction === 'deposit' ? bank : wallet;

    const amount = request.all ? from : request.amount;
    if (from <= 0) return { ok: false as const, reason: 'empty' as const, available: from };
    if (amount > from) return { ok: false as const, reason: 'insufficient' as const, available: from };
    if (to + amount > MAX_COINS) return { ok: false as const, reason: 'full' as const, available: from };

    const newFrom = from - amount;
    const newTo = to + amount;
    const balance = direction === 'deposit' ? newFrom : newTo;
    const newBank = direction === 'deposit' ? newTo : newFrom;
    await saveAccount(tx, row, { balance, bank: newBank });
    return { ok: true as const, amount, balance, bank: newBank };
  });
}

export function deposit(guildId: string, userId: string, request: AmountRequest) {
  return moveCoins(guildId, userId, request, 'deposit');
}

export function withdraw(guildId: string, userId: string, request: AmountRequest) {
  return moveCoins(guildId, userId, request, 'withdraw');
}

// ===== Transferencias =====

export type TransferResult =
  | { ok: true; fromBalance: number }
  | { ok: false; reason: 'insufficient' | 'receiver_full'; available: number };

// Bloquea dos cuentas siempre en el mismo orden para que nunca se bloqueen mutuamente
async function lockPair(tx: Tx, guildId: string, a: string, b: string): Promise<[EconomyRow, EconomyRow]> {
  if (a < b) {
    const rowA = await lockAccount(tx, guildId, a);
    const rowB = await lockAccount(tx, guildId, b);
    return [rowA, rowB];
  }
  const rowB = await lockAccount(tx, guildId, b);
  const rowA = await lockAccount(tx, guildId, a);
  return [rowA, rowB];
}

export async function transfer(guildId: string, fromId: string, toId: string, amount: number): Promise<TransferResult> {
  if (fromId === toId) throw new Error('transfer: origen y destino iguales');
  return db.transaction(async (tx) => {
    const [from, to] = await lockPair(tx, guildId, fromId, toId);
    const fromBalance = toCoins(from.balance);
    if (amount > fromBalance) return { ok: false as const, reason: 'insufficient' as const, available: fromBalance };
    const toBalance = toCoins(to.balance);
    if (toBalance + amount > MAX_COINS) return { ok: false as const, reason: 'receiver_full' as const, available: fromBalance };

    await saveAccount(tx, from, { balance: fromBalance - amount });
    await saveAccount(tx, to, { balance: toBalance + amount });
    return { ok: true as const, fromBalance: fromBalance - amount };
  });
}

// ===== Acciones con tiempo de espera (/work, /crime, /slut) =====

export type TimedKind = 'work' | 'crime' | 'slut';

export const COOLDOWNS_MS: Record<TimedKind | 'rob', number> = {
  work: 60 * 60 * 1000,        // 1 hora
  crime: 2 * 60 * 60 * 1000,   // 2 horas
  slut: 2 * 60 * 60 * 1000,    // 2 horas
  rob: 4 * 60 * 60 * 1000,     // 4 horas
};

const lastField: Record<TimedKind, 'lastWork' | 'lastCrime' | 'lastSlut'> = {
  work: 'lastWork',
  crime: 'lastCrime',
  slut: 'lastSlut',
};

// delta > 0 gana monedas, delta < 0 pierde (nunca baja de 0). blocked = no se puede jugar (no consume la espera)
export type TimedOutcome<T> = { delta: number; info: T } | { blocked: string };

export type TimedResult<T> =
  | { ok: true; delta: number; balance: number; info: T }
  | { ok: false; retryInMs: number }
  | { ok: false; blocked: string };

export async function runTimedAction<T>(
  guildId: string,
  userId: string,
  kind: TimedKind,
  decide: (wallet: number) => TimedOutcome<T>
): Promise<TimedResult<T>> {
  return db.transaction(async (tx) => {
    const row = await lockAccount(tx, guildId, userId);
    const now = Date.now();
    const last = row[lastField[kind]];
    const cooldown = COOLDOWNS_MS[kind];
    if (last && now - last.getTime() < cooldown) {
      return { ok: false as const, retryInMs: last.getTime() + cooldown - now };
    }

    const wallet = toCoins(row.balance);
    const outcome = decide(wallet);
    if ('blocked' in outcome) return { ok: false as const, blocked: outcome.blocked };

    const raw = Math.trunc(outcome.delta);
    const delta = raw < 0 ? -Math.min(-raw, wallet) : Math.min(raw, MAX_COINS - wallet);
    const balance = wallet + delta;
    const patch: AccountPatch = {
      balance,
      earned: delta > 0 ? delta : 0,
      lost: delta < 0 ? -delta : 0,
    };
    patch[lastField[kind]] = new Date(now);
    await saveAccount(tx, row, patch);
    return { ok: true as const, delta, balance, info: outcome.info };
  });
}

// ===== Robo =====

export const ROB_MIN_TARGET = 100;
export const ROB_MIN_ROBBER = 100;
export const ROB_SUCCESS_CHANCE = 0.6;
export const ROB_FINE_RATE = 0.05;

export type RobResult =
  | { ok: true; success: true; amount: number; robberBalance: number }
  | { ok: true; success: false; fine: number; robberBalance: number }
  | { ok: false; reason: 'cooldown'; retryInMs: number }
  | { ok: false; reason: 'target_poor' | 'robber_poor' };

export async function attemptRob(guildId: string, robberId: string, targetId: string): Promise<RobResult> {
  if (robberId === targetId) throw new Error('attemptRob: no se puede robar a uno mismo');
  return db.transaction(async (tx) => {
    const [robber, target] = await lockPair(tx, guildId, robberId, targetId);
    const now = Date.now();
    if (robber.lastRob && now - robber.lastRob.getTime() < COOLDOWNS_MS.rob) {
      return { ok: false as const, reason: 'cooldown' as const, retryInMs: robber.lastRob.getTime() + COOLDOWNS_MS.rob - now };
    }

    const robberWallet = toCoins(robber.balance);
    const targetWallet = toCoins(target.balance);
    if (targetWallet < ROB_MIN_TARGET) return { ok: false as const, reason: 'target_poor' as const };
    if (robberWallet < ROB_MIN_ROBBER) return { ok: false as const, reason: 'robber_poor' as const };

    if (Math.random() < ROB_SUCCESS_CHANCE) {
      // Entre 50 y el 10 % de la cartera de la víctima (máx. 1,000), nunca más de lo que tiene
      const maxSteal = Math.min(Math.floor(targetWallet * 0.1), 1000);
      const wanted = 50 + Math.floor(Math.random() * Math.max(maxSteal - 50 + 1, 1));
      const amount = Math.min(wanted, targetWallet, MAX_COINS - robberWallet);
      await saveAccount(tx, target, { balance: targetWallet - amount, lost: amount });
      await saveAccount(tx, robber, { balance: robberWallet + amount, earned: amount, lastRob: new Date(now) });
      return { ok: true as const, success: true as const, amount, robberBalance: robberWallet + amount };
    }

    const fine = Math.max(1, Math.floor(robberWallet * ROB_FINE_RATE));
    await saveAccount(tx, robber, { balance: robberWallet - fine, lost: fine, lastRob: new Date(now) });
    return { ok: true as const, success: false as const, fine, robberBalance: robberWallet - fine };
  });
}

// ===== Apuestas =====

export type BetResult<T> =
  | { ok: true; bet: number; payout: number; net: number; balance: number; info: T }
  | { ok: false; reason: 'empty' | 'insufficient' | 'min'; available: number; min?: number };

// Juego instantáneo: cobra la apuesta y paga el premio en la misma transacción.
// resolve recibe la apuesta y devuelve cuánto se le entrega al jugador (0 = pierde todo).
export async function playInstantBet<T>(
  guildId: string,
  userId: string,
  request: AmountRequest,
  resolve: (bet: number) => { payout: number; info: T },
  minBet = 1
): Promise<BetResult<T>> {
  return db.transaction(async (tx) => {
    const row = await lockAccount(tx, guildId, userId);
    const wallet = toCoins(row.balance);
    const bet = request.all ? wallet : request.amount;
    if (wallet <= 0) return { ok: false as const, reason: 'empty' as const, available: wallet };
    if (bet > wallet) return { ok: false as const, reason: 'insufficient' as const, available: wallet };
    if (bet < minBet) return { ok: false as const, reason: 'min' as const, available: wallet, min: minBet };

    const { payout: rawPayout, info } = resolve(bet);
    const afterBet = wallet - bet;
    const payout = Math.min(Math.max(Math.floor(rawPayout), 0), MAX_COINS - afterBet);
    const net = payout - bet;
    const balance = afterBet + payout;
    await saveAccount(tx, row, {
      balance,
      gambled: bet,
      earned: net > 0 ? net : 0,
      lost: net < 0 ? -net : 0,
      win: net,
    });
    return { ok: true as const, bet, payout, net, balance, info };
  });
}

// Juegos con varios pasos (blackjack): primero se retiene la apuesta…
export async function holdBet(guildId: string, userId: string, request: AmountRequest): Promise<
  { ok: true; bet: number; balance: number } | { ok: false; reason: 'empty' | 'insufficient'; available: number }
> {
  return db.transaction(async (tx) => {
    const row = await lockAccount(tx, guildId, userId);
    const wallet = toCoins(row.balance);
    const bet = request.all ? wallet : request.amount;
    if (wallet <= 0) return { ok: false as const, reason: 'empty' as const, available: wallet };
    if (bet > wallet) return { ok: false as const, reason: 'insufficient' as const, available: wallet };
    await saveAccount(tx, row, { balance: wallet - bet, gambled: bet });
    return { ok: true as const, bet, balance: wallet - bet };
  });
}

// Falla al pagar una apuesta retenida. safeToRetry = true solo cuando es seguro que no se guardó nada.
export class SettleError extends Error {
  constructor(public readonly safeToRetry: boolean, cause: unknown) {
    super(safeToRetry ? 'settleBet: la transacción no se aplicó' : 'settleBet: no se sabe si la transacción se aplicó', { cause });
    this.name = 'SettleError';
  }
}

// Error que PostgreSQL devolvió al rechazar una orden (no un corte de conexión): trae severidad y SQLSTATE
function isStatementRejected(error: unknown): boolean {
  const e = error as { severity?: unknown; code?: unknown } | null;
  return !!e && e.severity === 'ERROR' && typeof e.code === 'string';
}

// …y al terminar se paga lo que corresponda (0 si perdió). Devuelve el saldo final.
// Si falla lanza SettleError, que dice si se puede reintentar sin riesgo de pagar dos veces:
//  - si el cuerpo de la transacción no terminó, nunca se envió COMMIT (drizzle hace ROLLBACK): no se aplicó;
//  - si el cuerpo terminó, el fallo vino del COMMIT: solo es seguro si PostgreSQL lo rechazó con un ERROR.
//    Un corte de conexión en ese momento deja la duda (pudo confirmarse), así que no se reintenta.
export async function settleBet(guildId: string, userId: string, bet: number, payout: number): Promise<number> {
  let bodyDone = false;
  try {
    return await db.transaction(async (tx) => {
      const row = await lockAccount(tx, guildId, userId);
      const wallet = toCoins(row.balance);
      const paid = Math.min(Math.max(Math.floor(payout), 0), MAX_COINS - wallet);
      const net = paid - bet;
      await saveAccount(tx, row, {
        balance: wallet + paid,
        earned: net > 0 ? net : 0,
        lost: net < 0 ? -net : 0,
        win: net,
      });
      bodyDone = true;
      return wallet + paid;
    });
  } catch (error) {
    throw new SettleError(!bodyDone || isStatementRejected(error), error);
  }
}

// ===== Recompensas por actividad (mensajes / subir de nivel) =====

// UPDATE relativo: no pisa cambios hechos al mismo tiempo por un comando
export async function grantActivityRewards(guildId: string, userId: string, coins: number, tickets: number): Promise<void> {
  const amount = clampCoins(coins);
  await db
    .update(userEconomy)
    .set({
      balance: sql`LEAST(COALESCE(${userEconomy.balance}, 0) + ${amount}::numeric, ${MAX_COINS}::numeric)`,
      totalEarned: sql`LEAST(COALESCE(${userEconomy.totalEarned}, 0) + ${amount}::numeric, ${MAX_COINS}::numeric)`,
      lotteryTickets: sql`LEAST(COALESCE(${userEconomy.lotteryTickets}, 0) + ${Math.max(0, Math.floor(tickets))}, 2000000000)`,
    })
    .where(accountWhere(guildId, userId));
}

export async function getPrestigeLevel(guildId: string, userId: string): Promise<number> {
  const row = await getAccount(guildId, userId);
  return row?.prestigeLevel ?? 0;
}

// ===== Administración =====

export async function adminAddCoins(guildId: string, userId: string, amount: number): Promise<number> {
  return db.transaction(async (tx) => {
    const row = await lockAccount(tx, guildId, userId);
    const balance = clampCoins(toCoins(row.balance) + amount);
    await saveAccount(tx, row, { balance });
    return balance;
  });
}

export async function adminRemoveCoins(guildId: string, userId: string, request: AmountRequest): Promise<{ removed: number; balance: number }> {
  return db.transaction(async (tx) => {
    const row = await lockAccount(tx, guildId, userId);
    const wallet = toCoins(row.balance);
    const removed = request.all ? wallet : Math.min(request.amount, wallet);
    await saveAccount(tx, row, { balance: wallet - removed });
    return { removed, balance: wallet - removed };
  });
}

export async function adminResetAccount(guildId: string, userId: string): Promise<void> {
  await db
    .update(userEconomy)
    .set({ balance: '0', bank: '0' })
    .where(accountWhere(guildId, userId));
}

export async function adminAddCoinsToMany(guildId: string, userIds: string[], amount: number): Promise<void> {
  const value = clampCoins(amount);
  for (let i = 0; i < userIds.length; i += 500) {
    const chunk = userIds.slice(i, i + 500);
    await db
      .update(userEconomy)
      .set({ balance: sql`LEAST(COALESCE(${userEconomy.balance}, 0) + ${value}::numeric, ${MAX_COINS}::numeric)` })
      .where(and(eq(userEconomy.guildId, guildId), inArray(userEconomy.userId, chunk)));
  }
}

// ===== Rankings y estadísticas =====
// Salen de storage, igual que en el panel: una cuenta por persona, la misma que leen y modifican
// getAccount / lockAccount (la de menor id si hubiera filas repetidas). Así /balance, /leaderboard,
// /economy-stats y el panel siempre muestran los mismos números.

export async function topByWealth(guildId: string, limit: number): Promise<{ userId: string; total: number }[]> {
  const rows = await storage.getWealthLeaderboard(guildId, limit);
  return rows.map((r) => ({ userId: r.userId, total: toCoins(r.total) }));
}

export async function economyStats(guildId: string): Promise<{ accounts: number; withMoney: number; cash: number; bank: number }> {
  const totals = await storage.getEconomyTotals(guildId);
  return {
    accounts: totals.accounts,
    withMoney: totals.withMoney,
    cash: toCoins(totals.wallet),
    bank: toCoins(totals.bank),
  };
}
