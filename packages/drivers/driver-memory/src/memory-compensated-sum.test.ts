// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20544] driver-memory adds `sum` / `avg` with `@objectstack/core`'s
 * `compensatedSum`, on both of its faces, as SQLite and objectql's rows path do.
 *
 * Measured on the base (`d2820876f`), one `number` column, one group per
 * fixture:
 *
 * | fixture | data face / analytics face (base) | rows path and SQLite |
 * |:--|:--|:--|
 * | `0.1, 0.2, 0.3` | `0.6000000000000001` / `0.20000000000000004` | `0.6` / `0.19999999999999998` |
 * | `1e16, 1, -1e16` | `0` / `0` | `1` / `0.3333333333333333` |
 * | `0.1, 0.2` (two addends) | `0.30000000000000004` / `0.15000000000000002` | the same |
 * | `1, 2, 3, 40, 500` (integers) | `546` / `109.2` | the same |
 *
 * So `engine.aggregate` on this driver answered two doubles by path: the
 * native path (`aggregate(object, AST)`, driven below) read the naive column,
 * the rows path a filtered sibling aggregation forces read the compensated
 * one, and `having { s: { $eq: 0.6 } }` kept the group on the rows path alone.
 * The rows path's own answer is pinned in objectql
 * (`in-memory-aggregation-compensated-sum.test.ts`) against the same literals.
 *
 * Both faces, and both doors of the data face, are driven: one face aligned
 * alone is how this package's faces come to disagree (#5374, #6814, commit 20950404c).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { DriverQuery } from '@objectstack/spec/contracts';
import type { Cube } from '@objectstack/spec/data';
import { InMemoryDriver } from './memory-driver.js';
import { MemoryAnalyticsService } from './memory-analytics.js';

const TABLE = 'ledger_20544';

/** group → its values, and the compensated `sum` / `avg` over them. */
const GROUPS: Record<string, { values: number[]; s: number; a: number }> = {
  card: { values: [0.1, 0.2, 0.3], s: 0.6, a: 0.19999999999999998 },
  cancel: { values: [1e16, 1, -1e16], s: 1, a: 0.3333333333333333 },
  two: { values: [0.1, 0.2], s: 0.30000000000000004, a: 0.15000000000000002 },
  ints: { values: [1, 2, 3, 40, 500], s: 546, a: 109.2 },
};

/** The fold both faces used before #20544: in order, one addition at a time. */
const naiveSum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);

async function seed(): Promise<InMemoryDriver> {
  const driver = new InMemoryDriver();
  let i = 0;
  for (const [g, { values }] of Object.entries(GROUPS)) {
    for (const w of values) await driver.create(TABLE, { id: `r${i++}`, g, w, at: '2026-03-04T10:00:00Z' });
  }
  return driver;
}

const expected = Object.fromEntries(Object.entries(GROUPS).map(([g, { s, a }]) => [g, { s, a }]));

describe('[#20544] the fixtures discriminate the two folds', () => {
  it('the naive fold answers another double on the card fixture and the cancellation, and the same on the controls', () => {
    expect(naiveSum(GROUPS.card.values)).toBe(0.6000000000000001);
    expect(naiveSum(GROUPS.cancel.values)).toBe(0);
    expect(naiveSum(GROUPS.two.values)).toBe(GROUPS.two.s);
    expect(naiveSum(GROUPS.ints.values)).toBe(GROUPS.ints.s);
  });
});

describe('[#20544] data face — sum / avg add with the compensated fold', () => {
  let driver: InMemoryDriver;
  beforeEach(async () => { driver = await seed(); });

  const grouped: DriverQuery = {
    groupBy: ['g'],
    aggregations: [
      { function: 'sum', field: 'w', alias: 's' },
      { function: 'avg', field: 'w', alias: 'a' },
    ],
  } as DriverQuery;
  const byGroup = (rows: any[]) => Object.fromEntries(rows.map((r) => [r.g, { s: r.s, a: r.a }]));

  it("aggregate(AST) — the door engine.aggregate's native path takes — answers every group's compensated sum and mean", async () => {
    expect(byGroup(await driver.aggregate(TABLE, grouped) as any[])).toStrictEqual(expected);
  });

  it('find() — the other door onto the same fold — answers the same numbers', async () => {
    expect(byGroup(await driver.find(TABLE, grouped) as any[])).toStrictEqual(expected);
  });

  it("the card's having reads: s === 0.6 holds for the card group, so `having { s: { $eq: 0.6 } }` keeps it", async () => {
    const rows = await driver.aggregate(TABLE, { ...grouped, where: { g: 'card' } } as DriverQuery) as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].s === 0.6).toBe(true);
  });

  it('what the addends are does not move: a boolean is 1 / 0, null and a non-numeric string are left out', async () => {
    const d = new InMemoryDriver();
    const cells: unknown[] = [0.1, null, 0.2, 'abc', true, 0.3, undefined];
    for (const [i, w] of cells.entries()) await d.create(TABLE, { id: `m${i}`, w });
    const [row] = await d.aggregate(TABLE, {
      aggregations: [
        { function: 'sum', field: 'w', alias: 's' },
        { function: 'avg', field: 'w', alias: 'a' },
      ],
    } as DriverQuery) as any[];
    // Addends 0.1, 0.2, 1, 0.3 — four of them, in row order.
    expect(row).toStrictEqual({ s: 1.6, a: 0.4 });
  });

  it('the empty group: sum 0, avg null', async () => {
    const d = new InMemoryDriver();
    await d.create(TABLE, { id: 'n1', w: null });
    const [row] = await d.aggregate(TABLE, {
      aggregations: [
        { function: 'sum', field: 'w', alias: 's' },
        { function: 'avg', field: 'w', alias: 'a' },
      ],
    } as DriverQuery) as any[];
    expect(row).toStrictEqual({ s: 0, a: null });
  });
});

