import { Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import ws from 'ws';
import * as schema from '@shared/schema';

neonConfig.webSocketConstructor = ws;

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL must be set to connect to PostgreSQL.');
}

// Número entero positivo de una variable de entorno (o el valor por defecto si no viene o no es válido)
function envInt(name: string, fallback: number, { min = 0 }: { min?: number } = {}): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= min ? value : fallback;
}

// Límite de cada consulta en el servidor de PostgreSQL. Si se pasa, PostgreSQL la cancela con un
// error normal (código 57014): la transacción se deshace entera y nunca queda a medias.
// DB_STATEMENT_TIMEOUT_MS=0 lo desactiva.
const STATEMENT_TIMEOUT_MS = envInt('DB_STATEMENT_TIMEOUT_MS', 30_000);

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Conexiones abiertas a la vez (bot + panel comparten el pool)
  max: envInt('DB_POOL_MAX', 10, { min: 1 }),
  // Si la base de datos no responde (p. ej. Neon despertando y algo falla), error en 10 s en vez de esperar para siempre
  connectionTimeoutMillis: envInt('DB_CONNECTION_TIMEOUT_MS', 10_000, { min: 1 }),
  // Cierra las conexiones que llevan 30 s sin usarse (Neon corta las inactivas de todas formas)
  idleTimeoutMillis: envInt('DB_IDLE_TIMEOUT_MS', 30_000, { min: 1 }),
});

// statement_timeout con SET al abrir cada conexión, no como parámetro de arranque: el pooler de Neon
// (PgBouncer, URLs con "-pooler") rechaza parámetros de arranque desconocidos y no conectaría.
// La consulta se encola antes que cualquier otra de esa conexión.
if (STATEMENT_TIMEOUT_MS > 0) {
  pool.on('connect', (client) => {
    client.query(`SET statement_timeout = ${STATEMENT_TIMEOUT_MS}`).catch((error: Error) => {
      console.warn('[DB] No se pudo configurar statement_timeout en una conexión nueva:', error.message);
    });
  });
}

// Una conexión inactiva que se cae (p. ej. Neon suspendió la base de datos) emite 'error' en el pool.
// Sin este listener el proceso entero se caería; el pool la descarta y abre otra cuando haga falta.
pool.on('error', (error) => {
  console.warn('[DB] Se cerró una conexión inactiva con la base de datos:', error.message);
});

export const db = drizzle({ client: pool, schema });
