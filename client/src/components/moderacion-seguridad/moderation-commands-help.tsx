import { Info, Terminal } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ActionBadge } from "./moderation-meta";

interface CommandHelp {
  /** Cómo se escribe en Discord */
  usage: string;
  /** Tipo con el que queda en el historial (null = no se guarda) */
  logsAs: string | null;
  description: string;
  /** Permiso de Discord que hace falta para verlo y usarlo */
  permission: string;
}

// Los mismos comandos que define el bot en server/bot/commands/moderation.ts
const MODERATION_COMMANDS: CommandHelp[] = [
  {
    usage: "/warn usuario [razon]",
    logsAs: "warn",
    description: "Deja una advertencia con su motivo. No castiga a nadie, pero queda en el historial para que el equipo lo tenga en cuenta.",
    permission: "Moderar miembros",
  },
  {
    usage: "/warnings usuario",
    logsAs: null,
    description: "Muestra las advertencias de una persona (las 10 más recientes) y cuántos silencios, expulsiones y baneos tiene.",
    permission: "Moderar miembros",
  },
  {
    usage: "/mute usuario minutos",
    logsAs: "mute",
    description: "Aísla a alguien de 1 minuto a 1 semana (el aislamiento de Discord): no puede escribir, reaccionar ni hablar en voz. Discord se lo quita solo al terminar el tiempo, aunque el bot se reinicie o la persona salga y vuelva a entrar.",
    permission: "Moderar miembros",
  },
  {
    usage: "/unmute usuario",
    logsAs: "unmute",
    description: "Quita el silencio antes de tiempo.",
    permission: "Moderar miembros",
  },
  {
    usage: "/kick usuario [razon]",
    logsAs: "kick",
    description: "Saca a alguien del servidor. Puede volver a entrar si tiene una invitación.",
    permission: "Expulsar miembros",
  },
  {
    usage: "/ban usuario [razon]",
    logsAs: "ban",
    description: "Saca a alguien del servidor y no le deja volver a entrar.",
    permission: "Banear miembros",
  },
  {
    usage: "/clear cantidad",
    logsAs: "clear",
    description: "Borra de 1 a 100 mensajes recientes del canal donde lo uses. Discord no deja borrar así mensajes de más de 14 días.",
    permission: "Gestionar mensajes",
  },
  {
    usage: "/lockdown accion",
    logsAs: "lockdown",
    description: "Con «Activar» cierra el canal donde lo uses (y sus hilos) para que solo el staff escriba. Con «Desactivar» lo vuelve a abrir.",
    permission: "Gestionar canales",
  },
];

/** Ayuda: qué hace cada comando de moderación del bot. */
export function ModerationCommandsHelp() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Terminal className="h-5 w-5 text-primary" aria-hidden="true" />
          Comandos de moderación
        </CardTitle>
        <CardDescription>
          Se usan en Discord escribiendo <code className="font-mono text-foreground">/</code>. La respuesta del bot solo la ve
          quien usó el comando, y cada acción aparece en el historial de arriba.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2" data-testid="list-moderation-commands">
          {MODERATION_COMMANDS.map((command) => (
            <li key={command.usage} className="flex flex-col gap-2 rounded-lg border border-border bg-background/40 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <code className="break-all font-mono text-sm font-semibold text-primary">{command.usage}</code>
                {command.logsAs ? (
                  <ActionBadge type={command.logsAs} />
                ) : (
                  <span className="text-xs text-muted-foreground">Solo consulta</span>
                )}
              </div>
              <p className="text-sm text-muted-foreground">{command.description}</p>
              <p className="text-xs text-muted-foreground">
                Permiso: <span className="text-foreground">{command.permission}</span>
              </p>
            </li>
          ))}
        </ul>
        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
          <span>
            Discord solo muestra cada comando a quien tiene ese permiso; puedes cambiar quién los ve en Ajustes del servidor →
            Integraciones → el bot. Además, el bot pide un rol llamado Moderador, Admin o Staff, o algún permiso de
            moderación. Lo que va entre corchetes, como la razón, es opcional.
          </span>
        </p>
      </CardContent>
    </Card>
  );
}
