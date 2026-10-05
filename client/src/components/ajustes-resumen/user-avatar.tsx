import type { UserRef } from "@shared/api";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { initials } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { userAvatarSrc, userName } from "./format";

/** Avatar de un miembro (de la base de datos del bot), o sus iniciales si no tiene. */
export function UserAvatar({ user, className }: { user: UserRef; className?: string }) {
  const src = userAvatarSrc(user);
  return (
    <Avatar className={cn("h-8 w-8", className)}>
      {src && <AvatarImage src={src} alt="" />}
      <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">
        {initials(userName(user))}
      </AvatarFallback>
    </Avatar>
  );
}
