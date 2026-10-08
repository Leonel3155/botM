// Carpeta y candado de la base de datos integrada (PGlite).
//
// Solo usa módulos de Node y ningún alias (@shared…): lo importan server/db.ts (BotM con tsx, o ya
// compilado dentro de dist/index.js) y drizzle.config.ts (npm run db:push). Por eso tiene que estar
// directamente en server/: así la carpeta principal del proyecto es siempre la de arriba.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Error con un mensaje en español listo para mostrar en la consola. */
export class DataFolderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DataFolderError';
  }
}

// ---------------------------------------------------------------------------------------------
// ¿Base integrada o DATABASE_URL?
// ---------------------------------------------------------------------------------------------

export type DatabaseMode =
  | { kind: 'embedded'; ignoredUrl: boolean }
  | { kind: 'url'; url: string }
  | { kind: 'invalid'; message: string };

/**
 * Sin DATABASE_URL BotM usa su propia base de datos (PGlite) en una carpeta. Con DATABASE_URL se conecta
 * a ese PostgreSQL como siempre. DATABASE_DRIVER=pglite fuerza la base integrada aunque haya DATABASE_URL.
 */
export function databaseMode(env: NodeJS.ProcessEnv = process.env): DatabaseMode {
  const url = env.DATABASE_URL?.trim() ?? '';
  const forced = env.DATABASE_DRIVER?.trim().toLowerCase() ?? '';
  if (forced === 'pglite') return { kind: 'embedded', ignoredUrl: url !== '' };
  if (url) return { kind: 'url', url };
  if (forced === 'neon' || forced === 'pg') {
    return {
      kind: 'invalid',
      message:
        `DATABASE_DRIVER=${forced} necesita DATABASE_URL (la dirección de tu base PostgreSQL) y está vacía. ` +
        'Pon DATABASE_URL en el archivo .env, o borra DATABASE_DRIVER para que BotM use su propia base de datos.',
    };
  }
  return { kind: 'embedded', ignoredUrl: false };
}

// ---------------------------------------------------------------------------------------------
// Rutas
// ---------------------------------------------------------------------------------------------

type Platform = NodeJS.Platform;

function pathFor(platform: Platform): path.PlatformPath {
  return platform === 'win32' ? path.win32 : path.posix;
}

/** Carpeta principal del proyecto (la de package.json y .env), sin depender de desde dónde se arranque. */
export function projectRoot(): string {
  // server/dataFolder.ts con tsx o drizzle-kit, dist/index.js ya compilado: en los dos casos es "..".
  // drizzle-kit carga este archivo como CommonJS (ahí existe __dirname); BotM, como módulo ES.
  const here = typeof __dirname === 'string' ? __dirname : path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, '..');
}

/** ¿`child` está dentro de `parent` (o es la misma carpeta)? En Windows no importan mayúsculas. */
function isInside(child: string, parent: string, platform: Platform): boolean {
  const p = pathFor(platform);
  const norm = (x: string) => (platform === 'win32' ? p.resolve(x).toLowerCase() : p.resolve(x));
  const rel = p.relative(norm(parent), norm(child));
  return rel === '' || (!rel.startsWith('..') && !p.isAbsolute(rel));
}

/**
 * Nombre del servicio de sincronización si `dir` está dentro de una carpeta que se sube a la nube
 * (OneDrive, Dropbox, Google Drive, iCloud Drive), o null. Esos programas bloquean y reescriben archivos
 * mientras se usan, y eso puede dañar una base de datos abierta.
 */
