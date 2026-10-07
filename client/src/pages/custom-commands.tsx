import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, RefreshCw, Search, Terminal, X } from "lucide-react";
import {
  CUSTOM_COMMAND_LIMITS,
  type CustomCommandItem,
  type CustomCommandsResponse,
  type DashboardStatsResponse,
} from "@shared/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ApiErrorState } from "@/components/api-error-state";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { CommandCard } from "@/components/comandos/command-card";
import { CommandFormDialog, type CommandDraft } from "@/components/comandos/command-form-dialog";
import { HowToCard, UsageCard } from "@/components/comandos/command-overview";
import { RefreshErrorAlert } from "@/components/comandos/refresh-error-alert";
import {
  DEFAULT_PREFIX,
  customCommandsKey,
  previewValues,
  reservedNameSet,
} from "@/components/comandos/utils";
import { useSelectedGuild } from "@/lib/guild";
import { queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";

/** Ideas para el primer comando: solo rellenan el nombre y la descripción; la respuesta la escribes tú. */
const IDEAS: CommandDraft[] = [
  { name: "reglas", description: "Las normas del servidor" },
  { name: "redes", description: "Dónde más nos pueden seguir" },
  { name: "invitacion", description: "Enlace para invitar a más gente" },
];

/** Miembros del servidor si el resumen ya los trajo (para la vista previa); no se piden aparte. */
function cachedMemberCount(guildId: string): number | null {
  const stats = queryClient.getQueryData<DashboardStatsResponse>(["/api/dashboard", guildId, "stats"]);
  const count = stats?.guild?.memberCount;
  return typeof count === "number" && Number.isFinite(count) ? count : null;
}

function matches(command: CustomCommandItem, term: string, prefix: string): boolean {
  return (
    `${prefix}${command.name}`.includes(term) ||
    command.name.includes(term) ||
    (command.description?.toLowerCase().includes(term) ?? false) ||
    command.response.toLowerCase().includes(term)
  );
}

function LoadingState() {
  return (
    <div className="space-y-8" aria-busy="true" aria-label="Cargando comandos">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Skeleton className="h-64 rounded-xl lg:col-span-2" />
        <Skeleton className="h-40 rounded-xl" />
      </div>
      <div className="space-y-4">
        <Skeleton className="h-7 w-40" />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-56 rounded-xl" />
          ))}
        </div>
      </div>
    </div>
  );
}

