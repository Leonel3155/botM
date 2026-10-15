// Cumpleaños: cada quien guarda su fecha con /cumple guardar. A la hora elegida en el panel (zona horaria
// del servidor) el bot felicita en el canal elegido y, si hay rol de cumpleañero, lo da por 24 horas.
import type { Client, Guild } from 'discord.js';
import { and, eq, isNotNull, lt } from 'drizzle-orm';
import { birthdays, type Birthday, type GuildExtras } from '@shared/schema';
import { db } from '../../db';
import { getExtrasSafe } from './extras';
import { getGuildSettings } from './guildSettings';
import { resolveSendableChannel } from './channels';
import { checkGrantableRole } from './roles';
import { getLocalDateString, getZonedParts, resolveTimezone } from './timezone';

export const DEFAULT_BIRTHDAY_MESSAGE = '🎂 ¡Hoy es el cumpleaños de {usuarios}! Que pasen un día increíble. 🎉';
const ROLE_HOURS = 24;
const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
export const MONTH_NAMES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

export function isValidBirthday(month: number, day: number): boolean {
  return Number.isInteger(month) && Number.isInteger(day) && month >= 1 && month <= 12 && day >= 1 && day <= DAYS_IN_MONTH[month - 1];
}

export function formatBirthday(month: number, day: number): string {
  return `${day} de ${MONTH_NAMES[month - 1]}`;
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** ¿Se festeja hoy? Quien nació el 29 de febrero lo festeja el 28 en los años que no son bisiestos. */
export function celebratesOn(birthday: Pick<Birthday, 'month' | 'day'>, year: number, month: number, day: number): boolean {
  if (birthday.month === month && birthday.day === day) return true;
  return birthday.month === 2 && birthday.day === 29 && month === 2 && day === 28 && !isLeapYear(year);
}

export async function setBirthday(guildId: string, userId: string, month: number, day: number): Promise<void> {
  await db
    .insert(birthdays)
    .values({ guildId, userId, month, day })
    .onConflictDoUpdate({ target: [birthdays.guildId, birthdays.userId], set: { month, day } });
}

export async function removeBirthday(guildId: string, userId: string): Promise<boolean> {
  const rows = await db.delete(birthdays).where(and(eq(birthdays.guildId, guildId), eq(birthdays.userId, userId))).returning();
  return rows.length > 0;
}

export async function getBirthday(guildId: string, userId: string): Promise<Birthday | undefined> {
  const [row] = await db.select().from(birthdays).where(and(eq(birthdays.guildId, guildId), eq(birthdays.userId, userId)));
  return row;
}

export async function listBirthdays(guildId: string): Promise<Birthday[]> {
  return db.select().from(birthdays).where(eq(birthdays.guildId, guildId));
}

/** Días que faltan para el próximo cumpleaños (0 = hoy), contando desde la fecha local dada. */
export function daysUntil(birthday: Pick<Birthday, 'month' | 'day'>, year: number, month: number, day: number): number {
  const today = Date.UTC(year, month - 1, day);
  for (const y of [year, year + 1]) {
    let m = birthday.month;
    let d = birthday.day;
    if (m === 2 && d === 29 && !isLeapYear(y)) d = 28;
    const next = Date.UTC(y, m - 1, d);
    if (next >= today) return Math.round((next - today) / 86_400_000);
  }
  return 365;
}

export function renderBirthdayMessage(template: string | null, mentions: string[]): string {
  const list = mentions.length <= 1
    ? mentions.join('')
    : `${mentions.slice(0, -1).join(', ')} y ${mentions[mentions.length - 1]}`;
  const text = (template?.trim() || DEFAULT_BIRTHDAY_MESSAGE);
  return text.includes('{usuarios}') ? text.replaceAll('{usuarios}', list) : `${text} ${list}`;
}

async function removeExpiredRoles(guild: Guild, extras: GuildExtras) {
  const cutoff = new Date(Date.now() - ROLE_HOURS * 3_600_000);
  const expired = await db.select().from(birthdays)
    .where(and(eq(birthdays.guildId, guild.id), isNotNull(birthdays.roleGivenAt), lt(birthdays.roleGivenAt, cutoff)));
  for (const row of expired) {
    if (extras.birthdayRoleId) {
      const member = await guild.members.fetch(row.userId).catch(() => null);
      await member?.roles.remove(extras.birthdayRoleId, 'Terminó su día de cumpleaños').catch(() => undefined);
    }
    await db.update(birthdays).set({ roleGivenAt: null })
      .where(and(eq(birthdays.guildId, guild.id), eq(birthdays.userId, row.userId)));
  }
}

async function celebrateGuild(guild: Guild) {
  const extras = await getExtrasSafe(guild.id);
  await removeExpiredRoles(guild, extras);
  if (!extras.birthdaysEnabled || !extras.birthdayChannelId) return;

  const settings = await getGuildSettings(guild.id);
  const timezone = resolveTimezone(settings?.timezone);
  const now = new Date();
  const local = getZonedParts(now, timezone);
  if (local.hour < extras.birthdayHour) return;
  const today = getLocalDateString(now, timezone);

  const pending = (await listBirthdays(guild.id))
    .filter((row) => row.lastCelebrated !== today && celebratesOn(row, local.year, local.month, local.day));
  if (pending.length === 0) return;

  // Solo quienes siguen en el servidor
  const present: Birthday[] = [];
  for (const row of pending) {
    const member = guild.members.cache.get(row.userId) ?? await guild.members.fetch(row.userId).catch(() => null);
    if (member) present.push(row);
  }
  // Se marca antes de publicar: si el mensaje falla, no se repite cada minuto
  for (const row of pending) {
    await db.update(birthdays).set({ lastCelebrated: today })
      .where(and(eq(birthdays.guildId, guild.id), eq(birthdays.userId, row.userId)));
  }
  if (present.length === 0) return;

  const channel = resolveSendableChannel(guild, extras.birthdayChannelId);
  if (!channel.ok) {
    console.warn(`[CUMPLEAÑOS] ${guild.name}: no pude felicitar en el canal elegido (${channel.reason.replace(/\*\*/g, '')}).`);
  } else {
    const mentions = present.map((row) => `<@${row.userId}>`);
    await channel.channel.send({
      content: renderBirthdayMessage(extras.birthdayMessage, mentions).slice(0, 2000),
      allowedMentions: { users: present.map((row) => row.userId) },
    }).catch((error) => console.warn(`[CUMPLEAÑOS] ${guild.name}: no pude enviar la felicitación:`, error?.message ?? error));
  }

  const role = extras.birthdayRoleId ? checkGrantableRole(guild, extras.birthdayRoleId) : null;
  if (role && !role.ok) {
    console.warn(`[CUMPLEAÑOS] ${guild.name}: no puedo dar el rol de cumpleañero (${role.reason.replace(/\*\*/g, '')}).`);
  } else if (role?.ok) {
    for (const row of present) {
      const member = guild.members.cache.get(row.userId);
      const given = await member?.roles.add(role.role, '¡Es su cumpleaños!').then(() => true).catch(() => false);
      if (given) {
        await db.update(birthdays).set({ roleGivenAt: new Date() })
          .where(and(eq(birthdays.guildId, guild.id), eq(birthdays.userId, row.userId)));
      }
    }
  }
  console.log(`[CUMPLEAÑOS] ${guild.name}: felicité a ${present.length} persona(s).`);
}

let running = false;

/** Lo llama el programador cada minuto. */
export async function birthdayTick(client: Client): Promise<void> {
  if (running) return;
  running = true;
  try {
    for (const guild of client.guilds.cache.values()) {
      try {
        await celebrateGuild(guild);
      } catch (error) {
        console.error(`[CUMPLEAÑOS] Error en ${guild.name}:`, error);
      }
    }
  } finally {
    running = false;
  }
}
