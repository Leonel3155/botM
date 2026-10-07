import { useEffect, useSyncExternalStore } from "react";
import type { WsServerMessage } from "@shared/api";
import { AUTH_STATUS_KEY, USER_GUILDS_KEY, queryClient, queryKeyToPath } from "./queryClient";

/**
 * Tiempo real del panel (WebSocket en /ws).
 *
 * El servidor solo acepta la conexión con una sesión válida. Tras conectar se
 * manda { type: 'join', guildId } y el servidor responde { type: 'joined' } o
 * { type: 'error', status, error }. Después avisa de cambios del servidor
 * elegido (los avisos de WsServerMessage en shared/api.ts) y aquí se invalidan
 * las consultas de react-query que correspondan (ver GUILD_INVALIDATIONS).
 *
 * Un "error" con 400/403 es definitivo (id no válido, sin permisos). Un 5xx o un
 * error sin código (Discord no respondió, limitó las solicitudes o falló algo en
 * el servidor) es pasajero: se repite el "join" con espera creciente.
 */

export type RealtimeStatus =
  | "idle" // sin conexión (no hay servidor elegido o se cerró sesión)
  | "connecting" // abriendo la conexión o esperando el "joined"
  | "live" // conectado y suscrito al servidor elegido
  | "reconnecting" // se cayó, o la suscripción falló por algo pasajero; reintentando con espera creciente
  | "denied"; // conectado, pero el servidor rechazó la suscripción de forma definitiva (sin permisos, id no válido)

interface ServerMessage {
  type: string;
  guildId?: string;
  status?: number;
  error?: string;
  enabled?: boolean;
  reason?: string;
  forbidden?: boolean;
  /** Segundos que pide esperar Discord cuando limita las solicitudes */
  retryAfter?: number | null;
  [key: string]: unknown;
}

const MAX_BACKOFF_MS = 30_000;
const BASE_BACKOFF_MS = 1_000;
/** Código con el que el servidor cierra si la sesión terminó (logout, caducó...) */
const CLOSE_SESSION_ENDED = 4401;
/** Tope de espera para repetir el "join" aunque Discord pida más */
const MAX_JOIN_RETRY_MS = 5 * 60_000;

/** Espera exponencial con algo de azar: intento 1 → 0,5-1 s, 2 → 1-2 s... hasta 15-30 s. */
function backoffDelay(attempt: number): number {
  const exponential = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** (attempt - 1));
  return exponential / 2 + Math.random() * (exponential / 2);
}

/**
 * ¿El rechazo del "join" es definitivo? 400 (id no válido) y 403 (sin permisos) sí:
 * repetir no cambia nada. 5xx (Discord no respondió o limitó), 408/429 o un error
 * sin código (fallo interno del servidor) son pasajeros.
 */
function isPermanentJoinError(message: ServerMessage): boolean {
  if (message.forbidden === true) return true;
  const status = message.status;
  if (typeof status !== "number") return false;
  return status >= 400 && status < 500 && status !== 408 && status !== 429;
}

/** Avisos que se refieren al servidor elegido (todos menos las respuestas al "join"). */
type GuildUpdateType = Exclude<WsServerMessage["type"], "joined" | "error">;

/**
 * Qué consultas refresca cada aviso, como prefijos de URL (queryKeyToPath convierte
 * ["/api/guild", id, "config"] en /api/guild/{id}/config). Es un Record sobre
 * WsServerMessage: si el servidor agrega un aviso en shared/api.ts, TypeScript obliga a
 * decidir aquí qué refrescar.
 */
const GUILD_INVALIDATIONS: Record<GuildUpdateType, (guildId: string) => string[]> = {
  // Config y prefijo (/api/guild/{id}/config), canales, bienvenida y pregunta del día
  // (/api/guilds/{id}/engagement), anti-raid y eventos de raid, analíticas y el resumen.
  // La lista de comandos personalizados también trae el prefijo.
  settingsUpdated: (guildId) => [
    `/api/guilds/${guildId}`,
    `/api/guild/${guildId}`,
    `/api/dashboard/${guildId}`,
    `/api/custom-commands/${guildId}`,
  ],
  // Feeds de redes sociales (/api/social/{id}/feeds)
  feedCreated: (guildId) => [`/api/social/${guildId}`],
  feedsUpdated: (guildId) => [`/api/social/${guildId}`],
  // Lista de comandos y el total que sale en el resumen (counts.customCommands)
  customCommandsUpdated: (guildId) => [`/api/custom-commands/${guildId}`, `/api/dashboard/${guildId}`],
};

function isGuildUpdateType(type: string): type is GuildUpdateType {
  return Object.prototype.hasOwnProperty.call(GUILD_INVALIDATIONS, type);
}

/** Todo lo que pueden cambiar los avisos de un servidor (para ponerse al día tras reconectar). */
function allGuildPaths(guildId: string): string[] {
  const paths = Object.values(GUILD_INVALIDATIONS).flatMap((toPaths) => toPaths(guildId));
  return Array.from(new Set(paths));
}

