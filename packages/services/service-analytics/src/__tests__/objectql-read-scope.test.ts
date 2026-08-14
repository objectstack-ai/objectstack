// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0021 D-C on the ObjectQL path (#3597).
 *
 * `dataset-rls-integration.test.ts` proves tenant scoping end-to-end, but every
 * case there pins `objectqlAggregate: false` — so it only ever exercises
 * NativeSQLStrategy. That blind spot is exactly why ObjectQLStrategy shipped
 * without consuming `getReadScope` at all: an authenticated caller received
 * aggregates computed over every tenant's rows.
 *
 * These cases run the same pipeline with the ObjectQL aggregate path selected —
 * which is what the runtime picks whenever NativeSQL declines (date-granularity
 * bucketing, `RAW_SQL_UNSUPPORTED`, federated objects).
 */

import { describe, it, expect } from 'vitest';
import { DatasetSchema } from '@objectstack/spec/ui';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import type { FilterCondition } from '@objectstack/spec/data';
import { AnalyticsService } from '../analytics-service.js';
import { compileDataset } from '../dataset-compiler.js';

const dataset = DatasetSchema.parse({
  name: 'sales',
  label: 'Sales',
  object: 'opportunity',
  dimensions: [{ name: 'region', field: 'region', type: 'string' }],
  measures: [{ name: 'revenue', aggregate: 'sum', field: 'amount' }],
});

/** Two tenants' rows in one physical table. */
const TABLE = [
  { id: 1, organization_id: 'org_A', region: 'West', amount: 100 },
  { id: 2, organization_id: 'org_B', region: 'East', amount: 900 },
];

/** The production-shaped provider: tenant predicate derived from the request. */
const readScope = (_o: string, context?: ExecutionContext): FilterCondition | undefined =>
  context?.tenantId ? { organization_id: context.tenantId } : undefined;

type AggOpts = {
  groupBy?: string[];
  aggregations?: Array<{ field: string; method: string; alias: string }>;
  filter?: Record<string, unknown>;
};

/** Match a row against the subset of FilterCondition these tests emit. */
function matches(row: Record<string, unknown>, filter: Record<string, unknown>): boolean {
  return Object.entries(filter).every(([k, v]) => {
    if (k === '$and') return (v as Record<string, unknown>[]).every((sub) => matches(row, sub));
    if (k.startsWith('$')) throw new Error(`test bridge: unhandled operator ${k}`);
    return row[k] === v;
  });
}

/**
 * An HONEST aggregate bridge: it applies whatever `filter` it is handed. So a
 * missing tenant predicate produces a real cross-tenant leak rather than an
 * artifact of a permissive stub.
 */
function makeAggregate(seen: AggOpts[]) {
  return async (_objectName: string, opts: AggOpts) => {
    seen.push(opts);
    const rows = TABLE.filter((r) => matches(r as Record<string, unknown>, opts.filter ?? {}));
    const buckets = new Map<string, Record<string, unknown>>();
    for (const r of rows) {
      const row = r as Record<string, unknown>;
      const key = (opts.groupBy ?? []).map((g) => String(row[g as string])).join('|');
      const b = buckets.get(key)
        ?? Object.fromEntries((opts.groupBy ?? []).map((g) => [g, row[g as string]]));
      for (const a of opts.aggregations ?? []) {
        if (a.method === 'sum') b[a.alias] = Number(b[a.alias] ?? 0) + Number(row[a.field] ?? 0);
      }
      buckets.set(key, b);
    }
    return [...buckets.values()];
  };
}

const ctxA = { tenantId: 'org_A', userId: 'u_a' } as ExecutionContext;

/** ObjectQL-only capabilities — NativeSQL unavailable. */
const objectqlOnly = () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false });

function makeService(seen: AggOpts[], overrides: Record<string, unknown> = {}) {
  const compiled = compileDataset(dataset);
  return new AnalyticsService({
    cubes: [compiled.cube],
    queryCapabilities: objectqlOnly,
    executeAggregate: makeAggregate(seen),
    getReadScope: readScope,
    ...overrides,
  });
}

