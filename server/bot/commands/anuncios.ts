import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  DiscordAPIError,
  EmbedBuilder,
  GuildScheduledEventEntityType,
  GuildScheduledEventPrivacyLevel,
  GuildScheduledEventStatus,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  RESTJSONErrorCodes,
  type GuildScheduledEvent,
  type MessageMentionTypes,
} from 'discord.js';
import { DiscordBot } from '../index';
import { storage } from '../../storage';
import {
  checkSendableChannel,
  ensureMemberPermission,
  replyGuildOnly,
  truncate,
  withLineBreaks,
} from '../services/channels';
import { formatInTimezone, parseLocalDateTime, resolveTimezone } from '../services/timezone';

const TEXT_CHANNEL_TYPES = [ChannelType.GuildText, ChannelType.GuildAnnouncement] as const;
const VOICE_CHANNEL_TYPES = [ChannelType.GuildVoice, ChannelType.GuildStageVoice] as const;

const DEFAULT_COLOR = 0x5865F2;
const NAMED_COLORS: Record<string, number> = {
  rojo: 0xED4245,
  azul: 0x3498DB,
  celeste: 0x5DADE2,
  verde: 0x57F287,
  amarillo: 0xFEE75C,
  naranja: 0xE67E22,
  morado: 0x9B59B6,
  rosa: 0xEB459E,
  dorado: 0xF1C40F,
  gris: 0x95A5A6,
  blanco: 0xFFFFFF,
  negro: 0x23272A,
  discord: 0x5865F2,
};

const MENTION_CHOICES = [
  { name: '@everyone (todo el servidor)', value: 'everyone' },
  { name: '@here (solo quien está en línea)', value: 'here' },
];

