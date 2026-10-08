import { Pool as NeonPool, neonConfig } from '@neondatabase/serverless';
import { sql } from 'drizzle-orm';
import { drizzle as drizzleNeon } from 'drizzle-orm/neon-serverless';
import { drizzle as drizzleNodePg } from 'drizzle-orm/node-postgres';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import pg from 'pg';
import ws from 'ws';
import * as schema from '@shared/schema';
import { databaseMode } from './dataFolder';
import { DatabaseStartupError, EmbeddedDatabase } from './embeddedDb';

export { DatabaseStartupError };

// Sin DATABASE_URL BotM usa su propia base de datos (PGlite) en una carpeta; con DATABASE_URL, ese PostgreSQL
const mode = databaseMode();
if (mode.kind === 'invalid') {
  console.error(`❌ ${mode.message}`);
  process.exit(1);
}
const DATABASE_URL = mode.kind === 'url' ? mode.url : '';

// Número entero positivo de una variable de entorno (o el valor por defecto si no viene o no es válido)
function envInt(name: string, fallback: number, { min = 0 }: { min?: number } = {}): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= min ? value : fallback;
}

// ---------------------------------------------------------------------------------------------
// Controlador
//
// - neon: @neondatabase/serverless, habla con la base por WebSocket. Solo sirve con Neon.
// - pg:   node-postgres, conexión TCP normal. Sirve con cualquier PostgreSQL: uno instalado en tu
//         computadora (Windows, Docker), Supabase, Railway… y también con Neon.
// - pglite: base de datos integrada (PostgreSQL dentro del propio proceso), guardada en una carpeta.
//         Se usa cuando DATABASE_URL está vacía (ver embeddedDb.ts y dataFolder.ts).
//
// Con DATABASE_URL se elige solo: los hosts de Neon (*.neon.tech) usan "neon" como siempre y todo lo
// demás usa "pg". DATABASE_DRIVER=neon|pg|pglite lo fuerza.
// ---------------------------------------------------------------------------------------------
type DbDriver = 'neon' | 'pg' | 'pglite';

