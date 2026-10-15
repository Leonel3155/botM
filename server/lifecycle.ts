// Reinicio de BotM desde dentro (por ejemplo después de /actualizar).
//
// scripts/launcher.mjs ("npm run dev" y "npm start") vuelve a abrir BotM cuando sale con
// RESTART_EXIT_CODE. server/index.ts registra aquí su apagado ordenado, que cierra el bot y la base
// de datos antes de salir, así la nueva copia encuentra la base libre.

export const RESTART_EXIT_CODE = 75;

let shutdownHandler: ((exitCode: number) => Promise<void>) | null = null;

export function setShutdownHandler(handler: (exitCode: number) => Promise<void>): void {
  shutdownHandler = handler;
}

/** BotM se abrió con el lanzador, que lo vuelve a abrir solo al reiniciar. */
export function canRestartItself(): boolean {
  return process.env.BOTM_LAUNCHER === '1';
}

/** Cierra BotM en orden y pide al lanzador que lo abra otra vez. */
export function requestRestart(): void {
  if (!shutdownHandler) {
    console.error('⚠️ No se puede reiniciar: el apagado ordenado no está registrado.');
    return;
  }
  console.log('🔄 Reiniciando BotM para usar la versión nueva…');
  void shutdownHandler(RESTART_EXIT_CODE);
}
