import { MessageCircleHeart } from "lucide-react";
import { ComingSoon } from "@/components/coming-soon";

// Página pendiente: configuración de bienvenida y pregunta del día desde el panel.
export default function Comunidad() {
  return (
    <ComingSoon
      title="Bienvenida y pregunta del día"
      description="Saluda a quien llega y lanza una pregunta diaria para animar la conversación."
      icon={MessageCircleHeart}
      meanwhile={
        <p>
          Mientras tanto puedes configurarlas desde Discord con{" "}
          <code className="font-mono text-foreground">/bienvenida</code> y{" "}
          <code className="font-mono text-foreground">/pregunta-del-dia</code>.
        </p>
      }
    />
  );
}
