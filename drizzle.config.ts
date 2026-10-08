import "dotenv/config";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { defineConfig } from "drizzle-kit";
import {
  chooseDataDir,
  databaseMode,
  EXAMPLE_URL_WARNING,
  openDataFolder,
  projectRoot,
  type OpenedDataFolder,
} from "./server/dataFolder";

// "npm run db:push" usa la misma base que BotM: la de DATABASE_URL o, si está vacía, la base integrada
// (PGlite) en la misma carpeta que elige BotM al arrancar (DATABASE_DIR, la carpeta "data" del proyecto o,
// si el proyecto está en OneDrive y similares, una carpeta local de tu usuario).
const mode = databaseMode();
if (mode.kind === "invalid") throw new Error(mode.message);

function embeddedConfig() {
  if (mode.kind === "embedded" && mode.exampleUrl) console.warn(EXAMPLE_URL_WARNING);
  const { dir } = chooseDataDir();
  let folder: OpenedDataFolder | null = null;
  // Al terminar, todavía con el candado (se suelta después, en otro "exit")
  process.on("exit", (code) => {
    if (!folder) return;
    const hasDatabase = fs.existsSync(path.join(dir, "PG_VERSION"));
    // drizzle-kit sale sin cerrar la base (queda como después de un cierre de golpe): se abre y se cierra
    // una vez para que quede guardada limpia, por ejemplo para copiarla como respaldo
    if (hasDatabase && fs.existsSync(path.join(dir, "postmaster.pid"))) {
      spawnSync(process.execPath, [path.join(projectRoot(), "scripts", "close-embedded-db.mjs"), dir], {
        stdio: "inherit",
        timeout: 60_000,
      });
    }
    // Si db:push creó una base nueva y terminó bien, queda marcada como lista (si falló, BotM la empieza
    // de nuevo al arrancar)
    if (folder.isNew && code === 0 && hasDatabase) folder.markCreated();
  });
  // Mismo candado que BotM: nunca dos procesos con la misma carpeta a la vez (se dañaría la base).
  // Si BotM está abierto, esto se detiene con un mensaje en español antes de tocar nada. El candado
  // se suelta solo al terminar.
  folder = openDataFolder(dir, "db:push");
  console.log(`📁 Base de datos integrada: ${dir}`);
  return defineConfig({
    out: "./migrations",
    schema: "./shared/schema.ts",
    dialect: "postgresql",
    driver: "pglite",
    dbCredentials: { url: dir },
  });
}

export default mode.kind === "embedded"
  ? embeddedConfig()
  : defineConfig({
      out: "./migrations",
      schema: "./shared/schema.ts",
      dialect: "postgresql",
      dbCredentials: {
        url: mode.url,
      },
    });
