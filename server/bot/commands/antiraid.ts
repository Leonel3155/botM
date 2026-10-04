import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder, PermissionFlagsBits, MessageFlags, ChannelType } from 'discord.js';
import { storage } from '../../storage';
import { DiscordBot } from '../index';
import type { AntiRaidAction, AntiRaidSettings } from '@shared/schema';
import { ANTI_RAID_ACTION_LABELS, getActiveRaid, invalidateAntiRaidConfig, liftLockdown } from '../middleware/antiRaid';

const DAY_MS = 24 * 60 * 60 * 1000;

function configFields(config: AntiRaidSettings) {
  return [
    { name: '🔒 Detección', value: `${config.joinThreshold} entradas en ${config.joinWindowSeconds} s`, inline: true },
    { name: '⏳ Duración del modo raid', value: `${config.lockdownMinutes} min`, inline: true },
    { name: '🆕 Cuenta nueva', value: `Menos de ${config.minAccountAgeDays} día(s)`, inline: true },
    { name: '🛠️ Acción', value: ANTI_RAID_ACTION_LABELS[config.action], inline: false },
    {
      name: '📣 Canal de alertas',
      value: config.logChannelId ? `<#${config.logChannelId}>` : 'Automático (canal de moderación, de logs o del sistema)',
      inline: false,
    },
  ];
}

