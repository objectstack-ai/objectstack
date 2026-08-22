// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#11101] `introspectPrimaryKeys` must report a composite key in DECLARED KEY
 * ORDER on **every** dialect — SQLite, Postgres and MySQL — for the same table.
 *
 * #10997 repaired the SQLite arm (completeness *and* ordering, by sorting on the
 * `PRAGMA table_info` ordinal). The other two arms did not order at all:
 *
 *  - **Postgres**: `a.attnum = ANY(i.indkey)` is a MEMBERSHIP test. `i.indkey`
 *    holds the key's attnums in key order, but `ANY()` reads the vector as a set
 *    and discards the position; with no `ORDER BY` the row order was whatever
 *    the plan yielded.
 *  - **MySQL**: `KEY_COLUMN_USAGE.ORDINAL_POSITION` *is* the key ordinal and was
 *    selected by neither the projection nor an order clause.
 *
 * Both were measured returning **column order** on live servers before the fix
 * (PostgreSQL 16.13 and MySQL 8.0.46 — see the PR body), i.e. the key REVERSED
 * for the fixture below. `primaryKeys` is consumed as an addressing /
 * upsert-conflict-target key (federated-object codegen, the persisted
 * `external_catalog` under ADR-0015, schema-drift comparison), so a key in the
 * wrong order is a DIFFERENT key — and the same table introspected through
 * different dialects disagreed.
 *
 * ## ⛔ Why every assertion here is POSITIVE and ORDERED
 *
 * `introspectPrimaryKeys` wraps its whole body in `catch { }` and returns `[]`.
 * A query that is invalid on a live server therefore does **not** fail loudly —
 * it degrades to *no primary key at all*, with no diagnostic. So a test that
 * asserts "does not throw", or that checks membership / set equality, is
 * worthless here: it stays green over total key loss.
 *
 * Every leg asserts the **exact array**, and {@link expectDeclaredKeyOrder}
 * checks the length first so a degradation reads as "the silent catch ate the
 * query" rather than as a diff nobody can interpret. (The catch itself is out of
 * scope for this card and is filed separately — this file does not pin it.)
 *
 * ## ⛔ Why the fixture declares its key OUT OF COLUMN SEQUENCE
 *
 * Column order and key order coincide for most tables, and column order is
 * exactly what the unordered queries already returned — so a table whose key
 * follows its columns proves nothing. {@link KEY_ORDER} is a genuine permutation
 * of the key columns' positions, and `asserts the fixture is non-vacuous` fails
 * if a later edit ever flattens it back into column sequence.
 *
 * ## How the three dialects are held to ONE answer
 *
 * Every cell runs the **same DDL** and asserts against the **same**
 * {@link KEY_ORDER} constant, so agreement across dialects is by construction
 * rather than by a cross-suite comparison that vitest's file parallelism could
 * not make reliable. The live cells are declared through `declareDialectCell`:
 * REPORTED as a named skip without `OS_TEST_POSTGRES_URL` / `OS_TEST_MYSQL_URL`,
 * and a hard failure under `OS_EXPECT_LIVE_DIALECT_MATRIX=1` — which is what the
 * `Temporal Conformance (live PG + MySQL)` job sets, so these legs really do
 * execute against `postgres:16` and `mysql:8.0` on a required check.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqlDriver } from '../src/index.js';
import { DIALECT_CELLS, declareDialectCell, type DialectCell } from './live-dialect-matrix.testkit.js';

const MATRIX = 'composite primary-key ORDER';

/** Tables this file owns. The SCHEMA/database they land in is per-file (#9350). */
const TWO_PART = 'os11101_shipment_legs';
const THREE_PART = 'os11101_route_hops';

/**
 * Column order — deliberately NOT the key order.
 *
 * `varchar(64)` rather than `text` so one DDL string is legal on all three
 * dialects: MySQL cannot take a bare `TEXT` column into a primary key without a
 * prefix length, and the point of this file is that the three dialects answer
 * identically **for the same table**.
 */
const TWO_PART_DDL = `create table ${TWO_PART} (
  carrier_code varchar(64) not null,
  shipment_id varchar(64) not null,
  leg_seq integer,
  primary key (shipment_id, carrier_code)
)`;

/**
 * Column order exactly as {@link TWO_PART_DDL} declares it.
 *
 * Held as a constant rather than read back from `introspectSchema().columns`,
 * because that list is NOT in declared column order on every dialect: measured
 * on MySQL 8.0.46 it comes back ALPHABETICAL (`carrier_code, leg_seq,
 * shipment_id`), since `introspectColumns` builds it from knex's
 * `columnInfo()` — an object keyed by column name. That is a separate finding
 * filed from this card; it is not this file's subject, and depending on it here
 * would make the fixture's own premise dialect-specific.
 *
 * The `asserts the fixture is non-vacuous` leg pins this constant against the
 * DDL text so the two cannot drift apart.
 */
