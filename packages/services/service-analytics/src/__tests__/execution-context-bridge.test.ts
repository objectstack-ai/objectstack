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

// ── #10413 phase 2 / #10576 — the auto-bridge must forward the field, not
//    just build it ────────────────────────────────────────────────────────

/**
 * `ObjectQLStrategy.execute` lowering a measure filter onto its own
 * `aggregations[].filter` entry is necessary but not sufficient: that array
 * still has to survive the auto-bridge in `plugin.ts`, which RECONSTRUCTS
 * each aggregation object to rename `method` → the engine's own `function`
 * key. A bridge that copies only `{ function, field, alias }` — the shape
 * this repo actually shipped until this card — makes the strategy's lowering
 * a NO-OP on every real deployment that boots through the default
 * `new AnalyticsServicePlugin({ cubes })` wiring, while every test that stubs
 * `executeAggregate` directly (as `objectql-dataset-filter.test.ts` does)
 * stays green — the declared-≠-enforced shape Prime Directive #10 names,
 * one layer below where #10413 itself was measured. This test goes through
 * the REAL bridge, not a stub, so it is the one place a regression here
 * would be caught.
 */
describe('plugin auto-bridge forwards aggregations[].filter (#10413 phase 2 / #10576)', () => {
  it('the engine.aggregate call carries the per-measure filter the strategy lowered', async () => {
    const calls: Array<Record<string, unknown>> = [];
    const engine = {
      aggregate: async (_object: string, options: Record<string, unknown>) => {
        calls.push(options);
        return [{ opp_count: 24, won_count: 8 }];
      },
      getObject: () => undefined,
    };
    const { ctx, registered } = fakePluginContext({ data: engine });

    await new AnalyticsServicePlugin({ queryCapabilities: objectqlOnly }).init(ctx as never);
    const service = registered.analytics as AnalyticsService;
    service.registerDataset(DatasetSchema.parse({
      name: 'won_metrics', label: 'Won metrics', object: 'opportunity',
      dimensions: [],
      measures: [
        { name: 'opp_count', label: 'Opportunities', aggregate: 'count' },
        { name: 'won_count', label: 'Won', aggregate: 'count', filter: { stage: 'closed_won' } },
      ],
    }));

    await service.query({ cube: 'won_metrics', measures: ['opp_count', 'won_count'] });

    // The unfiltered measure keeps the EXACT pre-#10413-phase-2 shape — no
    // `filter` key at all, not even `filter: undefined` — and the filtered
    // one carries its own predicate, translated with the same `function`
    // rename the rest of this bridge already applies.
    expect(calls[0].aggregations).toEqual([
      { function: 'count', field: '*', alias: 'opp_count' },
      { function: 'count', field: '*', alias: 'won_count', filter: { stage: 'closed_won' } },
    ]);
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

/**
 * #3639 gave this lookup the analytics-layer belt (the referenced object's own
 * read scope) and covers that belt's own behaviour in `dimension-labels.test.ts`
 * / `query-dataset.test.ts`. What is asserted here is the SECOND belt on the
 * same hook, and — the part neither change covers alone — that the two arrive
 * together on one engine call. Two PRs touching one hook is exactly how one of
 * them quietly stops being wired.
 */
describe('fetchRecordLabels carries BOTH belts (#3602)', () => {
  it('lands the read scope and the context on the same engine call', async () => {
    const { seen } = await runLabelLookup({ scope: readScope, context: ctxA });

    // [0] is the dataset aggregate; [1] is the id→label lookup — one row per
    // record, real display names, so it is row-granular and needs both belts.
    expect(seen[1].object).toBe('crm_account');
    expect(seen[1].where).toEqual({
      $and: [{ id: { $in: ['acc1'] } }, { organization_id: 'org_A' }],
    });
    expect(seen[1].context).toBe(ctxA);
  });

  it('carries the context even when the target object has no read scope', async () => {
    // The depth case for this hook: scope resolves to nothing, so the engine's
    // own RLS is all that is left. Dropping the context here would make an
    // unscoped-at-the-analytics-layer label read also unscoped at the engine.
    const { seen } = await runLabelLookup({ scope: () => undefined, context: ctxA });

    expect(seen[1].where).toEqual({ id: { $in: ['acc1'] } });
    expect(seen[1].context).toBe(ctxA);
  });

  it('resolves the label when the record is in scope', async () => {
    const { result } = await runLabelLookup({ scope: readScope, context: ctxA });

    expect(result.rows[0].account).toBe('Acme Corp');
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

  it('renders nothing for an OUT-OF-ENVELOPE cross-object query `execute()` would reject', async () => {
    // The rendering must not describe a query that cannot run. #3654 now SERVES
    // in-envelope cross-object DIMENSIONS by FK-expand (generateSql renders the
    // equivalent LEFT JOIN — see objectql-crossobj-expand.test.ts). What execute()
    // still rejects — a cross-object MEASURE — generateSql must reject too, so the
    // preview and the executed path stay in step over the same set.
    const compiled = compileDataset(
      DatasetSchema.parse({
        name: 'sales_by_account',
        label: 'Sales by account',
        object: 'opportunity',
        include: ['account'],
        dimensions: [{ name: 'stage', field: 'stage', type: 'string' }],
        measures: [{ name: 'acct_rev', aggregate: 'sum', field: 'account.annual_revenue' }],
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
      service.generateSql({ cube: 'sales_by_account', dimensions: ['stage'], measures: ['acct_rev'] }, ctxA),
    ).rejects.toThrow(/cannot evaluate a cross-object measure/);
  });
});
