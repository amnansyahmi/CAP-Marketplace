import { isProductionDeployment, onVercel } from "@/lib/environment";
import { SCHEMA_SQL } from "@/lib/db/schema";

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
  if (!g.__chefAmmarDb) g.__chefAmmarDb = connect();
  return g.__chefAmmarDb;
}

async function connect(): Promise<Db> {
  const db = process.env.DATABASE_URL ? await connectPostgres() : await connectPglite();
  // Idempotent, so it is safe on every cold start.
  await db.exec(SCHEMA_SQL);
  return db;
}

async function connectPostgres(): Promise<Db> {
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

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
    async transaction(fn) {
      await pg.exec("BEGIN");
      try {
        const out = await fn(base);
        await pg.exec("COMMIT");
        return out;
      } catch (error) {
        await pg.exec("ROLLBACK");
        throw error;
      }
    },
    async close() {
      await pg.close();
    },
  };
  return base;
}

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
