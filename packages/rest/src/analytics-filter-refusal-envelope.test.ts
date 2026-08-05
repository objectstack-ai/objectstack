// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#5352] `/analytics/dataset/query` answers a filter refusal as the caller's
 * mistake (`400 INVALID_FILTER`), not as a platform fault
 * (`500 ANALYTICS_QUERY_FAILED`).
 *
 * ## The seam, and why this file boots the REAL analytics service
 *
 * The defect had two halves and either one alone reads as fixed:
 *
 *   - **B** — `filter-normalizer.ts` refused a malformed filter with a bare
 *     `throw new Error(…)`, carrying no `code`/`status`.
 *   - **A** — this route's catch discarded `error.code` / `error.status` and
 *     re-derived the classification from a hardcoded list of message
 *     substrings, which no filter refusal matched.
 *
 * So a unit test on either side can be green while an author still sees a 500:
 * mock the service and half B is assumed; assert on the thrown error and half A
 * is assumed. `analytics-routes.test.ts` next door mocks `queryDataset` because
 * its subjects (dataset resolution, decoration stripping, schema validation)
 * live entirely on this side of the seam. This file's subject IS the seam, so
 * the provider is a real `AnalyticsService` and the error crossing into the
 * catch is the real one `normalizeAnalyticsFilterTree` throws — nothing here
 * asserts a shape it also constructs.
 *
 * `runtimeFilter` is the load-bearing input: it is the presentation-scope
 * filter a dashboard widget carries, i.e. exactly the field an author typos.
 *
 * ## What must NOT change
 *
 * Reading the envelope makes this route classify on what the error SAYS about
 * itself. Three regressions would each be worse than the bug:
 *
 *   1. The message list still classifies the families that remain bare `Error`s
 *      (the dataset compiler, `read-scope-sql`, the executor) — all six of its
 *      entries were re-verified unenveloped at the time of #5352, so deleting
 *      it would regress them from `400 DATASET_INVALID` to 500.
 *   2. A genuine internal fault must still be a 500 with its `logError` line —
 *      "read the envelope" must not become "call everything a 400".
 *   3. A 5xx-status error is NOT passed through, so an internal fault can never
 *      be re-labelled with a code of its own choosing.
 */

import { describe, it, expect, vi } from 'vitest';
import type { Logger } from '@objectstack/spec/contracts';
import { AnalyticsService } from '@objectstack/service-analytics';
import { RestServer } from './rest-server';

// ── harness ──────────────────────────────────────────────────────────────────

function mockServer() {
  return {
    get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(),
    use: vi.fn(), listen: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined),
  };
}
function mockProtocol() {
  return {
    getDiscovery: vi.fn().mockResolvedValue({ version: 'v0', endpoints: {} }),
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

/** A single-object dataset — no `include`, so nothing here needs a join. */
const dataset = {
  name: 'pipeline',
  label: 'Pipeline',
  object: 'crm_opportunity',
  dimensions: [{ name: 'stage', field: 'stage', type: 'string' }],
  measures: [{ name: 'revenue', aggregate: 'sum', field: 'amount' }],
};
const selection = { dimensions: ['stage'], measures: ['revenue'] };

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

/**
 * A REAL `AnalyticsService` on the ObjectQL aggregate path.
 *
 * `executeAggregate` returns a fixed bucket, so a query that gets far enough to
 * touch data succeeds — which is what makes the refusal cases meaningful: they
 * fail on the FILTER, on a route that demonstrably answers 200 otherwise.
 */
function realAnalytics(): AnalyticsService {
  const silent: Logger = { debug() {}, info() {}, warn() {}, error() {} };
  return new AnalyticsService({
    logger: silent,
    queryCapabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }),
    executeAggregate: async () => [{ stage: 'won', revenue: 100 }],
    isRegisteredObject: () => true,
  });
}

/** POST a body at the route and return the recorded response. */
async function post(route: any, body: unknown) {
  const res = mockRes();
  await route.handler({ method: 'POST', params: {}, headers: {}, body } as any, res);
  return res;
}

// ─────────────────────────────────────────────────────────────────────────────

