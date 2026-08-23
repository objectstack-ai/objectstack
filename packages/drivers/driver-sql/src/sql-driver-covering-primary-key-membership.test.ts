// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#11162] A covering primary key's INCLUDE'd columns are NOT key members.
 *
 * Postgres reaches a covering primary key via
 * `CREATE UNIQUE INDEX … INCLUDE (payload)` promoted with
 * `ALTER TABLE … ADD CONSTRAINT … PRIMARY KEY USING INDEX`. For such an index
 * `pg_index.indkey` holds the key columns *and* the INCLUDE'd payload columns;
 * `indnkeyatts` is the count of the leading entries that are actually key
 * members. `introspectPrimaryKeys` read `indkey` whole and never consulted
 * `indnkeyatts`, so `payload` was reported as part of the key.
 *
 * A key with an extra member is a DIFFERENT key: an upsert conflict target
 * naming a non-key column does not match the constraint, and schema-drift
 * comparison against a correctly-declared `(k2, k1)` reports a phantom
 * `unexpected_key_member:payload`. Measured on a live PostgreSQL 16.13:
 * `indkey = '2 1 3'`, `indnkeyatts = 2`, and both the pre-#11101 and
 * post-#11101 queries returned `payload` (#11101 repaired ORDER, not
 * membership — the two arms agreed on the wrong membership).
 *
 * ## Why this file is PG-only
 *
 * MySQL has no covering-index concept for a PRIMARY KEY and SQLite has no
 * INCLUDE at all — the defect is not expressible there, so the cell list is
 * exactly `pg`, declared through `declareDialectCell` so an unprovisioned run
 * is a named skip (and a red under `OS_EXPECT_LIVE_DIALECT_MATRIX=1`), never
 * a silent pass.
 *
 * ## Why the assertion is the EXACT ORDERED array
 *
 * Two reasons. Membership alone would pass a fix that broke #11101's ordering
 * repair — the fixture's key `(k2, k1)` is deliberately declared out of column
 * sequence so ordering stays observable, and the exact array holds both
 * properties at once. And a set/length assertion could go green over the
 * method's failure modes; the exact array cannot.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqlDriver } from '../src/index.js';
import { PG_CELL, declareDialectCell, type DialectCell } from './live-dialect-matrix.testkit.js';

const MATRIX = 'covering primary-key MEMBERSHIP';

/** Table this file owns. The schema it lands in is per-file (#9350). */
const TABLE = 'os11162_covered';

/**
 * Column order is `k1, k2, payload`; the KEY is `(k2, k1)` — out of column
 * sequence on purpose, so this fixture can see an ordering regression too.
 * `payload` is carried by the index but is NOT a key member.
 */
const DDL = [
  `create table ${TABLE} (k1 varchar(64) not null, k2 varchar(64) not null, payload varchar(64))`,
  `create unique index ${TABLE}_pk on ${TABLE} (k2, k1) include (payload)`,
  `alter table ${TABLE} add constraint ${TABLE}_pkey primary key using index ${TABLE}_pk`,
];

/** The declared key: exactly the two key columns, in declared key order. */
const KEY_ORDER = ['k2', 'k1'];

function declareCoveringKeySuite(cell: DialectCell): void {
  describe(`introspectPrimaryKeys covering-key membership — ${cell.label} (#11162)`, () => {
    let driver: SqlDriver;

    beforeEach(async () => {
      driver = new SqlDriver(cell.config());
      await driver.execute(`drop table if exists ${TABLE}`).catch(() => {});
      for (const stmt of DDL) await driver.execute(stmt);
    });

    afterEach(async () => {
      await driver.execute(`drop table if exists ${TABLE}`).catch(() => {});
      await driver.disconnect();
    });

    it('pins the catalog facts the fix rests on: indkey carries payload, indnkeyatts bounds the key', async () => {
      const res: any = await driver.execute(
        `select i.indkey::text as indkey, i.indnatts, i.indnkeyatts
           from pg_index i
          where i.indrelid = '${TABLE}'::regclass and i.indisprimary`,
      );
      const row = res.rows[0];
      // k1 is attnum 1, k2 attnum 2, payload attnum 3: the key columns in KEY
      // order, then the INCLUDE'd column. If a server ever stopped reporting
      // this shape, the arm would be wrong for a reason no assertion on its
      // OUTPUT could localise.
      expect(row.indkey).toBe('2 1 3');
      expect(Number(row.indnatts)).toBe(3);
      expect(Number(row.indnkeyatts)).toBe(2);
    });

    it('reports ONLY the key columns, in declared key order — INCLUDE columns are not members', async () => {
      const schema = await driver.introspectSchema();
      const introspected = schema.tables[TABLE].primaryKeys;

      // Exact ordered array: membership (#11162) and order (#11101) at once.
      expect(
        introspected,
        `${cell.label}: a covering PK must report its key columns only — ` +
          `'payload' is an INCLUDE'd column, and reporting it makes this a DIFFERENT addressing key`,
      ).toEqual(KEY_ORDER);

      // The pre-fix answer, named: what both the pre- and post-#11101 queries
      // returned on a live 16.13 before this bound existed.
      expect(introspected).not.toEqual(['k2', 'k1', 'payload']);
    });

    it('derives the per-column primaryKey flag from the bounded membership', async () => {
      const schema = await driver.introspectSchema();
      const flags = Object.fromEntries(
        schema.tables[TABLE].columns.map((c) => [c.name, c.primaryKey === true]),
      );
      // `introspectSchema` derives this FROM `primaryKeys`, so the phantom
      // member corrupted this signal too.
      expect(flags).toEqual({ k1: true, k2: true, payload: false });
    });
  });
}

declareDialectCell(PG_CELL, MATRIX, declareCoveringKeySuite);
