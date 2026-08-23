// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#11163] `introspectColumns` must report a table's columns in DECLARED
 * order on **every** dialect — SQLite, Postgres and MySQL — for the same
 * table.
 *
 * The method built its array from knex's `columnInfo()`, an object KEYED BY
 * COLUMN NAME whose key-insertion order is the row order of knex's own
 * `information_schema.columns` query — which carries no `ORDER BY`. Measured
 * live: SQLite and PostgreSQL 16.13 happened to return declared order; MySQL
 * 8.0.46 returned **alphabetical** order, so the same table introspected
 * through different dialects returned different `columns` arrays, and a
 * federated object drafted from a MySQL remote (ADR-0015
 * `generateObjectDraft` / the persisted `external_catalog`) got its fields
 * alphabetized rather than in the order the remote declares them.
 *
 * The fix reads the order from the catalog's own ordinal
 * (`ORDINAL_POSITION` / `ordinal_position` / `PRAGMA table_info`'s `cid`) —
 * the ordinal is the fact; a plan's row order is not, on ANY dialect.
 *
 * ## ⭐ Why the fixtures' alphabetical order differs from their declared order
 *
 * Alphabetical order is exactly what the buggy path returned on MySQL, so a
 * fixture whose declared order IS alphabetical would make every assertion
 * below a tautology the buggy code also passes. {@link TWO_KEY_TABLE} reuses
 * #11101's permutation shape (`carrier_code, shipment_id, leg_seq` — its
 * alphabetical order swaps the last two), and {@link Z_FIRST_TABLE} differs
 * in the FIRST position too, so an arm that merely happened to agree on the
 * leading column cannot pass by accident. The `non-vacuous` leg pins both
 * constants against their own DDL text.
 *
 * ## How the three dialects are held to ONE answer
 *
 * Same construction as the #11101 key-order file: every cell runs the same
 * DDL and asserts the same constants, through `declareDialectCell` — live
 * cells are a named skip without `OS_TEST_POSTGRES_URL` /
 * `OS_TEST_MYSQL_URL`, and a red under `OS_EXPECT_LIVE_DIALECT_MATRIX=1`.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqlDriver } from '../src/index.js';
import { DIALECT_CELLS, declareDialectCell, type DialectCell } from './live-dialect-matrix.testkit.js';

const MATRIX = 'declared COLUMN order';

/** Tables this file owns. The schema they land in is per-file (#9350). */
const TWO_KEY_TABLE = 'os11163_shipment_legs';
const Z_FIRST_TABLE = 'os11163_zone_areas';

/**
 * #11101's fixture shape, reused deliberately: declared order
 * `carrier_code, shipment_id, leg_seq`, alphabetical order
 * `carrier_code, leg_seq, shipment_id` — a real permutation.
 */
const TWO_KEY_DDL = `create table ${TWO_KEY_TABLE} (
  carrier_code varchar(64) not null,
  shipment_id varchar(64) not null,
  leg_seq integer,
  primary key (shipment_id, carrier_code)
)`;

const TWO_KEY_COLUMN_ORDER = ['carrier_code', 'shipment_id', 'leg_seq'];

/**
 * Alphabetical differs in the FIRST position: `zone_code` is declared first
 * and sorts last.
 */
const Z_FIRST_DDL = `create table ${Z_FIRST_TABLE} (
  zone_code varchar(64) not null,
  area_code varchar(64) not null,
  seq integer
)`;

const Z_FIRST_COLUMN_ORDER = ['zone_code', 'area_code', 'seq'];

/** Exact ordered array, with the alphabetical degradation named. */
function expectDeclaredColumnOrder(actual: string[], declared: string[], cell: DialectCell): void {
  expect(
    actual,
    `${cell.label}: introspected columns must be in DECLARED order — alphabetical is the ` +
      `#11163 defect (knex columnInfo() key order), and any other order is a plan's accident`,
  ).toEqual(declared);
}

