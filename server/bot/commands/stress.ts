import { SlashCommandBuilder, ChatInputCommandInteraction, PermissionFlagsBits } from 'discord.js';
import { DiscordBot } from '../index';
import { globalQueue, queueForGuild, getQueueStats } from '../services/queues';
import { lockForUser, getLockStats } from '../services/locks';

export const data = new SlashCommandBuilder()
  .setName('stress')
  .setDescription('🧪 Test de estrés para verificar el manejo de concurrencia')
  .addIntegerOption(option =>
    option.setName('tasks').setDescription('Número de tareas a ejecutar (máx 50)').setRequired(false)
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export async function execute(interaction: ChatInputCommandInteraction, bot: DiscordBot) {
  await interaction.deferReply({ flags: 64 }); // 64 = ephemeral flag
  
  const numTasks = Math.min(interaction.options.getInteger('tasks') || 20, 50);
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
          return `Task ${i + 1}: +${amount} coins (${Math.round(delay)}ms)`;
        });
      }, { throwOnTimeout: true });
    }, { timeout: 120_000, throwOnTimeout: true }); // override puntual según ChatGPT
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
      `🧪 **Test de Estrés Completado**`,
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
      `🔒 **Estadísticas de Locks:**`,
      `• User locks activos: ${lockStats.activeUserLocks}/${lockStats.userLocks}`,
      `• Guild locks activos: ${lockStats.activeGuildLocks}/${lockStats.guildLocks}`,
      ``,
      `✅ **Estado:** ${duration < 10000 ? 'EXCELENTE' : duration < 20000 ? 'BUENO' : 'NECESITA OPTIMIZACIÓN'}`
    ].join('\n');
    
    await interaction.editReply(response);
    
    // Log detallado para debugging
    console.log('🧪 Stress test completed:', {
      tasks: numTasks,
      duration: duration,
      avgPerTask: Math.round(duration / numTasks),
      tasksPerSecond: Math.round((numTasks * 1000) / duration),
      queueStats,
      lockStats
    });
    
  } catch (error) {
    console.error('Stress test failed:', error);
    await interaction.editReply(`❌ Test de estrés falló: ${error}`);
  }
}

export default { data, execute };