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
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  // Test de base de datos
  let dbOk = false;
  let dbError = '';
  try {
    await db.execute(sql`select 1`);
    dbOk = true;
  } catch (error: any) {
    dbError = error.message || 'Unknown error';
  }

  // Permisos mínimos necesarios
  const me = interaction.guild?.members.me;
  const needed: (keyof typeof PermissionFlagsBits)[] = [
    'ViewChannel', 'SendMessages', 'EmbedLinks', 'ManageMessages'
  ];
  const missing = me
    ? needed.filter(p => !me.permissions.has(PermissionFlagsBits[p]))
    : needed;

  // Los comandos se registran de forma global (ver commands/index.ts)
  let commandCount = 0;
  try {
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN!);
    const cmds = await rest.get(Routes.applicationCommands(process.env.DISCORD_CLIENT_ID!)) as any[];
    commandCount = cmds.length;
  } catch (error) {
    console.error('Error counting commands:', error);
  }

  const result = [
    '🔧 **DIAGNÓSTICO DEL BOT**\n',
    `**Base de Datos**: ${dbOk ? '✅ Conectada' : '❌ Error: ' + dbError}`,
    `**Comandos Registrados**: ${commandCount > 0 ? '✅ ' + commandCount + ' comandos' : '❌ No se encontraron comandos'}`,
    `**Permisos**: ${missing.length ? '❌ Faltan: ' + missing.join(', ') : '✅ Todos los permisos necesarios'}`,
    `**Guild**: ${interaction.guild ? '✅ ' + interaction.guild.name : '❌ No encontrado'}`,
    `**Usuario**: ${interaction.user ? '✅ ' + interaction.user.tag : '❌ No encontrado'}`,
    '\n**ESTADO GENERAL**: ' + (dbOk && missing.length === 0 ? '🟢 TODO FUNCIONANDO' : '🟡 REQUIERE ATENCIÓN')
  ].join('\n');

  await interaction.editReply(result);
}

export default { data, execute };
