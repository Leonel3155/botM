import { Client, GatewayIntentBits, Collection, MessageFlags, Events, DiscordAPIError, HTTPError } from 'discord.js';
import { setupCommands } from './commands';
import { setupEvents } from './events';
import { setupAntiRaid } from './middleware/antiRaid';
import { setupCustomCommands } from './customCommands';
import { installProcessErrorHandlers, isTransientError } from './utils/processErrors';

// Un error suelto (p. ej. Discord caído un momento) no debe tumbar el bot ni el panel
installProcessErrorHandlers();

class MissingDiscordTokenError extends Error {
  constructor() {
    super('Falta la variable de entorno DISCORD_TOKEN');
    this.name = 'MissingDiscordTokenError';
  }
}

export class DiscordBot {
  public client: Client;
  public commands: Collection<string, any>;
  public prefixHandler: any;

  constructor() {
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
      ]
    });

    // Sin estos oyentes, un error de conexión de discord.js se convierte en una excepción no capturada
    this.client.on(Events.Error, (error) => console.error('⚠️ Error del cliente de Discord:', error));
    this.client.on(Events.ShardError, (error, shardId) => console.error(`⚠️ Error de conexión (shard ${shardId}):`, error));
    this.client.on(Events.Warn, (warning) => console.warn('⚠️ Aviso de discord.js:', warning));

    this.commands = new Collection();
    this.init().catch((error) => {
      console.error('❌ Error al preparar el bot (comandos/eventos):', error);
    });
  }

  private async init() {
    await setupCommands(this);
    setupEvents(this);
    setupAntiRaid(this);
    setupCustomCommands(this);

    // Import and setup prefix command handler
    const { PrefixCommandHandler } = await import('./commands/prefix');
    this.prefixHandler = new PrefixCommandHandler(this);

    this.client.once(Events.ClientReady, () => {
      console.log(`🤖 Bot de Discord listo como ${this.client.user?.tag}`);
      console.log('📋 Comandos con prefijo activos junto a los comandos de barra');
    });

    // Handle prefix-based messages
    this.client.on('messageCreate', async (message) => {
      if (!this.prefixHandler) return;
      try {
        await this.prefixHandler.handleMessage(message);
      } catch (error) {
        console.error('Error en comando con prefijo:', error);
      }
    });

    // Command interaction handler
    this.client.on('interactionCreate', async (interaction) => {
      if (!interaction.isChatInputCommand()) return;

      const command = this.commands.get(interaction.commandName);
      if (!command) return;

      // Todos los comandos trabajan con datos del servidor: en mensajes directos no tienen sentido
      if (!interaction.inGuild()) {
        await interaction.reply({ content: 'Este comando solo funciona dentro de un servidor. 🙂', flags: MessageFlags.Ephemeral })
          .catch((error) => console.error('No se pudo responder en mensaje directo:', error));
        return;
      }

      try {
        await command.execute(interaction, this);
      } catch (error) {
        console.error(`Error al ejecutar /${interaction.commandName}:`, error);
        const reply = {
          content: '😵 Uy, algo salió mal con este comando. Intenta de nuevo en un momento.',
          flags: MessageFlags.Ephemeral,
        } as const;

        try {
          if (interaction.replied || interaction.deferred) {
            await interaction.followUp(reply);
          } else {
            await interaction.reply(reply);
          }
        } catch (replyError) {
          console.error('No se pudo enviar el aviso de error:', replyError);
        }
      }
    });
  }

  public async start() {
    const token = process.env.DISCORD_TOKEN?.trim();
    if (!token) {
      throw new MissingDiscordTokenError();
    }

    await this.client.login(token);
  }

  public async stop() {
    await this.client.destroy();
  }
}

/**
 * Explica en español por qué no se pudo conectar el bot, con el texto original del error entre
 * comillas para poder buscarlo. `details` es true cuando conviene mostrar también el error completo
 * (los casos conocidos se explican solos y la traza solo confunde).
 */
export function explainBotStartError(error: unknown): { reason: string; details: boolean } {
  const err = (error && typeof error === 'object' ? error : {}) as { code?: unknown; message?: unknown; status?: unknown };
  const message = typeof err.message === 'string' ? err.message : String(error);

  if (error instanceof MissingDiscordTokenError) {
    return {
      reason: 'Falta DISCORD_TOKEN en el archivo .env. Cópialo de Discord Developer Portal → tu aplicación → Bot → Reset Token.',
      details: false,
    };
  }
  if (err.code === 'TokenInvalid') {
    return {
      reason: `DISCORD_TOKEN no es válido ("${message}"). Genera otro en Developer Portal → Bot → Reset Token y pégalo en el .env.`,
      details: false,
    };
  }
  if (err.code === 'DisallowedIntents' || /disallowed intents/i.test(message)) {
    return {
      reason: `Faltan los Privileged Gateway Intents ("${message}"). En Developer Portal → Bot activa Server Members Intent y Message Content Intent y pulsa Save Changes.`,
      details: false,
    };
  }
  if (error instanceof DiscordAPIError || error instanceof HTTPError) {
    return {
      reason: `Discord rechazó la conexión (error ${error.status}: "${message}"). Si sigue pasando, revisa tu conexión a internet, un firewall o proxy, o el estado de Discord.`,
      details: false,
    };
  }
  if (isTransientError(error)) {
    return {
      reason: `No se pudo llegar a Discord ("${message}"). Revisa tu conexión a internet; también puede ser un firewall, un antivirus o que Discord esté caído.`,
      details: false,
    };
  }
  return { reason: `Error inesperado ("${message}").`, details: true };
}

// Export singleton instance
export const bot = new DiscordBot();
