import type { DiscordBot } from '../index';
import {
  ChannelType,
  Client,
  EmbedBuilder,
  Events,
  Guild,
  GuildMember,
  GuildVerificationLevel,
  PermissionFlagsBits,
  type GuildBasedChannel,
  type TextChannel,
} from 'discord.js';
import { storage } from '../../storage';
import { antiRaidActions, defaultAntiRaidConfig, type AntiRaidAction, type AntiRaidSettings } from '@shared/schema';

// Detección de raids por ráfaga de entradas: si entran `joinThreshold` cuentas en `joinWindowSeconds`
// se activa el "modo raid" durante `lockdownMinutes`, se guarda un raid_event y se ejecuta la acción
// configurada (solo alerta / subir verificación / lockdown que además expulsa a quien entre).

interface JoinRecord {
  userId: string;
  at: number;
  accountAgeDays: number;
}

interface RaidState {
  eventId: string | null;
  action: AntiRaidAction;
  startedAt: number;
  liftAt: number;
  previousVerificationLevel: GuildVerificationLevel | null; // null = no la cambiamos nosotros
  joinsDuringRaid: number;
  kicked: number;
  timer: NodeJS.Timeout | null;
  // Se resuelve cuando triggerRaid ya guardó el evento, cambió la verificación y avisó al staff.
  // liftLockdown lo espera para no levantar un raid a medio arrancar. Nunca se rechaza.
  ready: Promise<void>;
  lifted: boolean; // ya se levantó: triggerRaid deja de expulsar y no vuelve a tocar el servidor
}

// Algo a lo que se le puede mandar la alerta: un canal de texto o el dueño por mensaje directo
interface AlertTarget {
  send(options: { embeds: EmbedBuilder[] }): Promise<unknown>;
}

export const ANTI_RAID_ACTION_LABELS: Record<AntiRaidAction, string> = {
  alert: '📣 Solo alertar al staff',
  verification: '🔐 Subir la verificación al máximo',
  lockdown: '🚨 Lockdown (verificación máxima + expulsar a quien entre)',
};

const CONFIG_TTL_MS = 30_000;
const MAX_STORED_USER_IDS = 50;
const FOOTER = { text: 'BotM • Protección anti-raid' };

const recentJoins = new Map<string, JoinRecord[]>();
const activeRaids = new Map<string, RaidState>();
const configCache = new Map<string, { at: number; promise: Promise<AntiRaidSettings> }>();
const lastKnownConfig = new Map<string, AntiRaidSettings>();
let discordClient: Client | null = null;

export function setupAntiRaid(bot: DiscordBot) {
  discordClient = bot.client;

  bot.client.on(Events.GuildMemberAdd, (member) => {
    handleMemberJoin(member).catch((error) => {
      console.error(`Anti-raid: error procesando una entrada en ${member.guild.id}:`, error);
    });
  });

  // Si el bot se reinició en pleno modo raid, retomamos el temporizador (o lo levantamos si ya venció)
  const restore = () => {
    restorePendingRaids().catch((error) => console.error('Anti-raid: no se pudieron restaurar los raids pendientes:', error));
  };
  if (bot.client.isReady()) restore();
  else bot.client.once(Events.ClientReady, restore);

  console.log('🛡️ Anti-raid protection initialized');
}

// ===== Configuración (con caché corta para no consultar la BD en cada entrada) =====
function getConfig(guildId: string): Promise<AntiRaidSettings> {
  const cached = configCache.get(guildId);
  if (cached && Date.now() - cached.at < CONFIG_TTL_MS) return cached.promise;

  const promise = storage.getAntiRaidConfig(guildId)
    .then((config) => {
      lastKnownConfig.set(guildId, config);
      return config;
    })
    .catch((error) => {
      configCache.delete(guildId);
      console.error(`Anti-raid: no se pudo leer la configuración de ${guildId}:`, error);
      return lastKnownConfig.get(guildId) ?? { ...defaultAntiRaidConfig, enabled: false };
    });

  configCache.set(guildId, { at: Date.now(), promise });
  return promise;
}

// Llamar después de cambiar la configuración (p. ej. desde /antiraid) para aplicarla al instante
export function invalidateAntiRaidConfig(guildId: string) {
  configCache.delete(guildId);
}

