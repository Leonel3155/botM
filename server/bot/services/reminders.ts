// Recordatorios (/recordar): el bot avisa en el mismo canal (o por mensaje directo si ya no puede
// escribir ahí) cuando llega la hora. Se guardan en la base, así que sobreviven a un reinicio.
import { PermissionFlagsBits, type Client, type Guild, type GuildTextBasedChannel } from 'discord.js';
import { and, asc, count, eq, lte } from 'drizzle-orm';
import { reminders, type Reminder } from '@shared/schema';
import { db } from '../../db';

export const REMINDER_LIMITS = { perUser: 25, maxDays: 365, textMax: 500 };

/**
 * "10m", "2h", "1d", "1h30m", "2 horas", "3 dias", "1 semana" → milisegundos (o null si no se entiende).
 */
export function parseDuration(input: string): number | null {
  const text = input.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (!text) return null;
  const units: Record<string, number> = {
    s: 1_000, seg: 1_000, segs: 1_000, segundo: 1_000, segundos: 1_000,
    m: 60_000, min: 60_000, mins: 60_000, minuto: 60_000, minutos: 60_000,
    h: 3_600_000, hr: 3_600_000, hrs: 3_600_000, hora: 3_600_000, horas: 3_600_000,
    d: 86_400_000, dia: 86_400_000, dias: 86_400_000,
    sem: 604_800_000, semana: 604_800_000, semanas: 604_800_000, w: 604_800_000,
  };
  const pattern = /(\d+(?:[.,]\d+)?)\s*([a-z]+)/g;
  let total = 0;
  let consumed = '';
  for (const match of text.matchAll(pattern)) {
    const unit = units[match[2]];
    if (!unit) return null;
    total += Number(match[1].replace(',', '.')) * unit;
    consumed += match[0];
  }
  // Todo el texto tiene que ser cantidades con unidad (con espacios o "y" en medio)
  if (consumed.replace(/\s/g, '') !== text.replace(/\s|\by\b/g, '')) return null;
  return total > 0 && Number.isFinite(total) ? Math.round(total) : null;
}

export async function countUserReminders(guildId: string, userId: string): Promise<number> {
  const [row] = await db.select({ total: count() }).from(reminders)
    .where(and(eq(reminders.guildId, guildId), eq(reminders.userId, userId)));
  return row?.total ?? 0;
}

export async function createReminder(data: { guildId: string; channelId: string; userId: string; text: string; dueAt: Date }): Promise<Reminder> {
  const [row] = await db.insert(reminders).values(data).returning();
  return row;
}

export async function listUserReminders(guildId: string, userId: string): Promise<Reminder[]> {
  return db.select().from(reminders)
    .where(and(eq(reminders.guildId, guildId), eq(reminders.userId, userId)))
    .orderBy(asc(reminders.dueAt));
}

export async function deleteUserReminder(guildId: string, userId: string, id: string): Promise<boolean> {
  const rows = await db.delete(reminders)
    .where(and(eq(reminders.guildId, guildId), eq(reminders.userId, userId), eq(reminders.id, id)))
    .returning();
  return rows.length > 0;
}

/** El canal, si puedo escribir ahí. El recordatorio es texto plano: no hace falta "Insertar enlaces". */
export function findReminderChannel(guild: Guild, channelId: string): GuildTextBasedChannel | null {
  const channel = guild.channels.cache.get(channelId);
  if (!channel?.isTextBased()) return null;
  const me = guild.members.me;
  const send = channel.isThread() ? PermissionFlagsBits.SendMessagesInThreads : PermissionFlagsBits.SendMessages;
  return me && channel.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel, send]) ? channel : null;
}

async function deliver(client: Client, reminder: Reminder) {
  const text = `⏰ <@${reminder.userId}>, me pediste que te recordara: ${reminder.text}`;
  const guild = client.guilds.cache.get(reminder.guildId);
  const channel = guild ? findReminderChannel(guild, reminder.channelId) : null;
  if (channel) {
    const sent = await channel.send({ content: text.slice(0, 2000), allowedMentions: { users: [reminder.userId] } })
      .then(() => true).catch(() => false);
    if (sent) return;
  }
  // No se pudo en el canal: por mensaje directo
  const user = await client.users.fetch(reminder.userId).catch(() => null);
  const sent = await user?.send({ content: `⏰ Me pediste que te recordara${guild ? ` (en ${guild.name})` : ''}: ${reminder.text}`.slice(0, 2000) })
    .then(() => true).catch(() => false);
  if (!sent) console.warn(`[RECORDATORIOS] No pude entregar un recordatorio a ${reminder.userId}: ni en el canal ni por mensaje directo.`);
}

let running = false;

/** Lo llama el programador cada minuto: manda los que ya tocan y los borra. */
export async function reminderTick(client: Client): Promise<void> {
  if (running || !client.isReady()) return;
  running = true;
  try {
    const due = await db.select().from(reminders).where(lte(reminders.dueAt, new Date())).orderBy(asc(reminders.dueAt)).limit(100);
    for (const reminder of due) {
      // Primero se borra: si el envío falla, mejor perder uno que mandarlo cada minuto
      const removed = await db.delete(reminders).where(eq(reminders.id, reminder.id)).returning();
      if (removed.length === 0) continue;
      try {
        await deliver(client, reminder);
      } catch (error) {
        console.error('[RECORDATORIOS] No pude mandar un recordatorio:', error);
      }
    }
  } catch (error) {
    console.error('[RECORDATORIOS] Error al revisar recordatorios:', error);
  } finally {
    running = false;
  }
}
