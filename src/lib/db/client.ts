import { isProductionDeployment, onVercel } from "@/lib/environment";
import { SCHEMA_SQL, SCHEMA_VERSION } from "@/lib/db/schema";

// Not marked with `server-only`: that package throws outside a Next request
// context and would make this untestable in a plain Node test runner. Pulling
// this into a client component still fails loudly, because the module graph
// reaches `node:crypto` and the Postgres drivers.

/**
 * Database access.
 *
 * One SQL dialect, two drivers:
 *   - `DATABASE_URL` set  -> node-postgres, i.e. Supabase, Neon, RDS, plain Postgres
 *   - otherwise           -> PGlite, real Postgres compiled to WASM, persisted
 *                            under .data/ so local orders survive a restart
 *
 * Because both are Postgres the queries are identical, so the test suite
 * running on PGlite exercises the statements production will actually run.
 *
 * PGlite writes to local disk and is for development only — on a serverless
 * host the filesystem is ephemeral and per-instance, which is exactly the
 * problem this change exists to fix. Set DATABASE_URL in any deployed
 * environment.
 */

export type QueryResult<T> = { rows: T[] };

export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
  /**
   * Runs a script that may contain several statements. `query` goes through the
   * extended protocol, which permits exactly one statement per call, so schema
   * scripts have to come through here.
   */
  exec(sql: string): Promise<void>;
  /** Runs `fn` inside a transaction, rolling back if it throws. */
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
  /** Releases the connection. Used for graceful shutdown and between tests. */
  close(): Promise<void>;
}

type Global = typeof globalThis & { __chefAmmarDb?: Promise<Db> };

/** Single connection per process, reused across hot reloads in dev. */
export function getDb(): Promise<Db> {
  const g = globalThis as Global;
  const existing = g.__chefAmmarDb;
  if (existing) return existing;

  // A rejected promise stays cached, so one refused connection at cold start
  // would leave this instance permanently broken while it carried on serving
  // requests. Forget the failure so the next caller genuinely retries.
  const pending: Promise<Db> = connect().catch((error) => {
    if (g.__chefAmmarDb === pending) g.__chefAmmarDb = undefined;
    throw error;
  });
  g.__chefAmmarDb = pending;
  return pending;
}

async function connect(): Promise<Db> {
  const db = process.env.DATABASE_URL ? await connectPostgres() : await connectPglite();
  await bootstrapSchema(db);
  return db;
}

/**
 * Creates the schema if it is not there yet.
 *
 * The script is idempotent, but running it on *every* cold start is not free
 * at the moment it matters least: a traffic spike starts dozens of instances
 * at once, and dozens of concurrent `CREATE TABLE IF NOT EXISTS` /
 * `CREATE INDEX IF NOT EXISTS` statements contend on the same catalogue rows.
 * They serialise at best and deadlock at worst — during the spike.
 *
 * So: look first, and take an advisory lock before writing, which means one
 * instance does the work and the rest wait briefly and find it done. The check
 * is one cheap query on the ordinary path.
 */
async function bootstrapSchema(db: Db): Promise<void> {
  if (await upToDate(db)) return;

  // PGlite is a single connection with no other writer, so the lock is pure
  // overhead there — and `pg_advisory_lock` on it would block the one session
  // the queue depends on.
  if (!process.env.DATABASE_URL) {
    await applySchema(db);
    return;
  }

  // An arbitrary but stable key: any two instances of this app pick the same one.
  const LOCK = 8_213_004_517;

  // `pg_try_advisory_lock` rather than the blocking form: waiting on a lock is
  // a statement, and a statement that waits longer than `statement_timeout`
  // fails — which would turn "another instance is setting up" into a hard
  // startup error.
  for (let attempt = 0; attempt < 20; attempt++) {
    const held = await db.query<{ locked: boolean }>(`SELECT pg_try_advisory_lock($1) AS locked`, [LOCK]);
    if (held.rows[0]?.locked) {
      try {
        // Someone may have finished while we were waiting for the lock.
        if (!(await upToDate(db))) await applySchema(db);
      } finally {
        await db.query(`SELECT pg_advisory_unlock($1)`, [LOCK]);
      }
      return;
    }
    if (await upToDate(db)) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  // Whoever holds the lock is stuck. The script is idempotent, so running it
  // unguarded is a worse-performing correct answer rather than a wrong one.
  await applySchema(db);
}

/**
 * Has this database had the current version of the script applied?
 *
 * Checking for one well-known table is not enough, and getting that wrong is
 * quiet rather than loud: a database created by an earlier deploy has `orders`
 * and is missing every table added since, so the app starts cleanly and then
 * fails on the first query against something that was never created.
 */
async function upToDate(db: Db): Promise<boolean> {
  const exists = await db.query<{ table: string | null }>(
    `SELECT to_regclass('public.schema_state')::text AS table`,
  );
  if (!exists.rows[0]?.table) return false;

  const rows = await db.query<{ version: number | string }>(
    `SELECT version FROM schema_state WHERE id = 1`,
  );
  const version = rows.rows[0]?.version;
  return version !== undefined && Number(version) === SCHEMA_VERSION;
}

async function applySchema(db: Db): Promise<void> {
  await db.exec(SCHEMA_SQL);
  await db.query(
    `INSERT INTO schema_state (id, version) VALUES (1, $1)
     ON CONFLICT (id) DO UPDATE SET version = $1`,
    [SCHEMA_VERSION],
  );
}

/** Bounded so one hot instance cannot eat the database's connection budget. */
const POOL_MAX = Number(process.env.DATABASE_POOL_MAX ?? 5);

async function connectPostgres(): Promise<Db> {
  const { Pool } = await import("pg");
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    // The default is 10 *per instance*. Serverless multiplies that by however
    // many instances the traffic created, and a Postgres server has a fixed
    // connection budget — the failure is not slowness, it is every instance
    // being refused a connection at once. Small pools plus a pooled (pgbouncer)
    // connection string is what survives a spike.
    max: POOL_MAX,
    // Hand back idle connections rather than holding them for an instance that
    // may serve nothing else before it is reclaimed.
    idleTimeoutMillis: 10_000,
    // Fail fast when the pool is exhausted. Queueing forever turns one slow
    // query into a request pile-up with no ceiling.
    connectionTimeoutMillis: 5_000,
    // A query that hangs holds a connection, and connections are the scarce
    // thing here. Cut it off well inside the platform's own request timeout.
    statement_timeout: 10_000,
    query_timeout: 10_000,
  });

  const wrap = (runner: {
    query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
  }): Db => ({
    async query(sql, params) {
      const result = await runner.query(sql, params);
      return { rows: result.rows as never[] };
    },
    async exec(sql) {
      // No parameters, so node-postgres uses the simple query protocol, which
      // accepts a multi-statement script.
      await runner.query(sql);
    },
    async transaction(fn) {
      // A nested transaction would need savepoints; callers do not nest.
      return fn(wrap(runner));
    },
    async close() {
      // A transaction handle borrows the pool; closing is the owner's job.
    },
  });

  return {
    async query(sql, params) {
      const result = await pool.query(sql, params as never[]);
      return { rows: result.rows as never[] };
    },
    async exec(sql) {
      await pool.query(sql);
    },
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const out = await fn(wrap(client));
        await client.query("COMMIT");
        return out;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
    async close() {
      await pool.end();
    },
  };
}