export function cloudSyncedBy(dir: string, env: NodeJS.ProcessEnv = process.env, platform: Platform = process.platform): string | null {
  const segments = dir.split(/[\\/]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
  for (const s of segments) {
    // "OneDrive", "OneDrive - Empresa" (Windows), "OneDrive-Personal" (Mac)
    if (s === 'onedrive' || s.startsWith('onedrive - ') || s.startsWith('onedrive-')) return 'OneDrive';
    // "Dropbox", "Dropbox (Personal)", "Dropbox-Empresa"
    if (s === 'dropbox' || s.startsWith('dropbox (') || s.startsWith('dropbox-')) return 'Dropbox';
    // "G:\Mi unidad" / "G:\My Drive" (Google Drive para escritorio), "GoogleDrive-correo" (Mac)
    if (
      s === 'google drive' || s === 'googledrive' || s.startsWith('googledrive-') ||
      s === 'my drive' || s === 'mi unidad' || s === 'shared drives' || s === 'unidades compartidas'
    ) return 'Google Drive';
    // "C:\Users\tu\iCloudDrive" (Windows), "~/Library/Mobile Documents/com~apple~CloudDocs" (Mac)
    if (s === 'iclouddrive' || s === 'icloud drive' || s === 'mobile documents' || s === 'com~apple~clouddocs') return 'iCloud Drive';
  }
  // Mac: todo lo que está en ~/Library/CloudStorage es de algún servicio de la nube (Box, pCloud…)
  if (segments.includes('cloudstorage')) return 'una carpeta sincronizada con la nube';
  // Windows guarda dónde está OneDrive (aunque la carpeta tenga otro nombre)
  if (platform === 'win32') {
    for (const name of ['OneDrive', 'OneDriveConsumer', 'OneDriveCommercial']) {
      const syncRoot = env[name]?.trim();
      if (syncRoot && pathFor(platform).isAbsolute(syncRoot) && isInside(dir, syncRoot, platform)) return 'OneDrive';
    }
  }
  return null;
}

export interface DataDirChoice {
  /** Carpeta absoluta de la base de datos. */
  dir: string;
  /** env: DATABASE_DIR; project: carpeta "data" del proyecto; local: carpeta del usuario fuera de la nube. */
  source: 'env' | 'project' | 'local';
  /** Servicio de la nube que sincroniza el proyecto (source "local") o DATABASE_DIR (source "env"), o null. */
  syncedBy: string | null;
  /** La otra carpeta posible (la del proyecto o la local), para avisar si ya hay una base ahí. */
  alternative: string | null;
}

interface ChoiceOptions {
  env?: NodeJS.ProcessEnv;
  platform?: Platform;
  homedir?: string;
  root?: string;
}

/** Carpeta local del usuario, fuera de cualquier sincronización. */
function localDataDir(env: NodeJS.ProcessEnv, platform: Platform, homedir: string): string {
  const p = pathFor(platform);
  if (platform === 'win32') {
    const localAppData = env.LOCALAPPDATA?.trim();
    const base = localAppData && p.isAbsolute(localAppData) ? localAppData : p.join(homedir, 'AppData', 'Local');
    return p.join(base, 'BotM', 'data');
  }
  const xdg = env.XDG_DATA_HOME?.trim();
  const base = xdg && p.isAbsolute(xdg) ? xdg : p.join(homedir, '.local', 'share');
  return p.join(base, 'botm', 'data');
}

/** Ruta escrita por la persona en DATABASE_DIR → ruta absoluta (las relativas cuentan desde el proyecto). */
function resolveUserPath(raw: string, root: string, env: NodeJS.ProcessEnv, platform: Platform, homedir: string): string {
  const p = pathFor(platform);
  let value = raw.trim().replace(/^(['"])(.*)\1$/, '$2').trim();
  if (/^[a-z][a-z0-9+.-]+:\/\//i.test(value)) {
    throw new DataFolderError(
      `DATABASE_DIR tiene que ser la ruta de una carpeta (por ejemplo ${platform === 'win32' ? 'C:\\BotM\\datos' : '/home/tu/botm-datos'}), no una dirección como "${value.split('://')[0]}://".`
    );
  }
  if (platform === 'win32') {
    // %LOCALAPPDATA%\BotM, %USERPROFILE%\…
    value = value.replace(/%([^%]+)%/g, (match, name: string) => env[name] ?? env[name.toUpperCase()] ?? match);
  }
  if (value === '~' || value.startsWith('~/') || value.startsWith('~\\')) value = p.join(homedir, value.slice(1));
  return p.resolve(root, value);
}

/**
 * Carpeta de la base integrada:
 * 1. DATABASE_DIR si está puesta (manda siempre).
 * 2. Si el proyecto está dentro de OneDrive, Dropbox, Google Drive o iCloud Drive: una carpeta local del
 *    usuario fuera de la sincronización (Windows: %LOCALAPPDATA%\BotM\data; Mac/Linux: ~/.local/share/botm/data).
 * 3. Si no, la carpeta "data" dentro del proyecto.
 */
export function chooseDataDir(options: ChoiceOptions = {}): DataDirChoice {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const homedir = options.homedir ?? os.homedir();
  const root = options.root ?? projectRoot();
  const p = pathFor(platform);

  const projectDir = p.join(root, 'data');
  const localDir = localDataDir(env, platform, homedir);

  const raw = env.DATABASE_DIR?.trim();
  if (raw) {
    const dir = resolveUserPath(raw, root, env, platform, homedir);
    return { dir, source: 'env', syncedBy: cloudSyncedBy(dir, env, platform), alternative: null };
  }
  const syncedBy = cloudSyncedBy(root, env, platform);
  if (syncedBy) return { dir: localDir, source: 'local', syncedBy, alternative: projectDir };
  return { dir: projectDir, source: 'project', syncedBy: null, alternative: localDir };
}

// ---------------------------------------------------------------------------------------------
// Candado: una sola copia de BotM (o de npm run db:push) por carpeta
//
// PGlite no tiene candado propio: dos procesos con la misma carpeta pierden datos sin dar ningún error.
// El candado es un archivo botm.lock dentro de la carpeta con el proceso que la usa. Se considera
// abandonado si ese proceso ya no existe, o si nadie lo renovó en 2 minutos (el dueño lo renueva cada
// 30 s; Windows reutiliza los números de proceso, así que el número solo no alcanza).
// ---------------------------------------------------------------------------------------------

export const LOCK_FILE = 'botm.lock';
// Existe solo mientras se crea una base nueva: si sigue ahí al arrancar, esa creación se cortó a medias
const INIT_MARKER = 'botm-creando-base.tmp';
const LOCK_REFRESH_MS = 30_000;
const LOCK_STALE_MS = 2 * 60_000;
// Archivos que Windows o Mac crean solos en cualquier carpeta
const OS_JUNK = new Set(['desktop.ini', 'thumbs.db', '.ds_store']);

export type LockOwner = 'BotM' | 'db:push';

interface LockInfo {
  pid: number;
  hostname: string;
  startedAt: string;
  who: LockOwner;
  token: string;
}

export interface FolderLock {
  readonly path: string;
  release(): void;
}

const heldLocks = new Map<string, { lockPath: string; timer: NodeJS.Timeout; info: LockInfo }>();
let exitHookInstalled = false;

function readLock(lockPath: string): { raw: string; info: LockInfo | null; mtimeMs: number } | null {
  try {
    const stat = fs.statSync(lockPath);
    const raw = fs.readFileSync(lockPath, 'utf8');
    let info: LockInfo | null = null;
    try {
      const parsed = JSON.parse(raw) as Partial<LockInfo>;
      if (typeof parsed.pid === 'number' && typeof parsed.token === 'string') info = parsed as LockInfo;
    } catch {
      info = null;
    }
    return { raw, info, mtimeMs: stat.mtimeMs };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: existe pero es de otro usuario
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function lockIsStale(info: LockInfo | null, mtimeMs: number): boolean {
  const age = Date.now() - mtimeMs;
  if (age > LOCK_STALE_MS) return true;
  // Recién creado y todavía sin contenido: le damos unos segundos a quien lo está escribiendo
  if (!info) return age > 5_000;
  if (info.hostname !== os.hostname()) return false;
  if (info.pid === process.pid) return true; // un proceso anterior que tenía nuestro mismo número
  return !processIsAlive(info.pid);
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '?' : date.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
}

function heldMessage(lockPath: string, holder: LockInfo | null, me: LockOwner): string {
  const where = holder && holder.hostname !== os.hostname() ? ` en la computadora "${holder.hostname}"` : '';
  const since = holder ? ` (proceso ${holder.pid}${where}, desde las ${formatTime(holder.startedAt)})` : '';
  const hint =
    ` Si estás seguro de que no hay nada abierto, espera 2 minutos y vuelve a intentarlo, o borra el archivo ${lockPath}.`;
  if (holder?.who === 'db:push') {
    return me === 'BotM'
      ? `"npm run db:push" está usando la base de datos${since}. Espera a que termine y vuelve a arrancar BotM.${hint}`
      : `Ya hay otro "npm run db:push" usando la base de datos${since}. Espera a que termine.${hint}`;
  }
  return me === 'BotM'
    ? `BotM ya está abierto en otra ventana${since} y usa esta base de datos. Ciérralo (Ctrl + C en esa ventana) antes de abrirlo otra vez: dos copias a la vez dañarían la base de datos.${hint}`
    : `BotM está abierto${since} y usa la base de datos: cierra BotM (Ctrl + C en su ventana) antes de "npm run db:push" y vuelve a intentarlo.${hint}`;
}

function installExitHook(): void {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  // Síncrono: también corre con process.exit() (el bot y el servidor lo usan al fallar)
  process.on('exit', () => {
    for (const lockPath of [...heldLocks.keys()]) releaseLock(lockPath);
  });
}

function releaseLock(lockPath: string): void {
  const held = heldLocks.get(lockPath);
  if (!held) return;
  heldLocks.delete(lockPath);
  clearInterval(held.timer);
  try {
    const current = readLock(lockPath);
    if (current?.info?.token === held.info.token) fs.unlinkSync(lockPath);
  } catch {
    // Si no se pudo borrar, el siguiente arranque lo reconoce como abandonado
  }
}

function startHeartbeat(lockPath: string, info: LockInfo): NodeJS.Timeout {
  const timer = setInterval(() => {
    const now = new Date();
    try {
      fs.utimesSync(lockPath, now, now);
    } catch (error) {
      // Alguien borró el candado: se vuelve a poner para que otra copia no use la carpeta a la vez
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        try {
          fs.writeFileSync(lockPath, JSON.stringify(info), { flag: 'wx' });
        } catch {
          // ya lo puso alguien más; no hay nada mejor que hacer aquí
        }
      }
    }
  }, LOCK_REFRESH_MS);
  timer.unref();
  return timer;
}

/** Toma el candado de la carpeta o lanza DataFolderError con un mensaje en español si otro la usa. */
export function lockDataFolder(dir: string, who: LockOwner): FolderLock {
  const lockPath = path.join(dir, LOCK_FILE);
  const existing = heldLocks.get(lockPath);
  if (existing) return { path: lockPath, release: () => releaseLock(lockPath) };

  const info: LockInfo = {
    pid: process.pid,
    hostname: os.hostname(),
    startedAt: new Date().toISOString(),
    who,
    token: `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  };

  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      fs.writeFileSync(lockPath, JSON.stringify(info), { flag: 'wx' });
      installExitHook();
      heldLocks.set(lockPath, { lockPath, timer: startHeartbeat(lockPath, info), info });
      return { path: lockPath, release: () => releaseLock(lockPath) };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EEXIST') {
        throw new DataFolderError(`No se pudo crear el candado de la base de datos (${lockPath}): ${code ?? (error as Error).message}. Revisa los permisos de la carpeta.`);
      }
    }

    const current = readLock(lockPath);
    if (!current) continue; // lo acaban de borrar: otro intento
    if (!lockIsStale(current.info, current.mtimeMs)) throw new DataFolderError(heldMessage(lockPath, current.info, who));

    // Abandonado (BotM se cerró de golpe): se aparta con un rename, que solo puede hacer un proceso,
    // y se comprueba que lo apartado sea el mismo candado viejo que se revisó
    const aside = `${lockPath}.${process.pid}.${Date.now()}.viejo`;
    try {
      fs.renameSync(lockPath, aside);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw new DataFolderError(`No se pudo quitar el candado viejo ${lockPath}: ${(error as Error).message}. Bórralo a mano y vuelve a intentarlo.`);
    }
    let movedRaw: string | null = null;
    try {
      movedRaw = fs.readFileSync(aside, 'utf8');
    } catch {
      movedRaw = null;
    }
    if (movedRaw !== current.raw && !fs.existsSync(lockPath)) {
      // Otro proceso tomó la carpeta justo ahora: se le devuelve su candado
      try {
        fs.renameSync(aside, lockPath);
      } catch {
        // nada
      }
      continue;
    }
    fs.rmSync(aside, { force: true });
  }
  throw new DataFolderError(`No se pudo tomar el candado de la base de datos (${lockPath}). Cierra las otras ventanas de BotM y vuelve a intentarlo.`);
}

// ---------------------------------------------------------------------------------------------
// Preparar la carpeta
// ---------------------------------------------------------------------------------------------

/** Versión de PostgreSQL que trae la PGlite de BotM (@electric-sql/pglite 0.4.x). */
export const EMBEDDED_PG_MAJOR = '17';

export interface OpenedDataFolder {
  dir: string;
  lock: FolderLock;
  /** true si la carpeta no tiene una base todavía (se va a crear). */
  isNew: boolean;
  /** true si la última vez se cortó la creación de la base y se empezó de nuevo. */
  restartedCreation: boolean;
  /** Llamar cuando la base nueva quedó creada con sus tablas. */
  markCreated(): void;
}

function mkdirError(dir: string, error: NodeJS.ErrnoException): DataFolderError {
  switch (error.code) {
    case 'EACCES':
    case 'EPERM':
      return new DataFolderError(`No hay permiso para crear o usar la carpeta de la base de datos (${dir}). Elige otra carpeta con DATABASE_DIR en el archivo .env.`);
    case 'ENOTDIR':
    case 'EEXIST':
      return new DataFolderError(`La ruta de la base de datos (${dir}) ya existe pero es un archivo, no una carpeta. Elige otra con DATABASE_DIR en el archivo .env.`);
    case 'ENOSPC':
      return new DataFolderError(`No queda espacio en el disco para la base de datos (${dir}).`);
    default:
      return new DataFolderError(`No se pudo crear la carpeta de la base de datos (${dir}): ${error.code ?? error.message}.`);
  }
}

/**
 * Crea la carpeta si falta, toma el candado y revisa qué hay dentro:
 * - una base de PGlite (archivo PG_VERSION) de la versión correcta → se usa;
 * - nada → se va a crear una base nueva;
 * - otros archivos → no se toca (podrían ser tuyos).
 * Lanza DataFolderError (con el candado ya soltado) si algo no está bien.
 */
export function openDataFolder(dir: string, who: LockOwner): OpenedDataFolder {
  try {
    fs.mkdirSync(dir, { recursive: true });
    if (!fs.statSync(dir).isDirectory()) throw Object.assign(new Error('not a directory'), { code: 'ENOTDIR' });
  } catch (error) {
    throw mkdirError(dir, error as NodeJS.ErrnoException);
  }

  const lock = lockDataFolder(dir, who);
  try {
    const markerPath = path.join(dir, INIT_MARKER);
    const entries = fs.readdirSync(dir).filter((name) => {
      const lower = name.toLowerCase();
      return name !== LOCK_FILE && name !== INIT_MARKER && !OS_JUNK.has(lower) && !lower.startsWith(`${LOCK_FILE}.`);
    });

    let restartedCreation = false;
    if (fs.existsSync(markerPath)) {
      // La creación anterior se cortó (se cerró la ventana a mitad): la carpeta estaba vacía antes,
      // así que no hay nada tuyo aquí. Se borra lo que quedó a medias y se crea de nuevo.
      for (const name of entries) fs.rmSync(path.join(dir, name), { recursive: true, force: true });
      restartedCreation = true;
      entries.length = 0;
    }

    const isNew = entries.length === 0;
    if (!isNew) {
      const versionFile = path.join(dir, 'PG_VERSION');
      if (!fs.existsSync(versionFile)) {
        throw new DataFolderError(
          `La carpeta ${dir} tiene archivos pero no es una base de datos de BotM (no tiene el archivo PG_VERSION). ` +
          'Para no mezclarse con tus archivos, BotM no la usa: elige una carpeta vacía en DATABASE_DIR (archivo .env) o vacía esa carpeta.'
        );
      }
      const version = fs.readFileSync(versionFile, 'utf8').trim();
      if (version !== EMBEDDED_PG_MAJOR) {
        throw new DataFolderError(
          `La base de datos de ${dir} es de PostgreSQL ${version || '?'} y esta versión de BotM usa PostgreSQL ${EMBEDDED_PG_MAJOR}, así que no puede abrirla. ` +
          'Vuelve a la versión de BotM con la que la creaste, o pide ayuda para pasar los datos (hay que exportarlos e importarlos).'
        );
      }
    }

    if (isNew) fs.writeFileSync(markerPath, 'BotM está creando la base de datos. Si este archivo sigue aquí, la creación se cortó y BotM la empieza de nuevo.\n');

    return {
      dir,
      lock,
      isNew,
      restartedCreation,
      markCreated: () => fs.rmSync(markerPath, { force: true }),
    };
  } catch (error) {
    lock.release();
    if (error instanceof DataFolderError) throw error;
    throw new DataFolderError(`No se pudo revisar la carpeta de la base de datos (${dir}): ${(error as Error).message}`);
  }
}

/** ¿Hay una base de BotM en esa carpeta? (para avisar si quedó una en la otra ubicación) */
export function hasDatabase(dir: string | null): boolean {
  if (!dir) return false;
  try {
    return fs.existsSync(path.join(dir, 'PG_VERSION'));
  } catch {
    return false;
  }
}
