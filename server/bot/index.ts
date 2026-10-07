import { Client, GatewayIntentBits, Collection, MessageFlags, Events, DiscordjsErrorCodes } from 'discord.js';
import { setupCommands } from './commands';
import { setupEvents } from './events';
import { setupAntiRaid } from './middleware/antiRaid';
import { setupCustomCommands } from './customCommands';
import { migrateLegacyMutes } from './commands/moderation';
import { refundPendingBets } from './services/economy';
import { installProcessErrorHandlers } from './utils/processErrors';

// Un error suelto (p. ej. Discord caído un momento) no debe tumbar el bot ni el panel
installProcessErrorHandlers();

const LOGIN_RETRY_MIN_MS = 5_000;
const LOGIN_RETRY_MAX_MS = 5 * 60_000;

// Errores al conectar que no se arreglan reintentando: hay que corregir algo y reiniciar
function fatalLoginProblem(error: unknown): string | null {
  if (!process.env.DISCORD_TOKEN) return 'falta DISCORD_TOKEN en el archivo .env.';
  const code = (error as { code?: unknown } | null)?.code;
  if (code === DiscordjsErrorCodes.TokenInvalid || code === DiscordjsErrorCodes.TokenMissing) {
    return 'Discord rechazó el DISCORD_TOKEN (revisa el token del bot en el Discord Developer Portal).';
  }
  const message = error instanceof Error ? error.message : String(error);
  if (/disallowed intents|invalid intents/i.test(message)) {
    return 'Discord rechazó los intents: activa "Server Members Intent" y "Message Content Intent" en el Developer Portal (Bot → Privileged Gateway Intents).';
  }
  return null;
}

// "Not enough sessions remaining ... resets at <fecha>": hay que esperar a esa hora
function sessionLimitWaitMs(error: unknown): number | null {
  const message = error instanceof Error ? error.message : '';
  const match = /Not enough sessions remaining.*resets at (\S+)/.exec(message);
  if (!match) return null;
  const resetAt = Date.parse(match[1]);
  return Number.isFinite(resetAt) ? Math.max(resetAt - Date.now(), 0) + 5_000 : null;
}

export class DiscordBot {
  public client: Client;
  public commands: Collection<string, any>;
  public prefixHandler: any;
  private stopping = false;

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

    const onReady = () => {
      console.log(`🤖 Bot de Discord listo como ${this.client.user?.tag}`);
      console.log('📋 Comandos con prefijo activos junto a los comandos de barra');
      // Lo que quedó a medias si el bot se apagó: apuestas de blackjack y mutes con el rol viejo
      void refundPendingBets();
      void migrateLegacyMutes(this.client);
    };
    if (this.client.isReady()) onReady();
    else this.client.once(Events.ClientReady, onReady);

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
      if (!command) {
        // Un comando viejo que Discord aún muestra (p. ej. uno de desarrollo): mejor avisar que no responder
        await interaction.reply({ content: 'Este comando ya no existe; recarga Discord (Ctrl+R) para actualizar la lista.', flags: MessageFlags.Ephemeral })
          .catch((error) => console.error(`No se pudo responder al comando desconocido /${interaction.commandName}:`, error));
        return;
      }

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

  /**
   * Conecta con Discord y, si falla (sin red, Discord caído, límite de sesiones), lo reintenta solo
   * con una espera creciente (de 5 s a 5 min). Se rinde únicamente ante errores que no se arreglan
   * esperando (token inválido, intents sin activar). Nunca lanza.
   */
  public async startWithRetry(): Promise<void> {
    let delayMs = LOGIN_RETRY_MIN_MS;
    while (!this.stopping) {
      try {
        this.clearFailedLoginState();
        await this.start();
        console.log('🚀 Bot de Discord conectado');
        return;
      } catch (error) {
        const fatal = fatalLoginProblem(error);
        if (fatal) {
          console.error(`❌ No se pudo iniciar el bot de Discord: ${fatal} No lo vuelvo a intentar hasta que reinicies.`, error);
          return;
        }
        if (this.stopping) return;
        const waitMs = Math.max(delayMs, sessionLimitWaitMs(error) ?? 0);
        console.error(`❌ No se pudo conectar el bot de Discord; lo vuelvo a intentar en ${Math.round(waitMs / 1000)} s.`, error);
        await new Promise((resolve) => setTimeout(resolve, waitMs));
        delayMs = Math.min(delayMs * 2, LOGIN_RETRY_MAX_MS);
      }
    }
  }

  /**
   * Si client.login() falla, discord.js llama a client.destroy(), y en discord.js 14 eso deja la
   * conexión marcada como destruida para siempre (client.ws.destroyed nunca vuelve a false). Aunque
   * el reintento conecte, client.isReady() seguiría en false: el panel diría "bot desconectado",
   * los cambios darían 503 y la pregunta del día no saldría. Por eso se desmarca antes de reintentar.
   */
  private clearFailedLoginState() {
    const ws = this.client.ws as unknown as { destroyed?: boolean };
    if (ws.destroyed === true) ws.destroyed = false;
  }

  public async stop() {
    this.stopping = true;
    await this.client.destroy();
  }
}

// Export singleton instance
export const bot = new DiscordBot();
