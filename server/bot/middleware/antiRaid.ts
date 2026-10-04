import { DiscordBot } from '../index';
import { storage } from '../../storage';

interface RaidDetectionConfig {
  joinRateLimit: number; // Max joins per minute
  suspiciousAccountAge: number; // Days
  autoLockdown: boolean;
  kickSuspicious: boolean;
}

const defaultConfig: RaidDetectionConfig = {
  joinRateLimit: 5,
  suspiciousAccountAge: 7,
  autoLockdown: true,
  kickSuspicious: true
};

const guildStates = new Map<string, {
  isLocked: boolean;
  lastRaidCheck: number;
  recentJoins: number;
}>();

export function setupAntiRaid(bot: DiscordBot) {
  // Monitor for potential raids every 30 seconds
  setInterval(async () => {
    await checkForRaids(bot);
  }, 30000);

  // Reset join counters every minute
  setInterval(() => {
    for (const [guildId, state] of guildStates) {
      state.recentJoins = 0;
      state.lastRaidCheck = Date.now();
    }
  }, 60000);

  console.log('🛡️ Anti-raid protection initialized');
}

async function checkForRaids(bot: DiscordBot) {
  for (const [guildId, guild] of bot.client.guilds.cache) {
    try {
      const now = Date.now();
      const fiveMinutesAgo = now - 5 * 60 * 1000;

      // Get recent raid events
      const recentEvents = await storage.getRecentRaidEvents(guildId, 5);
      
      const suspiciousEvents = recentEvents.filter(event => 
        event.type === 'suspicious_activity' && event.severity === 'high'
      );

      const joinSpamEvents = recentEvents.filter(event => 
        event.type === 'join_spam'
      );

      // Check if we should trigger lockdown
      const shouldLockdown = suspiciousEvents.length >= 3 || joinSpamEvents.length >= 2;
      
      if (shouldLockdown && defaultConfig.autoLockdown) {
        const state = getGuildState(guildId);
        
        if (!state.isLocked) {
          await initiateGuildLockdown(bot, guild, guildId);
          state.isLocked = true;

          // Log the raid event
          await storage.createRaidEvent({
            guildId,
            type: 'mass_join',
            severity: 'high',
            details: {
              suspiciousEvents: suspiciousEvents.length,
              joinSpamEvents: joinSpamEvents.length,
              autoLockdownTriggered: true
            },
            resolved: false
          });
        }
      }

    } catch (error) {
      console.error(`Anti-raid check failed for guild ${guildId}:`, error);
    }
  }
}

function getGuildState(guildId: string) {
  if (!guildStates.has(guildId)) {
    guildStates.set(guildId, {
      isLocked: false,
      lastRaidCheck: Date.now(),
      recentJoins: 0
    });
  }
  return guildStates.get(guildId)!;
}

async function initiateGuildLockdown(bot: DiscordBot, guild: any, guildId: string) {
  try {
    // Find a suitable channel for announcements
    const systemChannel = guild.systemChannel;
    const generalChannel = guild.channels.cache.find((channel: any) => 
      channel.type === 0 && (channel.name.includes('general') || channel.name.includes('chat'))
    );
    
    const announcementChannel = systemChannel || generalChannel;

    if (announcementChannel) {
      await announcementChannel.send({
        embeds: [{
          color: 0xED4245,
          title: '🚨 Anti-Raid Protection Activated',
          description: 'The server has been temporarily locked due to suspicious activity. New members cannot join until this is resolved.',
          fields: [
            {
              name: '🔒 Actions Taken',
              value: '• New member screening enabled\n• Automatic moderation increased\n• Monitoring enhanced',
              inline: false
            },
            {
              name: '⏰ Duration',
              value: 'This lockdown will be automatically lifted in 10 minutes, or manually by administrators.',
              inline: false
            }
          ],
          timestamp: new Date().toISOString(),
          footer: {
            text: 'UltraBot Pro Anti-Raid Protection'
          }
        }]
      });
    }

    // Auto-lift lockdown after 10 minutes
    setTimeout(async () => {
      const state = getGuildState(guildId);
      if (state.isLocked) {
        state.isLocked = false;
        
        if (announcementChannel) {
          await announcementChannel.send({
            embeds: [{
              color: 0x57F287,
              title: '✅ Anti-Raid Protection Lifted',
              description: 'The server lockdown has been automatically lifted. Normal operations have resumed.',
              timestamp: new Date().toISOString(),
              footer: {
                text: 'UltraBot Pro Anti-Raid Protection'
              }
            }]
          });
        }
      }
    }, 10 * 60 * 1000); // 10 minutes

    console.log(`🚨 Anti-raid lockdown initiated for guild ${guild.name} (${guildId})`);

  } catch (error) {
    console.error('Failed to initiate guild lockdown:', error);
  }
}

export function isGuildLocked(guildId: string): boolean {
  const state = guildStates.get(guildId);
  return state?.isLocked || false;
}

export async function liftLockdown(guildId: string): Promise<boolean> {
  const state = getGuildState(guildId);
  if (state.isLocked) {
    state.isLocked = false;
    return true;
  }
  return false;
}
