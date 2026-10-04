import { useQuery } from "@tanstack/react-query";
import { Shield, AlertCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SecurityEventItem } from "@/components/security-event-item";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import type { SecurityEvent } from "@shared/schema";
import { mockSecurityEvents } from "@/lib/mockData";
import { isServerMode } from "@/lib/environment";

export default function Security() {
  const { data: events, isLoading, isError, refetch } = useQuery<SecurityEvent[]>({
    queryKey: ["/api/security/events"],
    queryFn: async () => {
      const response = await fetch("/api/security/events");
      if (!response.ok) {
        throw new Error(`Failed to fetch security events: ${response.status}`);
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

  // Calculate security stats
  const errorCount = events?.filter(e => e.severity === "error").length || 0;
  const warningCount = events?.filter(e => e.severity === "warning").length || 0;
  const failedLogins = events?.filter(e => e.eventType === "login_failed").length || 0;

  return (
    <div className="p-8">
      <div className="max-w-7xl mx-auto space-y-8">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold text-foreground mb-2" data-testid="heading-security">
            Security
          </h1>
          <p className="text-muted-foreground">
            Monitor security events and potential threats
          </p>
        </div>

        {/* Security Overview */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card className="hover-elevate">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <p className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
                Total Events
              </p>
              <Shield className="h-5 w-5 text-primary" />
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold font-mono text-foreground" data-testid="stat-total-events">
                {events?.length || 0}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Last 30 days
              </p>
            </CardContent>
          </Card>

          <Card className="hover-elevate">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <p className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
                Failed Logins
              </p>
              <AlertCircle className="h-5 w-5 text-status-error" />
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold font-mono text-foreground" data-testid="stat-failed-logins">
                {failedLogins}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Requires attention
              </p>
            </CardContent>
          </Card>

          <Card className="hover-elevate">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <p className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
                Warnings
              </p>
              <AlertCircle className="h-5 w-5 text-status-warning" />
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold font-mono text-foreground" data-testid="stat-warnings">
                {warningCount}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Active warnings
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Error State */}
        {isError ? (
          <Card className="border-destructive">
            <CardContent className="flex flex-col items-center justify-center py-12">
              <AlertCircle className="h-12 w-12 text-destructive mb-4" />
              <h3 className="text-lg font-semibold text-foreground mb-2">Failed to Load Security Events</h3>
              <p className="text-sm text-muted-foreground mb-6 text-center max-w-md">
                Unable to fetch security data from the server. Please try again.
              </p>
              <Button onClick={() => refetch()} data-testid="button-retry-security">
                Retry
              </Button>
            </CardContent>
          </Card>
        ) : (
          /* Security Events Log */
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  Security Events Log
                </CardTitle>
                <div className="flex gap-2">
                  <Badge variant="secondary" data-testid="badge-error-count">
                    {errorCount} Errors
                  </Badge>
                  <Badge variant="secondary" data-testid="badge-warning-count">
                    {warningCount} Warnings
                  </Badge>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="space-y-3">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <Skeleton key={i} className="h-20 w-full" />
                  ))}
                </div>
              ) : (
                <div className="space-y-0">
                  {events?.map((event) => (
                    <SecurityEventItem key={event.id} event={event} />
                  ))}
                  {(!events || events.length === 0) && (
                    <div className="text-center py-12">
                      <Shield className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
                      <p className="text-sm text-muted-foreground">
                        No security events recorded
                      </p>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
