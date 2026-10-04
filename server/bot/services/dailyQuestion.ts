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

// ===== Elección de preguntas: sin repetir hasta agotar la lista =====
// Cada pregunta se identifica por un hash de su texto y en la base de datos se guardan las que ya
// salieron en la vuelta actual. Así se pueden agregar, quitar o reordenar preguntas en la lista
// sin que se repitan las que ya se publicaron.

function hashString(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function questionKey(question: string): number {
  return hashString(question.trim());
}

const QUESTIONS = PREGUNTAS_DEL_DIA.map(text => ({ text, key: questionKey(text) }));

// Lo guardado en la base de datos es JSON: nos quedamos solo con números
function usedKeys(used: unknown): number[] {
  return Array.isArray(used) ? used.filter((key): key is number => typeof key === 'number') : [];
}

export interface DailyQuestionPick {
  question: string;
  key: number;
  // true = ya habían salido todas y esta empieza una vuelta nueva
  newCycle: boolean;
}

export function pickDailyQuestion(used: unknown): DailyQuestionPick {
  if (QUESTIONS.length === 0) throw new Error('La lista de preguntas del día está vacía');
  const keys = usedKeys(used);
  const usedSet = new Set(keys);
  let candidates = QUESTIONS.filter(question => !usedSet.has(question.key));
  let newCycle = false;

  if (candidates.length === 0) {
    // Vuelta nueva: que la primera no sea la misma que la última que salió
    newCycle = true;
    const last = keys[keys.length - 1];
    candidates = QUESTIONS.filter(question => question.key !== last);
    if (candidates.length === 0) candidates = QUESTIONS;
  }

  const choice = candidates[Math.floor(Math.random() * candidates.length)];
  return { question: choice.text, key: choice.key, newCycle };
}

// Cuántas preguntas de la lista actual no han salido en esta vuelta
export function remainingDailyQuestions(used: unknown): number {
  const usedSet = new Set(usedKeys(used));
  return QUESTIONS.filter(question => !usedSet.has(question.key)).length;
}

async function rememberDailyQuestion(guildId: string, pick: DailyQuestionPick): Promise<void> {
  try {
    await storage.recordDailyQuestionUsed(guildId, pick.key, pick.newCycle);
  } catch (error) {
    console.error(`[PREGUNTA-DEL-DIA] No se pudo guardar qué pregunta salió en ${guildId}:`, error);
  }
}

// ===== Publicación =====

export async function publishDailyQuestion(
  channel: GuildTextBasedChannel,
  question: string,
  index: number,
  createThread: boolean
): Promise<Message> {
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
    const claim = await storage.claimDailyQuestion(config.guildId, today);
    if (!claim) {
      // Ya se publicó hoy (otra instancia o el comando "ahora") o se desactivó
      config.lastPosted = today;
      return;
    }

    const pick = pickDailyQuestion(claim.used);
    try {
      await publishDailyQuestion(target.channel, pick.question, claim.index, config.thread);
      config.lastPosted = today;
      console.log(`[PREGUNTA-DEL-DIA] Pregunta #${claim.index + 1} publicada en ${guild.name}`);
    } catch (error) {
      console.error(`[PREGUNTA-DEL-DIA] Error al publicar en ${guild.name}:`, error);
      this.retryAt.set(config.guildId, Date.now() + RETRY_AFTER_ERROR_MS);
      await storage.releaseDailyQuestion(config.guildId, today, previousDate).catch(releaseError =>
        console.error('[PREGUNTA-DEL-DIA] No se pudo liberar la reserva:', releaseError)
      );
      return;
    }

    await rememberDailyQuestion(config.guildId, pick);
  }

  // Comando "/pregunta-del-dia ahora": publica ya y cuenta como la pregunta de hoy
  async postNow(
    guild: Guild,
    settings: GuildRow,
    channel: GuildTextBasedChannel
  ): Promise<{ message: Message; number: number }> {
    const timezone = resolveTimezone(settings.timezone);
    const today = getLocalDateString(new Date(), timezone);

    const claim = await storage.claimDailyQuestion(guild.id, today, true);
    if (!claim) {
      throw new Error(`Guild ${guild.id} not found in database`);
    }

    const pick = pickDailyQuestion(claim.used);
    let message: Message;
    try {
      message = await publishDailyQuestion(channel, pick.question, claim.index, settings.dailyQuestionThread ?? true);
    } catch (error) {
      await storage.releaseDailyQuestion(guild.id, today, settings.dailyQuestionLastPosted ?? null).catch(() => {});
      throw error;
    }

    const cached = this.configs.get(guild.id);
    if (cached) cached.lastPosted = today;
    await rememberDailyQuestion(guild.id, pick);
    return { message, number: claim.index + 1 };
  }
}

export const dailyQuestions = new DailyQuestionService();
