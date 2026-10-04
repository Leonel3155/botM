import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from "recharts";
import { Activity, TrendingUp, Terminal, CheckCircle2 } from "lucide-react";
import type { SerializedCommand } from "@shared/schema";

export default function Analytics() {
  const commandsQueryKey = "/api/commands?" + new URLSearchParams({ limit: "500" }).toString();
  
  const { data: commands, isLoading: commandsLoading, isError: commandsError } = useQuery<SerializedCommand[]>({
    queryKey: [commandsQueryKey],
  });

  const { data: commandStats, isLoading: statsLoading, isError: statsError } = useQuery<{ commandName: string; count: number }[]>({
    queryKey: ["/api/commands/stats"],
  });

  // Calculate metrics
  const totalCommands = commands?.length || 0;
  const successfulCommands = commands?.filter(c => c.success).length || 0;
  const successRate = totalCommands > 0 ? ((successfulCommands / totalCommands) * 100).toFixed(1) : "0.0";
  const uniqueCommands = commandStats?.length || 0;

  // Top 10 commands for bar chart
  const topCommands = commandStats?.slice(0, 10) || [];

  // Success/Failure pie chart data
  const failedCommands = totalCommands - successfulCommands;
  const statusData = [
    { name: "Successful", value: successfulCommands, color: "#FFC107" },
    { name: "Failed", value: failedCommands, color: "#FF5252" },
  ];

  const isLoading = commandsLoading || statsLoading;
  const isError = commandsError || statsError;

  if (isLoading) {
    return (
      <div className="p-8 space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-foreground mb-2" data-testid="text-page-title">Command Analytics</h1>
          <p className="text-muted-foreground" data-testid="text-loading-message">Loading command statistics...</p>
        </div>
        <div className="grid gap-4 md:grid-cols-4">
          {[...Array(4)].map((_, i) => (
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
            <CardTitle className="text-destructive" data-testid="text-error-title">Error Loading Analytics</CardTitle>
            <CardDescription data-testid="text-error-description">Failed to load command analytics data</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground mb-2" data-testid="text-page-title">Command Analytics</h1>
        <p className="text-muted-foreground">Track and analyze bot command usage</p>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card className="hover-elevate">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Commands</CardTitle>
            <Terminal className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground" data-testid="text-total-commands">{totalCommands.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground mt-1">All time executions</p>
          </CardContent>
        </Card>

        <Card className="hover-elevate">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Success Rate</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground" data-testid="text-success-rate">{successRate}%</div>
            <p className="text-xs text-muted-foreground mt-1">{successfulCommands.toLocaleString()} successful</p>
          </CardContent>
        </Card>

        <Card className="hover-elevate">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Unique Commands</CardTitle>
            <Activity className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground" data-testid="text-unique-commands">{uniqueCommands}</div>
            <p className="text-xs text-muted-foreground mt-1">Different commands used</p>
          </CardContent>
        </Card>

        <Card className="hover-elevate">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Failed Commands</CardTitle>
            <TrendingUp className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground" data-testid="text-failed-commands">{failedCommands}</div>
            <p className="text-xs text-muted-foreground mt-1">Execution failures</p>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Top Commands Bar Chart */}
        <Card className="hover-elevate">
          <CardHeader>
            <CardTitle>Most Used Commands</CardTitle>
            <CardDescription>Top 10 commands by execution count</CardDescription>
          </CardHeader>
          <CardContent>
            {topCommands.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={topCommands}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis 
                    dataKey="commandName" 
                    stroke="hsl(var(--muted-foreground))"
                    tick={{ fill: "hsl(var(--muted-foreground))" }}
                  />
                  <YAxis 
                    stroke="hsl(var(--muted-foreground))"
                    tick={{ fill: "hsl(var(--muted-foreground))" }}
                  />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: "hsl(var(--card))", 
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "8px"
                    }}
                    labelStyle={{ color: "hsl(var(--foreground))" }}
                  />
                  <Bar dataKey="count" fill="#FFC107" radius={[8, 8, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                No command data available
              </div>
            )}
          </CardContent>
        </Card>

        {/* Success/Failure Pie Chart */}
        <Card className="hover-elevate">
          <CardHeader>
            <CardTitle>Command Success Rate</CardTitle>
            <CardDescription>Distribution of successful vs failed executions</CardDescription>
          </CardHeader>
          <CardContent>
            {totalCommands > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={statusData}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                    outerRadius={100}
                    fill="#8884d8"
                    dataKey="value"
                  >
                    {statusData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: "hsl(var(--card))", 
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "8px"
                    }}
                  />
                  <Legend 
                    wrapperStyle={{ color: "hsl(var(--foreground))" }}
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                No command data available
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent Commands Table */}
      <Card className="hover-elevate">
        <CardHeader>
          <CardTitle>Recent Command Activity</CardTitle>
          <CardDescription>Last 20 executed commands</CardDescription>
        </CardHeader>
        <CardContent>
          {commands && commands.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2 px-4 text-sm font-medium text-muted-foreground">Command</th>
                    <th className="text-left py-2 px-4 text-sm font-medium text-muted-foreground">Server ID</th>
                    <th className="text-left py-2 px-4 text-sm font-medium text-muted-foreground">Status</th>
                    <th className="text-left py-2 px-4 text-sm font-medium text-muted-foreground">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {commands.slice(0, 20).map((cmd) => (
                    <tr key={cmd.id} className="border-b border-border hover-elevate" data-testid={`row-command-${cmd.id}`}>
                      <td className="py-2 px-4 text-sm text-foreground font-mono">{cmd.commandName}</td>
                      <td className="py-2 px-4 text-sm text-muted-foreground font-mono">{cmd.serverId || "N/A"}</td>
                      <td className="py-2 px-4 text-sm">
                        <span className={`px-2 py-1 rounded text-xs ${cmd.success ? "bg-primary/20 text-primary" : "bg-destructive/20 text-destructive"}`}>
                          {cmd.success ? "Success" : "Failed"}
                        </span>
                      </td>
                      <td className="py-2 px-4 text-sm text-muted-foreground">
                        {new Date(cmd.executedAt).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center text-muted-foreground py-8">
              No recent command activity
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
