import { lazy, Suspense, useEffect, useRef, useState, type ComponentType } from "react";
import { Redirect, Route, Switch, useLocation } from "wouter";
import { QueryClientProvider } from "@tanstack/react-query";
import { Bot, Loader2 } from "lucide-react";
import { queryClient } from "./lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppShell, PageSkeleton, RequireGuild } from "@/components/app-shell";
import { ApiErrorState } from "@/components/api-error-state";
import { ErrorBoundary } from "@/components/error-boundary";
import { useToast } from "@/hooks/use-toast";
import { takeReturnTo, useAuthStatus } from "@/lib/auth";
import { GuildProvider } from "@/lib/guild";

import Login from "@/pages/login";
import Resumen from "@/pages/resumen";
import Servidores from "@/pages/servidores";
import NotFound from "@/pages/not-found";

// El resto de secciones se descargan al abrirlas (el panel carga más rápido en el móvil)
const Estadisticas = lazy(() => import("@/pages/estadisticas"));
const Comunidad = lazy(() => import("@/pages/comunidad"));
const Ajustes = lazy(() => import("@/pages/ajustes"));
const Seguridad = lazy(() => import("@/pages/seguridad"));
const Levels = lazy(() => import("@/pages/levels"));
const Economy = lazy(() => import("@/pages/economy"));
const Moderation = lazy(() => import("@/pages/moderation"));
const Social = lazy(() => import("@/pages/social"));
const CustomCommands = lazy(() => import("@/pages/custom-commands"));
const Channels = lazy(() => import("@/pages/channels"));

// Páginas de un servidor: solo se muestran con un servidor elegido
const GUILD_ROUTES: { path: string; component: ComponentType }[] = [
  { path: "/", component: Resumen },
  { path: "/estadisticas", component: Estadisticas },
  { path: "/comunidad", component: Comunidad },
  { path: "/niveles", component: Levels },
  { path: "/economia", component: Economy },
  { path: "/moderacion", component: Moderation },
  // Seguridad: "Próximamente" hasta rehacerla. antiraid.tsx y protection.tsx mostraban
  // números y eventos inventados, así que no se enlazan.
  { path: "/seguridad", component: Seguridad },
  { path: "/comandos", component: CustomCommands },
  { path: "/canales", component: Channels },
  { path: "/redes", component: Social },
  { path: "/ajustes", component: Ajustes },
];

// Rutas antiguas en inglés → nuevas en español (enlaces guardados siguen funcionando)
const LEGACY_REDIRECTS: [from: string, to: string][] = [
  ["/dashboard", "/"],
  ["/levels", "/niveles"],
  ["/economy", "/economia"],
  ["/moderation", "/moderacion"],
  ["/antiraid", "/seguridad"],
  ["/protection", "/seguridad"],
  ["/security", "/seguridad"],
  ["/custom-commands", "/comandos"],
  ["/channels", "/canales"],
  ["/social", "/redes"],
  ["/settings", "/ajustes"],
  ["/servers", "/servidores"],
];

function Router() {
  const [location] = useLocation();
  // Si una sección falla (descarga o dibujo), el menú sigue usable y al cambiar de ruta se reintenta
  return (
    <ErrorBoundary resetKey={location}>
      <Suspense fallback={<PageSkeleton />}>
        <Routes />
      </Suspense>
    </ErrorBoundary>
  );
}

function Routes() {
  return (
    <Switch>
      {GUILD_ROUTES.map(({ path, component: Page }) => (
        <Route key={path} path={path}>
          <RequireGuild>
            <Page />
          </RequireGuild>
        </Route>
      ))}
      <Route path="/servidores" component={Servidores} />
      {LEGACY_REDIRECTS.map(([from, to]) => (
        <Route key={from} path={from}>
          <Redirect to={to} replace />
        </Route>
      ))}
      <Route component={NotFound} />
    </Switch>
  );
}

/** Lee una sola vez ?error= y ?auth= (vuelta del login de Discord) y los quita de la URL. */
function useOAuthReturnParams() {
  const [params] = useState(() => {
    const search = new URLSearchParams(window.location.search);
    return { error: search.get("error"), auth: search.get("auth") };
  });

  useEffect(() => {
    if (!params.error && !params.auth) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("error");
    url.searchParams.delete("auth");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }, [params]);

  return params;
}

function FullScreenLoader() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-4 bg-background" aria-busy="true">
      <div className="flex h-12 w-12 items-center justify-center rounded-md bg-primary">
        <Bot className="h-7 w-7 text-primary-foreground" aria-hidden="true" />
      </div>
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin text-primary" />
        Cargando el panel…
      </div>
    </div>
  );
}

/** Sin sesión → login. Con sesión → panel completo (servidores, menú, tiempo real). */
function AuthGate() {
  const { data: auth, isLoading, error, refetch } = useAuthStatus();
  const oauth = useOAuthReturnParams();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const handledReturn = useRef(false);

  const authenticated = auth?.authenticated === true;

  // Recién llegados del login: volver a la página donde estaban
  useEffect(() => {
    if (!authenticated || handledReturn.current) return;
    handledReturn.current = true;
    if (oauth.auth) {
      const returnTo = takeReturnTo();
      if (returnTo) navigate(returnTo, { replace: true });
    } else if (oauth.error) {
      // Ya había una sesión abierta pero el nuevo intento falló: lo avisamos sin echarle del panel
      toast({
        variant: "destructive",
        title: "No se pudo completar el inicio de sesión",
        description: "Sigues con tu sesión anterior.",
      });
    }
  }, [authenticated, oauth, navigate, toast]);

  if (isLoading) return <FullScreenLoader />;

  if (!auth) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-background p-4">
        <ApiErrorState error={error} onRetry={() => void refetch()} className="w-full max-w-lg" />
      </div>
    );
  }

  if (!authenticated) {
    const expired = auth.reason === "expired";
    return <Login errorCode={expired ? null : oauth.error} sessionExpired={expired} />;
  }

  return (
    <GuildProvider>
      <AppShell>
        <Router />
      </AppShell>
    </GuildProvider>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <ErrorBoundary variant="fullscreen">
          <AuthGate />
        </ErrorBoundary>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
