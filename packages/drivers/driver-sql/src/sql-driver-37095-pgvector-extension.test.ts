// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#37095] The live PostgreSQL this package is tested against ships the
 * `vector` extension (pgvector).
 *
 * The `Temporal Conformance (live PG + MySQL)` CI job runs this whole suite
 * against its postgres service, and that service is `pgvector/pgvector` (via
 * `mirror.gcr.io`) rather than plain `postgres`, so the pgvector-backed
 * knowledge store (#37100) has a real server to be tested on. This file is the
 * pin on that provisioning: if the image ever goes back to one without the
 * extension, `CREATE EXTENSION` fails here and the job turns red, instead of
 * the store's live tests quietly becoming skips.
 *
 * It holds NO adapter code and asserts nothing about one: an extension install,
 * one typed column, and the L2 distance operator ordering rows by it.
 *
 * ## The extension is database-wide; the table is this file's own
 *
 * An extension lives once per DATABASE, in one schema, and every live file in
 * this package shares the database (each owns a schema, #9350). So the install
 * is `IF NOT EXISTS` and is never dropped here (another file may be using it),
 * and the type and operator are QUALIFIED with whatever schema the extension
 * actually sits in — read back from `pg_extension`, not assumed to be ours —
 * because a file that installed it first may have put it in its own schema,
 * which is not on this session's `search_path`. (Measured: installed from here
 * it lands in this file's schema, and the globalSetup's teardown — `drop
 * schema … cascade` — takes it away with that schema, so each run installs it
 * afresh.)
 *
 * ## Why this file is PG-only
 *
 * pgvector is a PostgreSQL extension; SQLite and MySQL have nothing to install.
 * The cell list is exactly `pg`, declared through `declareDialectCell`, so an
 * unprovisioned run (Test Core, a laptop without a server) is a NAMED skip and,
 * under `OS_EXPECT_LIVE_DIALECT_MATRIX=1`, a named failure.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SqlDriver } from '../src/index.js';
import {
  PG_CELL,
  currentLiveSchema,
  declareDialectCell,
  type DialectCell,
} from './live-dialect-matrix.testkit.js';

const MATRIX = 'pgvector extension';

const TABLE = 'os37095_embeddings';

function declarePgvectorSuite(cell: DialectCell): void {
  describe(`pgvector extension — ${cell.label} (#37095)`, () => {
    let driver: SqlDriver;
    let here: string;
    /** The schema the extension is installed in, quoted for SQL. */
    let ext: string;

    beforeAll(async () => {
      here = currentLiveSchema();
      driver = new SqlDriver(cell.config());
      await driver.execute('create extension if not exists vector');
      const found: any = await driver.execute(
        `select n.nspname as schema, e.extversion as version
           from pg_extension e join pg_namespace n on n.oid = e.extnamespace
          where e.extname = 'vector'`,
      );
      expect(found.rows, 'CREATE EXTENSION returned but no `vector` row is in pg_extension').toHaveLength(1);
      ext = `"${found.rows[0].schema}"`;
      await driver.execute(`drop table if exists "${here}".${TABLE}`);
      await driver.execute(`create table "${here}".${TABLE} (id integer primary key, embedding ${ext}.vector(3) not null)`);
      await driver.execute(
        `insert into "${here}".${TABLE} (id, embedding) values (1, '[1,0,0]'), (2, '[0,3,4]'), (3, '[1,1,0]')`,
      );
    });

    afterAll(async () => {
      await driver?.execute(`drop table if exists "${here}".${TABLE}`).catch(() => {});
      await driver?.disconnect().catch(() => {});
    });

    it('the server has the extension installed, with a version', async () => {
      const r: any = await driver.execute(`select extversion from pg_extension where extname = 'vector'`);
      expect(r.rows[0].extversion).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it('orders rows by L2 distance to a query vector, and computes that distance', async () => {
      const r: any = await driver.execute(
        `select id, embedding OPERATOR(${ext}.<->) '[1,0,0]'::${ext}.vector as distance
           from "${here}".${TABLE}
          order by embedding OPERATOR(${ext}.<->) '[1,0,0]'::${ext}.vector
          limit 2`,
      );
      // Nearest first: the identical vector (0), then [1,1,0] (1). The far
      // row [0,3,4] — sqrt(1 + 9 + 16) — is cut by the limit.
      expect(r.rows.map((row: any) => row.id)).toEqual([1, 3]);
      expect(r.rows.map((row: any) => Number(row.distance))).toEqual([0, 1]);

      const far: any = await driver.execute(
        `select embedding OPERATOR(${ext}.<->) '[1,0,0]'::${ext}.vector as distance from "${here}".${TABLE} where id = 2`,
      );
      expect(Number(far.rows[0].distance)).toBeCloseTo(Math.sqrt(26), 6);
    });
  });
}

declareDialectCell(PG_CELL, MATRIX, declarePgvectorSuite);
