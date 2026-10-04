import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Settings as SettingsIcon, Save, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useState, useEffect } from "react";
import type { SerializedBotConfig } from "@shared/schema";

export default function Settings() {
  const { toast } = useToast();
  const [configs, setConfigs] = useState<Record<string, string>>({});

  const { data: configList, isLoading, isError } = useQuery<SerializedBotConfig[]>({
    queryKey: ["/api/config"],
  });

  const updateMutation = useMutation({
    mutationFn: async (updates: { key: string; value: string }[]) => {
      await apiRequest("POST", "/api/config", updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/config"] });
      toast({
        title: "Configuration Updated",
        description: "Bot configuration has been saved successfully.",
      });
    },
    onError: () => {
      toast({
        title: "Update Failed",
        description: "Failed to update bot configuration.",
        variant: "destructive",
      });
    },
  });

  useEffect(() => {
    if (configList) {
      const configMap = configList.reduce((acc, config) => {
        acc[config.key] = config.value;
        return acc;
      }, {} as Record<string, string>);
      setConfigs(configMap);
    }
  }, [configList]);

  const handleSave = () => {
    const updates = Object.entries(configs).map(([key, value]) => ({ key, value }));
    updateMutation.mutate(updates);
  };

  const handleReset = () => {
    if (configList) {
      const configMap = configList.reduce((acc, config) => {
        acc[config.key] = config.value;
        return acc;
      }, {} as Record<string, string>);
      setConfigs(configMap);
      toast({
        title: "Reset Complete",
        description: "Configuration values have been reset.",
      });
    }
  };

  if (isLoading) {
    return (
      <div className="p-8 space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-foreground mb-2" data-testid="text-page-title">Bot Configuration</h1>
          <p className="text-muted-foreground" data-testid="text-loading-message">Loading configuration...</p>
        </div>
        <Card className="hover-elevate" data-testid="card-skeleton">
          <CardContent className="py-8">
            <div className="space-y-4">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="space-y-2">
                  <div className="h-4 w-32 bg-muted animate-pulse rounded" />
                  <div className="h-10 w-full bg-muted animate-pulse rounded" />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="p-8">
        <Card className="border-destructive" data-testid="card-error">
          <CardHeader>
            <CardTitle className="text-destructive" data-testid="text-error-title">Error Loading Configuration</CardTitle>
            <CardDescription data-testid="text-error-description">Failed to load bot configuration data</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground mb-2" data-testid="text-page-title">Bot Configuration</h1>
        <p className="text-muted-foreground">Manage bot settings and preferences</p>
      </div>

      <Card className="hover-elevate">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <SettingsIcon className="h-5 w-5" />
                Configuration Settings
              </CardTitle>
              <CardDescription>Update bot behavior and features</CardDescription>
            </div>
            <div className="flex gap-2">
              <Button 
                variant="outline" 
                onClick={handleReset}
                data-testid="button-reset"
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                Reset
              </Button>
              <Button 
                onClick={handleSave}
                disabled={updateMutation.isPending}
                data-testid="button-save"
              >
                <Save className="h-4 w-4 mr-2" />
                {updateMutation.isPending ? "Saving..." : "Save Changes"}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="prefix" data-testid="label-prefix">Command Prefix</Label>
              <Input
                id="prefix"
                value={configs.prefix || "!"}
                onChange={(e) => setConfigs({ ...configs, prefix: e.target.value })}
                placeholder="!"
                className="max-w-md"
                data-testid="input-prefix"
              />
              <p className="text-xs text-muted-foreground">
                The character(s) used to trigger bot commands
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="welcomeMessage" data-testid="label-welcome-message">Welcome Message</Label>
              <Textarea
                id="welcomeMessage"
                value={configs.welcomeMessage || ""}
                onChange={(e) => setConfigs({ ...configs, welcomeMessage: e.target.value })}
                placeholder="Welcome to the server!"
                rows={3}
                data-testid="input-welcome-message"
              />
              <p className="text-xs text-muted-foreground">
                Message sent when new members join the server
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="logChannel" data-testid="label-log-channel">Log Channel ID</Label>
              <Input
                id="logChannel"
                value={configs.logChannel || ""}
                onChange={(e) => setConfigs({ ...configs, logChannel: e.target.value })}
                placeholder="123456789012345678"
                className="max-w-md"
                data-testid="input-log-channel"
              />
              <p className="text-xs text-muted-foreground">
                Discord channel ID for logging bot activities
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="moderationRole" data-testid="label-moderation-role">Moderation Role ID</Label>
              <Input
                id="moderationRole"
                value={configs.moderationRole || ""}
                onChange={(e) => setConfigs({ ...configs, moderationRole: e.target.value })}
                placeholder="123456789012345678"
                className="max-w-md"
                data-testid="input-moderation-role"
              />
              <p className="text-xs text-muted-foreground">
                Discord role ID required for moderation commands
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="enableAutoMod" data-testid="label-enable-automod">Auto-Moderation</Label>
              <select
                id="enableAutoMod"
                value={configs.enableAutoMod || "false"}
                onChange={(e) => setConfigs({ ...configs, enableAutoMod: e.target.value })}
                className="flex h-9 w-full max-w-md rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                data-testid="select-enable-automod"
              >
                <option value="false">Disabled</option>
                <option value="true">Enabled</option>
              </select>
              <p className="text-xs text-muted-foreground">
                Automatically moderate messages for spam and inappropriate content
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {configList && configList.length === 0 && (
        <Card className="hover-elevate">
          <CardContent className="py-12">
            <div className="text-center">
              <SettingsIcon className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-foreground mb-2" data-testid="text-empty-config-title">No Configuration Yet</h3>
              <p className="text-muted-foreground" data-testid="text-empty-config-description">
                Configure your bot by filling in the settings above and clicking Save Changes.
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
