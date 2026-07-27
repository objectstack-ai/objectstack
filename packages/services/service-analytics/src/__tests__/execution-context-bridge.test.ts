// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0021 D-C — SECOND belt (#3602): the analytics→engine bridge carries the
 * request's `ExecutionContext`.
 *
 * `objectql-read-scope.test.ts` covers the FIRST belt (#3601): the strategy ANDs
 * `getReadScope`'s predicate into the filter it hands the engine. That belt only
 * works if every strategy remembers to call it — #3597 is what happens when one
 * does not, and a third strategy will eventually repeat it.
 *
 * The second belt is independent: hand the engine the caller's context and the
 * engine's own middleware chain (`mergeReadContext` → RLS injection) scopes the
 * read whether or not the analytics layer did. `BaseEngineOptions.context` was
 * always `.optional()`, so nothing ever forced the bridge to pass it — and it
 * did not, which is precisely why plugin-security's principal-less fall-open
 * left BOTH belts off at once in #3597.
 *
 * These cases assert on what reaches the bridge, because that is the seam the
 * engine's RLS hangs off of.
 */

import { describe, it, expect } from 'vitest';
import { DatasetSchema } from '@objectstack/spec/ui';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import type { FilterCondition } from '@objectstack/spec/data';
import { AnalyticsService } from '../analytics-service.js';
import { AnalyticsServicePlugin } from '../plugin.js';
import { compileDataset } from '../dataset-compiler.js';

const dataset = DatasetSchema.parse({
  name: 'sales',
  label: 'Sales',
  object: 'opportunity',
  dimensions: [{ name: 'region', field: 'region', type: 'string' }],
  measures: [{ name: 'revenue', aggregate: 'sum', field: 'amount' }],
});

type AggOpts = {
  groupBy?: string[];
  aggregations?: Array<{ field: string; method: string; alias: string }>;
  filter?: Record<string, unknown>;
  timezone?: string;
  context?: ExecutionContext;
};

const ctxA = { tenantId: 'org_A', userId: 'u_a' } as ExecutionContext;
const ctxB = { tenantId: 'org_B', userId: 'u_b' } as ExecutionContext;

const objectqlOnly = () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false });

const readScope = (_o: string, context?: ExecutionContext): FilterCondition | undefined =>
  context?.tenantId ? { organization_id: context.tenantId } : undefined;

function makeService(seen: AggOpts[], overrides: Record<string, unknown> = {}) {
  const compiled = compileDataset(dataset);
  return new AnalyticsService({
    cubes: [compiled.cube],
    queryCapabilities: objectqlOnly,
    executeAggregate: async (_object: string, opts: AggOpts) => { seen.push(opts); return []; },
    getReadScope: readScope,
    ...overrides,
  });
}

const baseQuery = { cube: 'sales', dimensions: ['region'], measures: ['revenue'] };

describe('executeAggregate bridge carries the ExecutionContext (#3602)', () => {
  it('forwards the caller context to the aggregate bridge', async () => {
    const seen: AggOpts[] = [];
    await makeService(seen).query(baseQuery, ctxA);

    expect(seen[0].context).toBe(ctxA);
  });

  it('forwards the context even when NO read-scope provider is configured', async () => {
    // The depth case. With the analytics-layer belt absent, the engine's own
    // RLS is the ONLY thing standing between this query and every tenant's
    // rows — so the context must reach it. Gating context on `getReadScope`
    // being wired would starve exactly the deployment that needs it most.
    const seen: AggOpts[] = [];
    await makeService(seen, { getReadScope: undefined }).query(baseQuery, ctxA);

    expect(seen[0].context).toBe(ctxA);
    expect(seen[0].filter).toBeUndefined();
  });

  it('gives each caller its own context on a shared service instance', async () => {
    const seen: AggOpts[] = [];
    const service = makeService(seen);

    await service.query(baseQuery, ctxA);
    await service.query(baseQuery, ctxB);

    expect(seen.map((s) => s.context)).toEqual([ctxA, ctxB]);
  });

  it('leaves context undefined when the caller supplied none', async () => {
    // In-memory / dev / system-internal use. Unchanged behaviour: absent is not
    // "unrestricted" — the engine applies its own policy to a context-less op.
    const seen: AggOpts[] = [];
    await makeService(seen).query(baseQuery);

    expect(seen[0].context).toBeUndefined();
  });

  it('carries context on the date-bucketed path (where NativeSQL declines)', async () => {
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
      executeAggregate: async (_o: string, opts: AggOpts) => { seen.push(opts); return []; },
      getReadScope: readScope,
    });

    await service.query(
      { cube: 'sales_t', measures: ['revenue'], timeDimensions: [{ dimension: 'created', granularity: 'month' }] },
      ctxA,
    );

    expect(seen[0].context).toBe(ctxA);
  });
});

