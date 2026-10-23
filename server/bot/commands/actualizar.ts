import {
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  Team,
  type ChatInputCommandInteraction,
} from 'discord.js';
import type { DiscordBot } from '../index';
import { applyUpdate, checkForUpdate, UpdateError } from '../services/updater';
import { truncate } from '../services/channels';

/**
 * Solo quien es dueño de la aplicación del bot en Discord Developer Portal (o de su equipo):
 * actualizar cambia el código que corre en la computadora donde vive BotM.
 */
async function isBotOwner(interaction: ChatInputCommandInteraction): Promise<boolean> {
  const application = await interaction.client.application.fetch();
  const owner = application.owner;
  if (!owner) return false;
  if (owner instanceof Team) return owner.members.has(interaction.user.id);
  return owner.id === interaction.user.id;
}

function changeList(changes: string[]): string {
  const shown = changes.slice(0, 10).map((change) => `• ${truncate(change, 120)}`);
  if (changes.length > 10) shown.push(`…y ${changes.length - 10} más`);
  return shown.join('\n');
}

export default {
  data: new SlashCommandBuilder()
    .setName('actualizar')
    .setDescription('🔄 Revisa si hay versión nueva de BotM y la instala')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((sub) => sub.setName('revisar').setDescription('Ver si hay cambios nuevos en GitHub (no instala nada)'))
    .addSubcommand((sub) => sub.setName('ahora').setDescription('Bajar la versión nueva y reiniciar el bot')),

  async execute(interaction: ChatInputCommandInteraction, _bot: DiscordBot) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (!(await isBotOwner(interaction))) {
      await interaction.editReply('⛔ Solo el dueño del bot (quien lo creó en Discord Developer Portal) puede actualizarlo.');
      return;
    }

    const subcommand = interaction.options.getSubcommand();
    try {
      if (subcommand === 'revisar') {
        const status = await checkForUpdate();
        const embed = new EmbedBuilder().setColor(0xFFD700).setTitle('🔄 Versión de BotM').setFooter({ text: `Rama ${status.branch} · versión ${status.current}` });
        if (status.pending.length === 0) {
          embed.setDescription('✅ Ya tienes la última versión.');
        } else {
          embed.setDescription(`🆕 Hay **${status.pending.length}** cambio(s) nuevo(s):\n${changeList(status.pending)}\n\nInstálalos con \`/actualizar ahora\`.`);
        }
        if (status.localChanges.length > 0) {
          // Discord acepta hasta 1024 caracteres por campo, contando el aviso del final
          const suffix = '\nAsí no puedo actualizar solo.';
          embed.addFields({ name: '⚠️ Archivos cambiados a mano', value: truncate(status.localChanges.join(', '), 1024 - suffix.length) + suffix });
        }
        await interaction.editReply({ embeds: [embed] });
        return;
      }

      await interaction.editReply('⏳ Bajando la versión nueva… (si hay que instalar dependencias puede tardar unos minutos)');
      const result = await applyUpdate();
      if (result.installed.length === 0) {
        await interaction.editReply('✅ Ya tienes la última versión. No hay nada que instalar.');
        return;
      }
      const lines = [
        `✅ Instalé **${result.installed.length}** cambio(s):`,
        changeList(result.installed),
        '',
        result.needsDbPush
          ? '⚠️ Esta versión cambia las tablas: cierra BotM (Ctrl + C), corre `npm run db:push` y ábrelo otra vez.'
          : result.restarting
            ? '🔄 Me reinicio en unos segundos. El panel web pedirá iniciar sesión otra vez.'
            : '⚠️ Para usar la versión nueva cierra BotM (Ctrl + C) y ábrelo otra vez con `npm run dev`.',
      ];
      await interaction.editReply(truncate(lines.join('\n'), 2000));
    } catch (error) {
      if (error instanceof UpdateError) {
        await interaction.editReply(`❌ ${error.message}`);
        return;
      }
      throw error;
    }
  },
};
