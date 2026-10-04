import { Mutex } from 'async-mutex';

// Lock por usuario para operaciones económicas
const userLocks = new Map<string, Mutex>();
export function lockForUser(userId: string) {
  let m = userLocks.get(userId);
  if (!m) { 
    m = new Mutex(); 
    userLocks.set(userId, m);
    
    // Cleanup de locks inactivos después de 10 minutos
    setTimeout(() => {
      if (!m?.isLocked()) {
        userLocks.delete(userId);
      }
    }, 10 * 60 * 1000);
  }
  return m;
}

// Lock por guild para operaciones de configuración
const guildLocks = new Map<string, Mutex>();
export function lockForGuild(guildId: string) {
  let m = guildLocks.get(guildId);
  if (!m) {
    m = new Mutex();
    guildLocks.set(guildId, m);
    
    // Cleanup de locks inactivos después de 10 minutos
    setTimeout(() => {
      if (!m?.isLocked()) {
        guildLocks.delete(guildId);
      }
    }, 10 * 60 * 1000);
  }
  return m;
}

// Estadísticas de locks
export function getLockStats() {
  return {
    userLocks: userLocks.size,
    guildLocks: guildLocks.size,
    activeUserLocks: Array.from(userLocks.values()).filter(m => m.isLocked()).length,
    activeGuildLocks: Array.from(guildLocks.values()).filter(m => m.isLocked()).length
  };
}