import { useMemo, useState, type ReactNode } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { CheckCheck, History, Loader2, ShieldCheck } from "lucide-react";
import type { RaidEventItem as RaidEvent, RaidEventsResponse } from "@shared/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ApiErrorState } from "@/components/api-error-state";
import { EmptyState } from "@/components/empty-state";
import { useToast } from "@/hooks/use-toast";
import { useAuthStatus } from "@/lib/auth";
import { apiRequest } from "@/lib/queryClient";
import { ConfirmDialog } from "./confirm-dialog";
import { raidEventsKey } from "./query-keys";
import { RaidEventItem } from "./raid-event-item";
import { useResolveRaidEvent } from "./use-antiraid";
import { describeMutationError, numberFormat, useNow } from "./utils";

const PAGE_SIZE = 10;

type StatusFilter = "all" | "open" | "resolved";

const STATUS_TABS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "Todos" },
  { value: "open", label: "Sin revisar" },
  { value: "resolved", label: "Revisados" },
];

const EMPTY_TEXT: Record<StatusFilter, { title: string; description: string }> = {
  all: {
    title: "Aún no hay raids registrados",
    description:
      "Cuando el bot detecte una entrada masiva de cuentas (con la protección activada), aparecerá aquí con todo lo que hizo para proteger el servidor.",
  },
  open: {
    title: "No hay raids por revisar",
    description: "Todo lo que detectó el bot ya está revisado.",
  },
  resolved: {
    title: "Aún no hay raids revisados",
    description: "Cuando un raid termine o lo marques como revisado, aparecerá aquí.",
  },
};

function isStatusFilter(value: string): value is StatusFilter {
  return value === "all" || value === "open" || value === "resolved";
}

interface RaidEventsTimelineProps {
  guildId: string;
  /** Acciones con sus etiquetas (de GET /antiraid; vacío si aún no llegan) */
  actions: { value: string; label: string }[];
}