/** Invalida las consultas cuya URL empieza por alguno de los prefijos dados. */
function invalidatePaths(prefixes: string[]) {
  void queryClient.invalidateQueries({
    predicate: (query) => {
      const path = queryKeyToPath(query.queryKey);
      return prefixes.some((prefix) =>
        path === prefix || path.startsWith(`${prefix}/`) || path.startsWith(`${prefix}?`),
      );
    },
  });
}

class RealtimeConnection {
  private ws: WebSocket | null = null;
  private guildId: string | null = null;
  /** Servidor que el servidor confirmó con "joined": a ese se refieren los avisos que llegan */
  private joinedGuildId: string | null = null;
  private attempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  /** Reintentos seguidos del "join" tras errores pasajeros (con la conexión abierta) */
  private joinAttempts = 0;
  private joinRetryTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * Estuvimos suscritos y se cortó: los avisos de mientras se perdieron, así que al
   * volver a unirnos a ese mismo servidor refrescamos sus datos.
   */
  private resyncGuildId: string | null = null;
  private active = false;
  private status: RealtimeStatus = "idle";
  private listeners = new Set<() => void>();

  constructor() {
    if (typeof window !== "undefined") {
      // Al volver la conexión a internet no esperamos al siguiente reintento
      window.addEventListener("online", () => {
        if (this.active && !this.ws) this.reconnectNow();
      });
    }
  }

  getStatus = (): RealtimeStatus => this.status;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Conecta (si hace falta) y se suscribe a ese servidor. */
  start(guildId: string) {
    this.active = true;
    if (this.guildId === guildId && this.ws) return;
    this.guildId = guildId;
    this.joinedGuildId = null;
    // Al cambiar de servidor las páginas se montan de nuevo y piden sus datos
    if (this.resyncGuildId !== guildId) this.resyncGuildId = null;
    this.clearJoinRetry();

    if (this.ws?.readyState === WebSocket.OPEN) {
      // Ya conectados: basta con cambiar de servidor
      this.setStatus("connecting");
      this.sendJoin();
      return;
    }
    if (this.ws?.readyState === WebSocket.CONNECTING) return; // onopen manda el join
    this.open();
  }

