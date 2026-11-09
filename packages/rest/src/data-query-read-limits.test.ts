// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The data API's host-configured read limits on both list doors —
 * `GET /data/:object` and `POST /data/:object/query` — over a real `SqlDriver`
 * (SQLite), five rows.
 *
 * The rule (`@objectstack/types`' `query-read-limits.ts`, unit-pinned in that
 * package): `OS_DATA_DEFAULT_PAGE_SIZE` is the page a read naming no limit
 * gets, `OS_DATA_MAX_PAGE_SIZE` is the largest limit it may name, and
 * `OS_DATA_QUERY_ROW_BUDGET` bounds `offset` plus the rows returned. Over a
 * limit is a `400` refusal naming it, before the driver is asked — never a
 * clamp. All three unset is today's behaviour, pinned first.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { RestServer } from './rest-server';
import { installDefaultOrganization } from './default-organization.testkit.js';

const OBJECT = 'rest_query_read_limits';

const ITEMS = {
  name: OBJECT,
  label: 'Read limit items',
  fields: {
    label: { name: 'label', type: 'text' as const },
    kind: { name: 'kind', type: 'text' as const },
  },
};

const LABELS = ['a', 'b', 'c', 'd', 'e'];
const ENV_VARS = ['OS_DATA_DEFAULT_PAGE_SIZE', 'OS_DATA_MAX_PAGE_SIZE', 'OS_DATA_QUERY_ROW_BUDGET'] as const;

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

function setLimits(limits: Partial<Record<(typeof ENV_VARS)[number], string>>) {
  for (const name of ENV_VARS) {
    if (limits[name] === undefined) delete process.env[name];
    else process.env[name] = limits[name];
  }
}

