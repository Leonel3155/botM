import { Compass } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";

export default function NotFound() {
  return (
    <EmptyState
      icon={Compass}
      title="No encontramos esta página"
      description="Puede que el enlace esté mal escrito o que la página ya no exista."
      action={
        <Button asChild>
          <Link href="/">Volver al resumen</Link>
        </Button>
      }
      testId="state-not-found"
    />
  );
}
