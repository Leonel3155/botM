import { QueryClient, type QueryFunction, type QueryKey } from "@tanstack/react-query";

// =============================================
// Errores de la API
// =============================================

/** Clave de react-query del estado de sesión (GET /api/auth/status). */
export const AUTH_STATUS_KEY = ["/api/auth/status"] as const;

/** Clave de react-query de los servidores que la persona administra (GET /api/user/guilds). */
export const USER_GUILDS_KEY = ["/api/user/guilds"] as const;

/** Cuerpo JSON de error que devuelve el servidor (todas las rutas usan { error, ... }). */
export interface ApiErrorBody {
  error?: string;
  /** 401: hay que volver a iniciar sesión */
  requireAuth?: boolean;
  /** 403: el usuario no administra ese servidor */
  forbidden?: boolean;
  /** 404: el bot no está en ese servidor */
  botMissing?: boolean;
  /** 400: errores de validación por campo */
  details?: { field: string; message: string }[];
  /** 503: Discord está limitando las solicitudes (segundos que sugiere Discord) */
  retryAfter?: number | null;
  /** 429: segundos que faltan para poder repetir la acción */
  retryAfterSeconds?: number;
  [key: string]: unknown;
}

export type ApiErrorKind =
  | "unauthorized" // 401
  | "forbidden" // 403 { forbidden }
  | "botMissing" // 404 { botMissing }
  | "unavailable" // 503
  | "notFound" // otros 404
  | "validation" // 400
  | "server" // 5xx y el resto
  | "network"; // no hubo respuesta

/** Textos fijos para los casos que el panel trata de forma especial. */
export const API_ERROR_TITLES: Record<ApiErrorKind, string> = {
  unauthorized: "Tu sesión expiró",
  forbidden: "No tienes permisos de administrador en este servidor",
  botMissing: "El bot no está en este servidor",
  unavailable: "El bot no está disponible ahora, intenta en un momento",
  notFound: "No encontramos lo que buscabas",
  validation: "Revisa los datos",
  server: "Algo salió mal",
  network: "No pudimos conectar con el panel",
};

/**
 * ¿El texto del servidor es el aviso genérico de "el bot no está conectado"? En ese caso
 * preferimos nuestro texto fijo; cualquier otro (p. ej. "Discord está limitando las
 * solicitudes…") explica mejor qué pasó y se muestra tal cual.
 */
function isBotUnavailableText(text: string): boolean {
  return /^el bot no est[aá]/i.test(text);
}

/** Segundos de espera que manda el servidor: retryAfterSeconds (429) o retryAfter (503 de Discord). */
function retryAfterFrom(body: ApiErrorBody | null): number | null {
  const raw = typeof body?.retryAfterSeconds === "number" ? body.retryAfterSeconds : body?.retryAfter;
  return typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? Math.ceil(raw) : null;
}

function kindFor(status: number, body: ApiErrorBody | null): ApiErrorKind {
  if (status === 0) return "network";
  if (status === 401) return "unauthorized";
  if (status === 403 && body?.forbidden) return "forbidden";
  if (status === 404 && body?.botMissing) return "botMissing";
  if (status === 404) return "notFound";
  if (status === 503) return "unavailable";
  if (status === 400) return "validation";
  return "server";
}

/**
 * Error de una petición a la API. `message` ya es un texto amable en español,
 * así que las páginas pueden mostrarlo tal cual (por ejemplo en un toast).
 */
export class ApiError extends Error {
  readonly status: number;
  readonly kind: ApiErrorKind;
  readonly body: ApiErrorBody | null;
  /**
   * Segundos que pide esperar el servidor antes de reintentar (429 de las acciones del
   * panel o 503 porque Discord está limitando las solicitudes). null si no dijo nada.
   */
  readonly retryAfterSeconds: number | null;

  constructor(status: number, body: ApiErrorBody | null) {
    const kind = kindFor(status, body);
    const serverText = typeof body?.error === "string" && body.error.trim() ? body.error.trim() : null;
    // Para estos casos el texto es siempre el mismo; para el resto, el del servidor (ya viene en español).
    // En un 503 solo usamos el fijo si el servidor no explicó nada mejor que "el bot no está conectado".
    const fixed = kind === "unauthorized" || kind === "forbidden" || kind === "botMissing" || kind === "network"
      || (kind === "unavailable" && (!serverText || isBotUnavailableText(serverText)));
    super(
      !fixed && serverText ? serverText
      : status === 429 ? "Espera un momento e intenta de nuevo."
      : `${API_ERROR_TITLES[kind]}.`,
    );
    this.name = "ApiError";
    this.status = status;
    this.kind = kind;
    this.body = body;
    this.retryAfterSeconds = retryAfterFrom(body);
  }
}

