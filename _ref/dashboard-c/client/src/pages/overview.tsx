import { useQuery } from "@tanstack/react-query";
import { Server, Users, Clock, Cpu, Activity, AlertCircle } from "lucide-react";
import { StatCard } from "@/components/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusIndicator } from "@/components/status-indicator";
import { SecurityEventItem } from "@/components/security-event-item";
import { Skeleton } from "@/components/ui/skeleton";
import type { BotStats, SecurityEvent } from "@shared/schema";
import { formatUptime, formatNumber, mockBotStats, mockSecurityEvents } from "@/lib/mockData";
import { isServerMode } from "@/lib/environment";

export default function Overview() {
  const { data: statsData, isLoading: statsLoading, isError: statsError, refetch: refetchStats } = useQuery<BotStats>({
    queryKey: ["/api/stats"],
    queryFn: async () => {
      const response = await fetch("/api/stats");
      if (!response.ok) {
        throw new Error(`Failed to fetch statistics: ${response.status}`);
      }
      const data = await response.json();
      if (!data || typeof data !== 'object') {
        throw new Error("Invalid statistics data received");
      }
      // Validate all required fields with type checking
      if (!data.id || typeof data.id !== 'string' ||
          typeof data.serverCount !== 'number' ||
          typeof data.userCount !== 'number' ||
          typeof data.uptimeSeconds !== 'number' ||
          typeof data.memoryUsageMB !== 'number' ||
          typeof data.commandsExecuted !== 'number' ||
          !data.timestamp || typeof data.timestamp !== 'string') {
        throw new Error("Missing or invalid required fields in statistics data");
      }
      // Parse and validate timestamp
      const timestamp = new Date(data.timestamp);
      if (isNaN(timestamp.getTime())) {
        throw new Error("Invalid timestamp in statistics data");
      }
      return {
        ...data,
        timestamp,
      };
    },
  });

  const { data: eventsData, isLoading: eventsLoading, isError: eventsError, refetch: refetchEvents } = useQuery<SecurityEvent[]>({
    queryKey: ["/api/security/events/recent"],
    queryFn: async () => {
      const response = await fetch("/api/security/events/recent");
      if (!response.ok) {
        throw new Error(`Failed to fetch recent events: ${response.status}`);
      }
      const data = await response.json();
      if (!Array.isArray(data)) {
        throw new Error("Invalid events data received");
      }
      // Validate and parse each event
      return data.map(event => {
        if (!event.id || typeof event.id !== 'string' ||
            !event.eventType || typeof event.eventType !== 'string' ||
            !event.severity || typeof event.severity !== 'string' ||
            !event.description || typeof event.description !== 'string' ||
            !event.timestamp || typeof event.timestamp !== 'string') {
          throw new Error("Missing required fields in security event");
        }
        const timestamp = new Date(event.timestamp);
        if (isNaN(timestamp.getTime())) {
          throw new Error("Invalid timestamp in security event");
        }
        return {
          ...event,
          timestamp,
        };
      });
    },
  });

  // Use the data directly
  const stats = statsData;
  const recentEvents = eventsData;

  if (statsLoading || eventsLoading) {
    return (
      <div className="p-8">
        <div className="max-w-7xl mx-auto space-y-8">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {[1, 2, 3, 4].map((i) => (
              <Card key={i}>
                <CardHeader>
                  <Skeleton className="h-4 w-24" />
                </CardHeader>
                <CardContent>
                  <Skeleton className="h-10 w-20" />
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (statsError || eventsError) {
    return (
      <div className="p-8">
        <div className="max-w-7xl mx-auto">
          <Card className="border-destructive">
            <CardContent className="flex flex-col items-center justify-center py-12">
              <AlertCircle className="h-12 w-12 text-destructive mb-4" />
              <h3 className="text-lg font-semibold text-foreground mb-2">Failed to Load Dashboard</h3>
              <p className="text-sm text-muted-foreground mb-6 text-center max-w-md">
                Unable to connect to the bot server. Please check your connection and try again.
              </p>
              <Button onClick={() => {
                refetchStats();
                refetchEvents();
              }} data-testid="button-retry">
                Retry
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8">
      <div className="max-w-7xl mx-auto space-y-8">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold text-foreground mb-2" data-testid="heading-overview">
            Overview
          </h1>
          <p className="text-muted-foreground">
            Monitor your Discord bot's performance and status
          </p>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <StatCard
            title="Servers"
            value={formatNumber(stats?.serverCount || 0)}
            icon={Server}
            subtitle="Active servers"
            testId="stat-servers"
          />
          <StatCard
            title="Users"
            value={formatNumber(stats?.userCount || 0)}
            icon={Users}
            subtitle="Total reach"
            testId="stat-users"
          />
          <StatCard
            title="Uptime"
            value={formatUptime(stats?.uptimeSeconds || 0)}
            icon={Clock}
            subtitle="Current session"
            testId="stat-uptime"
          />
          <StatCard
            title="Memory"
            value={`${stats?.memoryUsageMB || 0}MB`}
            icon={Cpu}
            subtitle="RAM usage"
            testId="stat-memory"
          />
        </div>

        {/* Bot Status & Recent Events */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Bot Status */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Activity className="h-5 w-5 text-primary" />
                Bot Status
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Connection</span>
                <StatusIndicator status="online" label="Connected" testId="status-connection" />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">API Latency</span>
                <span className="text-sm font-mono text-foreground" data-testid="text-latency">
                  42ms
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Commands Executed</span>
                <span className="text-sm font-mono text-foreground" data-testid="text-commands">
                  {formatNumber(stats?.commandsExecuted || 0)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Gateway Status</span>
                <StatusIndicator status="online" label="Ready" testId="status-gateway" />
              </div>
            </CardContent>
          </Card>

          {/* Recent Security Events */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span className="flex items-center gap-2">
                  Recent Activity
                </span>
                <span className="text-xs text-muted-foreground font-normal">
                  Last 24 hours
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-0 max-h-64 overflow-y-auto">
                {recentEvents?.map((event) => (
                  <SecurityEventItem key={event.id} event={event} />
                ))}
                {(!recentEvents || recentEvents.length === 0) && (
                  <p className="text-sm text-muted-foreground text-center py-8">
                    No recent events
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
