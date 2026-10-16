import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2, Pencil, Plus, RefreshCw, ShoppingBag, Trash2 } from "lucide-react";
import {
  SHOP_LIMITS,
  type DiscordRolesResponse,
  type ShopItemItem,
  type ShopItemSaveRequest,
  type ShopItemsResponse,
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
import { Select, SelectContent, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ApiErrorState } from "@/components/api-error-state";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { RichSelectItem } from "@/components/comunidad/rich-select-item";
import { roleLabel } from "@/components/comunidad/role-field";
import { formatCoins } from "@/components/niveles-economia/format";
import { errorMessage } from "@/components/comandos/utils";
import { useToast } from "@/hooks/use-toast";
import { useBotAvailability } from "@/components/ajustes-resumen/bot-status";
import { useSelectedGuild } from "@/lib/guild";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";

const shopKey = (guildId: string) => ["/api/shop", guildId] as const;
const rolesKey = (guildId: string) => ["/api/guilds", guildId, "discord-roles"] as const;
const NO_ROLE = "__sin_rol__";

// ===== Formulario =====

interface Draft {
  name: string;
  emoji: string;
  description: string;
  price: string;
  roleId: string | null;
  stock: string; // vacío = ilimitado
  enabled: boolean;
}

const EMPTY_DRAFT: Draft = { name: "", emoji: "", description: "", price: "", roleId: null, stock: "", enabled: true };

function draftFrom(item: ShopItemItem | null): Draft {
  if (!item) return EMPTY_DRAFT;
  return {
    name: item.name,
    emoji: item.emoji ?? "",
    description: item.description ?? "",
    price: String(item.price),
    roleId: item.roleId,
    stock: item.stock === null ? "" : String(item.stock),
    enabled: item.enabled,
  };
}

/** Número entero escrito por la persona ("1500", "1,500"), o null si no lo es. */
function parseWhole(text: string): number | null {
  const clean = text.trim().replace(/[,.\s]/g, "");
  if (!/^\d+$/.test(clean)) return null;
  const value = Number(clean);
  return Number.isSafeInteger(value) ? value : null;
}

function toRequest(draft: Draft): ShopItemSaveRequest | string {
  const name = draft.name.trim();
  if (!name) return "Ponle un nombre al artículo.";
  const emoji = draft.emoji.trim();
  if (emoji && !isValidButtonEmoji(emoji)) return "El emoji no es válido: pon uno solo (por ejemplo 🎟️).";
  const price = parseWhole(draft.price);
  if (price === null || price < 1) return "El precio debe ser un número entero de al menos 1 moneda.";
  if (price > SHOP_LIMITS.maxPrice) return `El precio puede ser como máximo ${formatCoins(SHOP_LIMITS.maxPrice)}.`;
  let stock: number | null = null;
  if (draft.stock.trim()) {
    stock = parseWhole(draft.stock);
    if (stock === null) return "Las unidades deben ser un número entero (o déjalo vacío para que no se acaben).";
    if (stock > SHOP_LIMITS.maxStock) return `Como máximo ${SHOP_LIMITS.maxStock.toLocaleString("es-MX")} unidades.`;
  }
  return {
    name,
    emoji: emoji || null,
    description: draft.description.trim() || null,
    price,
    roleId: draft.roleId,
    stock,
    enabled: draft.enabled,
  };
}

interface ItemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  guildId: string;
  item: ShopItemItem | null;
  roles: DiscordRolesResponse | undefined;
}

