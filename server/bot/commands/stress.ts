import { SlashCommandBuilder, ChatInputCommandInteraction, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { DiscordBot } from '../index';
import { globalQueue, queueForGuild, getQueueStats } from '../services/queues';
import { lockForUser, getLockStats } from '../services/locks';

// Solo se registra con NODE_ENV=development (ver commands/index.ts): ocupa las colas del bot a propósito
export const data = new SlashCommandBuilder()
  .setName('stress')
  .setDescription('🧪 [Desarrollo] Prueba de estrés de las colas y candados del bot')
  .addIntegerOption(option =>
    option.setName('tareas').setDescription('Número de tareas a ejecutar (máx. 50)').setRequired(false).setMinValue(1).setMaxValue(50)
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export async function execute(interaction: ChatInputCommandInteraction, bot: DiscordBot) {
  if (process.env.NODE_ENV !== 'development' || !interaction.memberPermissions?.has('Administrator')) {
    await interaction.reply({ content: '⛔ Este diagnóstico solo está disponible para administradores en modo desarrollo.', flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const numTasks = Math.min(interaction.options.getInteger('tareas') || 20, 50);
  const guildId = interaction.guildId!;
  const userId = interaction.user.id;
  
  const startTime = Date.now();
  const results: string[] = [];
  
  // Crear múltiples tareas simultáneas.
  // throwOnTimeout: true hace que un timeout rechace la promesa (y caiga en el catch)
  // en lugar de resolver con undefined, así cada tarea devuelve siempre un string.
  const promises = Array.from({ length: numTasks }, async (_, i) => {
    return globalQueue.add(async () => {
      return queueForGuild(guildId).add(async () => {
        return lockForUser(userId).runExclusive(async () => {
          // Simular trabajo pesado
          const delay = Math.random() * 1000 + 500; // 500-1500ms
          await new Promise(resolve => setTimeout(resolve, delay));
          
          // Simular operación de economía
          const amount = Math.floor(Math.random() * 100) + 1;
          return `Tarea ${i + 1}: +${amount} (${Math.round(delay)} ms)`;
        });
      }, { throwOnTimeout: true });
    }, { timeout: 120_000, throwOnTimeout: true });
  });
  
  try {
    // Ejecutar todas las tareas
    const taskResults = await Promise.all(promises);
    results.push(...taskResults);
    
    const endTime = Date.now();
    const duration = endTime - startTime;
    
    // Obtener estadísticas
    const queueStats = getQueueStats();
    const lockStats = getLockStats();
    
    const response = [
      `🧪 **Prueba de estrés completada**`,
      ``,
      `📊 **Resultados:**`,
      `• Tareas ejecutadas: ${numTasks}`,
      `• Tiempo total: ${duration}ms`,
      `• Promedio por tarea: ${Math.round(duration / numTasks)}ms`,
      `• Tareas/segundo: ${Math.round((numTasks * 1000) / duration)}`,
      ``,
      `⚡ **Estadísticas de Colas:**`,
      `• Cola global: ${queueStats.global.pending} pendientes, ${queueStats.global.size} en cola`,
      `• Colas por guild: ${queueStats.guilds}`,
      `• Colas de economía: ${queueStats.economy}`,
      ``,
      `🔒 **Estadísticas de candados:**`,
      `• Por usuario activos: ${lockStats.activeUserLocks}/${lockStats.userLocks}`,
      `• Por servidor activos: ${lockStats.activeGuildLocks}/${lockStats.guildLocks}`,
      ``,
      `✅ **Estado:** ${duration < 10000 ? 'EXCELENTE' : duration < 20000 ? 'BUENO' : 'NECESITA OPTIMIZACIÓN'}`
    ].join('\n');
    
    await interaction.editReply(response);
    
    // Log detallado para debugging
    console.log('🧪 Prueba de estrés completada:', {
      tasks: numTasks,
      duration: duration,
      avgPerTask: Math.round(duration / numTasks),
      tasksPerSecond: Math.round((numTasks * 1000) / duration),
      queueStats,
      lockStats
    });
    
  } catch (error) {
    console.error('La prueba de estrés falló:', error);
    await interaction.editReply('❌ La prueba de estrés falló; revisa la consola del servidor.');
  }
}

export default { data, execute };