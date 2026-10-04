import { ShieldCheck } from "lucide-react";
import { ComingSoon } from "@/components/coming-soon";

// Página pendiente: anti-raid, bloqueo de canales e historial de alertas.
// Las páginas antiguas (antiraid.tsx, protection.tsx) mostraban números y eventos
// inventados, así que no se enlazan hasta rehacerlas con datos reales.
export default function Seguridad() {
  return (
    <ComingSoon
      title="Seguridad"
      description="Protección contra raids, bloqueo de canales y alertas para el staff."
      icon={ShieldCheck}
      meanwhile={
        <p>
          Mientras tanto puedes usar desde Discord{" "}
          <code className="font-mono text-foreground">/antiraid</code> para ver y ajustar la protección, y{" "}
          <code className="font-mono text-foreground">/lockdown</code> para bloquear o desbloquear un canal.
        </p>
      }
    />
  );
}
