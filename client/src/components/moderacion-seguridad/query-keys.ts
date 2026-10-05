// Claves de react-query de Moderación y Seguridad. queryKeyToPath las convierte en la URL
// (los objetos de filtros se ignoran), así los avisos del WebSocket (client/src/lib/websocket.ts)
// las invalidan por prefijo:
// - settingsUpdated → /api/guilds/:id/* (anti-raid, eventos de raid, analíticas) y /api/dashboard/:id/*
// - moderationAction → /api/moderation/:id/*

/** GET /api/moderation/:guildId/actions (con filtros y páginas) */
export function moderationActionsKey(guildId: string) {
  return ["/api/moderation", guildId, "actions"] as const;
}

/** GET /api/dashboard/:guildId/stats (la misma que usa el Resumen) */
export function dashboardStatsKey(guildId: string) {
  return ["/api/dashboard", guildId, "stats"] as const;
}

/** GET /api/guilds/:guildId/analytics */
export function analyticsKey(guildId: string) {
  return ["/api/guilds", guildId, "analytics"] as const;
}

/** GET /api/guilds/:guildId/antiraid */
export function antiRaidKey(guildId: string) {
  return ["/api/guilds", guildId, "antiraid"] as const;
}

/** GET /api/guilds/:guildId/raid-events (con filtro de estado y páginas) */
export function raidEventsKey(guildId: string) {
  return ["/api/guilds", guildId, "raid-events"] as const;
}

/** GET /api/guild/:guildId/discord-channels (la misma que usan otras páginas) */
export function discordChannelsKey(guildId: string) {
  return ["/api/guild", guildId, "discord-channels"] as const;
}
