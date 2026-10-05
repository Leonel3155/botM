import { useMemo, useRef, useState, type ReactNode } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Filter, FilterX, Gavel, Hash, History, Info, Loader2, Search, X } from "lucide-react";
import {
  MODERATION_ACTION_LABELS,
  type AnalyticsResponse,
  type ModerationActionItem,
  type ModerationActionsResponse,
} from "@shared/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ApiErrorState } from "@/components/api-error-state";
import { EmptyState } from "@/components/empty-state";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { ActionBadge, MuteStatus, actionLabel, actionStyle, isChannelAction } from "./moderation-meta";
import { analyticsKey, moderationActionsKey } from "./query-keys";
import { RelativeTime } from "./relative-time";
import { UserCell } from "./user-cell";
import { isSnowflake, numberFormat, useDebouncedValue, useNow, userName } from "./utils";

const PAGE_SIZE = 25;
const ALL_TYPES = "all";

function plural(count: number, one: string, many: string) {
  return `${numberFormat.format(count)} ${count === 1 ? one : many}`;
}

/** "la única acción cargada" / "las 25 acciones cargadas" */
function loadedPhrase(count: number) {
  return count === 1 ? "la única acción cargada" : `las ${numberFormat.format(count)} acciones cargadas`;
}

/** Botón pequeño para ver solo las acciones de una persona. */
function FilterByUserButton({ action, onFilter }: { action: ModerationActionItem; onFilter: (userId: string) => void }) {
  const label = `Ver solo las acciones sobre ${userName(action.user)}`;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0 text-muted-foreground hover:text-primary"
          onClick={() => onFilter(action.user.id)}
          aria-label={label}
          data-testid={`button-filter-user-${action.id}`}
        >
          <Filter />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function ChannelTarget() {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
      <Hash className="h-4 w-4" aria-hidden="true" />
      Un canal
    </span>
  );
}

function Reason({ text, className }: { text: string | null; className?: string }) {
  if (!text?.trim()) return <span className={cn("text-sm italic text-muted-foreground", className)}>Sin motivo</span>;
  return (
    <p className={cn("break-words text-sm text-foreground/90", className)} title={text}>
      {text}
    </p>
  );
}

function HistorySkeleton() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Cargando el historial">
      {[0, 1, 2, 3, 4].map((i) => (
        <Skeleton key={i} className="h-14 w-full" />
      ))}
    </div>
  );
}

interface TypeChipsProps {
  guildId: string;
  selected: string;
  onSelect: (type: string) => void;
}

/** Cuántas acciones de cada tipo hubo en los últimos 30 días (sirven de atajo para filtrar). */
function TypeChips({ guildId, selected, onSelect }: TypeChipsProps) {
  const analytics = useQuery<AnalyticsResponse>({
    queryKey: analyticsKey(guildId),
    staleTime: 60_000,
  });

  if (analytics.isLoading) {
    return (
      <div className="flex flex-wrap gap-2">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-7 w-28" />
        ))}
      </div>
    );
  }

  // Es un extra: si falla, el historial sigue funcionando sin los atajos
  const entries = Object.entries(analytics.data?.moderationByType30d ?? {})
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="moderation-type-chips">
      <span className="text-xs text-muted-foreground">Últimos 30 días:</span>
      {entries.map(([type, count]) => {
        const active = selected === type;
        const { icon: Icon } = actionStyle(type);
        return (
          <button
            key={type}
            type="button"
            onClick={() => onSelect(active ? ALL_TYPES : type)}
            aria-pressed={active}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active
                ? "border-primary bg-primary/15 text-primary"
                : "border-border bg-background/40 text-muted-foreground hover:border-primary/60 hover:text-foreground",
            )}
            data-testid={`chip-type-${type}`}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
            {actionLabel(type)}
            <span className="font-mono font-semibold text-foreground">{numberFormat.format(count)}</span>
          </button>
        );
      })}
    </div>
  );
}

