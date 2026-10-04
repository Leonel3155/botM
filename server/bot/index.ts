import { Client, GatewayIntentBits, Collection, MessageFlags, Events } from 'discord.js';
import { setupCommands } from './commands';
import { setupEvents } from './events';
import { setupAntiRaid } from './middleware/antiRaid';
import { setupCustomCommands } from './customCommands';

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

    this.commands = new Collection();
    this.init();
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
      console.log(`🤖 Discord bot ready as ${this.client.user?.tag}`);
      console.log(`📋 Prefix commands enabled alongside slash commands`);
    });

    // Handle prefix-based messages
    this.client.on('messageCreate', async (message) => {
      if (!this.prefixHandler) return;
      try {
        await this.prefixHandler.handleMessage(message);
      } catch (error) {
        console.error('Prefix command error:', error);
      }
    });

    // Command interaction handler
    this.client.on('interactionCreate', async (interaction) => {
      if (!interaction.isChatInputCommand()) return;

      const command = this.commands.get(interaction.commandName);
      if (!command) return;

      try {
        await command.execute(interaction, this);
      } catch (error) {
        console.error('Command execution error:', error);
        const reply = { content: 'There was an error executing this command!', flags: MessageFlags.Ephemeral } as const;

        try {
          if (interaction.replied || interaction.deferred) {
            await interaction.followUp(reply);
          } else {
            await interaction.reply(reply);
          }
        } catch (replyError) {
          console.error('Could not send error reply:', replyError);
        }
      }
    });
  }

  public async start() {
    const token = process.env.DISCORD_TOKEN;
    if (!token) {
      throw new Error('DISCORD_TOKEN environment variable is required');
    }

    await this.client.login(token);
  }

  public async stop() {
    this.client.destroy();
  }
}

// Export singleton instance
export const bot = new DiscordBot();
