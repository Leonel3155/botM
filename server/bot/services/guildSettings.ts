import type { Guild } from '@shared/schema';
import { storage } from '../../storage';

// Ajustes del servidor (prefijo, economía, avisos de nivel) con una caché corta.
// Así no consultamos la base de datos en cada mensaje; los cambios del panel se notan en segundos.
const TTL_MS = 15_000;
const cache = new Map<string, { at: number; guild: Guild | undefined }>();

export async function getGuildSettings(guildId: string): Promise<Guild | undefined> {
  const now = Date.now();
  const hit = cache.get(guildId);
  if (hit && now - hit.at < TTL_MS) return hit.guild;

  const guild = await storage.getGuild(guildId);
  cache.set(guildId, { at: now, guild });
  if (cache.size > 5_000) {
    for (const [id, entry] of cache) {
      if (now - entry.at >= TTL_MS) cache.delete(id);
    }
  }
  return guild;
}

export async function isEconomyEnabled(guildId: string): Promise<boolean> {
  const guild = await getGuildSettings(guildId);
  return guild?.economyEnabled !== false;
}

export const ECONOMY_DISABLED_MESSAGE = '💤 La economía está desactivada en este servidor. Un administrador puede activarla desde el panel.';
