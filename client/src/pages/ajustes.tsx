import { Settings } from "lucide-react";
import { ComingSoon } from "@/components/coming-soon";

// Página pendiente: prefijo de comandos y opciones generales del servidor.
export default function Ajustes() {
  return (
    <ComingSoon
      title="Ajustes"
      description="Prefijo de comandos y opciones generales del bot en este servidor."
      icon={Settings}
    />
  );
}
