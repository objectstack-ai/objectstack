// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20203] An epoch-millisecond NUMBER against a `date` field is read as the
 * UTC calendar day of its instant — through `engine.find` and through
 * `POST /api/v1/data/:object/query`, at every position that compares it: the
 * `where`, a per-aggregation `filter` and `having`. One rule reads it,
 * `@objectstack/core`'s `temporalStorageForm`: the driver's `where` coercion
 * and the engine's per-aggregation / `having` evaluation both call it.
 *
 * Measured on the base through this door on a real sqlite `SqlDriver`, over
 * this file's six rows, with `1769940000000` (2026-02-01T10:00:00.000Z):
 *
 * | position | `$gt` | `$lt` | `$eq` | `$in` | `$between` |
 * |:--|:--|:--|:--|:--|:--|
 * | `where` (engine and REST) | 6 | 0 | 0 | 0 | 0 |
 * | per-aggregation `filter` | 0 | 0 | 0 | 0 | 6 |
 * | the date's own answer | 1 | 3 | 2 | 3 | 5 |
 *
 * and `having` on `max(date)` kept no group for `$gt`, `$eq` or `$in` — the
 * positions disagreed with each other and with the date. The same number
 * on a `datetime` field (the control) was read as its instant at every
 * position. `driver-memory` answered 0 at `where` and PostgreSQL a 500
 * (`DATABASE_ERROR`); those drivers' suites pin their `where` cells.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
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
    placed_on: { name: 'placed_on', type: 'date' as const },
    opened_at: { name: 'opened_at', type: 'datetime' as const },
  },
};

const ROWS = [
  { id: 'o1', customer_id: 'c1', placed_on: '2026-01-10', opened_at: '2026-01-01T10:00:00.000Z' },
  { id: 'o2', customer_id: 'c1', placed_on: '2026-01-02', opened_at: '2026-01-02T10:00:00.000Z' },
  { id: 'o3', customer_id: 'c2', placed_on: '2026-03-01', opened_at: '2026-02-01T10:00:00.000Z' },
  { id: 'o4', customer_id: 'c2', placed_on: '2026-02-01', opened_at: '2026-02-05T10:00:00.000Z' },
  { id: 'o5', customer_id: 'c2', placed_on: '2026-01-15', opened_at: '2026-02-06T10:00:00.000Z' },
  { id: 'o6', customer_id: 'c3', placed_on: '2026-02-01', opened_at: '2026-03-01T10:00:00.000Z' },
];

const N = 1769940000000; //       2026-02-01T10:00:00.000Z — a time of day, not a UTC midnight
const N_JAN10 = 1768057200000; // 2026-01-10T15:00:00.000Z
const N_JAN02 = 1767394800000; // 2026-01-02T23:00:00.000Z — late in its UTC day

/** operator · comparand · `date` ids (the UTC day 2026-02-01) · `datetime` control ids (the instant) */
const OPERATORS: ReadonlyArray<readonly [string, unknown, string[], string[]]> = [
  ['$gt', { $gt: N }, ['o3'], ['o4', 'o5', 'o6']],
  ['$lt', { $lt: N }, ['o1', 'o2', 'o5'], ['o1', 'o2']],
  ['$eq', { $eq: N }, ['o4', 'o6'], ['o3']],
  ['$in', { $in: [N, N_JAN10] }, ['o1', 'o4', 'o6'], ['o3']],
  ['$between', { $between: [N_JAN02, N] }, ['o1', 'o2', 'o4', 'o5', 'o6'], ['o3']],
  ['$ne', { $ne: N }, ['o1', 'o2', 'o3', 'o5'], ['o1', 'o2', 'o4', 'o5', 'o6']],
  ['$nin', { $nin: [N, N_JAN10] }, ['o2', 'o3', 'o5'], ['o1', 'o2', 'o4', 'o5', 'o6']],
];

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

interface Door {
  engine: ObjectQL;
  post: (body: Record<string, unknown>) => Promise<any[]>;
}

