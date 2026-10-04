import { useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQuery } from "@tanstack/react-query";

interface Guild {
  id: string;
  name: string;
  icon: string | null;
}

interface GuildSelectorProps {
  currentGuildId: string;
  onGuildChange: (guildId: string) => void;
}

export default function GuildSelector({ currentGuildId, onGuildChange }: GuildSelectorProps) {
  const { data: guilds, isLoading, error } = useQuery<Guild[]>({
    queryKey: ['/api/user/guilds'],
    staleTime: 300000, // 5 minutes
    retry: false,
  });

  // Don't render if there's an auth error
  if ((error as any)?.response?.status === 401) {
    return null;
  }

  const currentGuild = guilds?.find(g => g.id === currentGuildId);

  if (isLoading) {
    return (
      <div className="flex items-center space-x-3 mb-6">
        <div className="text-sm text-discord-muted">Loading servers...</div>
      </div>
    );
  }

  return (
    <div className="flex items-center space-x-3 mb-6">
      <div className="text-sm text-discord-muted">Server:</div>
      <Select value={currentGuildId} onValueChange={onGuildChange}>
        <SelectTrigger className="w-64 bg-discord-dark border-discord-grey" data-testid="select-guild">
          <SelectValue>
            <div className="flex items-center space-x-2">
              {currentGuild?.icon ? (
                <img 
                  src={`https://cdn.discordapp.com/icons/${currentGuild.id}/${currentGuild.icon}.png?size=32`}
                  alt={currentGuild.name}
                  className="w-5 h-5 rounded-full"
                />
              ) : (
                <div className="w-5 h-5 bg-discord-primary rounded-full flex items-center justify-center text-xs font-medium">
                  {currentGuild?.name?.charAt(0) || "?"}
                </div>
              )}
              <span className="text-white">{currentGuild?.name || "Select Server"}</span>
            </div>
          </SelectValue>
        </SelectTrigger>
        <SelectContent className="bg-discord-dark border-discord-grey">
          {guilds?.map((guild) => (
            <SelectItem key={guild.id} value={guild.id} className="hover:bg-discord-grey focus:bg-discord-grey">
              <div className="flex items-center space-x-2">
                {guild.icon ? (
                  <img 
                    src={`https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=32`}
                    alt={guild.name}
                    className="w-5 h-5 rounded-full"
                  />
                ) : (
                  <div className="w-5 h-5 bg-discord-primary rounded-full flex items-center justify-center text-xs font-medium text-white">
                    {guild.name.charAt(0)}
                  </div>
                )}
                <span className="text-white">{guild.name}</span>
              </div>
            </SelectItem>
          )) || (
            <SelectItem value="loading" disabled>
              <span className="text-discord-muted">Loading servers...</span>
            </SelectItem>
          )}
        </SelectContent>
      </Select>
    </div>
  );
}