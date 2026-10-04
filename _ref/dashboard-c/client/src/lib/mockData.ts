import type { BotStats, SecurityEvent } from "@shared/schema";

// Mock data for development mode
export const mockBotStats: BotStats = {
  id: "mock-stats-1",
  serverCount: 142,
  userCount: 8547,
  uptimeSeconds: 3456789, // ~40 days
  memoryUsageMB: 256,
  commandsExecuted: 125843,
  timestamp: new Date(),
};

export const mockSecurityEvents: SecurityEvent[] = [
  {
    id: "event-1",
    eventType: "login_success",
    severity: "info",
    description: "Successful dashboard login",
    ipAddress: "192.168.1.100",
    timestamp: new Date(Date.now() - 1000 * 60 * 5), // 5 minutes ago
  },
  {
    id: "event-2",
    eventType: "bot_restart",
    severity: "warning",
    description: "Bot service restarted automatically",
    ipAddress: null,
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 2), // 2 hours ago
  },
  {
    id: "event-3",
    eventType: "login_failed",
    severity: "error",
    description: "Failed login attempt from unknown IP",
    ipAddress: "45.123.45.67",
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 4), // 4 hours ago
  },
  {
    id: "event-4",
    eventType: "permission_change",
    severity: "warning",
    description: "Bot permissions updated in server 'Gaming Community'",
    ipAddress: null,
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 8), // 8 hours ago
  },
  {
    id: "event-5",
    eventType: "login_success",
    severity: "info",
    description: "Successful dashboard login",
    ipAddress: "192.168.1.100",
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 12), // 12 hours ago
  },
  {
    id: "event-6",
    eventType: "bot_restart",
    severity: "info",
    description: "Bot service started",
    ipAddress: null,
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 24), // 1 day ago
  },
];

// Helper to format uptime from seconds
export const formatUptime = (seconds: number): string => {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
};

// Helper to format large numbers
export const formatNumber = (num: number): string => {
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return num.toString();
};