describe('data API read limits on both list doors — sqlite', () => {
  let engine: ObjectQL;
  let driver: any;
  const reads = { n: 0 };
  const saved: Record<string, string | undefined> = {};
  let list: (query: Record<string, string>) => Promise<{ status: number; body: any }>;
  let query: (body: Record<string, unknown>) => Promise<{ status: number; body: any }>;

  beforeAll(async () => {
    for (const name of ENV_VARS) saved[name] = process.env[name];
    setLimits({});
    driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true } as any);
    engine = new ObjectQL();
    engine.registerDriver(driver, true);
    await engine.init();
    engine.registry.registerObject(ITEMS as any);
    await engine.syncSchemas();
    await installDefaultOrganization(engine);
    for (const label of LABELS) await engine.insert(OBJECT, { id: `r${label}`, label, kind: label < 'c' ? 'x' : 'y' } as any);

    // Reads of THIS object — the protocol's own metadata traffic is not the question.
    for (const verb of ['find', 'findOne', 'count', 'aggregate'] as const) {
      const real = driver[verb].bind(driver);
      driver[verb] = (o: string, ...rest: unknown[]) => { if (o === OBJECT) reads.n += 1; return real(o, ...rest); };
    }

    const protocol = new ObjectStackProtocolImplementation(engine as any);
    const rest = new RestServer(createMockServer() as any, protocol as any, { api: { requireAuth: false } } as any);
    (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
    rest.registerRoutes();
    const getRoute = rest.getRoutes().find((r: any) => r.method === 'GET' && r.path === '/api/v1/data/:object');
    const postRoute = rest.getRoutes().find((r: any) => r.method === 'POST' && r.path === '/api/v1/data/:object/query');
    expect(getRoute).toBeDefined();
    expect(postRoute).toBeDefined();
    list = async (q) => {
      const res = makeRes();
      await getRoute!.handler({ params: { object: OBJECT }, query: { $orderby: 'label', ...q }, headers: {} } as any, res);
      return { status: res._status ?? 200, body: res._json };
    };
    query = async (body) => {
      const res = makeRes();
      await postRoute!.handler({ params: { object: OBJECT }, body: JSON.parse(JSON.stringify({ orderBy: [{ field: 'label', order: 'asc' }], ...body })), query: {}, headers: {} } as any, res);
      return { status: res._status ?? 200, body: res._json };
    };
  });

  afterEach(() => setLimits({}));

  afterAll(async () => {
    for (const name of ENV_VARS) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
    try { await engine?.destroy(); } catch { /* noop */ }
  });

  const labelsOf = (body: any): string[] => (body?.records ?? []).map((r: any) => r.label);

  it('no limits configured: every read answers exactly as before', async () => {
    const all = await list({});
    expect(all.status, JSON.stringify(all.body)).toBe(200);
    expect(labelsOf(all.body)).toEqual(LABELS);
    expect(all.body.hasMore).toBe(false);

    const big = await query({ limit: 100_000, offset: 1 });
    expect(big.status, JSON.stringify(big.body)).toBe(200);
    expect(labelsOf(big.body)).toEqual(['b', 'c', 'd', 'e']);

    const grouped = await query({ groupBy: ['kind'], aggregations: [{ function: 'count', alias: 'n' }] });
    expect(grouped.status, JSON.stringify(grouped.body)).toBe(200);
    expect(grouped.body.records).toHaveLength(2);
  });

  it('the default page size is the page a read naming no limit gets — and the answer says there is more', async () => {
    setLimits({ OS_DATA_DEFAULT_PAGE_SIZE: '2', OS_DATA_MAX_PAGE_SIZE: '3' });
    const first = await list({});
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(labelsOf(first.body)).toEqual(['a', 'b']);
    expect(first.body.hasMore).toBe(true);
    expect(first.body.total).toBe(5);

    const next = await query({ offset: 4 });
    expect(labelsOf(next.body)).toEqual(['e']);
    expect(next.body.hasMore).toBe(false);

    // A grouped read is a list read too: its groups page the same way.
    const grouped = await query({ groupBy: ['kind'], aggregations: [{ function: 'count', alias: 'n' }] });
    expect(grouped.status, JSON.stringify(grouped.body)).toBe(200);
    expect(grouped.body.records).toHaveLength(2);
  });

  it('a limit within the maximum runs as asked, on both doors', async () => {
    setLimits({ OS_DATA_DEFAULT_PAGE_SIZE: '2', OS_DATA_MAX_PAGE_SIZE: '3' });
    expect(labelsOf((await list({ $top: '3', $skip: '1' })).body)).toEqual(['b', 'c', 'd']);
    expect(labelsOf((await query({ limit: 3 })).body)).toEqual(['a', 'b', 'c']);
  });

  it('a limit over the maximum is a 400 MAX_RECORDS_EXCEEDED naming the spelling and the maximum — no read, no clamp', async () => {
    setLimits({ OS_DATA_MAX_PAGE_SIZE: '3' });
    const before = reads.n;
    for (const [name, run, param] of [
      ['GET $top', () => list({ $top: '4' }), '$top'],
      ['GET top', () => list({ top: '4' }), 'top'],
      ['POST limit', () => query({ limit: 4 }), 'limit'],
      ['POST grouped', () => query({ limit: 4, groupBy: ['kind'], aggregations: [{ function: 'count', alias: 'n' }] }), 'limit'],
    ] as const) {
      const res = await run();
      expect(res.status, `${name}: ${JSON.stringify(res.body)}`).toBe(400);
      expect(res.body.code, name).toBe('MAX_RECORDS_EXCEEDED');
      expect(res.body.error, name).toContain(`Query parameter '${param}' asks for 4 rows`);
      expect(res.body.error, name).toContain('maximum page size is 3');
    }
    expect(reads.n - before, 'every refusal precedes the driver').toBe(0);
  });

  it('offset plus limit over the row budget is a 400 QUERY_ROW_BUDGET_EXCEEDED naming the budget — no read', async () => {
    setLimits({ OS_DATA_QUERY_ROW_BUDGET: '4' });
    const before = reads.n;
    const deep = await list({ $top: '2', $skip: '3' });
    expect(deep.status, JSON.stringify(deep.body)).toBe(400);
    expect(deep.body.code).toBe('QUERY_ROW_BUDGET_EXCEEDED');
    expect(deep.body.error).toContain('query row budget of 4');
    expect(reads.n - before, 'refused before the driver').toBe(0);

    const within = await query({ limit: 2, offset: 2 });
    expect(within.status, JSON.stringify(within.body)).toBe(200);
    expect(labelsOf(within.body)).toEqual(['c', 'd']);
  });

  it('a row budget with no page size refuses an unpaged read that would return more — and serves one that fits whole', async () => {
    setLimits({ OS_DATA_QUERY_ROW_BUDGET: '4' });
    const over = await list({});
    expect(over.status, JSON.stringify(over.body)).toBe(400);
    expect(over.body.code).toBe('QUERY_ROW_BUDGET_EXCEEDED');

    setLimits({ OS_DATA_QUERY_ROW_BUDGET: '5' });
    const fits = await list({});
    expect(fits.status, JSON.stringify(fits.body)).toBe(200);
    expect(labelsOf(fits.body)).toEqual(LABELS);
    // The probe limit is the server's: the answer is the whole set, not a page.
    expect(fits.body.hasMore).toBe(false);
    expect(fits.body.total).toBe(5);
  });
});
