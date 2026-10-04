import Layout from "@/components/layout";
import FeaturePanel from "@/components/feature-panel";
import StatsCard from "@/components/stats-card";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { 
  Shield, 
  ShieldCheck, 
  ShieldAlert,
  ShieldX,
  Users,
  AlertTriangle,
  Lock,
  Eye,
  Clock,
  TrendingUp
} from "lucide-react";

export default function AntiRaidPage() {
  const raidEvents = [
    { id: 1, type: "Mass Join", severity: "high", time: "2 minutes ago", count: 15, status: "blocked" },
    { id: 2, type: "Suspicious Account", severity: "medium", time: "15 minutes ago", count: 3, status: "flagged" },
    { id: 3, type: "Spam Detection", severity: "low", time: "1 hour ago", count: 1, status: "warned" },
  ];

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'high': return 'bg-discord-error';
      case 'medium': return 'bg-discord-warning';
      case 'low': return 'bg-discord-success';
      default: return 'bg-discord-muted';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'blocked': return <ShieldX className="w-4 h-4" />;
      case 'flagged': return <AlertTriangle className="w-4 h-4" />;
      case 'warned': return <Eye className="w-4 h-4" />;
      default: return <Shield className="w-4 h-4" />;
    }
  };

  return (
    <Layout>
      <div className="space-y-6">
        {/* Stats Overview */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <StatsCard
            title="Threats Blocked"
            value={247}
            icon={<ShieldCheck className="text-discord-success text-xl" />}
            trend={{ value: "12%", label: "from last week", positive: true }}
            data-testid="stats-threats-blocked"
          />
          <StatsCard
            title="Suspicious Accounts"
            value={18}
            icon={<AlertTriangle className="text-discord-warning text-xl" />}
            trend={{ value: "3", label: "flagged today", positive: false }}
            data-testid="stats-suspicious-accounts"
          />
          <StatsCard
            title="Auto-Actions"
            value={89}
            icon={<Lock className="text-discord-primary text-xl" />}
            trend={{ value: "24h", label: "response time", positive: true }}
            data-testid="stats-auto-actions"
          />
          <StatsCard
            title="Protection Level"
            value="Maximum"
            icon={<Shield className="text-discord-success text-xl" />}
            trend={{ value: "99.8%", label: "uptime", positive: true }}
            data-testid="stats-protection-level"
          />
        </div>

        {/* Protection Settings */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <FeaturePanel
            title="Join Rate Protection"
            status="active"
            statusText="Active"
            data-testid="panel-join-rate"
          >
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-discord-light-grey">Enable Rate Limiting</span>
                <Switch defaultChecked data-testid="switch-rate-limiting" />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-discord-light-grey">Max Joins per Minute</span>
                <span className="text-white font-medium" data-testid="text-max-joins">5</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-discord-light-grey">Auto-Lockdown</span>
                <Switch defaultChecked data-testid="switch-auto-lockdown" />
              </div>
              <div className="pt-2 border-t border-discord-grey">
                <div className="text-sm text-discord-muted mb-2">Recent Activity</div>
                <div className="text-sm text-discord-success">
                  ✓ Blocked 15 rapid joins (2 min ago)
                </div>
              </div>
            </div>
          </FeaturePanel>

          <FeaturePanel
            title="Account Verification"
            status="active"
            statusText="Scanning"
            data-testid="panel-verification"
          >
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-discord-light-grey">Age Verification</span>
                <Switch defaultChecked data-testid="switch-age-verification" />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-discord-light-grey">Minimum Account Age</span>
                <span className="text-white font-medium" data-testid="text-min-age">7 days</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-discord-light-grey">Avatar Required</span>
                <Switch data-testid="switch-avatar-required" />
              </div>
              <div className="pt-2 border-t border-discord-grey">
                <div className="text-sm text-discord-muted mb-2">Flagged Accounts</div>
                <div className="text-sm text-discord-warning">
                  ⚠️ 3 suspicious accounts detected today
                </div>
              </div>
            </div>
          </FeaturePanel>
        </div>

        {/* Recent Events */}
        <FeaturePanel
          title="Recent Security Events"
          data-testid="panel-security-events"
        >
          <div className="space-y-3">
            {raidEvents.map((event) => (
              <div 
                key={event.id}
                className="flex items-center justify-between p-4 bg-discord-grey rounded-lg"
                data-testid={`event-${event.id}`}
              >
                <div className="flex items-center space-x-4">
                  <div className={`p-2 rounded-full ${getSeverityColor(event.severity)} bg-opacity-20`}>
                    {getStatusIcon(event.status)}
                  </div>
                  <div>
                    <div className="flex items-center space-x-2">
                      <span className="text-white font-medium" data-testid={`text-event-type-${event.id}`}>
                        {event.type}
                      </span>
                      <Badge variant="secondary" className="text-xs">
                        {event.count} affected
                      </Badge>
                    </div>
                    <p className="text-discord-muted text-sm" data-testid={`text-event-time-${event.id}`}>
                      {event.time}
                    </p>
                  </div>
                </div>
                <div className="flex items-center space-x-2">
                  <Badge 
                    variant={event.severity === 'high' ? 'destructive' : event.severity === 'medium' ? 'secondary' : 'default'}
                    data-testid={`badge-severity-${event.id}`}
                  >
                    {event.severity}
                  </Badge>
                  <Badge 
                    variant="outline"
                    className={`${
                      event.status === 'blocked' ? 'text-discord-error border-discord-error' :
                      event.status === 'flagged' ? 'text-discord-warning border-discord-warning' :
                      'text-discord-success border-discord-success'
                    }`}
                    data-testid={`badge-status-${event.id}`}
                  >
                    {event.status}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        </FeaturePanel>

        {/* Advanced Settings */}
        <FeaturePanel
          title="Advanced Protection"
          data-testid="panel-advanced"
        >
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="text-center">
              <div className="bg-discord-primary bg-opacity-20 w-16 h-16 rounded-xl flex items-center justify-center mx-auto mb-4">
                <TrendingUp className="text-discord-primary text-2xl" />
              </div>
              <h3 className="text-white font-medium mb-2" data-testid="text-feature-ai-detection">
                AI-Powered Detection
              </h3>
              <p className="text-discord-muted text-sm mb-4">
                Advanced pattern recognition to identify coordinated attacks
              </p>
              <Switch defaultChecked data-testid="switch-ai-detection" />
            </div>

            <div className="text-center">
              <div className="bg-discord-warning bg-opacity-20 w-16 h-16 rounded-xl flex items-center justify-center mx-auto mb-4">
                <Clock className="text-discord-warning text-2xl" />
              </div>
              <h3 className="text-white font-medium mb-2" data-testid="text-feature-quarantine">
                Smart Quarantine
              </h3>
              <p className="text-discord-muted text-sm mb-4">
                Temporarily restrict suspicious users until manual review
              </p>
              <Switch data-testid="switch-quarantine" />
            </div>

            <div className="text-center">
              <div className="bg-discord-success bg-opacity-20 w-16 h-16 rounded-xl flex items-center justify-center mx-auto mb-4">
                <Users className="text-discord-success text-2xl" />
              </div>
              <h3 className="text-white font-medium mb-2" data-testid="text-feature-whitelist">
                Trusted User Whitelist
              </h3>
              <p className="text-discord-muted text-sm mb-4">
                Bypass all restrictions for verified community members
              </p>
              <Switch defaultChecked data-testid="switch-whitelist" />
            </div>
          </div>
        </FeaturePanel>
      </div>
    </Layout>
  );
}