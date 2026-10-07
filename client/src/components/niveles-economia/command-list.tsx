import { Fragment } from "react";

/** Un comando del bot tal como está programado (server/bot/commands). */
export interface BotCommandInfo {
  /** Nombre sin "/" ni prefijo, p. ej. "daily". */
  name: string;
  /** "slash" = comando de barra (/daily); "prefix" = solo con prefijo (&lot). */
  kind?: "slash" | "prefix";
  /** Opciones, p. ej. "<cantidad|todo>" ([] = opcional). */
  args?: string;
  description: string;
  /** Atajos con prefijo que hacen lo mismo (sin el prefijo), p. ej. ["bal"]. */
  prefixAliases?: string[];
}

function CommandName({ text }: { text: string }) {
  return <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-sm text-primary">{text}</code>;
}

/** Lista de comandos. `prefix` es el prefijo real del servidor (por defecto "&"). */
export function CommandList({ commands, prefix }: { commands: BotCommandInfo[]; prefix: string }) {
  return (
    <ul className="divide-y divide-border">
      {commands.map((command) => {
        const label = command.kind === "prefix" ? `${prefix}${command.name}` : `/${command.name}`;
        return (
          <li key={label} className="space-y-1 py-3 first:pt-0 last:pb-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <CommandName text={label} />
              {command.args && <code className="font-mono text-xs text-muted-foreground">{command.args}</code>}
            </div>
            <p className="text-sm text-muted-foreground">{command.description}</p>
            {command.prefixAliases && command.prefixAliases.length > 0 && (
              <p className="text-xs text-muted-foreground">
                También con prefijo:{" "}
                {command.prefixAliases.map((alias, index) => (
                  <Fragment key={alias}>
                    {index > 0 && ", "}
                    <code className="font-mono text-foreground">
                      {prefix}
                      {alias}
                    </code>
                  </Fragment>
                ))}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
