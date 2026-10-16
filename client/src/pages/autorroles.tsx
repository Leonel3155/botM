import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ExternalLink, Loader2, MousePointerClick, Pencil, Plus, RefreshCw, Trash2, X } from "lucide-react";
import {
  ROLE_PANEL_LIMITS,
  type DiscordChannelsResponse,
  type DiscordRoleItem,
  type DiscordRolesResponse,
  type RolePanelButtonItem,
  type RolePanelDeleteResponse,
  type RolePanelItem,
  type RolePanelSaveRequest,
  type RolePanelsResponse,
} from "@shared/api";
import { isValidButtonEmoji } from "@shared/emoji";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectGroup, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ApiErrorState } from "@/components/api-error-state";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { RichSelectItem } from "@/components/comunidad/rich-select-item";
import { channelLabel, postableChannels } from "@/components/comunidad/channel-field";
import { errorMessage } from "@/components/comandos/utils";
import { useToast } from "@/hooks/use-toast";
import { useBotAvailability } from "@/components/ajustes-resumen/bot-status";
import { useSelectedGuild } from "@/lib/guild";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";

const panelsKey = (guildId: string) => ["/api/role-panels", guildId] as const;
const channelsKey = (guildId: string) => ["/api/guild", guildId, "discord-channels"] as const;
const rolesKey = (guildId: string) => ["/api/guilds", guildId, "discord-roles"] as const;

function RoleDot({ role }: { role: DiscordRoleItem | undefined }) {
  return (
    <span
      className="h-3 w-3 shrink-0 rounded-full border border-border"
      style={role?.color ? { backgroundColor: role.color } : undefined}
      aria-hidden="true"
    />
  );
}

// ===== Formulario =====

interface Draft {
  channelId: string;
  title: string;
  description: string;
  exclusive: boolean;
  roles: { roleId: string; label: string; emoji: string }[];
}

const EMPTY_DRAFT: Draft = { channelId: "", title: "Elige tus roles", description: "", exclusive: false, roles: [] };

function draftFrom(panel: RolePanelItem | null): Draft {
  if (!panel) return EMPTY_DRAFT;
  return {
    channelId: panel.channelId,
    title: panel.title,
    description: panel.description ?? "",
    exclusive: panel.exclusive,
    roles: panel.roles.map((role) => ({ roleId: role.roleId, label: role.label, emoji: role.emoji ?? "" })),
  };
}

function draftProblem(draft: Draft): string | null {
  if (!draft.channelId) return "Elige el canal donde publico el panel.";
  if (!draft.title.trim()) return "Ponle un título al panel.";
  if (draft.roles.length === 0) return "Agrega al menos un rol.";
  for (const role of draft.roles) {
    if (!role.label.trim()) return "Cada botón necesita un texto.";
    if (role.emoji.trim() && !isValidButtonEmoji(role.emoji.trim())) {
      return `El emoji de "${role.label}" no es válido: pon uno solo (por ejemplo 🎮).`;
    }
  }
  return null;
}

interface PanelDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  guildId: string;
  panel: RolePanelItem | null;
  channels: DiscordChannelsResponse | undefined;
  roles: DiscordRolesResponse | undefined;
}

