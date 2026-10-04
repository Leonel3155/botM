import { Switch, Route, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import sessionManager from "@/lib/sessionManager";
import { useEffect } from "react";
import Dashboard from "@/pages/dashboard";

// Mini componente Redirect compatible con wouter
function Redirect({ to, replace = false }: { to: string; replace?: boolean }) {
  const [, setLocation] = useLocation();
  useEffect(() => { setLocation(to, { replace }); }, [to, replace, setLocation]);
  return null;
}

import Levels from "@/pages/levels";
import Economy from "@/pages/economy";
import Moderation from "@/pages/moderation";
import Social from "@/pages/social";
import AntiRaid from "@/pages/antiraid";
import Protection from "@/pages/protection";
import CustomCommands from "@/pages/custom-commands";
import Channels from "@/pages/channels";
import NotFound from "@/pages/not-found";

function Router() {
  return (
    <Switch>
      {/* Dashboard principal */}
      <Route path="/" component={Dashboard} />
      <Route path="/dashboard" component={Dashboard} />
      
      {/* Redirecciones del viejo test */}
      <Route path="/test">
        <Redirect to="/dashboard" replace />
      </Route>
      <Route path="/test-dashboard">
        <Redirect to="/dashboard" replace />
      </Route>
      
      {/* Páginas funcionales */}
      <Route path="/levels" component={Levels} />
      <Route path="/economy" component={Economy} />
      <Route path="/moderation" component={Moderation} />
      <Route path="/social" component={Social} />
      <Route path="/antiraid" component={AntiRaid} />
      <Route path="/protection" component={Protection} />
      <Route path="/custom-commands" component={CustomCommands} />
      <Route path="/channels" component={Channels} />
      
      {/* Catch-all a dashboard (SPA fallback) */}
      <Route>
        <Redirect to="/dashboard" replace />
      </Route>
    </Switch>
  );
}

function App() {
  useEffect(() => {
    // Initialize session manager to handle automatic session renewal
    console.log('[SESSION-MANAGER] Initializing session management');

    // Force a session check on app startup
    sessionManager.checkAuthStatus().then(status => {
      console.log('[SESSION-MANAGER] Initial auth status:', status);
    });

    // Cleanup on unmount
    return () => {
      sessionManager.destroy();
    };
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <div className="dark">
          <Toaster />
          <Router />
        </div>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;