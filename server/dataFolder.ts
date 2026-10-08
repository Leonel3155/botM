// Carpeta y candado de la base de datos integrada (PGlite).
//
// Solo usa módulos de Node y ningún alias (@shared…): lo importan server/db.ts (BotM con tsx, o ya
// compilado dentro de dist/index.js) y drizzle.config.ts (npm run db:push). Por eso tiene que estar
// directamente en server/: así la carpeta principal del proyecto es siempre la de arriba.
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
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
  | { kind: 'embedded'; ignoredUrl: boolean; exampleUrl: boolean }
  | { kind: 'url'; url: string }
  | { kind: 'invalid'; message: string };

/**
 * ¿DATABASE_URL tiene el texto de ejemplo que traían versiones anteriores de .env.example o del README?
 * Quien copió ese .env.example lo sigue teniendo después de actualizar (actualizar no cambia su .env), y
 * no es una base de verdad: se trata como vacía para que BotM use su propia base de datos.
 */
function isExampleUrl(url: string): boolean {
  // Incluye el ejemplo en inglés (ep-example-…) de los .env.example de los bots viejos
  return /^la_connection_string/i.test(url) || /@ep-(ejemplo|example)[-.][^/]*\.neon\.tech\b/i.test(url);
}

/** Aviso cuando DATABASE_URL tenía el ejemplo y BotM usa su propia base de datos. */
export const EXAMPLE_URL_WARNING =
  '⚠️ DATABASE_URL tenía el ejemplo de .env.example, que no es una base de datos de verdad: se usa la base de datos de BotM. ' +
  'Borra esa línea del archivo .env o déjala vacía (DATABASE_URL=) para que este aviso no salga más.';

/**
 * Sin DATABASE_URL BotM usa su propia base de datos (PGlite) en una carpeta. Con DATABASE_URL se conecta
 * a ese PostgreSQL como siempre. DATABASE_DRIVER=pglite fuerza la base integrada aunque haya DATABASE_URL.
 */
