// Base de datos integrada: PostgreSQL 17 dentro del propio proceso (PGlite), guardada en una carpeta.
//
// PGlite es UNA sola conexión: atiende una consulta o una transacción a la vez, en orden de llegada. Para
// que eso sea seguro con el bot y el panel usándola a la vez, drizzle no recibe la PGlite directamente sino
// un cliente "vigilado" que:
// - rechaza al momento una consulta con el "db" global hecha dentro de db.transaction() (con PGlite esperaría
//   a que termine esa misma transacción: se quedaría bloqueado para siempre, y con él toda la base);
// - marca cerrada cada transacción al terminar, también si falló: PGlite 0.4 no lo hace y una consulta
//   tardía de una transacción deshecha se colaría sola o dentro de la transacción de otro;
// - deshace una transacción que tarda demasiado (DB_STATEMENT_TIMEOUT_MS): statement_timeout no funciona
//   en PGlite y una transacción colgada frenaría todas las demás;
// - al cerrar BotM deja terminar lo que ya estaba en curso, rechaza lo nuevo y cierra la base limpia.
// Los FOR UPDATE y pg_advisory_xact_lock siguen funcionando: las transacciones van de una en una, así que
// garantizan al menos lo mismo que en un PostgreSQL normal.
import { AsyncLocalStorage } from 'node:async_hooks';
import type { PGlite, Results, Transaction } from '@electric-sql/pglite';
import { chooseDataDir, hasDatabase, openDataFolder, DataFolderError, type OpenedDataFolder } from './dataFolder';
import { syncEmbeddedSchema, SchemaSyncError } from './schemaSync';

/** Error que impide arrancar; el mensaje ya está en español. */
export class DatabaseStartupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DatabaseStartupError';
  }
}

type QueryOptions = Parameters<PGlite['query']>[2];

// Código que corre dentro de una transacción. "open" pasa a false al terminarla: lo que se lanzó desde ahí
// y sigue vivo después (sin await) ya puede usar "db" sin problema.
const transactionScope = new AsyncLocalStorage<{ open: boolean }>();

const CLOSE_TIMEOUT_MS = 10_000;

export class EmbeddedDatabase {
  /** PGlite abierta (desde que se creó, aunque las tablas todavía no estén listas). */
  private pg: PGlite | null = null;
  /** PGlite con las tablas listas: recién entonces la usan el bot y el panel. */
  private readyPg: PGlite | null = null;
  private readonly ready: Promise<PGlite>;
  private resolveReady!: (pg: PGlite) => void;
  private rejectReady!: (error: unknown) => void;
  private folder: OpenedDataFolder | null = null;
  private opening: Promise<void> | null = null;
  private closing = false;
  private closed: Promise<void> | null = null;

  /** Lo que recibe drizzle en lugar de la PGlite (solo usa query y transaction). */
  readonly client: PGlite;

  constructor(private readonly transactionTimeoutMs: number) {
    this.ready = new Promise<PGlite>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    this.ready.catch(() => {}); // si falla el arranque, el error ya se explica en initDatabase
    const client = {
      query: <T>(text: string, params?: unknown[], options?: QueryOptions) => this.query<T>(text, params, options),
      exec: (text: string, options?: QueryOptions) => this.exec(text, options),
      transaction: <T>(callback: (tx: Transaction) => Promise<T>) => this.transaction(callback),
    };
    this.client = client as unknown as PGlite;
  }

  // ----- Consultas -----------------------------------------------------------------------------

  /** Revisa que se pueda consultar ahora mismo (sin esperar: el orden de llegada a PGlite se respeta). */
  private check(what: string): void {
    if (this.closing) throw new Error('BotM se está cerrando: la base de datos ya no acepta consultas.');
    if (transactionScope.getStore()?.open) {
      throw new Error(
        `${what} con "db" dentro de db.transaction(): usa "tx". Con la base integrada esto se quedaría esperando para siempre.`
      );
    }
  }