export default function CustomCommands() {
  const { guildId, guild } = useSelectedGuild();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<CustomCommandItem | null>(null);
  const [draft, setDraft] = useState<CommandDraft | null>(null);
  const [search, setSearch] = useState("");

  // Clave que shared/api.ts indica para el aviso en vivo "customCommandsUpdated" (lib/websocket.ts aún no lo
  // atiende, ver customCommandsKey): mientras tanto, lo que mantiene la lista al día es lo de abajo
  const query = useQuery<CustomCommandsResponse>({
    queryKey: customCommandsKey(guildId),
    // Siempre se revisa al entrar: el prefijo se cambia en Ajustes (y el aviso en vivo de Ajustes no toca esta lista)
    // y los usos los cuenta el bot, así que al volver a la pestaña también se ponen al día
    staleTime: 0,
    refetchOnWindowFocus: true,
  });

  const data = query.data;
  const prefix = data?.prefix || DEFAULT_PREFIX;
  const commands = useMemo(() => data?.commands ?? [], [data?.commands]);
  const maxCommands = data?.maxCommands ?? CUSTOM_COMMAND_LIMITS.maxPerGuild;
  const atLimit = commands.length >= maxCommands;
  const enabledCount = commands.filter((command) => command.enabled).length;
  const reserved = useMemo(() => reservedNameSet(data?.reservedNames), [data?.reservedNames]);
  const existingNames = useMemo(() => commands.map((command) => command.name), [commands]);

  const memberCount = cachedMemberCount(guildId);
  const guildName = guild?.name ?? null;
  const preview = useMemo(() => previewValues(guildName, memberCount), [guildName, memberCount]);

  const term = search.trim().toLowerCase();
  const filtered = useMemo(
    () => (term ? commands.filter((command) => matches(command, term, prefix.toLowerCase())) : commands),
    [commands, term, prefix],
  );

  const openCreate = (idea: CommandDraft | null = null) => {
    setEditing(null);
    setDraft(idea);
    setDialogOpen(true);
  };
  const openEdit = (command: CustomCommandItem) => {
    setDraft(null);
    setEditing(command);
    setDialogOpen(true);
  };

  const newButton = atLimit ? (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* span: un botón deshabilitado no recibe el hover del tooltip */}
        <span tabIndex={0} className="inline-flex">
          <Button disabled data-testid="button-new-command">
            <Plus />
            Nuevo comando
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">
        Ya tienes {maxCommands} comandos, el máximo. Borra uno para crear otro.
      </TooltipContent>
    </Tooltip>
  ) : (
    <Button onClick={() => openCreate()} data-testid="button-new-command">
      <Plus />
      Nuevo comando
    </Button>
  );

  const header = (
    <PageHeader
      title="Comandos personalizados"
      description="Respuestas listas que el bot da por ti cuando alguien escribe un comando en tu servidor."
      actions={
        <>
          <Button
            variant="outline"
            onClick={() => void query.refetch()}
            disabled={query.isFetching}
            data-testid="button-refresh-commands"
          >
            <RefreshCw className={cn(query.isFetching && "animate-spin")} />
            Actualizar
          </Button>
          {data && newButton}
        </>
      }
    />
  );

  if (query.isLoading) {
    return (
      <div className="space-y-8">
        {header}
        <LoadingState />
      </div>
    );
  }

  // El error ocupa toda la página solo si no hay nada que mostrar. Si falla una actualización (al volver a la
  // pestaña o tras un cambio) seguimos con la lista que ya teníamos y con el diálogo abierto, sin perder lo escrito
  if (!data) {
    return (
      <div className="space-y-8">
        {header}
        <ApiErrorState error={query.error} onRetry={() => void query.refetch()} />
      </div>
    );
  }

  const exampleName = commands.find((command) => command.enabled)?.name ?? null;

  return (
    <div className="space-y-8">
      {header}

      {query.isError && (
        <RefreshErrorAlert
          error={query.error}
          guildId={guildId}
          onRetry={() => void query.refetch()}
          retrying={query.isFetching}
        />
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <HowToCard prefix={prefix} exampleName={exampleName} className="lg:col-span-2" />
        <UsageCard used={commands.length} max={maxCommands} enabled={enabledCount} className="self-start" />
      </div>

      <section className="space-y-4" aria-labelledby="heading-commands">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 id="heading-commands" className="text-lg font-semibold text-foreground">
            Tus comandos
            {term && commands.length > 0 && (
              <span className="ml-2 font-mono text-sm font-normal text-muted-foreground">
                {filtered.length} de {commands.length}
              </span>
            )}
          </h2>
          {commands.length > 0 && (
            <div className="relative w-full sm:w-72">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar por nombre o texto"
                aria-label="Buscar comandos"
                className="pl-9"
                data-testid="input-search-commands"
              />
            </div>
          )}
        </div>

        {commands.length === 0 ? (
          <EmptyState
            icon={Terminal}
            title="Aún no tienes comandos personalizados"
            description={
              <>
                <p>
                  Deja respuestas listas para lo que más te preguntan y el bot contestará por ti, aunque no estés
                  conectado. Elige una idea para empezar o crea el tuyo desde cero:
                </p>
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  {IDEAS.map((idea) => (
                    <Button
                      key={idea.name}
                      variant="outline"
                      size="sm"
                      onClick={() => openCreate(idea)}
                      aria-label={`Crear ${prefix}${idea.name}: ${idea.description}`}
                      data-testid={`button-idea-${idea.name}`}
                    >
                      <span className="font-mono text-primary">
                        {prefix}
                        {idea.name}
                      </span>
                    </Button>
                  ))}
                </div>
              </>
            }
            action={
              <Button onClick={() => openCreate()} data-testid="button-create-first-command">
                <Plus />
                Crear mi primer comando
              </Button>
            }
            testId="state-no-commands"
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={Search}
            title="Ningún comando coincide"
            description={
              <>
                No encontramos nada con “<span className="break-all text-foreground">{search.trim()}</span>” en el
                nombre, la descripción ni la respuesta.
              </>
            }
            action={
              <Button variant="outline" onClick={() => setSearch("")}>
                <X />
                Limpiar búsqueda
              </Button>
            }
            testId="state-no-search-results"
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3" data-testid="list-commands">
            {filtered.map((command) => (
              <CommandCard key={command.id} command={command} guildId={guildId} prefix={prefix} onEdit={openEdit} />
            ))}
          </div>
        )}
      </section>

      <CommandFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        guildId={guildId}
        prefix={prefix}
        botInGuild={guild?.botInGuild ?? true}
        reservedNames={reserved}
        existingNames={existingNames}
        command={editing}
        draft={draft}
        previewValues={preview}
      />
    </div>
  );
}
