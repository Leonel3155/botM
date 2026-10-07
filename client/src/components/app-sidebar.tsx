import { useEffect } from "react";
import { Bot, Loader2, LogOut } from "lucide-react";
import { Link, useLocation } from "wouter";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ServerSwitcher } from "@/components/server-switcher";
import { useToast } from "@/hooks/use-toast";
import { displayName, initials, useAuthStatus, useLogout, userAvatarUrl } from "@/lib/auth";
import { findNavItem, NAV_SECTIONS } from "@/lib/navigation";

export function AppSidebar() {
  const [location] = useLocation();
  const { isMobile, setOpenMobile } = useSidebar();
  const { data: auth } = useAuthStatus();
  const logout = useLogout();
  const { toast } = useToast();

  const user = auth?.user ?? null;
  const name = displayName(user);
  const avatarUrl = userAvatarUrl(user);
  const activeHref = findNavItem(location)?.href;

  // En móvil el menú es un panel deslizable: se cierra al navegar (también al tocar la
  // página en la que ya está, que no cambia la ruta)
  const closeOnMobile = () => {
    if (isMobile) setOpenMobile(false);
  };

  // ...y con cualquier otro cambio de ruta: botón "Atrás" del móvil, enlaces de las páginas
  useEffect(() => {
    setOpenMobile(false);
  }, [location, setOpenMobile]);

  const handleLogout = () => {
    logout.mutate(undefined, {
      onError: (error) => {
        toast({
          variant: "destructive",
          title: "No se pudo cerrar la sesión",
          description: error.message,
        });
      },
    });
  };

  return (
    <Sidebar>
      <SidebarHeader className="gap-4 p-4">
        <Link href="/" onClick={closeOnMobile} className="flex items-center gap-3 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary">
            <Bot className="h-6 w-6 text-primary-foreground" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <p className="text-lg font-semibold leading-tight text-sidebar-foreground" data-testid="text-dashboard-title">
              BotM
            </p>
            <p className="text-xs text-muted-foreground">Panel de control</p>
          </div>
          {auth?.devMode && (
            <Badge variant="outline" className="ml-auto font-mono text-[10px]" data-testid="badge-dev-mode">
              DEV
            </Badge>
          )}
        </Link>
        <ServerSwitcher onNavigate={closeOnMobile} />
      </SidebarHeader>

      <SidebarContent>
        {NAV_SECTIONS.map((section) => (
          <SidebarGroup key={section.label}>
            <SidebarGroupLabel className="uppercase tracking-wide">{section.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {section.items.map((item) => (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      asChild
                      isActive={activeHref === item.href}
                      className="relative h-9 rounded-l-none border-l-2 border-transparent pl-3 text-muted-foreground hover:text-sidebar-foreground data-[active=true]:border-primary data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-foreground data-[active=true]:[&>svg]:text-primary"
                      data-testid={`link-nav-${item.href === "/" ? "resumen" : item.href.slice(1)}`}
                    >
                      <Link href={item.href} onClick={closeOnMobile}>
                        <item.icon />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter className="p-4">
        <div className="flex items-center gap-3 rounded-md border border-card-border bg-card p-3">
          <Avatar className="h-8 w-8">
            {avatarUrl && <AvatarImage src={avatarUrl} alt="" />}
            <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">
              {initials(name || "?")}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-foreground" data-testid="text-username">
              {name || "Sesión iniciada"}
            </p>
            {user?.username && user.username !== name && (
              <p className="truncate text-xs text-muted-foreground">@{user.username}</p>
            )}
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={handleLogout}
                disabled={logout.isPending}
                className="rounded-md p-1.5 text-muted-foreground hover-elevate active-elevate-2 hover:text-foreground disabled:opacity-50"
                aria-label="Cerrar sesión"
                data-testid="button-logout"
              >
                {logout.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">Cerrar sesión</TooltipContent>
          </Tooltip>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
