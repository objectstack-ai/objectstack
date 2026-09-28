// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20334] `having` resolves `{placeholder}` tokens through `where`'s resolver,
 * and the per-aggregation `filter`'s temporal and text-operator refusals name
 * `aggregations[i].filter` — through `engine.aggregate` and
 * `POST /api/v1/data/:object/query`, over a real sqlite `SqlDriver`, on both
 * `having` paths.
 *
 * Measured on the base (`26daf0b036`) and the head through this door and
 * `engine.aggregate`, on InMemoryDriver, SqlDriver on SQLite and SqlDriver on
 * PostgreSQL 16 (the three agreed on every cell below), `groupBy` customer,
 * four groups c1–c4:
 *
 * | position · input | base | head |
 * |:--|:--|:--|
 * | `having` `{ last_placed: { $gt: '{current_year_start}' } }` | 200, no group | 200, c1–c4, as `'2026-01-01'` |
 * | `having` `{ last_placed: { $gte: '{not_a_token}' } }` | 200, no group | 400 `FILTER_TOKEN_UNKNOWN`, as its `where` twin |
 * | `aggregations[1].filter` `{ placed_on: { $gt: 'not-a-date' } }` | 400 `at where.placed_on.$gt` | 400 `at aggregations[1].filter.placed_on.$gt` |
 * | `aggregations[1].filter` `{ amount: { $contains: '5' } }` | 400 `at where.amount.$contains` | 400 `at aggregations[1].filter.amount.$contains` |
 *
 * The engine-side cells (both path shapes with a counting driver, `$between`,
 * `$in`, `$and` / `$or` / `$not`, the unresolved context tokens, the door
 * order) are pinned in `@objectstack/objectql`'s
 * `engine-aggregate-positions.test.ts`.
 */

import { describe, it, expect, afterAll, beforeAll, vi } from 'vitest';
import type { EngineAggregateOptions, FilterCondition } from '@objectstack/spec/data';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { RestServer } from './rest-server';

const OBJECT = 'ledger_positions';

const LEDGER = {
  name: OBJECT,
  label: 'Ledger Positions',
  fields: {
    customer_id: { name: 'customer_id', type: 'text' as const },
    amount: { name: 'amount', type: 'number' as const },
    placed_on: { name: 'placed_on', type: 'date' as const },
  },
};

const ROWS = [
  { id: 'o1', customer_id: 'c1', amount: 100, placed_on: '2026-01-10' },
  { id: 'o2', customer_id: 'c1', amount: 400, placed_on: '2026-01-02' },
  { id: 'o3', customer_id: 'c2', amount: 900, placed_on: '2026-03-01' },
  { id: 'o4', customer_id: 'c2', amount: 300, placed_on: '2026-02-01' },
  { id: 'o5', customer_id: 'c3', amount: 50, placed_on: '2026-01-15' },
  { id: 'o6', customer_id: 'c4', amount: 20, placed_on: '2026-02-01' },
];

// The resolver's reference instant, pinned: `{current_year_start}` is
// 2026-01-01 and `{current_month_start}` 2026-02-01.
beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-02-20T12:00:00.000Z'));
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

