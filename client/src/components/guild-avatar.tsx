import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { initials } from "@/lib/auth";
import { guildIconUrl, type UserGuild } from "@/lib/guild";
import { cn } from "@/lib/utils";

const sizes = {
  xs: { box: "h-6 w-6 text-[10px]", px: 32 },
  sm: { box: "h-8 w-8 text-xs", px: 64 },
  md: { box: "h-10 w-10 text-sm", px: 64 },
  lg: { box: "h-14 w-14 text-lg", px: 128 },
} as const;

interface GuildAvatarProps {
  guild: Pick<UserGuild, "id" | "name" | "icon">;
  size?: keyof typeof sizes;
  className?: string;
}

/** Icono del servidor de Discord, o sus iniciales si no tiene. */
export function GuildAvatar({ guild, size = "md", className }: GuildAvatarProps) {
  const { box, px } = sizes[size];
  const src = guildIconUrl(guild, px);
  return (
    <Avatar className={cn("rounded-lg after:rounded-lg", box, className)}>
      {src && <AvatarImage src={src} alt="" className="rounded-lg" />}
      <AvatarFallback className="rounded-lg bg-primary/15 font-semibold text-primary">
        {initials(guild.name)}
      </AvatarFallback>
    </Avatar>
  );
}