// ===== Detección =====
async function handleMemberJoin(member: GuildMember) {
  if (member.user.bot) return; // los bots solo los puede agregar un admin

  const guild = member.guild;
  const config = await getConfig(guild.id);

  // Desde aquí hasta triggerRaid todo es síncrono: dos entradas simultáneas no pueden disparar dos raids
  const raid = activeRaids.get(guild.id);
  if (raid) {
    raid.joinsDuringRaid++;
    if (raid.action === 'lockdown') await kickDuringRaid(member, raid);
    return;
  }

  if (!config.enabled) return;

  const now = Date.now();
  const windowMs = config.joinWindowSeconds * 1000;
  const joins = (recentJoins.get(guild.id) ?? []).filter((join) => now - join.at <= windowMs);
  joins.push({ userId: member.id, at: now, accountAgeDays: accountAgeDays(member) });
  recentJoins.set(guild.id, joins);

  if (joins.length >= config.joinThreshold) {
    recentJoins.delete(guild.id);
    await triggerRaid(guild, config, joins);
  }
}

function accountAgeDays(member: GuildMember): number {
  return (Date.now() - member.user.createdTimestamp) / 86_400_000;
}

async function kickDuringRaid(member: GuildMember, state: RaidState): Promise<boolean> {
  if (state.lifted || !member.kickable) return false;
  try {
    await member.kick('Anti-raid: modo raid activo, no se permiten entradas por ahora');
    state.kicked++;
    return true;
  } catch (error) {
    console.error(`Anti-raid: no se pudo expulsar a ${member.id}:`, error);
    return false;
  }
}

// ===== Respuesta al raid =====
async function triggerRaid(guild: Guild, config: AntiRaidSettings, joins: JoinRecord[]) {
  const startedAt = Date.now();
  const durationMs = config.lockdownMinutes * 60_000;
  let markReady!: () => void;
  const state: RaidState = {
    eventId: null,
    action: config.action,
    startedAt,
    liftAt: startedAt + durationMs,
    previousVerificationLevel: null,
    joinsDuringRaid: 0,
    kicked: 0,
    timer: null,
    ready: new Promise<void>((resolve) => { markReady = resolve; }),
    lifted: false,
  };
  activeRaids.set(guild.id, state);
  state.timer = setTimeout(() => {
    liftLockdown(guild.id, 'auto').catch((error) => console.error('Anti-raid: error al levantar el modo raid:', error));
  }, durationMs);

  const newAccounts = joins.filter((join) => join.accountAgeDays < config.minAccountAgeDays);
  console.warn(`🚨 Anti-raid: ${joins.length} entradas en ${config.joinWindowSeconds}s en ${guild.name} (${guild.id}), acción: ${config.action}`);

  try {
    await startRaid(guild, config, joins, newAccounts, state);
  } catch (error) {
    console.error('Anti-raid: error al activar el modo raid:', error);
  } finally {
    markReady();
  }

  if (config.action === 'lockdown' && !state.lifted && guild.members.me?.permissions.has(PermissionFlagsBits.KickMembers)) {
    for (const join of newAccounts) {
      if (state.lifted) break; // lo levantaron a mitad: ya no expulsamos a nadie más
      const member = guild.members.cache.get(join.userId) ?? await guild.members.fetch(join.userId).catch(() => null);
      if (member) await kickDuringRaid(member, state);
    }

    // Para que un reinicio retome el contador (si ya se levantó, liftLockdown guardó el total)
    if (state.eventId && !state.lifted) {
      await storage.updateRaidEventDetails(state.eventId, { kickedAtStart: state.kicked })
        .catch((error) => console.error('Anti-raid: no se pudo actualizar el evento de raid:', error));
    }
  }
}

