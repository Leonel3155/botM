import { and, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import type { Guild, User } from 'discord.js';
import { db } from '../../db';
import { storage } from '../../storage';
import { pendingBets, userEconomy, userLevels, users } from '@shared/schema';
import { globalQueue, economyQueueFor } from './queues';
import { lockForUser } from './locks';
import { getTuning } from './extras';
import { DEFAULT_TUNING, streakBonusFraction, type GuildTuning } from '@shared/tuning';

// ===== Reglas generales =====
// Todos los cambios de saldo pasan por aquí: cada operación bloquea la fila del usuario
// (SELECT ... FOR UPDATE dentro de una transacción) o usa un UPDATE relativo, así que dos
// comandos al mismo tiempo nunca pueden gastar el mismo dinero dos veces.

// La columna es numeric(15,2) (hasta ~10 billones). Topamos cartera y banco en 1 billón.
export const MAX_COINS = 1_000_000_000_000;

// Montos, esperas y probabilidades se ajustan por servidor en el panel (Economía): ver shared/tuning.ts.
// Las funciones reciben esos ajustes; sin ellos usan DEFAULT_TUNING.

export type EconomyRow = typeof userEconomy.$inferSelect;
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

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
  // Fuera de la transacción: con la base integrada, otra consulta dentro de ella esperaría a que termine
  const startingBalance = String((await getTuning(guild.id)).startingBalance);

  // La tabla no tiene índice único (usuario, servidor): un candado consultivo evita crear dos filas
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`econ:${key}`}))`);
    const [existing] = await tx
      .select({ id: userEconomy.id })
      .from(userEconomy)
      .where(and(eq(userEconomy.guildId, guild.id), eq(userEconomy.userId, user.id)))
      .limit(1);
    if (!existing) {
      await tx.insert(userEconomy).values({ userId: user.id, guildId: guild.id, balance: startingBalance, bank: '0' });
    }
  });

  if (knownAccounts.size > 50_000) knownAccounts.clear();
  knownAccounts.add(key);
}

// Igual que ensureAccount pero para muchas personas a la vez (/add-money-role): en bloques de 500,
// con unas pocas consultas por bloque en vez de ~7 por persona. Usa los mismos candados consultivos
// que ensureAccount, así ninguno de los dos caminos puede crear una fila repetida.
export async function ensureAccounts(guild: Pick<Guild, 'id' | 'name' | 'ownerId'>, list: Pick<User, 'id' | 'username' | 'avatar'>[]): Promise<void> {
  // Sin repetidos (ON CONFLICT DO UPDATE no acepta la misma fila dos veces) y en orden fijo:
  // dos llamadas al mismo tiempo toman los candados en el mismo orden y no se bloquean mutuamente
  const pending = [...new Map(list.map((u) => [u.id, u])).values()]
    .filter((u) => !knownAccounts.has(`${guild.id}:${u.id}`))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (pending.length === 0) return;

  await storage.ensureGuild(guild.id, guild.name, guild.ownerId);
  const startingBalance = String((await getTuning(guild.id)).startingBalance);

  for (let i = 0; i < pending.length; i += 500) {
    const chunk = pending.slice(i, i + 500);
    const ids = chunk.map((u) => u.id);

    await db
      .insert(users)
      .values(chunk.map((u) => ({ id: u.id, username: u.username, avatar: u.avatar ?? null })))
      .onConflictDoUpdate({
        target: users.id,
        set: { username: sql`excluded.username`, avatar: sql`excluded.avatar` },
      });

    await db.transaction(async (tx) => {
      const keys = ids.map((id) => sql`(${`econ:${guild.id}:${id}`}::text)`);
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(t.k)) FROM (VALUES ${sql.join(keys, sql`, `)}) AS t(k)`);
      const existing = await tx
        .select({ userId: userEconomy.userId })
        .from(userEconomy)
        .where(and(eq(userEconomy.guildId, guild.id), inArray(userEconomy.userId, ids)));
      const have = new Set(existing.map((r) => r.userId));
      const missing = ids.filter((id) => !have.has(id));
      if (missing.length > 0) {
        await tx.insert(userEconomy).values(missing.map((id) => ({ userId: id, guildId: guild.id, balance: startingBalance, bank: '0' })));
      }
    });

    if (knownAccounts.size + ids.length > 50_000) knownAccounts.clear();
    for (const id of ids) knownAccounts.add(`${guild.id}:${id}`);
  }
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
  | { ok: true; reward: number; levelBonus: number; streakBonus: number; streak: number; streakLost: boolean; balance: number }
  | { ok: false; retryInMs: number };

