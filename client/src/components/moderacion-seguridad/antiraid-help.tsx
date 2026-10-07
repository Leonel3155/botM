import { Link } from "wouter";
import { BookOpen, Lock } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

// Los subcomandos que define el bot en server/bot/commands/antiraid.ts
const ANTIRAID_COMMANDS: { usage: string; description: string }[] = [
  { usage: "/antiraid status", description: "Muestra si la protección está activa, cómo está configurada y si hay un modo raid en curso." },
  { usage: "/antiraid activar", description: "Enciende la protección (lo mismo que el interruptor de esta página)." },
  { usage: "/antiraid desactivar", description: "La apaga. Si hay un modo raid en curso, también lo termina." },
  { usage: "/antiraid configurar", description: "Cambia las entradas, los segundos, la acción, el canal, la duración o la edad de cuenta." },
  { usage: "/antiraid levantar", description: "Termina ya el modo raid activo, igual que el botón «Terminar modo raid»." },
];

/** Cómo funciona la protección y cómo manejarla desde Discord. */
export function AntiRaidHelp() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BookOpen className="h-5 w-5 text-primary" aria-hidden="true" />
          ¿Cómo funciona?
        </CardTitle>
        <CardDescription>
          Un raid es cuando muchas cuentas entran de golpe para llenar el servidor de spam. El bot cuenta las entradas y, si
          pasan del límite, activa el «modo raid» por un rato y avisa al staff.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <ol className="space-y-2 text-sm text-muted-foreground">
          <li className="flex gap-2">
            <span className="font-mono font-semibold text-primary">1.</span>
            <span>Detecta la ráfaga de entradas según tus ajustes.</span>
          </li>
          <li className="flex gap-2">
            <span className="font-mono font-semibold text-primary">2.</span>
            <span>Aplica la acción que elegiste y guarda el raid en el historial.</span>
          </li>
          <li className="flex gap-2">
            <span className="font-mono font-semibold text-primary">3.</span>
            <span>Al cumplirse el tiempo (o si lo terminas tú) todo vuelve a como estaba y el bot avisa al staff.</span>
          </li>
        </ol>

        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-foreground">También desde Discord</h3>
          <ul className="space-y-2">
            {ANTIRAID_COMMANDS.map((command) => (
              <li key={command.usage} className="rounded-md border border-border bg-background/40 p-3">
                <code className="font-mono text-sm font-semibold text-primary">{command.usage}</code>
                <p className="mt-1 text-xs text-muted-foreground">{command.description}</p>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">Solo los pueden usar personas con el permiso Gestionar servidor.</p>
        </div>

        <p className="flex items-start gap-2 rounded-md border border-border bg-background/40 p-3 text-xs text-muted-foreground">
          <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
          <span>
            ¿Solo quieres cerrar un canal? Usa <code className="font-mono text-foreground">/lockdown</code> dentro de ese canal. Lo
            verás en{" "}
            <Link href="/moderacion" className="text-primary underline-offset-4 hover:underline">
              Moderación
            </Link>
            .
          </span>
        </p>
      </CardContent>
    </Card>
  );
}
