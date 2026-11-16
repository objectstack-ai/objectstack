// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A cross-object dimension (`opportunity.stage` on `line`) on the ObjectQL
 * face is served by ONE statement on a SQL driver — the engine's relation
 * group join, `LEFT JOIN … GROUP BY` (objectql `relation-group-join.ts`) —
 * and answers exactly what the FK-expand answered (`resolveFkAttr`: the base
 * aggregate grouped by the FK, an `id IN (every FK)` read of the related
 * object, re-bucketed here), without that read's id list.
 *
 * The composition is the plugin's, over a real `ObjectQL` and a real
 * `SqliteWasmDriver`, under a walled tenancy posture. The FK-expand reference
 * is the SAME composition with the engine's `aggregate` reached through a
 * door that drops its read options: the engine never sees the request, the
 * strategy is told the join was not served, and serves the dimension the way
 * it did before the join existed.
 *
 * - parity: identical buckets and measures for an admin, for a member whose
 *   read scope hides parents (a policy scope through `getReadScope` AND a
 *   read middleware on the related object), for another tenant, with null,
 *   orphaned and cross-tenant FKs, several dimensions through one relation,
 *   and the FK column beside its own attribute;
 * - the read scope and the tenant wall hold on the joined parent: a hidden
 *   parent never contributes its attribute, another tenant's parent never
 *   joins;
 * - the bind limit: 33,000 distinct FKs answered `DATABASE_ERROR` / 500 on the
 *   FK-expand (`too many SQL variables`) and answer 200 joined.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import type { AnalyticsQuery } from '@objectstack/spec/contracts';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { DatasetSchema } from '@objectstack/spec/ui';

import { AnalyticsService } from '../analytics-service.js';
import { AnalyticsServicePlugin } from '../plugin.js';

const LINE = 'zz_rgj_line';
const OPP = 'zz_rgj_opp';
const RELATION_GROUP_BY = Symbol.for('objectstack.objectql.relationGroupBy');

const OPP_FIELDS: Record<string, Record<string, unknown>> = {
  name: { type: 'text', name: 'name' },
  stage: { type: 'text', name: 'stage' },
  owner: { type: 'text', name: 'owner' },
};
const LINE_FIELDS: Record<string, Record<string, unknown>> = {
  region: { type: 'text', name: 'region' },
  amount: { type: 'number', name: 'amount' },
  opportunity: { type: 'lookup', name: 'opportunity', reference: OPP },
};

const dataset = DatasetSchema.parse({
  name: 'rgj_lines',
  label: 'Lines by opportunity',
  object: LINE,
  include: ['opportunity'],
  dimensions: [
    { name: 'stage', field: 'opportunity.stage', type: 'string' },
    { name: 'opp_name', field: 'opportunity.name', type: 'string' },
    { name: 'region', field: 'region', type: 'string' },
    { name: 'opportunity', field: 'opportunity', type: 'string' },
  ],
  measures: [
    { name: 'line_count', aggregate: 'count' },
    { name: 'amount_sum', aggregate: 'sum', field: 'amount' },
    { name: 'amount_min', aggregate: 'min', field: 'amount' },
    { name: 'amount_max', aggregate: 'max', field: 'amount' },
  ],
});

const ADMIN_A = { userId: 'u_admin', tenantId: 'org_A' } as ExecutionContext;
const MEMBER_A = { userId: 'u_member', tenantId: 'org_A' } as ExecutionContext;
const ADMIN_B = { userId: 'u_admin', tenantId: 'org_B' } as ExecutionContext;

