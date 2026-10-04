import { Client, GatewayIntentBits, Collection, MessageFlags, Events } from 'discord.js';
import { setupCommands } from './commands';
import { setupEvents } from './events';
import { setupAntiRaid } from './middleware/antiRaid';
import { setupCustomCommands } from './customCommands';
import { installProcessErrorHandlers } from './utils/processErrors';

// Un error suelto (p. ej. Discord caído un momento) no debe tumbar el bot ni el panel
installProcessErrorHandlers();

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
    const token = process.env.DISCORD_TOKEN;
    if (!token) {
      throw new Error('Falta la variable de entorno DISCORD_TOKEN');
    }

    await this.client.login(token);
  }

  public async stop() {
    await this.client.destroy();
  }
}

// Export singleton instance
export const bot = new DiscordBot();