// Primero guarda el evento (para que un reinicio o /antiraid levantar lo encuentren aunque lo demás falle),
// luego sube la verificación y avisa al staff. Las expulsiones van después, fuera de esta parte.
async function startRaid(guild: Guild, config: AntiRaidSettings, joins: JoinRecord[], newAccounts: JoinRecord[], state: RaidState) {
  const severity = newAccounts.length * 2 >= joins.length ? 'high' : 'medium';
  const actionsTaken: string[] = [];
  const me = guild.members.me;

  try {
    await storage.ensureGuild(guild.id, guild.name, guild.ownerId);
    const event = await storage.createRaidEvent({
      guildId: guild.id,
      type: 'join_spam',
      severity,
      resolved: false,
      details: {
        joins: joins.length,
        windowSeconds: config.joinWindowSeconds,
        threshold: config.joinThreshold,
        newAccounts: newAccounts.length,
        userIds: joins.map((join) => join.userId).slice(0, MAX_STORED_USER_IDS),
        action: config.action,
        previousVerificationLevel: null,
        kickedAtStart: 0,
        liftAt: state.liftAt,
      },
    });
    state.eventId = event.id;
  } catch (error) {
    console.error('Anti-raid: no se pudo guardar el evento de raid:', error);
  }

  if ((config.action === 'verification' || config.action === 'lockdown') && !state.lifted) {
    if (guild.verificationLevel >= GuildVerificationLevel.VeryHigh) {
      actionsTaken.push('🔐 La verificación ya estaba al máximo');
    } else if (!me?.permissions.has(PermissionFlagsBits.ManageGuild)) {
      actionsTaken.push('⚠️ No pude subir la verificación: me falta el permiso **Gestionar servidor**');
    } else {
      const previous = guild.verificationLevel;
      try {
        await guild.setVerificationLevel(GuildVerificationLevel.VeryHigh, 'Anti-raid: entrada masiva detectada');
        state.previousVerificationLevel = previous;
        actionsTaken.push('🔐 Subí el nivel de verificación al máximo (teléfono verificado)');
      } catch (error) {
        console.error('Anti-raid: no se pudo cambiar el nivel de verificación:', error);
        actionsTaken.push('⚠️ No pude cambiar el nivel de verificación');
      }

      // Si el bot se cae en pleno raid, al volver sabrá a qué nivel regresar la verificación
      if (state.eventId && state.previousVerificationLevel !== null) {
        await storage.updateRaidEventDetails(state.eventId, { previousVerificationLevel: state.previousVerificationLevel })
          .catch((error) => console.error('Anti-raid: no se pudo actualizar el evento de raid:', error));
      }
    }
  }

  if (config.action === 'lockdown') {
    if (me?.permissions.has(PermissionFlagsBits.KickMembers)) {
      actionsTaken.push(newAccounts.length
        ? `👢 Expulsando ${newAccounts.length} cuenta(s) nueva(s) de la ráfaga; quien entre durante el lockdown también será expulsado`
        : '👢 Quien entre durante el lockdown será expulsado');
    } else {
      actionsTaken.push('⚠️ No puedo expulsar: me falta el permiso **Expulsar miembros**');
    }
  }

  if (config.action === 'alert') {
    actionsTaken.push('📣 Solo alerta (no se tocó nada del servidor)');
  }

  const embed = new EmbedBuilder()
    .setColor(0xED4245)
    .setTitle('🚨 ¡Posible raid detectado!')
    .setDescription(`Entraron **${joins.length}** cuentas en menos de **${config.joinWindowSeconds} segundos**. Activé el modo anti-raid.`)
    .addFields(
      { name: '🆕 Cuentas nuevas', value: `${newAccounts.length} de ${joins.length} tienen menos de ${config.minAccountAgeDays} día(s)`, inline: true },
      { name: '📊 Severidad', value: severity === 'high' ? '🔴 Alta' : '🟠 Media', inline: true },
      { name: '⏰ Termina', value: `<t:${Math.floor(state.liftAt / 1000)}:R>`, inline: true },
      { name: '🛠️ Acciones', value: actionsTaken.join('\n') || '—' },
      { name: '👥 Últimas entradas', value: formatUserList(joins.map((join) => join.userId)) },
    )
    .setFooter({ text: `${FOOTER.text} • Usa /antiraid levantar para terminarlo antes` })
    .setTimestamp();

  await sendAlert(guild, config, embed);
}

function formatUserList(userIds: string[]): string {
  const shown = userIds.slice(-15).map((id) => `<@${id}>`).join(' ');
  const hidden = userIds.length - Math.min(userIds.length, 15);
  return (hidden > 0 ? `${shown} y ${hidden} más` : shown) || '—';
}

