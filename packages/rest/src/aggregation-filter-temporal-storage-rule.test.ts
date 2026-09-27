// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20176] A per-aggregation `filter` and `having` read a temporal comparand by
 * the column's storage rule, through the door a caller actually uses:
 * `POST /api/v1/data/:object/query` → `RestServer` →
 * `ObjectStackProtocolImplementation.findData` → `ObjectQL.aggregate` → a real
 * sqlite `SqlDriver` (the harness `aggregation-filter-where-doors.test.ts`
 * boots).
 *
 * Measured on the base through this door, on driver-sql and driver-memory
 * alike: each row below counted differently from the same condition as the
 * call's `where` — the TWIN every row runs beside it — because the engine
 * compared the comparand as written while the driver's `where` put it in the
 * column's storage form first:
 *
 * | row | per-aggregation `filter` | base | `where` twin |
 * |:--|:--|:--|:--|
 * | 1 | an ISO instant `$gte` on a `date` field | 1 | 3 |
 * | 2 | an ISO instant `$eq` on a `date` field | 0 | 2 |
 * | 3 | a bare day as the `$lte` of a `datetime` | 2 | 3 |
 * | 4 | a bare day as the `$between` max of a `datetime` | 2 | 3 |
 * | 5 | an epoch-ms bound on a `datetime` | 0 | 3 |
 * | 8 | `having` on `max(date)` with an ISO bound | keeps c2 | keeps c2, c3 |
 *
 * Rows 6 and 7 (a `Date` bound) reach this door only as their ISO text, which
 * the JSON body carries; that spelling is the "on the wire" block below. The
 * engine-level `Date` pins are `packages/objectql`'s
 * `engine-aggregate-temporal-storage-rule.test.ts`.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { RestServer } from './rest-server';

const OBJECT = 'ledger_order';

const LEDGER_ORDER = {
  name: OBJECT,
  label: 'Ledger Order',
  fields: {
    customer_id: { name: 'customer_id', type: 'text' as const },
    amount: { name: 'amount', type: 'number' as const },
    placed_on: { name: 'placed_on', type: 'date' as const },
    opened_at: { name: 'opened_at', type: 'datetime' as const },
    slot: { name: 'slot', type: 'time' as const },
  },
};

const ROWS = [
  { id: 'o1', customer_id: 'c1', amount: 100, placed_on: '2026-01-10', opened_at: '2026-01-01T10:00:00.000Z', slot: '09:00:00' },
  { id: 'o2', customer_id: 'c1', amount: 400, placed_on: '2026-01-02', opened_at: '2026-01-02T10:00:00.000Z', slot: '10:30:00' },
  { id: 'o3', customer_id: 'c2', amount: 900, placed_on: '2026-03-01', opened_at: '2026-02-01T10:00:00.000Z', slot: '11:00:00' },
  { id: 'o4', customer_id: 'c2', amount: 300, placed_on: '2026-02-01', opened_at: '2026-02-05T10:00:00.000Z', slot: '12:00:00' },
  { id: 'o5', customer_id: 'c2', amount: 50, placed_on: '2026-01-15', opened_at: '2026-02-06T10:00:00.000Z', slot: '13:00:00' },
  { id: 'o6', customer_id: 'c3', amount: 20, placed_on: '2026-02-01', opened_at: '2026-03-01T10:00:00.000Z', slot: '14:00:00' },
];

const liveEngines: ObjectQL[] = [];
afterEach(async () => {
  while (liveEngines.length) {
    try { await liveEngines.pop()?.destroy(); } catch { /* noop */ }
  }
});

function createMockServer() {
  const noop = () => {};
  return { get: noop, post: noop, put: noop, delete: noop, patch: noop, use: noop, listen: async () => {}, close: async () => {} };
}

function makeRes() {
  const res: any = {
    write: () => true, end: () => {},
    header: () => res,
    status: (code: number) => { res._status = code; return res; },
    json: (body: any) => { res._json = body; return res; },
  };
  return res;
}

