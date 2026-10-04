import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { 
  BarChart3, 
  Coins, 
  Shield, 
  Lock, 
  Share2, 
  Music, 
  Terminal, 
  Settings, 
  LayoutDashboard,
  LogOut,
  ChevronDown,
  Gavel,
  Hash
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  currentGuild: string;
  onGuildChange: (guildId: string) => void;
}

const navigation = [
  { name: "Dashboard", href: "/", icon: LayoutDashboard },
  { name: "Level System", href: "/levels", icon: BarChart3 },
  { name: "Economy", href: "/economy", icon: Coins },
  { name: "Moderation", href: "/moderation", icon: Gavel },
  { name: "Anti-Raid", href: "/antiraid", icon: Lock },
  { name: "Protection", href: "/protection", icon: Shield },
  { name: "Social Content", href: "/social", icon: Share2 },
  { name: "Channel Setup", href: "/channels", icon: Hash },
  { name: "Custom Commands", href: "/custom-commands", icon: Terminal },
  { name: "Settings", href: "/settings", icon: Settings },
];

const mockGuilds = [
  { id: "123456789012345678", name: "Awesome Gaming Server" },
  { id: "234567890123456789", name: "Coding Community" },
  { id: "345678901234567890", name: "Music Lovers Hub" },
];

export default function Sidebar({ isOpen, onClose, currentGuild, onGuildChange }: SidebarProps) {
  const [location] = useLocation();

  const handleLinkClick = () => {
    onClose();
  };

  return (
    <div 
      className={cn(
        "fixed lg:static inset-y-0 left-0 z-50 w-64 bg-discord-dark border-r border-discord-grey transform transition-transform duration-300 ease-in-out",
        isOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
      )}
    >
      <div className="flex flex-col h-full">
        {/* Bot Info Header */}
        <div className="p-4 border-b border-discord-grey">
          <div className="flex items-center space-x-3">
            <img 
              src="https://images.unsplash.com/photo-1614680376573-df3480f0c6ff?ixlib=rb-4.0.3&auto=format&fit=crop&w=64&h=64" 
              alt="Bot Avatar" 
              className="w-10 h-10 rounded-full"
            />
            <div>
              <h2 className="font-semibold text-white" data-testid="text-bot-name">
                UltraBot Pro
              </h2>
              <p className="text-sm text-discord-muted">Online</p>
            </div>
          </div>
        </div>

        {/* Server Selection */}
        <div className="p-4 border-b border-discord-grey">
          <label className="text-sm font-medium text-discord-light-grey mb-2 block">
            Current Server
          </label>
          <Select value={currentGuild} onValueChange={onGuildChange}>
            <SelectTrigger className="w-full bg-discord-grey border-discord-grey text-white">
              <SelectValue data-testid="select-guild" />
            </SelectTrigger>
            <SelectContent className="bg-discord-grey border-discord-grey">
              {mockGuilds.map((guild) => (
                <SelectItem 
                  key={guild.id} 
                  value={guild.id}
                  className="text-white hover:bg-discord-dark focus:bg-discord-dark"
                >
                  {guild.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Navigation Menu */}
        <nav className="flex-1 p-4 space-y-2 overflow-y-auto">
          {navigation.map((item) => {
            const Icon = item.icon;
            const isActive = location === item.href;

            return (
              <Link key={item.name} href={item.href}>
                <div 
                  className={cn(
                    "nav-item text-discord-light-grey hover:bg-discord-grey hover:text-white cursor-pointer",
                    isActive && "active bg-discord-primary text-white"
                  )}
                  onClick={handleLinkClick}
                  data-testid={`link-nav-${item.name.toLowerCase().replace(/\s+/g, '-')}`}
                >
                  <Icon className="w-5 h-5" />
                  <span>{item.name}</span>
                </div>
              </Link>
            );
          })}
        </nav>

        {/* User Profile Footer */}
        <div className="p-4 border-t border-discord-grey">
          <div className="flex items-center space-x-3">
            <img 
              src="https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?ixlib=rb-4.0.3&auto=format&fit=crop&w=40&h=40" 
              alt="User Avatar" 
              className="w-8 h-8 rounded-full"
            />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white truncate" data-testid="text-user-name">
                Admin User
              </p>
              <p className="text-xs text-discord-muted truncate" data-testid="text-user-tag">
                #1234
              </p>
            </div>
            <Button 
              variant="ghost" 
              size="icon"
              className="text-discord-muted hover:text-white"
              data-testid="button-logout"
            >
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}