// Bono por racha: +5 % por cada día seguido después del primero, hasta +50 % (11 días) con los valores
// predeterminados
export function streakBonusFor(reward: number, streak: number, tuning: GuildTuning = DEFAULT_TUNING): number {
  return Math.floor(reward * streakBonusFraction(tuning, streak));
}

export function dailyRewardFor(level: number, tuning: GuildTuning = DEFAULT_TUNING): { reward: number; levelBonus: number } {
  const levelBonus = Math.max(1, Math.floor(level)) * tuning.dailyPerLevel;
  return { reward: tuning.dailyBase + levelBonus, levelBonus };
}

export function dailyCooldownMs(tuning: GuildTuning = DEFAULT_TUNING): number {
  return tuning.dailyCooldownHours * 60 * 60 * 1000;
}

// Decide si se puede reclamar y cómo queda la racha (lógica pura, sin base de datos).
// La racha sigue si se cobra antes de que pase el doble de la espera (48 h con la espera de 24 h).
export function evaluateDaily(lastDaily: Date | null | undefined, currentStreak: number | null | undefined, now: number, cooldownMs = dailyCooldownMs()):
  | { ok: true; streak: number; streakLost: boolean }
  | { ok: false; retryInMs: number } {
  const last = lastDaily ? lastDaily.getTime() : null;
  if (last !== null && now - last < cooldownMs) {
    return { ok: false, retryInMs: last + cooldownMs - now };
  }
  const keepsStreak = last !== null && now - last <= cooldownMs * 2;
  const previous = currentStreak ?? 0;
  return {
    ok: true,
    streak: keepsStreak ? previous + 1 : 1,
    streakLost: !keepsStreak && previous > 0,
  };
}

