// Pone al día las tablas de la base integrada (PGlite) al arrancar, sin preguntar nada.
//
// Usa el mismo motor que "npm run db:push" (pushSchema de drizzle-kit) contra la base real, pero solo
// aplica cambios que no pueden perder datos: tablas y columnas nuevas, claves foráneas, índices y valores
// por defecto. Si hace falta algo más (borrar, cambiar un tipo, un posible renombre…) no lo toca y pide
// cerrar BotM y correr "npm run db:push", que sí pregunta. Todo lo que aplica va en una sola transacción.
import { createRequire } from 'node:module';
import type { PGlite } from '@electric-sql/pglite';
import { is, type SQL } from 'drizzle-orm';
import { PgDialect, PgTable, getTableConfig } from 'drizzle-orm/pg-core';

/** Error que impide arrancar; el mensaje ya está en español. */
export class SchemaSyncError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SchemaSyncError';
  }
}

type DrizzleKitApi = typeof import('drizzle-kit/api');
type TableConfig = ReturnType<typeof getTableConfig>;

const PUSH_TIMEOUT_MS = 20_000;
const PK_SENTINEL = '__botm_unknown_pk__';
const PUSH_STEPS = 'ejecuta "npm run db:push"; si te hace preguntas, sigue la tabla del paso 6 del README. Después vuelve a arrancar BotM.';

