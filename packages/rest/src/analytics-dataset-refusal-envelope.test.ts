// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#5367] `POST /analytics/dataset/query` — five dataset refusals reach the
 * caller as `400 DATASET_INVALID` because their PRODUCER says so, not because
 * this route recognised their prose.
 *
 * ## The seam, and why this file boots the REAL analytics service
 *
 * #5352 / PR #5366 gave the route an envelope branch (`error.code` + a 4xx
 * `error.status`, read first) and left a transitional list of message substrings
 * behind it, because six refusal families were still bare `throw new Error(…)`:
 *
 * ```
 * /not declared in the dataset|not backed by a declared relationship|
 *  not supported by the v1 dataset runtime|read-scope-sql|
 *  not a selected dimension or measure|is not a subset of the selected dimensions/
 * ```
 *
 * With that list in place the HTTP status of six families was a property of their
 * **wording**: rephrasing `dataset-compiler`'s "is not declared in the dataset's
 * `include`" — no logic change — dropped the refusal from 400 to 500, and no test
 * and no gate would have gone red. Prime Directive #12 allows such an
 * accommodation only while it is declared, loud, tested **and removable on a
 * schedule**; #5366 delivered the first three. #5367 is the schedule: five
 * producers now throw `datasetInvalidError` (`DATASET_INVALID` / 400) and their
 * five entries are gone from the list.
 *
 * The claim has two halves and either alone reads as fixed:
 *
 *   - **B** — the producer throws the envelope. Pinned per site, against the real
 *     producer, in `service-analytics`'s `dataset-refusal-envelope.test.ts`.
 *   - **A** — the route classifies on that envelope rather than on the message.
 *     Pinned in `analytics-filter-refusal-envelope.test.ts`, including the
 *     five deleted entries asserted in both directions.
 *
 * A unit test on either side can be green while an author still sees a 500. So
 * this file asserts the SEAM: the analytics provider is a real `AnalyticsService`
 * compiling a real dataset, the error crossing into the catch is the one the real
 * `dataset-compiler` / `dataset-executor` / `native-sql-strategy` throws, and
 * nothing here asserts a shape it also constructs.
 *
 * ## Reverse verification, direction predicted BEFORE running
 *
 * Restore ANY of the five `throw new Error(…)` calls in `service-analytics` (and
 * rebuild it — this file exercises the BUILT package) and that family's case here
 * goes RED with `500 ANALYTICS_QUERY_FAILED`, because the route no longer carries
 * a message entry that would rescue it. The direction is plain red, not the
 * inverted/extra-diagnostic shapes: the canonical envelope branch is FIRST in the
 * catch and the fallback that used to answer for these families is gone, so
 * "producer stops declaring" has exactly one outward consequence. Confirmed by
 * running it (see the PR).
 *
 * Positive controls sit next to the refusals so a case cannot pass merely because
 * the wiring never reached the producer.
 */

import { describe, it, expect, vi } from 'vitest';
import type { Logger } from '@objectstack/spec/contracts';
import { AnalyticsService } from '@objectstack/service-analytics';
import { RestServer } from './rest-server';

// ── harness (the shape `analytics-filter-refusal-envelope.test.ts` uses) ──────

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

/** Build a RestServer over an analytics provider (positional arg #15). */
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

/**
 * A real `AnalyticsService` on the ObjectQL aggregate path — one fixed bucket, so
 * a selection that gets far enough to touch data answers 200. That is what makes
 * the refusals meaningful: they fail on the dataset/selection, on a route that
 * demonstrably works otherwise.
 */
function aggregateAnalytics(): AnalyticsService {
  return new AnalyticsService({
    logger: silent,
    queryCapabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }),
    executeAggregate: async () => [{ stage: 'won', revenue: 100 }],
    isRegisteredObject: () => true,
  });
}

/** A real `AnalyticsService` on the raw-SQL path — the only one that enforces the join allowlist. */
function nativeAnalytics(): AnalyticsService {
  return new AnalyticsService({
    logger: silent,
    queryCapabilities: () => ({ nativeSql: true, objectqlAggregate: false, inMemory: false }),
    executeRawSql: async () => [{ stage: 'won', revenue: 100 }],
    isRegisteredObject: () => true,
  });
}