function ItemDialog({ open, onOpenChange, guildId, item, roles }: ItemDialogProps) {
  const { toast } = useToast();
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setDraft(draftFrom(item));
      setError(null);
    }
  }, [open, item]);

  const selectedRole = draft.roleId ? roles?.find((role) => role.id === draft.roleId) : undefined;

  const save = useMutation({
    mutationFn: async (body: Partial<ShopItemSaveRequest>): Promise<ShopItemItem> => {
      const res = item
        ? await apiRequest("PATCH", `/api/shop/${guildId}/${item.id}`, body)
        : await apiRequest("POST", `/api/shop/${guildId}`, body);
      return (await res.json()) as ShopItemItem;
    },
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: shopKey(guildId) });
      toast({ title: item ? "Artículo guardado" : "Artículo agregado", description: `«${saved.name}» ya está en la tienda.` });
      onOpenChange(false);
    },
    onError: (err) => setError(errorMessage(err)),
  });

  const submit = () => {
    const request = toRequest(draft);
    if (typeof request === "string") {
      setError(request);
      return;
    }
    setError(null);
    // Al editar, las unidades solo se mandan si se cambiaron: /comprar las va bajando mientras tanto
    // y la lista de aquí puede traer un número viejo (que regresaría unidades ya vendidas)
    const body: Partial<ShopItemSaveRequest> = { ...request };
    if (item && request.stock === item.stock) delete body.stock;
    save.mutate(body);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !save.isPending && onOpenChange(next)}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{item ? "Editar artículo" : "Nuevo artículo"}</DialogTitle>
          <DialogDescription>Se compra en Discord con /comprar, con las monedas de la cartera.</DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="grid grid-cols-[5rem_1fr] gap-2">
            <div className="space-y-2">
              <Label htmlFor="item-emoji">Emoji</Label>
              <Input
                id="item-emoji"
                value={draft.emoji}
                placeholder="🎟️"
                maxLength={SHOP_LIMITS.emojiMaxLength}
                onChange={(event) => setDraft((d) => ({ ...d, emoji: event.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="item-name">Nombre</Label>
              <Input
                id="item-name"
                value={draft.name}
                placeholder="Rol VIP"
                maxLength={SHOP_LIMITS.nameMaxLength}
                onChange={(event) => setDraft((d) => ({ ...d, name: event.target.value }))}
                data-testid="input-item-name"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="item-description">Descripción (opcional)</Label>
            <Textarea
              id="item-description"
              value={draft.description}
              maxLength={SHOP_LIMITS.descriptionMaxLength}
              placeholder="Qué es o para qué sirve"
              onChange={(event) => setDraft((d) => ({ ...d, description: event.target.value }))}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="item-price">Precio (monedas)</Label>
              <Input
                id="item-price"
                inputMode="numeric"
                value={draft.price}
                placeholder="5000"
                onChange={(event) => setDraft((d) => ({ ...d, price: event.target.value }))}
                data-testid="input-item-price"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="item-stock">Unidades</Label>
              <Input
                id="item-stock"
                inputMode="numeric"
                value={draft.stock}
                placeholder="Sin límite"
                onChange={(event) => setDraft((d) => ({ ...d, stock: event.target.value }))}
              />
              <p className="text-xs text-muted-foreground">Vacío = nunca se acaba.</p>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Rol que da al comprarlo (opcional)</Label>
            <Select
              value={draft.roleId ?? NO_ROLE}
              onValueChange={(value) => setDraft((d) => ({ ...d, roleId: value === NO_ROLE ? null : value }))}
              disabled={!roles}
            >
              <SelectTrigger data-testid="select-item-role">
                <SelectValue placeholder={roles ? "Sin rol" : "Cargando roles…"} />
              </SelectTrigger>
              <SelectContent className="max-h-80">
                <RichSelectItem value={NO_ROLE} hint="Va al inventario de quien lo compra">
                  Sin rol
                </RichSelectItem>
                {(roles ?? []).length > 0 && <SelectSeparator />}
                {(roles ?? []).map((role) => (
                  <RichSelectItem
                    key={role.id}
                    value={role.id}
                    disabled={!role.assignable}
                    hint={role.assignable ? undefined : role.reason ?? "No se puede usar"}
                  >
                    @{role.name}
                  </RichSelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Con rol, cada persona lo compra una sola vez y se lo doy al momento. Sin rol, se guarda en su /inventario.
            </p>
            {selectedRole && !selectedRole.assignable && (
              <p className="text-xs text-destructive">{selectedRole.reason}</p>
            )}
          </div>

          <div className="flex items-start justify-between gap-4 rounded-md border border-border p-3">
            <div>
              <Label htmlFor="item-enabled">A la venta</Label>
              <p className="text-sm text-muted-foreground">Apágalo para esconderlo de /tienda sin borrarlo.</p>
            </div>
            <Switch
              id="item-enabled"
              checked={draft.enabled}
              onCheckedChange={(enabled) => setDraft((d) => ({ ...d, enabled }))}
            />
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
          <Button onClick={submit} disabled={save.isPending} data-testid="button-save-item">
            {save.isPending && <Loader2 className="animate-spin" />}
            {item ? "Guardar" : "Agregar a la tienda"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ===== Tarjeta de un artículo =====

interface ItemCardProps {
  guildId: string;
  item: ShopItemItem;
  roles: DiscordRolesResponse | undefined;
  botInGuild: boolean;
  onEdit: (item: ShopItemItem) => void;
}

function ItemCard({ guildId, item, roles, botInGuild, onEdit }: ItemCardProps) {
  const { toast } = useToast();
  const [confirming, setConfirming] = useState(false);
  const role = roleLabel(roles, item.roleId);

  const toggle = useMutation({
    mutationFn: async (enabled: boolean) => {
      await apiRequest("PATCH", `/api/shop/${guildId}/${item.id}`, { enabled });
    },
    onSuccess: (_data, enabled) => {
      void queryClient.invalidateQueries({ queryKey: shopKey(guildId) });
      toast({ title: enabled ? `«${item.name}» está a la venta` : `«${item.name}» ya no sale en la tienda` });
    },
    onError: (err) => toast({ title: "No se pudo cambiar", description: errorMessage(err), variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", `/api/shop/${guildId}/${item.id}`);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: shopKey(guildId) });
      toast({ title: "Artículo borrado" });
      setConfirming(false);
    },
    onError: (err) => toast({ title: "No se pudo borrar", description: errorMessage(err), variant: "destructive" }),
  });

  return (
    <Card className={cn(!item.enabled && "opacity-70")} data-testid={`card-item-${item.id}`}>
      <CardHeader className="space-y-1 p-4 sm:p-6">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-lg">
            {item.emoji && !item.emoji.startsWith("<") && <span className="mr-1.5" aria-hidden="true">{item.emoji}</span>}
            {item.name}
          </CardTitle>
          <Switch
            checked={item.enabled}
            onCheckedChange={(enabled) => toggle.mutate(enabled)}
            disabled={toggle.isPending || !botInGuild}
            aria-label={item.enabled ? "Quitar de la venta" : "Poner a la venta"}
          />
        </div>
        <CardDescription className="font-mono text-base text-primary">{formatCoins(item.price)}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 p-4 pt-0 sm:p-6 sm:pt-0">
        {item.description && <p className="text-sm text-muted-foreground">{item.description}</p>}
        <div className="flex flex-wrap gap-2">
          {item.roleId && <Badge variant="secondary">Da {role ?? "un rol que ya no existe"}</Badge>}
          <Badge variant="outline">
            {item.stock === null ? "Sin límite" : item.stock === 0 ? "Agotado" : `Quedan ${item.stock.toLocaleString("es-MX")}`}
          </Badge>
          <Badge variant="outline">Vendidos: {item.sold.toLocaleString("es-MX")}</Badge>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => onEdit(item)} disabled={!botInGuild}>
            <Pencil />
            Editar
          </Button>
          <Button variant="outline" size="sm" onClick={() => setConfirming(true)} className="text-destructive">
            <Trash2 />
            Borrar
          </Button>
        </div>
      </CardContent>

      <AlertDialog open={confirming} onOpenChange={(next) => !remove.isPending && setConfirming(next)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Borrar «{item.name}»?</AlertDialogTitle>
            <AlertDialogDescription>
              Desaparece de la tienda y de los inventarios de quien lo compró. Los roles que ya se dieron se quedan. Si solo
              quieres dejar de venderlo, mejor apaga el interruptor.
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

export default function Tienda() {
  const { guildId, guild } = useSelectedGuild();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ShopItemItem | null>(null);
  const availability = useBotAvailability(guildId, guild?.botInGuild);
  const botInGuild = availability.canEdit;

  const query = useQuery<ShopItemsResponse>({ queryKey: shopKey(guildId), staleTime: 0 });
  const rolesQuery = useQuery<DiscordRolesResponse>({ queryKey: rolesKey(guildId), enabled: botInGuild, staleTime: 60_000 });

  const items = useMemo(() => query.data?.items ?? [], [query.data?.items]);
  const maxItems = query.data?.maxItems ?? SHOP_LIMITS.maxItemsPerGuild;
  const atLimit = items.length >= maxItems;

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };
  const openEdit = (item: ShopItemItem) => {
    setEditing(item);
    setDialogOpen(true);
  };

  const header = (
    <PageHeader
      title="Tienda"
      description="Lo que se puede comprar con monedas: roles, boletos o lo que se te ocurra. Se compra en Discord con /comprar."
      actions={
        <>
          <Button variant="outline" onClick={() => void query.refetch()} disabled={query.isFetching}>
            <RefreshCw className={cn(query.isFetching && "animate-spin")} />
            Actualizar
          </Button>
          {query.data && (
            <Button onClick={openCreate} disabled={atLimit || !botInGuild} data-testid="button-new-item">
              <Plus />
              Nuevo artículo
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
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-48 rounded-xl" />
          ))}
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

      {!query.data.economyEnabled && (
        <Alert>
          <AlertDescription>
            La economía está apagada (en Economía), así que /tienda y /comprar avisan que está desactivada. Puedes preparar
            los artículos mientras tanto.
          </AlertDescription>
        </Alert>
      )}
      {!botInGuild && (
        <Alert>
          <AlertDescription>{availability.blocked}</AlertDescription>
        </Alert>
      )}
      {atLimit && (
        <Alert>
          <AlertDescription>Ya tienes {maxItems} artículos, el máximo. Borra uno para agregar otro.</AlertDescription>
        </Alert>
      )}

      {items.length === 0 ? (
        <EmptyState
          icon={ShoppingBag}
          title="La tienda está vacía"
          description="Agrega lo primero que se pueda comprar. Una buena idea para empezar: un rol con color especial."
          action={
            <Button onClick={openCreate} disabled={!botInGuild}>
              <Plus />
              Agregar mi primer artículo
            </Button>
          }
          testId="state-no-items"
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3" data-testid="list-items">
          {items.map((item) => (
            <ItemCard
              key={item.id}
              guildId={guildId}
              item={item}
              roles={rolesQuery.data}
              botInGuild={botInGuild}
              onEdit={openEdit}
            />
          ))}
        </div>
      )}

      <ItemDialog open={dialogOpen} onOpenChange={setDialogOpen} guildId={guildId} item={editing} roles={rolesQuery.data} />
    </div>
  );
}
