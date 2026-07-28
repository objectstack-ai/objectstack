// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A FilterCondition may carry a `$and` array ALONGSIDE plain field keys, and
 * the `$and` elements may nest further. Both are legal per
 * `FilterConditionSchema` (`$and` recurses; the schema intersects a record with
 * the logical-operator object), and `applyFilterCondition` handles them by
 * iterating every key — but nothing exercised the combination end-to-end, so
 * "the compiler happens to iterate all keys" was an implementation detail
 * rather than a contract.
 *
 * It became a contract with #3650: ObjectQLStrategy now AND-composes predicates
 * that cannot share one field entry (a `where` bound colliding with a
 * `timeDimensions[].dateRange` window) into `filter.$and`, and `withReadScope`
 * then wraps THAT in another `$and` with the tenant predicate. The exact
 * two-level shape below is what the analytics path hands the driver. Silently
 * dropping either level would widen the query — the analytics path's read scope
 * lives in the outer one.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqlDriver } from '../src/index.js';

/** One row survives all three predicates; each other row fails exactly one. */
const FIXTURE = [
  { id: 'a', close_date: '2026-01-05', organization_id: 'org_A', amount: 10 }, // fails inner-sibling $gte
  { id: 'b', close_date: '2026-01-20', organization_id: 'org_A', amount: 20 }, // survives
  { id: 'c', close_date: '2026-02-10', organization_id: 'org_A', amount: 40 }, // fails nested $lte
  { id: 'd', close_date: '2026-01-20', organization_id: 'org_B', amount: 80 }, // fails outer tenant
];

/**
 * `{ $and: [ {field…, $and: [ … ]}, {tenant} ] }` — a field key and a nested
 * `$and` inside one branch of an outer `$and`.
 */
const NESTED_AND = {
  $and: [
    {
      close_date: { $gte: '2026-01-15' },
      $and: [{ close_date: { $gte: '2026-01-01', $lte: '2026-01-31' } }],
    },
    { organization_id: 'org_A' },
  ],
};

describe('SqlDriver — field key alongside a nested $and (#3650)', () => {
  let driver: SqlDriver;
  let knex: any;

  beforeEach(async () => {
    driver = new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    knex = (driver as any).knex;
    await knex.schema.createTable('opportunity', (t: any) => {
      t.string('id').primary();
      t.string('close_date');
      t.string('organization_id');
      t.float('amount');
    });
    await knex('opportunity').insert(FIXTURE);
  });

  afterEach(async () => {
    await knex.destroy();
  });

  it('intersects every level on find()', async () => {
    const rows = await driver.find('opportunity', { where: NESTED_AND } as any);
    expect(rows.map((r: any) => r.id)).toEqual(['b']);
  });

  it('intersects every level on aggregate() — the analytics path', async () => {
    const rows = await driver.aggregate('opportunity', {
      groupBy: ['organization_id'],
      aggregations: [{ function: 'sum', field: 'amount', alias: 'total' }],
      where: NESTED_AND,
    } as any);

    // 20 only. Dropping the nested `$and` would add row c (60); dropping the
    // sibling field key would add row a (30); dropping the outer branch would
    // add row d and split the grouping.
    expect(rows).toEqual([{ organization_id: 'org_A', total: 20 }]);
  });

  it('keeps a bucketed aggregate scoped to the same intersection', async () => {
    // The #3650 shape in its native habitat: a date-bucketed trend whose window
    // and read scope both have to survive.
    const rows = await driver.aggregate('opportunity', {
      groupBy: [{ field: 'close_date', dateGranularity: 'month' }],
      aggregations: [{ function: 'sum', field: 'amount', alias: 'total' }],
      where: NESTED_AND,
    } as any);

    expect(rows).toEqual([{ close_date: '2026-01', total: 20 }]);
  });
});