const OPPS = [
  { id: 'o1', name: 'One', stage: 'won', owner: 'u_member', organization_id: 'org_A' },
  { id: 'o2', name: 'Two', stage: 'lost', owner: 'u_member', organization_id: 'org_A' },
  { id: 'o3', name: 'Three', stage: 'open', owner: 'u_other', organization_id: 'org_A' },
  { id: 'o4', name: 'Four', stage: 'won', owner: 'u_other', organization_id: 'org_A' },
  { id: 'b1', name: 'Bee', stage: 'won', owner: 'u_member', organization_id: 'org_B' },
];
const LINES = [
  { id: 'l1', opportunity: 'o1', region: 'emea', amount: 10, organization_id: 'org_A' },
  { id: 'l2', opportunity: 'o1', region: 'apac', amount: 20, organization_id: 'org_A' },
  { id: 'l3', opportunity: 'o2', region: 'emea', amount: 5, organization_id: 'org_A' },
  { id: 'l4', opportunity: 'o3', region: 'emea', amount: 7, organization_id: 'org_A' },
  { id: 'l5', opportunity: 'o4', region: 'apac', amount: 3, organization_id: 'org_A' },
  { id: 'l6', opportunity: null, region: 'emea', amount: 11, organization_id: 'org_A' },
  // A FK naming no record at all, and one naming ANOTHER tenant's record.
  { id: 'l7', opportunity: 'o_missing', region: 'apac', amount: 13, organization_id: 'org_A' },
  { id: 'l8', opportunity: 'b1', region: 'emea', amount: 17, organization_id: 'org_A' },
  { id: 'l9', opportunity: 'o3', region: 'amer', amount: 2, organization_id: 'org_A' },
  { id: 'lb1', opportunity: 'b1', region: 'emea', amount: 100, organization_id: 'org_B' },
  { id: 'lb2', opportunity: 'o1', region: 'apac', amount: 50, organization_id: 'org_B' },
];

const quiet = { debug() {}, info() {}, warn() {}, error() {}, child() { return quiet; } };

function pluginContext(services: Record<string, unknown>) {
  const registered: Record<string, unknown> = {};
  return {
    registered,
    ctx: {
      getService: (name: string) => services[name] ?? registered[name],
      registerService: (name: string, svc: unknown) => { registered[name] = svc; },
      replaceService: (name: string, svc: unknown) => { registered[name] = svc; },
      logger: quiet,
    },
  };
}

/** The member's policy scope of the related object: only the opportunities they own. */
const getReadScope = (object: string, context?: ExecutionContext) =>
  (object === OPP && context?.userId === 'u_member' ? { owner: 'u_member' } : undefined) as never;

/**
 * The plugin's own composition over `engine`. `joined: false` reaches the
 * engine through a door that drops `aggregate`'s read options — the
 * FK-expand reference. `outcomes` records what the engine did with each
 * relation group request it was handed.
 */
async function pluginService(engine: ObjectQL, joined: boolean, outcomes: unknown[] = []): Promise<AnalyticsService> {
  const data = new Proxy(engine, {
    get(target, prop) {
      if (prop === 'aggregate') {
        return async (object: string, query: unknown, options?: Record<symbol, unknown>) => {
          if (!joined) return target.aggregate(object, query as never);
          const rows = await target.aggregate(object, query as never, options as never);
          const request = options?.[RELATION_GROUP_BY] as { outcome?: unknown } | undefined;
          if (request) outcomes.push(request.outcome);
          return rows;
        };
      }
      const value = (target as unknown as Record<PropertyKey, unknown>)[prop];
      return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
  });
  const { ctx, registered } = pluginContext({ data });
  await new AnalyticsServicePlugin({
    queryCapabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }),
    getReadScope,
  }).init(ctx as never);
  const service = registered.analytics as AnalyticsService;
  service.registerDataset(dataset);
  return service;
}