export async function claimDaily(guildId: string, userId: string, tuning: GuildTuning = DEFAULT_TUNING): Promise<DailyResult> {
  const level = await getUserLevelNumber(guildId, userId);
  const { reward, levelBonus } = dailyRewardFor(level, tuning);

  return db.transaction(async (tx) => {
    const row = await lockAccount(tx, guildId, userId);
    const now = Date.now();
    const check = evaluateDaily(row.lastDaily, row.dailyStreak, now, dailyCooldownMs(tuning));
    if (!check.ok) return check;

    const streakBonus = streakBonusFor(reward, check.streak, tuning);
    const total = reward + streakBonus;
    const balance = clampCoins(toCoins(row.balance) + total);
    await saveAccount(tx, row, {
      balance,
      earned: total,
      dailyStreak: check.streak,
      lastDaily: new Date(now),
    });
    return { ok: true as const, reward: total, levelBonus, streakBonus, streak: check.streak, streakLost: check.streakLost, balance };
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

// Espera de cada acción según el panel (predeterminado: work 1 h, crime y slut 2 h, rob 4 h)
export function actionCooldownMs(kind: TimedKind | 'rob', tuning: GuildTuning = DEFAULT_TUNING): number {
  const minutes = {
    work: tuning.workCooldownMinutes,
    crime: tuning.crimeCooldownMinutes,
    slut: tuning.slutCooldownMinutes,
    rob: tuning.robCooldownMinutes,
  }[kind];
  return minutes * 60 * 1000;
}

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
  decide: (wallet: number) => TimedOutcome<T>,
  cooldown: number
): Promise<TimedResult<T>> {
  return db.transaction(async (tx) => {
    const row = await lockAccount(tx, guildId, userId);
    const now = Date.now();
    const last = row[lastField[kind]];
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


export type RobResult =
  | { ok: true; success: true; amount: number; robberBalance: number }
  | { ok: true; success: false; fine: number; robberBalance: number }
  | { ok: false; reason: 'cooldown'; retryInMs: number }
  | { ok: false; reason: 'target_poor' | 'robber_poor' };

// Cartera mínima de quien roba y de la víctima, probabilidad, multa y espera: todo sale del panel
export async function attemptRob(guildId: string, robberId: string, targetId: string, tuning: GuildTuning): Promise<RobResult> {
  if (robberId === targetId) throw new Error('attemptRob: no se puede robar a uno mismo');
  const cooldown = actionCooldownMs('rob', tuning);
  return db.transaction(async (tx) => {
    const [robber, target] = await lockPair(tx, guildId, robberId, targetId);
    const now = Date.now();
    if (robber.lastRob && now - robber.lastRob.getTime() < cooldown) {
      return { ok: false as const, reason: 'cooldown' as const, retryInMs: robber.lastRob.getTime() + cooldown - now };
    }

    const robberWallet = toCoins(robber.balance);
    const targetWallet = toCoins(target.balance);
    // A una cartera vacía no hay nada que robarle, aunque el mínimo sea 0
    if (targetWallet < Math.max(1, tuning.robMinWallet)) return { ok: false as const, reason: 'target_poor' as const };
    if (robberWallet < tuning.robMinWallet) return { ok: false as const, reason: 'robber_poor' as const };

    if (Math.random() * 100 < tuning.robSuccessPercent) {
      // Entre 50 y el 10 % de la cartera de la víctima (máx. 1,000), nunca más de lo que tiene
      const maxSteal = Math.min(Math.floor(targetWallet * 0.1), 1000);
      const wanted = 50 + Math.floor(Math.random() * Math.max(maxSteal - 50 + 1, 1));
      const amount = Math.min(wanted, targetWallet, MAX_COINS - robberWallet);
      await saveAccount(tx, target, { balance: targetWallet - amount, lost: amount });
      await saveAccount(tx, robber, { balance: robberWallet + amount, earned: amount, lastRob: new Date(now) });
      return { ok: true as const, success: true as const, amount, robberBalance: robberWallet + amount };
    }

    const fine = tuning.robFinePercent > 0
      ? Math.min(robberWallet, Math.max(1, Math.floor((robberWallet * tuning.robFinePercent) / 100)))
      : 0;
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
// La retención queda apuntada en pending_bets en la misma transacción: si el bot se apaga a mitad
// de la partida, refundPendingBets la devuelve a la cartera al volver.
// Con "todo" se apuesta la cartera completa, o `limits.max` si es menor (0 = sin máximo).
export async function holdBet(guildId: string, userId: string, request: AmountRequest, limits: { min: number; max: number } = { min: 1, max: 0 }): Promise<
  { ok: true; bet: number; balance: number; holdId: string } | { ok: false; reason: 'empty' | 'insufficient' | 'min'; available: number; min?: number }
> {
  return db.transaction(async (tx) => {
    const row = await lockAccount(tx, guildId, userId);
    const wallet = toCoins(row.balance);
    const bet = request.all ? (limits.max > 0 ? Math.min(wallet, limits.max) : wallet) : request.amount;
    if (wallet <= 0) return { ok: false as const, reason: 'empty' as const, available: wallet };
    if (bet > wallet) return { ok: false as const, reason: 'insufficient' as const, available: wallet };
    if (bet < limits.min) return { ok: false as const, reason: 'min' as const, available: wallet, min: limits.min };
    await saveAccount(tx, row, { balance: wallet - bet, gambled: bet });
    const [hold] = await tx
      .insert(pendingBets)
      .values({ guildId, userId, amount: String(bet), createdAt: new Date() })
      .returning({ id: pendingBets.id });
    return { ok: true as const, bet, balance: wallet - bet, holdId: hold.id };
  });
}

// Momento en que arrancó este proceso: las retenciones de antes son de partidas que se cortaron
const BOOTED_AT = new Date();

// Al arrancar el bot: devuelve las apuestas retenidas de partidas que quedaron a medias
export async function refundPendingBets(): Promise<void> {
  let holds: (typeof pendingBets.$inferSelect)[];
  try {
    holds = await db.select().from(pendingBets).where(lt(pendingBets.createdAt, BOOTED_AT));
  } catch (error) {
    console.error('[ECONOMÍA] No se pudieron revisar las apuestas pendientes:', error);
    return;
  }

  for (const hold of holds) {
    try {
      const refunded = await economyTask(hold.guildId, hold.userId, () => db.transaction(async (tx) => {
        // Borrarla y devolverla van juntas: si ya no está, alguien la pagó o devolvió antes
        const [removed] = await tx.delete(pendingBets).where(eq(pendingBets.id, hold.id)).returning({ amount: pendingBets.amount });
        if (!removed) return 0;
        const row = await lockAccount(tx, hold.guildId, hold.userId);
        const amount = toCoins(removed.amount);
        await saveAccount(tx, row, { balance: toCoins(row.balance) + amount });
        return amount;
      }));
      if (refunded > 0) {
        console.log(`[ECONOMÍA] Devolví ${formatCoins(refunded)} de una partida de blackjack cortada a ${hold.userId} en ${hold.guildId}.`);
      }
    } catch (error) {
      console.error(`[ECONOMÍA] No se pudo devolver la apuesta pendiente ${hold.id}:`, error);
    }
  }
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
export async function settleBet(guildId: string, userId: string, bet: number, payout: number, holdId?: string): Promise<number> {
  let bodyDone = false;
  try {
    return await db.transaction(async (tx) => {
      // La apuesta deja de estar retenida en el mismo momento en que se paga
      if (holdId) await tx.delete(pendingBets).where(eq(pendingBets.id, holdId));
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

// ===== Compras (tienda) =====

/** Lánzalo dentro de `apply` de spendFromWallet para cancelar la compra: no se cobra nada. */
export class PurchaseRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PurchaseRejected';
  }
}

export type PurchaseResult<T> =
  | { ok: true; balance: number; info: T }
  | { ok: false; reason: 'insufficient'; available: number }
  | { ok: false; reason: 'rejected'; message: string };

/**
 * Cobra `cost` de la cartera y, en la misma transacción, aplica lo comprado (`apply`). Si `apply` falla,
 * no se cobra. Úsalo dentro de economyTask.
 */
export async function spendFromWallet<T>(
  guildId: string,
  userId: string,
  cost: number,
  apply: (tx: Tx) => Promise<T>
): Promise<PurchaseResult<T>> {
  try {
    return await db.transaction(async (tx) => {
      const row = await lockAccount(tx, guildId, userId);
      const wallet = toCoins(row.balance);
      if (cost > wallet) return { ok: false as const, reason: 'insufficient' as const, available: wallet };
      const info = await apply(tx);
      await saveAccount(tx, row, { balance: wallet - cost });
      return { ok: true as const, balance: wallet - cost, info };
    });
  } catch (error) {
    if (error instanceof PurchaseRejected) return { ok: false, reason: 'rejected', message: error.message };
    throw error;
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

// Todo en una transacción: si un bloque falla no se paga a nadie, así repetir el comando no paga doble
export async function adminAddCoinsToMany(guildId: string, userIds: string[], amount: number): Promise<void> {
  const value = clampCoins(amount);
  await db.transaction(async (tx) => {
    for (let i = 0; i < userIds.length; i += 500) {
      const chunk = userIds.slice(i, i + 500);
      await tx
        .update(userEconomy)
        .set({ balance: sql`LEAST(COALESCE(${userEconomy.balance}, 0) + ${value}::numeric, ${MAX_COINS}::numeric)` })
        .where(and(eq(userEconomy.guildId, guildId), inArray(userEconomy.userId, chunk)));
    }
  });
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