/** A booted door over a real sqlite table, populated or empty. */
async function boot(populated: boolean) {
  const driver: any = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
  const engine = new ObjectQL();
  liveEngines.push(engine);
  engine.registerDriver(driver, true);
  await engine.init();
  engine.registry.registerObject(LEDGER_ORDER as any);
  await engine.syncSchemas();
  if (populated) await engine.insert(OBJECT, ROWS as any);

  const protocol = new ObjectStackProtocolImplementation(engine as any);
  const rest = new RestServer(createMockServer() as any, protocol as any, { api: { requireAuth: false } } as any);
  (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
  rest.registerRoutes();
  const route = rest.getRoutes().find((r: any) => r.method === 'POST' && r.path === '/api/v1/data/:object/query');
  expect(route).toBeDefined();
  return async (body: Record<string, unknown>) => {
    const res = makeRes();
    await route!.handler({ params: { object: OBJECT }, body: JSON.parse(JSON.stringify(body)) } as any, res);
    expect(res._status ?? 200, JSON.stringify(res._json)).toBe(200);
    return res._json.records as any[];
  };
}

const perAggregation = (filter: unknown) => ({
  aggregations: [{ function: 'count', alias: 'n' }, { function: 'count', alias: 'm', filter }],
});
const whereTwin = (filter: unknown) => ({ where: filter, aggregations: [{ function: 'count', alias: 'n' }] });

const ROWS_COUNTED: ReadonlyArray<readonly [string, Record<string, unknown>, number]> = [
  ['row 1 — an ISO instant $gte on a date field', { placed_on: { $gte: '2026-02-01T00:00:00.000Z' } }, 3],
  ['row 2 — an ISO instant $eq on a date field', { placed_on: { $eq: '2026-02-01T00:00:00.000Z' } }, 2],
  ['row 3 — a bare day as the $lte of a datetime', { opened_at: { $lte: '2026-02-01' } }, 3],
  ['row 4 — a bare day as the $between max of a datetime', { opened_at: { $between: ['2026-01-01', '2026-02-01'] } }, 3],
  ['row 5 — an epoch-ms bound on a datetime', { opened_at: { $gt: 1769940000000 } }, 3],
  ['row 6 on the wire — the Date as its ISO text, $gte on a date field', { placed_on: { $gte: '2026-02-01T10:00:00.000Z' } }, 3],
  ['row 7 on the wire — the Date as its ISO text, on a time field', { slot: { $gt: '2026-02-01T11:00:00.000Z' } }, 3],
  ['a short wall clock $eq on a time field', { slot: { $eq: '11:00' } }, 1],
  ['ISO instants as $in members on a date field', { placed_on: { $in: ['2026-02-01T00:00:00.000Z', '2026-01-10T05:00:00Z'] } }, 3],
  ['control — a zone-naive datetime string', { opened_at: { $gt: '2026-02-01 09:00' } }, 4],
];

describe('[#20176] POST /data/:object/query — a per-aggregation filter counts as its where twin', () => {
  for (const [name, filter, count] of ROWS_COUNTED) {
    it(`${name}: ${count} of 6 on a populated table, 0 on an empty one — the where twin's numbers`, async () => {
      for (const populated of [false, true]) {
        const post = await boot(populated);
        const expected = populated ? count : 0;
        expect(await post(perAggregation(filter)), `populated=${populated}`).toEqual([{ n: populated ? 6 : 0, m: expected }]);
        expect(await post(whereTwin(filter)), `where twin, populated=${populated}`).toEqual([{ n: expected }]);
      }
    });
  }
});

describe('[#20176] POST /data/:object/query — having reads the aggregated column\'s storage rule', () => {
  const grouped = (having: unknown) => ({
    groupBy: ['customer_id'],
    aggregations: [
      { function: 'max', field: 'placed_on', alias: 'last_placed' },
      { function: 'min', field: 'opened_at', alias: 'first_opened' },
    ],
    having,
  });
  const HAVING: ReadonlyArray<readonly [string, Record<string, unknown>, string[]]> = [
    ['row 8 — an ISO instant $gte on max(date)', { last_placed: { $gte: '2026-02-01T00:00:00.000Z' } }, ['c2', 'c3']],
    ['a bare day as the $lte of min(datetime)', { first_opened: { $lte: '2026-02-01' } }, ['c1', 'c2']],
    ['control — a bare day $gte on max(date)', { last_placed: { $gte: '2026-02-01' } }, ['c2', 'c3']],
  ];
  for (const [name, having, kept] of HAVING) {
    it(`${name}: keeps ${kept.join(', ')}; nothing on an empty table`, async () => {
      for (const populated of [false, true]) {
        const post = await boot(populated);
        const got = (await post(grouped(having))).map((r) => r.customer_id).sort();
        expect(got, `populated=${populated}`).toEqual(populated ? kept : []);
      }
    });
  }
});
