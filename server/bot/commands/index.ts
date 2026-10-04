import { DiscordBot } from '../index';
import {
  ChatInputCommandInteraction,
  DiscordAPIError,
  InteractionContextType,
  MessageFlags,
  REST,
  RESTPostAPIChatInputApplicationCommandsJSONBody,
  Routes,
} from 'discord.js';
import { levelCommands } from './level';
import { economyCommands } from './economy';
import { moderationCommands } from './moderation';
import { antiraidCommands } from './antiraid';
import { prestigeCommands } from './prestige';
import { gamblingCommands } from './gambling';
import { bienvenidaCommands } from './bienvenida';
import { preguntaDelDiaCommands } from './preguntaDelDia';
import { anuncioCommands } from './anuncios';
import selftest from './selftest';
import stress from './stress';
import oauthTest from './oauth-test';
import { ECONOMY_DISABLED_MESSAGE, isEconomyEnabled } from '../services/guildSettings';

export interface BotCommand {
  data: { name: string; toJSON(): RESTPostAPIChatInputApplicationCommandsJSONBody };
  execute(interaction: ChatInputCommandInteraction, bot: DiscordBot): Promise<unknown>;
}

const isDevelopment = process.env.NODE_ENV === 'development';

// Servidores donde registrar los comandos al instante mientras desarrollas (IDs separados por comas).
// Los comandos globales pueden tardar en aparecer; los de servidor salen al momento.
function devGuildIds(): string[] {
  return (process.env.DISCORD_DEV_GUILD_ID || '')
    .split(',')
    .map(id => id.trim())
    .filter(id => /^\d{17,20}$/.test(id));
}

// Si la economía está apagada desde el panel, estos comandos solo avisan
function requireEconomy(commands: BotCommand[]): BotCommand[] {
  return commands.map(command => ({
    ...command,
    async execute(interaction: ChatInputCommandInteraction, bot: DiscordBot) {
      if (interaction.guildId && !(await isEconomyEnabled(interaction.guildId))) {
        await interaction.reply({ content: ECONOMY_DISABLED_MESSAGE, flags: MessageFlags.Ephemeral });
        return;
      }
      return command.execute(interaction, bot);
    },
  }));
}

export async function setupCommands(bot: DiscordBot) {
  const commands: BotCommand[] = [
    ...levelCommands,
    ...requireEconomy(economyCommands),
    ...moderationCommands,
    ...antiraidCommands,
    ...prestigeCommands,
    ...requireEconomy(gamblingCommands),
    ...bienvenidaCommands,
    ...preguntaDelDiaCommands,
    ...anuncioCommands,
    selftest,
    // Diagnósticos solo para desarrollo: /stress satura las colas y /oauth-test muestra URLs internas
    ...(isDevelopment ? [stress, oauthTest] : []),
  ];

  // Registrar los comandos en el bot (un comando roto no impide cargar los demás)
  for (const command of commands) {
    try {
      const name = command.data.name;
      if (bot.commands.has(name)) {
        console.warn(`⚠️ Comando /${name} duplicado: se usa la última definición`);
      }
      bot.commands.set(name, command);
    } catch (error) {
      console.error('❌ No se pudo cargar un comando:', error);
    }
  }

  // El registro en Discord va en segundo plano: si la API tarda o limita, el bot igual arranca
  void registerSlashCommands(commands).catch((error) => {
    console.error('❌ Error inesperado al registrar los comandos de barra:', error);
  });
}

