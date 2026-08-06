// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#5716] `POST /analytics/dataset/query` — the caller-shaped refusals that were
 * never on the message list, and therefore never left `500`.
 *
 * ## The seam this file asserts
 *
 * #5352 gave this route a list of message substrings so six refusal families
 * could answer 400; #5367 retired five of those entries by giving their
 * producers an ADR-0112 envelope. Both rounds worked from that list — and the
 * list was only ever the refusals someone had already hit. Twelve more throw
 * sites in `service-analytics` (thirteen refusal conditions) are the same kind of
 * mistake — the caller's request, or the dataset they authored — and were
 * answering `500 {"code":"ANALYTICS_QUERY_FAILED"}`: the platform reporting
 * itself broken for a typo in a `compareTo`.
 *
 * The producer half is pinned per site in `service-analytics`'s
 * `unlisted-refusal-envelope.test.ts`. This file is the SEAM: a real
 * `AnalyticsService` compiling a real dataset, the error crossing into the
 * route's catch is the one the real compiler/executor/strategy throws, and
 * nothing here constructs a shape it also asserts.
 *
 * ## Reverse verification, direction predicted BEFORE running
 *
 * Revert any producer to `throw new Error(…)` (and rebuild `service-analytics` —
 * this file exercises the BUILT package) and that case goes RED with
 * `500 ANALYTICS_QUERY_FAILED`. Plain direction, no inversion: since #5808 the
 * route carries NO message list at all, so "producer stops declaring" has
 * exactly one outward consequence. Positive controls sit beside the refusals so
 * a case cannot pass because the wiring never reached the producer.
 *
 * MEASURED with the four producer files reverted and `service-analytics` rebuilt:
 * **11 red / 5 green** — every refusal case red on `expected 200/500 to be 400`,
 * the three positive controls and the two "this route cannot show it" cases
 * green, which is what makes them controls rather than filler.
 */

import { describe, it, expect, vi } from 'vitest';
import type { Logger } from '@objectstack/spec/contracts';
import { AnalyticsService } from '@objectstack/service-analytics';
import { RestServer } from './rest-server';

// ── harness (the shape `analytics-dataset-refusal-envelope.test.ts` uses) ─────

function mockServer() {
  return {
    get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(),
    use: vi.fn(), listen: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined),
  };
}
function mockProtocol() {
  return {
    getDiscovery: vi.fn().mockResolvedValue({ version: 'v0', routes: { data: '', metadata: '' } }),
    getMetaTypes: vi.fn().mockResolvedValue([]),
    getMetaItems: vi.fn().mockResolvedValue([]),
  };
}
function mockRes() {
  const res: any = { statusCode: 200, body: undefined };
  res.status = vi.fn((c: number) => { res.statusCode = c; return res; });
  res.json = vi.fn((b: any) => { res.body = b; return res; });
  res.end = vi.fn(() => res);
  return res;
}

function buildRoute(analyticsProvider?: any) {
  const rest = new RestServer(
    mockServer() as any, mockProtocol() as any, { api: { requireAuth: false } } as any,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined,
    analyticsProvider,
  );
  (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
  rest.registerRoutes();
  return rest.getRoutes().find((r) => r.method === 'POST' && r.path.endsWith('/analytics/dataset/query'))!;
}

async function post(route: any, body: unknown) {
  const res = mockRes();
  await route.handler({ method: 'POST', params: {}, headers: {}, body } as any, res);
  return res;
}

const silent: Logger = { debug() {}, info() {}, warn() {}, error() {} };

/** The ObjectQL aggregate path — one fixed bucket, so a valid selection is 200. */
function aggregateAnalytics(extra: Record<string, unknown> = {}): AnalyticsService {
  return new AnalyticsService({
    logger: silent,
    queryCapabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }),
    executeAggregate: async () => [{ stage: 'won', revenue: 100 }],
    isRegisteredObject: () => true,
    ...extra,
  } as never);
}