  /** Cierra la conexión y deja de reintentar. */
  stop() {
    this.active = false;
    this.guildId = null;
    this.joinedGuildId = null;
    this.resyncGuildId = null;
    this.attempts = 0;
    this.clearReconnectTimer();
    this.clearJoinRetry();
    const ws = this.ws;
    this.ws = null;
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      ws.close(1000, "Panel cerrado");
    }
    this.setStatus("idle");
  }

  private setStatus(status: RealtimeStatus) {
    if (this.status === status) return;
    this.status = status;
    this.listeners.forEach((listener) => listener());
  }

  private clearReconnectTimer() {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private clearJoinRetry() {
    this.joinAttempts = 0;
    if (this.joinRetryTimer !== null) {
      clearTimeout(this.joinRetryTimer);
      this.joinRetryTimer = null;
    }
  }

  private reconnectNow() {
    this.clearReconnectTimer();
    if (this.active && this.guildId) this.open();
  }

  private open() {
    this.clearReconnectTimer();
    if (!this.active || !this.guildId) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    let ws: WebSocket;
    try {
      ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
    } catch (error) {
      console.warn("[TIEMPO-REAL] No se pudo abrir la conexión:", error);
      this.scheduleReconnect();
      return;
    }

    this.ws = ws;
    this.setStatus(this.attempts > 0 ? "reconnecting" : "connecting");

    ws.onopen = () => {
      if (this.ws !== ws) return;
      // `attempts` no se reinicia aquí sino cuando el servidor contesta al "join": si
      // acepta la conexión y la cierra enseguida (p. ej. 4401 aunque /api/auth/status
      // diga que hay sesión), la espera sigue creciendo en vez de reintentar cada segundo.
      this.clearJoinRetry();
      this.sendJoin();
    };

    ws.onmessage = (event) => {
      if (this.ws !== ws) return;
      let message: ServerMessage;
      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (message && typeof message.type === "string") this.handleMessage(message);
    };

    ws.onclose = (event) => {
      if (this.ws !== ws) return; // ya la reemplazamos o la cerramos nosotros
      this.ws = null;
      if (this.joinedGuildId) this.resyncGuildId = this.joinedGuildId;
      this.joinedGuildId = null;
      this.clearJoinRetry(); // al reconectar, onopen vuelve a mandar el "join"
      if (!this.active) return;

      if (event.code === CLOSE_SESSION_ENDED) {
        // La sesión terminó. Puede que siga habiendo otra válida (p. ej. volvió a
        // iniciar sesión en otra pestaña): lo comprobamos antes de decidir.
        this.setStatus("reconnecting");
        void this.checkSessionThenReconnect();
        return;
      }
      this.scheduleReconnect();
    };

    // Siempre llega un "close" después de un "error": ahí se decide qué hacer
    ws.onerror = () => {};
  }

  private async checkSessionThenReconnect() {
    try {
      await queryClient.refetchQueries({ queryKey: AUTH_STATUS_KEY });
    } catch {
      // si falla, el reintento normal se encarga
    }
    const auth = queryClient.getQueryData<{ authenticated?: boolean }>(AUTH_STATUS_KEY);
    if (auth?.authenticated === false) {
      // App.tsx ya muestra el login; el layout se desmonta y llama a stop()
      this.stop();
      return;
    }
    this.scheduleReconnect();
  }

  private scheduleReconnect() {
    if (!this.active || !this.guildId) return;
    this.clearReconnectTimer();
    this.attempts += 1;
    this.setStatus("reconnecting");

    // Si falla varias veces seguidas, puede que la sesión haya caducado
    // (el servidor rechaza el upgrade con 401 y el navegador no nos dice el motivo)
    if (this.attempts % 3 === 0) {
      void queryClient.invalidateQueries({ queryKey: AUTH_STATUS_KEY });
    }

    const delay = backoffDelay(this.attempts);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.open();
    }, delay);
  }

  /**
   * La suscripción falló por algo pasajero: la conexión sigue abierta, así que
   * repetimos el "join" (no hace falta reconectar) con espera creciente.
   */
  private scheduleJoinRetry(retryAfterSeconds?: number | null) {
    if (!this.active || !this.guildId) return;
    if (this.joinRetryTimer !== null) clearTimeout(this.joinRetryTimer);
    this.joinAttempts += 1;
    this.setStatus("reconnecting");

    let delay = backoffDelay(this.joinAttempts);
    if (typeof retryAfterSeconds === "number" && Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
      delay = Math.max(delay, retryAfterSeconds * 1000);
    }
    delay = Math.min(delay, MAX_JOIN_RETRY_MS);

    this.joinRetryTimer = setTimeout(() => {
      this.joinRetryTimer = null;
      this.sendJoin();
    }, delay);
  }

  private sendJoin() {
    if (this.ws?.readyState !== WebSocket.OPEN || !this.guildId) return;
    // El servidor saca el usuario de la sesión: solo hace falta el servidor
    this.ws.send(JSON.stringify({ type: "join", guildId: this.guildId }));
  }

  private handleMessage(message: ServerMessage) {
    switch (message.type) {
      case "joined":
        if (message.guildId && message.guildId === this.guildId) {
          this.joinedGuildId = message.guildId;
          this.attempts = 0;
          this.clearJoinRetry();
          this.setStatus("live");
          if (this.resyncGuildId === message.guildId) {
            // Volvimos tras un corte: lo que cambió mientras tanto no llegó por aquí
            invalidatePaths(allGuildPaths(message.guildId));
          }
          this.resyncGuildId = null;
        }
        return;

      case "error":
        this.joinedGuildId = null;
        this.attempts = 0; // el servidor contestó: la conexión en sí funciona
        if (isPermanentJoinError(message)) {
          // 403 sin permisos, 400 id no válido: la conexión sigue abierta pero sin
          // avisos de este servidor. Repetir no cambiaría nada.
          console.warn("[TIEMPO-REAL] El servidor rechazó la suscripción:", message.error ?? message);
          this.clearJoinRetry();
          this.setStatus("denied");
          // Sin permisos: puede que ya no administre ese servidor; la lista se pone al día
          if (message.forbidden === true || message.status === 403) {
            void queryClient.invalidateQueries({ queryKey: USER_GUILDS_KEY, exact: true }, { cancelRefetch: false });
          }
        } else {
          // Discord no respondió, limitó las solicitudes o falló algo en el servidor
          console.warn("[TIEMPO-REAL] No se pudo suscribir por ahora; se reintentará:", message.error ?? message);
          this.scheduleJoinRetry(message.retryAfter);
        }
        return;
    }

    const guildId = this.joinedGuildId;
    if (!guildId) return;

    if (isGuildUpdateType(message.type)) {
      invalidatePaths(GUILD_INVALIDATIONS[message.type](guildId));
    }
  }
}

export const realtime = new RealtimeConnection();

/**
 * Mantiene la conexión en tiempo real mientras haya sesión y un servidor elegido.
 * Devuelve el estado para mostrarlo en la interfaz.
 */
export function useRealtime(guildId: string | null, enabled = true): RealtimeStatus {
  useEffect(() => {
    if (!enabled || !guildId) {
      realtime.stop();
      return;
    }
    realtime.start(guildId);
  }, [guildId, enabled]);

  // Al desmontar (cerrar sesión, sesión caducada) se corta del todo
  useEffect(() => () => realtime.stop(), []);

  return useRealtimeStatus();
}

export function useRealtimeStatus(): RealtimeStatus {
  return useSyncExternalStore(realtime.subscribe, realtime.getStatus, realtime.getStatus);
}