/** Host de la cadena de conexión, en minúsculas ('' si no se encuentra). Nunca registra la URL: trae la contraseña. */
function databaseHost(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    // Una contraseña con caracteres especiales sin codificar puede romper el parser de URL:
    // se busca el host a mano (lo que va después de la última "@" y antes de ":", "/" o "?")
    const withoutScheme = url.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
    const afterCredentials = withoutScheme.slice(withoutScheme.lastIndexOf('@') + 1);
    return (afterCredentials.split(/[/:?#]/)[0] ?? '').toLowerCase();
  }
}

function isNeonHost(host: string): boolean {
  return host === 'neon.tech' || host.endsWith('.neon.tech');
}

function chooseDriver(url: string): DbDriver {
  const forced = process.env.DATABASE_DRIVER?.trim().toLowerCase();
  if (forced === 'neon' || forced === 'pg') return forced;
  if (forced) {
    console.warn(`[DB] DATABASE_DRIVER="${forced}" no es válido (usa "neon", "pg" o "pglite"); se elige según DATABASE_URL.`);
  }
  return isNeonHost(databaseHost(url)) ? 'neon' : 'pg';
}

function embeddedDriver(): DbDriver {
  const forced = process.env.DATABASE_DRIVER?.trim().toLowerCase();
  if (forced && forced !== 'pglite') {
    console.warn(`[DB] DATABASE_DRIVER="${forced}" no es válido (usa "neon", "pg" o "pglite"); se usa la base de datos integrada.`);
  }
  if (mode.kind === 'embedded' && mode.ignoredUrl) {
    console.warn('[DB] DATABASE_DRIVER=pglite: se usa la base de datos integrada y se ignora DATABASE_URL.');
  }
  return 'pglite';
}

export const dbDriver: DbDriver = mode.kind === 'url' ? chooseDriver(DATABASE_URL) : embeddedDriver();

// Límite de cada consulta en el servidor de PostgreSQL. Si se pasa, PostgreSQL la cancela con un
// error normal (código 57014): la transacción se deshace entera y nunca queda a medias.
// Con la base integrada (PGlite no puede cortar una consulta) es el límite de cada transacción.
// DB_STATEMENT_TIMEOUT_MS=0 lo desactiva.
const STATEMENT_TIMEOUT_MS = envInt('DB_STATEMENT_TIMEOUT_MS', 30_000);

// Mismos ajustes para los dos controladores (el Pool de Neon es compatible con el de node-postgres)
const poolConfig: pg.PoolConfig = {
  connectionString: DATABASE_URL,
  // Conexiones abiertas a la vez (bot + panel comparten el pool)
  max: envInt('DB_POOL_MAX', 10, { min: 1 }),
  // Si la base de datos no responde (p. ej. Neon despertando y algo falla), error en 10 s en vez de esperar para siempre
  connectionTimeoutMillis: envInt('DB_CONNECTION_TIMEOUT_MS', 10_000, { min: 1 }),
  // Cierra las conexiones que llevan 30 s sin usarse (Neon corta las inactivas de todas formas)
  idleTimeoutMillis: envInt('DB_IDLE_TIMEOUT_MS', 30_000, { min: 1 }),
};

// Tipo común a todos: lo que usan storage.ts y los servicios del bot (select, insert, transaction, execute…)
type Database = PgDatabase<PgQueryResultHKT, typeof schema>;

function createPoolDatabase(driver: 'neon' | 'pg'): { pool: pg.Pool; db: Database } {
  if (driver === 'neon') {
    neonConfig.webSocketConstructor = ws;
    const neonPool = new NeonPool(poolConfig);
    return { pool: neonPool, db: drizzleNeon({ client: neonPool, schema }) };
  }
  const pgPool = new pg.Pool(poolConfig);
  return { pool: pgPool, db: drizzleNodePg({ client: pgPool, schema }) };
}

function setUpPool(pool: pg.Pool): void {
  console.log(
    dbDriver === 'neon'
      ? '🗄️ Base de datos: controlador de Neon (WebSocket)'
      : '🗄️ Base de datos: controlador PostgreSQL estándar (node-postgres)'
  );

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

  // Una conexión inactiva que se cae (p. ej. Neon suspendió la base de datos o se reinició PostgreSQL)
  // emite 'error' en el pool. Sin este listener el proceso entero se caería; el pool la descarta y
  // abre otra cuando haga falta.
  pool.on('error', (error) => {
    console.warn('[DB] Se cerró una conexión inactiva con la base de datos:', error.message);
  });
}

// Base integrada: se abre en initDatabase() (carpeta, candado y tablas); hasta entonces las consultas esperan
const embedded = dbDriver === 'pglite' ? new EmbeddedDatabase(STATEMENT_TIMEOUT_MS) : null;
const database: { pool: pg.Pool | null; db: Database } = embedded
  ? { pool: null, db: drizzlePglite({ client: embedded.client, schema }) }
  : createPoolDatabase(dbDriver as 'neon' | 'pg');

const pool = database.pool;
if (pool) setUpPool(pool);
else console.log('🗄️ Base de datos: integrada (PGlite, PostgreSQL dentro de BotM; no hace falta instalar nada)');

export const db = database.db;

/**
 * Prepara la base antes de arrancar el bot y el panel. Con la base integrada elige la carpeta, toma el
 * candado, la abre y crea o pone al día las tablas; lanza DatabaseStartupError (mensaje en español) si no
 * se puede. Con DATABASE_URL no hace nada: cada consulta conecta sola, como siempre.
 */
export async function initDatabase(): Promise<void> {
  if (embedded) await embedded.open(schema);
}

/** Cierra la base integrada limpia (al apagar BotM). Nunca lanza. Con DATABASE_URL no hace nada. */
export async function closeDatabase(): Promise<void> {
  if (embedded) await embedded.close();
}

/** Explicación en español de un error al conectar con la base de datos (para la consola). */
function explainDatabaseError(code: string, message: string): string {
  switch (code) {
    case '42P01':
      return 'La base de datos no tiene las tablas de BotM. Ejecuta "npm run db:push" y reinicia BotM.';
    case '28P01':
    case '28000':
      return 'El usuario o la contraseña de DATABASE_URL no son correctos.';
    case '3D000':
      return 'La base de datos que pide DATABASE_URL no existe: créala primero (por ejemplo con pgAdmin).';
    case 'ECONNREFUSED':
      return 'Nadie responde en el host y el puerto de DATABASE_URL: ¿está encendido PostgreSQL? (En Windows, búscalo en Servicios como "postgresql-x64-…".)';
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return 'No se encontró el host de DATABASE_URL: revisa que esté bien copiado y que tengas internet.';
    case 'SELF_SIGNED_CERT_IN_CHAIN':
    case 'DEPTH_ZERO_SELF_SIGNED_CERT':
    case 'UNABLE_TO_VERIFY_LEAF_SIGNATURE':
    case 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY':
      return 'No se pudo comprobar el certificado SSL del proveedor. En DATABASE_URL cambia "sslmode=require" por "sslmode=no-verify" (la conexión sigue cifrada).';
  }
  if (/does not support SSL/i.test(message)) {
    return 'Tu PostgreSQL no usa SSL: quita "?sslmode=require" del final de DATABASE_URL.';
  }
  if (/timeout/i.test(message)) {
    return 'La base de datos no respondió a tiempo: revisa tu conexión a internet y el host de DATABASE_URL.';
  }
  return 'Revisa DATABASE_URL en el archivo .env.';
}

/**
 * Prueba la conexión al arrancar y deja un mensaje claro en la consola. Nunca lanza: si falla,
 * el panel y el bot siguen funcionando y cada consulta vuelve a intentar conectar por su cuenta.
 */
export async function checkDatabaseConnection(): Promise<boolean> {
  try {
    // "guilds" es la primera tabla que se consulta: si no existe, falta npm run db:push
    if (pool) await pool.query('SELECT 1 FROM guilds LIMIT 1');
    else await db.execute(sql`select 1 from guilds limit 1`);
    console.log(pool ? '✅ Conectado a la base de datos' : '✅ Base de datos lista');
    return true;
  } catch (error) {
    const err = (error && typeof error === 'object' ? error : {}) as { code?: unknown; message?: unknown };
    const code = typeof err.code === 'string' ? err.code : '';
    const message = typeof err.message === 'string' ? err.message : String(error);
    const detail = [code, message].filter(Boolean).join(': ');
    const advice = pool
      ? explainDatabaseError(code, message)
      : 'Cierra BotM (Ctrl + C), ejecuta "npm run db:push" y vuelve a arrancarlo.';
    console.error(`❌ No se pudo usar la base de datos (${detail}). ${advice}`);
    return false;
  }
}
