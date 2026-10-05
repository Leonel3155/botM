import type { ReactNode } from "react";
import type { UserRef } from "@shared/api";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { initials } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { userAvatarUrl, userName } from "./utils";

interface UserCellProps {
  user: UserRef;
  /** Muestra el ID de Discord debajo del nombre */
  showId?: boolean;
  size?: "sm" | "md";
  /** Algo a la derecha del nombre (p. ej. un botón para filtrar) */
  trailing?: ReactNode;
  className?: string;
}

/** Avatar + nombre de una persona de Discord (con su ID en monoespaciada). */
export function UserCell({ user, showId = true, size = "md", trailing, className }: UserCellProps) {
  const name = userName(user);
  const src = userAvatarUrl(user, size === "sm" ? 32 : 64);
  return (
    <div className={cn("flex min-w-0 items-center gap-2", className)}>
      <Avatar className={cn(size === "sm" ? "h-6 w-6 text-[10px]" : "h-8 w-8 text-xs")}>
        {src && <AvatarImage src={src} alt="" />}
        <AvatarFallback className="bg-primary/15 font-semibold text-primary">
          {user.username ? initials(user.username) : "?"}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0">
        <p
          className={cn("truncate text-foreground", size === "sm" ? "text-xs" : "text-sm font-medium", !user.username && "italic text-muted-foreground")}
          title={name}
        >
          {name}
        </p>
        {showId && <p className="truncate font-mono text-[11px] text-muted-foreground">{user.id}</p>}
      </div>
      {trailing}
    </div>
  );
}