function declareColumnOrderSuite(cell: DialectCell): void {
  describe(`introspectColumns declared order — ${cell.label} (#11163)`, () => {
    let driver: SqlDriver;

    beforeEach(async () => {
      driver = new SqlDriver(cell.config());
      for (const t of [TWO_KEY_TABLE, Z_FIRST_TABLE]) {
        await driver.execute(`drop table if exists ${t}`).catch(() => {});
      }
      await driver.execute(TWO_KEY_DDL);
      await driver.execute(Z_FIRST_DDL);
    });

    afterEach(async () => {
      for (const t of [TWO_KEY_TABLE, Z_FIRST_TABLE]) {
        await driver.execute(`drop table if exists ${t}`).catch(() => {});
      }
      await driver.disconnect();
    });

    it('asserts the fixtures are non-vacuous: declared order differs from alphabetical order', async () => {
      for (const [ddl, declared] of [
        [TWO_KEY_DDL, TWO_KEY_COLUMN_ORDER],
        [Z_FIRST_DDL, Z_FIRST_COLUMN_ORDER],
      ] as const) {
        // The constant really is the order the DDL declares — read off the
        // fixture's own text so it cannot quietly stop describing its table.
        const declaredAt = declared.map((c) => ddl.indexOf(`\n  ${c} `));
        expect(declaredAt.every((at) => at > 0)).toBe(true);
        expect([...declaredAt].sort((x, y) => x - y)).toEqual(declaredAt);

        // Alphabetical ≠ declared: the whole premise. Without this, every
        // assertion below is a tautology the buggy code also passed.
        expect([...declared].sort()).not.toEqual(declared);
      }
      // And the z-first fixture disagrees in the FIRST position specifically.
      expect([...Z_FIRST_COLUMN_ORDER].sort()[0]).not.toBe(Z_FIRST_COLUMN_ORDER[0]);
    });

    it('reports columns in declared order, not alphabetical order', async () => {
      const schema = await driver.introspectSchema();

      expectDeclaredColumnOrder(
        schema.tables[TWO_KEY_TABLE].columns.map((c) => c.name),
        TWO_KEY_COLUMN_ORDER,
        cell,
      );
      expectDeclaredColumnOrder(
        schema.tables[Z_FIRST_TABLE].columns.map((c) => c.name),
        Z_FIRST_COLUMN_ORDER,
        cell,
      );
    });

    it('keeps every per-column fact paired with its column across the reorder', async () => {
      const schema = await driver.introspectSchema();
      const byName = Object.fromEntries(
        schema.tables[TWO_KEY_TABLE].columns.map((c) => [c.name, c]),
      );

      // The facts still come from knex's columnInfo(); the reorder must not
      // detach them from their names. nullable is the one fact every dialect
      // spells the same way through knex's normalisation.
      expect(byName.carrier_code.nullable).toBe(false);
      expect(byName.shipment_id.nullable).toBe(false);
      expect(byName.leg_seq.nullable).toBe(true);
      // And the key flags derived downstream still land on the key columns.
      expect(byName.carrier_code.primaryKey).toBe(true);
      expect(byName.shipment_id.primaryKey).toBe(true);
      expect(byName.leg_seq.primaryKey).toBe(false);
    });
  });
}

for (const cell of DIALECT_CELLS) {
  declareDialectCell(cell, MATRIX, declareColumnOrderSuite);
}

/**
 * The catalog fact each rewritten arm rests on, pinned per live dialect: the
 * ordinal is the DECLARED position. (The alphabetical row order the unordered
 * query happened to return is deliberately NOT pinned — it is unspecified by
 * both engines; the measured pre-fix output is recorded in the PR body
 * instead, exactly as the #11101 key-order file does for its defect.)
 */
function declareCatalogPins(cell: DialectCell): void {
  if (cell.id === 'sqlite') return; // `cid` ordinality is pinned by the #10997 composite-key file's PRAGMA pin

  describe(`introspectColumns catalog facts — ${cell.label} (#11163)`, () => {
    let driver: SqlDriver;

    beforeEach(async () => {
      driver = new SqlDriver(cell.config());
      await driver.execute(`drop table if exists ${TWO_KEY_TABLE}`).catch(() => {});
      await driver.execute(TWO_KEY_DDL);
    });

    afterEach(async () => {
      await driver.execute(`drop table if exists ${TWO_KEY_TABLE}`).catch(() => {});
      await driver.disconnect();
    });

    it('the catalog ordinal is the declared column position', async () => {
      const sql =
        cell.id === 'pg'
          ? `select column_name, ordinal_position from information_schema.columns
             where table_name = '${TWO_KEY_TABLE}'
               and table_catalog = current_database() and table_schema = current_schema()`
          : `select COLUMN_NAME as column_name, ORDINAL_POSITION as ordinal_position
             from information_schema.COLUMNS
             where TABLE_SCHEMA = DATABASE() and TABLE_NAME = '${TWO_KEY_TABLE}'`;
      const res: any = await driver.execute(sql);
      const rows: any[] = cell.id === 'pg' ? res.rows : res[0];
      const ordinalByName = Object.fromEntries(
        rows.map((r: any) => [r.column_name, Number(r.ordinal_position)]),
      );
      expect(ordinalByName).toEqual({ carrier_code: 1, shipment_id: 2, leg_seq: 3 });
    });
  });
}

for (const cell of DIALECT_CELLS) {
  declareDialectCell(cell, `${MATRIX} catalog facts`, declareCatalogPins);
}
