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
// Mínimo de días entre un festejo y el siguiente: así volver a guardar la fecha de hoy (o borrarla y guardarla
// otra vez) no da felicitación y rol cada día
const CELEBRATE_GAP_DAYS = 300;
const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
export const MONTH_NAMES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** Un cumpleaños con fecha (quien lo borró se queda un tiempo sin fecha, solo con cuándo se le festejó). */
export type SavedBirthday = Birthday & { month: number; day: number };
type BirthdayDate = { month: number; day: number };

function hasDate(row: Birthday): row is SavedBirthday {
  return row.month !== null && row.day !== null;
}

/** Fecha local desde la que un festejo anterior ya no cuenta. */
function gapCutoff(now: Date, timezone: string): string {
  return getLocalDateString(new Date(now.getTime() - CELEBRATE_GAP_DAYS * 86_400_000), timezone);
}

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
export function celebratesOn(birthday: BirthdayDate, year: number, month: number, day: number): boolean {
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
  const where = and(eq(birthdays.guildId, guildId), eq(birthdays.userId, userId));
  const [row] = await db.select().from(birthdays).where(where);
  if (!row || !hasDate(row)) return false;
  // Si trae el rol o se le festejó hace poco, la fila se queda sin la fecha: así borrar y volver a guardar
  // no da otro festejo, y el rol se le quita a su hora
  const recent = row.lastCelebrated !== null && row.lastCelebrated >= gapCutoff(new Date(), 'UTC');
  if (row.roleGivenAt || recent) await db.update(birthdays).set({ month: null, day: null }).where(where);
  else await db.delete(birthdays).where(where);
  return true;
}

export async function getBirthday(guildId: string, userId: string): Promise<SavedBirthday | undefined> {
  const [row] = await db.select().from(birthdays).where(and(eq(birthdays.guildId, guildId), eq(birthdays.userId, userId)));
  return row && hasDate(row) ? row : undefined;
}

export async function listBirthdays(guildId: string): Promise<SavedBirthday[]> {
  const rows = await db.select().from(birthdays).where(and(eq(birthdays.guildId, guildId), isNotNull(birthdays.month)));
  return rows.filter(hasDate);
}

/** Días que faltan para el próximo cumpleaños (0 = hoy), contando desde la fecha local dada. */
export function daysUntil(birthday: BirthdayDate, year: number, month: number, day: number): number {
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
    // Se quita el rol que se le dio, aunque en el panel ya hayan cambiado o quitado el rol de cumpleañero
    // (las filas de antes de guardar cuál era usan el del panel)
    const roleId = row.roleGivenId ?? extras.birthdayRoleId;
    if (roleId) {
      const member = await guild.members.fetch(row.userId).catch(() => null);
      await member?.roles.remove(roleId, 'Terminó su día de cumpleaños').catch(() => undefined);
    }
    await db.update(birthdays).set({ roleGivenAt: null, roleGivenId: null })
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
  const cutoff = gapCutoff(now, timezone);

  // Las fechas son "YYYY-MM-DD", así que se comparan como texto
  const pending = (await listBirthdays(guild.id))
    .filter((row) => (!row.lastCelebrated || row.lastCelebrated < cutoff) && celebratesOn(row, local.year, local.month, local.day));
  if (pending.length === 0) return;

  // Solo quienes siguen en el servidor
  const present: SavedBirthday[] = [];
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
        await db.update(birthdays).set({ roleGivenAt: new Date(), roleGivenId: role.role.id })
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
