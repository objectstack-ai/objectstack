// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #33724 — the REMOTE face's in-place NOT NULL relax against a real `sqld`
 * (libsql-server), reached as `libsql://127.0.0.1:<port>?tls=0`: the server a
 * hosted tenant database runs, over the transport the hosted face uses.
 *
 * ## Why this file exists
 *
 * The maintainer's ruling on #33724 (record 6915086281, letter A) relaxes a
 * NOT NULL column on this face with libSQL's own column statement,
 * `ALTER TABLE t ALTER COLUMN c TO c <definition>`, and its parameter 4 makes
 * the first step of the build pinning that statement against a real `sqld`:
 * if a real server refuses it, the card goes back to the maintainer, and
 * nothing falls back to a table rebuild. The other pins
 * (`turso-remote-migration-entries.test.ts`) run the same driver over a
 * `@libsql/client` `file:` client, the embedded libSQL engine; this one sends
 * the statement over the network to the server.
 *
 * ## What is pinned
 *
 * 1. The bare statement, on a raw `@libsql/client` connection: the server
 *    accepts it, the column reads back nullable with its type and DEFAULT,
 *    and a NULL write then succeeds.
 * 2. The driver's install door (`relaxDeclaredNotNull`, which the package
 *    install calls) on a remote-mode `TursoDriver` with no client of its own:
 *    the entry is reported applied, and a second connection reads the column
 *    nullable, its rows and its index unchanged.
 *
 * ## How to run it
 *
 * It needs a `sqld` binary, so it is skipped unless `OS_TEST_SQLD_BIN` names
 * one; it starts its own server on a free port over a temporary directory and
 * stops it afterwards. `packages/cli/src/commands/migrate/
 * organization-ownership.remote-face.integration.test.ts` says how to get the
 * binary. CI has no `sqld`, so CI skips this file; the same assertions over the
 * embedded engine run everywhere.
 *
 *     OS_TEST_SQLD_BIN=/path/to/sqld pnpm --filter @objectstack/driver-turso exec \
 *       vitest run src/turso-remote-relax-not-null-sqld.test.ts
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient } from '@libsql/client';
import { TursoDriver } from './turso-driver.js';

const SQLD = process.env.OS_TEST_SQLD_BIN;
const CASE_TIMEOUT_MS = 60_000;

let dir: string | undefined;
let server: ChildProcess | undefined;
let url = '';

const freePort = (): Promise<number> =>
  new Promise((done, fail) => {
    const probe = createServer();
    probe.once('error', fail);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => done(port));
    });
  });

/** A connection of its own to the server, separate from any driver under test. */
async function onServer<T>(run: (exec: (sql: string) => Promise<Array<Record<string, unknown>>>) => Promise<T>): Promise<T> {
  const client = createClient({ url });
  try {
    return await run(async (sql) => (await client.execute(sql)).rows as unknown as Array<Record<string, unknown>>);
  } finally {
    client.close();
  }
}

const columnOf = (table: string, column: string) =>
  onServer(async (exec) => {
    const [row] = await exec(`SELECT type, "notnull" AS nn, dflt_value FROM pragma_table_info('${table}') WHERE name = '${column}'`);
    return row ? { type: row.type, notNull: Number(row.nn) === 1, dflt: row.dflt_value } : null;
  });
const tableSqlOf = (table: string) =>
  onServer(async (exec) => String((await exec(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = '${table}'`))[0]?.sql));

describe.skipIf(!SQLD)('the in-place NOT NULL relax on a real sqld (#33724, ruling 6915086281)', () => {
  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'os-33724-sqld-'));
    const port = await freePort();
    url = `libsql://127.0.0.1:${port}?tls=0`;
    server = spawn(SQLD!, ['--http-listen-addr', `127.0.0.1:${port}`, '--db-path', join(dir, 'sqld')], { stdio: 'ignore' });
    for (let i = 0; i < 100; i++) {
      try {
        await onServer((exec) => exec('SELECT 1'));
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
  }, CASE_TIMEOUT_MS);

  afterAll(() => {
    server?.kill();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('FIRST: the server accepts the bare statement, and the column reads back nullable with its type and DEFAULT', async () => {
    await onServer(async (exec) => {
      await exec(`CREATE TABLE "raw" ("id" TEXT PRIMARY KEY, "price" REAL NOT NULL DEFAULT 0)`);
      await exec(`INSERT INTO "raw" ("id", "price") VALUES ('a', 1)`);
    });
    const before = await columnOf('raw', 'price');
    expect(before).toEqual({ type: 'REAL', notNull: true, dflt: '0' });

    // The answer the ruling asked for: a refusal throws here, with the server's text.
    await onServer((exec) => exec(`ALTER TABLE "raw" ALTER COLUMN "price" TO "price" REAL DEFAULT 0`));

    expect(await columnOf('raw', 'price')).toEqual({ ...before, notNull: false });
    expect(await tableSqlOf('raw')).toBe(`CREATE TABLE "raw" ("id" TEXT PRIMARY KEY, "price" REAL DEFAULT 0)`);
    await onServer((exec) => exec(`INSERT INTO "raw" ("id", "price") VALUES ('b', NULL)`));
    expect(await onServer((exec) => exec(`SELECT id, price FROM "raw" ORDER BY id`))).toEqual([
      { id: 'a', price: 1 },
      { id: 'b', price: null },
    ]);
  }, CASE_TIMEOUT_MS);

  it('the install door on a remote-mode driver: reported applied on a read-back, rows and index unchanged', async () => {
    const V1 = { name: 'sqld_p', fields: { price: { type: 'number', storage: { notNull: true } }, code: { type: 'text' } } };
    const V2 = { name: 'sqld_p', fields: { price: { type: 'number', storage: { notNull: false } }, code: { type: 'text' } } };
    const driver = new TursoDriver({ url });
    await driver.connect();
    try {
      expect(driver.transportMode).toBe('remote');
      await driver.syncSchemasBatch([{ object: 'sqld_p', schema: V1 }]);
      await onServer(async (exec) => {
        await exec('CREATE INDEX "idx_sqld_p_price" ON "sqld_p" ("price")');
        await exec(`INSERT INTO "sqld_p" ("id", "price", "code") VALUES ('a', 1.5, 'A')`);
      });
      const before = await columnOf('sqld_p', 'price');
      expect(before?.notNull).toBe(true);
      driver.registerObjectMetadata([V2] as never);

      const report = await driver.relaxDeclaredNotNull(V2, ['price'], { packageId: 'com.acme.crm' });

      expect(report.skipped).toEqual([]);
      expect(report.applied.map((e) => `${e.op.type}:${e.column}`)).toEqual(['relax_not_null:price']);
      expect(await columnOf('sqld_p', 'price')).toEqual({ ...before, notNull: false });
      expect(await onServer((exec) => exec(`SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_sqld_p_price'`)))
        .toHaveLength(1);
      expect(await onServer((exec) => exec(`SELECT id, price, code FROM "sqld_p"`))).toEqual([{ id: 'a', price: 1.5, code: 'A' }]);
    } finally {
      await driver.disconnect();
    }
  }, CASE_TIMEOUT_MS);
});
