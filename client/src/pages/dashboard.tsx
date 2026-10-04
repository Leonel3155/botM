import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Layout from "@/components/layout";
import GuildSelector from "@/components/guild-selector";
import OAuthNotice from "@/components/oauth-notice";
import { AuthRequired } from "@/components/auth-required";
import StatsCard from "@/components/stats-card";
import FeaturePanel from "@/components/feature-panel";
import { PrefixConfig } from "@/components/prefix-config";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { 
  Users, 
  TrendingUp, 
  Terminal, 
  Shield,
  ShieldCheck,
  ShieldQuestion,
  Lock,
  Music,
  Play,
  SkipForward,
  Square
} from "lucide-react";

interface DashboardStats {
  totalMembers: number;
  activeUsers: number;
  commandsUsed: number;
  moderationActions: number;
}

interface TopUser {
  id: string;
  userId: string;
  level: number;
  xp: number;
}

interface AuthStatus {
  authenticated: boolean;
  discordToken?: string;
  user?: any;
}

export default function Dashboard() {
  const [selectedGuildId, setSelectedGuildId] = useState("1381704130825027704");

  // Check authentication status first
  const { data: authStatus, isLoading: authLoading } = useQuery<AuthStatus>({
    queryKey: ['/api/auth/status'],
    retry: false,
  });

  const { data: stats, isLoading: statsLoading, error: statsError } = useQuery<DashboardStats>({
    queryKey: ['/api/dashboard', selectedGuildId, 'stats'],
    enabled: authStatus?.authenticated,
    staleTime: 30000, // 30 seconds
    retry: false,
  });

  const { data: topUsers, error: usersError } = useQuery<TopUser[]>({
    queryKey: ['/api/levels', selectedGuildId, 'top'],
    enabled: authStatus?.authenticated,
    staleTime: 60000, // 1 minute
    retry: false,
  });

  // Check if authentication is required
  const authRequired = !authStatus?.authenticated;

  if (authLoading || statsLoading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64">
          <div className="text-discord-muted">
            {authLoading ? "Checking authentication..." : "Loading dashboard..."}
          </div>
        </div>
      </Layout>
    );
  }

  // Show authentication required screen if not authenticated
  if (authRequired) {
    return (
      <Layout>
        <AuthRequired 
          message="You need to authenticate with Discord to view your real server dashboard and data"
        />
      </Layout>
    );
  }

  return (
    <Layout>
      <OAuthNotice />
      
      <GuildSelector 
        currentGuildId={selectedGuildId}
        onGuildChange={setSelectedGuildId}
      />
      
      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <StatsCard
          title="Total Members"
          value={stats?.totalMembers || "Loading..."}
          icon={<Users className="text-discord-primary text-xl" />}
          trend={stats?.totalMembers ? { value: "Real Data", label: "from Discord API", positive: true } : undefined}
          data-testid="stats-total-members"
        />
        <StatsCard
          title="Active Users"
          value={stats?.activeUsers || "Loading..."}
          icon={<TrendingUp className="text-discord-success text-xl" />}
          trend={stats?.activeUsers ? { value: "Live Data", label: "from Discord", positive: true } : undefined}
          data-testid="stats-active-users"
        />
        <StatsCard
          title="Commands Used"
          value={stats?.commandsUsed ? `${(stats.commandsUsed / 1000).toFixed(1)}K` : "Loading..."}
          icon={<Terminal className="text-discord-warning text-xl" />}
          trend={stats?.commandsUsed ? { value: "Bot Data", label: "tracked usage", positive: true } : undefined}
          data-testid="stats-commands-used"
        />
        <StatsCard
          title="Moderation Actions"
          value={stats?.moderationActions || "Loading..."}
          icon={<Shield className="text-discord-error text-xl" />}
          trend={stats?.moderationActions ? { value: "Real Logs", label: "from bot", positive: true } : undefined}
          data-testid="stats-moderation-actions"
        />
      </div>

      {/* Bot Configuration Panel */}
      <div className="mb-8">
        <PrefixConfig guildId={selectedGuildId} />
      </div>

      {/* Feature Management Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Level System Panel */}
        <FeaturePanel
          title="Level System"
          status="active"
          statusText="Active"
          data-testid="panel-level-system"
        >
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-discord-light-grey">XP per Message</span>
              <span className="text-white font-medium" data-testid="text-xp-per-message">15-25</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-discord-light-grey">Voice XP Multiplier</span>
              <span className="text-white font-medium" data-testid="text-voice-multiplier">1.5x</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-discord-light-grey">Level Announcements</span>
              <Switch defaultChecked data-testid="switch-level-announcements" />
            </div>
            <div className="pt-4">
              <div className="text-sm text-discord-muted mb-2">Top Users This Week</div>
              <div className="space-y-2">
                {topUsers?.slice(0, 3).map((user, index: number) => (
                  <div key={`top-user-${user.userId}-${index}`} className="flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      <img 
                        src={`https://images.unsplash.com/photo-${1535713875002 + index}-d1d0cf377fde?ixlib=rb-4.0.3&auto=format&fit=crop&w=32&h=32`}
                        alt="User" 
                        className="w-6 h-6 rounded-full"
                      />
                      <span className="text-white text-sm" data-testid={`text-top-user-${index}`}>
                        User #{user.userId.slice(-4)}
                      </span>
                    </div>
                    <span className="text-discord-primary text-sm font-medium" data-testid={`text-user-level-${index}`}>
                      Lvl {user.level}
                    </span>
                  </div>
                )) || (
                  <div className="text-discord-muted text-sm">No data available</div>
                )}
              </div>
            </div>
          </div>
        </FeaturePanel>

        {/* Economy System Panel */}
        <FeaturePanel
          title="Economy System"
          status="active"
          statusText="Active"
          data-testid="panel-economy"
        >
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-discord-light-grey">Daily Reward</span>
              <span className="text-white font-medium" data-testid="text-daily-reward">500 coins</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-discord-light-grey">Work Cooldown</span>
              <span className="text-white font-medium" data-testid="text-work-cooldown">4 hours</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-discord-light-grey">Total Coins in Circulation</span>
              <span className="text-white font-medium" data-testid="text-total-coins">2.4M</span>
            </div>
            <div className="pt-4">
              <div className="text-sm text-discord-muted mb-2">Recent Transactions</div>
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-discord-light-grey" data-testid="text-transaction-1">
                    Daily reward claimed
                  </span>
                  <span className="text-discord-muted" data-testid="text-transaction-time-1">2m ago</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-discord-light-grey" data-testid="text-transaction-2">
                    Work command used
                  </span>
                  <span className="text-discord-muted" data-testid="text-transaction-time-2">5m ago</span>
                </div>
              </div>
            </div>
          </div>
        </FeaturePanel>

        {/* Moderation Panel */}
        <FeaturePanel
          title="Moderation Tools"
          status="warning"
          statusText="3 Warnings"
          data-testid="panel-moderation"
        >
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-discord-light-grey">Auto-Moderation</span>
              <Switch defaultChecked data-testid="switch-auto-moderation" />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-discord-light-grey">Spam Detection</span>
              <Switch defaultChecked data-testid="switch-spam-detection" />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-discord-light-grey">Link Filtering</span>
              <Switch data-testid="switch-link-filtering" />
            </div>
            <div className="pt-4">
              <div className="text-sm text-discord-muted mb-2">Recent Actions</div>
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-discord-light-grey" data-testid="text-mod-action-1">
                    Auto-moderation warning
                  </span>
                  <span className="text-discord-muted" data-testid="text-mod-action-time-1">1h ago</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-discord-light-grey" data-testid="text-mod-action-2">
                    Spam message deleted
                  </span>
                  <span className="text-discord-muted" data-testid="text-mod-action-time-2">3h ago</span>
                </div>
              </div>
            </div>
          </div>
        </FeaturePanel>

        {/* Social Content Panel */}
        <FeaturePanel
          title="Social Content"
          status="active"
          statusText="24 Posted Today"
          data-testid="panel-social"
        >
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-discord-light-grey">Reddit Memes</span>
              <Switch defaultChecked data-testid="switch-reddit-memes" />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-discord-light-grey">Twitter Reposts</span>
              <Switch defaultChecked data-testid="switch-twitter-reposts" />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-discord-light-grey">Post Interval</span>
              <span className="text-white font-medium" data-testid="text-post-interval">Every 30min</span>
            </div>
            <div className="pt-4">
              <div className="text-sm text-discord-muted mb-2">Latest Posts</div>
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-discord-light-grey" data-testid="text-social-post-1">
                    Reddit content posted
                  </span>
                  <span className="text-discord-muted" data-testid="text-social-post-time-1">15m ago</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-discord-light-grey" data-testid="text-social-post-2">
                    Twitter content posted
                  </span>
                  <span className="text-discord-muted" data-testid="text-social-post-time-2">45m ago</span>
                </div>
              </div>
            </div>
          </div>
        </FeaturePanel>
      </div>

      {/* Anti-Raid Protection */}
      <div className="mt-8 discord-card">
        <div className="p-6 border-b border-discord-grey">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-white" data-testid="text-antiraid-title">
                Anti-Raid Protection
              </h3>
              <p className="text-discord-muted text-sm mt-1">
                Advanced security measures to protect your server
              </p>
            </div>
            <div className="flex items-center space-x-2">
              <span className="bg-discord-success text-discord-darker text-xs px-2 py-1 rounded-full font-medium">
                Protected
              </span>
              <Button className="discord-button text-sm" data-testid="button-configure-antiraid">
                Configure
              </Button>
            </div>
          </div>
        </div>
        <div className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="text-center">
              <div className="bg-discord-success bg-opacity-20 w-12 h-12 rounded-lg flex items-center justify-center mx-auto mb-3">
                <ShieldCheck className="text-discord-success text-xl" />
              </div>
              <h4 className="font-medium text-white mb-2" data-testid="text-feature-join-rate">
                Join Rate Limiting
              </h4>
              <p className="text-discord-muted text-sm">
                Automatically detect and prevent mass join attacks
              </p>
              <div className="mt-3">
                <span className="text-discord-success text-sm font-medium">5 joins/min limit</span>
              </div>
            </div>
            <div className="text-center">
              <div className="bg-discord-warning bg-opacity-20 w-12 h-12 rounded-lg flex items-center justify-center mx-auto mb-3">
                <ShieldQuestion className="text-discord-warning text-xl" />
              </div>
              <h4 className="font-medium text-white mb-2" data-testid="text-feature-suspicious-detection">
                Suspicious Account Detection
              </h4>
              <p className="text-discord-muted text-sm">
                Flag newly created accounts and suspicious patterns
              </p>
              <div className="mt-3">
                <span className="text-discord-warning text-sm font-medium">12 accounts flagged</span>
              </div>
            </div>
            <div className="text-center">
              <div className="bg-discord-error bg-opacity-20 w-12 h-12 rounded-lg flex items-center justify-center mx-auto mb-3">
                <Lock className="text-discord-error text-xl" />
              </div>
              <h4 className="font-medium text-white mb-2" data-testid="text-feature-auto-lockdown">
                Auto-Lockdown
              </h4>
              <p className="text-discord-muted text-sm">
                Automatically lock server during detected raids
              </p>
              <div className="mt-3">
                <span className="text-discord-muted text-sm font-medium">Ready to activate</span>
              </div>
            </div>
          </div>
        </div>
      </div>

    </Layout>
  );
}
