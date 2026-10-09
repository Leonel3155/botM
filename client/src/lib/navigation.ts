import {
  BarChart3,
  Coins,
  Gavel,
  Hash,
  LayoutDashboard,
  LineChart,
  MessageCircleHeart,
  Server,
  Settings,
  Share2,
  ShieldCheck,
  Terminal,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  title: string;
  href: string;
  icon: LucideIcon;
  /** Frase corta para los accesos rápidos */
  description: string;
  /** La página trabaja sobre el servidor elegido (casi todas) */
  guildScoped: boolean;
}

export interface NavSection {
  label: string;
  items: NavItem[];
}

export const NAV_SECTIONS: NavSection[] = [
  {
    label: "General",
    items: [
      { title: "Resumen", href: "/", icon: LayoutDashboard, description: "Estado del bot y de tu servidor", guildScoped: true },
      { title: "Estadísticas", href: "/estadisticas", icon: LineChart, description: "Gráficas de niveles, monedas y moderación", guildScoped: true },
      { title: "Servidores", href: "/servidores", icon: Server, description: "Elige servidor e invita al bot", guildScoped: false },
    ],
  },
  {
    label: "Comunidad",
    items: [
      { title: "Bienvenida y pregunta del día", href: "/comunidad", icon: MessageCircleHeart, description: "Saluda a los nuevos y anima la charla", guildScoped: true },
      { title: "Niveles", href: "/niveles", icon: BarChart3, description: "XP, ranking y avisos al subir de nivel", guildScoped: true },
      { title: "Economía", href: "/economia", icon: Coins, description: "Monedas, recompensa diaria y trabajos", guildScoped: true },
      { title: "Redes sociales", href: "/redes", icon: Share2, description: "Noticias y memes de Reddit automáticos", guildScoped: true },
    ],
  },
  {
    label: "Administración",
    items: [
      { title: "Moderación", href: "/moderacion", icon: Gavel, description: "Historial de acciones del staff", guildScoped: true },
      { title: "Seguridad", href: "/seguridad", icon: ShieldCheck, description: "Anti-raid y protección del servidor", guildScoped: true },
      { title: "Comandos personalizados", href: "/comandos", icon: Terminal, description: "Respuestas propias para tu servidor", guildScoped: true },
      { title: "Canales", href: "/canales", icon: Hash, description: "Dónde publica el bot cada cosa", guildScoped: true },
      { title: "Ajustes", href: "/ajustes", icon: Settings, description: "Prefijo de comandos, tu cuenta y el bot", guildScoped: true },
    ],
  },
];

export const NAV_ITEMS: NavItem[] = NAV_SECTIONS.flatMap((section) => section.items);

/** Entrada del menú para una ruta ("/niveles/algo" cuenta como "/niveles"). */
export function findNavItem(path: string): NavItem | undefined {
  return NAV_ITEMS.find((item) =>
    item.href === "/" ? path === "/" : path === item.href || path.startsWith(`${item.href}/`),
  );
}