// Termina el modo raid: restaura la verificación, marca el evento como resuelto y avisa al staff.
// `liftedBy` es 'auto' (venció el tiempo) o el ID de quien lo levantó.
export async function liftLockdown(guildId: string, liftedBy: string = 'manual'): Promise<boolean> {
  const state = activeRaids.get(guildId);
  if (!state) return false;

  activeRaids.delete(guildId);
  state.lifted = true;
  if (state.timer) clearTimeout(state.timer);

  // Si el raid sigue arrancando, esperamos a que guarde el evento y suba la verificación
  // para poder deshacerlo todo (si no, la verificación se quedaría al máximo y el evento abierto)
  await state.ready;

  const guild = discordClient?.guilds.cache.get(guildId);
  const notes: string[] = [];

  if (guild && state.previousVerificationLevel !== null) {
    if (guild.verificationLevel === GuildVerificationLevel.VeryHigh) {
      try {
        await guild.setVerificationLevel(state.previousVerificationLevel, 'Anti-raid: fin del modo raid');
        notes.push('🔓 Restauré el nivel de verificación anterior');
      } catch (error) {
        console.error('Anti-raid: no se pudo restaurar el nivel de verificación:', error);
        notes.push('⚠️ No pude restaurar el nivel de verificación, revísalo a mano');
      }
    } else {
      notes.push('ℹ️ Alguien cambió la verificación durante el raid, así que no la toqué');
    }
  }

  if (state.eventId) {
    await storage.resolveRaidEvent(state.eventId, {
      liftedAt: Date.now(),
      liftedBy,
      joinsDuringRaid: state.joinsDuringRaid,
      kicked: state.kicked,
    }).catch((error) => console.error('Anti-raid: no se pudo marcar el evento como resuelto:', error));
  }

  if (guild) {
    const embed = new EmbedBuilder()
      .setColor(0x57F287)
      .setTitle('✅ Modo anti-raid terminado')
      .setDescription(liftedBy === 'auto'
        ? 'Se cumplió el tiempo y todo volvió a la normalidad.'
        : `Lo levantó <@${liftedBy}>. Todo volvió a la normalidad.`)
      .addFields(
        { name: '👥 Entradas durante el raid', value: `${state.joinsDuringRaid}`, inline: true },
        { name: '👢 Expulsados', value: `${state.kicked}`, inline: true },
      )
      .setFooter(FOOTER)
      .setTimestamp();
    if (notes.length) embed.addFields({ name: '🛠️ Cambios', value: notes.join('\n') });

    const config = await getConfig(guildId);
    await sendAlert(guild, config, embed);
  }

  return true;
}

async function restorePendingRaids() {
  if (!discordClient) return;

  for (const guild of Array.from(discordClient.guilds.cache.values())) {
    try {
      await restoreGuildRaids(guild);
    } catch (error) {
      console.error(`Anti-raid: no se pudo restaurar el modo raid de ${guild.id}:`, error);
    }
  }
}

async function restoreGuildRaids(guild: Guild) {
  const events = await storage.getUnresolvedRaidEvents(guild.id); // del más nuevo al más viejo
  // Modo raid vigente: el que restauramos aquí o uno detectado justo después de arrancar
  let current: RaidState | undefined;

  for (const event of events) {
    const details = (event.details ?? {}) as Record<string, unknown>;
    const liftAt = details.liftAt;
    if (event.type !== 'join_spam' || typeof liftAt !== 'number') continue;

    if (!current) {
      current = activeRaids.get(guild.id);
      if (current) await current.ready; // así ya sabemos el ID de su evento
    }

    // Solo puede haber un modo raid por servidor: los demás eventos abiertos se cierran (nunca el del vigente)
    if (current) {
      if (current.eventId !== event.id) {
        await storage.resolveRaidEvent(event.id, { liftedAt: Date.now(), liftedBy: 'restart' });
      }
      continue;
    }

    const action = antiRaidActions.includes(details.action as AntiRaidAction) ? details.action as AntiRaidAction : 'alert';
    const state: RaidState = {
      eventId: event.id,
      action,
      startedAt: event.createdAt?.getTime() ?? Date.now(),
      liftAt,
      previousVerificationLevel: typeof details.previousVerificationLevel === 'number' ? details.previousVerificationLevel : null,
      joinsDuringRaid: 0,
      kicked: typeof details.kickedAtStart === 'number' ? details.kickedAtStart : 0,
      timer: null,
      ready: Promise.resolve(),
      lifted: false,
    };
    activeRaids.set(guild.id, state);
    current = state;
    state.timer = setTimeout(() => {
      liftLockdown(guild.id, 'auto').catch((error) => console.error('Anti-raid: error al levantar el modo raid:', error));
    }, Math.max(0, state.liftAt - Date.now()));

    console.log(`🛡️ Anti-raid: modo raid restaurado en ${guild.name} hasta ${new Date(state.liftAt).toISOString()}`);
  }
}

