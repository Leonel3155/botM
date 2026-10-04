import { DiscordBot } from '../index';
import { REST, Routes } from 'discord.js';
import { levelCommands } from './level';
import { economyCommands } from './economy';
import { moderationCommands } from './moderation';
import { antiraidCommands } from './antiraid';
import { prestigeCommands } from './prestige';
import { gamblingCommands } from './gambling';
import { storeCommands } from './store';
import { bienvenidaCommands } from './bienvenida';
import { preguntaDelDiaCommands } from './preguntaDelDia';
import { anuncioCommands } from './anuncios';
import selftest from './selftest';
import stress from './stress';
import oauthTest from './oauth-test';

export async function setupCommands(bot: DiscordBot) {
  const commands = [
    ...levelCommands,
    ...economyCommands,
    ...moderationCommands,
    ...antiraidCommands,
    ...prestigeCommands,
    ...gamblingCommands,
    ...storeCommands,
    ...bienvenidaCommands,
    ...preguntaDelDiaCommands,
    ...anuncioCommands,
    selftest,
    stress,
    oauthTest,
  ];

  // Register commands with the bot
  commands.forEach(command => {
    bot.commands.set(command.data.name, command);
  });

  // Register slash commands with Discord
  const rest = new REST({ version: '10' }).setToken(
    process.env.DISCORD_TOKEN || ''
  );

  try {
    const clientId = process.env.DISCORD_CLIENT_ID;
    if (!clientId) {
      console.warn('DISCORD_CLIENT_ID not set, skipping command registration');
      return;
    }

    await rest.put(
      Routes.applicationCommands(clientId),
      { body: commands.map(cmd => cmd.data.toJSON()) }
    );

    console.log('✅ Discord slash commands registered successfully');
  } catch (error) {
    console.error('Failed to register Discord commands:', error);
  }
}
