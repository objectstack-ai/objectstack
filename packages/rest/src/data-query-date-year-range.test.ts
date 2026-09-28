// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20240] A `date` field's comparand has a four-digit year, or it is refused —
 * through `engine.find` / `engine.aggregate` and through
 * `POST /api/v1/data/:object/query`, over a real sqlite `SqlDriver`.
 *
 * Measured on the base through this door, on six 2026 days plus 0999-06-15
 * (`$gt` / `$lt` / `$eq`):
 *
 * | comparand | `where` | per-aggregation `filter` | the day's answer |
 * |:--|:--|:--|:--|
 * | number (or `Date`) for 0999-06-15 | 0 / 7 / 0 | 0 / 7 / 0 | 6 / 0 / 1 |
 * | its ISO string | 6 / 0 / 1 | 6 / 0 / 1 | 6 / 0 / 1 |
 * | number (or `Date`) for 10000-01-01 | 6 / 1 / 0 | 6 / 1 / 0 | no `YYYY-MM-DD` form |
 * | number (or `Date`) for -1-01-01 | 7 / 0 / 0 | 7 / 0 / 0 | no `YYYY-MM-DD` form |
 * | ISO string for 10000-01-01 or -1-01-01 | 400 | 400 | — |
 *
 * and `having` on `max(date)` kept no group for `$gt` 0999-06-15 where its
 * ISO string kept three. The storage rule spelled the year unpadded
 * (`999-06-15`, `10000-01-01`, `-1-01-01`), which sorts as no day does.
 * driver-memory answered as sqlite; PostgreSQL answered the 0999 `where` cells
 * right and the -1 cells with a 500 (`DATABASE_ERROR`) — each driver's own
 * suite pins its door.
 *
 * Now the year is padded to four digits, so the number, the `Date` and the ISO
 * string for 0999-06-15 answer one count at every position; and a number or
 * `Date` whose day falls in a year below 0 or above 9999 is refused
 * `INVALID_FILTER` / 400 before any read, as its ISO string already was, at
 * `where` and the per-aggregation `filter`. [#20263] `having` reaches the same
 * door since, by the same predicate; its out-of-range cells are pinned in
 * `data-query-having-temporal-door.test.ts`, not in this file.
 */

import { describe, it, expect, afterAll } from 'vitest';
import type { EngineAggregateOptions, FilterCondition } from '@objectstack/spec/data';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { RestServer } from './rest-server';

const OBJECT = 'ledger_year';

const LEDGER_YEAR = {
  name: OBJECT,
  label: 'Ledger Year',
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
  { id: 'o7', customer_id: 'c4', placed_on: '0999-06-15', opened_at: '2026-04-01T10:00:00.000Z' },
];

const Y0999 = -30627504000000; //   0999-06-15T00:00:00.000Z
const Y10000 = 253402300800000; //  +010000-01-01T00:00:00.000Z
const YNEG1 = -62198755200000; //   -000001-01-01T00:00:00.000Z
const N = 1769940000000; //         2026-02-01T10:00:00.000Z — the control

/** day · operator · `where` ids · `having` groups on max(date) — one answer for every spelling */
const READ: ReadonlyArray<readonly [string, number, string, string[], string[]]> = [
  ['0999-06-15', Y0999, '$gt', ['o1', 'o2', 'o3', 'o4', 'o5', 'o6'], ['c1', 'c2', 'c3']],
  ['0999-06-15', Y0999, '$lt', [], []],
  ['0999-06-15', Y0999, '$eq', ['o7'], ['c4']],
  ['2026-02-01 (control)', N, '$gt', ['o3'], ['c2']],
  ['2026-02-01 (control)', N, '$lt', ['o1', 'o2', 'o5', 'o7'], ['c1', 'c4']],
  ['2026-02-01 (control)', N, '$eq', ['o4', 'o6'], ['c3']],
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
  engine.registry.registerObject(LEDGER_YEAR as any);
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
    // What the wire carries: JSON, so a `Date` arrives as its ISO text.
    await route!.handler({ params: { object: OBJECT }, body: JSON.parse(JSON.stringify(body)) } as any, res);
    return res;
  };
  return { engine, post, reads };
}

const sortedIds = (rows: any[]) => rows.map((r) => r.id).sort();
const perAggregation = (filter: FilterCondition): EngineAggregateOptions => ({
  aggregations: [{ function: 'count', alias: 'n' }, { function: 'count', alias: 'm', filter }],
});
const grouped = (having: FilterCondition): EngineAggregateOptions => ({
  groupBy: ['customer_id'],
  aggregations: [{ function: 'max', field: 'placed_on', alias: 'last_placed' }],
  having,
});
const refusalOf = async (p: Promise<unknown>) =>
  p.then(() => null, (e: any) => e as Error & { code?: string; status?: number });