// Cambios que nunca pierden datos. Lo demás (DROP, TRUNCATE, SET DATA TYPE, SET NOT NULL…) se deja para db:push.
const ADDITIVE: RegExp[] = [
  /^CREATE TABLE /i,
  /^ALTER TABLE "[^"]+" ADD COLUMN /i,
  /^ALTER TABLE "[^"]+" ADD CONSTRAINT "[^"]+" FOREIGN KEY /i,
  // Solo llega aquí con la tabla vacía: con datos, la revisión previa ya lo frenó (drizzle-kit preguntaría)
  /^ALTER TABLE "[^"]+" ADD CONSTRAINT "[^"]+" UNIQUE\s*\(/i,
  /^CREATE (UNIQUE )?INDEX /i,
  /^ALTER TABLE "[^"]+" ALTER COLUMN "[^"]+" (SET DEFAULT|DROP DEFAULT|DROP NOT NULL)/i,
];

function isAdditive(statement: string): boolean {
  return ADDITIVE.some((re) => re.test(statement));
}

/** drizzle-kit/api como CommonJS: la versión ESM (api.mjs) falla con "Dynamic require of fs". */
function loadDrizzleKit(): DrizzleKitApi {
  return createRequire(import.meta.url)('drizzle-kit/api') as DrizzleKitApi;
}

function schemaTables(schema: Record<string, unknown>): TableConfig[] {
  return Object.values(schema)
    .filter((value): value is PgTable => is(value, PgTable))
    .map((table) => getTableConfig(table))
    .filter((config) => (config.schema ?? 'public') === 'public');
}

function uniqueNames(table: TableConfig): string[] {
  return [
    ...table.uniqueConstraints.map((u) => u.getName() ?? `${table.name}_${u.columns.map((c) => c.name).join('_')}_unique`),
    ...table.columns.filter((c) => c.isUnique).map((c) => c.uniqueName ?? `${table.name}_${c.name}_unique`),
  ];
}

interface DbColumn {
  table_name: string;
  column_name: string;
  is_nullable: string;
  column_default: string | null;
  is_identity: string;
  is_generated: string;
}

async function readCatalog(pg: PGlite) {
  const { rows: columns } = await pg.query<DbColumn>(
    `select c.table_name, c.column_name, c.is_nullable, c.column_default, c.is_identity, c.is_generated
       from information_schema.columns c
       join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
      where c.table_schema = 'public' and t.table_type = 'BASE TABLE'`
  );
  const { rows: constraints } = await pg.query<{ name: string }>(
    `select conname as name from pg_constraint where contype in ('u', 'p') and connamespace = 'public'::regnamespace`
  );
  const tables = new Map<string, Map<string, DbColumn>>();
  for (const column of columns) {
    let table = tables.get(column.table_name);
    if (!table) tables.set(column.table_name, (table = new Map()));
    table.set(column.column_name, column);
  }
  return { tables, constraints: new Set(constraints.map((c) => c.name)) };
}

/**
 * Casos en los que pushSchema se quedaría esperando una respuesta en la consola (nadie la daría):
 * - tablas nuevas y tablas que sobran a la vez, o columnas nuevas y columnas que sobran en una tabla
 *   ("¿se creó o se renombró?");
 * - una restricción UNIQUE nueva en una tabla con datos ("¿vaciar la tabla?").
 */
async function promptRisks(pg: PGlite, tables: TableConfig[]): Promise<string[]> {
  const catalog = await readCatalog(pg);
  const wanted = new Set(tables.map((t) => t.name));
  const newTables = tables.filter((t) => !catalog.tables.has(t.name)).map((t) => t.name);
  const leftoverTables = [...catalog.tables.keys()].filter((name) => !wanted.has(name));
  const risks: string[] = [];
  if (newTables.length && leftoverTables.length) {
    risks.push(`hay tablas nuevas (${newTables.join(', ')}) y tablas que ya no se usan (${leftoverTables.join(', ')}): ¿alguna se renombró?`);
  }
  for (const table of tables) {
    const existing = catalog.tables.get(table.name);
    if (!existing) continue;
    const wantedColumns = new Set(table.columns.map((c) => c.name));
    const added = [...wantedColumns].filter((c) => !existing.has(c));
    const removed = [...existing.keys()].filter((c) => !wantedColumns.has(c));
    if (added.length && removed.length) {
      risks.push(`la tabla ${table.name} tiene columnas nuevas (${added.join(', ')}) y columnas que ya no se usan (${removed.join(', ')}): ¿alguna se renombró?`);
    }
    const missingUniques = uniqueNames(table).filter((name) => !catalog.constraints.has(name));
    if (missingUniques.length) {
      const { rows } = await pg.query<{ has_rows: boolean }>(`select exists (select 1 from "${table.name}") as has_rows`);
      if (rows[0]?.has_rows) {
        risks.push(`la tabla ${table.name} necesita la regla UNIQUE nueva ${missingUniques.join(', ')} y ya tiene datos`);
      }
    }
  }
  return risks;
}

/**
 * Lo que impide que BotM funcione con la base tal como está: tablas, columnas o reglas UNIQUE que faltan
 * (las usan las consultas y los ON CONFLICT) o columnas que sobran y son obligatorias sin valor por defecto
 * (ningún INSERT de BotM podría llenarlas).
 */
async function blockingProblems(pg: PGlite, tables: TableConfig[]): Promise<string[]> {
  const catalog = await readCatalog(pg);
  const problems: string[] = [];
  for (const table of tables) {
    const existing = catalog.tables.get(table.name);
    if (!existing) {
      problems.push(`falta la tabla ${table.name}`);
      continue;
    }
    const wantedColumns = new Set(table.columns.map((c) => c.name));
    for (const name of wantedColumns) {
      if (!existing.has(name)) problems.push(`falta la columna ${table.name}.${name}`);
    }
    for (const column of existing.values()) {
      if (wantedColumns.has(column.column_name)) continue;
      const required = column.is_nullable === 'NO' && column.column_default === null && column.is_identity !== 'YES' && column.is_generated === 'NEVER';
      if (required) problems.push(`sobra la columna obligatoria ${table.name}.${column.column_name} (BotM no podría guardar filas nuevas)`);
    }
    for (const name of uniqueNames(table)) {
      if (!catalog.constraints.has(name)) problems.push(`falta la regla UNIQUE ${name} en ${table.name}`);
    }
  }
  return problems;
}

/**
 * pushSchema de drizzle-kit 0.30 pierde los parámetros de sus consultas, y la única con parámetros es la
 * que busca el nombre de una clave primaria compuesta (channel_lockdowns). Se le responde un nombre que no
 * existe: entonces propone "DROP CONSTRAINT <ese nombre>" + "ADD CONSTRAINT … PRIMARY KEY", y ese par se
 * descarta abajo si la clave real ya es exactamente la del esquema.
 */
function introspectionClient(pg: PGlite) {
  const dialect = new PgDialect();
  return {
    execute: async (query: SQL) => {
      const { sql: text } = dialect.sqlToQuery(query);
      if (text.includes('$1::regnamespace')) return { rows: [{ primary_key: PK_SENTINEL }] };
      return pg.query(text);
    },
  };
}

async function dropSentinelPrimaryKeys(pg: PGlite, statements: string[]): Promise<string[]> {
  let pending = [...statements];
  const result: string[] = [];
  while (pending.length) {
    const statement = pending.shift()!;
    const drop = statement.match(new RegExp(`^ALTER TABLE "([^"]+)" DROP CONSTRAINT "${PK_SENTINEL}"`));
    if (!drop) {
      result.push(statement);
      continue;
    }
    const table = drop[1];
    const addIndex = pending.findIndex((s) => s.startsWith(`ALTER TABLE "${table}" ADD CONSTRAINT`) && s.includes('PRIMARY KEY('));
    const add = addIndex >= 0 ? pending[addIndex].match(/ADD CONSTRAINT "([^"]+)" PRIMARY KEY\(([^)]*)\)/) : null;
    if (add) {
      const wantedColumns = add[2].split(',').map((c) => c.trim().replace(/"/g, ''));
      const { rows } = await pg.query<{ name: string; cols: string[] }>(
        `select c.conname as name, array_agg(a.attname::text order by k.ord) as cols
           from pg_constraint c
           cross join lateral unnest(c.conkey) with ordinality as k(attnum, ord)
           join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
          where c.contype = 'p' and c.conrelid = $1::regclass
          group by c.conname`,
        [`"${table}"`]
      );
      const real = rows[0];
      if (real && real.name === add[1] && JSON.stringify(real.cols) === JSON.stringify(wantedColumns)) {
        pending = pending.filter((_, i) => i !== addIndex);
        continue; // la clave ya está como la quiere el esquema
      }
    }
    result.push(statement); // de verdad cambió la clave primaria: no es aditivo, lo hará db:push
  }
  return result;
}

/** Corre fn sin dejar que escriba en la consola (pushSchema dibuja un "Pulling schema…" animado). */
async function quietly<T>(fn: () => Promise<T>): Promise<T> {
  const write = process.stdout.write;
  process.stdout.write = (() => true) as typeof process.stdout.write;
  try {
    return await fn();
  } finally {
    process.stdout.write = write;
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | 'timeout'> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function short(statement: string): string {
  const flat = statement.replace(/\s+/g, ' ').trim();
  return flat.length > 140 ? `${flat.slice(0, 139)}…` : flat;
}

function list(items: string[], max = 8): string {
  const shown = items.slice(0, max).map((item) => `   - ${item}`);
  if (items.length > max) shown.push(`   - … y ${items.length - max} más`);
  return shown.join('\n');
}

export interface SchemaSyncResult {
  applied: number;
  pending: string[];
}

/**
 * Crea o pone al día las tablas. Lanza SchemaSyncError si BotM no puede funcionar con la base como quedó;
 * si solo quedan cambios pendientes que no hacen falta para funcionar, avisa y sigue.
 */
export async function syncEmbeddedSchema(pg: PGlite, schema: Record<string, unknown>): Promise<SchemaSyncResult> {
  const tables = schemaTables(schema);
  const risks = await promptRisks(pg, tables);

  let pending: string[] = [];
  let applied = 0;
  let applyError: string | null = null;

  if (risks.length === 0) {
    const kit = loadDrizzleKit();
    const db = introspectionClient(pg) as unknown as Parameters<DrizzleKitApi['pushSchema']>[1];
    const outcome = await quietly(() => withTimeout(kit.pushSchema(schema, db), PUSH_TIMEOUT_MS));
    if (outcome === 'timeout') {
      // pushSchema se quedó esperando una respuesta en la consola: no se puede seguir con eso abierto
      throw new SchemaSyncError(`La revisión automática de las tablas no terminó (se quedó esperando una pregunta). Para arreglarlo, ${PUSH_STEPS}`);
    }
    const statements = (await dropSentinelPrimaryKeys(pg, outcome.statementsToExecute))
      .flatMap((entry) => entry.split('--> statement-breakpoint'))
      .map((s) => s.trim())
      .filter(Boolean);

    const additive = statements.filter(isAdditive);
    pending = statements.filter((s) => !isAdditive(s));
    if (additive.length) {
      try {
        await pg.transaction(async (tx) => {
          for (const statement of additive) await tx.exec(statement);
        });
        applied = additive.length;
      } catch (error) {
        // Nada quedó a medias: la transacción se deshizo entera
        applyError = (error as Error)?.message ?? String(error);
        pending = statements;
      }
    }
  }

  // Un cambio de tipo pendiente también impide funcionar (las consultas esperan el tipo nuevo)
  const typeChange = (statement: string) => / SET DATA TYPE /i.test(statement);
  const typeChanges = pending.filter(typeChange);
  // Por qué BotM no lo hace solo: va primero y completo, porque es lo que se decide con db:push
  const reasons = [
    ...risks,
    ...(applyError ? [`error al aplicar los cambios: ${applyError}`] : []),
    ...typeChanges.map((s) => `cambio de tipo pendiente: ${short(s)}`),
    ...pending.filter((s) => !typeChange(s)).map((s) => `cambio pendiente: ${short(s)}`),
  ];
  // Lo que falta para funcionar (casi siempre cosas nuevas que se agregan junto con lo anterior)
  const missing = await blockingProblems(pg, tables);

  if (missing.length || typeChanges.length) {
    const parts = [
      'Las tablas de la base de datos no coinciden con esta versión de BotM y ponerlas al día podría borrar datos, ' +
      'así que BotM no lo hace solo y se cierra.',
    ];
    if (reasons.length) parts.push(`   Lo que necesita tu decisión:\n${list(reasons, Infinity)}`);
    if (missing.length) parts.push(`   Lo que falta en las tablas (se agrega al resolver lo anterior):\n${list(missing)}`);
    parts.push(`   Para arreglarlo, ${PUSH_STEPS}`);
    throw new SchemaSyncError(parts.join('\n'));
  }
  if (reasons.length) {
    console.warn(
      '⚠️ La base de datos tiene cambios pendientes que BotM no aplica solo porque podrían borrar datos. ' +
      `BotM funciona igual.\n${list(reasons, Infinity)}\n   Para aplicarlos cuando quieras, cierra BotM (Ctrl + C) y ${PUSH_STEPS}`
    );
  }
  return { applied, pending };
}
