import { Link, useLocation } from "wouter";
import { LayoutDashboard, Shield, Activity, Settings, LogOut, BarChart3, Server, Gavel } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
} from "@/components/ui/sidebar";
import { Badge } from "@/components/ui/badge";
import { isServerMode } from "@/lib/environment";

const menuItems = [
  {
    title: "Overview",
    url: "/",
    icon: LayoutDashboard,
  },
  {
    title: "Security",
    url: "/security",
    icon: Shield,
  },
  {
    title: "Analytics",
    url: "/analytics",
    icon: BarChart3,
  },
  {
    title: "Servers",
    url: "/servers",
    icon: Server,
  },
  {
    title: "Moderation",
    url: "/moderation",
    icon: Gavel,
  },
  {
    title: "Activity",
    url: "/activity",
    icon: Activity,
    badge: "Soon",
  },
  {
    title: "Settings",
    url: "/settings",
    icon: Settings,
  },
];

export function AppSidebar() {
  const [location] = useLocation();

  return (
    <Sidebar>
      <SidebarHeader className="p-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary">
            <Activity className="h-6 w-6 text-primary-foreground" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-foreground" data-testid="text-dashboard-title">
              Bot Dashboard
            </h2>
            <Badge 
              variant="outline" 
              className="text-xs font-mono"
              data-testid="badge-environment-mode"
            >
              {isServerMode() ? "SERVER" : "DEV"}
            </Badge>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {menuItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton 
                    asChild 
                    isActive={location === item.url}
                    data-testid={`link-${item.title.toLowerCase()}`}
                  >
                    <Link href={item.url}>
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                      {item.badge && (
                        <Badge 
                          variant="secondary" 
                          className="ml-auto text-xs"
                        >
                          {item.badge}
                        </Badge>
                      )}
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="p-6">
        <div className="flex items-center gap-3 rounded-md bg-card p-3 border border-card-border">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
            <span className="text-sm font-semibold text-primary">U</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground truncate" data-testid="text-username">
              User
            </p>
            <p className="text-xs text-muted-foreground">Admin</p>
          </div>
          <button 
            className="hover-elevate active-elevate-2 rounded-md p-1.5"
            data-testid="button-logout"
          >
            <LogOut className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
