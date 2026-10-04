import {
  EmbedBuilder,
  GuildFeature,
  PermissionFlagsBits,
  escapeMarkdown,
  type Guild,
  type GuildMember,
  type Role,
} from 'discord.js';
import type { Guild as GuildRow } from '@shared/schema';
import { storage } from '../../storage';
import { resolveSendableChannel, truncate } from './channels';

export const DEFAULT_WELCOME_MESSAGE =
  '¡Hola {usuario}! 👋 Bienvenid@ a **{servidor}**, ya somos **{miembros}** miembros.\n' +
  'Preséntate y cuéntanos qué te gusta: aquí nadie muerde. 😄';

export const WELCOME_PLACEHOLDERS_HELP = '`{usuario}` (mención), `{nombre}`, `{servidor}` y `{miembros}`';

const WELCOME_COLOR = 0x57F287;

// Si entran demasiadas personas de golpe (posible raid) no saturamos el canal de bienvenidas
const WELCOME_BURST_LIMIT = 8;
const WELCOME_BURST_WINDOW_MS = 60_000;
const recentWelcomes = new Map<string, number[]>();

// Si el bot se reinicia mientras alguien está aceptando las reglas, le damos el rol pendiente
// solo si entró hace poco (así no se le da a miembros antiguos a los que se les quitó a propósito)
const PENDING_ROLE_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

// Permisos que nunca damos automáticamente al entrar
const DANGEROUS_PERMISSIONS = [
  PermissionFlagsBits.Administrator,
  PermissionFlagsBits.ManageGuild,
  PermissionFlagsBits.ManageRoles,
  PermissionFlagsBits.ManageChannels,
  PermissionFlagsBits.ManageMessages,
  PermissionFlagsBits.ManageWebhooks,
  PermissionFlagsBits.KickMembers,
  PermissionFlagsBits.BanMembers,
  PermissionFlagsBits.ModerateMembers,
  PermissionFlagsBits.MentionEveryone,
  PermissionFlagsBits.MuteMembers,
  PermissionFlagsBits.DeafenMembers,
  PermissionFlagsBits.MoveMembers,
  PermissionFlagsBits.ManageNicknames,
  PermissionFlagsBits.ManageThreads,
  PermissionFlagsBits.ManageEvents,
  PermissionFlagsBits.ManageGuildExpressions,
  PermissionFlagsBits.ViewAuditLog,
];

export function renderWelcomeTemplate(template: string | null | undefined, member: GuildMember): string {
  const text = template?.trim() ? template : DEFAULT_WELCOME_MESSAGE;
  // Reemplazos con función: así un "$" en el nombre del servidor o del usuario se copia tal cual
  return text
    .replace(/\{usuario\}/gi, () => `<@${member.id}>`)
    .replace(/\{nombre\}/gi, () => escapeMarkdown(member.user.username))
    .replace(/\{servidor\}/gi, () => escapeMarkdown(member.guild.name))
    .replace(/\{miembros\}/gi, () => member.guild.memberCount.toLocaleString('es-MX'));
}

export function buildWelcomeEmbed(member: GuildMember, template: string | null | undefined): EmbedBuilder {
  const guild = member.guild;
  return new EmbedBuilder()
    .setColor(WELCOME_COLOR)
    .setTitle(truncate(`👋 ¡Bienvenid@ a ${guild.name}!`, 256))
    .setDescription(truncate(renderWelcomeTemplate(template, member), 4096))
    .setThumbnail(member.displayAvatarURL({ size: 256 }))
    .setFooter({
      text: `Miembro #${guild.memberCount.toLocaleString('es-MX')}`,
      iconURL: guild.iconURL() ?? undefined,
    })
    .setTimestamp();
}

export function buildWelcomeMessage(member: GuildMember, template: string | null | undefined) {
  return {
    content: `<@${member.id}>`,
    embeds: [buildWelcomeEmbed(member, template)],
    // Solo se menciona al nuevo miembro, aunque el texto incluya @everyone o roles
    allowedMentions: { users: [member.id] },
  };
}

export type WelcomeRoleCheck = { ok: true; role: Role } | { ok: false; reason: string };

