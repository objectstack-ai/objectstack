// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#33698] A per-measure `filter` pushed down to driver-sql as a conditional
 * aggregate answers the SAME numbers as the in-memory path it replaces — under
 * the REAL security layer (`SecurityPlugin` on a real `ObjectQL` over a real
 * `SqlDriver`), through `POST /api/v1/data/:object/query`.
 *
 * Two engines over identical data, identically secured: one on `SqlDriver`
 * (`supports.aggregationFilter: true`, so `engine.aggregate` sends the
 * filtered measures to `driver.aggregate`), one on a `SqlDriver` that reports
 * the bit off (so the engine reads the rows with `find()` and aggregates them
 * in memory — the path every driver without the bit keeps). Each query is
 * asked of both, as the same member, and must answer the same rows and numbers.
 *
 * The rows the security layer withholds are the ones a measure filter could
 * leak through if it were evaluated outside the statement's scope, so each is
 * a row the filter WOULD match:
 *
 * - **another organization's row** (the tenant wall, `isolated` posture),
 *   written below the engine, `stage: 'won'` with a large amount;
 * - **a row outside the member's read scope** (row-level security
 *   `region != 'HIDDEN'`), `stage: 'won'` with a large amount.
 *
 * Neither reaches a number on either path: the wall and the scope are the
 * statement's `where`, and the pushed-down measure filter only narrows inside
 * it. A field the member cannot read is refused in a measure filter on both
 * paths alike (`403 PERMISSION_DENIED`).
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PermissionSetSchema } from '@objectstack/spec/security';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SecurityPlugin } from '@objectstack/plugin-security';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { RestServer } from './rest-server';
import { DEFAULT_ORGANIZATION_ID, installDefaultOrganization } from './default-organization.testkit.js';

const OBJECT = 'rest_measure_pushdown_ledger';

const SYS_CTX = { isSystem: true, userId: 'usr_system', tenantId: DEFAULT_ORGANIZATION_ID };

const MEMBER_SET = PermissionSetSchema.parse({
  name: 'member_default',
  label: 'Member',
  objects: { '*': { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true } },
  fields: { [`${OBJECT}.secret`]: { readable: false, editable: false } },
  rowLevelSecurity: [{ name: 'ledger_scope', object: OBJECT, operation: 'all', using: "record.region != 'HIDDEN'" }],
});

const MEMBER_CTX = {
  userId: 'usr_member', positions: [], permissions: [MEMBER_SET.name], posture: 'MEMBER', tenantId: DEFAULT_ORGANIZATION_ID,
};

const ROWS = [
  { id: 'd1', region: 'NA', stage: 'won', amount: 10, secret: 's1' },
  { id: 'd2', region: 'NA', stage: 'won', amount: 20, secret: 's2' },
  { id: 'd3', region: 'NA', stage: 'open', amount: null, secret: 's3' },
  { id: 'd4', region: 'EU', stage: 'open', amount: 40, secret: 's4' },
  // Outside the member's read scope, and matched by every `won` measure.
  { id: 'd5', region: 'HIDDEN', stage: 'won', amount: 1000, secret: 's5' },
];
/** Another organization's row, written below the engine; matched by every `won` measure. */
const OTHER_TENANT_ROW = { id: 'd6', region: 'NA', stage: 'won', amount: 50000, secret: 's6', organization_id: 'org_other' };

/** The same driver with the bit reported off: the engine's in-memory path. */
class InMemoryMeasureSqlDriver extends SqlDriver {
  override get supports() {
    return { ...super.supports, aggregationFilter: false };
  }
}

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

interface Face {
  engine: ObjectQL;
  calls: { aggregate: number; find: number };
  query: (body: Record<string, unknown>) => Promise<{ status: number; body: any }>;
}

