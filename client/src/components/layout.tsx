import type { ReactNode } from "react";

/**
 * Compatibilidad: el menú lateral, la cabecera y el tiempo real ahora viven en
 * <AppShell> (App.tsx) y envuelven todas las páginas. Las páginas antiguas aún
 * se envuelven en <Layout>; aquí no añade nada. Al rehacer cada página, quita
 * el <Layout> y este archivo cuando ya nadie lo use.
 */
export default function Layout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