// ── The auto-bridge, which is what production actually runs ──────────────────

/** Minimal PluginContext: the four members `AnalyticsServicePlugin.init` uses. */
function fakePluginContext(services: Record<string, unknown>) {
  const registered: Record<string, unknown> = {};
  return {
    ctx: {
      getService: (name: string) => services[name] ?? registered[name],
      registerService: (name: string, svc: unknown) => { registered[name] = svc; },
      replaceService: (name: string, svc: unknown) => { registered[name] = svc; },
      logger: { info() {}, warn() {}, error() {}, debug() {} },
    },
    registered,
  };
}

describe('plugin auto-bridge → engine.aggregate (#3602)', () => {
  it('threads the context into the engine call', async () => {
    const calls: Array<Record<string, unknown>> = [];
    const engine = {
      aggregate: async (_object: string, options: Record<string, unknown>) => {
        calls.push(options);
        return [];
      },
      getObject: () => undefined,
    };
    const { ctx, registered } = fakePluginContext({ data: engine });
    const compiled = compileDataset(dataset);

    await new AnalyticsServicePlugin({
      cubes: [compiled.cube],
      queryCapabilities: objectqlOnly,
      getReadScope: readScope,
    }).init(ctx as never);

    await (registered.analytics as AnalyticsService).query(baseQuery, ctxA);

    // `engine.aggregate` merges this into the operation context, which is what
    // lets the middleware chain inject RLS into `opCtx.ast.where`.
    expect(calls[0].context).toBe(ctxA);
    // First belt still intact — the two are additive, not either/or.
    expect(calls[0].where).toEqual({ organization_id: 'org_A' });
  });
});

// ── Item 2: the record-label lookup rides the same bridge ────────────────────

const labelDataset = DatasetSchema.parse({
  name: 'tasks_by_account',
  label: 'Tasks by account',
  object: 'task',
  dimensions: [{ name: 'account', field: 'account', type: 'string' }],
  measures: [{ name: 'cnt', aggregate: 'count' }],
});

/** What the ENGINE sees — the bridge translates `filter` → `where`. */
type EngineCall = { object: string; where?: Record<string, unknown>; context?: ExecutionContext };

/**
 * Drive the label path through the real plugin wiring and return every call the
 * engine saw. The dimension-label pass runs on `queryDataset`, after the
 * aggregate returns rows carrying FK ids.
 */
async function runLabelLookup(opts: {
  scope: (o: string, c?: ExecutionContext) => FilterCondition | undefined;
  context?: ExecutionContext;
}) {
  const seen: EngineCall[] = [];
  const engine = {
    aggregate: async (object: string, options: Record<string, unknown>) => {
      seen.push({ object, ...options } as EngineCall);
      // The grouped aggregate returns an FK id; the label pass then resolves it.
      return object === 'task' ? [{ account: 'acc1', cnt: 1 }] : [{ id: 'acc1', name: 'Acme Corp', _c: 1 }];
    },
    getObject: (name: string) =>
      name === 'task'
        ? { fields: { account: { type: 'lookup', reference: 'crm_account' } } }
        : name === 'crm_account'
          ? { fields: { name: { type: 'text' } } }
          : undefined,
  };
  const { ctx, registered } = fakePluginContext({ data: engine });

  await new AnalyticsServicePlugin({
    queryCapabilities: objectqlOnly,
    getReadScope: opts.scope,
  }).init(ctx as never);

  const result = await (registered.analytics as AnalyticsService).queryDataset(
    labelDataset as never,
    { dimensions: ['account'], measures: ['cnt'] } as never,
    opts.context,
  );
  return { seen, result };
}

