import { useQuery } from "@tanstack/react-query";
import Layout from "@/components/layout";
import FeaturePanel from "@/components/feature-panel";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { BarChart3, Award, Users, Clock } from "lucide-react";
import type { GuildResponse, UserLevelResponse } from "@/lib/api-types";

const DEFAULT_LEVEL_SETTINGS = {
  enabled: true,
  xpPerMessage: [15, 25],
  voiceMultiplier: 1.5,
  announcements: true
};

export default function Levels() {
  const { data: topUsers, isLoading } = useQuery<UserLevelResponse[]>({
    queryKey: ['/api/levels/123456789012345678/top'],
    staleTime: 60000,
  });

  const { data: guildSettings } = useQuery<GuildResponse>({
    queryKey: ['/api/guilds/123456789012345678'],
    staleTime: 300000,
  });

  if (isLoading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64">
          <div className="text-discord-muted">Loading level system...</div>
        </div>
      </Layout>
    );
  }

  const levelSettings = {
    ...DEFAULT_LEVEL_SETTINGS,
    ...guildSettings?.settings?.levelSystem
  };

  return (
    <Layout>
      <div className="space-y-8">
        {/* Configuration Panel */}
        <FeaturePanel
          title="Level System Configuration"
          description="Configure XP rates, rewards, and announcements"
          status={levelSettings.enabled ? "active" : "inactive"}
          statusText={levelSettings.enabled ? "Enabled" : "Disabled"}
          data-testid="panel-level-config"
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <label className="text-white font-medium">Enable Level System</label>
                  <p className="text-discord-muted text-sm">Allow users to gain XP and levels</p>
                </div>
                <Switch 
                  defaultChecked={levelSettings.enabled} 
                  data-testid="switch-level-system-enabled" 
                />
              </div>
              
              <div className="space-y-2">
                <label className="text-white font-medium">XP per Message</label>
                <p className="text-discord-muted text-sm">Range of XP users get per message</p>
                <div className="px-3">
                  <Slider
                    defaultValue={levelSettings.xpPerMessage}
                    max={50}
                    min={1}
                    step={1}
                    className="w-full"
                    data-testid="slider-xp-per-message"
                  />
                  <div className="flex justify-between text-sm text-discord-muted mt-1">
                    <span>{levelSettings.xpPerMessage[0]} XP</span>
                    <span>{levelSettings.xpPerMessage[1]} XP</span>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-white font-medium">Voice XP Multiplier</label>
                <p className="text-discord-muted text-sm">Bonus XP for voice activity</p>
                <div className="px-3">
                  <Slider
                    defaultValue={[levelSettings.voiceMultiplier]}
                    max={3}
                    min={1}
                    step={0.1}
                    className="w-full"
                    data-testid="slider-voice-multiplier"
                  />
                  <div className="text-center text-sm text-discord-muted mt-1">
                    {levelSettings.voiceMultiplier}x
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <label className="text-white font-medium">Level Announcements</label>
                  <p className="text-discord-muted text-sm">Announce when users level up</p>
                </div>
                <Switch 
                  defaultChecked={levelSettings.announcements} 
                  data-testid="switch-level-announcements" 
                />
              </div>

              <div className="space-y-2">
                <label className="text-white font-medium">XP Cooldown</label>
                <p className="text-discord-muted text-sm">Minimum time between XP gains</p>
                <select className="discord-input w-full" data-testid="select-xp-cooldown">
                  <option value="60">1 minute</option>
                  <option value="120">2 minutes</option>
                  <option value="300">5 minutes</option>
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-white font-medium">Level Up Channel</label>
                <p className="text-discord-muted text-sm">Channel for level announcements</p>
                <select className="discord-input w-full" data-testid="select-levelup-channel">
                  <option value="">Current Channel</option>
                  <option value="general">#general</option>
                  <option value="levelups">#level-ups</option>
                </select>
              </div>
            </div>
          </div>

          <div className="mt-6 pt-6 border-t border-discord-grey">
            <div className="flex space-x-4">
              <Button className="discord-button" data-testid="button-save-level-settings">
                Save Settings
              </Button>
              <Button variant="outline" data-testid="button-reset-level-settings">
                Reset to Defaults
              </Button>
            </div>
          </div>
        </FeaturePanel>

        {/* Leaderboard */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2">
            <Card className="discord-card">
              <div className="p-6 border-b border-discord-grey">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <BarChart3 className="w-6 h-6 text-discord-primary" />
                    <h3 className="text-lg font-semibold text-white">Server Leaderboard</h3>
                  </div>
                  <Button variant="outline" size="sm" data-testid="button-refresh-leaderboard">
                    Refresh
                  </Button>
                </div>
              </div>
              <div className="p-6">
                <div className="space-y-4">
                  {topUsers && topUsers.length > 0 ? topUsers.map((user, index) => {
                    const rankIcon = index === 0 ? "🥇" : index === 1 ? "🥈" : index === 2 ? "🥉" : `${index + 1}.`;
                    return (
                      <div 
                        key={user.userId} 
                        className="flex items-center justify-between p-4 bg-discord-grey rounded-lg"
                        data-testid={`row-leaderboard-${index}`}
                      >
                        <div className="flex items-center space-x-4">
                          <span className="text-2xl">{rankIcon}</span>
                          <img 
                            src={`https://images.unsplash.com/photo-${1500000000000 + index}-user?ixlib=rb-4.0.3&auto=format&fit=crop&w=40&h=40`}
                            alt="User Avatar" 
                            className="w-10 h-10 rounded-full"
                          />
                          <div>
                            <p className="text-white font-medium" data-testid={`text-user-name-${index}`}>
                              User #{user.userId.slice(-4)}
                            </p>
                            <p className="text-discord-muted text-sm">
                              {(user.voiceTime ?? 0) > 0 && (
                                <span className="mr-2">🎤 {Math.floor((user.voiceTime ?? 0) / 60)}h</span>
                              )}
                              Last active: Recently
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          <Badge variant="secondary" className="mb-1" data-testid={`badge-level-${index}`}>
                            Level {user.level ?? 1}
                          </Badge>
                          <p className="text-discord-muted text-sm" data-testid={`text-total-xp-${index}`}>
                            {(user.totalXp ?? 0).toLocaleString()} XP
                          </p>
                        </div>
                      </div>
                    );
                  }) : (
                    <div className="text-center py-8 text-discord-muted">
                      No users have gained XP yet
                    </div>
                  )}
                </div>
              </div>
            </Card>
          </div>

          {/* Statistics */}
          <div className="space-y-6">
            <Card className="discord-card">
              <div className="p-6 border-b border-discord-grey">
                <h3 className="text-lg font-semibold text-white flex items-center">
                  <Award className="w-5 h-5 mr-2 text-discord-warning" />
                  Level Statistics
                </h3>
              </div>
              <div className="p-6 space-y-4">
                <div className="flex justify-between">
                  <span className="text-discord-light-grey">Total Users</span>
                  <span className="text-white font-medium" data-testid="text-stat-total-users">
                    {topUsers?.length || 0}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-discord-light-grey">Average Level</span>
                  <span className="text-white font-medium" data-testid="text-stat-average-level">
                    {topUsers?.length ? Math.round(topUsers.reduce((sum, user) => sum + (user.level ?? 1), 0) / topUsers.length) : 0}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-discord-light-grey">Highest Level</span>
                  <span className="text-white font-medium" data-testid="text-stat-highest-level">
                    {topUsers?.[0]?.level || 0}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-discord-light-grey">Total XP Earned</span>
                  <span className="text-white font-medium" data-testid="text-stat-total-xp">
                    {(topUsers?.reduce((sum, user) => sum + (user.totalXp ?? 0), 0) ?? 0).toLocaleString()}
                  </span>
                </div>
              </div>
            </Card>

            <Card className="discord-card">
              <div className="p-6 border-b border-discord-grey">
                <h3 className="text-lg font-semibold text-white flex items-center">
                  <Clock className="w-5 h-5 mr-2 text-discord-success" />
                  Recent Activity
                </h3>
              </div>
              <div className="p-6 space-y-3">
                <div className="text-sm">
                  <p className="text-discord-light-grey">
                    User gained 25 XP in #general
                  </p>
                  <p className="text-discord-muted text-xs">2 minutes ago</p>
                </div>
                <div className="text-sm">
                  <p className="text-discord-light-grey">
                    Level up announcement sent
                  </p>
                  <p className="text-discord-muted text-xs">5 minutes ago</p>
                </div>
                <div className="text-sm">
                  <p className="text-discord-light-grey">
                    Voice XP bonus applied
                  </p>
                  <p className="text-discord-muted text-xs">8 minutes ago</p>
                </div>
              </div>
            </Card>
          </div>
        </div>
      </div>
    </Layout>
  );
}