describe('[#20544] analytics face — sum / avg measures add with the compensated fold', () => {
  const cube = {
    name: 'ledger',
    title: 'Ledger',
    sql: TABLE,
    measures: {
      total: { label: 'Total', type: 'sum', sql: 'w' },
      mean: { label: 'Mean', type: 'avg', sql: 'w' },
    },
    dimensions: {
      g: { label: 'Group', type: 'string', sql: 'g' },
      at: { label: 'At', type: 'time', sql: 'at' },
    },
  } as unknown as Cube;

  let service: MemoryAnalyticsService;
  beforeEach(async () => { service = new MemoryAnalyticsService({ driver: await seed(), cubes: [cube] }); });

  const byGroup = (rows: any[]) =>
    Object.fromEntries(rows.map((r) => [r['ledger.g'], { s: r['ledger.total'], a: r['ledger.mean'] }]));

  it("grouped: every group's compensated sum and mean", async () => {
    const result = await service.query({
      cube: 'ledger', measures: ['ledger.total', 'ledger.mean'], dimensions: ['ledger.g'],
    } as any);
    expect(byGroup(result.rows as any[])).toStrictEqual(expected);
  });

  /**
   * The time-bucket half runs its own `Aggregator` over the `$group` onward
   * (`aggregateWithTimeBuckets`), so it is a second place the accumulator has
   * to work — measured, not assumed.
   */
  it('under a granular time dimension — the split pipeline — the same numbers', async () => {
    const result = await service.query({
      cube: 'ledger',
      measures: ['ledger.total', 'ledger.mean'],
      dimensions: ['ledger.g'],
      timeDimensions: [{ dimension: 'ledger.at', granularity: 'day' }],
    } as any);
    expect(byGroup(result.rows as any[])).toStrictEqual(expected);
    for (const row of result.rows as any[]) expect(row['ledger.at']).toBe('2026-03-04');
  });

  /**
   * `$sort` runs after `$group`, so ordering by the measure ranks the number
   * the measure answers — the reason the fold lives inside `$group` rather
   * than in a post-processing step.
   */
  it('ordered by the sum measure, the rows rank by the compensated values', async () => {
    const result = await service.query({
      cube: 'ledger', measures: ['ledger.total'], dimensions: ['ledger.g'], order: { 'ledger.total': 'asc' },
    } as any);
    expect((result.rows as any[]).map((r) => [r['ledger.g'], r['ledger.total']])).toStrictEqual([
      ['two', 0.30000000000000004], ['card', 0.6], ['cancel', 1], ['ints', 546],
    ]);
  });

  it('what the addends are does not move: a boolean is 1 / 0, null, a missing key and a non-numeric string are left out', async () => {
    const d = new InMemoryDriver();
    const cells: unknown[] = [0.1, null, 0.2, 'abc', true, 0.3];
    for (const [i, w] of cells.entries()) await d.create(TABLE, { id: `m${i}`, w });
    await d.create(TABLE, { id: 'missing' });
    const svc = new MemoryAnalyticsService({ driver: d, cubes: [cube] });
    const result = await svc.query({ cube: 'ledger', measures: ['ledger.total', 'ledger.mean'] } as any);
    expect(result.rows[0]).toStrictEqual({ 'ledger.total': 1.6, 'ledger.mean': 0.4 });
  });

  it('the empty group: sum 0, avg null', async () => {
    const d = new InMemoryDriver();
    await d.create(TABLE, { id: 'n1', w: null });
    const svc = new MemoryAnalyticsService({ driver: d, cubes: [cube] });
    const result = await svc.query({ cube: 'ledger', measures: ['ledger.total', 'ledger.mean'] } as any);
    expect(result.rows[0]).toStrictEqual({ 'ledger.total': 0, 'ledger.mean': null });
  });

  /** The debugging dump names each measure's fold: a function the replacer
   * dropped would make a `sum` and an `avg` measure dump identically. */
  it('the pipeline dump still tells a sum measure from an avg measure', async () => {
    const result = await service.query({ cube: 'ledger', measures: ['ledger.total', 'ledger.mean'] } as any);
    const sql = String(result.sql);
    expect(sql).toContain('"finalize":"[function compensatedSumOfAddends]"');
    expect(sql).toContain('"finalize":"[function compensatedMeanOfAddends]"');
  });
});
