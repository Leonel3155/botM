import type { Guild } from '@shared/schema';
import { storage } from '../../storage';

// Ajustes del servidor (prefijo, economía, avisos de nivel) con una caché corta.
// Así no consultamos la base de datos en cada mensaje; los cambios del panel se notan en segundos.
const TTL_MS = 15_000;
const cache = new Map<string, { at: number; guild: Guild | undefined }>();
// Una sola consulta en vuelo por servidor, aunque lleguen varios comandos a la vez.
// Si una consulta lleva demasiado tiempo colgada se lanza otra, para no quedar atados a ella para siempre.
const INFLIGHT_MAX_AGE_MS = 10_000;
const inflight = new Map<string, { at: number; promise: Promise<Guild | undefined> }>();

function load(guildId: string): Promise<Guild | undefined> {
  const current = inflight.get(guildId);
  if (current && Date.now() - current.at < INFLIGHT_MAX_AGE_MS) return current.promise;

  const startedAt = Date.now();
  const promise: Promise<Guild | undefined> = storage
    .getGuild(guildId)
    .then((guild) => {
      // Una consulta más vieja que la que ya está en caché no la pisa
      const cached = cache.get(guildId);
      if (!cached || cached.at <= startedAt) cache.set(guildId, { at: startedAt, guild });
      if (cache.size > 5_000) {
        const now = Date.now();
        for (const [id, entry] of cache) {
          if (now - entry.at >= TTL_MS) cache.delete(id);
        }
      }
      return guild;
    })
    .finally(() => {
      if (inflight.get(guildId)?.promise === promise) inflight.delete(guildId);
    });
  inflight.set(guildId, { at: startedAt, promise });
  return promise;
}

export async function getGuildSettings(guildId: string): Promise<Guild | undefined> {
  const hit = cache.get(guildId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.guild;
  return load(guildId);
}

export async function isEconomyEnabled(guildId: string): Promise<boolean> {
  const guild = await getGuildSettings(guildId);
  return guild?.economyEnabled !== false;
}

// Versión para el filtro de los comandos de barra, que corre ANTES de deferReply: Discord solo da
// 3 segundos para la primera respuesta y una base de datos dormida (Neon) puede tardar más en despertar.
// Usa la caché si está fresca; si no, espera a la base de datos como mucho `budgetMs`. Si tarda más,
// usa el último valor conocido (la consulta sigue y refresca la caché) y, si nunca se leyó, el valor
// por defecto de la columna (activada).
export async function isEconomyEnabledQuick(guildId: string, budgetMs = 1_200): Promise<boolean> {
  const hit = cache.get(guildId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.guild?.economyEnabled !== false;

  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<'late'>((resolve) => {
    timer = setTimeout(() => resolve('late'), budgetMs);
  });
  try {
    const result = await Promise.race([load(guildId), late]);
    if (result !== 'late') return result?.economyEnabled !== false;
    console.warn(`⏳ Los ajustes del servidor ${guildId} tardan en llegar; se usa el último valor conocido (o el predeterminado)`);
  } catch (error) {
    console.error(`No se pudieron leer los ajustes del servidor ${guildId}; se usa el último valor conocido (o el predeterminado):`, error);
  } finally {
    clearTimeout(timer);
  }
  return hit ? hit.guild?.economyEnabled !== false : true;
}

// Carga los ajustes en segundo plano (al conectar el bot o al entrar a un servidor) para que el primer
// comando no tenga que esperar a la base de datos. Va de uno en uno para no saturar el pool.
export async function warmGuildSettings(guildIds: Iterable<string>): Promise<void> {
  for (const guildId of guildIds) {
    try {
      await load(guildId);
    } catch (error) {
      console.error(`No se pudieron precargar los ajustes del servidor ${guildId}:`, error);
    }
  }
}

export const ECONOMY_DISABLED_MESSAGE = '💤 La economía está desactivada en este servidor. Un administrador puede activarla desde el panel.';
