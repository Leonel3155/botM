import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Construction } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";

interface ComingSoonProps {
  title: string;
  description: string;
  icon?: LucideIcon;
  /** Qué puede hacer la persona mientras tanto (opcional) */
  meanwhile?: ReactNode;
}

/** Página que aún no está lista: lo dice tal cual, sin datos de ejemplo. */
export function ComingSoon({ title, description, icon = Construction, meanwhile }: ComingSoonProps) {
  return (
    <div className="space-y-6">
      <PageHeader title={title} description={description} />
      <EmptyState
        icon={icon}
        title="Próximamente"
        description={
          <>
            <p>Esta sección del panel todavía se está construyendo.</p>
            {meanwhile && <div className="mt-3">{meanwhile}</div>}
          </>
        }
        testId="state-coming-soon"
      />
    </div>
  );
}