function PanelDialog({ open, onOpenChange, guildId, panel, channels, roles }: PanelDialogProps) {
  const { toast } = useToast();
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setDraft(draftFrom(panel));
      setError(null);
    }
  }, [open, panel]);

  const postable = postableChannels(channels);
  const roleById = useMemo(() => new Map((roles ?? []).map((role) => [role.id, role])), [roles]);
  const usedRoles = new Set(draft.roles.map((role) => role.roleId));
  const addable = (roles ?? []).filter((role) => !usedRoles.has(role.id));
  const atRoleLimit = draft.roles.length >= ROLE_PANEL_LIMITS.maxRoles;

  const save = useMutation({
    mutationFn: async (body: RolePanelSaveRequest): Promise<RolePanelItem> => {
      const res = panel
        ? await apiRequest("PUT", `/api/role-panels/${guildId}/${panel.id}`, body)
        : await apiRequest("POST", `/api/role-panels/${guildId}`, body);
      return (await res.json()) as RolePanelItem;
    },
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: panelsKey(guildId) });
      toast({
        title: panel ? "Panel actualizado" : "Panel publicado",
        description: `Ya está en ${channelLabel(channels, saved.channelId) ?? "el canal"}.`,
      });
      onOpenChange(false);
    },
    onError: (err) => setError(errorMessage(err)),
  });

  const submit = () => {
    const problem = draftProblem(draft);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    save.mutate({
      channelId: draft.channelId,
      title: draft.title.trim(),
      description: draft.description.trim() || null,
      exclusive: draft.exclusive,
      roles: draft.roles.map(
        (role): RolePanelButtonItem => ({ roleId: role.roleId, label: role.label.trim(), emoji: role.emoji.trim() || null }),
      ),
    });
  };

  const updateRole = (index: number, patch: Partial<Draft["roles"][number]>) =>
    setDraft((current) => ({
      ...current,
      roles: current.roles.map((role, i) => (i === index ? { ...role, ...patch } : role)),
    }));

  return (
    <Dialog open={open} onOpenChange={(next) => !save.isPending && onOpenChange(next)}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{panel ? "Editar panel de roles" : "Nuevo panel de roles"}</DialogTitle>
          <DialogDescription>
            Publico un mensaje con un botón por rol. Quien lo pulsa se pone el rol, y si lo vuelve a pulsar se lo quita.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="panel-channel">Canal</Label>
            <Select value={draft.channelId} onValueChange={(channelId) => setDraft((d) => ({ ...d, channelId }))}>
              <SelectTrigger id="panel-channel" data-testid="select-panel-channel">
                <SelectValue placeholder={channels ? "Elige un canal" : "Cargando canales…"} />
              </SelectTrigger>
              <SelectContent className="max-h-80">
                {postable.map((channel) => (
                  <RichSelectItem
                    key={channel.id}
                    value={channel.id}
                    disabled={!channel.botCanPost}
                    hint={channel.botCanPost ? channel.category : "No puedo publicar aquí (me faltan permisos)"}
                  >
                    #{channel.name}
                  </RichSelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="panel-title">Título</Label>
            <Input
              id="panel-title"
              value={draft.title}
              maxLength={ROLE_PANEL_LIMITS.titleMaxLength}
              onChange={(event) => setDraft((d) => ({ ...d, title: event.target.value }))}
              data-testid="input-panel-title"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="panel-description">Descripción (opcional)</Label>
            <Textarea
              id="panel-description"
              value={draft.description}
              maxLength={ROLE_PANEL_LIMITS.descriptionMaxLength}
              placeholder="Por ejemplo: elige a qué juegos le entras para que te avisen cuando se arme partida."
              onChange={(event) => setDraft((d) => ({ ...d, description: event.target.value }))}
              data-testid="input-panel-description"
            />
          </div>

          <div className="flex items-start justify-between gap-4 rounded-md border border-border p-3">
            <div>
              <Label htmlFor="panel-exclusive">Solo un rol a la vez</Label>
              <p className="text-sm text-muted-foreground">
                Útil para colores o regiones: al elegir uno, le quito el otro rol de este panel que tuviera.
              </p>
            </div>
            <Switch
              id="panel-exclusive"
              checked={draft.exclusive}
              onCheckedChange={(exclusive) => setDraft((d) => ({ ...d, exclusive }))}
              data-testid="switch-panel-exclusive"
            />
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <Label>Roles ({draft.roles.length} de {ROLE_PANEL_LIMITS.maxRoles})</Label>
            </div>

            {draft.roles.length === 0 && (
              <p className="text-sm text-muted-foreground">Todavía no hay roles. Agrega el primero abajo.</p>
            )}

            <ul className="space-y-2">
              {draft.roles.map((role, index) => {
                const discordRole = roleById.get(role.roleId);
                const problem = !discordRole
                  ? roles
                    ? "Este rol ya no existe."
                    : null
                  : discordRole.assignable
                    ? null
                    : discordRole.reason;
                return (
                  <li key={role.roleId} className="rounded-md border border-border p-3">
                    <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                      <RoleDot role={discordRole} />
                      <span className="truncate">@{discordRole?.name ?? "rol desconocido"}</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="ml-auto h-7 w-7"
                        onClick={() => setDraft((d) => ({ ...d, roles: d.roles.filter((_, i) => i !== index) }))}
                        aria-label={`Quitar @${discordRole?.name ?? "rol"}`}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className="grid grid-cols-[5rem_1fr] gap-2">
                      <Input
                        value={role.emoji}
                        placeholder="🎮"
                        maxLength={ROLE_PANEL_LIMITS.emojiMaxLength}
                        aria-label="Emoji del botón (opcional)"
                        onChange={(event) => updateRole(index, { emoji: event.target.value })}
                      />
                      <Input
                        value={role.label}
                        placeholder="Texto del botón"
                        maxLength={ROLE_PANEL_LIMITS.labelMaxLength}
                        aria-label="Texto del botón"
                        onChange={(event) => updateRole(index, { label: event.target.value })}
                      />
                    </div>
                    {problem && <p className="mt-2 text-xs text-destructive">{problem}</p>}
                  </li>
                );
              })}
            </ul>

            <Select
              value=""
              onValueChange={(roleId) => {
                const discordRole = roleById.get(roleId);
                setDraft((d) => ({ ...d, roles: [...d.roles, { roleId, label: discordRole?.name ?? "", emoji: "" }] }));
              }}
              disabled={!roles || atRoleLimit}
            >
              <SelectTrigger data-testid="select-add-role">
                <SelectValue placeholder={atRoleLimit ? "Ya llegaste al máximo de roles" : "+ Agregar un rol"} />
              </SelectTrigger>
              <SelectContent className="max-h-80">
                <SelectGroup>
                  <SelectLabel className="text-xs text-muted-foreground">Los roles en gris no los puedo dar</SelectLabel>
                  {addable.map((role) => (
                    <RichSelectItem
                      key={role.id}
                      value={role.id}
                      disabled={!role.assignable}
                      hint={role.assignable ? undefined : role.reason ?? "No se puede usar"}
                    >
                      <span className="inline-flex items-center gap-2">
                        <RoleDot role={role} />@{role.name}
                      </span>
                    </RichSelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Para que pueda dar un rol, mi rol tiene que estar más arriba que ese rol en Ajustes del servidor → Roles. Por
              seguridad no doy roles con permisos de moderación o administración.
            </p>
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={save.isPending}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={save.isPending} data-testid="button-save-panel">
            {save.isPending && <Loader2 className="animate-spin" />}
            {panel ? "Guardar y actualizar en Discord" : "Publicar en Discord"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ===== Tarjeta de un panel =====

interface PanelCardProps {
  guildId: string;
  panel: RolePanelItem;
  channels: DiscordChannelsResponse | undefined;
  roles: DiscordRolesResponse | undefined;
  onEdit: (panel: RolePanelItem) => void;
  /** El bot está conectado y en el servidor (si no, borrar deja el mensaje en Discord). */
  botOnline: boolean;
}

function PanelCard({ guildId, panel, channels, roles, onEdit, botOnline }: PanelCardProps) {
  const { toast } = useToast();
  const [confirming, setConfirming] = useState(false);
  const roleById = new Map((roles ?? []).map((role) => [role.id, role]));

  const remove = useMutation({
    mutationFn: async (): Promise<RolePanelDeleteResponse> => {
      const res = await apiRequest("DELETE", `/api/role-panels/${guildId}/${panel.id}`);
      return (await res.json()) as RolePanelDeleteResponse;
    },
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: panelsKey(guildId) });
      toast({
        title: "Panel borrado",
        description: data.messageDeleted
          ? "También quité el mensaje de Discord."
          : "No pude quitar el mensaje de Discord: se quedó con botones que ya no hacen nada, bórralo a mano.",
      });
      setConfirming(false);
    },
    onError: (err) => toast({ title: "No se pudo borrar", description: errorMessage(err), variant: "destructive" }),
  });

  return (
    <Card data-testid={`card-panel-${panel.id}`}>
      <CardHeader className="space-y-1 p-4 sm:p-6">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-lg">{panel.title}</CardTitle>
          {panel.exclusive && <Badge variant="secondary">Solo uno</Badge>}
        </div>
        <CardDescription>
          En {channelLabel(channels, panel.channelId) ?? "un canal que ya no veo"}
          {!panel.messageId && " · el mensaje no está publicado"}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 p-4 pt-0 sm:p-6 sm:pt-0">
        <div className="flex flex-wrap gap-2">
          {panel.roles.map((button) => {
            const role = roleById.get(button.roleId);
            return (
              <span
                key={button.roleId}
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-sm"
                title={role ? `@${role.name}` : "Rol desconocido"}
              >
                {button.emoji && !button.emoji.startsWith("<") && <span aria-hidden="true">{button.emoji}</span>}
                {button.label}
              </span>
            );
          })}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => onEdit(panel)} data-testid={`button-edit-panel-${panel.id}`}>
            <Pencil />
            Editar
          </Button>
          {panel.messageUrl && (
            <Button variant="outline" size="sm" asChild>
              <a href={panel.messageUrl} target="_blank" rel="noreferrer">
                <ExternalLink />
                Ver en Discord
              </a>
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => setConfirming(true)} className="text-destructive">
            <Trash2 />
            Borrar
          </Button>
        </div>
      </CardContent>

      <AlertDialog open={confirming} onOpenChange={(next) => !remove.isPending && setConfirming(next)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Borrar «{panel.title}»?</AlertDialogTitle>
            <AlertDialogDescription>
              {botOnline
                ? "Quito el mensaje de Discord. Nadie pierde los roles que ya se puso, pero ya no podrán ponérselos ni quitárselos con este panel."
                : "El bot no está conectado a este servidor, así que el mensaje se queda en Discord con botones que ya no harán nada: bórralo a mano. Nadie pierde los roles que ya se puso."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                remove.mutate();
              }}
              disabled={remove.isPending}
            >
              {remove.isPending && <Loader2 className="animate-spin" />}
              Borrar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

// ===== Página =====

export default function Autorroles() {
  const { guildId, guild } = useSelectedGuild();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<RolePanelItem | null>(null);
  const availability = useBotAvailability(guildId, guild?.botInGuild);
  const botInGuild = availability.canEdit;

  const query = useQuery<RolePanelsResponse>({ queryKey: panelsKey(guildId), staleTime: 0 });
  const channelsQuery = useQuery<DiscordChannelsResponse>({
    queryKey: channelsKey(guildId),
    enabled: botInGuild,
    staleTime: 60_000,
  });
  const rolesQuery = useQuery<DiscordRolesResponse>({
    queryKey: rolesKey(guildId),
    enabled: botInGuild,
    staleTime: 60_000,
  });

  const panels = query.data?.panels ?? [];
  const maxPanels = query.data?.maxPanels ?? ROLE_PANEL_LIMITS.maxPerGuild;
  const atLimit = panels.length >= maxPanels;

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };
  const openEdit = (panel: RolePanelItem) => {
    setEditing(panel);
    setDialogOpen(true);
  };
  const refresh = () => {
    void query.refetch();
    void channelsQuery.refetch();
    void rolesQuery.refetch();
  };

  const header = (
    <PageHeader
      title="Autorroles"
      description="Mensajes con botones para que cada quien se ponga los roles que quiera (juegos, colores, avisos…)."
      actions={
        <>
          <Button variant="outline" onClick={refresh} disabled={query.isFetching}>
            <RefreshCw className={cn(query.isFetching && "animate-spin")} />
            Actualizar
          </Button>
          {query.data && (
            <Button onClick={openCreate} disabled={atLimit || !botInGuild} data-testid="button-new-panel">
              <Plus />
              Nuevo panel
            </Button>
          )}
        </>
      }
    />
  );

  if (query.isLoading) {
    return (
      <div className="space-y-8">
        {header}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Skeleton className="h-48 rounded-xl" />
          <Skeleton className="h-48 rounded-xl" />
        </div>
      </div>
    );
  }

  if (!query.data) {
    return (
      <div className="space-y-8">
        {header}
        <ApiErrorState error={query.error} onRetry={() => void query.refetch()} />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {header}

      {!botInGuild && (
        <Alert>
          <AlertDescription>{availability.blocked}</AlertDescription>
        </Alert>
      )}
      {atLimit && (
        <Alert>
          <AlertDescription>Ya tienes {maxPanels} paneles, el máximo. Borra uno para crear otro.</AlertDescription>
        </Alert>
      )}

      {panels.length === 0 ? (
        <EmptyState
          icon={MousePointerClick}
          title="Aún no tienes paneles de roles"
          description="Crea uno, elige los roles y lo publico en el canal que digas. Cada quien pulsa los botones de lo que le interesa."
          action={
            <Button onClick={openCreate} disabled={!botInGuild}>
              <Plus />
              Crear mi primer panel
            </Button>
          }
          testId="state-no-panels"
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2" data-testid="list-panels">
          {panels.map((panel) => (
            <PanelCard
              key={panel.id}
              botOnline={availability.presence === "ready"}
              guildId={guildId}
              panel={panel}
              channels={channelsQuery.data}
              roles={rolesQuery.data}
              onEdit={openEdit}
            />
          ))}
        </div>
      )}

      <PanelDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        guildId={guildId}
        panel={editing}
        channels={channelsQuery.data}
        roles={rolesQuery.data}
      />
    </div>
  );
}
