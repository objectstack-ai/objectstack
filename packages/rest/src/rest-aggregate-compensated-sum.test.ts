// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20489] On SQLite, `sum` / `avg` answer ONE double on both of
 * `engine.aggregate`'s paths — the native `SqlDriver.aggregate` and the rows
 * path (`objectql`'s `in-memory-aggregation.ts`, which a filtered sibling
 * aggregation forces) — through `engine.aggregate` and
 * `POST /api/v1/data/:object/query`, over a real `SqlDriver`.
 *
 * SQLite 3.43+ sums with Kahan-Babuska-Neumaier compensation; the rows path
 * used to add naively. Measured on the base (`b2b6a0643`), SQLite 3.53.4, a
 * `number` column, same readings through the engine and REST:
 *
 * | group | native `sum` / `avg` | rows path `sum` / `avg` (base) |
 * |:--|:--|:--|
 * | `0.1, 0.2, 0.3` | `0.6` / `0.19999999999999998` | `0.6000000000000001` / `0.20000000000000004` |
 * | `1e16, 1, -1e16` | `1` / `0.3333333333333333` | `0` / `0` |
 * | `1e16, 0.5, -1e16` | `0.5` / `0.16666666666666666` | `0` / `0` |
 * | `0.1, 0.2` | `0.30000000000000004` / `0.15000000000000002` | the same |
 * | `1, 2, 3, 40, 500` | `546` / `109.2` | the same |
 *
 * `having { s: { $eq: 0.6 } }` kept the first group on the native path and no
 * group on the rows path. The rows path now adds with the same compensation,
 * so every row of that table reads as its native column on both paths.
 *
 * ## The dialect axis of THIS file
 *
 * SQLite only, and deliberately. PostgreSQL and MySQL add their doubles
 * natively without compensation (`sql-driver.ts`, `AGGREGATE_ACCUMULATION`), so
 * over three or more fractions their native path can differ from the rows path
 * in the last place: that is the residual #20489 states, not a defect a pin
 * here should hold red. An exact `$eq` on a fractional sum compares doubles.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { EngineAggregateOptions, FilterCondition } from '@objectstack/spec/data';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { RestServer } from './rest-server';

const OBJECT = 'rest_agg_20489';

const LEDGER = {
  name: OBJECT,
  label: 'Ledger 20489',
  fields: {
    g: { name: 'g', type: 'text' as const },
    w: { name: 'w', type: 'number' as const },
  },
};

/** group → its values, and SQLite's native `sum` / `avg` over them. */
const GROUPS: Record<string, { values: number[]; s: number; a: number }> = {
  card: { values: [0.1, 0.2, 0.3], s: 0.6, a: 0.19999999999999998 },
  cancel: { values: [1e16, 1, -1e16], s: 1, a: 0.3333333333333333 },
  cancel_half: { values: [1e16, 0.5, -1e16], s: 0.5, a: 0.16666666666666666 },
  two: { values: [0.1, 0.2], s: 0.30000000000000004, a: 0.15000000000000002 },
  ints: { values: [1, 2, 3, 40, 500], s: 546, a: 109.2 },
};

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

type Path = 'native' | 'rows';

/**
 * `native`: SqlDriver aggregates and the engine applies `having` to its
 * answer. `rows`: a filtered aggregation sends the engine to the rows path,
 * where it aggregates `find()` rows itself and then applies `having`.
 */
function grouped(path: Path, having?: Record<string, unknown>): EngineAggregateOptions {
  const aggregations: NonNullable<EngineAggregateOptions['aggregations']> = [
    { function: 'sum', field: 'w', alias: 's' },
    { function: 'avg', field: 'w', alias: 'a' },
  ];
  if (path === 'rows') aggregations.push({ function: 'count', alias: 'fb', filter: { g: { $ne: '' } } });
  return { groupBy: ['g'], aggregations, ...(having ? { having: having as FilterCondition } : {}) };
}

const byGroup = (rows: any[]) => Object.fromEntries(rows.map((r) => [r.g, { s: r.s, a: r.a }]));
const groupsOf = (rows: any[]) => rows.map((r) => r.g).sort();

