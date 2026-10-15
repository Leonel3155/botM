import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  DiscordAPIError,
  EmbedBuilder,
  MessageFlags,
  RESTJSONErrorCodes,
  type ButtonInteraction,
  type Guild,
  type GuildMember,
  type Message,
} from 'discord.js';
import { and, asc, count, eq } from 'drizzle-orm';
import { ROLE_PANEL_LIMITS } from '@shared/api';
import { rolePanels, type RolePanel, type RolePanelButton } from '@shared/schema';
import { db } from '../../db';
import { resolveSendableChannel, truncate, withLineBreaks } from './channels';
import { checkGrantableRole } from './roles';

// customId de cada botón: "rp:<id del panel>:<id del rol>" (Discord admite hasta 100 caracteres)
const BUTTON_PREFIX = 'rp:';
const PANEL_COLOR = 0xFFD700;

export class RolePanelLimitError extends Error {
  constructor(public readonly limit: number) {
    super(`Este servidor ya tiene el máximo de ${limit} paneles de autorroles. Borra alguno antes de crear otro.`);
    this.name = 'RolePanelLimitError';
  }
}

/** No se pudo publicar en Discord; el mensaje ya está en español. */
export class RolePanelPublishError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RolePanelPublishError';
  }
}

export interface RolePanelInput {
  channelId: string;
  title: string;
  description: string | null;
  exclusive: boolean;
  roles: RolePanelButton[];
}

// ===== Base de datos =====

export function listRolePanels(guildId: string): Promise<RolePanel[]> {
  return db.select().from(rolePanels).where(eq(rolePanels.guildId, guildId)).orderBy(asc(rolePanels.createdAt));
}

export async function getRolePanel(guildId: string, panelId: string): Promise<RolePanel | undefined> {
  const [panel] = await db
    .select()
    .from(rolePanels)
    .where(and(eq(rolePanels.guildId, guildId), eq(rolePanels.id, panelId)));
  return panel;
}

async function countRolePanels(guildId: string): Promise<number> {
  const [row] = await db.select({ total: count() }).from(rolePanels).where(eq(rolePanels.guildId, guildId));
  return row?.total ?? 0;
}

// ===== Mensaje en Discord =====

export function buildRolePanelMessage(panel: Pick<RolePanel, 'id' | 'title' | 'description' | 'roles' | 'exclusive'>) {
  const hint = panel.exclusive
    ? 'Pulsa un botón para elegir tu rol (solo uno a la vez). Púlsalo otra vez para quitártelo.'
    : 'Pulsa un botón para ponerte el rol y otra vez para quitártelo.';
  const embed = new EmbedBuilder()
    .setColor(PANEL_COLOR)
    .setTitle(truncate(panel.title, 256))
    .setFooter({ text: hint });
  if (panel.description) embed.setDescription(truncate(withLineBreaks(panel.description), 4096));

  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  panel.roles.slice(0, ROLE_PANEL_LIMITS.maxRoles).forEach((button, index) => {
    if (index % 5 === 0) rows.push(new ActionRowBuilder<ButtonBuilder>());
    const builder = new ButtonBuilder()
      .setCustomId(`${BUTTON_PREFIX}${panel.id}:${button.roleId}`)
      .setStyle(ButtonStyle.Secondary)
      .setLabel(truncate(button.label, 80));
    if (button.emoji) builder.setEmoji(button.emoji);
    rows[rows.length - 1].addComponents(builder);
  });

  return { embeds: [embed], components: rows, allowedMentions: { parse: [] } };
}

function isUnknownMessage(error: unknown): boolean {
  return error instanceof DiscordAPIError &&
    (error.code === RESTJSONErrorCodes.UnknownMessage || error.code === RESTJSONErrorCodes.UnknownChannel);
}

function explainPublishError(error: unknown): string {
  if (error instanceof DiscordAPIError) {
    if (error.code === RESTJSONErrorCodes.InvalidFormBodyOrContentType || error.status === 400) {
      return 'Discord rechazó el mensaje. Revisa que los emojis existan (los del servidor deben ser de este servidor).';
    }
    if (error.code === RESTJSONErrorCodes.MissingPermissions || error.code === RESTJSONErrorCodes.MissingAccess) {
      return 'No tengo permiso para publicar en ese canal (Ver canal, Enviar mensajes e Insertar enlaces).';
    }
    return `Discord no aceptó el mensaje (error ${error.status}: "${error.message}").`;
  }
  return 'No pude publicar el mensaje en Discord. Intenta de nuevo en un momento.';
}

async function fetchPanelMessage(guild: Guild, panel: RolePanel): Promise<Message | null> {
  if (!panel.messageId) return null;
  const channel = guild.channels.cache.get(panel.channelId);
  if (!channel?.isTextBased()) return null;
  try {
    return await channel.messages.fetch(panel.messageId);
  } catch (error) {
    if (isUnknownMessage(error)) return null;
    throw error;
  }
}

/**
 * Publica el panel: si su mensaje sigue en el mismo canal lo edita; si no, manda uno nuevo
 * (y borra el viejo si cambió de canal). Devuelve el id del mensaje.
 */
async function publish(guild: Guild, panel: RolePanel, previous: RolePanel | null): Promise<string> {
  const target = resolveSendableChannel(guild, panel.channelId);
  if (!target.ok) throw new RolePanelPublishError(target.reason);

  const payload = buildRolePanelMessage(panel);
  try {
    if (previous && previous.channelId === panel.channelId) {
      const existing = await fetchPanelMessage(guild, previous);
      if (existing) {
        await existing.edit(payload);
        return existing.id;
      }
    }
    const message = await target.channel.send(payload);
    if (previous && previous.channelId !== panel.channelId) {
      await deletePanelMessage(guild, previous);
    }
    return message.id;
  } catch (error) {
    if (error instanceof RolePanelPublishError) throw error;
    console.error(`[AUTORROLES] No se pudo publicar el panel ${panel.id} en ${guild.name}:`, error);
    throw new RolePanelPublishError(explainPublishError(error));
  }
}