// Revisa si el bot puede (y debe) dar ese rol automáticamente
export function checkWelcomeRole(guild: Guild, roleId: string | null | undefined): WelcomeRoleCheck {
  if (!roleId) return { ok: false, reason: 'No hay rol automático configurado.' };

  const role = guild.roles.cache.get(roleId);
  if (!role) return { ok: false, reason: 'El rol configurado ya no existe.' };
  if (role.id === guild.id) return { ok: false, reason: 'No se puede usar @everyone como rol automático.' };
  if (role.managed) {
    return { ok: false, reason: `${role} lo administra una integración o bot, no se puede asignar a mano.` };
  }
  if (DANGEROUS_PERMISSIONS.some(permission => role.permissions.has(permission))) {
    return {
      ok: false,
      reason: `Por seguridad no doy automáticamente roles con permisos de moderación o administración (${role}).`,
    };
  }

  const me = guild.members.me;
  if (!me?.permissions.has(PermissionFlagsBits.ManageRoles)) {
    return { ok: false, reason: 'Me falta el permiso **Gestionar roles**.' };
  }
  if (!role.editable) {
    return {
      ok: false,
      reason: `Mi rol más alto debe estar **por encima** de ${role} en Ajustes del servidor → Roles.`,
    };
  }
  return { ok: true, role };
}

export async function assignWelcomeRole(member: GuildMember, roleId: string | null | undefined): Promise<void> {
  if (!roleId || member.roles.cache.has(roleId)) return;

  const check = checkWelcomeRole(member.guild, roleId);
  if (!check.ok) {
    console.warn(`[BIENVENIDA] No se asignó el rol automático en ${member.guild.name}: ${check.reason}`);
    return;
  }

  try {
    await member.roles.add(check.role, 'Rol automático de bienvenida');
  } catch (error) {
    console.error(`[BIENVENIDA] Error al asignar el rol automático en ${member.guild.name}:`, error);
  }
}

function isWelcomeBurst(guildId: string): boolean {
  const now = Date.now();
  const recent = (recentWelcomes.get(guildId) || []).filter(time => now - time < WELCOME_BURST_WINDOW_MS);
  const burst = recent.length >= WELCOME_BURST_LIMIT;
  if (!burst) recent.push(now);
  recentWelcomes.set(guildId, recent);
  return burst;
}

async function sendWelcome(member: GuildMember, settings: GuildRow): Promise<void> {
  const target = resolveSendableChannel(member.guild, settings.welcomeChannelId);
  if (!target.ok) {
    console.warn(`[BIENVENIDA] No se pudo dar la bienvenida en ${member.guild.name}: ${target.reason}`);
    return;
  }
  if (isWelcomeBurst(member.guild.id)) {
    console.warn(`[BIENVENIDA] Demasiadas entradas seguidas en ${member.guild.name}; se omite la bienvenida de ${member.user.tag}.`);
    return;
  }
  await target.channel.send(buildWelcomeMessage(member, settings.welcomeMessage));
}

// Se llama desde GuildMemberAdd: mensaje de bienvenida + rol automático
export async function handleMemberWelcome(member: GuildMember): Promise<void> {
  if (member.user.bot) return;

  const settings = await storage.getGuild(member.guild.id);
  if (!settings) return;

  if (settings.welcomeEnabled) {
    try {
      await sendWelcome(member, settings);
    } catch (error) {
      console.error(`[BIENVENIDA] Error al enviar la bienvenida en ${member.guild.name}:`, error);
    }
  }

  // Si el servidor usa verificación de reglas, el rol se da al completarla (GuildMemberUpdate o GuildMemberAvailable)
  if (settings.welcomeRoleId && !member.pending) {
    await assignWelcomeRole(member, settings.welcomeRoleId);
  }
}

// Se llama desde GuildMemberUpdate cuando el miembro acepta las reglas del servidor
export async function handleMemberPassedScreening(member: GuildMember): Promise<void> {
  if (member.user.bot) return;
  const settings = await storage.getGuild(member.guild.id);
  if (settings?.welcomeRoleId) {
    await assignWelcomeRole(member, settings.welcomeRoleId);
  }
}

// Se llama desde GuildMemberAvailable. Si el miembro no estaba en caché (p. ej. después de reiniciar
// el bot en un servidor grande), discord.js emite este evento en lugar de GuildMemberUpdate cuando
// alguien termina de aceptar las reglas, así que aquí recuperamos el rol automático pendiente.
export async function handleMemberAvailable(member: GuildMember): Promise<void> {
  if (member.user.bot || member.pending) return;
  // Solo aplica a servidores con verificación de reglas; en los demás el rol se da al entrar
  if (!member.guild.features.includes(GuildFeature.MemberVerificationGateEnabled)) return;

  const joinedAt = member.joinedTimestamp;
  if (!joinedAt || Date.now() - joinedAt > PENDING_ROLE_WINDOW_MS) return;

  const settings = await storage.getGuild(member.guild.id);
  if (settings?.welcomeRoleId && !member.roles.cache.has(settings.welcomeRoleId)) {
    await assignWelcomeRole(member, settings.welcomeRoleId);
  }
}