/** Historial de raids con filtro por estado, páginas y el botón para marcarlos como revisados. */
export function RaidEventsTimeline({ guildId, actions }: RaidEventsTimelineProps) {
  const { toast } = useToast();
  const now = useNow(30_000);
  const auth = useAuthStatus();
  const currentUserId = auth.data?.user?.id ?? null;
  const [status, setStatus] = useState<StatusFilter>("all");
  const [confirmEvent, setConfirmEvent] = useState<RaidEvent | null>(null);
  const resolve = useResolveRaidEvent(guildId);

  const actionLabels = useMemo(
    () => Object.fromEntries(actions.map((action) => [action.value, action.label])) as Record<string, string>,
    [actions],
  );

  const query = useInfiniteQuery({
    queryKey: [...raidEventsKey(guildId), { status }],
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }): Promise<RaidEventsResponse> => {
      const params = new URLSearchParams({ status, limit: String(PAGE_SIZE) });
      if (pageParam) params.set("before", pageParam);
      const res = await apiRequest("GET", `/api/guilds/${guildId}/raid-events?${params.toString()}`);
      return (await res.json()) as RaidEventsResponse;
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });

  const events = useMemo(() => query.data?.pages.flatMap((page) => page.events) ?? [], [query.data]);

  const doResolve = (event: RaidEvent) => {
    resolve.mutate(event.id, {
      onSuccess: (result) => {
        toast({
          title: "Raid marcado como revisado",
          description: result.liftedRaid
            ? "También terminó el modo raid: la verificación volvió a como estaba y el bot avisó al staff."
            : "Quedó guardado en el historial como revisado.",
        });
      },
      onError: (error) => {
        toast({ variant: "destructive", title: "No se pudo marcar como revisado", description: describeMutationError(error) });
      },
      onSettled: () => setConfirmEvent(null),
    });
  };

  const onResolve = (event: RaidEvent) => {
    // Si es el raid en curso, marcarlo también lo termina: mejor confirmarlo
    if (event.isActive) setConfirmEvent(event);
    else doResolve(event);
  };

  let body: ReactNode;
  if (query.isLoading) {
    body = (
      <div className="space-y-3" aria-busy="true" aria-label="Cargando el historial de raids">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-28 w-full" />
        ))}
      </div>
    );
  } else if (query.isError && events.length === 0) {
    body = <ApiErrorState error={query.error} onRetry={() => void query.refetch()} bare />;
  } else if (events.length === 0) {
    const empty = EMPTY_TEXT[status];
    body = (
      <EmptyState
        bare
        icon={status === "open" ? CheckCheck : ShieldCheck}
        title={empty.title}
        description={empty.description}
        testId={`state-raid-events-empty-${status}`}
      />
    );
  } else {
    body = (
      <ol className="space-y-3" aria-label="Raids detectados" data-testid="list-raid-events">
        {events.map((event) => (
          <RaidEventItem
            key={event.id}
            event={event}
            actionLabels={actionLabels}
            currentUserId={currentUserId}
            now={now}
            resolving={resolve.isPending && resolve.variables === event.id}
            busy={resolve.isPending}
            onResolve={onResolve}
          />
        ))}
      </ol>
    );
  }

  return (
    <Card data-testid="card-raid-events">
      <CardHeader className="space-y-4">
        <div>
          <CardTitle className="flex items-center gap-2">
            <History className="h-5 w-5 text-primary" aria-hidden="true" />
            Historial de raids
          </CardTitle>
          <CardDescription className="mt-1.5">
            Cada vez que el bot detecta una entrada masiva lo guarda aquí. Márcalo como revisado cuando ya lo hayas visto.
          </CardDescription>
        </div>
        <Tabs value={status} onValueChange={(value) => isStatusFilter(value) && setStatus(value)}>
          <TabsList className="grid w-full grid-cols-3 sm:inline-flex sm:w-auto" aria-label="Filtrar raids por estado">
            {STATUS_TABS.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value} data-testid={`tab-raid-status-${tab.value}`}>
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </CardHeader>

      <CardContent className="space-y-4">
        {body}

        {query.isError && events.length > 0 && (
          <p className="text-sm text-destructive" role="alert">
            No se pudo actualizar el historial. {query.error instanceof Error ? query.error.message : ""}
          </p>
        )}

        {!query.isLoading && events.length > 0 && (
          <div className="flex flex-col items-center gap-3 border-t border-border pt-4 sm:flex-row sm:justify-between">
            <p className="text-xs text-muted-foreground" aria-live="polite">
              Mostrando {numberFormat.format(events.length)} {events.length === 1 ? "raid" : "raids"}
              {!query.hasNextPage && " · no hay más"}
            </p>
            {query.hasNextPage && (
              <Button
                variant="outline"
                onClick={() => void query.fetchNextPage()}
                disabled={query.isFetchingNextPage}
                data-testid="button-load-more-raids"
              >
                {query.isFetchingNextPage ? <Loader2 className="animate-spin" /> : <History />}
                {query.isFetchingNextPage ? "Cargando…" : "Cargar más"}
              </Button>
            )}
          </div>
        )}
      </CardContent>

      <ConfirmDialog
        open={confirmEvent !== null}
        onOpenChange={(open) => !open && setConfirmEvent(null)}
        title="¿Terminar el modo raid y marcarlo como revisado?"
        description={
          <>
            <p>Este raid sigue en curso. Al marcarlo como revisado, el bot termina el modo raid: la verificación vuelve a como estaba y deja de expulsar a quien entre.</p>
            <p>Hazlo solo si ya pasó el peligro.</p>
          </>
        }
        confirmLabel="Sí, terminar"
        pendingLabel="Terminando…"
        destructive
        pending={resolve.isPending}
        onConfirm={() => confirmEvent && doResolve(confirmEvent)}
        testId="dialog-resolve-active-raid"
      />
    </Card>
  );
}
