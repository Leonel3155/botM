import { useMemo } from "react";
import { AlertTriangle, Bot, Eye } from "lucide-react";
import { CUSTOM_COMMAND_LIMITS } from "@shared/api";
import { cn } from "@/lib/utils";
import { buildPreview, hasBlockedMentions, type PlaceholderKey, type PreviewValue } from "./utils";

interface ResponsePreviewProps {
  /** Lo que escribe la persona: "<prefijo><nombre>". */
  trigger: string;
  response: string;
  values: Record<PlaceholderKey, PreviewValue>;
}

/**
 * Vista previa de cómo contestará el bot en Discord. Es texto plano: las variables se
 * cambian por valores de ejemplo (marcados) o por datos reales del servidor si los hay.
 */
export function ResponsePreview({ trigger, response, values }: ResponsePreviewProps) {
  const preview = useMemo(() => buildPreview(response, values), [response, values]);
  const empty = preview.segments.length === 0;
  const usesSamples = preview.segments.some((segment) => segment.kind === "value" && !segment.value.real);
  const tooLong = preview.length > CUSTOM_COMMAND_LIMITS.responseMaxLength;

  return (
    <section
      className="space-y-3 rounded-lg border border-border bg-background/60 p-3 sm:p-4"
      aria-label="Vista previa de la respuesta"
      data-testid="preview-command"
    >
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <Eye className="h-4 w-4 text-primary" aria-hidden="true" />
        Vista previa en Discord
      </div>

      {/* Lo que escribe alguien */}
      <div className="flex items-start gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground" aria-hidden="true">
          A
        </div>
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">
            Alguien <span className="italic">(ejemplo)</span>
          </p>
          <p className="break-all font-mono text-sm text-foreground">{trigger}</p>
        </div>
      </div>

      {/* Lo que contesta el bot */}
      <div className="flex items-start gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary" aria-hidden="true">
          <Bot className="h-4 w-4 text-primary-foreground" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            El bot
            <span className="rounded bg-primary/15 px-1 py-px text-[10px] font-semibold uppercase text-primary">Bot</span>
          </p>
          {empty ? (
            <p className="text-sm italic text-muted-foreground">Escribe la respuesta para verla aquí.</p>
          ) : (
            <p className="whitespace-pre-wrap break-words text-sm text-foreground">
              {preview.segments.map((segment, index) =>
                segment.kind === "text" ? (
                  <span key={index}>{segment.text}</span>
                ) : (
                  <span
                    key={index}
                    title={segment.value.real ? `${segment.placeholder}: dato real de tu servidor` : `${segment.placeholder}: valor de ejemplo`}
                    className={cn(
                      segment.value.mention && "rounded bg-primary/15 px-0.5 font-medium text-primary",
                      !segment.value.real && "underline decoration-primary/70 decoration-dashed underline-offset-4",
                    )}
                  >
                    {segment.value.text}
                  </span>
                ),
              )}
            </p>
          )}
        </div>
      </div>

      {(usesSamples || tooLong || hasBlockedMentions(response)) && (
        <div className="space-y-1.5 border-t border-border pt-3 text-xs text-muted-foreground">
          {usesSamples && (
            <p>
              Lo <span className="underline decoration-primary/70 decoration-dashed underline-offset-4">subrayado</span> es
              de ejemplo: en Discord verás los datos reales de quien use el comando.
            </p>
          )}
          {hasBlockedMentions(response) && (
            <p className="flex items-start gap-1.5 text-status-warning">
              <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              El texto se verá, pero el bot no notifica a @everyone, @here ni a roles desde un comando (solo menciona personas).
            </p>
          )}
          {tooLong && (
            <p className="flex items-start gap-1.5 text-status-warning">
              <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              Con las variables puede pasar de {CUSTOM_COMMAND_LIMITS.responseMaxLength.toLocaleString("es-MX")} caracteres;
              si pasa, el bot la enviará recortada.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
