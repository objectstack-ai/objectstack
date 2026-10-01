// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21068] A date macro whose offset lands past every instant a JavaScript
 * `Date` can hold is refused at the public door: `POST /api/v1/data/:object/query`
 * answers `400 INVALID_FILTER` naming the placeholder, on `where`, a
 * per-aggregation `filter` and `having`, over a real `SqlDriver` on SQLite,
 * with no read of the object.
 *
 * Measured on the base (`fed0db8f6`) through this door, the card's two rows
 * (`opened_at` 2026-03-01T10:00Z and 1500-03-01T10:00Z), off 2026-09-30T12:00Z:
 *
 * | `where` | base | now |
 * |:--|:--|:--|
 * | `opened_at $lt {300000_years_ago}` | 200, both rows (resolved to the text `Invalid Date`, compared as text) | 400 |
 * | `opened_at $lt {99999999999999999999_minutes_ago}` | 500 `INTERNAL_ERROR` (an uncoded `RangeError` from the resolver) | 400 |
 * | control: `opened_at $lt {100_years_ago}` / `$gt` | the 1500 row / the 2026 row | unchanged |
 *
 * InMemoryDriver answered as SQLite on the base (both rows, and an uncoded
 * `RangeError` through `engine.find`). The refusal sits in `@objectstack/core`'s
 * resolver, in front of every driver; the engine-level pin with a recording
 * driver is `packages/objectql/src/engine-resolved-token-past-date-range.test.ts`.
 * SQLite is this file's only cell: the refusal precedes the driver, so a dialect
 * adds nothing to it.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { EngineAggregateOptions, FilterCondition } from '@objectstack/spec/data';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { RestServer } from './rest-server';

// Wed 2026-09-30 12:00 UTC: every resolved value below is read off this instant.
const PINNED_NOW = new Date('2026-09-30T12:00:00.000Z');

const OBJECT = 'rest_past_date_range_21068';

const LEDGER = {
  name: OBJECT,
  label: 'Ledger 21068',
  fields: {
    customer_id: { name: 'customer_id', type: 'text' as const },
    opened_at: { name: 'opened_at', type: 'datetime' as const },
  },
};

const ROWS = [
  { id: 'r2026', customer_id: 'c1', opened_at: '2026-03-01T10:00:00.000Z' },
  { id: 'r1500', customer_id: 'c2', opened_at: '1500-03-01T10:00:00.000Z' },
];

/** The card's two rows: a day-or-coarser macro and a sub-day one. */
const REFUSED = ['{300000_years_ago}', '{99999999999999999999_minutes_ago}'] as const;

/** operator · placeholder · the ids `where` answers — inside the range, the control */
const ANSWERED: ReadonlyArray<readonly [string, string, readonly string[]]> = [
  ['$lt', '{100_years_ago}', ['r1500']],
  ['$gt', '{100_years_ago}', ['r2026']],
  ['$lt', '{1_hour_ago}', ['r1500', 'r2026']],
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

const perAggregation = (filter: FilterCondition): EngineAggregateOptions => ({
  aggregations: [{ function: 'count', alias: 'n' }, { function: 'count', alias: 'm', filter }],
});
const grouped = (having: FilterCondition): EngineAggregateOptions => ({
  groupBy: ['customer_id'],
  aggregations: [{ function: 'max', field: 'opened_at', alias: 'last' }],
  having,
});

describe('[#21068] a date macro past the instants a Date holds, at the public door — sqlite', () => {
  let engine: ObjectQL;
  const reads = { n: 0 };
  let call: (method: string, path: string, params: Record<string, string>, body: unknown) => Promise<{ status: number; body: any }>;
  const query = (body: Record<string, unknown>) =>
    call('POST', '/api/v1/data/:object/query', { object: OBJECT }, JSON.parse(JSON.stringify(body)));

  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(PINNED_NOW);
    const driver: any = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true } as any);
    engine = new ObjectQL();
    engine.registerDriver(driver, true);
    await engine.init();
    engine.registry.registerObject(LEDGER as any);
    await engine.syncSchemas();
    for (const row of ROWS) await engine.insert(OBJECT, { ...row } as any);

    // Reads of THIS object — the protocol's own metadata traffic is not the question.
    for (const verb of ['find', 'findOne', 'count', 'aggregate'] as const) {
      const real = driver[verb].bind(driver);
      driver[verb] = (o: string, ...rest: unknown[]) => { if (o === OBJECT) reads.n += 1; return real(o, ...rest); };
    }

    const protocol = new ObjectStackProtocolImplementation(engine as any);
    const rest = new RestServer(createMockServer() as any, protocol as any, { api: { requireAuth: false } } as any);
    (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
    rest.registerRoutes();
    call = async (method, path, params, body) => {
      const route = rest.getRoutes().find((r: any) => r.method === method && r.path === path);
      expect(route, `${method} ${path}`).toBeDefined();
      const res = makeRes();
      await route!.handler({ params, body, query: {}, headers: {} } as any, res);
      return { status: res._status ?? 200, body: res._json };
    };
  });

  afterAll(async () => {
    vi.useRealTimers();
    try { await engine?.destroy(); } catch { /* noop */ }
  });

  it('both rows of the card: 400 INVALID_FILTER at where, the per-aggregation filter and having, naming the placeholder — no read', async () => {
    const before = reads.n;
    for (const token of REFUSED) {
      for (const [position, body] of [
        ['where', { where: { opened_at: { $lt: token } } }],
        ['filter', perAggregation({ opened_at: { $lt: token } } as FilterCondition)],
        ['having', grouped({ last: { $lt: token } } as FilterCondition)],
      ] as const) {
        const res = await query(body as Record<string, unknown>);
        const at = `${position}, opened_at $lt ${token}: ${JSON.stringify(res.body)}`;
        expect(res.status, at).toBe(400);
        expect(res.body.code, at).toBe('INVALID_FILTER');
        expect(String(res.body.error), at).toContain(`"${token}"`);
        expect(String(res.body.error), at).toContain('past every instant a JavaScript Date can hold');
        expect(JSON.stringify(res.body), at).not.toContain('Invalid Date');
      }
    }
    expect(reads.n - before, 'no read of the object — every refusal precedes the driver').toBe(0);
  });

  it('the control: a placeholder inside the range answers the right rows, at where, the filter and having', async () => {
    for (const [op, token, ids] of ANSWERED) {
      const where = { opened_at: { [op]: token } } as FilterCondition;
      const w = await query({ where });
      expect(w.status, `where ${op} ${token}: ${JSON.stringify(w.body)}`).toBe(200);
      expect(w.body.records.map((r: { id: string }) => r.id).sort(), `where ${op} ${token}`).toEqual([...ids].sort());
      const f = await query(perAggregation(where) as Record<string, unknown>);
      expect(f.status, `filter ${op} ${token}`).toBe(200);
      expect(Number(f.body.records[0]?.m), `filter ${op} ${token}`).toBe(ids.length);
      const h = await query(grouped({ last: { [op]: token } } as FilterCondition) as Record<string, unknown>);
      expect(h.status, `having ${op} ${token}`).toBe(200);
      expect(h.body.records.length, `having ${op} ${token}`).toBe(ids.length);
    }
  });
});