/** A booted door over a real sqlite table, populated or empty. */
async function boot(populated: boolean): Promise<Door> {
  const driver: any = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
  const engine = new ObjectQL();
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
  const post = async (body: Record<string, unknown>) => {
    const res = makeRes();
    await route!.handler({ params: { object: OBJECT }, body: JSON.parse(JSON.stringify(body)) } as any, res);
    expect(res._status ?? 200, JSON.stringify(res._json)).toBe(200);
    return res._json.records as any[];
  };
  return { engine, post };
}

const doors: Record<'populated' | 'empty', Door> = {} as any;
beforeAll(async () => {
  doors.populated = await boot(true);
  doors.empty = await boot(false);
});
afterAll(async () => {
  for (const d of Object.values(doors)) {
    try { await d.engine.destroy(); } catch { /* noop */ }
  }
});

const sortedIds = (rows: any[]) => rows.map((r) => r.id).sort();

describe('[#20203] where — an epoch-ms number on a date field, engine and REST', () => {
  for (const [op, comparand, onDate, onDatetime] of OPERATORS) {
    it(`${op}: ${onDate.join(', ')} on both doors; nothing on an empty table; the datetime control reads the instant`, async () => {
      for (const [state, expectDate, expectDatetime] of [['populated', onDate, onDatetime], ['empty', [], []]] as const) {
        const { engine, post } = doors[state];
        expect(sortedIds(await engine.find(OBJECT, { where: { placed_on: comparand } } as any)), `engine, ${state}`).toEqual(expectDate);
        expect(sortedIds(await post({ where: { placed_on: comparand } })), `REST, ${state}`).toEqual(expectDate);
        expect(sortedIds(await post({ where: { opened_at: comparand } })), `datetime control, ${state}`).toEqual(expectDatetime);
      }
    });
  }
});

describe('[#20203] a per-aggregation filter counts what its where twin counts', () => {
  const perAggregation = (filter: unknown) => ({
    aggregations: [{ function: 'count', alias: 'n' }, { function: 'count', alias: 'm', filter }],
  });
  for (const [op, comparand, onDate] of OPERATORS) {
    it(`${op}: ${onDate.length} of 6 on both doors, 0 on an empty table`, async () => {
      for (const state of ['populated', 'empty'] as const) {
        const { engine, post } = doors[state];
        const expected = state === 'populated' ? onDate.length : 0;
        const query = perAggregation({ placed_on: comparand });
        expect((await engine.aggregate(OBJECT, query as any))[0]?.m, `engine, ${state}`).toBe(expected);
        expect((await post(query))[0]?.m, `REST, ${state}`).toBe(expected);
      }
    });
  }
});

describe('[#20203] having on max(date) reads the number as a calendar day', () => {
  const grouped = (having: unknown) => ({
    groupBy: ['customer_id'],
    aggregations: [
      { function: 'max', field: 'placed_on', alias: 'last_placed' },
      { function: 'min', field: 'opened_at', alias: 'first_opened' },
    ],
    having,
  });
  // c1: last_placed 2026-01-10 · c2: 2026-03-01 · c3: 2026-02-01
  const HAVING: ReadonlyArray<readonly [string, Record<string, unknown>, string[]]> = [
    ['$gt on max(date)', { last_placed: { $gt: N } }, ['c2']],
    ['$eq on max(date)', { last_placed: { $eq: N } }, ['c3']],
    ['$in on max(date)', { last_placed: { $in: [N, N_JAN10] } }, ['c1', 'c3']],
    ['control — the same number $gte on min(datetime)', { first_opened: { $gte: N } }, ['c2', 'c3']],
  ];
  for (const [name, having, kept] of HAVING) {
    it(`${name}: keeps ${kept.join(', ')} on both doors; nothing on an empty table`, async () => {
      for (const state of ['populated', 'empty'] as const) {
        const { engine, post } = doors[state];
        const expected = state === 'populated' ? kept : [];
        const q = grouped(having);
        expect((await engine.aggregate(OBJECT, q as any)).map((r: any) => r.customer_id).sort(), `engine, ${state}`).toEqual(expected);
        expect((await post(q)).map((r) => r.customer_id).sort(), `REST, ${state}`).toEqual(expected);
      }
    });
  }
});