const COLUMN_ORDER = ['carrier_code', 'shipment_id', 'leg_seq'];

/** Declared KEY order: a reversal of the two key columns' positions. */
const KEY_ORDER = ['shipment_id', 'carrier_code'];

/** The same key as the buggy arms reported it — i.e. in COLUMN order. */
const KEY_IN_COLUMN_ORDER = ['carrier_code', 'shipment_id'];

/**
 * A three-part key that is a genuine PERMUTATION, not merely a reversal.
 *
 * A two-column fixture cannot tell "sorted by key ordinal" apart from "sorted
 * backwards", and a fix that reversed the row order would satisfy the two-part
 * leg while still being wrong. `(b, c, a)` over columns `(c, a, b, d)` is fixed
 * by neither reversal nor sorting.
 */
const THREE_PART_DDL = `create table ${THREE_PART} (
  c varchar(64) not null,
  a varchar(64) not null,
  b varchar(64) not null,
  d integer,
  primary key (b, c, a)
)`;

const THREE_PART_KEY_ORDER = ['b', 'c', 'a'];

/**
 * Assert the exact ordered key, with the `[]` degradation named.
 *
 * The length check is first on purpose: under the method's silent `catch` a
 * query that a server rejects yields `[]`, and "expected [] to equal
 * ['shipment_id', 'carrier_code']" does not tell the next reader that the SQL
 * never ran. This message does.
 */
function expectDeclaredKeyOrder(actual: string[], expected: string[], cell: DialectCell): void {
  expect(
    actual.length,
    `${cell.label}: introspectPrimaryKeys returned ${actual.length} column(s), expected ` +
      `${expected.length}. An EMPTY result usually means the dialect arm's query was rejected by ` +
      `the server and swallowed by the method's \`catch { }\` — read the query, not this fixture.`,
  ).toBe(expected.length);

  expect(actual, `${cell.label}: key must be in DECLARED order, not column order`).toEqual(expected);
}

function declareKeyOrderSuite(cell: DialectCell): void {
  describe(`introspectPrimaryKeys key order — ${cell.label} (#11101)`, () => {
    let driver: SqlDriver;

    beforeEach(async () => {
      driver = new SqlDriver(cell.config());
      for (const t of [TWO_PART, THREE_PART]) {
        await driver.execute(`drop table if exists ${t}`).catch(() => {});
      }
      await driver.execute(TWO_PART_DDL);
      await driver.execute(THREE_PART_DDL);
    });

    afterEach(async () => {
      for (const t of [TWO_PART, THREE_PART]) {
        await driver.execute(`drop table if exists ${t}`).catch(() => {});
      }
      await driver.disconnect();
    });

    it('asserts the fixture is non-vacuous: declared key order differs from column order', async () => {
      // 1. COLUMN_ORDER really is the order the DDL declares — an anti-drift
      //    check on the constant, read off the fixture's own text so it cannot
      //    quietly stop describing the table it names.
      const declaredAt = COLUMN_ORDER.map((c) => TWO_PART_DDL.indexOf(`\n  ${c} `));
      expect(declaredAt.every((at) => at > 0)).toBe(true);
      expect([...declaredAt].sort((x, y) => x - y)).toEqual(declaredAt);

      // 2. The key columns, taken in COLUMN order, are not the declared KEY
      //    order. This is the whole premise of the fixture: column order is
      //    precisely what the unordered queries already returned, so a key that
      //    followed its columns would make every assertion below a tautology
      //    the buggy arms also passed.
      expect(KEY_IN_COLUMN_ORDER).toEqual(COLUMN_ORDER.filter((c) => KEY_ORDER.includes(c)));
      expect(KEY_ORDER).not.toEqual(KEY_IN_COLUMN_ORDER);

      // 3. The table really has those columns (as a SET — see COLUMN_ORDER's
      //    note on why the introspected order is not comparable across
      //    dialects).
      const schema = await driver.introspectSchema();
      const found = schema.tables[TWO_PART].columns.map((c) => c.name).sort();
      expect(found).toEqual([...COLUMN_ORDER].sort());
    });

    it('reports a two-part composite key in declared key order, not column order', async () => {
      const schema = await driver.introspectSchema();
      const introspected = schema.tables[TWO_PART].primaryKeys;

      expectDeclaredKeyOrder(introspected, KEY_ORDER, cell);

      // The pre-fix answer, named: this is what both live servers returned
      // before the rewrite, and it is a DIFFERENT addressing key.
      expect(introspected).not.toEqual(KEY_IN_COLUMN_ORDER);
    });

    it('reports a three-part key that is a permutation of column order', async () => {
      const schema = await driver.introspectSchema();
      const introspected = schema.tables[THREE_PART].primaryKeys;

      expectDeclaredKeyOrder(introspected, THREE_PART_KEY_ORDER, cell);

      // Neither the column order nor its reverse — so an arm that merely
      // reversed rows, or sorted them, cannot pass this.
      expect(introspected).not.toEqual(['c', 'a', 'b']);
      expect(introspected).not.toEqual(['b', 'a', 'c']);
      expect(introspected).not.toEqual([...THREE_PART_KEY_ORDER].sort());
    });

    it('derives the per-column primaryKey flag for every key member', async () => {
      const schema = await driver.introspectSchema();
      const flags = Object.fromEntries(
        schema.tables[TWO_PART].columns.map((c) => [c.name, c.primaryKey === true]),
      );

      // `introspectSchema` derives this FROM `primaryKeys`, so it is the second
      // signal an empty result would corrupt.
      expect(flags).toEqual({ carrier_code: true, shipment_id: true, leg_seq: false });
    });
  });
}

