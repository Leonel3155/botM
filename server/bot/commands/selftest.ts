import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChatInputCommandInteraction,
  MessageFlags,
  REST,
  Routes
} from 'discord.js';
import { db } from '../../db';
import { sql } from 'drizzle-orm';

export const data = new SlashCommandBuilder()
  .setName('selftest')
  .setDescription('🔧 Diagnóstico del bot (base de datos, comandos y permisos)')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export async function execute(interaction: ChatInputCommandInteraction) {
  if (!interaction.memberPermissions?.has('Administrator')) {
    await interaction.reply({ content: '⛔ Solo los administradores pueden usar este comando.', flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  // Test de base de datos
  let dbOk = false;
  let dbError = '';
  try {
    await db.execute(sql`select 1`);
    dbOk = true;
  } catch (error: any) {
    dbError = error?.message || 'error desconocido';
  }

  // Permisos mínimos necesarios
  const me = interaction.guild?.members.me;
  const needed: (keyof typeof PermissionFlagsBits)[] = [
    'ViewChannel', 'SendMessages', 'EmbedLinks', 'ManageMessages'
  ];
  const missing = me
    ? needed.filter(p => !me.permissions.has(PermissionFlagsBits[p]))
    : needed;

  // Comandos registrados: globales (producción) y de este servidor (desarrollo con DISCORD_DEV_GUILD_ID)
  let globalCount = 0;
  let guildCount = 0;
  let commandsError = false;
  try {
    const clientId = process.env.DISCORD_CLIENT_ID;
    const token = process.env.DISCORD_TOKEN;
    if (!clientId || !token) throw new Error('Falta DISCORD_CLIENT_ID o DISCORD_TOKEN');
    const rest = new REST({ version: '10' }).setToken(token);
    const globalCmds = await rest.get(Routes.applicationCommands(clientId)) as unknown[];
    globalCount = globalCmds.length;
    if (interaction.guildId) {
      const guildCmds = await rest.get(Routes.applicationGuildCommands(clientId, interaction.guildId)) as unknown[];
      guildCount = guildCmds.length;
    }
  } catch (error) {
    commandsError = true;
    console.error('Error al contar los comandos:', error);
  }
  const commandCount = globalCount + guildCount;
  const commandsText = commandsError
    ? '❌ No se pudieron consultar'
    : commandCount > 0
      ? `✅ ${globalCount} globales${guildCount ? ` + ${guildCount} de este servidor` : ''}`
      : '❌ No se encontraron comandos';

  const result = [
    '🔧 **DIAGNÓSTICO DEL BOT**\n',
    `**Base de datos**: ${dbOk ? '✅ Conectada' : '❌ Error: ' + dbError}`,
    `**Comandos registrados**: ${commandsText}`,
    `**Permisos**: ${missing.length ? '❌ Faltan: ' + missing.join(', ') : '✅ Todos los permisos necesarios'}`,
    `**Servidor**: ${interaction.guild ? '✅ ' + interaction.guild.name : '❌ No encontrado'}`,
    `**Usuario**: ${interaction.user ? '✅ ' + interaction.user.tag : '❌ No encontrado'}`,
    '\n**ESTADO GENERAL**: ' + (dbOk && missing.length === 0 && commandCount > 0 ? '🟢 TODO FUNCIONANDO' : '🟡 REQUIERE ATENCIÓN')
  ].join('\n');

  await interaction.editReply(result);
}

export default { data, execute };
