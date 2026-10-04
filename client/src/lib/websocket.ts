import { useEffect, useSyncExternalStore } from "react";
import { AUTH_STATUS_KEY, queryClient, queryKeyToPath } from "./queryClient";
import { toast } from "@/hooks/use-toast";

/**
 * Tiempo real del panel (WebSocket en /ws).
 *
 * El servidor solo acepta la conexión con una sesión válida. Tras conectar se
 * manda { type: 'join', guildId } y el servidor responde { type: 'joined' } o
 * { type: 'error', status, error }. Después avisa de cambios del servidor
 * elegido (settingsUpdated, feedCreated, lockdown_update) y aquí se invalidan
 * las consultas de react-query que correspondan.
 */

export type RealtimeStatus =
  | "idle" // sin conexión (no hay servidor elegido o se cerró sesión)
  | "connecting" // abriendo la conexión o esperando el "joined"
  | "live" // conectado y suscrito al servidor elegido
  | "reconnecting" // se cayó; reintentando con espera creciente
  | "denied"; // conectado, pero el servidor rechazó la suscripción (permisos, bot ausente...)

interface ServerMessage {
  type: string;
  guildId?: string;
  status?: number;
  error?: string;
  enabled?: boolean;
  reason?: string;
  [key: string]: unknown;
}

const MAX_BACKOFF_MS = 30_000;
const BASE_BACKOFF_MS = 1_000;
/** Código con el que el servidor cierra si la sesión terminó (logout, caducó...) */
const CLOSE_SESSION_ENDED = 4401;

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
    this.attempts = 0;
    this.clearReconnectTimer();
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
      this.attempts = 0;
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
      this.joinedGuildId = null;
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

    const exponential = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** (this.attempts - 1));
    const delay = exponential / 2 + Math.random() * (exponential / 2); // con algo de azar
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.open();
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
          this.setStatus("live");
        }
        return;

      case "error":
        // 403 sin permisos, 404 bot ausente, 400 id inválido...: la conexión sigue
        // abierta pero sin avisos de este servidor. No reintentamos en bucle.
        console.warn("[TIEMPO-REAL] El servidor rechazó la suscripción:", message.error ?? message);
        this.joinedGuildId = null;
        this.setStatus("denied");
        return;
    }

    const guildId = this.joinedGuildId;
    if (!guildId) return;

    switch (message.type) {
      case "settingsUpdated":
        invalidatePaths([
          `/api/guilds/${guildId}`,
          `/api/guild/${guildId}`,
          `/api/dashboard/${guildId}`,
        ]);
        break;

      case "feedCreated":
        invalidatePaths([`/api/social/${guildId}`]);
        break;

      case "lockdown_update":
        invalidatePaths([`/api/protection/${guildId}`]);
        toast({
          title: message.enabled ? "🔒 Bloqueo activado" : "🔓 Bloqueo desactivado",
          description: message.enabled
            ? (message.reason ? `Motivo: ${message.reason}` : "Los miembros no pueden escribir por ahora.")
            : "Los miembros ya pueden volver a escribir.",
        });
        break;

      // El servidor aún no los manda, pero si llegan mantenemos las listas al día
      case "userLevelUp":
        invalidatePaths([`/api/levels/${guildId}`]);
        break;

      case "moderationAction":
        invalidatePaths([`/api/moderation/${guildId}`]);
        break;
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