/**
 * ¿Es una espera por límite de solicitudes? 429 de las acciones del panel, o 503 porque
 * Discord está limitando (el servidor manda retryAfter, aunque sea null).
 */
export function isRateLimitError(error: unknown): error is ApiError {
  if (!isApiError(error)) return false;
  if (error.status === 429) return true;
  if (error.status !== 503 || !error.body) return false;
  const serverText = typeof error.body.error === "string" ? error.body.error.trim() : "";
  return "retryAfter" in error.body || /^discord est[aá] limitando/i.test(serverText);
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

async function readErrorBody(res: Response): Promise<ApiErrorBody | null> {
  try {
    const text = await res.text();
    if (!text) return null;
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === "object" ? (parsed as ApiErrorBody) : null;
  } catch {
    return null;
  }
}

/**
 * La sesión ya no vale (401): el panel vuelve a la pantalla de inicio de sesión.
 * App.tsx muestra el login cuando el estado de sesión dice authenticated: false.
 */
export function markSessionExpired() {
  queryClient.setQueryData(AUTH_STATUS_KEY, {
    authenticated: false,
    user: null,
    reason: "expired",
  });
}

/**
 * La lista de servidores quedó vieja: 403 (ya no administra ese servidor) o 404 con
 * botMissing (sacaron al bot). Se vuelve a pedir para que el selector deje de ofrecerlo
 * o muestre "Sin bot". cancelRefetch: false → varios errores seguidos piden la lista una sola vez.
 */
function refreshUserGuilds() {
  void queryClient.invalidateQueries({ queryKey: USER_GUILDS_KEY, exact: true }, { cancelRefetch: false });
}

async function throwIfResNotOk(res: Response) {
  if (res.ok) return;
  const error = new ApiError(res.status, await readErrorBody(res));
  if (error.kind === "unauthorized") {
    markSessionExpired();
  } else if (error.kind === "forbidden" || error.kind === "botMissing") {
    refreshUserGuilds();
  }
  throw error;
}

async function apiFetch(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, { credentials: "include", ...init });
  } catch {
    // Sin conexión, servidor caído, CORS...: no hubo respuesta HTTP
    throw new ApiError(0, null);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const res = await apiFetch(url, {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
  });

  await throwIfResNotOk(res);
  return res;
}

/** Convierte una queryKey en la URL: ['/api/levels', id, 'top'] → /api/levels/{id}/top */
export function queryKeyToPath(queryKey: QueryKey): string {
  return queryKey
    .filter((part) => typeof part === "string" || typeof part === "number")
    .join("/");
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await apiFetch(queryKeyToPath(queryKey), {});

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});

// =============================================
// Textos para mostrar un error en pantalla
// =============================================
export interface ApiErrorInfo {
  kind: ApiErrorKind | "unknown";
  status: number | null;
  title: string;
  description: string;
}

/** Título y explicación amables para cualquier error (de la API o no). */
export function getApiErrorInfo(error: unknown): ApiErrorInfo {
  if (!isApiError(error)) {
    return {
      kind: "unknown",
      status: null,
      title: API_ERROR_TITLES.server,
      description: "Intenta de nuevo en un momento. Si sigue pasando, recarga la página.",
    };
  }

  const serverText = typeof error.body?.error === "string" ? error.body.error.trim() : "";
  let description: string;
  switch (error.kind) {
    case "unauthorized":
      description = "Vuelve a iniciar sesión con Discord para seguir.";
      break;
    case "forbidden":
      description = "Necesitas ser el dueño del servidor o tener el permiso de Administrador o Gestionar servidor.";
      break;
    case "botMissing":
      description = "Invítalo a tu servidor para poder configurarlo desde aquí.";
      break;
    case "unavailable":
      // El texto del servidor solo si aporta algo (p. ej. "Discord está limitando las solicitudes")
      description = serverText && !isBotUnavailableText(serverText)
        ? serverText
        : "Puede que se esté reiniciando o que Discord esté tardando en responder.";
      break;
    case "network":
      description = "Revisa tu conexión a internet e intenta de nuevo.";
      break;
    default:
      description = serverText || "Intenta de nuevo en un momento.";
  }

  // Límite de solicitudes: el título dice que basta con esperar (el kind no cambia)
  let title: string = API_ERROR_TITLES[error.kind];
  if (isRateLimitError(error)) {
    title = error.status === 429 ? "Espera un momento" : "Discord nos pidió esperar un momento";
    if (!serverText) description = "Intenta de nuevo en unos segundos.";
  }

  return { kind: error.kind, status: error.status, title, description };
}