export const antiraidCommands = [
  {
    data: new SlashCommandBuilder()
      .setName('antiraid')
      .setDescription('🛡️ Configura la protección anti-raid')
      .addSubcommand(subcommand =>
        subcommand
          .setName('status')
          .setDescription('Ver el estado y la configuración de la protección anti-raid')
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('activar')
          .setDescription('Activar la protección anti-raid')
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('desactivar')
          .setDescription('Desactivar la protección anti-raid (también termina un modo raid activo)')
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('configurar')
          .setDescription('Ajustar cuándo se detecta un raid y qué hacer')
          .addIntegerOption(option =>
            option.setName('entradas').setDescription('Cuántas entradas seguidas cuentan como raid (3-100)').setMinValue(3).setMaxValue(100)
          )
          .addIntegerOption(option =>
            option.setName('segundos').setDescription('En cuántos segundos deben ocurrir esas entradas (5-300)').setMinValue(5).setMaxValue(300)
          )
          .addStringOption(option =>
            option.setName('accion')
              .setDescription('Qué hacer al detectar un raid')
              .addChoices(
                { name: 'Solo alertar al staff', value: 'alert' },
                { name: 'Subir la verificación al máximo', value: 'verification' },
                { name: 'Lockdown (verificación máxima + expulsar a quien entre)', value: 'lockdown' }
              )
          )
          .addChannelOption(option =>
            option.setName('canal').setDescription('Canal donde avisar al staff').addChannelTypes(ChannelType.GuildText)
          )
          .addIntegerOption(option =>
            option.setName('duracion').setDescription('Minutos que dura el modo raid (1-1440)').setMinValue(1).setMaxValue(1440)
          )
          .addIntegerOption(option =>
            option.setName('edad_cuenta').setDescription('Días mínimos de antigüedad para no considerar "nueva" una cuenta (0-365)').setMinValue(0).setMaxValue(365)
          )
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('levantar')
          .setDescription('Terminar ahora el modo raid activo')
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    async execute(interaction: ChatInputCommandInteraction, bot: DiscordBot) {
      if (!interaction.guild) {
        await interaction.reply({ content: 'Este comando solo funciona en servidores.', flags: MessageFlags.Ephemeral });
        return;
      }

      const guild = interaction.guild;
      const subcommand = interaction.options.getSubcommand();
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      // El servidor tiene que existir en la BD antes de guardar su configuración
      await storage.ensureGuild(guild.id, guild.name, guild.ownerId);

      switch (subcommand) {
        case 'status': {
          const config = await storage.getAntiRaidConfig(guild.id);
          const recentEvents = await storage.getRecentRaidEvents(guild.id, DAY_MS);
          const activeRaid = getActiveRaid(guild.id);

          const embed = new EmbedBuilder()
            .setColor(activeRaid ? 0xED4245 : config.enabled ? 0x57F287 : 0xFEE75C)
            .setTitle('🛡️ Protección anti-raid')
            .setDescription(config.enabled
              ? '🟢 **Activada**: estoy vigilando las entradas al servidor.'
              : '🔴 **Desactivada**: usa `/antiraid activar` para proteger el servidor.')
            .addFields(...configFields(config))
            .addFields(
              {
                name: '🚨 Modo raid',
                value: activeRaid
                  ? `**Activo** hasta <t:${Math.floor(activeRaid.liftAt / 1000)}:R> • ${activeRaid.joinsDuringRaid} entradas • ${activeRaid.kicked} expulsados`
                  : 'Tranquilo, no hay raid en curso',
                inline: false,
              },
              {
                name: '📊 Raids (últimas 24 h)',
                value: recentEvents.length
                  ? `${recentEvents.length} • último <t:${Math.floor((recentEvents[0].createdAt?.getTime() ?? Date.now()) / 1000)}:R>`
                  : 'Ninguno',
                inline: false,
              }
            )
            .setTimestamp();

          await interaction.editReply({ embeds: [embed] });
          break;
        }

        case 'activar': {
          const config = await storage.setAntiRaidConfig(guild.id, { enabled: true });
          invalidateAntiRaidConfig(guild.id);

          await interaction.editReply({
            embeds: [
              new EmbedBuilder()
                .setColor(0x57F287)
                .setTitle('✅ Protección anti-raid activada')
                .setDescription('Tu servidor está protegido. Si detecto una entrada masiva, actuaré y avisaré al staff.')
                .addFields(...configFields(config))
            ]
          });
          break;
        }

        case 'desactivar': {
          await storage.setAntiRaidConfig(guild.id, { enabled: false });
          invalidateAntiRaidConfig(guild.id);
          const lifted = await liftLockdown(guild.id, interaction.user.id);

          await interaction.editReply({
            embeds: [
              new EmbedBuilder()
                .setColor(0xFEE75C)
                .setTitle('⚠️ Protección anti-raid desactivada')
                .setDescription('Ojo: ya no reaccionaré ante entradas masivas.' + (lifted ? '\nTambién terminé el modo raid que estaba activo.' : ''))
            ]
          });
          break;
        }

        case 'configurar': {
          const updates: Partial<AntiRaidSettings> = {};
          const entradas = interaction.options.getInteger('entradas');
          const segundos = interaction.options.getInteger('segundos');
          const accion = interaction.options.getString('accion') as AntiRaidAction | null;
          const canal = interaction.options.getChannel('canal');
          const duracion = interaction.options.getInteger('duracion');
          const edadCuenta = interaction.options.getInteger('edad_cuenta');

          if (entradas !== null) updates.joinThreshold = entradas;
          if (segundos !== null) updates.joinWindowSeconds = segundos;
          if (accion !== null) updates.action = accion;
          if (canal !== null) updates.logChannelId = canal.id;
          if (duracion !== null) updates.lockdownMinutes = duracion;
          if (edadCuenta !== null) updates.minAccountAgeDays = edadCuenta;

          const changed = Object.keys(updates).length > 0;
          const config = changed
            ? await storage.setAntiRaidConfig(guild.id, updates)
            : await storage.getAntiRaidConfig(guild.id);
          invalidateAntiRaidConfig(guild.id);

          const embed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle(changed ? '💾 Configuración anti-raid guardada' : '⚙️ Configuración anti-raid actual')
            .setDescription(config.enabled
              ? 'La protección está **activada**.'
              : 'La protección está **desactivada**. Actívala con `/antiraid activar`.')
            .addFields(...configFields(config));

          if (!changed) embed.setFooter({ text: 'Usa las opciones del comando para cambiar algún valor' });

          await interaction.editReply({ embeds: [embed] });
          break;
        }

        case 'levantar': {
          const lifted = await liftLockdown(guild.id, interaction.user.id);
          await interaction.editReply({
            content: lifted
              ? '✅ Listo, terminé el modo raid y avisé en el canal de alertas.'
              : 'ℹ️ No hay ningún modo raid activo en este momento.'
          });
          break;
        }
      }
    }
  }
];