describe('fetchRecordLabels is scoped like any other read (#3602 item 2)', () => {
  it('ANDs the target object read scope into the id lookup', async () => {
    const { seen } = await runLabelLookup({ scope: readScope, context: ctxA });

    // [0] is the dataset aggregate; [1] is the id→label lookup. That second
    // call returns ONE ROW PER RECORD with real display names — row-granular,
    // so it needs the same scoping as any other read.
    expect(seen[1].object).toBe('crm_account');
    expect(seen[1].where).toEqual({
      $and: [{ id: { $in: ['acc1'] } }, { organization_id: 'org_A' }],
    });
  });

  it('forwards the context so the engine scopes it too', async () => {
    const { seen } = await runLabelLookup({ scope: readScope, context: ctxA });

    expect(seen[1].context).toBe(ctxA);
  });

  it('resolves the label when the record is in scope', async () => {
    const { result } = await runLabelLookup({ scope: readScope, context: ctxA });

    expect(result.rows[0].account).toBe('Acme Corp');
  });

  it('leaves the raw id when the scope provider fails — never an unscoped read', async () => {
    // Fail-closed: the throw propagates out of `fetchRecordLabels`, the caller
    // catches it and rows keep their ids. Labels are lost; rows are not exposed.
    // Only the LOOKUP target fails here — the dataset's own query must still
    // run, or this would just be re-testing `resolveReadScopes` (#3601).
    const { seen, result } = await runLabelLookup({
      scope: (o) => {
        if (o === 'crm_account') throw new Error('security service unavailable');
        return { organization_id: 'org_A' };
      },
      context: ctxA,
    });

    expect(seen).toHaveLength(1); // the lookup never reached the engine
    expect(result.rows[0].account).toBe('acc1');
  });
});

// ── Item 3: the /analytics/sql preview must match what executes ──────────────

describe('ObjectQLStrategy.generateSql reflects the executed query (#3602 item 3)', () => {
  it('renders the read scope in the WHERE clause', async () => {
    const { sql, params } = await makeService([]).generateSql(baseQuery, ctxA);

    expect(sql).toContain('WHERE ("opportunity"."organization_id" = $1)');
    expect(params).toEqual(['org_A']);
  });

  it('renders the caller filters alongside the scope', async () => {
    const { sql, params } = await makeService([]).generateSql(
      { ...baseQuery, where: { region: 'West' } },
      ctxA,
    );

    expect(sql).toContain('WHERE region = $1 AND ("opportunity"."organization_id" = $2)');
    expect(params).toEqual(['West', 'org_A']);
  });

  it('emits no WHERE when there is neither a filter nor a scope', async () => {
    const { sql, params } = await makeService([], { getReadScope: undefined }).generateSql(baseQuery, ctxA);

    expect(sql).not.toContain('WHERE');
    expect(params).toEqual([]);
  });

  it('renders the operators the analytics layer emits', async () => {
    const { sql, params } = await makeService([], { getReadScope: undefined }).generateSql(
      { ...baseQuery, where: { region: { $in: ['West', 'East'] }, amount: { $gte: 10 } } },
      ctxA,
    );

    expect(sql).toContain('region IN ($1, $2)');
    expect(sql).toContain('amount >= $3');
    expect(params).toEqual(['West', 'East', 10]);
  });

  it('denies the preview when a joined object carries an unenforceable scope', async () => {
    // The preview must not render SQL for a query `execute()` would reject —
    // that mismatch is the whole defect this item fixes.
    const compiled = compileDataset(
      DatasetSchema.parse({
        name: 'sales_by_account',
        label: 'Sales by account',
        object: 'opportunity',
        include: ['account'],
        dimensions: [{ name: 'region', field: 'account.region', type: 'string' }],
        measures: [{ name: 'revenue', aggregate: 'sum', field: 'amount' }],
      }),
    );
    const service = new AnalyticsService({
      cubes: [compiled.cube],
      queryCapabilities: objectqlOnly,
      executeAggregate: async () => [],
      getReadScope: () => ({ organization_id: 'org_A' }),
      getAllowedRelationships: () => compiled.allowedRelationships,
    });

    await expect(
      service.generateSql({ cube: 'sales_by_account', dimensions: ['region'], measures: ['revenue'] }, ctxA),
    ).rejects.toThrow(/cannot enforce the read scope of joined object\(s\) "account"/);
  });
});
