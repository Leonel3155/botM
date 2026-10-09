import { DiscordBot } from '../index';
import {
  ChatInputCommandInteraction,
  DiscordAPIError,
  HTTPError,
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
import { ECONOMY_DISABLED_MESSAGE, isEconomyEnabledQuick } from '../services/guildSettings';

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

// Si la economía está apagada desde el panel, estos comandos solo avisan.
// La comprobación corre antes del deferReply de cada comando, así que tiene un tiempo máximo
// (isEconomyEnabledQuick) para no agotar los 3 segundos que da Discord para responder.
function requireEconomy(commands: BotCommand[]): BotCommand[] {
  return commands.map(command => ({
    ...command,
    async execute(interaction: ChatInputCommandInteraction, bot: DiscordBot) {
      if (interaction.guildId && !(await isEconomyEnabledQuick(interaction.guildId))) {
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
    // Diagnósticos solo para desarrollo: /stress satura las colas y /oauth-test muestra URLs internas.
    // Solo con servidores de prueba, para que no salgan en el servidor de verdad si BotM vive en npm run dev.
    ...(isDevelopment && devGuildIds().length > 0 ? [stress, oauthTest] : []),
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
  const token = process.env.DISCORD_TOKEN?.trim();
  const clientId = process.env.DISCORD_CLIENT_ID?.trim();
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
      // Fuera de los servidores de prueba ningún comando por servidor es de este bot
      await removeStaleGuildCommands(rest, clientId, { keep: guildIds, alsoCheck: [] });
      return;
    }

    if (isDevelopment) {
      console.log('💡 Para ver los cambios de comandos al instante en desarrollo, define DISCORD_DEV_GUILD_ID con el ID de tu servidor de pruebas.');
    }
    const registered = await putCommands(rest, Routes.applicationCommands(clientId), bodies, 'globalmente');

    // Con los globales registrados, cualquier comando guardado por servidor sobra: saldría repetido o sin
    // respuesta. Se quitan solo si los globales ya están, para no dejar a nadie sin comandos.
    if (registered) {
      await removeStaleGuildCommands(rest, clientId, { keep: [], alsoCheck: isDevelopment ? [] : guildIds });
    } else {
      console.warn('⚠️ No reviso los comandos viejos de los servidores porque los globales no se registraron.');
    }
  } catch (error) {
    console.error('❌ Error inesperado al registrar los comandos de barra:', error);
  }
}

// Una línea con el código y el mensaje de Discord, en vez del error completo (cuerpo de la petición,
// ArrayBuffer...), que solo llena la consola
function describeRestError(error: unknown): string {
  if (error instanceof DiscordAPIError || error instanceof HTTPError) {
    return `error ${error.status} de Discord ("${error.message}")`;
  }
  return error instanceof Error ? error.message : String(error);
}

// PUT masivo. Si Discord rechaza algunos comandos (400), se reintenta sin ellos.
// Devuelve true si quedó registrada la lista (completa o sin los rechazados).
async function putCommands(
  rest: REST,
  route: `/${string}`,
  bodies: RESTPostAPIChatInputApplicationCommandsJSONBody[],
  where: string
): Promise<boolean> {
  try {
    await rest.put(route, { body: bodies });
    console.log(`✅ ${bodies.length} comandos de barra registrados ${where}`);
    return true;
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
        return true;
      } catch (retryError) {
        console.error(`❌ No se pudieron registrar los comandos ${where}: ${describeRestError(retryError)}`);
      }
      return false;
    }
    console.error(`❌ No se pudieron registrar los comandos ${where}: ${describeRestError(error)}`);
    return false;
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

type GuildSummary = { id: string; name?: string };

// Servidores donde está el bot, por la API (no hace falta esperar a que el bot se conecte)
async function listBotGuilds(rest: REST): Promise<GuildSummary[]> {
  const guilds: GuildSummary[] = [];
  let after: string | undefined;
  for (let page = 0; page < 50; page++) {
    const query = new URLSearchParams({ limit: '200' });
    if (after) query.set('after', after);
    const batch = await rest.get(Routes.userGuilds(), { query }) as GuildSummary[];
    guilds.push(...batch);
    if (batch.length < 200) break;
    after = batch[batch.length - 1].id;
  }
  return guilds;
}

// Comandos guardados por servidor que el bot ya no usa: los que dejó el bot anterior si la aplicación es
// reciclada, o copias de prueba de DISCORD_DEV_GUILD_ID. Salen repetidos junto a los nuevos o no hacen
// nada, así que se vacía la lista de cada servidor (menos los de `keep`). `alsoCheck` añade servidores
// que quizá ya no salen en la lista del bot.
async function removeStaleGuildCommands(
  rest: REST,
  clientId: string,
  { keep, alsoCheck }: { keep: string[]; alsoCheck: string[] }
) {
  let guilds: GuildSummary[];
  try {
    guilds = await listBotGuilds(rest);
  } catch (error) {
    console.error(`⚠️ No se pudo revisar si quedan comandos viejos en los servidores: ${describeRestError(error)}`);
    return;
  }
  const known = new Set(guilds.map(guild => guild.id));
  for (const id of alsoCheck) {
    if (!known.has(id)) guilds.push({ id });
  }

  const kept = new Set(keep);
  for (const guild of guilds) {
    if (kept.has(guild.id)) continue;
    const label = guild.name ? `"${guild.name}"` : guild.id;
    try {
      const route = Routes.applicationGuildCommands(clientId, guild.id);
      const existing = await rest.get(route) as { id: string; name: string }[];
      if (existing.length > 0) {
        await rest.put(route, { body: [] });
        console.log(`🧹 Quitados ${existing.length} comandos viejos del servidor ${label}: ${existing.map(c => `/${c.name}`).join(', ')}`);
      }
    } catch (error) {
      // 50001 (Missing Access): el bot entró ahí sin el scope applications.commands; no hay comandos que limpiar
      if (error instanceof DiscordAPIError && error.code === 50001) continue;
      console.error(`⚠️ No se pudieron revisar los comandos viejos del servidor ${label}: ${describeRestError(error)}`);
    }
  }
}