describe('ObjectQLStrategy — read scope (ADR-0021 D-C, #3597)', () => {
  it('scopes a plain aggregate query to the caller tenant', async () => {
    const seen: AggOpts[] = [];
    const result = await makeService(seen).query(
      { cube: 'sales', dimensions: ['region'], measures: ['revenue'] },
      ctxA,
    );

    expect(seen[0].filter).toEqual({ organization_id: 'org_A' });
    expect(result.rows).toEqual([{ region: 'West', revenue: 100 }]);
  });

  it('scopes when NativeSQL declines at runtime (RAW_SQL_UNSUPPORTED fallback)', async () => {
    const seen: AggOpts[] = [];
    const service = makeService(seen, {
      // Both advertised — exactly what the plugin auto-bridge produces.
      queryCapabilities: () => ({ nativeSql: true, objectqlAggregate: true, inMemory: false }),
      executeRawSql: async () => {
        const err = new Error('driver cannot run SQL') as Error & { code: string };
        err.code = 'RAW_SQL_UNSUPPORTED';
        throw err;
      },
    });

    const result = await service.query(
      { cube: 'sales', dimensions: ['region'], measures: ['revenue'] },
      ctxA,
    );

    expect(seen[0].filter).toEqual({ organization_id: 'org_A' });
    expect(result.rows).toEqual([{ region: 'West', revenue: 100 }]);
  });

  it('scopes a date-bucketed query (NativeSQL declines on granularity, even on SQL drivers)', async () => {
    const compiled = compileDataset(
      DatasetSchema.parse({
        name: 'sales_t',
        label: 'Sales',
        object: 'opportunity',
        dimensions: [{ name: 'created', field: 'created_at', type: 'date' }],
        measures: [{ name: 'revenue', aggregate: 'sum', field: 'amount' }],
      }),
    );
    const seen: AggOpts[] = [];
    const service = new AnalyticsService({
      cubes: [compiled.cube],
      queryCapabilities: () => ({ nativeSql: true, objectqlAggregate: true, inMemory: false }),
      executeRawSql: async () => { throw new Error('NativeSQL must decline on granularity'); },
      executeAggregate: makeAggregate(seen),
      getReadScope: readScope,
    });

    await service.query(
      {
        cube: 'sales_t',
        measures: ['revenue'],
        timeDimensions: [{ dimension: 'created', granularity: 'month' }],
      },
      ctxA,
    );

    expect(seen[0].filter).toEqual({ organization_id: 'org_A' });
  });

  it('ANDs the scope with the query filter instead of key-merging it', async () => {
    const seen: AggOpts[] = [];
    await makeService(seen).query(
      {
        cube: 'sales',
        dimensions: ['region'],
        measures: ['revenue'],
        where: { region: 'West' },
      },
      ctxA,
    );

    expect(seen[0].filter).toEqual({
      $and: [{ region: 'West' }, { organization_id: 'org_A' }],
    });
  });

  it('a caller filter on the SAME field cannot displace the security predicate', async () => {
    const seen: AggOpts[] = [];
    // The caller tries to widen their scope by naming the tenant column itself.
    const result = await makeService(seen).query(
      {
        cube: 'sales',
        dimensions: ['region'],
        measures: ['revenue'],
        where: { organization_id: 'org_B' },
      },
      ctxA,
    );

    // Both predicates survive — and being contradictory, they yield nothing.
    expect(seen[0].filter).toEqual({
      $and: [{ organization_id: 'org_B' }, { organization_id: 'org_A' }],
    });
    expect(result.rows).toEqual([]);
  });

  it('two tenants stay isolated on one service instance (singleton-safe)', async () => {
    const seen: AggOpts[] = [];
    const service = makeService(seen);
    const q = { cube: 'sales', dimensions: ['region'], measures: ['revenue'] };

    const a = await service.query(q, ctxA);
    const b = await service.query(q, { tenantId: 'org_B', userId: 'u_b' } as ExecutionContext);

    expect(a.rows).toEqual([{ region: 'West', revenue: 100 }]);
    expect(b.rows).toEqual([{ region: 'East', revenue: 900 }]);
  });

  it('runs unscoped when no provider is configured (documented contract, unchanged)', async () => {
    const seen: AggOpts[] = [];
    const result = await makeService(seen, { getReadScope: undefined }).query(
      { cube: 'sales', dimensions: ['region'], measures: ['revenue'] },
      ctxA,
    );

    expect(seen[0].filter).toBeUndefined();
    expect(result.rows).toHaveLength(2);
  });
});

