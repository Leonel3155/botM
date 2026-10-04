import {
  EmbedBuilder,
  ThreadAutoArchiveDuration,
  type Client,
  type Guild,
  type GuildTextBasedChannel,
  type Message,
} from 'discord.js';
import type { Guild as GuildRow } from '@shared/schema';
import { storage } from '../../storage';
import { PREGUNTAS_DEL_DIA } from '../data/preguntasDelDia';
import { canCreateThreads, resolveSendableChannel, truncate } from './channels';
import { getLocalDateString, getZonedParts, resolveTimezone } from './timezone';

export const DEFAULT_DAILY_QUESTION_HOUR = 18;

const DAILY_QUESTION_COLOR = 0xFEE75C;
// La configuración se guarda en memoria y se relee de la base de datos cada hora
// (los comandos la actualizan al momento), así no consultamos la base de datos cada minuto.
const CONFIG_REFRESH_MS = 60 * 60 * 1000;
// Si falla la publicación, se reintenta pasado este tiempo
const RETRY_AFTER_ERROR_MS = 15 * 60 * 1000;

// ===== Orden de preguntas: barajado por servidor, sin repetir hasta agotar la lista =====

function hashString(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffledOrder(guildId: string, cycle: number, size: number): number[] {
  const random = seededRandom(hashString(`${guildId}:${cycle}`));
  const order = Array.from({ length: size }, (_, i) => i);
  for (let i = size - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

// index = cuántas preguntas se han publicado antes en este servidor
export function pickDailyQuestion(guildId: string, index: number): string {
  const size = PREGUNTAS_DEL_DIA.length;
  const safeIndex = Math.max(0, Math.floor(index));
  const cycle = Math.floor(safeIndex / size);
  const order = shuffledOrder(guildId, cycle, size);

  // Que la primera de una vuelta nueva no sea la misma que la última de la anterior
  if (cycle > 0 && size > 1 && order[0] === shuffledOrder(guildId, cycle - 1, size)[size - 1]) {
    [order[0], order[1]] = [order[1], order[0]];
  }
  return PREGUNTAS_DEL_DIA[order[safeIndex % size]];
}

// ===== Publicación =====

export async function publishDailyQuestion(
  channel: GuildTextBasedChannel,
  index: number,
  createThread: boolean
): Promise<Message> {
  const question = pickDailyQuestion(channel.guild.id, index);
  const withThread = createThread && canCreateThreads(channel);

  const embed = new EmbedBuilder()
    .setColor(DAILY_QUESTION_COLOR)
    .setAuthor({ name: '❓ Pregunta del día', iconURL: channel.guild.iconURL() ?? undefined })
    .setTitle(truncate(question, 256))
    .setFooter({
      text: `Pregunta #${index + 1} · ${withThread ? '¡Responde en el hilo! 👇' : '¡Cuéntanos tu respuesta! 💬'}`,
    })
    .setTimestamp();

  const message = await channel.send({ embeds: [embed] });

  if (withThread) {
    try {
      await message.startThread({
        name: truncate(`💬 ${question}`, 90),
        autoArchiveDuration: ThreadAutoArchiveDuration.OneDay,
        reason: 'Respuestas a la pregunta del día',
      });
    } catch (error) {
      console.warn(`[PREGUNTA-DEL-DIA] No se pudo crear el hilo en ${channel.guild.name}:`, error);
    }
  }

  return message;
}

// ===== Programación diaria =====

interface DailyQuestionConfig {
  guildId: string;
  channelId: string;
  hour: number;
  timezone: string;
  thread: boolean;
  lastPosted: string | null;
}

function toConfig(row: GuildRow): DailyQuestionConfig | null {
  if (!row.dailyQuestionEnabled || !row.dailyQuestionChannelId) return null;
  return {
    guildId: row.id,
    channelId: row.dailyQuestionChannelId,
    hour: row.dailyQuestionHour ?? DEFAULT_DAILY_QUESTION_HOUR,
    timezone: resolveTimezone(row.timezone),
    thread: row.dailyQuestionThread ?? true,
    lastPosted: row.dailyQuestionLastPosted ?? null,
  };
}

class DailyQuestionService {
  private configs = new Map<string, DailyQuestionConfig>();
  private loadedAt = 0;
  private running = false;
  private syncedAt = new Map<string, number>();
  private retryAt = new Map<string, number>();
  private warnedOn = new Map<string, string>();

  // Actualiza la caché después de cambiar la configuración con un comando
  syncGuild(row: GuildRow | null | undefined): void {
    if (!row) return;
    const config = toConfig(row);
    if (config) this.configs.set(row.id, config);
    else this.configs.delete(row.id);
    this.syncedAt.set(row.id, Date.now());
    this.retryAt.delete(row.id);
    this.warnedOn.delete(row.id);
  }

  // Se llama cada minuto desde el scheduler
  async tick(client: Client): Promise<void> {
    if (this.running || !client.isReady()) return;
    this.running = true;
    try {
      if (Date.now() - this.loadedAt >= CONFIG_REFRESH_MS) {
        await this.reload();
      }
      for (const config of Array.from(this.configs.values())) {
        try {
          await this.checkGuild(client, config);
        } catch (error) {
          console.error(`[PREGUNTA-DEL-DIA] Error revisando el servidor ${config.guildId}:`, error);
        }
      }
    } finally {
      this.running = false;
    }
  }

  private async reload(): Promise<void> {
    const startedAt = Date.now();
    const rows = await storage.getDailyQuestionGuilds();

    const next = new Map<string, DailyQuestionConfig>();
    for (const row of rows) {
      const config = toConfig(row);
      if (config) next.set(row.id, config);
    }
    // Respeta los cambios hechos con comandos mientras se leía la base de datos
    for (const [guildId, syncedTime] of Array.from(this.syncedAt)) {
      if (syncedTime < startedAt) continue;
      const current = this.configs.get(guildId);
      if (current) next.set(guildId, current);
      else next.delete(guildId);
    }

    this.configs = next;
    this.syncedAt.clear();
    this.loadedAt = Date.now();
  }

  private warnOnce(guildId: string, today: string, message: string): void {
    if (this.warnedOn.get(guildId) === today) return;
    this.warnedOn.set(guildId, today);
    console.warn(`[PREGUNTA-DEL-DIA] ${message}`);
  }

  private async checkGuild(client: Client, config: DailyQuestionConfig): Promise<void> {
    const now = new Date();
    const today = getLocalDateString(now, config.timezone);
    if (config.lastPosted === today) return;
    if (getZonedParts(now, config.timezone).hour < config.hour) return;
    if ((this.retryAt.get(config.guildId) ?? 0) > now.getTime()) return;

    const guild = client.guilds.cache.get(config.guildId);
    if (!guild) return; // El bot ya no está en ese servidor

    const target = resolveSendableChannel(guild, config.channelId);
    if (!target.ok) {
      this.warnOnce(config.guildId, today, `No se pudo publicar en ${guild.name}: ${target.reason}`);
      return;
    }

    const previousDate = config.lastPosted;
    const index = await storage.claimDailyQuestion(config.guildId, today);
    if (index === null) {
      // Ya se publicó hoy (otra instancia o el comando "ahora") o se desactivó
      config.lastPosted = today;
      return;
    }

    try {
      await publishDailyQuestion(target.channel, index, config.thread);
      config.lastPosted = today;
      console.log(`[PREGUNTA-DEL-DIA] Pregunta #${index + 1} publicada en ${guild.name}`);
    } catch (error) {
      console.error(`[PREGUNTA-DEL-DIA] Error al publicar en ${guild.name}:`, error);
      this.retryAt.set(config.guildId, Date.now() + RETRY_AFTER_ERROR_MS);
      await storage.releaseDailyQuestion(config.guildId, today, previousDate).catch(releaseError =>
        console.error('[PREGUNTA-DEL-DIA] No se pudo liberar la reserva:', releaseError)
      );
    }
  }

  // Comando "/pregunta-del-dia ahora": publica ya y cuenta como la pregunta de hoy
  async postNow(
    guild: Guild,
    settings: GuildRow,
    channel: GuildTextBasedChannel
  ): Promise<{ message: Message; number: number }> {
    const timezone = resolveTimezone(settings.timezone);
    const today = getLocalDateString(new Date(), timezone);

    const index = await storage.claimDailyQuestion(guild.id, today, true);
    if (index === null) {
      throw new Error(`Guild ${guild.id} not found in database`);
    }

    try {
      const message = await publishDailyQuestion(channel, index, settings.dailyQuestionThread ?? true);
      const cached = this.configs.get(guild.id);
      if (cached) cached.lastPosted = today;
      return { message, number: index + 1 };
    } catch (error) {
      await storage.releaseDailyQuestion(guild.id, today, settings.dailyQuestionLastPosted ?? null).catch(() => {});
      throw error;
    }
  }
}

export const dailyQuestions = new DailyQuestionService();
