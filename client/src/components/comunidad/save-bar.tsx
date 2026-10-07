import { Loader2, Save, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface SaveBarProps {
  /** Qué secciones tienen cambios, p. ej. ["Bienvenida"] */
  sections: string[];
  saving: boolean;
  onSave: () => void;
  onDiscard: () => void;
}

/** Barra fija abajo cuando hay cambios sin guardar. */
export function SaveBar({ sections, saving, onSave, onDiscard }: SaveBarProps) {
  const which = sections.length === 2 ? `${sections[0]} y ${sections[1]}` : sections.join(", ");
  return (
    <div className="sticky bottom-4 z-20" role="region" aria-label="Cambios sin guardar" data-testid="bar-unsaved">
      <div className="flex flex-col gap-3 rounded-xl border border-primary/60 bg-card/95 p-4 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-card/85 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-1.5 h-2 w-2 shrink-0 animate-pulse rounded-full bg-primary" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">Tienes cambios sin guardar</p>
            {which && <p className="text-xs text-muted-foreground">En {which}. El bot sigue con lo anterior hasta que guardes.</p>}
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button
            type="button"
            variant="outline"
            className="flex-1 sm:flex-none"
            onClick={onDiscard}
            disabled={saving}
            data-testid="button-discard"
          >
            <Undo2 />
            Descartar
          </Button>
          <Button type="button" className="flex-1 sm:flex-none" onClick={onSave} disabled={saving} data-testid="button-save">
            {saving ? <Loader2 className="animate-spin" /> : <Save />}
            {saving ? "Guardando…" : "Guardar"}
          </Button>
        </div>
      </div>
    </div>
  );
}
