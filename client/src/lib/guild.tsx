import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { USER_GUILDS_KEY } from "./queryClient";

/** Un servidor de GET /api/user/guilds (solo los que la persona puede administrar). */
export interface UserGuild {
  id: string;
  name: string;
  icon: string | null;
  owner: boolean;
  permissions: string;
  botInGuild: boolean;
  /** false: el bot no está conectado a Discord y botInGuild no se sabe (no hay que pedir invitarlo). */
  botOnline: boolean;
}

// La clave vive en queryClient.ts: ahí se vuelve a pedir la lista tras un 403 o un "bot ausente"
export { USER_GUILDS_KEY };
const STORAGE_KEY = "botm:selectedGuildId";

interface GuildContextValue {
  guilds: UserGuild[];
  isLoading: boolean;
  isFetching: boolean;
  error: unknown;
  refetch: () => void;
  selectedGuildId: string | null;
  selectedGuild: UserGuild | null;
  selectGuild: (guildId: string) => void;
}

const GuildContext = createContext<GuildContextValue | null>(null);

function readStoredGuildId(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStoredGuildId(guildId: string | null) {
  try {
    if (guildId) localStorage.setItem(STORAGE_KEY, guildId);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // localStorage bloqueado (modo privado, etc.): la selección vive solo en memoria
  }
}

/** Olvida el servidor elegido guardado en este navegador (al cerrar sesión). */
export function forgetSelectedGuild() {
  writeStoredGuildId(null);
}

/** Acepta solo filas con la forma esperada (por si la API cambia o falla a medias). */
function normalizeGuilds(data: unknown): UserGuild[] {
  if (!Array.isArray(data)) return [];
  return data
    .filter((g): g is Record<string, unknown> => !!g && typeof g === "object" && typeof (g as any).id === "string")
    .map((g) => ({
      id: String(g.id),
      name: typeof g.name === "string" ? g.name : "Servidor sin nombre",
      icon: typeof g.icon === "string" ? g.icon : null,
      owner: g.owner === true,
      permissions: typeof g.permissions === "string" ? g.permissions : "",
      botInGuild: g.botInGuild === true,
      botOnline: g.botOnline !== false,
    }));
}

/** Servidores con el bot primero; dentro de cada grupo, por nombre. */
export function sortGuilds(guilds: UserGuild[]): UserGuild[] {
  return [...guilds].sort((a, b) => {
    if (a.botInGuild !== b.botInGuild) return a.botInGuild ? -1 : 1;
    return a.name.localeCompare(b.name, "es", { sensitivity: "base" });
  });
}

export function GuildProvider({ children }: { children: ReactNode }) {
  const query = useQuery<unknown>({
    queryKey: USER_GUILDS_KEY,
    // Si la persona invita al bot en otra pestaña, al volver se actualiza "botInGuild"
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    // Con el bot desconectado se vuelve a preguntar cada poco: el bot se reconecta solo
    refetchInterval: (q) =>
      Array.isArray(q.state.data) && q.state.data.some((g) => (g as { botOnline?: unknown } | null)?.botOnline === false)
        ? 15_000
        : false,
  });

  const guilds = useMemo(() => sortGuilds(normalizeGuilds(query.data)), [query.data]);
  const [preferredId, setPreferredId] = useState<string | null>(() => readStoredGuildId());

  const selectedGuild = useMemo<UserGuild | null>(() => {
    if (guilds.length === 0) return null;
    // Lo guardado solo vale si sigue en la lista; si no, el primero con el bot (o el primero)
    return guilds.find((g) => g.id === preferredId) ?? guilds.find((g) => g.botInGuild) ?? guilds[0];
  }, [guilds, preferredId]);

  // Si lo guardado ya no está en la lista (perdió permisos, salió del servidor...), lo olvidamos
  useEffect(() => {
    if (query.isSuccess && preferredId && !guilds.some((g) => g.id === preferredId)) {
      writeStoredGuildId(null);
      setPreferredId(null);
    }
  }, [query.isSuccess, guilds, preferredId]);

  // Si no había uno elegido, fijamos (solo en memoria) el que tomamos por defecto: así, si
  // la lista se reordena al actualizarse (p. ej. sacaron al bot), el panel no salta a otro servidor
  useEffect(() => {
    if (!preferredId && selectedGuild) setPreferredId(selectedGuild.id);
  }, [preferredId, selectedGuild]);

  const selectGuild = useCallback((guildId: string) => {
    setPreferredId(guildId);
    writeStoredGuildId(guildId);
  }, []);

  const { refetch } = query;
  const value = useMemo<GuildContextValue>(() => ({
    guilds,
    // isPending y no isLoading: sin conexión la petición queda en pausa (no "cargando") y
    // el panel diría que no hay servidores
    isLoading: query.isPending,
    isFetching: query.isFetching,
    error: query.error,
    refetch: () => { void refetch(); },
    selectedGuildId: selectedGuild?.id ?? null,
    selectedGuild,
    selectGuild,
  }), [guilds, query.isPending, query.isFetching, query.error, refetch, selectedGuild, selectGuild]);

  return <GuildContext.Provider value={value}>{children}</GuildContext.Provider>;
}

/** Contexto de servidores. Fuera de GuildProvider devuelve null. */
export function useOptionalGuild(): GuildContextValue | null {
  return useContext(GuildContext);
}

export function useGuild(): GuildContextValue {
  const value = useContext(GuildContext);
  if (!value) {
    throw new Error("useGuild() debe usarse dentro de <GuildProvider>");
  }
  return value;
}

/** ID del servidor elegido (null si todavía no hay ninguno). */
export function useSelectedGuildId(): string | null {
  return useOptionalGuild()?.selectedGuildId ?? null;
}

/**
 * Servidor elegido, para las páginas de un servidor. App.tsx solo muestra esas
 * páginas cuando hay un servidor elegido, así que ahí `guildId` nunca está vacío.
 *
 *   const { guildId } = useSelectedGuild();
 */
export function useSelectedGuild(): { guildId: string; guild: UserGuild | null } {
  const ctx = useOptionalGuild();
  return { guildId: ctx?.selectedGuildId ?? "", guild: ctx?.selectedGuild ?? null };
}

/** Icono del servidor en el CDN de Discord (null si no tiene). */
export function guildIconUrl(guild: Pick<UserGuild, "id" | "icon">, size = 64): string | null {
  if (!guild.icon) return null;
  return `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=${size}`;
}