describe('ObjectQLStrategy — OUT-OF-ENVELOPE cross-object is fail-closed (#3654)', () => {
  // In-envelope cross-object DIMENSIONS are now served by FK-expand
  // (objectql-crossobj-expand.test.ts). What the engine still cannot serve —
  // cross-object in a MEASURE or FILTER, multi-hop, or a non-recombinable
  // measure — must fail LOUD rather than silently mis-bucket (the #3654 class).
  let reached = false;
  function svcFor(ds: unknown) {
    const compiled = compileDataset(DatasetSchema.parse(ds));
    reached = false;
    return new AnalyticsService({
      cubes: [compiled.cube],
      queryCapabilities: objectqlOnly,
      // Would "succeed" with garbage if the guard failed to fire — so a passing
      // rejection test proves the guard, not luck.
      executeAggregate: async () => { reached = true; return [{ x: null, revenue: 999 }]; },
      getReadScope: (o: string) => ({ organization_id: 'org_A', _o: o }),
      getAllowedRelationships: () => compiled.allowedRelationships,
    });
  }

  it('rejects a cross-object MEASURE (needs a real join to evaluate)', async () => {
    const svc = svcFor({
      name: 'xobj_measure', label: 'X-obj measure', object: 'opportunity', include: ['account'],
      dimensions: [{ name: 'stage', field: 'stage', type: 'string' }],
      measures: [{ name: 'acct_rev', aggregate: 'sum', field: 'account.annual_revenue' }],
    });
    await expect(
      svc.query({ cube: 'xobj_measure', dimensions: ['stage'], measures: ['acct_rev'] }, ctxA),
    ).rejects.toThrow(/cannot evaluate a cross-object measure .*"account\.annual_revenue"/);
    expect(reached).toBe(false);
  });

  it('rejects a cross-object FILTER', async () => {
    const svc = svcFor({
      name: 'xobj_filter', label: 'X-obj filter', object: 'opportunity', include: ['account'],
      dimensions: [{ name: 'stage', field: 'stage', type: 'string' }],
      measures: [{ name: 'revenue', aggregate: 'sum', field: 'amount' }],
    });
    await expect(
      svc.query(
        { cube: 'xobj_filter', dimensions: ['stage'], measures: ['revenue'], where: { 'account.region': 'West' } },
        ctxA,
      ),
    ).rejects.toThrow(/cannot evaluate a cross-object filter/);
    expect(reached).toBe(false);
  });

  it('rejects a non-recombinable measure (avg) with a cross-object dimension', async () => {
    const svc = svcFor({
      name: 'xobj_avg', label: 'X-obj avg', object: 'opportunity', include: ['account'],
      dimensions: [{ name: 'region', field: 'account.region', type: 'string' }],
      measures: [{ name: 'avg_amt', aggregate: 'avg', field: 'amount' }],
    });
    await expect(
      svc.query({ cube: 'xobj_avg', dimensions: ['region'], measures: ['avg_amt'] }, ctxA),
    ).rejects.toThrow(/cannot group by a cross-object dimension with a "avg" measure/);
    expect(reached).toBe(false);
  });
});