/** Rows order-free: each row's dimension values joined into one sort key. */
function sorted(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return [...rows].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

const OLD_POSTURE = process.env.OS_TENANCY_POSTURE;

async function bootEngine(): Promise<{ engine: ObjectQL; driver: SqliteWasmDriver }> {
  const driver = new SqliteWasmDriver({ filename: ':memory:' });
  (driver as unknown as { logger: unknown }).logger = quiet;
  const engine = new ObjectQL({ logger: quiet });
  engine.registerDriver(driver as never, true);
  await engine.init();
  engine.registerObject({ name: OPP, label: 'Opportunity', fields: OPP_FIELDS } as never);
  engine.registerObject({ name: LINE, label: 'Line', fields: LINE_FIELDS } as never);
  await engine.syncSchemas();
  return { engine, driver };
}

describe('a cross-object dimension on a SQL driver is ONE joined statement, with the FK-expand\'s buckets', () => {
  let driver: SqliteWasmDriver;
  let engine: ObjectQL;
  let joined: AnalyticsService;
  let expanded: AnalyticsService;
  const outcomes: unknown[] = [];

  beforeAll(async () => {
    process.env.OS_TENANCY_POSTURE = 'isolated';
    ({ engine, driver } = await bootEngine());
    for (const row of OPPS) await driver.create(OPP, { ...row }, { bypassTenantAudit: true } as never);
    for (const row of LINES) await driver.create(LINE, { ...row }, { bypassTenantAudit: true } as never);
    // A read middleware on the related object, as row-level security injects
    // one: it hides `o2` from the member. It runs on the joined path's PLANNED
    // read of the related object and on the FK-expand's id read alike.
    engine.registerMiddleware(async (op: any, next: () => Promise<void>) => {
      if (op.object === OPP && op.context?.userId === 'u_member') {
        op.ast.where = op.ast.where ? { $and: [op.ast.where, { id: { $ne: 'o2' } }] } : { id: { $ne: 'o2' } };
      }
      await next();
    });
    joined = await pluginService(engine, true, outcomes);
    expanded = await pluginService(engine, false);
  });

  afterAll(async () => {
    await driver?.disconnect?.();
    if (OLD_POSTURE === undefined) delete process.env.OS_TENANCY_POSTURE;
    else process.env.OS_TENANCY_POSTURE = OLD_POSTURE;
  });

  it('the fixture is tenant-walled: the driver resolves the tenant column of both objects', () => {
    expect((driver as unknown as { resolveTenantField(o: string): string | null }).resolveTenantField(OPP)).toBe('organization_id');
    expect((driver as unknown as { resolveTenantField(o: string): string | null }).resolveTenantField(LINE)).toBe('organization_id');
  });

  const MEASURES = ['line_count', 'amount_sum', 'amount_min', 'amount_max'];
  const SHAPES: ReadonlyArray<readonly string[]> = [
    ['stage'],
    ['region', 'stage'],
    ['stage', 'opp_name'],
    ['opportunity', 'stage'],
  ];
  const CALLERS: ReadonlyArray<readonly [string, ExecutionContext]> = [
    ['admin of org_A', ADMIN_A],
    ['member of org_A (policy scope + read middleware hide parents)', MEMBER_A],
    ['admin of org_B', ADMIN_B],
  ];

  for (const [who, context] of CALLERS) {
    for (const dims of SHAPES) {
      it(`parity — ${who}, dimensions [${dims.join(', ')}]: joined, and identical to the FK-expand`, async () => {
        const query = { cube: dataset.name, dimensions: [...dims], measures: MEASURES } as AnalyticsQuery;
        outcomes.length = 0;
        const viaJoin = await joined.query(query, context);
        expect(outcomes, 'the engine joined the request').toEqual([{ kind: 'joined' }]);
        const viaExpand = await expanded.query(query, context);
        expect(sorted(viaJoin.rows)).toEqual(sorted(viaExpand.rows));
        expect(viaJoin.rows.length).toBeGreaterThan(0);
      });
    }
  }

  const byStage = (rows: Record<string, unknown>[]) =>
    Object.fromEntries(rows.map((r) => [String(r.stage), [Number(r.line_count), Number(r.amount_sum)]]));

  it('the buckets themselves (admin of org_A): a null, an orphaned and a cross-tenant FK are (restricted); every line counted once', async () => {
    const { rows } = await joined.query({ cube: dataset.name, dimensions: ['stage'], measures: MEASURES } as AnalyticsQuery, ADMIN_A);
    expect(byStage(rows)).toEqual({
      won: [3, 33],
      lost: [1, 5],
      open: [2, 9],
      // l6 (null FK), l7 (no such record), l8 (org_B's record): 11 + 13 + 17.
      '(restricted)': [3, 41],
    });
  });

  it('the read scope holds on the joined parent: the member sees only o1\'s stage — o2 (hidden by the middleware) and o3/o4 (outside the policy scope) are (restricted)', async () => {
    const { rows } = await joined.query({ cube: dataset.name, dimensions: ['stage'], measures: MEASURES } as AnalyticsQuery, MEMBER_A);
    expect(byStage(rows)).toEqual({ won: [2, 30], '(restricted)': [7, 58] });
    // The hidden parents' attributes never appear.
    const named = await joined.query({ cube: dataset.name, dimensions: ['opp_name'], measures: ['line_count'] } as AnalyticsQuery, MEMBER_A);
    expect(named.rows.map((r) => r.opp_name).sort()).toEqual(['(restricted)', 'One']);
  });

  it('the tenant wall holds on the joined parent: org_B\'s line pointing at org_A\'s o1 never joins it', async () => {
    const { rows } = await joined.query({ cube: dataset.name, dimensions: ['stage'], measures: MEASURES } as AnalyticsQuery, ADMIN_B);
    expect(byStage(rows)).toEqual({ won: [1, 100], '(restricted)': [1, 50] });
  });
});

describe('the bind limit: a lookup dimension over more distinct FKs than the dialect binds', () => {
  const N = 33_000;
  let driver: SqliteWasmDriver;
  let engine: ObjectQL;

  beforeAll(async () => {
    process.env.OS_TENANCY_POSTURE = 'isolated';
    ({ engine, driver } = await bootEngine());
    const STAGES = ['won', 'lost', 'open'];
    const knex = (driver as unknown as { knex: { batchInsert(t: string, rows: unknown[], n: number): Promise<unknown> } }).knex;
    const opps = Array.from({ length: N }, (_, i) => ({ id: `o${i}`, name: `O${i}`, stage: STAGES[i % 3], owner: 'u_other', organization_id: 'org_A' }));
    const lines = Array.from({ length: N }, (_, i) => ({ id: `l${i}`, opportunity: `o${i}`, region: 'emea', amount: 1, organization_id: 'org_A' }));
    await knex.batchInsert(OPP, opps, 400);
    await knex.batchInsert(LINE, lines, 400);
  }, 60_000);

  afterAll(async () => {
    await driver?.disconnect?.();
    if (OLD_POSTURE === undefined) delete process.env.OS_TENANCY_POSTURE;
    else process.env.OS_TENANCY_POSTURE = OLD_POSTURE;
  });

  const QUERY = { cube: dataset.name, dimensions: ['stage'], measures: ['line_count'] } as AnalyticsQuery;

  it(`${N} distinct FKs: the FK-expand's id read is refused by the database (DATABASE_ERROR / 500)`, async () => {
    const expanded = await pluginService(engine, false);
    const err = await expanded.query(QUERY, ADMIN_A).then(() => null, (e: Error & { code?: string; status?: number }) => e);
    expect({ code: err?.code, status: err?.status }).toEqual({ code: 'DATABASE_ERROR', status: 500 });
  });

  it(`${N} distinct FKs: joined, one statement, every line in its stage`, async () => {
    const outcomes: unknown[] = [];
    const service = await pluginService(engine, true, outcomes);
    const { rows } = await service.query(QUERY, ADMIN_A);
    expect(outcomes).toEqual([{ kind: 'joined' }]);
    expect(Object.fromEntries(rows.map((r) => [String(r.stage), Number(r.line_count)]))).toEqual({
      won: N / 3, lost: N / 3, open: N / 3,
    });
  });
});
