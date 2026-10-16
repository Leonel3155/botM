// Actualizar BotM desde Discord (/actualizar) o solo al arrancar (AUTO_UPDATE=1).
//
// Baja los cambios de GitHub con "git pull --ff-only" (nunca pisa cambios hechos a mano), instala
// dependencias si cambió package-lock.json, compila si BotM corre en modo producción, y reinicia con el
// lanzador (scripts/launcher.mjs). Si algo falla, BotM sigue con la versión que tenía.
import { execFile } from 'node:child_process';
import { canRestartItself, requestRestart } from '../../lifecycle';
import { databaseMode } from '../../dataFolder';

// npm run dev / npm start abren BotM desde la carpeta del proyecto
const PROJECT_ROOT = process.cwd();
const GIT_TIMEOUT_MS = 60_000;
const NPM_TIMEOUT_MS = 10 * 60_000;
// Después de revisar, se espera un rato antes de volver a preguntar a GitHub
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

export class UpdateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UpdateError';
  }
}

interface RunResult { stdout: string; stderr: string }

function run(command: string, args: string[], timeout: number): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    // En Windows npm es npm.cmd, y Node solo abre archivos .cmd a través de la consola (shell)
    const useShell = process.platform === 'win32' && command === 'npm';
    execFile(useShell ? 'npm.cmd' : command, args, {
      cwd: PROJECT_ROOT,
      timeout,
      windowsHide: true,
      shell: useShell,
      maxBuffer: 10 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    }, (error, stdout, stderr) => {
      if (error) {
        const detail = (stderr || stdout || error.message).toString().trim().split('\n').slice(-3).join(' ');
        reject(Object.assign(error, { detail }));
        return;
      }
      resolve({ stdout: stdout.toString(), stderr: stderr.toString() });
    });
  });
}

function git(args: string[]) {
  return run('git', args, GIT_TIMEOUT_MS).then((result) => result.stdout.trim());
}

function explainGitError(error: unknown): string {
  const err = error as { code?: unknown; detail?: string; killed?: boolean };
  if (err.code === 'ENOENT') return 'No encontré Git en esta computadora. Instálalo (paso 1 del README) y reinicia BotM.';
  if (err.killed) return 'GitHub tardó demasiado en responder. Revisa tu internet e intenta de nuevo.';
  const detail = err.detail ?? '';
  if (/not a git repository/i.test(detail)) return 'Esta carpeta de BotM no se descargó con Git, así que no se puede actualizar sola. Descárgala con "git clone" (paso 2 del README).';
  if (/no upstream|no tracking information/i.test(detail)) return 'La rama de BotM no está conectada con GitHub. En la carpeta de BotM corre "git pull" una vez a mano.';
  if (/could not resolve host|unable to access|failed to connect/i.test(detail)) return 'No pude conectarme a GitHub. Revisa tu internet e intenta de nuevo.';
  if (/authentication|could not read username|permission denied/i.test(detail)) return 'GitHub pidió iniciar sesión. Corre "git pull" una vez a mano en la carpeta de BotM para guardar tu cuenta.';
  return `Git dio un error: ${detail || String(error)}`;
}

export interface UpdateStatus {
  branch: string;
  current: string;
  /** Cambios nuevos en GitHub que todavía no están aquí (el más nuevo primero). */
  pending: string[];
  /** Archivos del proyecto cambiados a mano (impiden actualizar solo). */
  localChanges: string[];
  /** npm install reescribió package-lock.json: no cuenta como cambio a mano, se descarta al actualizar. */
  lockfileChanged: boolean;
}

let lastStatus: { at: number; status: UpdateStatus } | null = null;

/** Pregunta a GitHub si hay versión nueva. Lanza UpdateError con el motivo en español. */
export async function checkForUpdate(): Promise<UpdateStatus> {
  try {
    const branch = await git(['rev-parse', '--abbrev-ref', 'HEAD']);
    if (branch === 'HEAD') throw new UpdateError('Esta copia de BotM no está en una rama (git checkout), así que no se puede actualizar sola.');
    await git(['fetch', '--quiet']);
    const current = await git(['rev-parse', '--short', 'HEAD']);
    const log = await git(['log', '--format=%s', 'HEAD..@{u}']);
    // Sin trim(): cada línea es "XY archivo" y X puede ser un espacio (" M package-lock.json")
    const changes = (await run('git', ['status', '--porcelain', '--untracked-files=no'], GIT_TIMEOUT_MS)).stdout;
    const changedFiles = changes.split('\n').filter((line) => line.length > 3).map((line) => line.slice(3));
    const status: UpdateStatus = {
      branch,
      current,
      pending: log ? log.split('\n').filter(Boolean) : [],
      localChanges: changedFiles.filter((file) => file !== 'package-lock.json'),
      lockfileChanged: changedFiles.includes('package-lock.json'),
    };
    lastStatus = { at: Date.now(), status };
    return status;
  } catch (error) {
    if (error instanceof UpdateError) throw error;
    throw new UpdateError(explainGitError(error));
  }
}

