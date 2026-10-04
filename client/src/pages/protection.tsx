import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Shield, Lock, Users, AlertTriangle, Plus, Trash2, Settings } from 'lucide-react';
import Layout from '@/components/layout';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';

// Respuesta de GET /api/protection/:guildId/settings
interface ProtectionSettings {
  lockdownEnabled: boolean;
  lockdownReason: string;
  autoRoles: { id: string; name: string; roleId: string; enabled: boolean }[];
  reactionRoles: {
    id: string;
    messageId: string;
    channelId: string;
    title: string;
    description: string;
    reactions: { emoji: string; roleId: string; roleName: string }[];
  }[];
  nsfwChannels: string[];
  massRoleHistory: unknown[];
}

export default function ProtectionPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const guildId = '123456789012345678';

  // El queryFn por defecto une la queryKey: /api/protection/{guildId}/settings
  const { data: settings, isLoading } = useQuery<ProtectionSettings>({
    queryKey: ['/api/protection', guildId, 'settings'],
  });

  const lockdownMutation = useMutation({
    mutationFn: (data: { enabled: boolean; reason?: string }) =>
      apiRequest('POST', `/api/protection/${guildId}/lockdown`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/protection', guildId] });
      toast({ title: 'Lockdown updated successfully' });
    },
    onError: () => {
      toast({ title: 'Failed to update lockdown', variant: 'destructive' });
    }
  });

  if (isLoading) {
    return (
      <Layout>
        <div className="flex items-center justify-center min-h-screen">
          <div className="text-lg">Loading protection settings...</div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Server Protection</h1>
            <p className="text-muted-foreground">
              Manage server security, roles, and protection features
            </p>
          </div>
          <Badge variant="outline" className="px-3 py-1">
            <Shield className="h-4 w-4 mr-2" />
            Protection Active
          </Badge>
        </div>

        {/* Server Lockdown */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Lock className="h-5 w-5" />
              Server Lockdown
            </CardTitle>
            <CardDescription>
              Emergency lockdown prevents @everyone from sending messages
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Lockdown Status</p>
                <p className="text-sm text-muted-foreground">
                  {settings?.lockdownEnabled ? 'Server is currently locked down' : 'Server is open for normal activity'}
                </p>
              </div>
              <Switch 
                checked={settings?.lockdownEnabled || false} 
                onCheckedChange={(enabled) => {
                  lockdownMutation.mutate({ enabled });
                }}
                data-testid="switch-lockdown"
              />
            </div>
            {settings?.lockdownEnabled && (
              <div className="p-4 border border-destructive/20 bg-destructive/5 rounded-lg">
                <div className="flex items-center gap-2 text-destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <span className="font-medium">Lockdown Active</span>
                </div>
                <p className="text-sm mt-1">Only staff members can send messages</p>
                <Input 
                  placeholder="Reason for lockdown..."
                  className="mt-2"
                  data-testid="input-lockdown-reason"
                />
              </div>
            )}
          </CardContent>
        </Card>

        {/* Automatic Roles */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Automatic Roles
            </CardTitle>
            <CardDescription>
              Roles automatically assigned to new members
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-3">
              {settings?.autoRoles?.map((role) => (
                <div key={role.id} className="flex items-center justify-between p-3 border rounded-lg">
                  <div className="flex items-center gap-3">
                    <div 
                      className="w-4 h-4 rounded-full bg-blue-500" 
                    />
                    <span className="font-medium">{role.name}</span>
                    <Badge variant={role.enabled ? "default" : "secondary"}>
                      {role.enabled ? "Active" : "Inactive"}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch 
                      checked={role.enabled}
                      onCheckedChange={(checked) => {
                        toast({ title: `Auto role ${checked ? 'enabled' : 'disabled'}` });
                      }}
                      data-testid={`switch-autorole-${role.id}`}
                    />
                    <Button variant="ghost" size="sm" data-testid={`button-remove-autorole-${role.id}`}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
            <Button variant="outline" className="w-full" data-testid="button-add-autorole">
              <Plus className="h-4 w-4 mr-2" />
              Add Auto Role
            </Button>
          </CardContent>
        </Card>

        {/* Reaction Roles */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Settings className="h-5 w-5" />
              Reaction Roles
            </CardTitle>
            <CardDescription>
              Users get roles by reacting to messages
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-4">
              {settings?.reactionRoles?.map((reactionRole) => (
                <div key={reactionRole.id} className="border rounded-lg p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <p className="font-medium">{reactionRole.title}</p>
                      <p className="text-sm text-muted-foreground">Channel: #{reactionRole.channelId}</p>
                    </div>
                    <Button variant="ghost" size="sm" data-testid={`button-remove-reaction-role-${reactionRole.id}`}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {reactionRole.reactions?.map((reaction, index) => (
                      <div key={index} className="flex items-center gap-1">
                        <span className="text-xl">{reaction.emoji}</span>
                        <span className="text-sm">→</span>
                        <Badge variant="secondary">{reaction.roleName}</Badge>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            
            <div className="space-y-4 p-4 border rounded-lg bg-muted/5">
              <h4 className="font-medium">Create New Reaction Role</h4>
              <div className="grid grid-cols-2 gap-4">
                <Input placeholder="Message title..." data-testid="input-reaction-title" />
                <Input placeholder="Emoji (🎮)" data-testid="input-reaction-emoji" />
              </div>
              <Textarea placeholder="Description for the reaction role message..." data-testid="textarea-reaction-description" />
              <Select>
                <SelectTrigger data-testid="select-reaction-role">
                  <SelectValue placeholder="Select role to assign" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="gamer">Gamer</SelectItem>
                  <SelectItem value="music">Music Lover</SelectItem>
                  <SelectItem value="art">Artist</SelectItem>
                </SelectContent>
              </Select>
              <Button className="w-full" data-testid="button-create-reaction-role">
                <Plus className="h-4 w-4 mr-2" />
                Create Reaction Role
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* NSFW Channel Management */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" />
              NSFW Channels
            </CardTitle>
            <CardDescription>
              Manage age-restricted content channels
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Current Channel</label>
                <Select>
                  <SelectTrigger data-testid="select-nsfw-channel">
                    <SelectValue placeholder="Select channel" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="general">#general</SelectItem>
                    <SelectItem value="chat">#chat</SelectItem>
                    <SelectItem value="nsfw">#nsfw-content</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Action</label>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" data-testid="button-nsfw-enable">
                    Enable NSFW
                  </Button>
                  <Button variant="outline" size="sm" data-testid="button-nsfw-disable">
                    Disable NSFW
                  </Button>
                </div>
              </div>
            </div>
            
            <div className="p-3 bg-muted/50 rounded-lg">
              <div className="flex items-center gap-2 text-sm">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
                <span>NSFW channels require age verification and show content warnings</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Mass Role Management */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Mass Role Management
            </CardTitle>
            <CardDescription>
              Add or remove roles from multiple users at once
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <Select>
                <SelectTrigger data-testid="select-mass-role-action">
                  <SelectValue placeholder="Action" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="add">Add Role</SelectItem>
                  <SelectItem value="remove">Remove Role</SelectItem>
                </SelectContent>
              </Select>
              <Select>
                <SelectTrigger data-testid="select-mass-role-target">
                  <SelectValue placeholder="Target Role" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="member">Member</SelectItem>
                  <SelectItem value="verified">Verified</SelectItem>
                  <SelectItem value="vip">VIP</SelectItem>
                </SelectContent>
              </Select>
              <Select>
                <SelectTrigger data-testid="select-mass-role-filter">
                  <SelectValue placeholder="Filter by role (optional)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Members</SelectItem>
                  <SelectItem value="active">Active Members</SelectItem>
                  <SelectItem value="new">New Members</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button className="w-full" variant="destructive" data-testid="button-mass-role-execute">
              Execute Mass Role Change
            </Button>
            <p className="text-xs text-muted-foreground">
              This action will affect multiple users. Use with caution.
            </p>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}