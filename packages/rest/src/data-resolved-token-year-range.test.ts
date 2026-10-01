// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20844] A relative-date placeholder that resolves outside its field's
 * years — a `date` 0001..9999, a `datetime` 1000..9999 — is refused at the
 * public door: `POST /api/v1/data/:object/query` answers `400 INVALID_FILTER`
 * naming the placeholder and the year it resolved to, on `where`, a
 * per-aggregation `filter` and `having`, over a real `SqlDriver` on SQLite.
 *
 * Measured on the base (`2f2fa11d7`) through this door, the card's two rows
 * (`opened_at` 2026-03-01T10:00Z and 1500-03-01T10:00Z):
 *
 * | `where` | base | now |
 * |:--|:--|:--|
 * | `opened_at $gt {8000_years_from_now}` | 200, both rows | 400 |
 * | `opened_at $lt {2027_years_ago}` | 200, the 1500 row (`-1-…` read as 2001) | 400 |
 * | `opened_at $lt {1977_years_ago}` | 200, no row | 400 (the `datetime` floor) |
 * | `placed_on $gt {8000_years_from_now}` | 200, both rows | 400 |
 * | `opens_at` (`time`, 09:00 and 12:00) `$gt {8000_years_from_now}` | 200, both rows (compared as text) | 400 |
 *
 * The right answer to each was no row. Every refusal sits beside its control:
 * a placeholder resolved inside the range answers the right rows. InMemoryDriver
 * answered as SQLite on the base; the refusal sits in the engine, in front of
 * every driver, and the engine-level pin with a recording driver is
 * `packages/objectql/src/engine-resolved-token-year-range.test.ts`. SQLite is
 * this file's only cell: the refusal precedes the driver, so a dialect adds
 * nothing to it.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { EngineAggregateOptions, FilterCondition } from '@objectstack/spec/data';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { RestServer } from './rest-server';

// Wed 2026-09-30 12:00 UTC: every resolved day below is read off this instant.
const PINNED_NOW = new Date('2026-09-30T12:00:00.000Z');

const OBJECT = 'rest_resolved_token_20844';

const LEDGER = {
  name: OBJECT,
  label: 'Ledger 20844',
  fields: {
    customer_id: { name: 'customer_id', type: 'text' as const },
    placed_on: { name: 'placed_on', type: 'date' as const },
    opened_at: { name: 'opened_at', type: 'datetime' as const },
    opens_at: { name: 'opens_at', type: 'time' as const },
  },
};

const ROWS = [
  { id: 'r2026', customer_id: 'c1', placed_on: '2026-03-01', opened_at: '2026-03-01T10:00:00.000Z', opens_at: '09:00:00' },
  { id: 'r1500', customer_id: 'c2', placed_on: '1500-03-01', opened_at: '1500-03-01T10:00:00.000Z', opens_at: '12:00:00' },
];

/** field · operator · placeholder · the resolved value and year a refusal names */
const REFUSED: ReadonlyArray<readonly [string, string, string, string]> = [
  ['opened_at', '$gt', '{8000_years_from_now}', '"+010026-09-30" (the year 10026)'],
  ['opened_at', '$lt', '{2027_years_ago}', '"-000001-09-30" (the year -1)'],
  ['placed_on', '$gt', '{8000_years_from_now}', '"+010026-09-30" (the year 10026)'],
  ['placed_on', '$lt', '{2027_years_ago}', '"-000001-09-30" (the year -1)'],
  // The `datetime` floor of 1000 applies to a resolved placeholder as to a literal.
  ['opened_at', '$lt', '{1977_years_ago}', '"0049-09-30" (the year 49)'],
  // A `time` column keeps no time of day from an instant with no four-digit year.
  ['opens_at', '$gt', '{8000_years_from_now}', '"+010026-09-30" (the year 10026)'],
];

/** field · operator · placeholder · the ids `where` answers — inside the range, the control */
const ANSWERED: ReadonlyArray<readonly [string, string, string, readonly string[]]> = [
  ['opened_at', '$lt', '{100_years_ago}', ['r1500']],
  ['opened_at', '$gt', '{100_years_ago}', ['r2026']],
  ['opened_at', '$gt', '{1026_years_ago}', ['r1500', 'r2026']],
  ['placed_on', '$lt', '{100_years_ago}', ['r1500']],
  // A `date` keeps the years before 1000.
  ['placed_on', '$gt', '{1977_years_ago}', ['r1500', 'r2026']],
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
const grouped = (field: string, having: FilterCondition): EngineAggregateOptions => ({
  groupBy: ['customer_id'],
  aggregations: [{ function: 'max', field, alias: 'last' }],
  having,
});

describe('[#20844] a relative-date placeholder resolved outside its field\'s years, at the public door — sqlite', () => {
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

  it('400 INVALID_FILTER at where, the per-aggregation filter and having, naming the placeholder and the year — no read', async () => {
    const before = reads.n;
    for (const [field, op, token, resolved] of REFUSED) {
      const where = { [field]: { [op]: token } } as FilterCondition;
      for (const [position, body] of [
        ['where', { where }],
        ['filter', perAggregation(where)],
        ['having', grouped(field, { last: { [op]: token } } as FilterCondition)],
      ] as const) {
        const res = await query(body as Record<string, unknown>);
        const at = `${position}, ${field} ${op} ${token}: ${JSON.stringify(res.body)}`;
        expect(res.status, at).toBe(400);
        expect(res.body.code, at).toBe('INVALID_FILTER');
        expect(String(res.body.error), at).toContain(`"${token}"`);
        expect(String(res.body.error), at).toContain(`resolved to ${resolved}`);
      }
    }
    expect(reads.n - before, 'no read of the object — every refusal precedes the driver').toBe(0);
  });

  it('the control: a placeholder resolved inside the range answers the right rows, at where, the filter and having', async () => {
    for (const [field, op, token, ids] of ANSWERED) {
      const where = { [field]: { [op]: token } } as FilterCondition;
      const w = await query({ where });
      expect(w.status, `where ${field} ${op} ${token}: ${JSON.stringify(w.body)}`).toBe(200);
      expect(w.body.records.map((r: { id: string }) => r.id).sort(), `where ${field} ${op} ${token}`).toEqual([...ids].sort());
      const f = await query(perAggregation(where) as Record<string, unknown>);
      expect(f.status, `filter ${field} ${op} ${token}`).toBe(200);
      expect(Number(f.body.records[0]?.m), `filter ${field} ${op} ${token}`).toBe(ids.length);
      const h = await query(grouped(field, { last: { [op]: token } } as FilterCondition) as Record<string, unknown>);
      expect(h.status, `having ${field} ${op} ${token}`).toBe(200);
      expect(h.body.records.length, `having ${field} ${op} ${token}`).toBe(ids.length);
    }
  });
});