// Envía los comandos a Discord. Nunca lanza: si algo falla lo registra en consola y el bot sigue.
async function registerSlashCommands(commands: BotCommand[]) {
  const token = process.env.DISCORD_TOKEN;
  const clientId = process.env.DISCORD_CLIENT_ID;
  if (!token || !clientId) {
    console.warn('⚠️ Falta DISCORD_TOKEN o DISCORD_CLIENT_ID: no se registran los comandos de barra');
    return;
  }

  // Se serializa cada comando por separado para que uno inválido no tumbe el resto
  const bodies: RESTPostAPIChatInputApplicationCommandsJSONBody[] = [];
  for (const command of commands) {
    try {
      // Solo dentro de servidores: en mensajes directos no hay economía, niveles ni moderación
      bodies.push({ ...command.data.toJSON(), contexts: [InteractionContextType.Guild] });
    } catch (error) {
      console.error(`❌ El comando /${command.data?.name ?? '?'} tiene una definición inválida y no se registró:`, error);
    }
  }

  const rest = new REST({ version: '10' }).setToken(token);
  const guildIds = devGuildIds();

  try {
    if (isDevelopment && guildIds.length > 0) {
      for (const guildId of guildIds) {
        await putCommands(rest, Routes.applicationGuildCommands(clientId, guildId), bodies, `en el servidor ${guildId}`);
      }
      return;
    }

    if (isDevelopment) {
      console.log('💡 Para ver los cambios de comandos al instante en desarrollo, define DISCORD_DEV_GUILD_ID con el ID de tu servidor de pruebas.');
    }
    await putCommands(rest, Routes.applicationCommands(clientId), bodies, 'globalmente');

    // Copias viejas registradas por servidor durante el desarrollo saldrían repetidas: se quitan
    // (solo las que se llaman igual que un comando del bot)
    if (!isDevelopment && guildIds.length > 0) {
      await removeGuildCopies(rest, clientId, guildIds, new Set(bodies.map(b => b.name)));
    }
  } catch (error) {
    console.error('❌ Error inesperado al registrar los comandos de barra:', error);
  }
}

// PUT masivo. Si Discord rechaza algunos comandos (400), se reintenta sin ellos.
async function putCommands(
  rest: REST,
  route: `/${string}`,
  bodies: RESTPostAPIChatInputApplicationCommandsJSONBody[],
  where: string
) {
  try {
    await rest.put(route, { body: bodies });
    console.log(`✅ ${bodies.length} comandos de barra registrados ${where}`);
    return;
  } catch (error) {
    const rejected = rejectedIndexes(error);
    if (rejected.size > 0 && rejected.size < bodies.length) {
      console.error(
        `❌ Discord rechazó ${rejected.size} comando(s): ${[...rejected].map(i => `/${bodies[i]?.name}`).join(', ')}.`,
        error instanceof Error ? error.message : error
      );
      const valid = bodies.filter((_, index) => !rejected.has(index));
      try {
        await rest.put(route, { body: valid });
        console.log(`✅ ${valid.length} comandos de barra registrados ${where} (sin los rechazados)`);
      } catch (retryError) {
        console.error(`❌ No se pudieron registrar los comandos ${where}:`, retryError);
      }
      return;
    }
    console.error(`❌ No se pudieron registrar los comandos ${where}:`, error);
  }
}

// En un error 400 de registro masivo, Discord indica qué posiciones del arreglo fallaron
function rejectedIndexes(error: unknown): Set<number> {
  const indexes = new Set<number>();
  if (!(error instanceof DiscordAPIError) || error.status !== 400) return indexes;
  const details = (error.rawError as { errors?: Record<string, unknown> }).errors;
  if (!details || typeof details !== 'object') return indexes;
  for (const key of Object.keys(details)) {
    if (/^\d+$/.test(key)) indexes.add(Number(key));
  }
  return indexes;
}

async function removeGuildCopies(rest: REST, clientId: string, guildIds: string[], names: Set<string>) {
  for (const guildId of guildIds) {
    try {
      const existing = await rest.get(Routes.applicationGuildCommands(clientId, guildId)) as { id: string; name: string }[];
      const copies = existing.filter(cmd => names.has(cmd.name));
      for (const cmd of copies) {
        await rest.delete(Routes.applicationGuildCommand(clientId, guildId, cmd.id));
      }
      if (copies.length > 0) {
        console.log(`🧹 Quitadas ${copies.length} copias de desarrollo de los comandos en el servidor ${guildId}`);
      }
    } catch (error) {
      console.error(`⚠️ No se pudieron revisar los comandos de desarrollo del servidor ${guildId}:`, error);
    }
  }
}
