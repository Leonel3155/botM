// Lanzador de BotM: "npm run dev" y "npm start" pasan por aquí.
//
// Abre BotM como proceso hijo y, si sale con el código 75 (lo pide /actualizar después de bajar la
// versión nueva), lo vuelve a abrir. Con cualquier otro código termina igual que BotM.
//
// Ctrl + C: en la consola lo reciben los dos procesos. Este lanzador lo ignora y solo espera a que
// BotM se cierre por su cuenta (cierra la base de datos integrada limpia). No le reenvía señales: en
// Windows eso lo terminaría de golpe.
//
// Uso: node scripts/launcher.mjs dev | prod
import { spawn } from 'node:child_process';

const RESTART_EXIT_CODE = 75;
const mode = process.argv[2] === 'prod' ? 'prod' : 'dev';

const nodeArgs = mode === 'prod'
  ? ['--import', './scripts/env-production.mjs', 'dist/index.js']
  : ['--import', './scripts/env-development.mjs', '--import', 'tsx', 'server/index.ts'];

const ignoredSignals = process.platform === 'win32'
  ? ['SIGINT', 'SIGTERM', 'SIGBREAK', 'SIGHUP']
  : ['SIGINT', 'SIGTERM'];

let child = null;
for (const signal of ignoredSignals) {
  process.on(signal, () => {
    // En Linux/macOS un "kill" al lanzador (p. ej. el hosting) sí se pasa a BotM para que se cierre en orden
    if (process.platform !== 'win32' && signal === 'SIGTERM' && child) child.kill(signal);
  });
}

function start() {
  child = spawn(process.execPath, nodeArgs, {
    stdio: 'inherit',
    env: { ...process.env, BOTM_LAUNCHER: '1' },
  });
  child.on('error', (error) => {
    console.error('❌ No se pudo abrir BotM:', error);
    process.exit(1);
  });
  child.on('exit', (code, signal) => {
    if (code === RESTART_EXIT_CODE) {
      console.log('🔄 Abriendo BotM otra vez…');
      start();
      return;
    }
    process.exit(code ?? (signal ? 1 : 0));
  });
}

start();