// ===== Alertas =====
async function sendAlert(guild: Guild, config: AntiRaidSettings, embed: EmbedBuilder) {
  const target = await findAlertTarget(guild, config);
  if (!target) {
    console.warn(`Anti-raid: no encontré dónde avisar en ${guild.name} (${guild.id})`);
    return;
  }
  try {
    await target.send({ embeds: [embed] });
  } catch (error) {
    console.error(`Anti-raid: no se pudo enviar la alerta en ${guild.id}:`, error);
  }
}

// Palabras (completas) que delatan un canal del staff: "mod-logs", "📋・registro-moderación", "staff"...
// Por palabra y no por substring, para no caer en canales como "blog", "catalogo" o "changelog".
const STAFF_CHANNEL_WORDS = new Set([
  'mod', 'mods', 'modlog', 'modlogs', 'moderacion', 'moderation', 'moderadores', 'moderators',
  'log', 'logs', 'registro', 'registros', 'staff', 'admin', 'admins', 'administracion',
  'alertas', 'alerts', 'seguridad', 'security', 'raid', 'antiraid', 'auditoria', 'audit',
]);

function isStaffChannelName(name: string): boolean {
  const words = name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/[^a-z0-9]+/);
  return words.some((word) => STAFF_CHANNEL_WORDS.has(word));
}

// El bot puede ver el canal y mandar embeds en él
function canAlertIn(guild: Guild, channel: GuildBasedChannel | undefined): channel is GuildBasedChannel & AlertTarget {
  const me = guild.members.me;
  if (!channel || !channel.isSendable() || !me) return false;
  return channel.permissionsFor(me)?.has([
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.EmbedLinks,
  ]) ?? false;
}

// Orden: canal configurado en /antiraid → canal de moderación del dashboard → canal privado del staff
// (por nombre y que @everyone no pueda ver) → mensaje directo al dueño. Nunca un canal público adivinado:
// la alerta dice cuándo termina el modo raid y eso no lo deben ver los raiders.
async function findAlertTarget(guild: Guild, config: AntiRaidSettings): Promise<AlertTarget | null> {
  const preferredIds: (string | null | undefined)[] = [config.logChannelId];
  try {
    preferredIds.push((await storage.getGuild(guild.id))?.moderationChannelId);
  } catch {
    // Sin BD seguimos con los demás candidatos
  }

  for (const id of preferredIds) {
    if (!id) continue;
    const channel = guild.channels.cache.get(id);
    if (canAlertIn(guild, channel)) return channel;
  }

  const everyone = guild.roles.everyone;
  const staffChannel = guild.channels.cache
    .filter((channel): channel is TextChannel =>
      channel.type === ChannelType.GuildText &&
      isStaffChannelName(channel.name) &&
      channel.permissionsFor(everyone).has(PermissionFlagsBits.ViewChannel) === false &&
      canAlertIn(guild, channel)
    )
    .sort((a, b) => a.rawPosition - b.rawPosition)
    .first();
  if (staffChannel) return staffChannel;

  try {
    return await guild.fetchOwner();
  } catch (error) {
    console.error(`Anti-raid: no pude obtener al dueño de ${guild.id} para avisarle:`, error);
    return null;
  }
}

// ===== Estado para comandos / dashboard =====
export function isGuildLocked(guildId: string): boolean {
  return activeRaids.has(guildId);
}

export function getActiveRaid(guildId: string) {
  const state = activeRaids.get(guildId);
  if (!state) return null;
  return {
    action: state.action,
    startedAt: state.startedAt,
    liftAt: state.liftAt,
    joinsDuringRaid: state.joinsDuringRaid,
    kicked: state.kicked,
  };
}
