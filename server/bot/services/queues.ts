import PQueue from 'p-queue';
import { Collection } from 'discord.js';

// Concurrency total del bot (optimizado para Replit/hosting compartido)
export const globalQueue = new PQueue({
  concurrency: Number(process.env.GLOBAL_CONCURRENCY ?? 50),
  timeout: Number(process.env.GLOBAL_TIMEOUT_MS ?? 120_000), // 120s según ChatGPT
  throwOnTimeout: true
});

// Serializa operaciones que comparten estado por GUILD
const guildQueues = new Collection<string, PQueue>();
export function queueForGuild(guildId: string) {
  let q = guildQueues.get(guildId);
  if (!q) {
    q = new PQueue({ concurrency: 1 }); // 1 = evita race en economía/música por guild
    guildQueues.set(guildId, q);
    
    // Cleanup de colas inactivas después de 5 minutos
    setTimeout(() => {
      if (q && q.size === 0 && q.pending === 0) {
        guildQueues.delete(guildId);
      }
    }, 5 * 60 * 1000);
  }
  return q;
}

// Colas especializadas para diferentes tipos de operaciones
const musicQueues = new Collection<string, PQueue>();
export function musicQueueFor(guildId: string) {
  let q = musicQueues.get(guildId);
  if (!q) {
    q = new PQueue({ concurrency: 1 }); // Una canción a la vez por servidor
    musicQueues.set(guildId, q);
  }
  return q;
}

const economyQueues = new Collection<string, PQueue>();
export function economyQueueFor(guildId: string) {
  let q = economyQueues.get(guildId);
  if (!q) {
    q = new PQueue({ concurrency: 3 }); // Permite 3 transacciones económicas simultáneas por servidor
    economyQueues.set(guildId, q);
  }
  return q;
}

// Estadísticas de rendimiento
export function getQueueStats() {
  return {
    global: {
      size: globalQueue.size,
      pending: globalQueue.pending,
      concurrency: globalQueue.concurrency
    },
    guilds: guildQueues.size,
    music: musicQueues.size,
    economy: economyQueues.size
  };
}