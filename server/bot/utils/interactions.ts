import {
  ChatInputCommandInteraction,
  Guild,
  InteractionEditReplyOptions,
  MessageFlags,
} from 'discord.js';

type Payload = Pick<InteractionEditReplyOptions, 'content' | 'embeds' | 'components'>;

// Responde aunque el comando ya haya hecho deferReply.
// Con ephemeral: true y una respuesta pública pendiente, la borra y manda el aviso solo al usuario.
export async function respond(
  interaction: ChatInputCommandInteraction,
  payload: string | Payload,
  options: { ephemeral?: boolean } = {}
): Promise<void> {
  const data: Payload = typeof payload === 'string' ? { content: payload } : payload;
  const ephemeral = options.ephemeral === true;

  if (!interaction.deferred && !interaction.replied) {
    await interaction.reply({ ...data, content: data.content ?? undefined, flags: ephemeral ? MessageFlags.Ephemeral : undefined });
    return;
  }

  if (ephemeral && !interaction.ephemeral) {
    await interaction.deleteReply().catch(() => undefined);
    await interaction.followUp({ ...data, content: data.content ?? undefined, flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.editReply(data);
}

export async function resolveGuild(interaction: ChatInputCommandInteraction): Promise<Guild> {
  if (interaction.guild) return interaction.guild;
  if (!interaction.guildId) throw new Error('Comando usado fuera de un servidor');
  return interaction.client.guilds.fetch(interaction.guildId);
}

// Marca de tiempo relativa de Discord ("en 2 horas"), se muestra en el idioma de cada usuario
export function discordRelativeTime(msFromNow: number): string {
  return `<t:${Math.floor((Date.now() + Math.max(msFromNow, 0)) / 1000)}:R>`;
}

export function isAdmin(interaction: ChatInputCommandInteraction): boolean {
  return interaction.memberPermissions?.has('Administrator') ?? false;
}

export const ADMIN_ONLY = '⛔ Solo los administradores pueden usar este comando.';
