import { Mutex } from 'async-mutex';

const CLEANUP_MS = 10 * 60 * 1000;

// Borra el candado tras 10 minutos sin uso; si en ese momento está ocupado, vuelve a intentarlo más tarde
function scheduleCleanup(map: Map<string, Mutex>, key: string, mutex: Mutex) {
  const timer = setTimeout(() => {
    if (map.get(key) !== mutex) return;
    if (mutex.isLocked()) scheduleCleanup(map, key, mutex);
    else map.delete(key);
  }, CLEANUP_MS);
  timer.unref?.();
}

function getOrCreate(map: Map<string, Mutex>, key: string): Mutex {
  let mutex = map.get(key);
  if (!mutex) {
    mutex = new Mutex();
    map.set(key, mutex);
    scheduleCleanup(map, key, mutex);
  }
  return mutex;
}

// Candado por usuario para operaciones económicas (la clave puede incluir el servidor: "guildId:userId")
const userLocks = new Map<string, Mutex>();
export function lockForUser(key: string) {
  return getOrCreate(userLocks, key);
}

// Candado por servidor para operaciones de configuración
const guildLocks = new Map<string, Mutex>();
export function lockForGuild(guildId: string) {
  return getOrCreate(guildLocks, guildId);
}

// Estadísticas de candados
export function getLockStats() {
  return {
    userLocks: userLocks.size,
    guildLocks: guildLocks.size,
    activeUserLocks: Array.from(userLocks.values()).filter(m => m.isLocked()).length,
    activeGuildLocks: Array.from(guildLocks.values()).filter(m => m.isLocked()).length
  };
}
