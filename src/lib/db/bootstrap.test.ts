/**
 * Upgrading a database that already exists.
 *
 * The schema script is idempotent, so running it is always safe — the question
 * is when it is *skipped*. Skipping on "does the orders table exist" is wrong
 * in the one case that matters: a database created by an earlier deploy has
 * that table and is missing every table added since. The app then starts
 * cleanly and fails on the first query against something that was never
 * created, which is a deploy that looks fine and is not.
 *
 * These tests use on-disk PGlite, because the whole point is what happens when
 * a *new connection* meets an *old database*.
 */

process.env.PGLITE_MEMORY = "1";
delete process.env.DATABASE_URL;
process.env.MAIL_DRIVER = "none";

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { closeDb, getDb } from "@/lib/db/client";
import { SCHEMA_VERSION } from "@/lib/db/schema";

/** Runs `fn` against a fresh on-disk database that outlives a reconnect. */
async function withDisk(fn: (dir: string) => Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), "chef-ammar-bootstrap-"));
  const previous = { memory: process.env.PGLITE_MEMORY, dir: process.env.PGLITE_DIR };

  try {
    await closeDb();
    process.env.PGLITE_MEMORY = "0";
    process.env.PGLITE_DIR = dir;
    await fn(dir);
  } finally {
    await closeDb();
    if (previous.memory === undefined) delete process.env.PGLITE_MEMORY;
    else process.env.PGLITE_MEMORY = previous.memory;
    if (previous.dir === undefined) delete process.env.PGLITE_DIR;
    else process.env.PGLITE_DIR = previous.dir;
    rmSync(dir, { recursive: true, force: true });
  }
}

const tableExists = async (name: string) => {
  const db = await getDb();
  const rows = await db.query<{ table: string | null }>(
    `SELECT to_regclass('public.' || $1)::text AS table`,
    [name],
  );
  return Boolean(rows.rows[0]?.table);
};

after(async () => {
  // Restore the shared in-memory database for anything that runs after.
  await closeDb();
  await getDb();
});

describe("bringing an existing database up to date", () => {
  it("creates everything on a database that has never been touched", async () => {
    await withDisk(async () => {
      await getDb();
      for (const table of ["orders", "order_items", "product_stock", "discount_codes", "product_prices", "rate_limits"]) {
        assert.equal(await tableExists(table), true, `${table} should have been created`);
      }
    });
  });

  it("adds tables a later deploy introduced, on a database that predates them", async () => {
    await withDisk(async () => {
      const db = await getDb();

      // Stand in for a database created by an earlier deploy: it has orders,
      // and knows nothing about the tables added since.
      await db.query(`DROP TABLE IF EXISTS product_prices`);
      await db.query(`DROP TABLE IF EXISTS rate_limits`);
      await db.query(`DELETE FROM schema_state`);
      assert.equal(await tableExists("orders"), true, "the old database still has its orders");
      assert.equal(await tableExists("product_prices"), false);

      // Stands in for the next deploy connecting.
      await closeDb();
      await getDb();

      assert.equal(await tableExists("product_prices"), true, "pricing would be dead without this");
      assert.equal(await tableExists("rate_limits"), true);
    });
  });

  it("records the version it applied, so the next start can skip the script", async () => {
    await withDisk(async () => {
      const db = await getDb();
      const rows = await db.query<{ version: number | string }>(
        `SELECT version FROM schema_state WHERE id = 1`,
      );
      assert.equal(Number(rows.rows[0]?.version), SCHEMA_VERSION);
    });
  });

  it("keeps the data that was already there", async () => {
    await withDisk(async () => {
      const db = await getDb();
      await db.query(
        `INSERT INTO discount_codes (id, code, kind, value) VALUES ($1, 'RAYA10', 'percent', 0.1)`,
        ["11111111-2222-3333-4444-555555555555"],
      );

      // Force the script to run again the way an upgrade would.
      await db.query(`DELETE FROM schema_state`);
      await closeDb();

      // A new handle, because the old one belongs to the connection that just
      // closed — the same thing that happens when the server restarts.
      const reconnected = await getDb();
      const rows = await reconnected.query<{ code: string }>(`SELECT code FROM discount_codes`);
      assert.deepEqual(
        rows.rows.map((r) => r.code),
        ["RAYA10"],
        "re-running the schema must not touch existing rows",
      );
    });
  });
});