describe('[#20489] sum / avg — one double on both SQLite paths, engine and REST', () => {
  let engine: ObjectQL;
  let driver: SqlDriver;
  let post: (body: Record<string, unknown>) => Promise<any>;

  beforeAll(async () => {
    driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true } as never);
    engine = new ObjectQL();
    engine.registerDriver(driver, true);
    await engine.init();
    engine.registry.registerObject(LEDGER as any);
    await engine.syncSchemas();
    let i = 0;
    for (const [g, { values }] of Object.entries(GROUPS)) {
      for (const w of values) await engine.insert(OBJECT, { id: `r${i++}`, g, w } as any);
    }

    const protocol = new ObjectStackProtocolImplementation(engine as any);
    const rest = new RestServer(createMockServer() as any, protocol as any, { api: { requireAuth: false } } as any);
    (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
    rest.registerRoutes();
    const route = rest.getRoutes().find((r: any) => r.method === 'POST' && r.path === '/api/v1/data/:object/query');
    expect(route).toBeDefined();
    post = async (body) => {
      const res = makeRes();
      // What the wire carries: JSON, both ways.
      await route!.handler({ params: { object: OBJECT }, body: JSON.parse(JSON.stringify(body)) } as any, res);
      if (res._json !== undefined) res._json = JSON.parse(JSON.stringify(res._json));
      return res;
    };
  });

  afterAll(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
  });

  it('each path is the one it names: native asks driver.aggregate, rows asks driver.find alone', async () => {
    const spy = vi.spyOn(driver, 'aggregate');
    try {
      await engine.aggregate(OBJECT, grouped('native'));
      expect(spy, 'native').toHaveBeenCalledTimes(1);
      spy.mockClear();
      await engine.aggregate(OBJECT, grouped('rows'));
      expect(spy, 'rows').not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it("find() reads back the doubles written, so both paths add the same operands", async () => {
    const rows = (await engine.find(OBJECT, {})) as Array<{ g: string; w: number }>;
    for (const [g, { values }] of Object.entries(GROUPS)) {
      expect(rows.filter((r) => r.g === g).map((r) => r.w).sort((x, y) => x - y), g)
        .toStrictEqual([...values].sort((x, y) => x - y));
    }
  });

  it('sum / avg: SQLite native answers, equal on both paths, through the engine and REST', async () => {
    const expected = Object.fromEntries(Object.entries(GROUPS).map(([g, { s, a }]) => [g, { s, a }]));
    for (const path of ['native', 'rows'] as const) {
      expect(byGroup(await engine.aggregate(OBJECT, grouped(path))), `engine, ${path}`).toStrictEqual(expected);
      const res = await post(grouped(path) as Record<string, unknown>);
      expect(res._status ?? 200, JSON.stringify(res._json)).toBe(200);
      expect(byGroup(res._json.records), `REST, ${path}`).toStrictEqual(expected);
    }
  });

  it('having $eq on the fractional sum / avg keeps the same group on both paths', async () => {
    const KEPT: ReadonlyArray<readonly [Record<string, unknown>, string[]]> = [
      [{ s: { $eq: 0.6 } }, ['card']],
      [{ a: { $eq: 0.19999999999999998 } }, ['card']],
      [{ s: { $eq: 1 } }, ['cancel']],
      [{ s: { $in: [0.5, 546] } }, ['cancel_half', 'ints']],
      // The residual, as a double: `0.1 + 0.2` is not `0.3` on any path.
      [{ s: { $eq: 0.3 } }, []],
      [{ s: { $eq: 0.30000000000000004 } }, ['two']],
    ];
    for (const [having, kept] of KEPT) {
      for (const path of ['native', 'rows'] as const) {
        expect(groupsOf(await engine.aggregate(OBJECT, grouped(path, having))), `engine, ${path}, ${JSON.stringify(having)}`)
          .toEqual(kept);
        const res = await post(grouped(path, having) as Record<string, unknown>);
        expect(res._status ?? 200, JSON.stringify(res._json)).toBe(200);
        expect(groupsOf(res._json.records), `REST, ${path}, ${JSON.stringify(having)}`).toEqual(kept);
      }
    }
  });
});
