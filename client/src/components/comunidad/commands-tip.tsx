import { Lightbulb } from "lucide-react";

const COMMANDS = [
  { name: "/bienvenida", description: "Canal, mensaje, rol automático, activar, desactivar y probar." },
  { name: "/pregunta-del-dia", description: "Canal, hora, zona horaria, activar o publicar una ahora mismo." },
  { name: "/anuncio", description: "Publica un anuncio con buen formato en el canal que elijas." },
  { name: "/evento", description: "Crea un evento del servidor y lo anuncia (usa la misma zona horaria)." },
] as const;

/** Recordatorio de los comandos de Discord que hacen lo mismo que esta página (y un poco más). */
export function CommandsTip() {
  return (
    <aside
      className="rounded-xl border border-primary/30 bg-primary/5 p-4 md:p-6"
      aria-labelledby="comunidad-tip-title"
      data-testid="tip-commands"
    >
      <div className="flex items-start gap-3">
        <Lightbulb className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
        <div className="min-w-0 space-y-3">
          <div>
            <h2 id="comunidad-tip-title" className="font-semibold text-foreground">
              ¿Prefieres hacerlo desde Discord?
            </h2>
            <p className="text-sm text-muted-foreground">
              Con estos comandos también puedes animar el servidor sin abrir el panel:
            </p>
          </div>
          <ul className="grid grid-cols-1 gap-x-6 gap-y-2 md:grid-cols-2">
            {COMMANDS.map((command) => (
              <li key={command.name} className="flex min-w-0 flex-col gap-0.5 text-sm sm:flex-row sm:gap-2">
                <code className="shrink-0 font-mono font-medium text-primary">{command.name}</code>
                <span className="text-muted-foreground">{command.description}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </aside>
  );
}
