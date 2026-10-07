import { useIsFetching, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { ModerationCommandsHelp } from "@/components/moderacion-seguridad/moderation-commands-help";
import { ModerationHistory } from "@/components/moderacion-seguridad/moderation-history";
import { ModerationSummary } from "@/components/moderacion-seguridad/moderation-summary";
import {
  analyticsKey,
  dashboardStatsKey,
  moderationActionsKey,
} from "@/components/moderacion-seguridad/query-keys";
import { useSelectedGuild } from "@/lib/guild";
import { cn } from "@/lib/utils";

/**
 * Moderación: historial real de lo que hizo el equipo con los comandos del bot
 * (GET /api/moderation/:guildId/actions), totales del servidor y ayuda de los comandos.
 */
export default function Moderation() {
  const { guildId } = useSelectedGuild();
  const queryClient = useQueryClient();
  const fetchingHistory = useIsFetching({ queryKey: moderationActionsKey(guildId) });
  const fetchingStats = useIsFetching({ queryKey: dashboardStatsKey(guildId) });
  const refreshing = fetchingHistory + fetchingStats > 0;

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: moderationActionsKey(guildId) });
    void queryClient.invalidateQueries({ queryKey: dashboardStatsKey(guildId) });
    void queryClient.invalidateQueries({ queryKey: analyticsKey(guildId) });
  };

  return (
    <div className="space-y-8">
      <PageHeader
        title="Moderación"
        description="Todo lo que tu equipo hace con los comandos de moderación del bot queda guardado aquí."
        actions={
          <Button variant="outline" onClick={refresh} disabled={refreshing} data-testid="button-refresh-moderation">
            <RefreshCw className={cn(refreshing && "animate-spin")} />
            Actualizar
          </Button>
        }
      />

      <ModerationSummary guildId={guildId} />
      <ModerationHistory guildId={guildId} />
      <ModerationCommandsHelp />
    </div>
  );
}
