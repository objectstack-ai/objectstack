// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0131 D1 at the DDL: a table the driver CREATES carries its tenant column
 * NOT NULL, with no declaration saying so (execution record 6285122667 on the
 * v18 step 7 card; ruling record 6269955919, ② A: no metadata change).
 *
 * ## What is pinned
 *
 * 1. A fresh managed table refuses a NULL tenant value AT THE DATABASE — a raw
 *    insert through the driver's own Knex, so no engine or driver stamping can
 *    be what refuses it — on every provisioned dialect cell.
 * 2. The same for a rotation shard the driver creates (SQLite: the one dialect
 *    `supportsRotation` answers for), asked of the base's declaration.
 * 3. The differ reports no drift on either: the declaration says nullable
 *    (`required: false`, no `storage`) and the column says NOT NULL, and that
 *    difference is the ceremony's (`ceremonyOwnedNullability`), never drift.
 * 4. The boundaries, each the other direction of the same predicate:
 *    - an ordinary field next to it stays nullable (the tenant column is the
 *      only column made NOT NULL without a declaration);
 *    - an object opted out of tenancy (`tenancy.enabled: false`) has no tenant
 *      column, so a field it happens to name `organization_id` stays nullable;
 *    - a tenant column ADDED to a table that already exists stays nullable:
 *      a populated table is the organization-ownership ceremony's to tighten,
 *      and so is a shard that already existed.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SqlDriver } from './sql-driver.js';
import { DIALECT_CELLS, declareDialectCell, type DialectCell } from './live-dialect-matrix.testkit.js';

const MATRIX = 'tenant column NOT NULL at CREATE TABLE (ADR-0131 D1)';

/** The kernel's injected tenant field, as the driver receives it: nullable by declaration. */
const ORG = { type: 'lookup', reference: 'sys_organization', required: false };

const OWNED = 'tnn_owned';
const GLOBAL = 'tnn_global';
const GROWN = 'tnn_grown';
const TABLES = [OWNED, GLOBAL, GROWN];

/** Every NOT NULL refusal spelling: SQLite, PostgreSQL, MySQL. */
const NOT_NULL_REFUSAL = /NOT NULL constraint failed|violates not-null constraint|cannot be null/i;

const knexOf = (driver: SqlDriver): any => (driver as any).knex;

async function nullable(driver: SqlDriver, table: string, column: string): Promise<boolean> {
  const info = await knexOf(driver)(table).columnInfo();
  return info[column].nullable;
}

function declareTenantColumnSuite(cell: DialectCell): void {
  describe(`${MATRIX} on ${cell.label}`, () => {
    let driver: SqlDriver;

    beforeEach(async () => {
      driver = new SqlDriver(cell.config());
      for (const t of TABLES) await knexOf(driver).schema.dropTableIfExists(t);
    });

    afterEach(async () => {
      for (const t of TABLES) await knexOf(driver).schema.dropTableIfExists(t).catch(() => {});
      await driver.disconnect();
    });

    it('a fresh table refuses a NULL tenant value at the database, and reports no drift', async () => {
      await driver.initObjects([{ name: OWNED, fields: { organization_id: ORG, note: { type: 'text' } } }]);

      expect(await nullable(driver, OWNED, 'organization_id')).toBe(false);
      expect(await nullable(driver, OWNED, 'note')).toBe(true);

      await expect(
        knexOf(driver)(OWNED).insert({ id: 'r1', organization_id: null, note: 'no owner' }),
      ).rejects.toThrow(NOT_NULL_REFUSAL);
      await knexOf(driver)(OWNED).insert({ id: 'r2', organization_id: 'org_a', note: null });
      expect((await knexOf(driver)(OWNED).select('id')).map((r: { id: string }) => r.id)).toEqual(['r2']);

      const drift = (await driver.detectManagedDrift()).filter((d) => d.table === OWNED);
      expect(drift).toEqual([]);
    });

    it('a tenancy-opted-out object has no tenant column: its organization_id stays nullable', async () => {
      await driver.initObjects([{ name: GLOBAL, tenancy: { enabled: false }, fields: { organization_id: ORG } }]);

      expect(await nullable(driver, GLOBAL, 'organization_id')).toBe(true);
      expect((await driver.detectManagedDrift()).filter((d) => d.table === GLOBAL)).toEqual([]);
    });

    it('a tenant column ADDED to an existing table stays nullable: that table is the ceremony\'s', async () => {
      await driver.initObjects([{ name: GROWN, fields: { note: { type: 'text' } } }]);
      await knexOf(driver)(GROWN).insert({ id: 'before', note: 'pre-existing row' });

      await driver.initObjects([{ name: GROWN, fields: { note: { type: 'text' }, organization_id: ORG } }]);

      expect(await nullable(driver, GROWN, 'organization_id')).toBe(true);
      expect((await driver.detectManagedDrift()).filter((d) => d.table === GROWN)).toEqual([]);
    });
  });
}

for (const cell of DIALECT_CELLS) {
  declareDialectCell(cell, MATRIX, declareTenantColumnSuite);
}

describe(`${MATRIX}: rotation shards (SQLite)`, () => {
  const T0 = Date.parse('2036-08-01T12:00:00.000Z');
  const DAY = 86_400_000;
  const ROTATED = {
    name: 'tnn_activity',
    fields: { organization_id: ORG, verb: { type: 'text' } },
    lifecycle: { class: 'telemetry', storage: { strategy: 'rotation' as const, shards: 3, unit: 'day' as const } },
  };

  let driver: SqlDriver;
  beforeEach(() => {
    driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
  });
  afterEach(async () => {
    await driver.disconnect();
  });

  it('a newly rotated shard refuses a NULL tenant value at the database, and reports no drift', async () => {
    await driver.initObjects([ROTATED as any]);
    // The sweep-time entry point, a day later, carrying no `tenancy` block.
    const { current, shards } = await driver.rotateShards(ROTATED as any, T0 + DAY);
    expect(shards.length).toBeGreaterThan(1);

    for (const shard of shards) {
      expect(await nullable(driver, shard, 'organization_id')).toBe(false);
      expect(await nullable(driver, shard, 'verb')).toBe(true);
    }
    await expect(knexOf(driver)(current).insert({ id: 'a1', organization_id: null, verb: 'x' })).rejects.toThrow(
      NOT_NULL_REFUSAL,
    );

    // The shards are not managed tables of their own (the base name is the
    // read view), so each is diffed explicitly, against the base's declaration.
    const drift = await driver.detectManagedDrift(shards.map((name) => ({ name, fields: ROTATED.fields })));
    expect(drift).toEqual([]);
  });

  it('a shard that already existed keeps the nullability it has: the ceremony reports it, nothing rebuilds it', async () => {
    const legacy = `${ROTATED.name}__r20360801`;
    await knexOf(driver).schema.createTable(legacy, (t: any) => {
      t.string('id').primary();
      t.string('created_at');
      t.string('updated_at');
      t.string('organization_id');
      t.text('verb');
    });

    await driver.rotateShards(ROTATED as any, T0);

    expect(await nullable(driver, legacy, 'organization_id')).toBe(true);
  });
});
