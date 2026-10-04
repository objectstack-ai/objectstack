// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20263] `having` takes the temporal-comparand door `where` takes — through
 * `engine.aggregate` and `POST /api/v1/data/:object/query`, over a real
 * sqlite `SqlDriver`, on both `having` paths.
 *
 * Measured on the base (`89f87f2344`) through this door and `engine.aggregate`,
 * on InMemoryDriver, SqlDriver on SQLite and SqlDriver on PostgreSQL 16 (the
 * three agreed on every cell below), `groupBy` customer, four groups c1–c4:
 *
 * | `having` | base | its `where` twin |
 * |:--|:--|:--|
 * | `{ last_placed: { $lt: 'not-a-date' } }`, `max(placed_on)` | 200, keeps c1–c4 | 400 |
 * | `{ last_placed: { $gt: 'not-a-date' } }` | 200, keeps no group | 400 |
 * | `{ last_placed: { $gt: '+010000-01-01T00:00:00.000Z' } }` | 200, keeps c1–c4 | 400 |
 * | `{ last_placed: { $gt: 253402300800000 } }` (10000-01-01) | 200, keeps c1–c4 | 400 |
 * | `'not-a-date'` on `min(opened_at)` or `max(slot)`, `$lt` | 200, keeps c1–c4 | 400 |
 *
 * Each read the object once. Now each is refused `INVALID_FILTER` / 400 with
 * no read, on both paths and both doors, and a 2026 control answers the same
 * groups it did. The engine-side cells (a `Date`, a groupBy key, a day bucket,
 * `$in` / `$between` / `$or` / `$not`, and every cell the door leaves alone)
 * are pinned in `@objectstack/objectql`'s
 * `engine-aggregate-having-temporal-door.test.ts`.
 */

import { describe, it, expect, afterAll } from 'vitest';
import type { EngineAggregateOptions, FilterCondition } from '@objectstack/spec/data';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { RestServer } from './rest-server';

const OBJECT = 'ledger_having';

const LEDGER = {
  name: OBJECT,
  label: 'Ledger Having',
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
  { id: 'o5', customer_id: 'c3', amount: 50, placed_on: '2026-01-15', opened_at: '2026-02-06T10:00:00.000Z', slot: '13:00:00' },
  { id: 'o6', customer_id: 'c4', amount: 20, placed_on: '2026-02-01', opened_at: '2026-03-01T10:00:00.000Z', slot: '14:00:00' },
];

const Y10000 = 253402300800000; // +010000-01-01T00:00:00.000Z

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

const engines: ObjectQL[] = [];
afterAll(async () => {
  for (const e of engines) {
    try { await e.destroy(); } catch { /* noop */ }
  }
});