  private async database(what: string): Promise<PGlite> {
    this.check(what);
    if (this.readyPg) return this.readyPg;
    const pg = await this.ready;
    this.check(what);
    return pg;
  }

  private async query<T>(text: string, params?: unknown[], options?: QueryOptions): Promise<Results<T>> {
    const pg = this.readyPg ?? (await this.database('Consulta'));
    this.check('Consulta');
    return pg.query<T>(text, params as any[], options);
  }

  private async exec(text: string, options?: QueryOptions): Promise<Results[]> {
    const pg = this.readyPg ?? (await this.database('Consulta'));
    this.check('Consulta');
    return pg.exec(text, options);
  }

  private async transaction<T>(callback: (tx: Transaction) => Promise<T>): Promise<T> {
    const pg = this.readyPg ?? (await this.database('Transacción'));
    this.check('Transacción');
    const timeoutMs = this.transactionTimeoutMs;

    return pg.transaction((rawTx) => {
      const scope = { open: true };
      return transactionScope.run(scope, async () => {
        let finished = false;
        const live = () => {
          if (finished) throw new Error('Esta transacción ya terminó: la consulta llegó tarde y no se aplicó.');
        };
        const tx: Transaction = {
          query: async (text, params, options) => (live(), rawTx.query(text, params, options)),
          sql: async (strings, ...params) => (live(), rawTx.sql(strings, ...params)),
          exec: async (text, options) => (live(), rawTx.exec(text, options)),
          rollback: async () => (live(), rawTx.rollback()),
          listen: async (channel, cb) => (live(), rawTx.listen(channel, cb)),
          get closed() {
            return finished || rawTx.closed;
          },
        };

        let work: Promise<T> | undefined;
        let timer: NodeJS.Timeout | undefined;
        try {
          work = callback(tx);
          if (timeoutMs <= 0) return await work;
          const watchdog = new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              console.error(`[DB] Una transacción tardó más de ${timeoutMs} ms: se deshizo para no frenar al resto del bot.`);
              reject(new Error(`La transacción tardó más de ${timeoutMs} ms y se deshizo.`));
            }, timeoutMs);
          });
          return await Promise.race([work, watchdog]);
        } finally {
          finished = true;
          scope.open = false;
          clearTimeout(timer);
          work?.catch(() => {}); // si ganó el límite de tiempo, su error tardío ya no le importa a nadie
        }
      });
    });
  }

  // ----- Abrir y cerrar ------------------------------------------------------------------------

  /** Elige la carpeta, toma el candado, abre la base y crea o pone al día las tablas. */
  open(schema: Record<string, unknown>): Promise<void> {
    if (!this.opening) {
      this.opening = this.doOpen(schema).catch((error) => {
        this.rejectReady(error);
        throw error;
      });
    }
    return this.opening;
  }

  private async doOpen(schema: Record<string, unknown>): Promise<void> {
    let choice;
    try {
      choice = chooseDataDir();
    } catch (error) {
      throw error instanceof DataFolderError ? new DatabaseStartupError(error.message) : error;
    }

    console.log(`📁 Carpeta de la base de datos: ${choice.dir}`);
    if (choice.source === 'local') {
      console.log(
        `   (Tu proyecto está dentro de ${choice.syncedBy}: la base se guarda en esta carpeta de tu usuario, fuera de la ` +
        'sincronización, porque la nube bloquea y reescribe archivos mientras se usan y puede dañarla. DATABASE_DIR la cambia.)'
      );
    } else if (choice.source === 'env' && choice.syncedBy) {
      console.warn(
        `⚠️ DATABASE_DIR está dentro de ${choice.syncedBy}. La sincronización puede dañar la base mientras BotM está abierto: ` +
        'mejor elige una carpeta fuera de la nube.'
      );
    }

    let folder: OpenedDataFolder;
    try {
      folder = openDataFolder(choice.dir, 'BotM');
    } catch (error) {
      throw error instanceof DataFolderError ? new DatabaseStartupError(error.message) : error;
    }
    this.folder = folder;
    if (this.closing) throw new DatabaseStartupError('BotM se cerró mientras abría la base de datos.');

    if (folder.isNew) {
      console.log(
        folder.restartedCreation
          ? '🆕 La creación de la base de datos se cortó la última vez: se empieza de nuevo (tarda unos segundos)…'
          : '🆕 Creando la base de datos por primera vez (tarda unos segundos)…'
      );
      if (hasDatabase(choice.alternative)) {
        console.warn(
          `⚠️ Ya hay una base de datos de BotM en ${choice.alternative} (de cuando el proyecto estaba en otra carpeta). ` +
          `Si quieres seguir usándola, cierra BotM y pon DATABASE_DIR=${choice.alternative} en el archivo .env.`
        );
      }
    }

    const { PGlite } = await import('@electric-sql/pglite');
    try {
      this.pg = await PGlite.create(choice.dir, {
        // Menos memoria (unos 120 MB en vez de 260) y menos renombres de archivos (mejor con antivirus en Windows)
        startParams: [...PGlite.defaultStartParams, '-c', 'shared_buffers=16MB', '-c', 'wal_recycle=off'],
      });
    } catch (error) {
      const detail = (error as Error)?.message ?? String(error);
      throw new DatabaseStartupError(
        `No se pudo abrir la base de datos de ${choice.dir} (${detail}). ` +
        'Si copiaste o restauraste esa carpeta con BotM abierto, puede estar dañada: vuelve a copiar tu respaldo con BotM cerrado. ' +
        'Si la carpeta es nueva, revisa que haya espacio en el disco y permiso para escribir.'
      );
    }
    if (this.closing) throw new DatabaseStartupError('BotM se cerró mientras abría la base de datos.');

    try {
      const { applied } = await syncEmbeddedSchema(this.pg, schema);
      if (folder.isNew) console.log(`✅ Base de datos creada con sus tablas (${applied} cambios)`);
      else if (applied > 0) console.log(`✅ Tablas de la base de datos puestas al día (${applied} cambios)`);
    } catch (error) {
      if (error instanceof SchemaSyncError) throw new DatabaseStartupError(error.message);
      throw new DatabaseStartupError(`No se pudieron revisar las tablas de la base de datos: ${(error as Error)?.message ?? error}`);
    }
    if (folder.isNew) folder.markCreated();

    this.readyPg = this.pg;
    this.resolveReady(this.pg);
  }

  /**
   * Cierra la base limpia: lo que ya estaba en la fila (transacciones y consultas) termina, lo nuevo se
   * rechaza, y se suelta el candado. Nunca lanza.
   */
  close(): Promise<void> {
    if (!this.closed) {
      this.closing = true;
      this.closed = (async () => {
        if (this.opening) await this.opening.catch(() => {});
        const pg = this.pg;
        if (pg && !pg.closed) {
          let timer: NodeJS.Timeout | undefined;
          try {
            // Espera su turno detrás de todo lo que ya estaba en curso (close() de PGlite no lo espera)
            const closing = pg._runExclusiveTransaction(() => pg.close());
            const timeout = new Promise<'timeout'>((resolve) => {
              timer = setTimeout(() => resolve('timeout'), CLOSE_TIMEOUT_MS);
            });
            if ((await Promise.race([closing, timeout])) === 'timeout') {
              console.warn('⚠️ La base de datos tardó en cerrarse; se sale igual (lo ya guardado no se pierde).');
            }
          } catch (error) {
            console.warn('⚠️ No se pudo cerrar bien la base de datos (lo ya guardado no se pierde):', (error as Error)?.message ?? error);
          } finally {
            clearTimeout(timer);
          }
        }
        this.folder?.lock.release();
      })();
    }
    return this.closed;
  }
}