export function ModerationHistory({ guildId }: { guildId: string }) {
  const now = useNow(30_000);
  const cardRef = useRef<HTMLDivElement>(null);
  const [type, setType] = useState<string>(ALL_TYPES);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search.trim(), 400);

  // Un ID completo se busca en el servidor (todo el historial); un nombre, entre lo ya cargado
  const userIdFilter = isSnowflake(debouncedSearch) ? debouncedSearch : null;
  const nameFilter = !userIdFilter && debouncedSearch ? debouncedSearch.toLowerCase() : "";
  const typeFilter = type === ALL_TYPES ? null : type;
  const hasServerFilters = !!typeFilter || !!userIdFilter;
  const hasAnyFilter = hasServerFilters || !!search.trim();

  const query = useInfiniteQuery({
    queryKey: [...moderationActionsKey(guildId), { type: typeFilter, userId: userIdFilter }],
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }): Promise<ModerationActionsResponse> => {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
      if (typeFilter) params.set("type", typeFilter);
      if (userIdFilter) params.set("userId", userIdFilter);
      if (pageParam) params.set("before", pageParam);
      const res = await apiRequest("GET", `/api/moderation/${guildId}/actions?${params.toString()}`);
      return (await res.json()) as ModerationActionsResponse;
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });

  const loaded = useMemo(() => query.data?.pages.flatMap((page) => page.actions) ?? [], [query.data]);
  const rows = useMemo(() => {
    if (!nameFilter) return loaded;
    return loaded.filter((action) => {
      const people = isChannelAction(action.type) ? [action.moderator] : [action.user, action.moderator];
      return people.some(
        (person) => person.username?.toLowerCase().includes(nameFilter) || person.id.includes(nameFilter),
      );
    });
  }, [loaded, nameFilter]);

  // Un tipo que el panel aún no conoce (p. ej. elegido desde los atajos) también se puede mostrar
  const typeOptions = useMemo(() => {
    const entries = Object.entries(MODERATION_ACTION_LABELS);
    if (typeFilter && !(typeFilter in MODERATION_ACTION_LABELS)) entries.push([typeFilter, typeFilter]);
    return entries;
  }, [typeFilter]);

  const clearFilters = () => {
    setType(ALL_TYPES);
    setSearch("");
  };

  const filterByUser = (userId: string) => {
    setSearch(userId);
    cardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const loadMoreButton = query.hasNextPage ? (
    <Button
      variant="outline"
      onClick={() => void query.fetchNextPage()}
      disabled={query.isFetchingNextPage}
      data-testid="button-load-more-moderation"
    >
      {query.isFetchingNextPage ? <Loader2 className="animate-spin" /> : <History />}
      {query.isFetchingNextPage ? "Cargando…" : "Cargar más"}
    </Button>
  ) : null;

  let body: ReactNode;
  if (query.isLoading) {
    body = <HistorySkeleton />;
  } else if (query.isError && loaded.length === 0) {
    body = <ApiErrorState error={query.error} onRetry={() => void query.refetch()} bare />;
  } else if (loaded.length === 0) {
    body = hasServerFilters ? (
      <EmptyState
        bare
        icon={FilterX}
        title="No hay acciones con estos filtros"
        description={
          userIdFilter
            ? "Nadie del equipo ha usado un comando de moderación con esa persona (o el ID no es de este servidor)."
            : "Prueba con otro tipo de acción o quita los filtros."
        }
        action={
          <Button variant="outline" onClick={clearFilters}>
            <X />
            Quitar filtros
          </Button>
        }
        testId="state-moderation-no-match"
      />
    ) : (
      <EmptyState
        bare
        icon={Gavel}
        title="Aún no hay acciones de moderación"
        description="Cuando tú o tu equipo usen /warn, /mute, /kick, /ban, /clear o /lockdown en Discord, cada acción quedará guardada aquí con su motivo y quién la hizo."
        testId="state-moderation-empty"
      />
    );
  } else if (rows.length === 0) {
    body = (
      <EmptyState
        bare
        icon={Search}
        title={`Nadie con “${debouncedSearch}” en lo que llevas cargado`}
        description={
          query.hasNextPage
            ? "Carga más acciones para seguir buscando, o pega el ID de Discord de la persona para buscar en todo el historial."
            : "Revisa cómo se escribe el nombre o pega el ID de Discord de la persona."
        }
        action={
          <>
            {loadMoreButton}
            <Button variant="ghost" onClick={() => setSearch("")}>
              <X />
              Borrar búsqueda
            </Button>
          </>
        }
        testId="state-moderation-name-no-match"
      />
    );
  } else {
    body = (
      <>
        {/* Escritorio: tabla */}
        <div className="hidden rounded-lg border border-border lg:block">
          <Table data-testid="table-moderation">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-[200px] px-3">Acción</TableHead>
                <TableHead className="px-3">Persona</TableHead>
                <TableHead className="px-3">Motivo</TableHead>
                <TableHead className="px-3">Moderador</TableHead>
                <TableHead className="w-[130px] px-3 text-right">Cuándo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((action) => (
                <TableRow key={action.id} className="even:bg-muted/20" data-testid={`row-moderation-${action.id}`}>
                  <TableCell className="px-3 py-3 align-top">
                    <div className="flex flex-col items-start gap-1.5">
                      <ActionBadge type={action.type} duration={action.duration} />
                      <MuteStatus action={action} now={now} />
                    </div>
                  </TableCell>
                  <TableCell className="max-w-[220px] px-3 py-3 align-top">
                    {isChannelAction(action.type) ? (
                      <ChannelTarget />
                    ) : (
                      <UserCell
                        user={action.user}
                        trailing={
                          userIdFilter === action.user.id ? null : (
                            <FilterByUserButton action={action} onFilter={filterByUser} />
                          )
                        }
                      />
                    )}
                  </TableCell>
                  <TableCell className="max-w-[280px] px-3 py-3 align-top">
                    <Reason text={action.reason} className="line-clamp-3" />
                  </TableCell>
                  <TableCell className="max-w-[180px] px-3 py-3 align-top">
                    <UserCell user={action.moderator} size="sm" showId={false} />
                  </TableCell>
                  <TableCell className="px-3 py-3 text-right align-top">
                    <RelativeTime value={action.createdAt} now={now} className="font-mono text-xs text-muted-foreground" />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {/* Móvil y tablet: tarjetas */}
        <ul className="divide-y divide-border lg:hidden" data-testid="list-moderation">
          {rows.map((action) => (
            <li key={action.id} className="space-y-2 py-4 first:pt-0" data-testid={`item-moderation-${action.id}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <ActionBadge type={action.type} duration={action.duration} />
                <RelativeTime value={action.createdAt} now={now} className="font-mono text-xs text-muted-foreground" />
              </div>
              <MuteStatus action={action} now={now} />
              {isChannelAction(action.type) ? (
                <ChannelTarget />
              ) : (
                <UserCell
                  user={action.user}
                  trailing={
                    userIdFilter === action.user.id ? null : (
                      <FilterByUserButton action={action} onFilter={filterByUser} />
                    )
                  }
                />
              )}
              <Reason text={action.reason} />
              <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                <span className="shrink-0">Por</span>
                <UserCell user={action.moderator} size="sm" showId={false} />
              </div>
            </li>
          ))}
        </ul>
      </>
    );
  }

  const showFooter = !query.isLoading && loaded.length > 0 && rows.length > 0;

  return (
    <Card ref={cardRef} className="scroll-mt-20">
      <CardHeader className="space-y-4">
        <div>
          <CardTitle className="flex items-center gap-2">
            <History className="h-5 w-5 text-primary" aria-hidden="true" />
            Historial de moderación
          </CardTitle>
          <CardDescription className="mt-1.5">
            Cada advertencia, silencio, expulsión o baneo hecho con el bot, del más reciente al más antiguo.
          </CardDescription>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
          <Select value={type} onValueChange={setType}>
            <SelectTrigger className="w-full sm:w-56" aria-label="Filtrar por tipo de acción" data-testid="select-moderation-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_TYPES}>Todos los tipos</SelectItem>
              {typeOptions.map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              type="text"
              enterKeyHint="search"
              autoComplete="off"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Nombre o ID de Discord"
              className="pl-9 pr-9"
              aria-label="Buscar por nombre o ID de Discord"
              data-testid="input-moderation-search"
            />
            {search && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute right-0.5 top-1/2 h-8 w-8 -translate-y-1/2 text-muted-foreground"
                onClick={() => setSearch("")}
                aria-label="Borrar búsqueda"
              >
                <X />
              </Button>
            )}
          </div>

          {hasAnyFilter && (
            <Button variant="ghost" onClick={clearFilters} className="shrink-0" data-testid="button-clear-moderation-filters">
              <FilterX />
              Quitar filtros
            </Button>
          )}
        </div>

        {nameFilter ? (
          <p className="flex items-start gap-2 text-xs text-muted-foreground" role="status">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
            <span>
              Buscando por nombre solo entre {loadedPhrase(loaded.length)}. Para buscar en todo el historial, pega el ID
              de Discord de la persona (Modo desarrollador → clic derecho → Copiar ID).
            </span>
          </p>
        ) : userIdFilter ? (
          <p className="flex items-start gap-2 text-xs text-muted-foreground" role="status">
            <Filter className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
            <span>
              Mostrando solo las acciones sobre el usuario con ID <span className="font-mono text-foreground">{userIdFilter}</span>.
            </span>
          </p>
        ) : null}

        <TypeChips guildId={guildId} selected={type} onSelect={setType} />
      </CardHeader>

      <CardContent className="space-y-4">
        {body}

        {query.isError && loaded.length > 0 && (
          <p className="text-sm text-destructive" role="alert">
            No se pudo actualizar el historial. {query.error instanceof Error ? query.error.message : ""}
          </p>
        )}

        {showFooter && (
          <div className="flex flex-col items-center gap-3 border-t border-border pt-4 sm:flex-row sm:justify-between">
            <p className="text-xs text-muted-foreground" aria-live="polite">
              {nameFilter
                ? `${plural(rows.length, "coincidencia", "coincidencias")} de ${plural(loaded.length, "acción cargada", "acciones cargadas")}`
                : `Mostrando ${plural(loaded.length, "acción", "acciones")}`}
              {!query.hasNextPage && " · eso es todo el historial"}
            </p>
            {loadMoreButton}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
