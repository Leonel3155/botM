import { useQuery } from "@tanstack/react-query";
import Layout from "@/components/layout";
import FeaturePanel from "@/components/feature-panel";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Coins, TrendingUp, Users, DollarSign, Wallet, CreditCard } from "lucide-react";

export default function Economy() {
  const { data: economyStats, isLoading } = useQuery({
    queryKey: ['/api/economy/123456789012345678/stats'],
    staleTime: 60000,
  });

  const { data: guildSettings } = useQuery({
    queryKey: ['/api/guilds/123456789012345678'],
    staleTime: 300000,
  });

  if (isLoading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64">
          <div className="text-discord-muted">Loading economy system...</div>
        </div>
      </Layout>
    );
  }

  const economySettings = guildSettings?.settings?.economy || {
    enabled: true,
    dailyReward: 500,
    workCooldown: 4,
    currency: "coins"
  };

  return (
    <Layout>
      <div className="space-y-8">
        {/* Configuration Panel */}
        <FeaturePanel
          title="Economy Configuration"
          description="Configure rewards, cooldowns, and currency settings"
          status={economySettings.enabled ? "active" : "inactive"}
          statusText={economySettings.enabled ? "Enabled" : "Disabled"}
          data-testid="panel-economy-config"
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <label className="text-white font-medium">Enable Economy</label>
                  <p className="text-discord-muted text-sm">Allow users to earn and spend currency</p>
                </div>
                <Switch 
                  defaultChecked={economySettings.enabled} 
                  data-testid="switch-economy-enabled" 
                />
              </div>

              <div className="space-y-2">
                <label className="text-white font-medium">Currency Name</label>
                <Input 
                  defaultValue={economySettings.currency} 
                  className="discord-input"
                  data-testid="input-currency-name"
                />
              </div>

              <div className="space-y-2">
                <label className="text-white font-medium">Daily Reward</label>
                <p className="text-discord-muted text-sm">Amount users get for daily command</p>
                <Input 
                  type="number"
                  defaultValue={economySettings.dailyReward} 
                  className="discord-input"
                  data-testid="input-daily-reward"
                />
              </div>

              <div className="space-y-2">
                <label className="text-white font-medium">Work Cooldown (hours)</label>
                <p className="text-discord-muted text-sm">Time between work commands</p>
                <Input 
                  type="number"
                  defaultValue={economySettings.workCooldown} 
                  className="discord-input"
                  data-testid="input-work-cooldown"
                />
              </div>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-white font-medium">Work Rewards Range</label>
                <p className="text-discord-muted text-sm">Min and max earnings from work</p>
                <div className="grid grid-cols-2 gap-2">
                  <Input 
                    type="number"
                    placeholder="Min" 
                    defaultValue="150"
                    className="discord-input"
                    data-testid="input-work-min"
                  />
                  <Input 
                    type="number"
                    placeholder="Max" 
                    defaultValue="500"
                    className="discord-input"
                    data-testid="input-work-max"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-white font-medium">Starting Balance</label>
                <p className="text-discord-muted text-sm">Amount new users start with</p>
                <Input 
                  type="number"
                  defaultValue="1000" 
                  className="discord-input"
                  data-testid="input-starting-balance"
                />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <label className="text-white font-medium">Enable Gambling</label>
                  <p className="text-discord-muted text-sm">Allow users to gamble their currency</p>
                </div>
                <Switch defaultChecked data-testid="switch-gambling-enabled" />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <label className="text-white font-medium">Enable Bank</label>
                  <p className="text-discord-muted text-sm">Allow users to store currency safely</p>
                </div>
                <Switch defaultChecked data-testid="switch-bank-enabled" />
              </div>
            </div>
          </div>

          <div className="mt-6 pt-6 border-t border-discord-grey">
            <div className="flex space-x-4">
              <Button className="discord-button" data-testid="button-save-economy-settings">
                Save Settings
              </Button>
              <Button variant="outline" data-testid="button-reset-economy-settings">
                Reset to Defaults
              </Button>
            </div>
          </div>
        </FeaturePanel>

        {/* Economy Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <Card className="discord-card p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-discord-muted text-sm font-medium">Total Users</p>
                <p className="text-2xl font-bold text-white mt-1" data-testid="text-total-economy-users">
                  1,248
                </p>
              </div>
              <Users className="w-8 h-8 text-discord-primary" />
            </div>
          </Card>

          <Card className="discord-card p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-discord-muted text-sm font-medium">Coins in Circulation</p>
                <p className="text-2xl font-bold text-white mt-1" data-testid="text-total-circulation">
                  2.4M
                </p>
              </div>
              <Coins className="w-8 h-8 text-discord-warning" />
            </div>
          </Card>

          <Card className="discord-card p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-discord-muted text-sm font-medium">Daily Claims</p>
                <p className="text-2xl font-bold text-white mt-1" data-testid="text-daily-claims">
                  432
                </p>
              </div>
              <DollarSign className="w-8 h-8 text-discord-success" />
            </div>
          </Card>

          <Card className="discord-card p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-discord-muted text-sm font-medium">Active Traders</p>
                <p className="text-2xl font-bold text-white mt-1" data-testid="text-active-traders">
                  89
                </p>
              </div>
              <TrendingUp className="w-8 h-8 text-discord-error" />
            </div>
          </Card>
        </div>

        {/* Rich List and Transactions */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Rich List */}
          <Card className="discord-card">
            <div className="p-6 border-b border-discord-grey">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <Wallet className="w-6 h-6 text-discord-warning" />
                  <h3 className="text-lg font-semibold text-white">Richest Users</h3>
                </div>
                <Button variant="outline" size="sm" data-testid="button-refresh-richlist">
                  Refresh
                </Button>
              </div>
            </div>
            <div className="p-6">
              <div className="space-y-4">
                {[1, 2, 3, 4, 5].map((index) => (
                  <div 
                    key={index} 
                    className="flex items-center justify-between p-4 bg-discord-grey rounded-lg"
                    data-testid={`row-richlist-${index}`}
                  >
                    <div className="flex items-center space-x-4">
                      <span className="text-lg font-bold text-discord-warning">#{index}</span>
                      <img 
                        src={`https://images.unsplash.com/photo-${1500000000000 + index}-rich?ixlib=rb-4.0.3&auto=format&fit=crop&w=40&h=40`}
                        alt="User Avatar" 
                        className="w-10 h-10 rounded-full"
                      />
                      <div>
                        <p className="text-white font-medium" data-testid={`text-rich-user-${index}`}>
                          Rich User #{index}
                        </p>
                        <p className="text-discord-muted text-sm">
                          Level {20 + index}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-discord-warning font-bold" data-testid={`text-rich-balance-${index}`}>
                        {(50000 - index * 5000).toLocaleString()} coins
                      </p>
                      <p className="text-discord-muted text-sm">
                        Bank: {(25000 - index * 2500).toLocaleString()}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </Card>

          {/* Recent Transactions */}
          <Card className="discord-card">
            <div className="p-6 border-b border-discord-grey">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <CreditCard className="w-6 h-6 text-discord-success" />
                  <h3 className="text-lg font-semibold text-white">Recent Transactions</h3>
                </div>
                <Button variant="outline" size="sm" data-testid="button-view-all-transactions">
                  View All
                </Button>
              </div>
            </div>
            <div className="p-6">
              <div className="space-y-4">
                {[
                  { type: "daily", user: "User #1234", amount: 500, time: "2m ago" },
                  { type: "work", user: "User #5678", amount: 350, time: "5m ago" },
                  { type: "gamble", user: "User #9012", amount: -750, time: "8m ago" },
                  { type: "transfer", user: "User #3456", amount: 1000, time: "12m ago" },
                  { type: "daily", user: "User #7890", amount: 500, time: "15m ago" }
                ].map((transaction, index) => (
                  <div 
                    key={index} 
                    className="flex items-center justify-between p-3 bg-discord-grey rounded-lg"
                    data-testid={`row-transaction-${index}`}
                  >
                    <div className="flex items-center space-x-3">
                      <Badge 
                        variant={transaction.amount > 0 ? "default" : "destructive"}
                        className="capitalize"
                      >
                        {transaction.type}
                      </Badge>
                      <div>
                        <p className="text-white text-sm" data-testid={`text-transaction-user-${index}`}>
                          {transaction.user}
                        </p>
                        <p className="text-discord-muted text-xs" data-testid={`text-transaction-time-${index}`}>
                          {transaction.time}
                        </p>
                      </div>
                    </div>
                    <p 
                      className={`font-bold ${
                        transaction.amount > 0 ? 'text-discord-success' : 'text-discord-error'
                      }`}
                      data-testid={`text-transaction-amount-${index}`}
                    >
                      {transaction.amount > 0 ? '+' : ''}{transaction.amount.toLocaleString()} coins
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </Card>
        </div>

        {/* Economy Commands */}
        <Card className="discord-card">
          <div className="p-6 border-b border-discord-grey">
            <h3 className="text-lg font-semibold text-white">Available Commands</h3>
            <p className="text-discord-muted text-sm mt-1">Commands users can use in your server</p>
          </div>
          <div className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {[
                { command: "/balance", description: "Check your current balance" },
                { command: "/daily", description: "Claim your daily reward" },
                { command: "/work", description: "Work to earn coins" },
                { command: "/gamble", description: "Gamble your coins for more" },
                { command: "/pay", description: "Transfer coins to another user" },
                { command: "/shop", description: "Browse items to purchase" }
              ].map((cmd, index) => (
                <div 
                  key={index} 
                  className="p-4 bg-discord-grey rounded-lg"
                  data-testid={`card-command-${index}`}
                >
                  <code className="text-discord-primary font-mono" data-testid={`text-command-${index}`}>
                    {cmd.command}
                  </code>
                  <p className="text-discord-muted text-sm mt-1" data-testid={`text-command-desc-${index}`}>
                    {cmd.description}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </Card>
      </div>
    </Layout>
  );
}
