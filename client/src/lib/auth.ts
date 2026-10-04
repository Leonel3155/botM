import { useMutation, useQuery } from "@tanstack/react-query";
import { AUTH_STATUS_KEY, ApiError, apiRequest } from "@/lib/queryClient";

/** Usuario de Discord guardado en la sesión (ver server/routes/auth.ts). */
export interface SessionUser {
  id: string;
  username: string;
  globalName: string | null;
  avatar: string | null;
}

/** Respuesta de GET /api/auth/status. `reason` lo pone solo el panel cuando una petición recibe 401. */
export interface AuthStatus {
  authenticated: boolean;
  user: SessionUser | null;
  sessionExtended?: boolean;
  expiresIn?: number;
  devMode?: boolean;
  reason?: "expired";
}

/** URL que empieza el login con Discord. El servidor arma la URL de OAuth (con state). */
export const LOGIN_URL = "/api/auth/discord";

/** Ruta a la que volver después del login (el callback de Discord siempre vuelve a "/"). */
const RETURN_TO_KEY = "botm:returnTo";

async function fetchAuthStatus(): Promise<AuthStatus> {
  let res: Response;
  try {
    res = await fetch("/api/auth/status", {
      credentials: "include",
      cache: "no-store",
    });
  } catch {
    throw new ApiError(0, null);
  }
  if (!res.ok) {
    throw new ApiError(res.status, null);
  }
  const data = (await res.json()) as Partial<AuthStatus> | null;
  return {
    authenticated: data?.authenticated === true,
    user: data?.authenticated && data.user ? data.user : null,
    sessionExtended: data?.sessionExtended,
    expiresIn: data?.expiresIn,
    devMode: data?.devMode,
  };
}

export function useAuthStatus() {
  return useQuery<AuthStatus>({
    queryKey: AUTH_STATUS_KEY,
    queryFn: fetchAuthStatus,
    staleTime: 5 * 60_000,
    // Al volver a la pestaña revisamos que la sesión siga viva
    refetchOnWindowFocus: true,
    retry: 1,
  });
}

/** Lleva al login de Discord recordando en qué página estaba la persona. */
export function startLogin() {
  try {
    const here = window.location.pathname;
    if (here && here !== "/") sessionStorage.setItem(RETURN_TO_KEY, here);
  } catch {
    // sessionStorage bloqueado: no pasa nada, volverá al inicio
  }
  window.location.assign(LOGIN_URL);
}

/** Ruta guardada antes del login (solo rutas internas). La borra al leerla. */
export function takeReturnTo(): string | null {
  try {
    const value = sessionStorage.getItem(RETURN_TO_KEY);
    sessionStorage.removeItem(RETURN_TO_KEY);
    if (value && value.startsWith("/") && !value.startsWith("//")) return value;
  } catch {
    // ignorado
  }
  return null;
}

/** Cierra la sesión y recarga el panel desde cero (así no queda ningún dato en memoria). */
export function useLogout() {
  return useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/auth/logout");
    },
    onSuccess: () => {
      window.location.replace("/");
    },
  });
}

export function displayName(user: SessionUser | null | undefined): string {
  if (!user) return "";
  return user.globalName?.trim() || user.username;
}

export function userAvatarUrl(user: SessionUser | null | undefined, size = 64): string | null {
  if (!user?.avatar || !/^\d{17,20}$/.test(user.id)) return null;
  return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=${size}`;
}

/** Iniciales para los avatares sin imagen ("Mi Servidor" → "MS"). */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.slice(0, 2).map((word) => Array.from(word)[0] ?? "");
  return letters.join("").toUpperCase() || "?";
}