for (const cell of DIALECT_CELLS) {
  declareDialectCell(cell, MATRIX, declareKeyOrderSuite);
}

/**
 * The catalog facts each rewritten arm rests on, pinned per dialect.
 *
 * Same role as `#10997`'s "`pk` is a 1-based ordinal, not a boolean" pin: if a
 * server ever stopped reporting these, the arm above would be wrong for a
 * reason no assertion on its OUTPUT could localise.
 *
 * ⛔ Note what is deliberately NOT pinned: the row order the *unordered* query
 * returns. That order is unspecified by both engines — asserting the reversal
 * these servers happen to produce would be pinning a behaviour neither vendor
 * promises. The measured pre-fix output is recorded in the PR body instead.
 */
function declareCatalogPins(cell: DialectCell): void {
  if (cell.id === 'sqlite') return; // covered by sql-driver-composite-primary-key-introspection.test.ts

  describe(`introspectPrimaryKeys catalog facts — ${cell.label} (#11101)`, () => {
    let driver: SqlDriver;

    beforeEach(async () => {
      driver = new SqlDriver(cell.config());
      await driver.execute(`drop table if exists ${TWO_PART}`).catch(() => {});
      await driver.execute(TWO_PART_DDL);
    });

    afterEach(async () => {
      await driver.execute(`drop table if exists ${TWO_PART}`).catch(() => {});
      await driver.disconnect();
    });

    if (cell.id === 'pg') {
      it('pg_index.indkey holds attnums in KEY order, while pg_attribute is in COLUMN order', async () => {
        const indkey: any = await driver.execute(
          `select i.indkey::text as indkey from pg_index i
           where i.indrelid = '${TWO_PART}'::regclass and i.indisprimary`,
        );
        // carrier_code is attnum 1, shipment_id is attnum 2 — so "2 1" is the
        // key order, and it is the REVERSE of the attnum sequence. This is the
        // position `a.attnum = ANY(i.indkey)` discarded.
        expect(indkey.rows[0].indkey).toBe('2 1');

        const atts: any = await driver.execute(
          `select attnum, attname from pg_attribute
           where attrelid = '${TWO_PART}'::regclass and attnum > 0 and not attisdropped
           order by attnum`,
        );
        expect(atts.rows.map((r: any) => r.attname)).toEqual([
          'carrier_code',
          'shipment_id',
          'leg_seq',
        ]);
      });
    }

    if (cell.id === 'mysql') {
      it('KEY_COLUMN_USAGE.ORDINAL_POSITION is the key ordinal', async () => {
        const res: any = await driver.execute(
          `select COLUMN_NAME as column_name, ORDINAL_POSITION as ordinal_position
           from information_schema.KEY_COLUMN_USAGE
           where TABLE_SCHEMA = DATABASE() and TABLE_NAME = '${TWO_PART}'
             and CONSTRAINT_NAME = 'PRIMARY'`,
        );
        const ordinalByName = Object.fromEntries(
          res[0].map((r: any) => [r.column_name, Number(r.ordinal_position)]),
        );
        // The ordinal is the KEY position, not the column position: shipment_id
        // is the table's SECOND column but the key's FIRST member.
        expect(ordinalByName).toEqual({ shipment_id: 1, carrier_code: 2 });
      });
    }
  });
}

for (const cell of DIALECT_CELLS) {
  declareDialectCell(cell, `${MATRIX} catalog facts`, declareCatalogPins);
}