async function deletePanelMessage(guild: Guild, panel: RolePanel): Promise<void> {
  try {
    const message = await fetchPanelMessage(guild, panel);
    await message?.delete();
  } catch (error) {
    // Si no se puede borrar (sin permisos), el mensaje queda, pero sus botones dirán que el panel ya no existe
    console.warn(`[AUTORROLES] No se pudo borrar el mensaje del panel ${panel.id} en ${guild.name}:`, error);
  }
}

// ===== Crear, editar y borrar (desde el panel web) =====

export async function createRolePanel(guild: Guild, input: RolePanelInput): Promise<RolePanel> {
  if (await countRolePanels(guild.id) >= ROLE_PANEL_LIMITS.maxPerGuild) {
    throw new RolePanelLimitError(ROLE_PANEL_LIMITS.maxPerGuild);
  }
  const [panel] = await db.insert(rolePanels).values({ guildId: guild.id, ...input }).returning();
  try {
    const messageId = await publish(guild, panel, null);
    const [saved] = await db.update(rolePanels).set({ messageId }).where(eq(rolePanels.id, panel.id)).returning();
    return saved;
  } catch (error) {
    // Si no se pudo publicar, no se queda un panel a medias
    await db.delete(rolePanels).where(eq(rolePanels.id, panel.id));
    throw error;
  }
}

export async function updateRolePanel(guild: Guild, panelId: string, input: RolePanelInput): Promise<RolePanel | undefined> {
  const previous = await getRolePanel(guild.id, panelId);
  if (!previous) return undefined;

  // Primero se publica (con los datos nuevos) y solo si sale bien se guarda
  const draft: RolePanel = { ...previous, ...input };
  const messageId = await publish(guild, draft, previous);
  const [saved] = await db
    .update(rolePanels)
    .set({ ...input, messageId, updatedAt: new Date() })
    .where(and(eq(rolePanels.guildId, guild.id), eq(rolePanels.id, panelId)))
    .returning();
  return saved;
}

export async function deleteRolePanel(guild: Guild | null, guildId: string, panelId: string): Promise<boolean> {
  const panel = await getRolePanel(guildId, panelId);
  if (!panel) return false;
  if (guild) await deletePanelMessage(guild, panel);
  await db.delete(rolePanels).where(and(eq(rolePanels.guildId, guildId), eq(rolePanels.id, panelId)));
  return true;
}

// ===== Botones (en Discord) =====

export function isRolePanelButton(customId: string): boolean {
  return customId.startsWith(BUTTON_PREFIX);
}

async function memberOf(interaction: ButtonInteraction<'cached'>): Promise<GuildMember> {
  return interaction.member ?? interaction.guild.members.fetch(interaction.user.id);
}

export async function handleRolePanelButton(interaction: ButtonInteraction): Promise<void> {
  if (!interaction.inCachedGuild()) {
    await interaction.reply({ content: 'Este botón solo funciona dentro del servidor.', flags: MessageFlags.Ephemeral });
    return;
  }
  const [panelId, roleId] = interaction.customId.slice(BUTTON_PREFIX.length).split(':');
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const panel = panelId ? await getRolePanel(interaction.guildId, panelId) : undefined;
  const button = panel?.roles.find((candidate) => candidate.roleId === roleId);
  if (!panel || !button) {
    await interaction.editReply('Este botón ya no está activo. Pídele a un admin que actualice el panel de roles.');
    return;
  }

  const check = checkGrantableRole(interaction.guild, roleId);
  if (!check.ok) {
    console.warn(`[AUTORROLES] No se pudo usar el rol ${roleId} en ${interaction.guild.name}: ${check.reason}`);
    await interaction.editReply(`No puedo darte ese rol ahora: ${check.reason} Avísale a un admin.`);
    return;
  }

  const member = await memberOf(interaction);
  const role = check.role;
  try {
    if (member.roles.cache.has(role.id)) {
      await member.roles.remove(role, `Autorroles: "${panel.title}"`);
      await interaction.editReply(`Listo, te quité ${role}.`);
      return;
    }

    // En un panel de "solo uno", se quitan los otros roles del mismo panel
    const removed: string[] = [];
    if (panel.exclusive) {
      for (const other of panel.roles) {
        if (other.roleId === role.id || !member.roles.cache.has(other.roleId)) continue;
        const otherCheck = checkGrantableRole(interaction.guild, other.roleId);
        if (!otherCheck.ok) continue;
        await member.roles.remove(otherCheck.role, `Autorroles: "${panel.title}" (solo uno a la vez)`);
        removed.push(`${otherCheck.role}`);
      }
    }
    await member.roles.add(role, `Autorroles: "${panel.title}"`);
    const swapped = removed.length > 0 ? ` (te quité ${removed.join(', ')})` : '';
    await interaction.editReply(`Listo, ya tienes ${role}${swapped}.`);
  } catch (error) {
    console.error(`[AUTORROLES] Error al cambiar el rol ${role.name} en ${interaction.guild.name}:`, error);
    await interaction.editReply('No pude cambiar tu rol. Intenta de nuevo en un momento; si sigue fallando, avísale a un admin.');
  }
}
