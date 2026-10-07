import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { initials } from "@/lib/auth";
import { cn } from "@/lib/utils";

/** Cuántas personas se pueden pedir a /top (el servidor acepta de 1 a 100). */
export const TOP_LIMIT_OPTIONS = [10, 25, 50, 100] as const;
export type TopLimit = (typeof TOP_LIMIT_OPTIONS)[number];

export function TopLimitSelect({
  id,
  value,
  onChange,
  disabled,
}: {
  id: string;
  value: TopLimit;
  onChange: (value: TopLimit) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <Label htmlFor={id} className="whitespace-nowrap text-xs font-normal text-muted-foreground">
        Mostrar
      </Label>
      <Select
        value={String(value)}
        onValueChange={(next) => {
          const parsed = TOP_LIMIT_OPTIONS.find((option) => String(option) === next);
          if (parsed) onChange(parsed);
        }}
        disabled={disabled}
      >
        <SelectTrigger id={id} className="h-8 w-[6.5rem]" data-testid={`select-${id}`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {TOP_LIMIT_OPTIONS.map((option) => (
            <SelectItem key={option} value={String(option)}>
              Top {option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

const DISCORD_ID = /^\d{17,20}$/;

/** Avatar de Discord de una persona, o sus iniciales si no tiene foto. */
export function UserAvatar({
  userId,
  avatar,
  name,
  className,
}: {
  userId: string;
  avatar: string | null;
  name: string;
  className?: string;
}) {
  const src =
    avatar && DISCORD_ID.test(userId)
      ? `https://cdn.discordapp.com/avatars/${userId}/${encodeURIComponent(avatar)}.png?size=64`
      : null;
  return (
    <Avatar className={cn("h-9 w-9", className)}>
      {src && <AvatarImage src={src} alt="" />}
      <AvatarFallback className="bg-primary/15 text-xs font-semibold text-primary">{initials(name)}</AvatarFallback>
    </Avatar>
  );
}

/** Puesto en el ranking: oro, plata y bronce para los tres primeros. */
export function RankBadge({ rank }: { rank: number }) {
  const tone =
    rank === 1
      ? "bg-primary text-primary-foreground"
      : rank === 2
        ? "bg-zinc-300 text-black"
        : rank === 3
          ? "bg-amber-700 text-white"
          : "bg-muted text-muted-foreground";
  return (
    <span
      className={cn(
        "flex h-8 min-w-8 shrink-0 items-center justify-center rounded-full px-1.5 font-mono text-sm font-bold",
        tone,
      )}
    >
      <span className="sr-only">Puesto </span>
      {rank}
    </span>
  );
}

/** Nombre para mostrar (la base de datos puede no tener el nombre de alguien). */
export function displayUserName(username: string | null): string {
  return username?.trim() || "Usuario sin nombre guardado";
}

export function RankingSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Cargando ranking">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="h-8 w-8 rounded-full" />
          <Skeleton className="h-9 w-9 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-2 w-full" />
          </div>
        </div>
      ))}
    </div>
  );
}
