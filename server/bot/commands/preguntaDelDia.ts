import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  ChannelType,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
} from 'discord.js';
import type { Guild as GuildRow } from '@shared/schema';
import { DiscordBot } from '../index';
import { storage } from '../../storage';
import {
  canCreateThreads,
  ensureMemberPermission,
  replyGuildOnly,
  resolveSendableChannel,
} from '../services/channels';
import { DEFAULT_DAILY_QUESTION_HOUR, dailyQuestions, remainingDailyQuestions } from '../services/dailyQuestion';
import {
  formatInTimezone,
  getLocalDateString,
  getZonedParts,
  normalizeTimezone,
  resolveTimezone,
  zonedTimeToDate,
} from '../services/timezone';
import { PREGUNTAS_DEL_DIA } from '../data/preguntasDelDia';

const TEXT_CHANNEL_TYPES = [ChannelType.GuildText, ChannelType.GuildAnnouncement] as const;

const formatHour = (hour: number) => `${String(hour).padStart(2, '0')}:00`;

// Explica cuándo sale la siguiente pregunta (con marca de tiempo de Discord, que cada quien ve en su hora local)
function describeSchedule(settings: GuildRow): string {
  const timezone = resolveTimezone(settings.timezone);
  const hour = settings.dailyQuestionHour ?? DEFAULT_DAILY_QUESTION_HOUR;
  const now = new Date();
  const local = getZonedParts(now, timezone);
  const postedToday = settings.dailyQuestionLastPosted === getLocalDateString(now, timezone);
  const schedule = `todos los días a las **${formatHour(hour)}** (${timezone})`;

  if (!settings.dailyQuestionEnabled) {
    return `🔴 Está desactivada. Al activarla saldrá ${schedule}.`;
  }
  if (!postedToday && local.hour >= hour) {
    return `🟢 La pregunta de hoy sale en menos de un minuto. Después, ${schedule}.`;
  }

  const day = new Date(Date.UTC(local.year, local.month - 1, local.day + (postedToday ? 1 : 0)));
  const next = zonedTimeToDate(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), hour, 0, timezone);
  const when = next ? ` (<t:${Math.floor(next.getTime() / 1000)}:R>)` : '';
  return postedToday
    ? `🟢 La de hoy ya salió; la próxima sale mañana${when}. Horario: ${schedule}.`
    : `🟢 La próxima sale hoy${when}. Horario: ${schedule}.`;
}

