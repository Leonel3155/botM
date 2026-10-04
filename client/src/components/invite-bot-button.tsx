import { UserPlus } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { getBotInviteUrl } from "@/lib/invite";

interface InviteBotButtonProps {
  /** Servidor al que invitar (Discord lo deja elegido) */
  guildId?: string | null;
  size?: ButtonProps["size"];
  variant?: ButtonProps["variant"];
  className?: string;
  label?: string;
}

/** Botón "Invitar bot": abre la invitación de Discord en otra pestaña. */
export function InviteBotButton({
  guildId,
  size = "default",
  variant = "default",
  className,
  label = "Invitar bot",
}: InviteBotButtonProps) {
  const url = getBotInviteUrl(guildId);

  if (!url) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          {/* span: un botón deshabilitado no recibe el hover del tooltip */}
          <span tabIndex={0} className="inline-flex">
            <Button size={size} variant={variant} className={className} disabled data-testid="button-invite-bot">
              <UserPlus />
              {label}
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">
          Falta configurar VITE_DISCORD_CLIENT_ID para generar el enlace de invitación.
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Button asChild size={size} variant={variant} className={className} data-testid="button-invite-bot">
      <a href={url} target="_blank" rel="noopener noreferrer">
        <UserPlus />
        {label}
      </a>
    </Button>
  );
}
