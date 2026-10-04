/**
 * Recuperación cuando falla la descarga de una sección del panel.
 *
 * Las secciones se cargan al abrirlas (React.lazy). Si el panel se actualizó
 * mientras había una pestaña abierta, los archivos viejos ya no existen y la
 * descarga falla; lo mismo con un corte de red en el móvil. En esos casos lo
 * mejor es recargar la página, pero solo una vez seguida para no entrar en bucle.
 */

const RELOAD_KEY = "botm:chunk-reload-at";
/** Si ya recargamos hace menos de esto, no volvemos a hacerlo solos */
const RELOAD_COOLDOWN_MS = 30_000;

/** Errores que Vite avisó como fallo al cargar una sección (más fiable que el texto) */
const viteImportErrors = new WeakSet<object>();

// Mensajes de los navegadores cuando falla un import() dinámico o su CSS
// (Chrome / Firefox / Safari / CSS de la sección)
const CHUNK_ERROR_PATTERN =
  /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS/i;

/** ¿El error viene de no poder descargar una sección (y no de un fallo dentro de ella)? */
export function isChunkLoadError(error: unknown): boolean {
  if (typeof error === "object" && error !== null && viteImportErrors.has(error)) return true;
  return error instanceof Error && CHUNK_ERROR_PATTERN.test(error.message);
}

/**
 * Recarga la página si no lo hicimos hace poco y hay conexión.
 * Devuelve true si va a recargar.
 */
export function reloadOnceForChunkError(): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return false;

  try {
    const last = Number(window.sessionStorage.getItem(RELOAD_KEY));
    if (Number.isFinite(last) && last > 0 && Date.now() - last < RELOAD_COOLDOWN_MS) return false;
    window.sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    // Sin sessionStorage no podemos saber si ya recargamos: mejor no arriesgarse a un bucle
    return false;
  }

  window.location.reload();
  return true;
}

/**
 * Vite lanza "vite:preloadError" cuando falla la carga de una sección. Solo la
 * marcamos: el error sigue su camino hasta el ErrorBoundary, que decide si recargar.
 */
export function watchChunkLoadErrors() {
  if (typeof window === "undefined") return;
  window.addEventListener("vite:preloadError", (event) => {
    const payload = (event as Event & { payload?: unknown }).payload;
    if (typeof payload === "object" && payload !== null) viteImportErrors.add(payload);
  });
}
