// Abre y cierra una vez la base de datos de BotM (PGlite) para que quede guardada limpia.
//
// Lo usa "npm run db:push" (drizzle.config.ts) al terminar: drizzle-kit nunca cierra la base, y la carpeta
// quedaría como después de un cierre de golpe (BotM la repara al arrancar, pero un respaldo copiado en ese
// momento no estaría limpio). Quien lo llama ya tiene el candado de la carpeta: aquí no se toma.
//
// Uso: node scripts/close-embedded-db.mjs <carpeta>
import { PGlite } from '@electric-sql/pglite';

const dir = process.argv[2];
if (!dir) {
  console.error('Falta la carpeta de la base de datos.');
  process.exit(2);
}
try {
  const pg = await PGlite.create(dir);
  await pg.close();
} catch (error) {
  console.warn(
    `⚠️ No se pudo cerrar limpia la base de datos de ${dir} (${error?.message ?? error}). ` +
    'No se perdió nada: BotM la revisa al arrancar.'
  );
  process.exit(1);
}