export function databaseMode(env: NodeJS.ProcessEnv = process.env): DatabaseMode {
  const raw = env.DATABASE_URL?.trim() ?? '';
  const exampleUrl = isExampleUrl(raw);
  const url = exampleUrl ? '' : raw;
  const forced = env.DATABASE_DRIVER?.trim().toLowerCase() ?? '';
  if (forced === 'pglite') return { kind: 'embedded', ignoredUrl: url !== '', exampleUrl };
  if (url) return { kind: 'url', url };
  if (forced === 'neon' || forced === 'pg') {
    return {
      kind: 'invalid',
      message:
        `DATABASE_DRIVER=${forced} necesita DATABASE_URL (la dirección de tu base PostgreSQL) y ` +
        (exampleUrl ? 'todavía tiene el ejemplo de .env.example. ' : 'está vacía. ') +
        'Pon DATABASE_URL en el archivo .env, o borra DATABASE_DRIVER para que BotM use su propia base de datos.',
    };
  }
  return { kind: 'embedded', ignoredUrl: false, exampleUrl };
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
// Hay dos candados:
// - El del sistema (Windows y Linux): un "named pipe" (Windows) o un socket abstracto (Linux) con un
//   nombre que sale de la ruta de la carpeta. Solo un proceso puede tenerlo; el sistema lo suelta solo
//   cuando ese proceso termina (aunque se cierre de golpe o se apague la computadora) y nunca mientras
//   siga vivo, aunque esté congelado (suspensión, texto seleccionado en la consola, un depurador). Así no
//   hay que adivinar nada por el tiempo ni por el número de proceso (Windows los reutiliza).
// - El archivo botm.lock dentro de la carpeta, con el proceso que la usa: sirve para el mensaje ("BotM ya
//   está abierto…"), para Mac (no tiene candado del sistema) y para otra computadora que use la misma
//   carpeta por la red. Un archivo que quedó de un proceso que ya no existe se aparta solo.
// ---------------------------------------------------------------------------------------------

export const LOCK_FILE = 'botm.lock';
// Existe solo mientras se crea una base nueva: si sigue ahí al arrancar, esa creación se cortó a medias
const INIT_MARKER = 'botm-creando-base.tmp';
// Para que la base nunca termine en un repositorio (por ejemplo con DATABASE_DIR=datos dentro del proyecto)
const IGNORE_FILE = '.gitignore';
const LOCK_REFRESH_MS = 30_000;
// Solo para un candado de otra computadora (no se puede saber si ese proceso sigue vivo)
const LOCK_STALE_MS = 2 * 60_000;
// Lo que espera a que alguien termine de escribir un candado recién creado
const LOCK_WRITE_GRACE_MS = 5_000;
// Archivos que Windows o Mac crean solos en cualquier carpeta
const OS_JUNK = new Set(['desktop.ini', 'thumbs.db', '.ds_store']);

export type LockOwner = 'BotM' | 'db:push';

interface LockInfo {
  pid: number;
  hostname: string;
  startedAt: string;
  who: LockOwner;
  token: string;
  /** Nombre del candado del sistema que tiene ese proceso (no está si no tiene uno). */
  systemLock?: string;
}

export interface FolderLock {
  readonly path: string;
  release(): void;
}

interface HeldLock {
  dir: string;
  timer: NodeJS.Timeout;
  info: LockInfo;
  systemLock: net.Server | null;
}

const heldLocks = new Map<string, HeldLock>();
let exitHookInstalled = false;

// ----- Candado del sistema ---------------------------------------------------------------------

function systemLockPrefix(): string | null {
  if (process.platform === 'win32') return '\\\\.\\pipe\\botm-db-';
  if (process.platform === 'linux') return '\0botm-db-';
  return null;
}

/** Nombre del candado del sistema para esta carpeta (la misma carpeta da el mismo nombre), o null. */
function systemLockName(dir: string): string | null {
  const prefix = systemLockPrefix();
  if (!prefix) return null;
  let real = path.resolve(dir);
  try {
    // Accesos directos, unidades de red, nombres cortos de Windows (BOTM~1)… → la ruta de verdad
    real = fs.realpathSync.native(real);
  } catch {
    // se usa la ruta tal cual
  }
  if (process.platform === 'win32') real = real.toLowerCase();
  return prefix + crypto.createHash('sha256').update(real).digest('hex').slice(0, 32);
}

/** Toma el candado del sistema con ese nombre, o null si no se pudo (lo tiene otro o aquí no funciona). */
function trySystemLock(name: string): net.Server | null {
  const server = net.createServer((socket) => socket.destroy());
  // Si falla, el error llega después por este evento; lo que importa ya se sabe con server.listening
  server.on('error', () => {});
  try {
    server.listen({ path: name }); // reservar el nombre es inmediato (síncrono)
  } catch {
    return null;
  }
  if (!server.listening) return null;
  server.unref(); // no impide que el proceso termine
  return server;
}

/** ¿Funciona el candado del sistema aquí? (se prueba con un nombre que nadie más usa) */
function systemLocksWork(): boolean {
  const prefix = systemLockPrefix();
  if (!prefix) return false;
  const probe = trySystemLock(`${prefix}prueba-${process.pid}-${crypto.randomBytes(6).toString('hex')}`);
  probe?.close();
  return probe !== null;
}

// ----- Archivo botm.lock -----------------------------------------------------------------------

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

/** Por qué se considera que la carpeta está en uso (cambia el consejo del mensaje). */
type HeldReason = 'system' | 'process' | 'other-host';

/**
 * ¿El archivo botm.lock que encontramos ya no vale? null = sí, se puede apartar. Si no, por qué sigue en uso.
 * mySystemLock: el nombre del candado del sistema que ya tenemos (null si aquí no hay).
 */
function lockStillHeld(info: LockInfo | null, mtimeMs: number, mySystemLock: string | null): HeldReason | null {
  const age = Date.now() - mtimeMs;
  // Recién creado y todavía sin contenido: le damos unos segundos a quien lo está escribiendo. Con el
  // candado del sistema en la mano nadie de esta computadora puede estar escribiéndolo.
  if (!info) return mySystemLock || age > LOCK_WRITE_GRACE_MS ? null : 'process';
  // Otra computadora (carpeta compartida por la red): no se puede saber si ese proceso sigue vivo, solo
  // si dejó de renovar el candado
  if (info.hostname !== os.hostname()) return age > LOCK_STALE_MS ? null : 'other-host';
  if (info.pid === process.pid) return null; // un proceso anterior que tenía nuestro mismo número
  if (mySystemLock && info.systemLock) {
    // Tenemos el candado del sistema: quien escribió este archivo ya terminó…
    if (info.systemLock === mySystemLock) return null;
    // …salvo que haya abierto la misma carpeta con otra ruta: se comprueba su candado
    const theirs = trySystemLock(info.systemLock);
    theirs?.close();
    return theirs ? null : 'system';
  }
  // Sin candado del sistema solo queda el número de proceso. Nunca por tiempo: un BotM congelado o con
  // la computadora suspendida sigue vivo y volvería a escribir en la carpeta al despertar.
  return processIsAlive(info.pid) ? 'process' : null;
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '?' : date.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
}

function heldMessage(lockPath: string, holder: LockInfo | null, me: LockOwner, reason: HeldReason): string {
  const where = holder && holder.hostname !== os.hostname() ? ` en la computadora "${holder.hostname}"` : '';
  const since = holder ? ` (proceso ${holder.pid}${where}, desde las ${formatTime(holder.startedAt)})` : '';
  let hint: string;
  if (reason === 'system') {
    // Seguro que sigue abierto: borrar el archivo o esperar no cambiaría nada
    const pid = holder && !where ? ` ${holder.pid}` : '';
    hint = process.platform === 'win32'
      ? ` Si no encuentras esa ventana, en el Administrador de tareas (Ctrl + Shift + Esc) → Detalles, termina node.exe${pid ? ` con PID${pid}` : ''}.`
      : ` Si no encuentras esa ventana, termina el proceso${pid ? ` (kill${pid})` : ''}.`;
  } else if (reason === 'process') {
    // Ese número de proceso existe, pero podría ser otro programa que heredó el número
    hint = ` Si estás seguro de que no hay nada abierto, borra el archivo ${lockPath} y vuelve a intentarlo.`;
  } else {
    hint = ` Si estás seguro de que no hay nada abierto, espera 2 minutos y vuelve a intentarlo, o borra el archivo ${lockPath}.`;
  }
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
  held.systemLock?.close();
}

/**
 * Otro proceso se quedó con la carpeta (solo puede pasar sin candado del sistema: Mac, o desde otra
 * computadora). Seguir escribiendo dañaría la base: se sale ya, sin cerrarla (cerrarla también escribe)
 * y sin tocar el candado del otro.
 */
function lockLost(lockPath: string, holder: LockInfo): void {
  const held = heldLocks.get(lockPath);
  if (!held) return;
  heldLocks.delete(lockPath);
  clearInterval(held.timer);
  const where = holder.hostname !== os.hostname() ? ` en la computadora "${holder.hostname}"` : '';
  const other = holder.who === 'db:push' ? '"npm run db:push"' : 'Otra copia de BotM';
  console.error(
    `❌ ${other} (proceso ${holder.pid}${where}) tomó la carpeta de la base de datos (${held.dir}) mientras este ` +
    `proceso estaba detenido. ${held.info.who === 'db:push' ? '"npm run db:push"' : 'BotM'} se cierra ya, sin escribir nada más, para no dañar la base de datos. ` +
    'Deja abierta una sola ventana de BotM.'
  );
  process.exit(1);
}

function startHeartbeat(lockPath: string, info: LockInfo): NodeJS.Timeout {
  const timer = setInterval(() => {
    let current;
    try {
      current = readLock(lockPath);
    } catch {
      return; // no se pudo leer ahora; el próximo intento
    }
    if (!current) {
      // Alguien borró el candado: se vuelve a poner para que otra copia no use la carpeta a la vez
      try {
        fs.writeFileSync(lockPath, JSON.stringify(info), { flag: 'wx' });
      } catch {
        // ya lo puso alguien más: lo revisa la próxima vuelta
      }
      return;
    }
    // Nunca se renueva el candado de otro: si cambió de dueño, este proceso se va
    if (current.info && current.info.token !== info.token) return lockLost(lockPath, current.info);
    if (!current.info) return; // a medio escribir: el próximo intento
    const now = new Date();
    try {
      fs.utimesSync(lockPath, now, now);
    } catch {
      // el próximo intento
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

  // 1. Candado del sistema (Windows y Linux). Si no se puede tomar porque otro lo tiene, ese proceso
  //    está vivo seguro: se avisa sin mirar nada más.
  const systemName = systemLockName(dir);
  let systemLock = systemName ? trySystemLock(systemName) : null;
  if (systemName && !systemLock) {
    if (systemLocksWork()) {
      throw new DataFolderError(heldMessage(lockPath, readLock(lockPath)?.info ?? null, who, 'system'));
    }
    // Aquí no funciona (raro): solo queda el archivo
  }
  const mySystemLock = systemLock ? systemName : null;

  const info: LockInfo = {
    pid: process.pid,
    hostname: os.hostname(),
    startedAt: new Date().toISOString(),
    who,
    token: `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    ...(mySystemLock ? { systemLock: mySystemLock } : {}),
  };

  // 2. Archivo botm.lock
  try {
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        fs.writeFileSync(lockPath, JSON.stringify(info), { flag: 'wx' });
        installExitHook();
        heldLocks.set(lockPath, { dir, info, systemLock, timer: startHeartbeat(lockPath, info) });
        systemLock = null; // ya es de heldLocks: se suelta con release()
        return { path: lockPath, release: () => releaseLock(lockPath) };
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== 'EEXIST') {
          throw new DataFolderError(`No se pudo crear el candado de la base de datos (${lockPath}): ${code ?? (error as Error).message}. Revisa los permisos de la carpeta.`);
        }
      }

      const current = readLock(lockPath);
      if (!current) continue; // lo acaban de borrar: otro intento
      const heldBy = lockStillHeld(current.info, current.mtimeMs, mySystemLock);
      if (heldBy) throw new DataFolderError(heldMessage(lockPath, current.info, who, heldBy));

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
  } finally {
    systemLock?.close(); // no se pudo tomar la carpeta: se suelta también el del sistema
  }
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
      return (
        name !== LOCK_FILE && name !== INIT_MARKER && name !== IGNORE_FILE &&
        !OS_JUNK.has(lower) && !lower.startsWith(`${LOCK_FILE}.`)
      );
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
    // Si la carpeta queda dentro de un repositorio (DATABASE_DIR relativa), que nunca se suba con el código
    const ignorePath = path.join(dir, IGNORE_FILE);
    if (!fs.existsSync(ignorePath)) {
      try {
        fs.writeFileSync(ignorePath, '# Base de datos de BotM: no se sube al repositorio\n*\n');
      } catch {
        // no es imprescindible
      }
    }

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