describe('[#20240] a four-digit year — the number, the Date and the ISO string give one answer, engine and REST', () => {
  for (const [day, ms, op, whereIds, havingGroups] of READ) {
    it(`${day} ${op}: where ${whereIds.length}, the per-aggregation filter ${whereIds.length}, having ${havingGroups.join(', ') || 'no group'}`, async () => {
      const { engine, post } = await boot();
      // Over REST a `Date` IS its ISO string (JSON), so the `Date` spelling is the engine's.
      const spellings: ReadonlyArray<readonly [string, unknown, boolean]> = [
        ['number', ms, true],
        ['Date', new Date(ms), false],
        ['ISO string', new Date(ms).toISOString(), true],
      ];
      for (const [form, comparand, overRest] of spellings) {
        const where = { placed_on: { [op]: comparand } } as FilterCondition;
        expect(sortedIds(await engine.find(OBJECT, { where })), `where, engine, ${form}`).toEqual(whereIds);
        expect((await engine.aggregate(OBJECT, perAggregation(where)))[0]?.m, `filter, engine, ${form}`).toBe(whereIds.length);
        expect((await engine.aggregate(OBJECT, grouped({ last_placed: { [op]: comparand } } as FilterCondition)))
          .map((r: any) => r.customer_id).sort(), `having, engine, ${form}`).toEqual(havingGroups);
        if (!overRest) continue;
        const w = await post({ where });
        expect(w._status ?? 200, JSON.stringify(w._json)).toBe(200);
        expect(sortedIds(w._json.records), `where, REST, ${form}`).toEqual(whereIds);
        const f = await post(perAggregation(where) as Record<string, unknown>);
        expect(f._json.records[0]?.m, `filter, REST, ${form}`).toBe(whereIds.length);
        const h = await post(grouped({ last_placed: { [op]: comparand } } as FilterCondition) as Record<string, unknown>);
        expect(h._json.records.map((r: any) => r.customer_id).sort(), `having, REST, ${form}`).toEqual(havingGroups);
      }
    });
  }
});

describe('[#20240] a year outside the four-digit years — the number and the Date are refused as their ISO string is, before any read', () => {
  for (const [day, ms] of [['10000-01-01', Y10000], ['-1-01-01', YNEG1]] as const) {
    it(`${day}: INVALID_FILTER / 400 at where and at the per-aggregation filter, on both doors — on a datetime too [#20264]; a 2026 instant is read`, async () => {
      const { engine, post, reads } = await boot();
      for (const op of ['$gt', '$lt', '$eq'] as const) {
        for (const [form, comparand] of [['number', ms], ['Date', new Date(ms)], ['ISO string', new Date(ms).toISOString()]] as const) {
          const where = { placed_on: { [op]: comparand } } as FilterCondition;
          for (const [position, call] of [
            ['where', () => engine.find(OBJECT, { where })],
            ['filter', () => engine.aggregate(OBJECT, perAggregation(where))],
          ] as const) {
            const err = await refusalOf(call());
            expect(err, `${position}, engine, ${form} ${op}`).not.toBeNull();
            expect(err!.code).toBe('INVALID_FILTER');
            expect(err!.status).toBe(400);
          }
          // Over REST the number is the number and the `Date` is its ISO string.
          for (const [position, body] of [
            ['where', { where }],
            ['filter', perAggregation(where)],
          ] as const) {
            const res = await post(body as Record<string, unknown>);
            expect(res._status, `${position}, REST, ${form} ${op}`).toBe(400);
            expect(res._json.code, `${position}, REST, ${form} ${op}`).toBe('INVALID_FILTER');
          }
        }
      }
      expect(reads.n, 'no read of the object — the refusal precedes the driver').toBe(0);

      // [#20264] The same numbers on a `datetime` field are refused too — the
      // supported years 0001..9999 hold for both kinds.
      for (const comparand of [ms, new Date(ms)]) {
        const err = await refusalOf(engine.find(OBJECT, { where: { opened_at: { $gt: comparand } } }));
        expect(err).toMatchObject({ code: 'INVALID_FILTER', status: 400 });
      }
      const refused = await post({ where: { opened_at: { $gt: ms } } });
      expect(refused._status).toBe(400);
      expect(reads.n).toBe(0);
      // Control: a 2026 instant on the same field is read.
      const control = await post({ where: { opened_at: { $gt: N } } });
      expect(control._status ?? 200, JSON.stringify(control._json)).toBe(200);
      expect(reads.n).toBeGreaterThan(0);
    });
  }
});
