import { createRoot } from "react-dom/client";
import App from "./App";
import { watchChunkLoadErrors } from "./lib/chunk-reload";
import "./index.css";

// Antes de montar: así el ErrorBoundary reconoce las secciones que no se pudieron descargar
watchChunkLoadErrors();

createRoot(document.getElementById("root")!).render(<App />);