async function connectPglite(): Promise<Db> {
  // PGlite stores data on the local filesystem. On a serverless host that
  // filesystem is read-only where the app lives, and ephemeral and per-instance
  // where it is writable — orders would fail to save, or save and then vanish.
  // Fail with something that names the fix rather than an EROFS deep in a
  // dependency.
  if (onVercel() || isProductionDeployment()) {
    throw new Error(
      "DATABASE_URL is not set. This deployment has no database: PGlite is for " +
        "local development only, because a serverless filesystem does not persist. " +
        "Set DATABASE_URL to a Postgres connection string (Supabase, Neon, or similar).",
    );
  }

  const { PGlite } = await import("@electric-sql/pglite");

  // In-memory when explicitly asked (tests), on disk otherwise so a dev
  // restart does not lose orders. Read here rather than at module scope: a
  // module-level constant is captured at import and ignores any later change.
  let location: string | undefined;
  if (process.env.PGLITE_MEMORY !== "1") {
    location = process.env.PGLITE_DIR ?? ".data/orders";
    // PGlite creates the directory non-recursively, so a fresh checkout with
    // no .data/ would fail on the first order. Create the parents ourselves.
    const { mkdirSync } = await import("node:fs");
    mkdirSync(location, { recursive: true });
  }

  const pg = await PGlite.create(location);

  const base: Db = {
    async query(sql, params) {
      const result = await pg.query(sql, params as unknown[]);
      return { rows: result.rows as never[] };
    },
    async exec(sql) {
      await pg.exec(sql);
    },
    /**
     * PGlite is a single connection, so transactions have to be serialised.
     *
     * Issuing BEGIN/COMMIT with `exec` would put every concurrent caller on the
     * same session: their statements interleave, a nested BEGIN is ignored, and
     * the first COMMIT ends the transaction for everyone. Two requests racing
     * for the last jar would both read "one available" and both take it —
     * exactly the failure `SELECT ... FOR UPDATE` exists to prevent, and it
     * would pass every local test while the pooled Postgres driver behaved
     * correctly in production.
     *
     * The queue makes concurrent transactions run one after another, which is
     * stricter than Postgres and therefore safe: anything that holds here holds
     * on a real database too.
     */
    async transaction(fn) {
      const run = async () => {
        await pg.exec("BEGIN");
        try {
          const out = await fn(base);
          await pg.exec("COMMIT");
          return out;
        } catch (error) {
          await pg.exec("ROLLBACK");
          throw error;
        }
      };

      // Chain onto whatever is already running, and keep the chain alive even
      // when a transaction throws, so one failure does not wedge the queue.
      const result = pgliteQueue.then(run, run);
      pgliteQueue = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
    async close() {
      await pg.close();
    },
  };
  return base;
}

/** Serialises PGlite transactions — see the note in `connectPglite`. */
let pgliteQueue: Promise<unknown> = Promise.resolve();

/**
 * Closes the pooled connection and forgets it, so the next `getDb()` reconnects.
 * Used for graceful shutdown, and by the tests to prove that data written by one
 * connection is still there for the next one.
 */
export async function closeDb(): Promise<void> {
  const g = globalThis as Global;
  const pending = g.__chefAmmarDb;
  g.__chefAmmarDb = undefined;
  if (pending) await (await pending).close();
}

/** True when running against a real Postgres server rather than local PGlite. */
export const usingExternalDatabase = () => Boolean(process.env.DATABASE_URL);