async function boot(driver: SqlDriver): Promise<Face> {
  const engine = new ObjectQL();
  engine.registerDriver(driver, true);
  await engine.init();
  engine.registerApp({
    id: 'com.objectstack.qa.measure-filter-pushdown-33698',
    name: 'Measure filter pushdown',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: [
      {
        name: OBJECT,
        label: 'Ledger',
        sharingModel: 'public_read_write',
        fields: {
          region: { name: 'region', type: 'text' },
          stage: { name: 'stage', type: 'text' },
          amount: { name: 'amount', type: 'number' },
          secret: { name: 'secret', type: 'text' },
        },
      },
    ],
  } as never);
  await engine.syncSchemas();
  await installDefaultOrganization(engine);

  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: engine,
    // The `isolated` posture: the Layer 0 organization wall is on, and the
    // plugin hands the engine the same posture for the driver's tenant scope.
    tenancy: { posture: 'isolated' },
    metadata: {
      get: async (type: string, name: string) =>
        (type === 'permission' ? [MEMBER_SET].find((s: any) => s?.name === name) : engine.getSchema(name)) ?? null,
      list: async () => [MEMBER_SET],
    },
  };
  const ctx = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    registerService: (name: string, svc: unknown) => { services[name] = svc; },
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
  };
  const plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
  await plugin.init(ctx as never);
  await plugin.start(ctx as never);
  (engine as unknown as Record<symbol, unknown>)[Symbol.for('objectstack.objectql.securityServiceSource')] = () => services.security;
  vi.spyOn((engine as unknown as { logger: { warn: () => void } }).logger, 'warn').mockImplementation(() => undefined);

  await engine.insert(OBJECT, ROWS.map((r) => ({ ...r })), { context: SYS_CTX } as never);
  await engine.getDriverForObject(OBJECT)!.create(OBJECT, { ...OTHER_TENANT_ROW });

  const calls = { aggregate: 0, find: 0 };
  const d = driver as any;
  const find = d.find.bind(d);
  const aggregate = d.aggregate.bind(d);
  d.find = (o: string, ...rest: unknown[]) => { if (o === OBJECT) calls.find += 1; return find(o, ...rest); };
  d.aggregate = (o: string, ...rest: unknown[]) => { if (o === OBJECT) calls.aggregate += 1; return aggregate(o, ...rest); };

  const protocol = new ObjectStackProtocolImplementation(engine as any);
  const rest = new RestServer(createMockServer() as any, protocol as any, { api: { requireAuth: false } } as any);
  (rest as any).resolveExecCtx = async () => MEMBER_CTX;
  rest.registerRoutes();
  const route = rest.getRoutes().find((r: any) => r.method === 'POST' && r.path === '/api/v1/data/:object/query');
  expect(route).toBeDefined();
  const query = async (body: Record<string, unknown>) => {
    const res = makeRes();
    await route!.handler({ params: { object: OBJECT }, body: JSON.parse(JSON.stringify(body)), query: {}, headers: {} } as any, res);
    return { status: res._status ?? 200, body: res._json };
  };
  return { engine, calls, query };
}

const rowsOf = (body: any): Array<Record<string, unknown>> =>
  (Array.isArray(body) ? body : body?.records ?? []) as Array<Record<string, unknown>>;
const byRegion = (body: any) =>
  Object.fromEntries(rowsOf(body).map((r) => [String(r.region), Object.fromEntries(Object.entries(r).filter(([k]) => k !== 'region'))]));

const SQLITE = { client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true } as const;

