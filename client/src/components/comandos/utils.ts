import {
  CUSTOM_COMMAND_PLACEHOLDERS,
  RESERVED_CUSTOM_COMMAND_NAMES,
  type CustomCommandItem,
  type CustomCommandsResponse,
} from "@shared/api";
import { isApiError, queryClient } from "@/lib/queryClient";

/** Prefijo que usa el bot si el servidor no tiene uno guardado (igual que en el servidor). */
export const DEFAULT_PREFIX = "&";

/**
 * Clave de react-query de GET /api/custom-commands/:guildId (la URL sale de la clave:
 * /api/custom-commands/<guildId>). lib/websocket.ts la refresca con el aviso en vivo
 * "customCommandsUpdated" (y con "settingsUpdated", porque la lista también trae el prefijo).
 */
export function customCommandsKey(guildId: string) {
  return ["/api/custom-commands", guildId] as const;
}

/** El total de comandos también sale en el resumen (counts.customCommands). */
export function invalidateCustomCommands(guildId: string, { dashboard = false } = {}) {
  void queryClient.invalidateQueries({ queryKey: customCommandsKey(guildId) });
  if (dashboard) void queryClient.invalidateQueries({ queryKey: ["/api/dashboard", guildId] });
}

export function sortCommands(commands: CustomCommandItem[]): CustomCommandItem[] {
  return [...commands].sort((a, b) => a.name.localeCompare(b.name, "es"));
}

/** Cambia la lista guardada en caché (si existe) sin esperar a volver a pedirla. */
export function updateCachedCommands(
  guildId: string,
  update: (commands: CustomCommandItem[]) => CustomCommandItem[],
) {
  queryClient.setQueryData<CustomCommandsResponse>(customCommandsKey(guildId), (old) =>
    old ? { ...old, commands: sortCommands(update(old.commands)) } : old,
  );
}

/** Nombres reservados: los que manda la API y, por si acaso, los de shared/api.ts. */
export function reservedNameSet(fromApi: readonly string[] | undefined): Set<string> {
  return new Set([...(fromApi ?? []), ...RESERVED_CUSTOM_COMMAND_NAMES].map((name) => name.toLowerCase()));
}

/** Texto amable de un error de la API para un toast (el servidor ya responde en español). */
export function errorMessage(error: unknown): string {
  if (isApiError(error)) {
    const wait = error.body?.retryAfterSeconds;
    if (error.status === 429 && typeof wait === "number" && wait > 0) {
      return `Espera ${Math.ceil(wait)} s e intenta de nuevo.`;
    }
    return error.message;
  }
  return "Algo salió mal. Intenta de nuevo en un momento.";
}

export function formatUses(uses: number): string {
  if (!uses) return "Nadie lo ha usado todavía";
  return uses === 1 ? "Usado 1 vez" : `Usado ${new Intl.NumberFormat("es-MX").format(uses)} veces`;
}

// =============================================
// Vista previa de la respuesta
// =============================================

export type PlaceholderKey = (typeof CUSTOM_COMMAND_PLACEHOLDERS)[number]["key"];

export interface PreviewValue {
  /** Lo que se ve en la vista previa. */
  text: string;
  /**
   * Caracteres que ocupa en el mensaje que de verdad manda el bot (para avisar si se pasa del
   * límite). No siempre es text.length: las menciones viajan en crudo (<@id>, <#id>) y los
   * valores de ejemplo cuentan con lo más largo que pueden llegar a ser.
   */
  wireLength: number;
  /** Se ve como mención de Discord (@persona, #canal). */
  mention: boolean;
  /** Dato real del servidor (no de ejemplo). */
  real: boolean;
}

export type PreviewSegment =
  | { kind: "text"; text: string }
  | { kind: "value"; placeholder: string; value: PreviewValue };

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Igual que el bot: las variables no distinguen mayúsculas ({Usuario} también vale)
const PLACEHOLDER_REGEX = new RegExp(
  CUSTOM_COMMAND_PLACEHOLDERS.map((placeholder) => escapeRegExp(placeholder.key)).join("|"),
  "gi",
);

// Lo que ocupa cada variable en el mensaje real, tal como la reemplaza el bot (server/bot/customCommands.ts):
// - {usuario} → <@id> y {canal} → <#id>: los ids de Discord de hoy tienen hasta 19 dígitos (2 + 19 + 1)
const MENTION_WIRE_LENGTH = 22;
// - {nombre} → apodo o nombre visible: Discord deja hasta 32 caracteres
const DISPLAY_NAME_MAX_LENGTH = 32;
// - {servidor} → nombre del servidor: Discord deja hasta 100 caracteres (si no conocemos el real)
const GUILD_NAME_MAX_LENGTH = 100;
// - {miembros} → número con separadores (si no conocemos el real, uno grande: "1,000,000")
const MEMBER_COUNT_WIRE_LENGTH = (1_000_000).toLocaleString("es-MX").length;

/**
 * Valores para la vista previa. Los de la persona y el canal son de ejemplo (dependen de
 * quién use el comando); el nombre del servidor y los miembros son reales si los conocemos.
 */
export function previewValues(guildName: string | null, memberCount: number | null): Record<PlaceholderKey, PreviewValue> {
  const members = typeof memberCount === "number" ? memberCount.toLocaleString("es-MX") : null;
  return {
    "{usuario}": { text: "@Alguien", wireLength: MENTION_WIRE_LENGTH, mention: true, real: false },
    "{nombre}": { text: "Alguien", wireLength: DISPLAY_NAME_MAX_LENGTH, mention: false, real: false },
    "{servidor}": guildName
      ? { text: guildName, wireLength: guildName.length, mention: false, real: true }
      : { text: "tu servidor", wireLength: GUILD_NAME_MAX_LENGTH, mention: false, real: false },
    "{canal}": { text: "#este-canal", wireLength: MENTION_WIRE_LENGTH, mention: true, real: false },
    "{miembros}": members
      ? { text: members, wireLength: members.length, mention: false, real: true }
      : { text: "100", wireLength: MEMBER_COUNT_WIRE_LENGTH, mention: false, real: false },
  };
}

/**
 * Parte el texto en trozos fijos y variables ya resueltas (como lo haría el bot).
 * `discordLength` es lo que mediría el mensaje enviado (con las menciones en crudo y, en los
 * valores de ejemplo, lo más largo que pueden ser), no lo que se ve en la vista previa.
 */
export function buildPreview(template: string, values: Record<PlaceholderKey, PreviewValue>): {
  segments: PreviewSegment[];
  discordLength: number;
} {
  const text = template.trim();
  const segments: PreviewSegment[] = [];
  let discordLength = 0;
  let last = 0;
  for (const match of text.matchAll(PLACEHOLDER_REGEX)) {
    const index = match.index ?? 0;
    if (index > last) {
      const chunk = text.slice(last, index);
      segments.push({ kind: "text", text: chunk });
      discordLength += chunk.length;
    }
    const key = match[0].toLowerCase() as PlaceholderKey;
    const value = values[key];
    if (value) {
      segments.push({ kind: "value", placeholder: key, value });
      discordLength += value.wireLength;
    } else {
      segments.push({ kind: "text", text: match[0] });
      discordLength += match[0].length;
    }
    last = index + match[0].length;
  }
  if (last < text.length) {
    segments.push({ kind: "text", text: text.slice(last) });
    discordLength += text.length - last;
  }
  return { segments, discordLength };
}

/** El bot nunca notifica a @everyone, @here ni a roles desde un comando personalizado. */
export function hasBlockedMentions(text: string): boolean {
  return /@everyone|@here|<@&\d+>/i.test(text);
}