/** Lo último que se supo (para /selftest), sin volver a preguntar a GitHub. */
export function lastUpdateStatus(): { at: number; status: UpdateStatus } | null {
  return lastStatus;
}

export interface UpdateResult {
  installed: string[];
  dependencies: boolean;
  /** Con DATABASE_URL y tablas cambiadas: antes de abrir BotM hay que correr "npm run db:push". */
  needsDbPush: boolean;
  /** Se va a reiniciar solo; si es false, hay que cerrar y abrir BotM a mano. */
  restarting: boolean;
}

let updating = false;

/** Baja la versión nueva, instala lo que haga falta y reinicia. */
export async function applyUpdate(): Promise<UpdateResult> {
  if (updating) throw new UpdateError('Ya estoy actualizando. Espera a que termine.');
  updating = true;
  try {
    const status = await checkForUpdate();
    if (status.pending.length === 0) return { installed: [], dependencies: false, needsDbPush: false, restarting: false };
    if (status.localChanges.length > 0) {
      const files = status.localChanges.slice(0, 5).join(', ');
      throw new UpdateError(`Hay archivos de BotM cambiados a mano (${files}) y no quiero pisarlos. Guárdalos en otro lado o deshazlos con "git checkout -- ." y vuelve a intentar.`);
    }
    // npm install a veces reescribe package-lock.json por su cuenta: ese cambio se puede descartar
    // (desde HEAD, para que también se vaya si quedó en el índice con "git add")
    if (status.lockfileChanged) await git(['checkout', 'HEAD', '--', 'package-lock.json']);

    const before = await git(['rev-parse', 'HEAD']);
    try {
      await git(['pull', '--ff-only', '--quiet']);
    } catch (error) {
      const detail = (error as { detail?: string }).detail ?? '';
      if (/not possible to fast-forward|diverging/i.test(detail)) {
        throw new UpdateError('Tu copia de BotM tiene cambios propios que no están en GitHub, así que no la actualizo sola para no mezclarlos. Actualízala a mano con "git pull".');
      }
      throw new UpdateError(explainGitError(error));
    }

    const changedFiles = await git(['diff', '--name-only', before, 'HEAD']);
    const dependencies = /^(package\.json|package-lock\.json)$/m.test(changedFiles);
    try {
      if (dependencies) {
        console.log('📦 Instalando las dependencias nuevas (npm install)…');
        // --include=dev: con NODE_ENV=production (npm start) npm se saltaría vite/esbuild y el build fallaría
        await run('npm', ['install', '--include=dev', '--no-audit', '--no-fund'], NPM_TIMEOUT_MS);
      }
      if (process.env.NODE_ENV === 'production') {
        console.log('🛠️ Compilando la versión nueva (npm run build)…');
        await run('npm', ['run', 'build'], NPM_TIMEOUT_MS);
      }
    } catch (error) {
      const detail = (error as { detail?: string }).detail ?? String(error);
      throw new UpdateError(`Bajé la versión nueva pero falló la instalación (${detail}). Cierra BotM y corre "npm install" a mano antes de abrirlo.`);
    }

    console.log(`✅ BotM actualizado: ${status.pending.length} cambio(s) nuevo(s).`);
    // La base integrada pone sus tablas al día sola; una base externa necesita db:push (que pregunta)
    const needsDbPush = databaseMode().kind === 'url' && /^shared\/schema\.ts$/m.test(changedFiles);
    if (needsDbPush) console.log('⚠️ Cambiaron las tablas: cierra BotM, corre "npm run db:push" y vuelve a abrirlo.');
    const restarting = canRestartItself() && !needsDbPush;
    if (restarting) {
      // Un momento para que el mensaje de Discord alcance a salir
      setTimeout(requestRestart, 3_000).unref();
    } else if (!needsDbPush) {
      console.log('ℹ️ Cierra BotM (Ctrl + C) y vuelve a abrirlo con "npm run dev" para usar la versión nueva.');
    }
    return { installed: status.pending, dependencies, needsDbPush, restarting };
  } finally {
    updating = false;
  }
}

/**
 * Al arrancar (y cada 6 horas): avisa en la consola si hay versión nueva. Con AUTO_UPDATE=1 en el .env
 * la instala sola. Nunca lanza.
 */
export function startUpdateChecks(): void {
  const auto = process.env.AUTO_UPDATE === '1';
  const tick = async () => {
    try {
      const status = await checkForUpdate();
      if (status.pending.length === 0) return;
      if (auto && status.localChanges.length === 0) {
        console.log(`🆕 Hay ${status.pending.length} cambio(s) nuevo(s) en GitHub; actualizando solo (AUTO_UPDATE=1)…`);
        await applyUpdate();
      } else {
        console.log(`🆕 Hay ${status.pending.length} cambio(s) nuevo(s) de BotM en GitHub. Usa /actualizar ahora en Discord para instalarlos.`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`⚠️ No pude revisar si hay versión nueva de BotM: ${message}`);
    }
  };
  void tick();
  setInterval(() => void tick(), CHECK_INTERVAL_MS).unref();
}