/** A valid single-object dataset — no `include`, so nothing here needs a join. */
const dataset = {
  name: 'pipeline',
  label: 'Pipeline',
  object: 'crm_opportunity',
  dimensions: [{ name: 'stage', field: 'stage', type: 'string' }],
  measures: [{ name: 'revenue', aggregate: 'sum', field: 'amount' }],
};
const selection = { dimensions: ['stage'], measures: ['revenue'] };

// ─────────────────────────────────────────────────────────────────────────────

describe('[#5367] a dataset refusal answers 400 DATASET_INVALID from its own envelope', () => {
  /**
   * One row per entry #5367 removed from the route's message list, driven through
   * the real producer. `listEntry` records the substring that used to classify it
   * — the audit trail that the deletion and this coverage are the same set.
   */
  const CASES: Array<{
    name: string;
    listEntry: string;
    body: unknown;
    analytics: () => AnalyticsService;
    message: RegExp;
    /** Defaults to `DATASET_INVALID`; see the one row that legitimately differs. */
    code?: string;
  }> = [
    {
      /*
       * ⚠️ This row's ANSWER changed at #6188, and the change is the finding —
       * measured on this route, not predicted.
       *
       * The only inputs that ever reached `dataset-compiler`'s aggregate refusal
       * were `array_agg` and `string_agg`; #6188 retired both from
       * `AggregationFunction`, so the route's own `DatasetSchema.parse` now
       * refuses this body one layer earlier. Measured before/after on this
       * route: `400 DATASET_INVALID` → `400 VALIDATION_FAILED`. The status is
       * unchanged — the caller still gets a 4xx naming their own mistake — but
       * the producer, and therefore the code, is the schema now.
       *
       * Kept rather than deleted, with the successor answer pinned: the row's
       * `listEntry` is the audit trail for one entry #5367 removed from the
       * route's message list, and that trail is what the coverage test below
       * checks. What this row can no longer prove is that the route envelopes a
       * COMPILER aggregate refusal — that branch is unreachable end to end while
       * `UNSUPPORTED_AGGREGATES` is empty. Rows ②–⑤ still carry that guarantee
       * for the compiler, executor and strategy; saying so is more useful than
       * synthesising an aggregate to keep the old shape alive.
       */
      name: 'dataset schema: an aggregate retired from the vocabulary (#6188)',
      listEntry: 'not supported by the v1 dataset runtime',
      analytics: aggregateAnalytics,
      code: 'VALIDATION_FAILED',
      body: {
        dataset: {
          ...dataset,
          measures: [{ name: 'names', aggregate: 'string_agg', field: 'name' }],
        },
        selection: { dimensions: ['stage'], measures: ['names'] },
      },
      // ⚠️ The route replaces the message with a generic
      // "Invalid dataset definition." and carries the parse error in `detail`,
      // so this row asserts the generic message here and the prescription
      // below — where it actually lands.
      message: /Invalid dataset definition\./,
    },
    {
      name: 'dataset-compiler: a dimension traversing an undeclared relationship path',
      listEntry: 'not declared in the dataset',
      analytics: aggregateAnalytics,
      body: {
        dataset: {
          ...dataset,
          include: [],
          dimensions: [{ name: 'region', field: 'account.region', type: 'string' }],
        },
        selection: { dimensions: ['region'], measures: ['revenue'] },
      },
      message: /"account" is not declared in the dataset's `include`/,
    },
    {
      name: 'dataset-executor: an order key that is not selected',
      listEntry: 'not a selected dimension or measure',
      analytics: aggregateAnalytics,
      body: { dataset, selection: { ...selection, order: { profit: 'desc' } } },
      message: /order key\(s\) "profit" — not a selected dimension or measure/,
    },
    {
      name: 'dataset-executor: a totals grouping outside the selection',
      listEntry: 'is not a subset of the selected dimensions',
      analytics: aggregateAnalytics,
      body: { dataset, selection: { ...selection, totals: { groupings: [['region']] } } },
      message: /totals grouping \[region\] is not a subset of the selected dimensions/,
    },
    {
      // The caller-shaped trigger: the DATASET declares no `include`, and the
      // SELECTION names a dotted dimension, which `lookupMember`'s synthetic
      // relation fallback turns into a join at alias `account`.
      name: 'native-sql-strategy: a selection naming a join outside the allowlist',
      listEntry: 'not backed by a declared relationship',
      analytics: nativeAnalytics,
      body: { dataset, selection: { dimensions: ['account.region'], measures: ['revenue'] } },
      message: /join "account" is not backed by a declared relationship on cube "pipeline"/,
    },
  ];

  for (const c of CASES) {
    it(`${c.name} → 400 ${c.code ?? 'DATASET_INVALID'}`, async () => {
      const route = buildRoute(async () => c.analytics());
      const res = await post(route, c.body);

      expect(res.statusCode).toBe(400);
      expect(res.body.code).toBe(c.code ?? 'DATASET_INVALID');
      // The message survives intact so the author can act on it, and the body is
      // the 4xx shape (`message`), not the 5xx one (`error`).
      expect(String(res.body.message)).toMatch(c.message);
      expect(res.body.error).toBeUndefined();
      // The defect, asserted as the defect rather than as the fix.
      expect(res.statusCode).not.toBe(500);
      expect(res.body.code).not.toBe('ANALYTICS_QUERY_FAILED');
    });
  }

  it('covers exactly the five entries #5367 deleted from the message list', () => {
    expect(CASES.map((c) => c.listEntry).sort()).toEqual([
      'is not a subset of the selected dimensions',
      'not a selected dimension or measure',
      'not backed by a declared relationship',
      'not declared in the dataset',
      'not supported by the v1 dataset runtime',
    ]);
  });

  /*
   * [#6188] Where the retirement prescription actually lands on this route —
   * measured, not assumed, because the answer has a known cut in it.
   *
   * The route replaces every parse failure's `message` with a generic
   * "Invalid dataset definition." and puts the real one in `detail`, capped at
   * 1000 characters (`rest-server.ts`). The prescription's zod-wrapped message
   * is 1076 chars for `array_agg` and 1304 for `string_agg`, so the two clauses
   * an author must act on — "was removed" (~index 192) and the imperative
   * "Delete the aggregation" (690 / 918) — arrive, and the closing
   * `os migrate meta --from 16` sentence is TRUNCATED away on this surface
   * only. It is intact everywhere the cap does not apply: the `tsc` error, a
   * direct `DatasetSchema.parse`, and `os validate`.
   *
   * Pinned rather than papered over. Shortening the prescription to fit one
   * route's cap would degrade it on every surface that has no cap, and raising
   * the cap (or returning the issues structurally) is a REST-lane decision
   * about every long prescription, not this vocabulary's to make.
   */
  it('the retirement prescription reaches the HTTP caller in `detail`, minus the truncated tail', async () => {
    const route = buildRoute(async () => aggregateAnalytics());
    const res = await post(route, {
      dataset: { ...dataset, measures: [{ name: 'names', aggregate: 'string_agg', field: 'name' }] },
      selection: { dimensions: ['stage'], measures: ['names'] },
    });

    expect(res.statusCode).toBe(400);
    const detail = String(res.body.detail);
    expect(detail).toContain('`string_agg`');
    expect(detail).toContain('was removed');
    expect(detail).toContain('Delete the aggregation');
    // The cap's measured consequence — asserted so that raising the cap, or
    // shortening the message, shows up here as a deliberate change.
    expect(detail.length).toBe(1000);
    expect(detail).not.toContain('os migrate meta');
  });

  it('POSITIVE control (aggregate path): the same wiring, a valid selection → 200 with rows', async () => {
    const route = buildRoute(async () => aggregateAnalytics());
    const res = await post(route, { dataset, selection });
    expect(res.statusCode).toBe(200);
    expect(res.body.rows).toEqual([{ stage: 'won', revenue: 100 }]);
  });

  it('POSITIVE control (raw-SQL path): a DECLARED relationship still joins → 200 with rows', async () => {
    // The allowlist case's twin: `include: ['account']` makes the same dotted
    // selection legal, so case ⑤ above is a verdict about the allowlist rather
    // than about dotted members being rejected outright.
    const route = buildRoute(async () => nativeAnalytics());
    const res = await post(route, {
      dataset: { ...dataset, include: ['account'] },
      selection: { dimensions: ['account.region'], measures: ['revenue'] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body.rows).toEqual([{ stage: 'won', revenue: 100 }]);
  });
});
