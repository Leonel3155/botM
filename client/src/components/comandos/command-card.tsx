import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { Copy, Loader2, Pencil, Trash2 } from "lucide-react";
import type { CustomCommandItem, CustomCommandResponse, CustomCommandsResponse } from "@shared/api";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, isApiError, queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import {
  customCommandsKey,
  errorMessage,
  formatUses,
  invalidateCustomCommands,
  updateCachedCommands,
} from "./utils";

interface CommandCardProps {
  command: CustomCommandItem;
  guildId: string;
  prefix: string;
  onEdit: (command: CustomCommandItem) => void;
}

function createdLabel(createdAt: string | null): string | null {
  if (!createdAt) return null;
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return null;
  return `Creado ${formatDistanceToNow(date, { addSuffix: true, locale: es })}`;
}

/** Tarjeta de un comando: activar/apagar, copiar, editar y eliminar. */
export function CommandCard({ command, guildId, prefix, onEdit }: CommandCardProps) {
  const { toast } = useToast();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const trigger = `${prefix}${command.name}`;
  const queryKey = customCommandsKey(guildId);

  // Activar / apagar: se ve al instante y se deshace si el servidor dice que no
  const toggle = useMutation({
    mutationFn: async (enabled: boolean): Promise<CustomCommandResponse> => {
      const res = await apiRequest("PATCH", `/api/custom-commands/${guildId}/${command.id}/toggle`, { enabled });
      return (await res.json()) as CustomCommandResponse;
    },
    onMutate: async (enabled) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<CustomCommandsResponse>(queryKey);
      updateCachedCommands(guildId, (commands) =>
        commands.map((c) => (c.id === command.id ? { ...c, enabled } : c)),
      );
      return { previous };
    },
    onSuccess: (saved) => {
      updateCachedCommands(guildId, (commands) => commands.map((c) => (c.id === saved.id ? saved : c)));
      toast({
        title: saved.enabled ? `${prefix}${saved.name} está activo` : `${prefix}${saved.name} quedó apagado`,
        description: saved.enabled
          ? "El bot ya responde cuando alguien lo escribe."
          : "El bot no responderá hasta que lo vuelvas a activar.",
      });
    },
    onError: (error, enabled, context) => {
      if (context?.previous) queryClient.setQueryData(queryKey, context.previous);
      toast({
        variant: "destructive",
        title: enabled ? `No se pudo activar ${trigger}` : `No se pudo apagar ${trigger}`,
        description: errorMessage(error),
      });
    },
    onSettled: () => invalidateCustomCommands(guildId),
  });

  const remove = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", `/api/custom-commands/${guildId}/${command.id}`);
    },
    onSuccess: () => {
      updateCachedCommands(guildId, (commands) => commands.filter((c) => c.id !== command.id));
      invalidateCustomCommands(guildId, { dashboard: true });
      setConfirmOpen(false);
      toast({ title: `Eliminaste ${trigger}`, description: "El bot ya no responderá a ese comando." });
    },
    onError: (error) => {
      // 404: ya no existía (lo borró alguien más); la lista se actualiza igual
      if (isApiError(error) && error.kind === "notFound") {
        setConfirmOpen(false);
        invalidateCustomCommands(guildId, { dashboard: true });
      }
      toast({ variant: "destructive", title: `No se pudo eliminar ${trigger}`, description: errorMessage(error) });
    },
  });

  const copyTrigger = async () => {
    try {
      if (!navigator.clipboard) throw new Error("Sin portapapeles");
      await navigator.clipboard.writeText(trigger);
      toast({ title: `Copiaste ${trigger}`, description: "Pégalo en Discord para probarlo." });
    } catch {
      toast({ variant: "destructive", title: "No se pudo copiar", description: `Escríbelo a mano en Discord: ${trigger}` });
    }
  };

  const created = createdLabel(command.createdAt);

  return (
    <Card
      className={cn("flex min-w-0 flex-col", !command.enabled && "border-dashed")}
      data-testid={`card-command-${command.id}`}
    >
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0 p-4 pb-3 sm:p-5 sm:pb-3">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h3 className="min-w-0 break-all font-mono text-base font-semibold text-primary">{trigger}</h3>
            {command.enabled ? (
              <Badge className="shrink-0">Activo</Badge>
            ) : (
              <Badge variant="outline" className="shrink-0 text-muted-foreground">
                Apagado
              </Badge>
            )}
          </div>
          <p
            className={cn("mt-1 line-clamp-2 text-sm", command.description ? "text-foreground/80" : "italic text-muted-foreground")}
          >
            {command.description ?? "Sin descripción"}
          </p>
        </div>
        <Switch
          checked={command.enabled}
          onCheckedChange={(enabled) => toggle.mutate(enabled)}
          disabled={toggle.isPending || remove.isPending}
          aria-label={`Activar el comando ${trigger}`}
          className="mt-0.5"
          data-testid={`switch-command-${command.id}`}
        />
      </CardHeader>

      <CardContent className="flex flex-1 flex-col gap-4 p-4 pt-0 sm:p-5 sm:pt-0">
        <div className="rounded-md border border-border bg-background/40 p-3">
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Responde</p>
          <p className="line-clamp-4 whitespace-pre-wrap break-words text-sm text-foreground" title={command.response}>
            {command.response}
          </p>
        </div>

        <div className="mt-auto flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <div className="min-w-0 text-xs text-muted-foreground">
            <p className="font-mono">{formatUses(command.uses)}</p>
            {created && <p>{created}</p>}
          </div>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => void copyTrigger()}
              aria-label={`Copiar ${trigger}`}
              title={`Copiar ${trigger}`}
              data-testid={`button-copy-command-${command.id}`}
            >
              <Copy />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onEdit(command)}
              disabled={remove.isPending}
              aria-label={`Editar ${trigger}`}
              data-testid={`button-edit-command-${command.id}`}
            >
              <Pencil aria-hidden="true" />
              Editar
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="text-destructive hover:text-destructive"
              onClick={() => setConfirmOpen(true)}
              disabled={remove.isPending}
              aria-label={`Eliminar ${trigger}`}
              title={`Eliminar ${trigger}`}
              data-testid={`button-delete-command-${command.id}`}
            >
              <Trash2 />
            </Button>
          </div>
        </div>
      </CardContent>

      <AlertDialog
        open={confirmOpen}
        onOpenChange={(open) => {
          if (!open && remove.isPending) return;
          setConfirmOpen(open);
        }}
      >
        <AlertDialogContent className="w-[calc(100vw-2rem)] rounded-lg">
          <AlertDialogHeader>
            <AlertDialogTitle className="break-all">
              ¿Eliminar <span className="font-mono text-primary">{trigger}</span>?
            </AlertDialogTitle>
            <AlertDialogDescription>
              El bot dejará de responder a este comando y se perderá su respuesta. No se puede deshacer.
              {!command.enabled ? null : " Si solo quieres pausarlo, mejor apágalo con el interruptor."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>Cancelar</AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              onClick={() => remove.mutate()}
              disabled={remove.isPending}
              data-testid={`button-confirm-delete-${command.id}`}
            >
              {remove.isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Trash2 aria-hidden="true" />}
              {remove.isPending ? "Eliminando…" : "Eliminar"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
