import { useQuery } from "@tanstack/react-query";
import Layout from "@/components/layout";
import FeaturePanel from "@/components/feature-panel";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { 
  Shield, 
  AlertTriangle, 
  Ban, 
  UserX, 
  MessageSquareX,
  Eye,
  Clock,
  Users
} from "lucide-react";

export default function Moderation() {
  const { data: moderationActions, isLoading } = useQuery({
    queryKey: ['/api/moderation/123456789012345678/actions'],
    staleTime: 30000,
  });

  const { data: guildSettings } = useQuery({
    queryKey: ['/api/guilds/123456789012345678'],
    staleTime: 300000,
  });

  if (isLoading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64">
          <div className="text-discord-muted">Loading moderation tools...</div>
        </div>
      </Layout>
    );
  }

  const moderationSettings = guildSettings?.settings?.moderation || {
    automod: true,
    spamDetection: true,
    linkFiltering: false,
    profanityFilter: true
  };

  const getActionIcon = (type: string) => {
    switch (type) {
      case 'warn': return <AlertTriangle className="w-4 h-4 text-discord-warning" />;
      case 'kick': return <UserX className="w-4 h-4 text-discord-error" />;
      case 'ban': return <Ban className="w-4 h-4 text-discord-error" />;
      case 'mute': return <MessageSquareX className="w-4 h-4 text-discord-muted" />;
      default: return <Shield className="w-4 h-4 text-discord-primary" />;
    }
  };

  const getActionColor = (type: string) => {
    switch (type) {
      case 'warn': return 'bg-discord-warning text-discord-darker';
      case 'kick': return 'bg-discord-error text-white';
      case 'ban': return 'bg-discord-error text-white';
      case 'mute': return 'bg-discord-muted text-white';
      default: return 'bg-discord-primary text-white';
    }
  };

  return (
    <Layout>
      <div className="space-y-8">
        {/* Auto-Moderation Settings */}
        <FeaturePanel
          title="Auto-Moderation Settings"
          description="Configure automatic moderation features"
          status={moderationSettings.automod ? "active" : "inactive"}
          statusText={moderationSettings.automod ? "Active" : "Disabled"}
          data-testid="panel-automod"
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <label className="text-white font-medium">Auto-Moderation</label>
                  <p className="text-discord-muted text-sm">Enable automatic content filtering</p>
                </div>
                <Switch 
                  defaultChecked={moderationSettings.automod} 
                  data-testid="switch-automod" 
                />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <label className="text-white font-medium">Spam Detection</label>
                  <p className="text-discord-muted text-sm">Detect and prevent spam messages</p>
                </div>
                <Switch 
                  defaultChecked={moderationSettings.spamDetection} 
                  data-testid="switch-spam-detection" 
                />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <label className="text-white font-medium">Link Filtering</label>
                  <p className="text-discord-muted text-sm">Filter suspicious or unwanted links</p>
                </div>
                <Switch 
                  defaultChecked={moderationSettings.linkFiltering} 
                  data-testid="switch-link-filtering" 
                />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <label className="text-white font-medium">Profanity Filter</label>
                  <p className="text-discord-muted text-sm">Automatically filter bad words</p>
                </div>
                <Switch 
                  defaultChecked={moderationSettings.profanityFilter} 
                  data-testid="switch-profanity-filter" 
                />
              </div>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-white font-medium">Spam Threshold</label>
                <p className="text-discord-muted text-sm">Messages per 10 seconds before action</p>
                <Input 
                  type="number"
                  defaultValue="5" 
                  className="discord-input"
                  data-testid="input-spam-threshold"
                />
              </div>

              <div className="space-y-2">
                <label className="text-white font-medium">Auto-Mute Duration</label>
                <p className="text-discord-muted text-sm">Duration for automatic mutes (minutes)</p>
                <Input 
                  type="number"
                  defaultValue="10" 
                  className="discord-input"
                  data-testid="input-mute-duration"
                />
              </div>

              <div className="space-y-2">
                <label className="text-white font-medium">Warning Threshold</label>
                <p className="text-discord-muted text-sm">Warnings before escalation</p>
                <Input 
                  type="number"
                  defaultValue="3" 
                  className="discord-input"
                  data-testid="input-warning-threshold"
                />
              </div>

              <div className="space-y-2">
                <label className="text-white font-medium">Mod Log Channel</label>
                <p className="text-discord-muted text-sm">Channel for moderation logs</p>
                <select className="discord-input w-full" data-testid="select-mod-log-channel">
                  <option value="">Select Channel</option>
                  <option value="mod-logs">#mod-logs</option>
                  <option value="admin">#admin</option>
                </select>
              </div>
            </div>
          </div>

          <div className="mt-6 pt-6 border-t border-discord-grey">
            <div className="flex space-x-4">
              <Button className="discord-button" data-testid="button-save-moderation-settings">
                Save Settings
              </Button>
              <Button variant="outline" data-testid="button-test-automod">
                Test Auto-Mod
              </Button>
            </div>
          </div>
        </FeaturePanel>

        {/* Quick Actions */}
        <Card className="discord-card">
          <div className="p-6 border-b border-discord-grey">
            <h3 className="text-lg font-semibold text-white">Quick Moderation Actions</h3>
            <p className="text-discord-muted text-sm mt-1">Perform common moderation tasks</p>
          </div>
          <div className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-white font-medium">User ID or Mention</label>
                  <Input 
                    placeholder="@user or 123456789012345678" 
                    className="discord-input"
                    data-testid="input-user-target"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-white font-medium">Reason</label>
                  <Textarea 
                    placeholder="Enter moderation reason..." 
                    className="discord-input min-h-20"
                    data-testid="textarea-mod-reason"
                  />
                </div>
              </div>
              <div className="flex flex-col space-y-3">
                <Button variant="outline" className="justify-start" data-testid="button-quick-warn">
                  <AlertTriangle className="w-4 h-4 mr-2 text-discord-warning" />
                  Warn User
                </Button>
                <Button variant="outline" className="justify-start" data-testid="button-quick-mute">
                  <MessageSquareX className="w-4 h-4 mr-2 text-discord-muted" />
                  Mute User (10min)
                </Button>
                <Button variant="outline" className="justify-start" data-testid="button-quick-kick">
                  <UserX className="w-4 h-4 mr-2 text-discord-error" />
                  Kick User
                </Button>
                <Button variant="outline" className="justify-start" data-testid="button-quick-ban">
                  <Ban className="w-4 h-4 mr-2 text-discord-error" />
                  Ban User
                </Button>
              </div>
            </div>
          </div>
        </Card>

        {/* Moderation Statistics */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <Card className="discord-card p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-discord-muted text-sm font-medium">Total Actions</p>
                <p className="text-2xl font-bold text-white mt-1" data-testid="text-total-actions">
                  {moderationActions?.length || 0}
                </p>
              </div>
              <Shield className="w-8 h-8 text-discord-primary" />
            </div>
          </Card>

          <Card className="discord-card p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-discord-muted text-sm font-medium">Warnings</p>
                <p className="text-2xl font-bold text-white mt-1" data-testid="text-total-warnings">
                  {moderationActions?.filter((action: any) => action.type === 'warn').length || 0}
                </p>
              </div>
              <AlertTriangle className="w-8 h-8 text-discord-warning" />
            </div>
          </Card>

          <Card className="discord-card p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-discord-muted text-sm font-medium">Bans</p>
                <p className="text-2xl font-bold text-white mt-1" data-testid="text-total-bans">
                  {moderationActions?.filter((action: any) => action.type === 'ban').length || 0}
                </p>
              </div>
              <Ban className="w-8 h-8 text-discord-error" />
            </div>
          </Card>

          <Card className="discord-card p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-discord-muted text-sm font-medium">Active Mutes</p>
                <p className="text-2xl font-bold text-white mt-1" data-testid="text-active-mutes">
                  {moderationActions?.filter((action: any) => action.type === 'mute' && action.active).length || 0}
                </p>
              </div>
              <MessageSquareX className="w-8 h-8 text-discord-muted" />
            </div>
          </Card>
        </div>

        {/* Recent Moderation Actions */}
        <Card className="discord-card">
          <div className="p-6 border-b border-discord-grey">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <Eye className="w-6 h-6 text-discord-primary" />
                <h3 className="text-lg font-semibold text-white">Recent Moderation Actions</h3>
              </div>
              <Button variant="outline" size="sm" data-testid="button-refresh-actions">
                Refresh
              </Button>
            </div>
          </div>
          <div className="p-6">
            <div className="space-y-4">
              {moderationActions?.slice(0, 10).map((action: any, index: number) => (
                <div 
                  key={action.id} 
                  className="flex items-center justify-between p-4 bg-discord-grey rounded-lg"
                  data-testid={`row-mod-action-${index}`}
                >
                  <div className="flex items-center space-x-4">
                    {getActionIcon(action.type)}
                    <div>
                      <div className="flex items-center space-x-2">
                        <Badge className={getActionColor(action.type)}>
                          {action.type.toUpperCase()}
                        </Badge>
                        <span className="text-white text-sm" data-testid={`text-action-target-${index}`}>
                          User #{action.userId.slice(-4)}
                        </span>
                      </div>
                      <p className="text-discord-muted text-sm mt-1" data-testid={`text-action-reason-${index}`}>
                        {action.reason || 'No reason provided'}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-discord-light-grey text-sm" data-testid={`text-action-moderator-${index}`}>
                      By: Moderator #{action.moderatorId.slice(-4)}
                    </p>
                    <p className="text-discord-muted text-xs" data-testid={`text-action-time-${index}`}>
                      {new Date(action.createdAt).toLocaleString()}
                    </p>
                  </div>
                </div>
              )) || (
                <div className="text-center py-8 text-discord-muted">
                  No moderation actions recorded yet
                </div>
              )}
            </div>
          </div>
        </Card>
      </div>
    </Layout>
  );
}