// Acepta nombres en español ("rojo", "morado"...) o hexadecimal ("#FF8800")
function parseColor(input: string): number | null {
  const text = input.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (NAMED_COLORS[text] !== undefined) return NAMED_COLORS[text];

  let hex = text.replace(/^#|^0x/, '');
  if (/^[0-9a-f]{3}$/.test(hex)) hex = hex.split('').map(char => char + char).join('');
  return /^[0-9a-f]{6}$/.test(hex) ? parseInt(hex, 16) : null;
}

function parseImageUrl(input: string): string | null {
  try {
    const url = new URL(input.trim());
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

function describeEventPlace(event: GuildScheduledEvent): string {
  if (event.channelId) return `<#${event.channelId}>`;
  return event.entityMetadata?.location || 'Por definir';
}

export const anuncioCommands = [
  {
    data: new SlashCommandBuilder()
      .setName('anuncio')
      .setDescription('📢 Publica un anuncio bonito en un canal')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .setContexts(InteractionContextType.Guild)
      .addStringOption(option =>
        option.setName('titulo')
          .setDescription('Título del anuncio')
          .setMaxLength(200)
          .setRequired(true)
      )
      .addStringOption(option =>
        option.setName('mensaje')
          .setDescription('Texto del anuncio. Escribe \\n para un salto de línea')
          .setMaxLength(4000)
          .setRequired(true)
      )
      .addChannelOption(option =>
        option.setName('canal')
          .setDescription('Dónde publicarlo (por defecto, este canal)')
          .addChannelTypes(...TEXT_CHANNEL_TYPES)
          .setRequired(false)
      )
      .addStringOption(option =>
        option.setName('mencion')
          .setDescription('Avisar a todo el servidor')
          .addChoices(...MENTION_CHOICES)
          .setRequired(false)
      )
      .addRoleOption(option =>
        option.setName('rol')
          .setDescription('Rol al que quieres avisar')
          .setRequired(false)
      )
      .addStringOption(option =>
        option.setName('imagen')
          .setDescription('Enlace (URL) de una imagen para el anuncio')
          .setMaxLength(1000)
          .setRequired(false)
      )
      .addStringOption(option =>
        option.setName('color')
          .setDescription('Color: rojo, azul, verde, amarillo, morado, rosa, naranja, dorado... o #FF8800')
          .setMaxLength(20)
          .setRequired(false)
      ),

    async execute(interaction: ChatInputCommandInteraction, bot: DiscordBot) {
      if (!interaction.inCachedGuild()) {
        await replyGuildOnly(interaction);
        return;
      }
      if (!(await ensureMemberPermission(interaction, ['ManageGuild']))) return;

      const guild = interaction.guild;
      const title = interaction.options.getString('titulo', true);
      const text = interaction.options.getString('mensaje', true);
      const mention = interaction.options.getString('mencion');
      const role = interaction.options.getRole('rol');
      const imageInput = interaction.options.getString('imagen');
      const colorInput = interaction.options.getString('color');

      const color = colorInput ? parseColor(colorInput) : DEFAULT_COLOR;
      if (color === null) {
        await interaction.reply({
          content: `❌ No reconozco el color **${colorInput}**. Usa un nombre (rojo, azul, verde, amarillo, morado, rosa, naranja, dorado...) o un código como \`#FF8800\`.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const image = imageInput ? parseImageUrl(imageInput) : null;
      if (imageInput && !image) {
        await interaction.reply({
          content: '❌ La imagen debe ser un enlace que empiece con `https://`.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      // Menciones: @everyone/@here y roles no mencionables requieren el permiso correspondiente
      const pingEveryone = mention === 'everyone' || mention === 'here' || role?.id === guild.id;
      const pingRole = role && role.id !== guild.id ? role : null;
      const needsMentionEveryone = pingEveryone || (pingRole !== null && !pingRole.mentionable);
      if (needsMentionEveryone && !interaction.memberPermissions.has(PermissionFlagsBits.MentionEveryone)) {
        await interaction.reply({
          content: '⛔ Para mencionar a @everyone, @here o a un rol no mencionable necesitas el permiso **Mencionar @everyone, @here y todos los roles**.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      try {
        const channelOption = interaction.options.getChannel('canal', false, [...TEXT_CHANNEL_TYPES]);
        const channel = channelOption ? guild.channels.cache.get(channelOption.id) : interaction.channel;
        const target = checkSendableChannel(channel);
        if (!target.ok) {
          await interaction.editReply(`❌ No puedo publicar el anuncio ahí. ${target.reason}`);
          return;
        }

        const embed = new EmbedBuilder()
          .setColor(color)
          .setAuthor({ name: guild.name, iconURL: guild.iconURL() ?? undefined })
          .setTitle(truncate(`📢 ${title}`, 256))
          .setDescription(truncate(withLineBreaks(text), 4096))
          .setFooter({
            text: `Anuncio de ${interaction.member.displayName}`,
            iconURL: interaction.member.displayAvatarURL(),
          })
          .setTimestamp();
        if (image) embed.setImage(image);

        const mentionText = [
          pingEveryone ? (mention === 'here' ? '@here' : '@everyone') : null,
          pingRole ? `${pingRole}` : null,
        ].filter(Boolean).join(' ');
        const parse: MessageMentionTypes[] = pingEveryone ? ['everyone'] : [];

        const message = await target.channel.send({
          content: mentionText || undefined,
          embeds: [embed],
          allowedMentions: { parse, roles: pingRole ? [pingRole.id] : [] },
        });

        const lines = [`✅ Anuncio publicado en ${target.channel}: ${message.url}`];
        const me = guild.members.me;
        if (needsMentionEveryone && me && !target.channel.permissionsFor(me)?.has(PermissionFlagsBits.MentionEveryone)) {
          lines.push('⚠️ No tengo el permiso **Mencionar @everyone, @here y todos los roles** en ese canal, así que la mención quizá no avisó a nadie.');
        }
        await interaction.editReply(lines.join('\n'));
      } catch (error) {
        console.error('[ANUNCIO] Error al publicar:', error);
        await interaction.editReply('❌ No pude publicar el anuncio. Revisa que la imagen sea un enlace válido e intenta de nuevo.').catch(() => {});
      }
    }
  },

  {
    data: new SlashCommandBuilder()
      .setName('evento')
      .setDescription('📅 Crea y consulta los eventos del servidor')
      .setContexts(InteractionContextType.Guild)
      .addSubcommand(subcommand =>
        subcommand
          .setName('crear')
          .setDescription('Crea un evento de Discord y lo anuncia (requiere Gestionar eventos)')
          .addStringOption(option =>
            option.setName('nombre')
              .setDescription('Nombre del evento')
              .setMaxLength(100)
              .setRequired(true)
          )
          .addStringOption(option =>
            option.setName('fecha')
              .setDescription('Fecha y hora del servidor: AAAA-MM-DD HH:mm (ej. 2026-10-31 20:00)')
              .setMaxLength(32)
              .setRequired(true)
          )
          .addStringOption(option =>
            option.setName('descripcion')
              .setDescription('De qué se trata. Escribe \\n para un salto de línea')
              .setMaxLength(1000)
              .setRequired(false)
          )
          .addIntegerOption(option =>
            option.setName('duracion')
              .setDescription('Duración en minutos (por defecto 60)')
              .setMinValue(5)
              .setMaxValue(10080)
              .setRequired(false)
          )
          .addStringOption(option =>
            option.setName('lugar')
              .setDescription('Dónde será si no es en un canal de voz (ej. Minecraft, Twitch, en persona...)')
              .setMaxLength(100)
              .setRequired(false)
          )
          .addChannelOption(option =>
            option.setName('canal_voz')
              .setDescription('Canal de voz o escenario donde será el evento')
              .addChannelTypes(...VOICE_CHANNEL_TYPES)
              .setRequired(false)
          )
          .addChannelOption(option =>
            option.setName('canal_anuncio')
              .setDescription('Dónde anunciar el evento (por defecto, este canal)')
              .addChannelTypes(...TEXT_CHANNEL_TYPES)
              .setRequired(false)
          )
          .addStringOption(option =>
            option.setName('mencion')
              .setDescription('Avisar a todo el servidor en el anuncio')
              .addChoices(...MENTION_CHOICES)
              .setRequired(false)
          )
          .addBooleanOption(option =>
            option.setName('anunciar')
              .setDescription('Publicar un anuncio del evento (por defecto sí)')
              .setRequired(false)
          )
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('lista')
          .setDescription('Muestra los próximos eventos del servidor')
      ),

    async execute(interaction: ChatInputCommandInteraction, bot: DiscordBot) {
      if (!interaction.inCachedGuild()) {
        await replyGuildOnly(interaction);
        return;
      }

      if (interaction.options.getSubcommand() === 'lista') {
        await listEvents(interaction);
        return;
      }

      await createEvent(interaction);
    }
  }
];

async function createEvent(interaction: ChatInputCommandInteraction<'cached'>) {
  const allowed = await ensureMemberPermission(
    interaction,
    ['ManageEvents', 'CreateEvents', 'ManageGuild'],
    '⛔ Necesitas el permiso **Gestionar eventos** (o **Gestionar servidor**) para crear eventos.'
  );
  if (!allowed) return;

  const guild = interaction.guild;
  const me = guild.members.me;
  if (!me?.permissions.any([PermissionFlagsBits.ManageEvents, PermissionFlagsBits.CreateEvents])) {
    await interaction.reply({
      content: '❌ Me falta el permiso **Gestionar eventos** (o **Crear eventos**) para poder crear eventos.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const mention = interaction.options.getString('mencion');
  if (mention && !interaction.memberPermissions.has(PermissionFlagsBits.MentionEveryone)) {
    await interaction.reply({
      content: '⛔ Para mencionar a @everyone o @here necesitas el permiso **Mencionar @everyone, @here y todos los roles**.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const name = interaction.options.getString('nombre', true).trim();
  const dateInput = interaction.options.getString('fecha', true);
  const descriptionInput = interaction.options.getString('descripcion');
  const description = descriptionInput ? withLineBreaks(descriptionInput).trim() : undefined;
  const duration = interaction.options.getInteger('duracion') ?? 60;
  const place = interaction.options.getString('lugar')?.trim() || 'Discord';
  const voiceOption = interaction.options.getChannel('canal_voz', false, [...VOICE_CHANNEL_TYPES]);
  const announceOption = interaction.options.getChannel('canal_anuncio', false, [...TEXT_CHANNEL_TYPES]);
  const announce = interaction.options.getBoolean('anunciar') ?? true;

  if (!name) {
    await interaction.editReply('❌ El evento necesita un nombre.');
    return;
  }

  try {
    await storage.ensureGuild(guild.id, guild.name, guild.ownerId);
    const settings = await storage.getGuild(guild.id);
    const timezone = resolveTimezone(settings?.timezone);

    const parsed = parseLocalDateTime(dateInput, timezone);
    if (!parsed.ok) {
      await interaction.editReply(`❌ ${parsed.error}`);
      return;
    }
    const start = parsed.date;
    if (start.getTime() < Date.now() + 60_000) {
      await interaction.editReply(
        `❌ Esa fecha ya pasó (o es en menos de un minuto). En **${timezone}** ahora es ${formatInTimezone(new Date(), timezone)}.\n` +
        'Si la zona horaria no es la correcta, cámbiala con `/pregunta-del-dia zona`.'
      );
      return;
    }
    const end = new Date(start.getTime() + duration * 60_000);

    const common = {
      name,
      description,
      scheduledStartTime: start,
      scheduledEndTime: end,
      privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
      reason: `Creado por ${interaction.user.tag} con /evento crear`,
    };

    const event = voiceOption
      ? await guild.scheduledEvents.create({
          ...common,
          entityType: voiceOption.type === ChannelType.GuildStageVoice
            ? GuildScheduledEventEntityType.StageInstance
            : GuildScheduledEventEntityType.Voice,
          channel: voiceOption.id,
        })
      : await guild.scheduledEvents.create({
          ...common,
          entityType: GuildScheduledEventEntityType.External,
          entityMetadata: { location: place },
        });

    const lines = [
      `✅ Evento **${event.name}** creado para el ${formatInTimezone(start, timezone)} (${timezone}).`,
      `🔗 ${event.url}`,
    ];

    if (announce) {
      const channel = announceOption ? guild.channels.cache.get(announceOption.id) : interaction.channel;
      const target = checkSendableChannel(channel);
      if (!target.ok) {
        lines.push(`⚠️ No pude publicar el anuncio: ${target.reason}`);
      } else {
        const timestamp = Math.floor(start.getTime() / 1000);
        const embed = new EmbedBuilder()
          .setColor(DEFAULT_COLOR)
          .setAuthor({ name: '📅 ¡Nuevo evento!', iconURL: guild.iconURL() ?? undefined })
          .setTitle(truncate(event.name, 256))
          .setURL(event.url)
          .setDescription(description ? truncate(description, 4096) : null)
          .addFields(
            { name: '🕒 Cuándo', value: `<t:${timestamp}:F>\n<t:${timestamp}:R>`, inline: true },
            { name: '📍 Dónde', value: voiceOption ? `<#${voiceOption.id}>` : truncate(place, 1024), inline: true },
            { name: '⏱️ Duración', value: formatDuration(duration), inline: true },
          )
          .setFooter({
            text: `Organiza: ${interaction.member.displayName} · Marca "Me interesa" para recibir aviso`,
            iconURL: interaction.member.displayAvatarURL(),
          });

        const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setStyle(ButtonStyle.Link)
            .setURL(event.url)
            .setEmoji('🔔')
            .setLabel('Ver evento y marcar «Me interesa»')
        );

        try {
          const message = await target.channel.send({
            content: mention === 'here' ? '@here' : mention === 'everyone' ? '@everyone' : undefined,
            embeds: [embed],
            components: [buttons],
            allowedMentions: { parse: mention ? ['everyone'] : [] },
          });
          lines.push(`📢 Anuncio publicado en ${target.channel}: ${message.url}`);
        } catch (error) {
          console.error('[EVENTO] Error al anunciar el evento:', error);
          lines.push('⚠️ El evento se creó, pero no pude publicar el anuncio.');
        }
      }
    }

    await interaction.editReply(lines.join('\n'));
  } catch (error) {
    console.error('[EVENTO] Error al crear el evento:', error);
    let message = '❌ No pude crear el evento. Intenta de nuevo en un momento.';
    if (error instanceof DiscordAPIError) {
      if (error.code === RESTJSONErrorCodes.MissingPermissions) {
        message = '❌ Discord no me dejó crear el evento: me falta **Gestionar eventos** (y para canales de voz también **Ver canal** y **Conectar**).';
      } else if (error.code === RESTJSONErrorCodes.InvalidFormBodyOrContentType) {
        message = `❌ Discord rechazó los datos del evento. Revisa el nombre, la fecha y la duración.\nDetalle: ${truncate(error.message, 300)}`;
      }
    }
    await interaction.editReply(message).catch(() => {});
  }
}

async function listEvents(interaction: ChatInputCommandInteraction<'cached'>) {
  await interaction.deferReply();

  try {
    const events = await interaction.guild.scheduledEvents.fetch({ withUserCount: true });
    const upcoming = Array.from(events.values())
      .filter(event =>
        event.status === GuildScheduledEventStatus.Scheduled || event.status === GuildScheduledEventStatus.Active
      )
      .sort((a, b) => (a.scheduledStartTimestamp ?? 0) - (b.scheduledStartTimestamp ?? 0))
      .slice(0, 10);

    if (upcoming.length === 0) {
      await interaction.editReply('📭 No hay eventos próximos. Quien tenga permiso de **Gestionar eventos** puede crear uno con `/evento crear`.');
      return;
    }

    const lines = upcoming.map(event => {
      const timestamp = Math.floor((event.scheduledStartTimestamp ?? Date.now()) / 1000);
      const live = event.status === GuildScheduledEventStatus.Active ? ' 🔴 **¡En curso!**' : '';
      const interested = event.userCount !== null ? ` · 👥 ${event.userCount} interesad@s` : '';
      const name = event.name.replace(/[[\]]/g, '');
      return `**[${name}](${event.url})**${live}\n🕒 <t:${timestamp}:F> (<t:${timestamp}:R>) · 📍 ${describeEventPlace(event)}${interested}`;
    });

    const embed = new EmbedBuilder()
      .setColor(DEFAULT_COLOR)
      .setTitle('📅 Próximos eventos')
      .setDescription(truncate(lines.join('\n\n'), 4096))
      .setFooter({ text: 'Las horas se muestran en tu zona horaria' });

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error('[EVENTO] Error al listar eventos:', error);
    await interaction.editReply('❌ No pude obtener la lista de eventos. Intenta de nuevo en un momento.').catch(() => {});
  }
}
