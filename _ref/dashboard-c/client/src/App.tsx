import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Badge } from "@/components/ui/badge";
import { AppSidebar } from "@/components/app-sidebar";
import Overview from "@/pages/overview";
import Security from "@/pages/security";
import Analytics from "@/pages/analytics";
import Servers from "@/pages/servers";
import Moderation from "@/pages/moderation";
import Settings from "@/pages/settings";
import Login from "@/pages/login";
import NotFound from "@/pages/not-found";

function DashboardLayout({ children }: { children: React.ReactNode }) {
  const style = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  };

  return (
    <SidebarProvider style={style as React.CSSProperties}>
      <div className="flex h-screen w-full">
        <AppSidebar />
        <div className="flex flex-col flex-1 overflow-hidden">
          <header className="flex items-center justify-between px-6 py-4 border-b border-border bg-card">
            <SidebarTrigger data-testid="button-sidebar-toggle" />
          </header>
          <main className="flex-1 overflow-y-auto bg-background">
            {children}
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}

function Router() {
  return (
    <Switch>
      {/* Login page standalone - no dashboard layout */}
      <Route path="/login" component={Login} />
      
      {/* Protected dashboard routes */}
      <Route path="/">
        <DashboardLayout>
          <Overview />
        </DashboardLayout>
      </Route>
      <Route path="/security">
        <DashboardLayout>
          <Security />
        </DashboardLayout>
      </Route>
      <Route path="/analytics">
        <DashboardLayout>
          <Analytics />
        </DashboardLayout>
      </Route>
      <Route path="/servers">
        <DashboardLayout>
          <Servers />
        </DashboardLayout>
      </Route>
      <Route path="/moderation">
        <DashboardLayout>
          <Moderation />
        </DashboardLayout>
      </Route>
      <Route path="/activity">
        <DashboardLayout>
          <div className="p-8">
            <h1 className="text-3xl font-bold text-foreground mb-2">Activity</h1>
            <p className="text-muted-foreground">Coming soon...</p>
          </div>
        </DashboardLayout>
      </Route>
      <Route path="/settings">
        <DashboardLayout>
          <Settings />
        </DashboardLayout>
      </Route>
      
      {/* 404 */}
      <Route component={NotFound} />
    </Switch>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