async function boot() {
  const driver: any = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
  const engine = new ObjectQL();
  engines.push(engine);
  engine.registerDriver(driver, true);
  await engine.init();
  engine.registry.registerObject(LEDGER as any);
  await engine.syncSchemas();
  await engine.insert(OBJECT, ROWS as any);

  // Reads of THIS object — the protocol's own metadata reads are not the question.
  const reads = { n: 0 };
  for (const verb of ['find', 'findOne', 'count', 'aggregate'] as const) {
    const real = driver[verb].bind(driver);
    driver[verb] = (o: string, ...rest: unknown[]) => { if (o === OBJECT) reads.n += 1; return real(o, ...rest); };
  }

  const protocol = new ObjectStackProtocolImplementation(engine as any);
  const rest = new RestServer(createMockServer() as any, protocol as any, { api: { requireAuth: false } } as any);
  (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
  rest.registerRoutes();
  const route = rest.getRoutes().find((r: any) => r.method === 'POST' && r.path === '/api/v1/data/:object/query');
  expect(route).toBeDefined();
  const post = async (body: Record<string, unknown>) => {
    const res = makeRes();
    // What the wire carries: JSON.
    await route!.handler({ params: { object: OBJECT }, body: JSON.parse(JSON.stringify(body)) } as any, res);
    return res;
  };
  return { engine, post, reads };
}

type Path = 'native' | 'rows';

/**
 * `native`: SqlDriver aggregates and the engine applies `having` to its
 * answer. `rows`: a filtered aggregation sends the engine to the rows path,
 * where it aggregates itself and then applies `having`.
 */
function grouped(path: Path, having: Record<string, unknown>): EngineAggregateOptions {
  const aggregations: NonNullable<EngineAggregateOptions['aggregations']> = [
    { function: 'max', field: 'placed_on', alias: 'last_placed' },
    { function: 'min', field: 'opened_at', alias: 'first_opened' },
    { function: 'max', field: 'slot', alias: 'last_slot' },
    { function: 'sum', field: 'amount', alias: 'total' },
  ];
  if (path === 'rows') aggregations.push({ function: 'count', alias: 'fb', filter: { customer_id: { $ne: '' } } });
  return { groupBy: ['customer_id'], aggregations, having: having as FilterCondition };
}

const refusalOf = async (p: Promise<unknown>) =>
  p.then(() => null, (e: any) => e as Error & { code?: string; status?: number });
const groupsOf = (rows: any[]) => rows.map((r) => r.customer_id).sort();

// name · having · its `where` twin · the message's column clause
const REFUSED: ReadonlyArray<readonly [string, Record<string, unknown>, Record<string, unknown>, string]> = [
  ['"not-a-date" $lt on max(date) — kept c1–c4', { last_placed: { $lt: 'not-a-date' } }, { placed_on: { $lt: 'not-a-date' } },
    "`having` on 'last_placed' (max(placed_on), a date column)"],
  ['"not-a-date" $gt on max(date) — kept no group', { last_placed: { $gt: 'not-a-date' } }, { placed_on: { $gt: 'not-a-date' } },
    "`having` on 'last_placed' (max(placed_on), a date column)"],
  ['an extended-year ISO $gt on max(date) — kept c1–c4', { last_placed: { $gt: '+010000-01-01T00:00:00.000Z' } },
    { placed_on: { $gt: '+010000-01-01T00:00:00.000Z' } }, "`having` on 'last_placed' (max(placed_on), a date column)"],
  ['the number for 10000-01-01 $gt on max(date) — kept c1–c4', { last_placed: { $gt: Y10000 } }, { placed_on: { $gt: Y10000 } },
    "`having` on 'last_placed' (max(placed_on), a date column)"],
  ['"not-a-date" $lt on min(datetime) — kept c1–c4', { first_opened: { $lt: 'not-a-date' } }, { opened_at: { $lt: 'not-a-date' } },
    "`having` on 'first_opened' (min(opened_at), a datetime column)"],
  ['"not-a-date" $lt on max(time) — kept c1–c4', { last_slot: { $lt: 'not-a-date' } }, { slot: { $lt: 'not-a-date' } },
    "`having` on 'last_slot' (max(slot), a time column)"],
];

describe('[#20263] having — a comparand its column cannot read is refused before any read, at the engine and over REST', () => {
  for (const [name, having, where, column] of REFUSED) {
    it(`${name}: INVALID_FILTER / 400 on both paths and both doors, as its where twin is`, async () => {
      const { engine, post, reads } = await boot();
      for (const path of ['native', 'rows'] as const) {
        const err = await refusalOf(engine.aggregate(OBJECT, grouped(path, having)));
        expect(err, `engine, ${path}`).not.toBeNull();
        expect(err!.code).toBe('INVALID_FILTER');
        expect(err!.status).toBe(400);
        expect(err!.message).toContain(column);
        expect(err!.message).toContain(`at having.${Object.keys(having)[0]}.`);
        const res = await post(grouped(path, having) as Record<string, unknown>);
        expect(res._status, `REST, ${path}`).toBe(400);
        expect(res._json.code).toBe('INVALID_FILTER');
        expect(res._json.error).toContain(column);
      }
      // The twin, at both doors: the same door, the same envelope.
      const twin = await refusalOf(engine.find(OBJECT, { where: where as FilterCondition }));
      expect(twin?.code).toBe('INVALID_FILTER');
      expect(twin?.status).toBe(400);
      const twinRes = await post({ where });
      expect(twinRes._status).toBe(400);
      expect(twinRes._json.code).toBe('INVALID_FILTER');
      expect(reads.n, 'no read of the object — every refusal precedes the driver').toBe(0);
    });
  }
});

describe('[#20263] having — the 2026 control and the non-temporal columns answer as they did', () => {
  // having · groups kept — measured identical on the base, all three drivers, both paths, both doors
  const KEPT: ReadonlyArray<readonly [string, Record<string, unknown>, string[]]> = [
    ['a 2026 day $gt on max(date)', { last_placed: { $gt: '2026-02-01' } }, ['c2']],
    ['a 2026 day $lt on max(date)', { last_placed: { $lt: '2026-02-01' } }, ['c1', 'c3']],
    ['a 2026 instant $gt on min(datetime)', { first_opened: { $gt: '2026-02-01T00:00:00.000Z' } }, ['c2', 'c3', 'c4']],
    ['a wall clock $lt on max(time)', { last_slot: { $lt: '12:00' } }, ['c1']],
    ['a number on sum — not temporal, not judged', { total: { $gt: 500 } }, ['c2']],
  ];
  for (const [name, having, kept] of KEPT) {
    it(`${name}: keeps ${kept.join(', ') || 'no group'}, engine and REST, both paths`, async () => {
      const { engine, post } = await boot();
      for (const path of ['native', 'rows'] as const) {
        expect(groupsOf(await engine.aggregate(OBJECT, grouped(path, having))), `engine, ${path}`).toEqual(kept);
        const res = await post(grouped(path, having) as Record<string, unknown>);
        expect(res._status ?? 200, JSON.stringify(res._json)).toBe(200);
        expect(groupsOf(res._json.records), `REST, ${path}`).toEqual(kept);
      }
    });
  }

  // [#20351] A string on sum is not this door's, and it no longer keeps no
  // group with a 200: the number-comparand door refuses it, before any read.
  it('a string on sum — not temporal: refused by the number-comparand door, engine and REST, both paths, no read', async () => {
    const { engine, post, reads } = await boot();
    const having = { total: { $gt: 'not-a-date' } };
    for (const path of ['native', 'rows'] as const) {
      const err = await refusalOf(engine.aggregate(OBJECT, grouped(path, having)));
      expect({ code: err?.code, status: err?.status }, `engine, ${path}`).toEqual({ code: 'INVALID_FILTER', status: 400 });
      const res = await post(grouped(path, having) as Record<string, unknown>);
      expect(res._status, JSON.stringify(res._json)).toBe(400);
      expect(res._json.code, `REST, ${path}`).toBe('INVALID_FILTER');
      expect(res._json.error, `REST, ${path}`).toContain('at having.total.$gt');
    }
    expect(reads.n).toBe(0);
  });
});
