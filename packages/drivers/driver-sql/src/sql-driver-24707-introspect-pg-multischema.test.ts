// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#24707] `introspectSchema` on a PostgreSQL session whose `search_path`
 * names MORE THAN ONE schema.
 *
 * The table listing spans every `current_schemas(false)` schema, but the
 * answer is keyed by BARE name, and each table's columns were read through
 * knex `columnInfo()` on that bare name — which scopes to `current_schema()`,
 * the FIRST schema on the path only. Two wrong answers followed, both measured
 * on PostgreSQL 16 with `search_path = public, sales`:
 *
 * 1. a table living only in the later schema (`sales.orders`) was listed with
 *    `columns: []` — `listRemoteTables` answered it `columnCount: 0`, and a
 *    draft built from it would carry no fields;
 * 2. a same-named table in the later schema (`sales.customers` behind
 *    `public.customers`) was silently dropped: one key, two tables.
 *
 * The fix reads each table's columns in its own schema, and refuses the
 * listing — `RESOURCE_CONFLICT` / 409, naming the table and both schemas —
 * when one bare key would have to hold two tables. The third case is the
 * control: a session that reaches ONE schema answers exactly what the
 * bare-name read always answered.
 *
 * ## Why this file is PG-only
 *
 * SQLite has no schemas and the MySQL arm lists `DATABASE()` alone, so neither
 * can put two schemas on one session's resolution path. The cell list is
 * exactly `pg`, declared through `declareDialectCell` so an unprovisioned run
 * is a NAMED skip, never a silent pass.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SqlDriver } from '../src/index.js';
import {
  PG_CELL,
  currentLiveSchema,
  declareDialectCell,
  type DialectCell,
} from './live-dialect-matrix.testkit.js';

const MATRIX = 'introspectSchema multi-schema search_path';

/** Lives in this file's own schema — the FIRST on the path. */
const CUSTOMERS = 'os24707_customers';
/** Lives only in the SECOND schema on the path. */
const ORDERS = 'os24707_orders';

/** `introspectColumns` is `protected`; this is the narrowest way to reach it. */
class ColumnProbeDriver extends SqlDriver {
  columns(table: string, schema?: string) {
    return this.introspectColumns(table, schema);
  }
}

function declareMultiSchemaSuite(cell: DialectCell): void {
  describe(`introspectSchema multi-schema search_path — ${cell.label} (#24707)`, () => {
    /** Session whose `search_path` is `here, there`. */
    let driver: ColumnProbeDriver;
    /** Session whose `search_path` is `here` alone — the control. */
    let single: ColumnProbeDriver;
    let here: string;
    let there: string;

    beforeAll(async () => {
      here = currentLiveSchema();
      there = `${here}_b`;
      // Postgres TRUNCATES an over-long identifier silently, which would fold
      // the second schema back onto this file's own.
      expect(there.length, `${there} exceeds Postgres' 63-byte identifier limit`).toBeLessThanOrEqual(63);

      single = new ColumnProbeDriver(cell.config());
      driver = new ColumnProbeDriver({ ...cell.config(), searchPath: [here, there] });

      await single.execute(`drop schema if exists "${there}" cascade`);
      await single.execute(`create schema "${there}"`);
      await single.execute(`drop table if exists "${here}".${CUSTOMERS} cascade`);
      await single.execute(
        `create table "${here}".${CUSTOMERS} (id serial primary key, name text not null, email varchar(120) unique)`,
      );
      await single.execute(
        `create table "${there}".${ORDERS} (id serial primary key, customer_id integer, total numeric(10, 2), placed_at timestamptz)`,
      );
    });

    afterAll(async () => {
      await single.execute(`drop schema if exists "${there}" cascade`).catch(() => {});
      await single.execute(`drop table if exists "${here}".${CUSTOMERS} cascade`).catch(() => {});
      await driver.disconnect().catch(() => {});
      await single.disconnect().catch(() => {});
    });

    it('the fixture really reaches two schemas, and a bare-name read sees only the first', async () => {
      // Non-vacuity: the session's path is both schemas, in this order…
      const path: any = await driver.execute(
        `select s::text as s from unnest(current_schemas(false)) with ordinality as t(s, ord) order by ord`,
      );
      expect(path.rows.map((r: any) => r.s)).toEqual([here, there]);
      // …and the pre-fix read — `columnInfo()` on the bare name — answers
      // nothing for the later schema's table. If this ever reads columns, the
      // next case is measuring nothing.
      expect(Object.keys(await driver.getKnex()(ORDERS).columnInfo())).toEqual([]);
    });

    it("reads a later schema's table in its own schema, not as zero columns", async () => {
      const schema = await driver.introspectSchema();

      expect(Object.keys(schema.tables).sort()).toEqual([CUSTOMERS, ORDERS]);
      expect(schema.tables[ORDERS].columns.map((c) => [c.name, c.type, c.primaryKey])).toEqual([
        ['id', 'integer', true],
        ['customer_id', 'integer', false],
        ['total', 'numeric', false],
        ['placed_at', 'timestamp with time zone', false],
      ]);
      expect(schema.tables[ORDERS].primaryKeys).toEqual(['id']);
      // The first schema's table is unaffected by the second being on the path.
      expect(schema.tables[CUSTOMERS].columns.map((c) => c.name)).toEqual(['id', 'name', 'email']);
    });

    it('refuses a same-named pair across schemas instead of dropping one', async () => {
      await single.execute(`create table "${there}".${CUSTOMERS} (code varchar(20) primary key, region text)`);
      try {
        let thrown: any;
        await driver.introspectSchema().catch((e) => {
          thrown = e;
        });
        expect(thrown, 'a same-named pair must not be answered with one of the two tables').toBeDefined();
        expect({ code: thrown.code, status: thrown.status }).toEqual({ code: 'RESOURCE_CONFLICT', status: 409 });
        // The named subjects: the colliding name and both schemas, first on
        // the path first — what the operator needs to act on.
        expect(thrown.message).toContain(`'${CUSTOMERS}' ('${here}', '${there}')`);
      } finally {
        await single.execute(`drop table if exists "${there}".${CUSTOMERS} cascade`);
      }
    });

    it('a session that reaches ONE schema answers exactly what the bare-name read does', async () => {
      const schema = await single.introspectSchema();

      // The second schema is not on this session's path, so it lists nothing.
      expect(Object.keys(schema.tables)).toEqual([CUSTOMERS]);
      // And the schema-scoped column read equals the bare-name one on the
      // first schema — the single-schema answer the fix must not move.
      // (`introspectSchema` then flips `primaryKey` / `isUnique` from the key
      // reads, so the comparison is of the read itself.)
      expect(await single.columns(CUSTOMERS, here)).toEqual(await single.columns(CUSTOMERS));
      const unflagged = (cols: { primaryKey?: boolean; isUnique?: boolean }[]) =>
        cols.map(({ primaryKey: _pk, isUnique: _uq, ...rest }) => rest);
      expect(unflagged(schema.tables[CUSTOMERS].columns)).toEqual(unflagged(await single.columns(CUSTOMERS)));
      expect(schema.tables[CUSTOMERS].columns.map((c) => [c.name, c.primaryKey, c.isUnique])).toEqual([
        ['id', true, false],
        ['name', false, false],
        ['email', false, true],
      ]);
    });
  });
}

declareDialectCell(PG_CELL, MATRIX, declareMultiSchemaSuite);
