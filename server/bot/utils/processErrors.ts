import { DiscordAPIError, HTTPError, RateLimitError } from 'discord.js';

// Errores de red, de Discord o de la conexión a la base de datos que se arreglan solos al reintentar
const TRANSIENT_CODES = new Set([
  'ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ENOTFOUND', 'ECONNREFUSED', 'ECONNABORTED',
  'EPIPE', 'EHOSTUNREACH', 'ENETUNREACH',
  'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'UND_ERR_CLOSED',
  // PostgreSQL: conexión perdida o servidor reiniciándose
  '57P01', '57P02', '57P03', '08000', '08001', '08003', '08004', '08006',
]);

const TRANSIENT_MESSAGE = /websocket|socket hang up|connection terminated|fetch failed|opening handshake has timed out|other side closed/i;

export function isTransientError(error: unknown, depth = 0): boolean {
  if (error instanceof DiscordAPIError || error instanceof HTTPError || error instanceof RateLimitError) return true;
  if (!error || typeof error !== 'object' || depth > 3) return false;

  const err = error as { code?: unknown; name?: unknown; message?: unknown; cause?: unknown };
  if (typeof err.code === 'string' && TRANSIENT_CODES.has(err.code)) return true;
  if (err.name === 'AbortError' || err.name === 'ConnectTimeoutError') return true;
  if (typeof err.message === 'string' && TRANSIENT_MESSAGE.test(err.message)) return true;
  return err.cause !== undefined && err.cause !== error ? isTransientError(err.cause, depth + 1) : false;
}

const INSTALLED = Symbol.for('botm.processErrorHandlers');

// Registro a nivel de proceso:
// - Promesas rechazadas sin manejar: se anotan y el proceso sigue (sin esto, Node 20 se cierra).
// - Excepciones no capturadas: si son temporales (red/Discord) se anotan y se sigue; si no,
//   se cierra el proceso para que el hosting lo reinicie limpio (el estado podría ser inconsistente).
export function installProcessErrorHandlers(): void {
  const registry = globalThis as unknown as Record<symbol, boolean>;
  if (registry[INSTALLED]) return;
  registry[INSTALLED] = true;

  process.on('unhandledRejection', (reason) => {
    const label = isTransientError(reason) ? 'Error temporal (red/Discord/base de datos) sin manejar' : 'Promesa rechazada sin manejar';
    console.error(`⚠️ ${label}:`, reason);
  });

  process.on('uncaughtException', (error, origin) => {
    if (isTransientError(error)) {
      console.error('⚠️ Error temporal (red/Discord/base de datos) no capturado; el bot sigue funcionando:', error);
      return;
    }
    console.error(`💥 Excepción no capturada (${origin}); se cierra el proceso para reiniciarlo limpio:`, error);
    process.exit(1);
  });
}
