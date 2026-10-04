import { useState, useEffect } from "react";
import { useSelectedGuild } from "@/lib/guild";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Settings, MessageSquare, Shield, UserPlus, Radio, Hash } from "lucide-react";

interface Channel {
  id: string;
  name: string;
  type: 'text' | 'voice';
  category: string;
}

interface ChannelConfig {
  contentChannelId: string | null;
  moderationChannelId: string | null;
  welcomeChannelId: string | null;
  redditEnabled: boolean;
  twitterEnabled: boolean;
}

export default function ChannelsPage() {
  const { guildId: GUILD_ID } = useSelectedGuild();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [config, setConfig] = useState<ChannelConfig>({
    contentChannelId: null,
    moderationChannelId: null,
    welcomeChannelId: null,
    redditEnabled: false,
    twitterEnabled: false
  });

  // Fetch current channel configuration
  const { data: channelConfig, isLoading: configLoading } = useQuery<ChannelConfig>({
    queryKey: [`/api/guild/${GUILD_ID}/channels`],
  });

  // Fetch available Discord channels (requires authentication)
  const { data: discordChannels, isLoading: channelsLoading } = useQuery<Channel[]>({
    queryKey: [`/api/guild/${GUILD_ID}/discord-channels`],
    retry: false
  });

  // Update channel configuration mutation
  const updateChannelsMutation = useMutation({
    mutationFn: (newConfig: ChannelConfig) =>
      apiRequest('PUT', `/api/guild/${GUILD_ID}/channels`, newConfig),
    onSuccess: () => {
      toast({
        title: "Configuration Updated",
        description: "Channel settings have been saved successfully.",
      });
      queryClient.invalidateQueries({ queryKey: [`/api/guild/${GUILD_ID}/channels`] });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "Update Failed",
        description: error.message || "Failed to update channel configuration.",
      });
    }
  });

  // Update local config when data loads
  useEffect(() => {
    if (channelConfig) {
      setConfig(channelConfig);
    }
  }, [channelConfig]);

  const handleSave = () => {
    updateChannelsMutation.mutate(config);
  };

  const getChannelName = (channelId: string | null) => {
    if (!channelId || !discordChannels) return 'None selected';
    const channel = discordChannels.find(c => c.id === channelId);
    return channel ? `#${channel.name}` : 'Channel not found';
  };

  const textChannels = discordChannels?.filter(c => c.type === 'text') || [];

  if (configLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-discord-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading channel configuration...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center space-x-2">
        <Settings className="h-5 w-5 text-discord-primary" />
        <h1 className="text-2xl font-bold">Channel Configuration</h1>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Content Configuration */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Radio className="h-5 w-5 text-discord-primary" />
              Content Feeds
            </CardTitle>
            <CardDescription>
              Configure automatic content posting from social media
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="content-channel">Content Channel</Label>
              <Select
                value={config.contentChannelId || "none"}
                onValueChange={(value) => 
                  setConfig(prev => ({ 
                    ...prev, 
                    contentChannelId: value === "none" ? null : value 
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select text channel for content">
                    {config.contentChannelId ? getChannelName(config.contentChannelId) : "None selected"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No channel</SelectItem>
                  {textChannels.map((channel) => (
                    <SelectItem key={channel.id} value={channel.id}>
                      <Hash className="h-4 w-4 inline mr-1" />
                      {channel.name} ({channel.category})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="reddit-enabled">Reddit Posts</Label>
                <p className="text-sm text-muted-foreground">
                  Automatically post from r/memes and other subreddits
                </p>
              </div>
              <Switch
                id="reddit-enabled"
                checked={config.redditEnabled}
                onCheckedChange={(checked) => 
                  setConfig(prev => ({ ...prev, redditEnabled: checked }))
                }
              />
            </div>

            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="twitter-enabled">Twitter Posts</Label>
                <p className="text-sm text-muted-foreground">
                  Share content from Twitter/X feeds
                </p>
              </div>
              <Switch
                id="twitter-enabled"
                checked={config.twitterEnabled}
                onCheckedChange={(checked) => 
                  setConfig(prev => ({ ...prev, twitterEnabled: checked }))
                }
              />
            </div>
          </CardContent>
        </Card>

        {/* Moderation Configuration */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-discord-primary" />
              Moderation
            </CardTitle>
            <CardDescription>
              Configure moderation logs and security features
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="moderation-channel">Moderation Log Channel</Label>
              <Select
                value={config.moderationChannelId || "none"}
                onValueChange={(value) => 
                  setConfig(prev => ({ 
                    ...prev, 
                    moderationChannelId: value === "none" ? null : value 
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select channel for mod logs">
                    {config.moderationChannelId ? getChannelName(config.moderationChannelId) : "None selected"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No channel</SelectItem>
                  {textChannels.map((channel) => (
                    <SelectItem key={channel.id} value={channel.id}>
                      <Hash className="h-4 w-4 inline mr-1" />
                      {channel.name} ({channel.category})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-sm text-muted-foreground mt-1">
                Bans, kicks, and other moderation actions will be logged here
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Welcome Configuration */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserPlus className="h-5 w-5 text-discord-primary" />
              Welcome System
            </CardTitle>
            <CardDescription>
              Configure new member welcomes and announcements
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="welcome-channel">Welcome Channel</Label>
              <Select
                value={config.welcomeChannelId || "none"}
                onValueChange={(value) => 
                  setConfig(prev => ({ 
                    ...prev, 
                    welcomeChannelId: value === "none" ? null : value 
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select channel for welcomes">
                    {config.welcomeChannelId ? getChannelName(config.welcomeChannelId) : "None selected"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No channel</SelectItem>
                  {textChannels.map((channel) => (
                    <SelectItem key={channel.id} value={channel.id}>
                      <Hash className="h-4 w-4 inline mr-1" />
                      {channel.name} ({channel.category})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-sm text-muted-foreground mt-1">
                New members will be welcomed in this channel
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {channelsLoading && (
        <Card className="border-dashed border-2">
          <CardContent className="flex items-center justify-center py-8">
            <div className="text-center">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-discord-primary mx-auto mb-2"></div>
              <p className="text-muted-foreground">Loading Discord channels...</p>
              <p className="text-xs text-muted-foreground mt-1">
                Make sure you're logged in to see your server's channels
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {!discordChannels && !channelsLoading && (
        <Card className="border-yellow-200 bg-yellow-50 dark:bg-yellow-950 dark:border-yellow-800">
          <CardContent className="py-4">
            <p className="text-yellow-800 dark:text-yellow-200">
              <strong>Authentication Required:</strong> Please log in with Discord to see your server's channels and configure them properly.
            </p>
          </CardContent>
        </Card>
      )}

      <div className="flex justify-end">
        <Button
          onClick={handleSave}
          disabled={updateChannelsMutation.isPending}
          className="bg-discord-primary hover:bg-discord-primary/90"
        >
          {updateChannelsMutation.isPending ? "Saving..." : "Save Configuration"}
        </Button>
      </div>
    </div>
  );
}