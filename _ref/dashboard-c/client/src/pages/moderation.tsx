import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Shield, AlertTriangle, Ban, UserX, MessageSquare } from "lucide-react";
import { useState } from "react";
import type { SerializedModerationLog } from "@shared/schema";

const actionIcons: Record<string, typeof Shield> = {
  ban: Ban,
  kick: UserX,
  mute: MessageSquare,
  warn: AlertTriangle,
};

const actionColors: Record<string, string> = {
  ban: "bg-destructive/20 text-destructive",
  kick: "bg-orange-500/20 text-orange-600 dark:text-orange-400",
  mute: "bg-blue-500/20 text-blue-600 dark:text-blue-400",
  warn: "bg-yellow-500/20 text-yellow-600 dark:text-yellow-400",
};

export default function Moderation() {
  const [searchQuery, setSearchQuery] = useState("");
  const [actionFilter, setActionFilter] = useState<string>("all");

  const { data: logs, isLoading, isError } = useQuery<SerializedModerationLog[]>({
    queryKey: ["/api/moderation"],
  });

  const filteredLogs = logs?.filter(log => {
    const matchesSearch = 
      log.targetUsername.toLowerCase().includes(searchQuery.toLowerCase()) ||
      log.moderatorName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      log.reason?.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesAction = actionFilter === "all" || log.action === actionFilter;
    
    return matchesSearch && matchesAction;
  }) || [];

  const totalActions = logs?.length || 0;
  const actionCounts = logs?.reduce((acc, log) => {
    acc[log.action] = (acc[log.action] || 0) + 1;
    return acc;
  }, {} as Record<string, number>) || {};

  const uniqueModerators = new Set(logs?.map(log => log.moderatorId)).size || 0;

  if (isLoading) {
    return (
      <div className="p-8 space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-foreground mb-2" data-testid="text-page-title">Moderation Logs</h1>
          <p className="text-muted-foreground" data-testid="text-loading-message">Loading moderation history...</p>
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
            <CardTitle className="text-destructive" data-testid="text-error-title">Error Loading Moderation Logs</CardTitle>
            <CardDescription data-testid="text-error-description">Failed to load moderation data</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground mb-2" data-testid="text-page-title">Moderation Logs</h1>
        <p className="text-muted-foreground">Track and review all moderation actions</p>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card className="hover-elevate">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Actions</CardTitle>
            <Shield className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground" data-testid="text-total-actions">{totalActions.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground mt-1">All moderation actions</p>
          </CardContent>
        </Card>

        <Card className="hover-elevate">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Bans</CardTitle>
            <Ban className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground" data-testid="text-ban-count">{(actionCounts.ban || 0).toLocaleString()}</div>
            <p className="text-xs text-muted-foreground mt-1">Permanent bans issued</p>
          </CardContent>
        </Card>

        <Card className="hover-elevate">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Warnings</CardTitle>
            <AlertTriangle className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground" data-testid="text-warn-count">{(actionCounts.warn || 0).toLocaleString()}</div>
            <p className="text-xs text-muted-foreground mt-1">Warnings given</p>
          </CardContent>
        </Card>

        <Card className="hover-elevate">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Moderators</CardTitle>
            <Shield className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground" data-testid="text-moderator-count">{uniqueModerators}</div>
            <p className="text-xs text-muted-foreground mt-1">Active moderators</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card className="hover-elevate">
        <CardHeader>
          <CardTitle>Filter Logs</CardTitle>
          <CardDescription>Search and filter moderation actions</CardDescription>
        </CardHeader>
        <CardContent className="flex gap-4 flex-wrap">
          <Input
            type="text"
            placeholder="Search by user, moderator, or reason..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="max-w-md"
            data-testid="input-search-logs"
          />
          <Select value={actionFilter} onValueChange={setActionFilter}>
            <SelectTrigger className="w-48" data-testid="select-action-filter">
              <SelectValue placeholder="Filter by action" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" data-testid="select-action-all">All Actions</SelectItem>
              <SelectItem value="ban" data-testid="select-action-ban">Bans</SelectItem>
              <SelectItem value="kick" data-testid="select-action-kick">Kicks</SelectItem>
              <SelectItem value="mute" data-testid="select-action-mute">Mutes</SelectItem>
              <SelectItem value="warn" data-testid="select-action-warn">Warnings</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {/* Moderation Logs Table */}
      <Card className="hover-elevate">
        <CardHeader>
          <CardTitle>Moderation History</CardTitle>
          <CardDescription>Recent moderation actions taken across all servers</CardDescription>
        </CardHeader>
        <CardContent>
          {filteredLogs.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2 px-4 text-sm font-medium text-muted-foreground">Action</th>
                    <th className="text-left py-2 px-4 text-sm font-medium text-muted-foreground">Target User</th>
                    <th className="text-left py-2 px-4 text-sm font-medium text-muted-foreground">Moderator</th>
                    <th className="text-left py-2 px-4 text-sm font-medium text-muted-foreground">Reason</th>
                    <th className="text-left py-2 px-4 text-sm font-medium text-muted-foreground">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredLogs.map((log) => {
                    const ActionIcon = actionIcons[log.action] || Shield;
                    return (
                      <tr key={log.id} className="border-b border-border hover-elevate" data-testid={`row-log-${log.id}`}>
                        <td className="py-2 px-4">
                          <Badge className={actionColors[log.action] || "bg-muted"} variant="outline">
                            <ActionIcon className="h-3 w-3 mr-1" />
                            {log.action}
                          </Badge>
                        </td>
                        <td className="py-2 px-4 text-sm">
                          <div className="font-medium text-foreground">{log.targetUsername}</div>
                          <div className="text-xs text-muted-foreground font-mono">{log.targetUserId}</div>
                        </td>
                        <td className="py-2 px-4 text-sm">
                          <div className="font-medium text-foreground">{log.moderatorName}</div>
                          <div className="text-xs text-muted-foreground font-mono">{log.moderatorId}</div>
                        </td>
                        <td className="py-2 px-4 text-sm text-muted-foreground max-w-xs truncate">
                          {log.reason || "No reason provided"}
                        </td>
                        <td className="py-2 px-4 text-sm text-muted-foreground whitespace-nowrap">
                          {new Date(log.timestamp).toLocaleString()}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center text-muted-foreground py-8" data-testid="text-empty-logs">
              {searchQuery || actionFilter !== "all" 
                ? "No moderation logs match your filters" 
                : "No moderation actions yet"}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
