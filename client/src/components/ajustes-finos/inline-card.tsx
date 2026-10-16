import type { ReactNode } from "react";
import { Loader2, Save, Timer } from "lucide-react";
import type { TuningNumberKey } from "@shared/tuning";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useBotAvailability } from "@/components/ajustes-resumen/bot-status";
import { useSelectedGuild } from "@/lib/guild";
import { NumberSetting, useTuningDraft } from "./shared";

interface InlineField {
  field: TuningNumberKey;
  suffix?: string;
  hint?: ReactNode;
}

interface TuningInlineCardProps {
  guildId: string;
  title: string;
  description?: ReactNode;
  fields: InlineField[];
}

/** Tarjeta chica con uno o dos ajustes numéricos y su propio botón de guardar (para páginas que ya tienen otra barra). */
export function TuningInlineCard({ guildId, title, description, fields }: TuningInlineCardProps) {
  const { guild } = useSelectedGuild();
  const { blocked } = useBotAvailability(guildId, guild?.botInGuild);
  const editor = useTuningDraft(guildId, fields.map((item) => item.field));
  const { draft } = editor;
  return (
    <Card>
      <CardHeader className="p-4 sm:p-6">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Timer className="h-5 w-5 text-primary" aria-hidden="true" />
          {title}
        </CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="space-y-4 p-4 pt-0 sm:p-6 sm:pt-0">
        {!draft ? (
          <p className="text-sm text-muted-foreground">{editor.query.isError ? "No se pudo cargar este ajuste." : "Cargando…"}</p>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {fields.map(({ field, suffix, hint }) => (
                <NumberSetting
                  key={field}
                  field={field}
                  value={draft[field] as number}
                  onChange={(value) => editor.update({ [field]: value } as Parameters<typeof editor.update>[0])}
                  suffix={suffix}
                  hint={hint}
                />
              ))}
            </div>
            {editor.error && <Alert variant="destructive" role="alert"><AlertDescription>{editor.error}</AlertDescription></Alert>}
            {editor.changed.length > 0 && (
              blocked ? (
                <p className="text-sm text-muted-foreground">{blocked}</p>
              ) : (
                <div className="flex gap-2">
                  <Button type="button" size="sm" onClick={editor.save} disabled={editor.saving} data-testid={`button-save-${fields[0].field}`}>
                    {editor.saving ? <Loader2 className="animate-spin" /> : <Save />}
                    {editor.saving ? "Guardando…" : "Guardar"}
                  </Button>
                  <Button type="button" size="sm" variant="outline" onClick={editor.discard} disabled={editor.saving}>
                    Descartar
                  </Button>
                </div>
              )
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
