// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Empty-group-bucket parity (#3839) — the NON-date half.
//
// `checkDateBucketParity` covers the seam for `dateGranularity` groupBy, but the
// divergence it was extended to catch was never date-specific: a plain
// `groupBy: ['stage']` over a NULL column diverged the same way, and nothing
// gates that. Same dataset, same query, one bucket key — pushed-down SQL said
// SQL NULL, the in-memory fallback said the string `'(null)'`, and
// `engine.aggregate` picks between the two paths per query (by driver, by
// advertised granularity, by reference timezone). So a dashboard's empty bucket
// changed TYPE when nothing about the data changed.
//
// The measures were never wrong — only the label's shape — which is why this
// survived so long: every total reconciled.
//
// This is deliberately the driver seam, not a unit test. `applyInMemoryAggregation`
// is unit-tested in objectql, but only a real driver can say what the SQL side
// actually returns for a NULL group column, and that is the half a unit test
// cannot speak for.

import { describe, it, expect, afterEach } from 'vitest';
import { applyInMemoryAggregation } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';

const TABLE = 'deal';

const DRIVERS = [
  {
    name: 'driver-sql (better-sqlite3 :memory:)',
    make: () =>
      new SqlDriver({
        client: 'better-sqlite3',
        connection: { filename: ':memory:' },
        useNullAsDefault: true,
      }) as any,
  },
  {
    name: 'driver-sqlite-wasm (:memory:)',
    make: () => new SqliteWasmDriver({ filename: ':memory:' }) as any,
  },
];

/** `[key, total]` pairs, sorted, with the key's runtime TYPE carried along. */
function shape(rows: any[], field: string): Array<[string, unknown, number]> {
  return rows
    .map((r): [string, unknown, number] => [
      r[field] === null ? 'null' : typeof r[field],
      r[field],
      Number(r.total),
    ])
    .sort((a, b) => String(a[1]).localeCompare(String(b[1])));
}

describe.each(DRIVERS)('empty group bucket parity: $name', ({ make }) => {
  let driver: any;

  afterEach(async () => {
    await driver?.disconnect?.();
  });

  // Both groupBy shapes, because #3839 was originally filed as a date-bucketing
  // bug and turned out to be neither caused by nor limited to date bucketing.
  it.each([
    ['plain groupBy', ['stage'], 'stage'],
    ['date-bucketed groupBy', [{ field: 'at', dateGranularity: 'month' }], 'at'],
  ])('keys the empty bucket identically on both paths — %s', async (_label, groupBy, field) => {
    driver = make();
    await driver.initObjects([
      {
        name: TABLE,
        fields: { at: { type: 'datetime' }, stage: { type: 'text' }, amount: { type: 'number' } },
      },
    ]);
    const opts = { bypassTenantAudit: true };
    await driver.create(TABLE, { id: 'a', at: new Date('2026-01-10T09:00:00Z'), stage: 'won', amount: 1 }, opts);
    // Two empty rows, so a bucket that silently split or merged shows up in the
    // total rather than only in the key.
    await driver.create(TABLE, { id: 'b', at: null, stage: null, amount: 1 }, opts);
    await driver.create(TABLE, { id: 'c', at: null, stage: null, amount: 1 }, opts);

    const ast = {
      object: TABLE,
      groupBy,
      aggregations: [{ function: 'sum', field: 'amount', alias: 'total' }],
    };

    const pushedDown = await driver.aggregate(TABLE, ast);
    // The rows the in-memory path would see — the driver's own read output, which
    // is exactly what `engine.aggregate` feeds the fallback.
    const inMemory = applyInMemoryAggregation(await driver.find(TABLE, {}), ast as never);

    expect(shape(pushedDown, field)).toEqual(shape(inMemory, field));
    // …and both agree on real `null`, not on a sentinel they happen to share.
    expect(pushedDown.find((r: any) => r.stage === null || r.at === null)?.total).toBe(2);
    expect(inMemory.find((r: any) => r[field] === null)?.total).toBe(2);
    expect(inMemory.some((r: any) => typeof r[field] === 'string' && /null/i.test(r[field]))).toBe(false);
  });
});