describe('[#5352] POST /analytics/dataset/query — a filter refusal reaches the caller as 400', () => {
  it('a misspelled operator in a widget filter → 400 INVALID_FILTER (was 500 ANALYTICS_QUERY_FAILED)', async () => {
    const route = buildRoute(async () => realAnalytics());
    const res = await post(route, {
      dataset,
      selection: { ...selection, runtimeFilter: { stage: { $sortOf: 'won' } } },
    });

    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe('INVALID_FILTER');
    // The two halves of the defect, asserted as the defect rather than as the fix.
    expect(res.statusCode).not.toBe(500);
    expect(res.body.code).not.toBe('ANALYTICS_QUERY_FAILED');
    // The message still names the operator, so the author can act on it.
    expect(String(res.body.message)).toMatch(/Unsupported filter operator "\$sortOf" on "stage"/);
  });

  it('a POSITIVE control: the same wiring, a valid filter → 200 with rows', async () => {
    // Without this, the case above could pass for any reason that makes the
    // route 400 — including the pipeline never reaching the filter normalizer.
    const route = buildRoute(async () => realAnalytics());
    const res = await post(route, {
      dataset,
      selection: { ...selection, runtimeFilter: { stage: { $eq: 'won' } } },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body.rows).toEqual([{ stage: 'won', revenue: 100 }]);
  });

  // The other refusal spellings an author reaches through the same field. Each
  // is a real refusal from the real normalizer, crossing the real seam.
  const REFUSALS: Array<{ name: string; runtimeFilter: unknown; message: RegExp }> = [
    {
      name: 'a field constraint with zero operators (#5240)',
      runtimeFilter: { stage: {} },
      message: /carries a field constraint with zero operators/,
    },
    {
      name: 'a $between with one bound',
      runtimeFilter: { amount: { $between: [10] } },
      message: /needs a two-element \[min, max\] array/,
    },
    {
      name: 'an empty $or',
      runtimeFilter: { $or: [] },
      message: /"\$or" requires a non-empty array/,
    },
    {
      name: 'an $or branch that is not a filter object',
      runtimeFilter: { $or: [{ stage: 'won' }, 'nope'] },
      message: /branches must be filter objects/,
    },
    {
      name: 'a $not of a non-object',
      runtimeFilter: { $not: 5 },
      message: /"\$not" requires a filter object/,
    },
    {
      name: 'an unsupported top-level operator',
      runtimeFilter: { $nor: [{ stage: 'won' }] },
      message: /Unsupported top-level filter operator "\$nor"/,
    },
  ];

  for (const c of REFUSALS) {
    it(`${c.name} → 400 INVALID_FILTER`, async () => {
      const route = buildRoute(async () => realAnalytics());
      const res = await post(route, { dataset, selection: { ...selection, runtimeFilter: c.runtimeFilter } });
      expect(res.statusCode).toBe(400);
      expect(res.body.code).toBe('INVALID_FILTER');
      expect(String(res.body.message)).toMatch(c.message);
    });
  }
});

describe('[#5352] the message-sniffing fallback still classifies the families that carry no envelope', () => {
  // Every entry of the route's regex list, produced as its owner produces it:
  // a bare `Error`. Re-verified unenveloped while #5352 was implemented —
  // `dataset-compiler.ts`, `native-sql-strategy.ts`, `dataset-executor.ts` and
  // `read-scope-sql.ts` all `throw new Error(…)` with no `code`/`status` — so
  // the list is the only thing standing between them and a 500.
  const FALLBACK: Array<{ name: string; message: string }> = [
    {
      name: 'dataset-compiler: undeclared relationship path',
      message: 'dimension "region" references relationship path "account" via "account.region", but "account" is not declared in the dataset\'s `include`.',
    },
    {
      name: 'native-sql-strategy: join outside the allowlist',
      message: '[NativeSQLStrategy] join "account" is not backed by a declared relationship on cube "pipeline".',
    },
    {
      name: 'dataset-compiler: aggregate outside the v1 runtime',
      message: '[dataset-compiler] measure "x" uses aggregate "median" which is not supported by the v1 dataset runtime (supported: sum, avg).',
    },
    {
      name: 'read-scope-sql: fail-closed read scope',
      message: '[read-scope-sql] unsupported operator "$regex" on "owner" (fail-closed).',
    },
    {
      name: 'dataset-executor: order key that is not selected',
      message: '[dataset-executor] order key(s) "profit" — not a selected dimension or measure. Selectable here: stage, revenue.',
    },
    {
      name: 'dataset-executor: totals grouping outside the selection',
      message: '[dataset-executor] totals grouping [region] is not a subset of the selected dimensions — unknown: region.',
    },
  ];

  for (const c of FALLBACK) {
    it(`${c.name} → still 400 DATASET_INVALID`, async () => {
      const route = buildRoute(async () => ({ queryDataset: vi.fn().mockRejectedValue(new Error(c.message)) }));
      const res = await post(route, { dataset, selection });
      expect(res.statusCode).toBe(400);
      expect(res.body.code).toBe('DATASET_INVALID');
    });
  }
});

describe('[#5352] reading the envelope did not turn every failure into a 400', () => {
  it('a genuine internal fault is still 500 ANALYTICS_QUERY_FAILED', async () => {
    // Nothing filter-shaped, no envelope, no message the list matches — the
    // class the 500 exists for.
    const route = buildRoute(async () => ({
      queryDataset: vi.fn().mockRejectedValue(new Error('ECONNRESET: socket hang up while reading from the analytics datasource')),
    }));
    const res = await post(route, { dataset, selection });

    expect(res.statusCode).toBe(500);
    expect(res.body.code).toBe('ANALYTICS_QUERY_FAILED');
  });

  it('a 5xx-status error is NOT passed through — an internal fault keeps the 500 envelope', async () => {
    // Deliberate asymmetry: the passthrough is 4xx-only, so a producer cannot
    // re-label a server fault with a code of its own and slip past the
    // `logError` line that makes it visible to operators.
    const err = Object.assign(new Error('upstream analytics warehouse is unavailable'), {
      code: 'WAREHOUSE_UNAVAILABLE',
      status: 503,
    });
    const route = buildRoute(async () => ({ queryDataset: vi.fn().mockRejectedValue(err) }));
    const res = await post(route, { dataset, selection });

    expect(res.statusCode).toBe(500);
    expect(res.body.code).toBe('ANALYTICS_QUERY_FAILED');
  });

  it('a HALF envelope (4xx status, no code) is not honoured — this route invents no code', async () => {
    // ADR-0112's point is that the PRODUCER names the condition. A status with
    // no code is a producer bug; answering it with a code chosen here would be
    // the consumer-side leniency the ADR exists to remove, and would hide the
    // bug behind a plausible wire shape.
    const err = Object.assign(new Error('something was rejected, unspecified'), { status: 400 });
    const route = buildRoute(async () => ({ queryDataset: vi.fn().mockRejectedValue(err) }));
    const res = await post(route, { dataset, selection });

    expect(res.statusCode).toBe(500);
    expect(res.body.code).toBe('ANALYTICS_QUERY_FAILED');
  });
});

describe('[#5352] the envelope is read generically — not by an allowlist of codes', () => {
  // A code-specific branch (`if (code === 'INVALID_FILTER')`) would be the
  // message-sniffing anti-pattern in new clothes. These two producers already
  // DECLARE their answer in their own doc comments — `INVALID_FIELD`/400 so the
  // analytics face can answer a typo'd measure the way `/data` does (#4437),
  // `CUBE_NOT_FOUND`/404 so "no such cube" does not reach the driver as a table
  // (#3867) — and this route was discarding both.
  it('a measure over a field the object does not have → 400 INVALID_FIELD (#4437)', async () => {
    const err = Object.assign(new Error("Measure 'ghost_sum' on cube 'pipeline' aggregates field 'ghost', which object 'crm_opportunity' does not have."), {
      code: 'INVALID_FIELD',
      status: 400,
    });
    const route = buildRoute(async () => ({ queryDataset: vi.fn().mockRejectedValue(err) }));
    const res = await post(route, { dataset, selection });

    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe('INVALID_FIELD');
  });

  it('an unregistered cube → 404 CUBE_NOT_FOUND (#3867)', async () => {
    const err = Object.assign(new Error("Cube 'nope' not found: no cube is registered under that name."), {
      code: 'CUBE_NOT_FOUND',
      status: 404,
    });
    const route = buildRoute(async () => ({ queryDataset: vi.fn().mockRejectedValue(err) }));
    const res = await post(route, { dataset, selection });

    expect(res.statusCode).toBe(404);
    expect(res.body.code).toBe('CUBE_NOT_FOUND');
  });
});