const engines: ObjectQL[] = [];
afterAll(async () => {
  for (const e of engines) {
    try { await e.destroy(); } catch { /* noop */ }
  }
  vi.useRealTimers();
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
  let userId = 'test-user';
  (rest as any).resolveExecCtx = async () => ({ userId });
  rest.registerRoutes();
  const route = rest.getRoutes().find((r: any) => r.method === 'POST' && r.path === '/api/v1/data/:object/query');
  expect(route).toBeDefined();
  const post = async (body: Record<string, unknown>, asUser = 'test-user') => {
    userId = asUser;
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
    { function: 'sum', field: 'amount', alias: 'total' },
  ];
  if (path === 'rows') aggregations.push({ function: 'count', alias: 'fb', filter: { customer_id: { $ne: '' } } });
  return { groupBy: ['customer_id'], aggregations, having: having as FilterCondition };
}

const refusalOf = async (p: Promise<unknown>) =>
  p.then(() => null, (e: any) => e as Error & { code?: string; status?: number });
const groupsOf = (rows: any[]) => rows.map((r) => r.customer_id).sort();

describe('[#20334] having — a placeholder resolves, at the engine and over REST, on both paths', () => {
  // having with a token · the same having with the value written out · groups kept
  const RESOLVED: ReadonlyArray<readonly [Record<string, unknown>, Record<string, unknown>, string[]]> = [
    [{ last_placed: { $gt: '{current_year_start}' } }, { last_placed: { $gt: '2026-01-01' } }, ['c1', 'c2', 'c3', 'c4']],
    [{ last_placed: { $gte: '{current_month_start}' } }, { last_placed: { $gte: '2026-02-01' } }, ['c2', 'c4']],
  ];
  for (const [having, literal, kept] of RESOLVED) {
    it(`${JSON.stringify(having)}: keeps ${kept.join(', ')}, as ${JSON.stringify(literal)} does`, async () => {
      const { engine, post } = await boot();
      for (const path of ['native', 'rows'] as const) {
        for (const h of [having, literal]) {
          expect(groupsOf(await engine.aggregate(OBJECT, grouped(path, h))), `engine, ${path}`).toEqual(kept);
          const res = await post(grouped(path, h) as Record<string, unknown>);
          expect(res._status ?? 200, JSON.stringify(res._json)).toBe(200);
          expect(groupsOf(res._json.records), `REST, ${path}`).toEqual(kept);
        }
      }
    });
  }

  it('{current_user_id} resolves from the request identity over REST', async () => {
    const { post } = await boot();
    for (const path of ['native', 'rows'] as const) {
      const res = await post(grouped(path, { customer_id: '{current_user_id}' }) as Record<string, unknown>, 'c2');
      expect(res._status ?? 200, JSON.stringify(res._json)).toBe(200);
      expect(groupsOf(res._json.records), path).toEqual(['c2']);
    }
  });
});

describe('[#20334] having — an unknown placeholder is refused before any read, as its where twin is', () => {
  it("{ $gte: '{not_a_token}' } on max(date): FILTER_TOKEN_UNKNOWN / 400 at both doors, both paths — it kept no group with a 200", async () => {
    const { engine, post, reads } = await boot();
    const twin = await refusalOf(engine.find(OBJECT, { where: { placed_on: { $gte: '{not_a_token}' } } }));
    expect(twin?.code).toBe('FILTER_TOKEN_UNKNOWN');
    expect(twin?.status).toBe(400);
    const twinRes = await post({ where: { placed_on: { $gte: '{not_a_token}' } } });
    expect(twinRes._status).toBe(400);
    expect(twinRes._json.code).toBe('FILTER_TOKEN_UNKNOWN');
    for (const path of ['native', 'rows'] as const) {
      const having = { last_placed: { $gte: '{not_a_token}' } };
      const err = await refusalOf(engine.aggregate(OBJECT, grouped(path, having)));
      expect(err?.code, `engine, ${path}`).toBe('FILTER_TOKEN_UNKNOWN');
      expect(err?.status).toBe(400);
      expect(err?.message).toBe(twin?.message);
      const res = await post(grouped(path, having) as Record<string, unknown>);
      expect(res._status, `REST, ${path}`).toBe(400);
      expect(res._json.code).toBe('FILTER_TOKEN_UNKNOWN');
      expect(res._json.error).toBe(twinRes._json.error);
    }
    expect(reads.n, 'no read of the object — every refusal precedes the driver').toBe(0);
  });
});

describe('[#20334] per-aggregation filter — the refusal names aggregations[1].filter, the where twin names where', () => {
  // filter · the key path under the position's root
  const REFUSED: ReadonlyArray<readonly [Record<string, unknown>, string]> = [
    [{ placed_on: { $gt: 'not-a-date' } }, '.placed_on.$gt'],
    [{ amount: { $contains: '5' } }, '.amount.$contains'],
  ];
  for (const [filter, at] of REFUSED) {
    it(`${JSON.stringify(filter)}: INVALID_FILTER / 400 at aggregations[1].filter${at}, at both doors`, async () => {
      const { engine, post, reads } = await boot();
      const body: EngineAggregateOptions = {
        groupBy: ['customer_id'],
        aggregations: [{ function: 'count', alias: 'n' }, { function: 'count', alias: 'm', filter: filter as FilterCondition }],
      };
      const err = await refusalOf(engine.aggregate(OBJECT, body));
      expect(err?.code).toBe('INVALID_FILTER');
      expect(err?.status).toBe(400);
      expect(err?.message).toContain(`at aggregations[1].filter${at}`);
      expect(err?.message).not.toContain(' at where.');
      const res = await post(body as Record<string, unknown>);
      expect(res._status).toBe(400);
      expect(res._json.code).toBe('INVALID_FILTER');
      expect(res._json.error).toContain(`at aggregations[1].filter${at}`);
      // The control: the same condition as a `where` keeps its own root.
      const twinRes = await post({ where: filter });
      expect(twinRes._status).toBe(400);
      expect(twinRes._json.code).toBe('INVALID_FILTER');
      expect(twinRes._json.error).toContain(`at where${at}`);
      expect(reads.n, 'no read of the object').toBe(0);
    });
  }
});
