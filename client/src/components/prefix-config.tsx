import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/hooks/use-toast';
import { Settings, Hash, MessageCircle, Shield, Coins } from 'lucide-react';
import { apiRequest } from '@/lib/queryClient';

interface GuildConfig {
  prefix: string;
  levelUpMessages: boolean;
  economyEnabled: boolean;
  antiRaidEnabled: boolean;
}

interface PrefixConfigProps {
  guildId: string;
}

export function PrefixConfig({ guildId }: PrefixConfigProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [prefix, setPrefix] = useState('&');
  const [levelUpMessages, setLevelUpMessages] = useState(true);
  const [economyEnabled, setEconomyEnabled] = useState(true);
  const [antiRaidEnabled, setAntiRaidEnabled] = useState(false);

  // Fetch guild configuration
  const { data: config, isLoading } = useQuery<GuildConfig>({
    queryKey: ['/api/guild', guildId, 'config'],
    enabled: !!guildId
  });

  // Update local state when config loads
  useEffect(() => {
    if (config) {
      setPrefix(config.prefix);
      setLevelUpMessages(config.levelUpMessages);
      setEconomyEnabled(config.economyEnabled);
      setAntiRaidEnabled(config.antiRaidEnabled);
    }
  }, [config]);

  // Update guild configuration mutation
  const updateConfigMutation = useMutation({
    mutationFn: async (newConfig: GuildConfig) => {
      const response = await fetch(`/api/guild/${guildId}/config`, {
        method: 'PUT',
        body: JSON.stringify(newConfig),
        headers: { 'Content-Type': 'application/json' }
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(errorData.error || 'Failed to update configuration');
      }
      
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/guild', guildId, 'config'] });
      toast({
        title: 'Configuration Updated',
        description: 'Bot settings have been saved successfully!'
      });
    },
    onError: (error: any) => {
      toast({
        title: 'Update Failed', 
        description: error.message || 'Failed to update bot configuration',
        variant: 'destructive'
      });
    }
  });

  const handleSave = () => {
    updateConfigMutation.mutate({
      prefix,
      levelUpMessages,
      economyEnabled,
      antiRaidEnabled
    });
  };

  const prefixExamples = [
    { symbol: '&', commands: ['&bal', '&lv', '&daily', '&dep all'] },
    { symbol: '!', commands: ['!bal', '!lv', '!daily', '!dep all'] },
    { symbol: '?', commands: ['?bal', '?lv', '?daily', '?dep all'] },
    { symbol: '.', commands: ['.bal', '.lv', '.daily', '.dep all'] },
    { symbol: '-', commands: ['-bal', '-lv', '-daily', '-dep all'] }
  ];

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Bot Configuration
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse">
            <div className="h-4 bg-gray-200 rounded w-3/4 mb-4"></div>
            <div className="h-8 bg-gray-200 rounded mb-4"></div>
            <div className="h-4 bg-gray-200 rounded w-1/2"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card data-testid="prefix-config-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Settings className="h-5 w-5" />
          Bot Configuration
        </CardTitle>
        <CardDescription>
          Configure command prefix and bot features for your server
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Prefix Configuration */}
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Hash className="h-4 w-4" />
            <Label htmlFor="prefix" className="text-sm font-medium">Command Prefix</Label>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Input
                id="prefix"
                data-testid="input-prefix"
                value={prefix}
                onChange={(e) => setPrefix(e.target.value)}
                placeholder="&"
                maxLength={5}
                className="w-20"
              />
              <p className="text-xs text-muted-foreground">
                1-5 characters, no spaces
              </p>
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium">Command Examples:</p>
              <div className="bg-muted/50 p-3 rounded-md">
                <div className="flex flex-wrap gap-2 text-sm font-mono">
                  <code data-testid="example-bal">{prefix}bal</code>
                  <code data-testid="example-lv">{prefix}lv</code>
                  <code data-testid="example-daily">{prefix}daily</code>
                  <code data-testid="example-dep">{prefix}dep all</code>
                </div>
              </div>
            </div>
          </div>
        </div>

        <Separator />

        {/* Popular Prefix Examples */}
        <div className="space-y-3">
          <Label className="text-sm font-medium">Popular Prefixes:</Label>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {prefixExamples.map((example) => (
              <Card 
                key={example.symbol}
                className={`cursor-pointer transition-colors hover:bg-accent/50 ${
                  prefix === example.symbol ? 'ring-2 ring-primary' : ''
                }`}
                onClick={() => setPrefix(example.symbol)}
                data-testid={`prefix-example-${example.symbol}`}
              >
                <CardContent className="p-3">
                  <div className="text-center mb-2">
                    <span className="text-lg font-bold">{example.symbol}</span>
                  </div>
                  <div className="text-xs space-y-1">
                    {example.commands.slice(0, 2).map(cmd => (
                      <code key={cmd} className="block text-muted-foreground">{cmd}</code>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>

        <Separator />

        {/* Feature Toggles */}
        <div className="space-y-4">
          <Label className="text-sm font-medium">Bot Features</Label>
          
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <MessageCircle className="h-4 w-4" />
              <div className="grid gap-1.5">
                <Label htmlFor="level-messages" className="text-sm">Level Up Messages</Label>
                <p className="text-xs text-muted-foreground">Show announcements when users level up</p>
              </div>
            </div>
            <Switch
              id="level-messages"
              data-testid="switch-level-messages"
              checked={levelUpMessages}
              onCheckedChange={setLevelUpMessages}
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Coins className="h-4 w-4" />
              <div className="grid gap-1.5">
                <Label htmlFor="economy" className="text-sm">Economy System</Label>
                <p className="text-xs text-muted-foreground">Enable coins, daily rewards, and economy commands</p>
              </div>
            </div>
            <Switch
              id="economy"
              data-testid="switch-economy"
              checked={economyEnabled}
              onCheckedChange={setEconomyEnabled}
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Shield className="h-4 w-4" />
              <div className="grid gap-1.5">
                <Label htmlFor="anti-raid" className="text-sm">Anti-Raid Protection</Label>
                <p className="text-xs text-muted-foreground">Automatic detection and response to raids</p>
              </div>
            </div>
            <Switch
              id="anti-raid"
              data-testid="switch-anti-raid"
              checked={antiRaidEnabled}
              onCheckedChange={setAntiRaidEnabled}
            />
          </div>
        </div>

        <Separator />

        {/* Save Button */}
        <div className="flex justify-end">
          <Button 
            onClick={handleSave} 
            disabled={updateConfigMutation.isPending}
            data-testid="button-save-config"
            size="lg"
          >
            {updateConfigMutation.isPending ? 'Saving...' : 'Save Configuration'}
          </Button>
        </div>

        {/* Command Reference */}
        <div className="mt-6 p-4 bg-muted/30 rounded-md">
          <h4 className="text-sm font-medium mb-2">Available Commands:</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div>
              <p className="font-medium text-muted-foreground mb-1">💰 Economy:</p>
              <div className="space-y-1 font-mono text-xs">
                <div><code>{prefix}bal</code> - Check balance</div>
                <div><code>{prefix}daily</code> - Daily reward</div>
                <div><code>{prefix}dep all</code> - Deposit coins</div>
                <div><code>{prefix}with 100</code> - Withdraw coins</div>
              </div>
            </div>
            <div>
              <p className="font-medium text-muted-foreground mb-1">📊 Levels:</p>
              <div className="space-y-1 font-mono text-xs">
                <div><code>{prefix}lv</code> - Check level</div>
                <div><code>{prefix}lb</code> - Leaderboard</div>
                <div><code>{prefix}rank</code> - Server rank</div>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}