/** The raw-SQL path. */
function nativeAnalytics(extra: Record<string, unknown> = {}): AnalyticsService {
  return new AnalyticsService({
    logger: silent,
    queryCapabilities: () => ({ nativeSql: true, objectqlAggregate: false, inMemory: false }),
    executeRawSql: async () => [{ stage: 'won', revenue: 100 }],
    isRegisteredObject: () => true,
    ...extra,
  } as never);
}

/** A valid single-object dataset — nothing here needs a join. */
const dataset = {
  name: 'pipeline',
  label: 'Pipeline',
  object: 'crm_opportunity',
  dimensions: [
    { name: 'stage', field: 'stage', type: 'string' },
    { name: 'close_date', field: 'close_date', type: 'date' },
    { name: 'created_at', field: 'created_at', type: 'date' },
  ],
  measures: [{ name: 'revenue', aggregate: 'sum', field: 'amount' }],
};
const selection = { dimensions: ['stage'], measures: ['revenue'] };
const WINDOW = ['2026-01-01', '2026-01-31'];

/** The same dataset, joined to `account` — the shape every cross-object case needs. */
const joinedDataset = {
  ...dataset,
  name: 'pipeline_by_account',
  include: ['account'],
  dimensions: [
    { name: 'stage', field: 'stage', type: 'string' },
    { name: 'region', field: 'account.region', type: 'string' },
    { name: 'account_opened', field: 'account.created_at', type: 'date' },
  ],
  measures: [
    { name: 'revenue', aggregate: 'sum', field: 'amount' },
    { name: 'avg_deal', aggregate: 'avg', field: 'amount' },
    { name: 'remote_sum', aggregate: 'sum', field: 'account.balance' },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────

describe('[#5716] a refusal nobody listed still answers 4xx, from its own envelope', () => {
  const CASES: Array<{
    name: string;
    body: unknown;
    analytics: () => AnalyticsService;
    code: 'DATASET_INVALID' | 'INVALID_FIELD';
    message: RegExp;
  }> = [
    {
      name: 'dataset-compiler: an `include` JOIN across datasources (#5115)',
      analytics: () =>
        aggregateAnalytics({
          getObjectDatasource: (o: string) => (o === 'crm_opportunity' ? 'primary' : 'warehouse'),
        }),
      body: {
        dataset: { ...dataset, include: ['account'], dimensions: [{ name: 'region', field: 'account.region', type: 'string' }] },
        selection: { dimensions: ['region'], measures: ['revenue'] },
      },
      code: 'DATASET_INVALID',
      message: /declares a JOIN that crosses datasources/,
    },
    {
      name: 'dataset-compiler: an `include` relationship the object does not have',
      analytics: () => aggregateAnalytics({ relationshipResolver: () => undefined }),
      body: {
        dataset: { ...dataset, include: ['bogus'] },
        selection,
      },
      code: 'DATASET_INVALID',
      message: /includes relationship "bogus" which does not exist on object "crm_opportunity"/,
    },
    {
      name: 'dataset-executor: a `dateRange` bound that is not a date',
      analytics: aggregateAnalytics,
      body: {
        dataset,
        selection: {
          ...selection,
          timeDimensions: [{ dimension: 'close_date', dateRange: ['2026-01-01', 'the-first-of-never'] }],
          compareTo: { kind: 'previousPeriod' },
        },
      },
      code: 'DATASET_INVALID',
      message: /invalid date in dateRange: "the-first-of-never"/,
    },
    {
      name: 'dataset-executor: compareTo names a dimension with no dateRange',
      analytics: aggregateAnalytics,
      body: {
        dataset,
        selection: {
          ...selection,
          timeDimensions: [{ dimension: 'close_date', dateRange: WINDOW }],
          compareTo: { kind: 'previousPeriod', dimension: 'created_at' },
        },
      },
      code: 'DATASET_INVALID',
      message: /compareTo requires a timeDimension "created_at" with a dateRange/,
    },
    {
      name: 'dataset-executor: compareTo with no dated window at all',
      analytics: aggregateAnalytics,
      body: {
        dataset,
        selection: {
          ...selection,
          timeDimensions: [{ dimension: 'close_date', granularity: 'month' }],
          compareTo: { kind: 'previousPeriod' },
        },
      },
      code: 'DATASET_INVALID',
      message: /compareTo needs a dated window to shift/,
    },
    {
      name: 'dataset-executor: compareTo ambiguous between two dated windows',
      analytics: aggregateAnalytics,
      body: {
        dataset,
        selection: {
          ...selection,
          timeDimensions: [
            { dimension: 'close_date', dateRange: WINDOW },
            { dimension: 'created_at', dateRange: WINDOW },
          ],
          compareTo: { kind: 'previousPeriod' },
        },
      },
      code: 'DATASET_INVALID',
      message: /compareTo\.dimension is ambiguous: 2 time dimensions carry a dateRange/,
    },
    {
      name: 'objectql-strategy: bucketing a cross-object time dimension',
      analytics: aggregateAnalytics,
      body: {
        dataset: joinedDataset,
        selection: {
          dimensions: ['stage'],
          measures: ['revenue'],
          timeDimensions: [{ dimension: 'account_opened', granularity: 'month' }],
        },
      },
      code: 'INVALID_FIELD',
      message: /cannot bucket a cross-object time dimension \("account\.created_at"\)/,
    },
    {
      name: 'objectql-strategy: a cross-object MEASURE',
      analytics: aggregateAnalytics,
      body: {
        dataset: joinedDataset,
        selection: { dimensions: ['stage'], measures: ['remote_sum'] },
      },
      code: 'INVALID_FIELD',
      message: /cannot evaluate a cross-object measure \("account\.balance"\)/,
    },
    {
      // A dashboard's own filter on a joined column — `runtimeFilter` is where a
      // widget's date/segment picker lands.
      name: 'objectql-strategy: a cross-object FILTER',
      analytics: aggregateAnalytics,
      body: {
        dataset: joinedDataset,
        selection: { dimensions: ['stage'], measures: ['revenue'], runtimeFilter: { region: 'NA' } },
      },
      code: 'INVALID_FIELD',
      message: /cannot evaluate a cross-object filter \("account\.region"\)/,
    },
    {
      name: 'objectql-strategy: a non-recombinable measure over a cross-object dimension',
      analytics: aggregateAnalytics,
      body: {
        dataset: joinedDataset,
        selection: { dimensions: ['region'], measures: ['avg_deal'] },
      },
      code: 'INVALID_FIELD',
      message: /cannot group by a cross-object dimension with a "avg" measure \("avg_deal"\)/,
    },
    {
      // Measured, against the guess this file first carried: a two-hop dataset
      // dimension DOES reach the multi-hop arm. `joinAlias` flattens the JOIN's
      // alias to `account__owner`, but the dimension's own `sql` stays the raw
      // `account.owner.region`, which is what `planCrossObject` classifies.
      name: 'objectql-strategy: a MULTI-HOP cross-object dimension',
      analytics: aggregateAnalytics,
      body: {
        dataset: {
          ...joinedDataset,
          include: ['account.owner'],
          dimensions: [{ name: 'owner_region', field: 'account.owner.region', type: 'string' }],
          measures: [{ name: 'revenue', aggregate: 'sum', field: 'amount' }],
        },
        selection: { dimensions: ['owner_region'], measures: ['revenue'] },
      },
      code: 'INVALID_FIELD',
      message: /supports only single-hop cross-object dimensions; "account\.owner\.region"/,
    },
  ];

  for (const c of CASES) {
    it(`${c.name} → 400 ${c.code} (was 500 ANALYTICS_QUERY_FAILED)`, async () => {
      const route = buildRoute(async () => c.analytics());
      const res = await post(route, c.body);

      expect(res.statusCode).toBe(400);
      expect(res.body.code).toBe(c.code);
      // The message survives intact so the author can act on it, and the body is
      // the 4xx shape (`message`), not the 5xx one (`error`).
      expect(String(res.body.message)).toMatch(c.message);
      expect(res.body.error).toBeUndefined();
      // The defect, asserted as the defect rather than as the fix.
      expect(res.statusCode).not.toBe(500);
      expect(res.body.code).not.toBe('ANALYTICS_QUERY_FAILED');
    });
  }

  it('POSITIVE control (aggregate path): the same wiring, a valid selection → 200 with rows', async () => {
    const route = buildRoute(async () => aggregateAnalytics());
    const res = await post(route, { dataset, selection });
    expect(res.statusCode).toBe(200);
    expect(res.body.rows).toEqual([{ stage: 'won', revenue: 100 }]);
  });

  it('POSITIVE control (raw-SQL path): the declared measure still runs → 200 with rows', async () => {
    // The twin of the undeclared-measure case: one character away, same wiring.
    const route = buildRoute(async () => nativeAnalytics());
    const res = await post(route, { dataset, selection });
    expect(res.statusCode).toBe(200);
    expect(res.body.rows).toEqual([{ stage: 'won', revenue: 100 }]);
  });

  it('POSITIVE control (cross-object, in envelope): an FK-expandable dimension → 200', async () => {
    // What keeps the four `planCrossObject` cases verdicts about the ENVELOPE
    // rather than about cross-object queries being rejected outright: a
    // single-hop dimension with a recombinable measure is SERVED on this path.
    const route = buildRoute(async () => aggregateAnalytics());
    const res = await post(route, {
      dataset: joinedDataset,
      selection: { dimensions: ['region'], measures: ['revenue'] },
    });
    expect(res.statusCode).toBe(200);
  });
});

describe('[#5716] the two sites this route cannot show, and why', () => {
  it('an `include` past the hop limit is answered by the SCHEMA first — 400 VALIDATION_FAILED', async () => {
    // The compiler's `MAX_JOIN_HOPS` refusal is enveloped too (its producer test
    // drives it directly, bypassing the schema), but it is not reachable HERE:
    // the route parses the document with `DatasetSchema`, which refines the same
    // limit, so the caller gets the schema's 400 and the compiler never runs.
    // Recorded rather than asserted as `DATASET_INVALID`, because manufacturing
    // the expected code would mean asserting a path that does not exist — the
    // observable fact is a 4xx either way, from the earliest layer that can tell.
    const route = buildRoute(async () => aggregateAnalytics());
    const res = await post(route, {
      dataset: { ...dataset, include: ['a.b.c.d'] },
      selection,
    });

    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(String(res.body.detail)).toMatch(/3-hop limit/);
  });

  it('an undeclared MEASURE never reaches the strategy — `ensureCube` mints one, and the #4437 gate judges it', async () => {
    // The twelfth site (`native-sql-strategy`'s "cube declares no measure") is
    // enveloped, and its producer test drives it — but it cannot be shown from
    // this route, and the measurement is worth writing down rather than faking:
    // `AnalyticsService.ensureCube` AUGMENTS a registered cube with a
    // suffix-inferred `Metric` for every measure name the query carries, so the
    // strategy is handed a cube that declares `profit` and compiles
    // `SUM(profit)`. Reaching the refusal means calling the strategy directly
    // (`measure-expression-sql.test.ts` does).
    //
    // What answers on THIS face is the #4437 source-field gate, as soon as a
    // field probe can say the object has no such column — and it answers
    // `400 INVALID_FIELD`, the same code this PR gives the strategy's own
    // refusal. That agreement is the point of the choice, so it is asserted
    // rather than asserted about.
    const route = buildRoute(async () =>
      nativeAnalytics({ getObjectFieldNames: () => ['stage', 'amount', 'close_date', 'created_at'] }),
    );
    const res = await post(route, { dataset, selection: { dimensions: ['stage'], measures: ['profit_sum'] } });

    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe('INVALID_FIELD');
    expect(String(res.body.message)).toMatch(/aggregates field 'profit', which object 'crm_opportunity' does not have/);
  });
});