describe('[#33698] a pushed-down measure filter answers the in-memory path\'s numbers, under the real security layer', () => {
  let pushed: Face;
  let inMemory: Face;

  beforeAll(async () => {
    pushed = await boot(new SqlDriver({ ...SQLITE } as any));
    inMemory = await boot(new InMemoryMeasureSqlDriver({ ...SQLITE } as any));
  });

  afterAll(async () => {
    for (const face of [pushed, inMemory]) {
      try { await face?.engine.destroy(); } catch { /* noop */ }
    }
  });

  /** Ask both faces; assert the path each took; return the pushed face's body after asserting the two agree. */
  async function both(body: Record<string, unknown>) {
    const before = { pushed: { ...pushed.calls }, inMemory: { ...inMemory.calls } };
    const a = await pushed.query(body);
    const b = await inMemory.query(body);
    expect(a.status, JSON.stringify(a.body)).toBe(200);
    expect(b.status, JSON.stringify(b.body)).toBe(200);
    // The pushed face aggregated in the driver; the other read rows.
    expect(pushed.calls.aggregate - before.pushed.aggregate, 'pushed: driver.aggregate').toBe(1);
    expect(pushed.calls.find - before.pushed.find, 'pushed: no row read').toBe(0);
    expect(inMemory.calls.aggregate - before.inMemory.aggregate, 'in-memory: no driver.aggregate').toBe(0);
    expect(inMemory.calls.find - before.inMemory.find, 'in-memory: one row read').toBe(1);
    expect(byRegion(a.body)).toEqual(byRegion(b.body));
    return a.body;
  }

  it('grouped: every function, the same rows and numbers — no other-organization row, no out-of-scope row', async () => {
    const body = await both({
      groupBy: ['region'],
      aggregations: [
        { function: 'sum', field: 'amount', alias: 'won_sum', filter: { stage: 'won' } },
        { function: 'count', alias: 'won_n', filter: { stage: 'won' } },
        { function: 'avg', field: 'amount', alias: 'won_avg', filter: { stage: 'won' } },
        { function: 'min', field: 'amount', alias: 'won_min', filter: { stage: 'won' } },
        { function: 'max', field: 'amount', alias: 'won_max', filter: { stage: 'won' } },
        { function: 'count_distinct', field: 'stage', alias: 'big_stages', filter: { amount: { $gte: 15 } } },
        { function: 'count', alias: 'n' },
      ],
    });
    // Hand-written: d1 + d2 in NA; nothing won in EU; no HIDDEN group at all;
    // and neither 1000 (out of scope) nor 50000 (other organization) anywhere.
    expect(byRegion(body)).toEqual({
      NA: { won_sum: 30, won_n: 2, won_avg: 15, won_min: 10, won_max: 20, big_stages: 1, n: 3 },
      EU: { won_sum: 0, won_n: 0, won_avg: null, won_min: null, won_max: null, big_stages: 1, n: 1 },
    });
  });

  it('ungrouped: the filtered total is the member\'s, not the table\'s', async () => {
    const body = await both({
      aggregations: [
        { function: 'sum', field: 'amount', alias: 'won_sum', filter: { stage: 'won' } },
        { function: 'sum', field: 'amount', alias: 'total' },
      ],
    });
    expect(rowsOf(body)).toEqual([{ won_sum: 30, total: 70 }]);
  });

  it('a NULL amount fails an ordering filter on both paths (null is not ordered)', async () => {
    const body = await both({
      groupBy: ['region'],
      aggregations: [{ function: 'count', alias: 'small', filter: { amount: { $lte: 15 } } }],
    });
    // NA: d1 only — d3's NULL amount is not "≤ 15" on either path.
    expect(byRegion(body)).toEqual({ NA: { small: 1 }, EU: { small: 0 } });
  });

  it('a measure filter on a field the member cannot read is refused alike: 403, and no rows', async () => {
    const body = { aggregations: [{ function: 'count', alias: 'n', filter: { secret: 's1' } }] };
    for (const face of [pushed, inMemory]) {
      const before = { ...face.calls };
      const res = await face.query(body);
      expect(res.status, JSON.stringify(res.body)).toBe(403);
      expect(JSON.stringify(res.body)).toContain('PERMISSION_DENIED');
      expect(res.body?.records).toBeUndefined();
      expect(face.calls).toEqual(before);
    }
  });

  it('CONTROL the withheld rows are there: a system read counts them', async () => {
    const all = await pushed.engine.find(OBJECT, { context: { isSystem: true, userId: 'usr_system' } } as never);
    expect((all as any[]).map((r) => r.id).sort()).toEqual(expect.arrayContaining(['d5']));
    const raw = await pushed.engine.getDriverForObject(OBJECT)!.find(OBJECT, { where: { id: 'd6' } } as never);
    expect((raw as any[]).map((r) => r.organization_id)).toEqual(['org_other']);
  });
});
