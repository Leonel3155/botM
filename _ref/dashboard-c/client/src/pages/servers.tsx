import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Server, Users, Shield, Calendar, TrendingUp, Activity } from "lucide-react";
import { useState } from "react";
import type { SerializedServer } from "@shared/schema";

export default function Servers() {
  const [searchQuery, setSearchQuery] = useState("");

  const { data: servers, isLoading, isError } = useQuery<SerializedServer[]>({
    queryKey: ["/api/servers"],
  });

  const filteredServers = servers?.filter(server =>
    server.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    server.id.toLowerCase().includes(searchQuery.toLowerCase())
  ) || [];

  const totalServers = servers?.length || 0;
  const totalMembers = servers?.reduce((sum, s) => sum + (s.memberCount || 0), 0) || 0;
  const averageMembers = totalServers > 0 ? Math.round(totalMembers / totalServers) : 0;
  const totalActiveUsers = servers?.reduce((sum, s) => sum + (s.activeUsers || 0), 0) || 0;
  const averageEngagement = totalMembers > 0 ? Math.round((totalActiveUsers / totalMembers) * 100) : 0;

  // Helper function to get engagement level
  const getEngagementLevel = (engagement: number) => {
    if (engagement >= 40) return { label: "Excellent", variant: "default" as const };
    if (engagement >= 20) return { label: "Good", variant: "secondary" as const };
    if (engagement >= 10) return { label: "Moderate", variant: "outline" as const };
    return { label: "Low", variant: "outline" as const };
  };

  if (isLoading) {
    return (
      <div className="p-8 space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-foreground mb-2" data-testid="text-page-title">Server Management</h1>
          <p className="text-muted-foreground" data-testid="text-loading-message">Loading servers...</p>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {[...Array(3)].map((_, i) => (
            <Card key={i} className="hover-elevate" data-testid={`card-skeleton-${i}`}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <div className="h-4 w-24 bg-muted animate-pulse rounded" data-testid="skeleton-title" />
              </CardHeader>
              <CardContent>
                <div className="h-8 w-16 bg-muted animate-pulse rounded" data-testid="skeleton-value" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="p-8">
        <Card className="border-destructive" data-testid="card-error">
          <CardHeader>
            <CardTitle className="text-destructive" data-testid="text-error-title">Error Loading Servers</CardTitle>
            <CardDescription data-testid="text-error-description">Failed to load server data</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground mb-2" data-testid="text-page-title">Server Management</h1>
        <p className="text-muted-foreground">Manage and monitor all servers where the bot is active</p>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card className="hover-elevate">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Servers</CardTitle>
            <Server className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground" data-testid="text-total-servers">{totalServers.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground mt-1">Active bot instances</p>
          </CardContent>
        </Card>

        <Card className="hover-elevate">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Members</CardTitle>
            <Users className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground" data-testid="text-total-members">{totalMembers.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground mt-1">Across all servers</p>
          </CardContent>
        </Card>

        <Card className="hover-elevate">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Active Users</CardTitle>
            <Activity className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground" data-testid="text-active-users">{totalActiveUsers.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground mt-1">Using the bot (30 days)</p>
          </CardContent>
        </Card>

        <Card className="hover-elevate">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Avg Engagement</CardTitle>
            <TrendingUp className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground" data-testid="text-average-engagement">{averageEngagement}%</div>
            <p className="text-xs text-muted-foreground mt-1">User participation rate</p>
          </CardContent>
        </Card>
      </div>

      {/* Search Bar */}
      <Card className="hover-elevate">
        <CardHeader>
          <CardTitle>Server List</CardTitle>
          <CardDescription>Search and view all servers</CardDescription>
        </CardHeader>
        <CardContent>
          <Input
            type="text"
            placeholder="Search by server name or ID..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="max-w-md"
            data-testid="input-search-servers"
          />
        </CardContent>
      </Card>

      {/* Server List */}
      {filteredServers.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredServers.map((server) => {
            const engagement = server.memberCount > 0 
              ? Math.round((server.activeUsers / server.memberCount) * 100) 
              : 0;
            const engagementLevel = getEngagementLevel(engagement);

            return (
              <Card key={server.id} className="hover-elevate" data-testid={`card-server-${server.id}`}>
                <CardHeader>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <CardTitle className="truncate" data-testid={`text-server-name-${server.id}`}>
                        {server.name}
                      </CardTitle>
                      <CardDescription className="font-mono text-xs mt-1">
                        ID: {server.id}
                      </CardDescription>
                    </div>
                    <Badge variant={engagementLevel.variant} className="shrink-0" data-testid={`badge-engagement-${server.id}`}>
                      {engagementLevel.label}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Engagement Progress */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Bot Usage</span>
                      <span className="text-foreground font-semibold" data-testid={`text-engagement-${server.id}`}>
                        {engagement}%
                      </span>
                    </div>
                    <Progress value={engagement} className="h-2" data-testid={`progress-engagement-${server.id}`} />
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>{server.activeUsers} active</span>
                      <span>{server.memberCount} total</span>
                    </div>
                  </div>

                  {/* Commands Used */}
                  <div className="flex items-center gap-2 text-sm">
                    <Activity className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground">Commands:</span>
                    <span className="text-foreground font-semibold" data-testid={`text-commands-${server.id}`}>
                      {server.commandsUsed?.toLocaleString() || 0}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 text-sm">
                    <Shield className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground">Prefix:</span>
                    <span className="text-foreground font-mono">{server.prefix || "!"}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <Calendar className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground">Joined:</span>
                    <span className="text-foreground">{new Date(server.botJoinedAt).toLocaleDateString()}</span>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card className="hover-elevate">
          <CardContent className="py-12">
            <div className="text-center">
              <Server className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-foreground mb-2">
                {searchQuery ? "No servers found" : "No servers yet"}
              </h3>
              <p className="text-muted-foreground">
                {searchQuery 
                  ? "Try adjusting your search query" 
                  : "Server data will appear here once the bot joins servers"}
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