export const preguntaDelDiaCommands = [
  {
    data: new SlashCommandBuilder()
      .setName('pregunta-del-dia')
      .setDescription('❓ Configura la pregunta del día para animar la conversación')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .setContexts(InteractionContextType.Guild)
      .addSubcommand(subcommand =>
        subcommand
          .setName('canal')
          .setDescription('Elige el canal donde se publica la pregunta del día')
          .addChannelOption(option =>
            option.setName('canal')
              .setDescription('Canal para la pregunta del día')
              .addChannelTypes(...TEXT_CHANNEL_TYPES)
              .setRequired(true)
          )
          .addBooleanOption(option =>
            option.setName('hilo')
              .setDescription('¿Abrir un hilo para las respuestas? (por defecto sí)')
              .setRequired(false)
          )
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('hora')
          .setDescription('Hora del día en que se publica (0-23, hora del servidor)')
          .addIntegerOption(option =>
            option.setName('hora')
              .setDescription('Hora en formato 24 h, por ejemplo 18 para las 6 de la tarde')
              .setMinValue(0)
              .setMaxValue(23)
              .setRequired(true)
          )
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('zona')
          .setDescription('Zona horaria del servidor (también se usa para /evento)')
          .addStringOption(option =>
            option.setName('zona')
              .setDescription('Ej.: America/Mexico_City, America/Bogota, Europe/Madrid, o simplemente "CDMX"')
              .setMaxLength(64)
              .setRequired(true)
          )
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('activar')
          .setDescription('Activa la pregunta del día')
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('desactivar')
          .setDescription('Desactiva la pregunta del día')
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('ahora')
          .setDescription('Publica una pregunta ahora mismo (cuenta como la de hoy)')
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('estado')
          .setDescription('Muestra la configuración actual de la pregunta del día')
      ),

    async execute(interaction: ChatInputCommandInteraction, bot: DiscordBot) {
      if (!interaction.inCachedGuild()) {
        await replyGuildOnly(interaction);
        return;
      }
      if (!(await ensureMemberPermission(interaction, ['ManageGuild']))) return;

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const guild = interaction.guild;
      const subcommand = interaction.options.getSubcommand();

      try {
        await storage.ensureGuild(guild.id, guild.name, guild.ownerId);
        const settings = await storage.getGuild(guild.id);
        if (!settings) throw new Error(`Guild ${guild.id} not found after ensureGuild`);

        switch (subcommand) {
          case 'canal': {
            const channelId = interaction.options.getChannel('canal', true, [...TEXT_CHANNEL_TYPES]).id;
            const thread = interaction.options.getBoolean('hilo');
            const updated = await storage.updateEngagementSettings(guild.id, {
              dailyQuestionChannelId: channelId,
              ...(thread !== null ? { dailyQuestionThread: thread } : {}),
            });
            dailyQuestions.syncGuild(updated);

            const check = resolveSendableChannel(guild, channelId);
            const useThread = updated?.dailyQuestionThread ?? true;
            const lines = [
              `✅ La pregunta del día se publicará en <#${channelId}>${useThread ? ' con un hilo para las respuestas' : ''}.`,
            ];
            if (!check.ok) lines.push(`⚠️ ${check.reason}`);
            else if (useThread && !canCreateThreads(check.channel)) {
              lines.push('⚠️ Me falta el permiso **Crear hilos públicos** en ese canal; publicaré la pregunta sin hilo.');
            }
            if (!updated?.dailyQuestionEnabled) lines.push('Cuando quieras encenderla usa `/pregunta-del-dia activar`.');
            await interaction.editReply(lines.join('\n'));
            break;
          }

          case 'hora': {
            const hour = interaction.options.getInteger('hora', true);
            const updated = await storage.updateEngagementSettings(guild.id, { dailyQuestionHour: hour });
            dailyQuestions.syncGuild(updated);
            await interaction.editReply(`✅ Hora guardada: **${formatHour(hour)}**.\n${describeSchedule(updated ?? settings)}`);
            break;
          }

          case 'zona': {
            const input = interaction.options.getString('zona', true);
            const timezone = normalizeTimezone(input);
            if (!timezone) {
              await interaction.editReply(
                `❌ No reconozco la zona horaria **${input}**.\n` +
                'Usa un nombre como `America/Mexico_City`, `America/Monterrey`, `America/Bogota`, ' +
                '`America/Argentina/Buenos_Aires` o `Europe/Madrid` (también acepto atajos como `CDMX`, `Colombia` o `España`).'
              );
              break;
            }

            const updated = await storage.updateEngagementSettings(guild.id, { timezone });
            dailyQuestions.syncGuild(updated);
            await interaction.editReply(
              `✅ Zona horaria: **${timezone}** (allí ahora es ${formatInTimezone(new Date(), timezone)}).\n` +
              'Se usa para la pregunta del día y para las fechas de `/evento crear`.'
            );
            break;
          }

          case 'activar': {
            let channelId = settings.dailyQuestionChannelId;
            let usedCurrentChannel = false;
            if (!channelId || !guild.channels.cache.has(channelId)) {
              // Sin canal configurado: usamos el canal donde se escribió el comando
              const current = interaction.channel;
              if (!current || !TEXT_CHANNEL_TYPES.some(type => type === current.type)) {
                await interaction.editReply('❌ Primero elige un canal con `/pregunta-del-dia canal`.');
                break;
              }
              channelId = current.id;
              usedCurrentChannel = true;
            }

            const check = resolveSendableChannel(guild, channelId);
            if (!check.ok) {
              await interaction.editReply(`❌ No puedo publicar en <#${channelId}>. ${check.reason}`);
              break;
            }

            const updated = await storage.updateEngagementSettings(guild.id, {
              dailyQuestionEnabled: true,
              dailyQuestionChannelId: channelId,
            });
            dailyQuestions.syncGuild(updated);
            await interaction.editReply(
              `✅ ¡Pregunta del día activada en <#${channelId}>!` +
              (usedCurrentChannel ? ' (usé este canal porque no había uno configurado)' : '') +
              `\n${describeSchedule(updated ?? settings)}\n` +
              `Tengo ${PREGUNTAS_DEL_DIA.length} preguntas y no repetiré ninguna hasta usarlas todas.`
            );
            break;
          }

          case 'desactivar': {
            const updated = await storage.updateEngagementSettings(guild.id, { dailyQuestionEnabled: false });
            dailyQuestions.syncGuild(updated);
            await interaction.editReply('✅ Pregunta del día desactivada. Puedes volver a encenderla con `/pregunta-del-dia activar`.');
            break;
          }

          case 'ahora': {
            let target = resolveSendableChannel(guild, settings.dailyQuestionChannelId);
            if (!settings.dailyQuestionChannelId || !guild.channels.cache.has(settings.dailyQuestionChannelId)) {
              // Sin canal configurado: se publica en el canal actual
              const current = interaction.channel;
              if (!current || !TEXT_CHANNEL_TYPES.some(type => type === current.type)) {
                await interaction.editReply('❌ Primero elige un canal con `/pregunta-del-dia canal`.');
                break;
              }
              target = resolveSendableChannel(guild, current.id);
            }
            if (!target.ok) {
              await interaction.editReply(`❌ No puedo publicar la pregunta. ${target.reason}`);
              break;
            }

            const { message, number } = await dailyQuestions.postNow(guild, settings, target.channel);
            await interaction.editReply(
              `✅ Publiqué la pregunta #${number}: ${message.url}\n` +
              'Cuenta como la pregunta de hoy, así que la automática vuelve mañana.'
            );
            break;
          }

          case 'estado': {
            const timezone = resolveTimezone(settings.timezone);
            const check = resolveSendableChannel(guild, settings.dailyQuestionChannelId);
            const posted = settings.dailyQuestionIndex ?? 0;
            const remaining = remainingDailyQuestions(settings.dailyQuestionUsed);
            const lines = [
              '❓ **Pregunta del día**',
              describeSchedule(settings),
              `**Canal:** ${settings.dailyQuestionChannelId ? `<#${settings.dailyQuestionChannelId}>` : 'sin configurar'}` +
                (check.ok ? ' ✅' : ` ⚠️ ${check.reason}`),
              `**Hora:** ${formatHour(settings.dailyQuestionHour ?? DEFAULT_DAILY_QUESTION_HOUR)} · **Zona:** ${timezone}`,
              `**Hilo para respuestas:** ${(settings.dailyQuestionThread ?? true) ? 'sí' : 'no'}`,
              `**Preguntas publicadas:** ${posted} · ` + (remaining > 0
                ? `quedan ${remaining} de ${PREGUNTAS_DEL_DIA.length} antes de repetir`
                : `ya salieron las ${PREGUNTAS_DEL_DIA.length}; la siguiente empieza una vuelta nueva`),
            ];
            await interaction.editReply(lines.join('\n'));
            break;
          }
        }
      } catch (error) {
        console.error('[PREGUNTA-DEL-DIA] Error en el comando:', error);
        await interaction.editReply('❌ Algo salió mal. Intenta de nuevo en un momento.').catch(() => {});
      }
    }
  }
];
