// Contenido +18 con doble candado: solo publica si
//   1) un admin lo encendió en el panel (Contenido +18) y eligió ese canal, Y
//   2) el canal está marcado en Discord como "con restricción de edad".
// Si falta cualquiera de los dos, no publica nada. Se vuelve a revisar en cada uso, así que si alguien le
// quita la marca +18 al canal, deja de funcionar al momento. Además, Discord solo muestra /nsfw en canales +18.
//
// Las imágenes vienen de waifu.pics (categorías fijas de ilustración anime para adultos). No se aceptan
// búsquedas por etiquetas: así nadie puede pedir contenido ilegal escribiendo una etiqueta.
import type { Guild, GuildTextBasedChannel } from 'discord.js';
import { desc, eq } from 'drizzle-orm';
import { nsfwLog, type GuildExtras } from '@shared/schema';
import { db } from '../../db';
import { safeFetchText } from '../../services/safeFetch';

export const NSFW_CATEGORIES = [
  { value: 'waifu', label: 'Waifu' },
  { value: 'neko', label: 'Neko' },
] as const;
export type NsfwCategory = (typeof NSFW_CATEGORIES)[number]['value'];

const ALLOWED_IMAGE_HOST = 'i.waifu.pics';
const LOG_KEEP = 200;

/** El canal (o el canal padre, si es un hilo) está marcado como +18 en Discord. */
export function isAgeRestrictedChannel(channel: GuildTextBasedChannel | null | undefined): boolean {
  if (!channel) return false;
  const target = channel.isThread() ? channel.parent : channel;
  return !!target && 'nsfw' in target && target.nsfw === true;
}

function baseChannelId(channel: GuildTextBasedChannel): string {
  return channel.isThread() ? channel.parentId ?? channel.id : channel.id;
}

export type NsfwCheck = { ok: true } | { ok: false; reason: string };

/** El doble candado. */
export function checkNsfwAllowed(extras: Pick<GuildExtras, 'nsfwEnabled' | 'nsfwChannelIds'>, channel: GuildTextBasedChannel | null | undefined): NsfwCheck {
  if (!extras.nsfwEnabled) {
    return { ok: false, reason: '🔞 El contenido +18 está apagado en este servidor. Un admin lo activa en el panel (Contenido +18).' };
  }
  if (!channel || !isAgeRestrictedChannel(channel)) {
    return { ok: false, reason: '🔞 Este canal no está marcado como "con restricción de edad" en Discord, así que aquí no publico nada +18.' };
  }
  if (!extras.nsfwChannelIds.includes(baseChannelId(channel))) {
    return { ok: false, reason: '🔞 Un admin no ha autorizado este canal para contenido +18 (se elige en el panel, en Contenido +18).' };
  }
  return { ok: true };
}

export interface NsfwSourceOptions {
  baseUrl?: string;
  allowPrivateHosts?: boolean;
}

export class NsfwSource {
  private readonly baseUrl: string;
  private readonly allowPrivateHosts: boolean;

  constructor(options: NsfwSourceOptions = {}) {
    this.baseUrl = (options.baseUrl ?? 'https://api.waifu.pics/nsfw').replace(/\/+$/, '');
    this.allowPrivateHosts = options.allowPrivateHosts ?? false;
  }

  async image(category: NsfwCategory): Promise<string | null> {
    if (!NSFW_CATEGORIES.some((item) => item.value === category)) return null;
    try {
      const page = await safeFetchText(`${this.baseUrl}/${category}`, { accept: 'application/json', timeoutMs: 5_000, maxBytes: 100_000, allowPrivateHosts: this.allowPrivateHosts });
      const url = new URL((JSON.parse(page.text) as { url?: string }).url ?? '');
      if (!this.allowPrivateHosts && (url.protocol !== 'https:' || url.hostname !== ALLOWED_IMAGE_HOST)) return null;
      return url.toString();
    } catch {
      return null;
    }
  }
}

export const nsfwSource = new NsfwSource();

export async function recordNsfwPost(entry: { guildId: string; channelId: string; userId: string; category: string; url: string; messageId: string | null }): Promise<void> {
  try {
    await db.insert(nsfwLog).values(entry);
    // Solo se guardan los últimos LOG_KEEP de cada servidor
    const old = await db.select({ id: nsfwLog.id }).from(nsfwLog)
      .where(eq(nsfwLog.guildId, entry.guildId)).orderBy(desc(nsfwLog.createdAt)).offset(LOG_KEEP).limit(100);
    for (const row of old) await db.delete(nsfwLog).where(eq(nsfwLog.id, row.id));
  } catch (error) {
    console.error('[NSFW] No pude guardar el registro:', error);
  }
}

export async function recentNsfwPosts(guildId: string, limit = 20) {
  return db.select().from(nsfwLog).where(eq(nsfwLog.guildId, guildId)).orderBy(desc(nsfwLog.createdAt)).limit(limit);
}

/** Canales elegidos en el panel que ya no están marcados +18 (para avisar en la revisión al arrancar). */
export function unmarkedNsfwChannels(guild: Guild, extras: Pick<GuildExtras, 'nsfwChannelIds'>): string[] {
  return extras.nsfwChannelIds.filter((id) => {
    const channel = guild.channels.cache.get(id);
    return !channel || !('nsfw' in channel) || channel.nsfw !== true;
  });
}
