// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#5669] `POST /analytics/dataset/query` — the caller's own view of the `where`
 * source-field gate.
 *
 * The third and last param of the defect #4437 (measures) and #5520 (dimensions)
 * closed one key at a time. A filter naming a field the object does not have
 * reached the driver, came back as a driver error with no envelope, and this
 * route answered `500 ANALYTICS_QUERY_FAILED` for what is a plain typo — the
 * same classification fault, on the request key most likely to carry a
 * hand-typed field name. Measured on this harness against `origin/main`:
 *
 * ```
 * {"dataset":…,"selection":{"measures":["account_count"],"runtimeFilter":{"bogus_col":"x"}}}
 *   → SELECT COUNT(*) AS "account_count" FROM "crm_account" WHERE bogus_col = $1
 *   → 500 ANALYTICS_QUERY_FAILED
 * ```
 *
 * Why this file exists next to the service-side pin
 * (`service-analytics`'s `where-source-field-gate.test.ts`): "the service throws
 * the right shape" and "the caller receives it" are different facts, separated by
 * this route's catch. The gate needs no rest-layer change at all — #5352's
 * envelope branch ① reads `code` + 4xx `status` and carries the verdict through —
 * and that is precisely the claim worth pinning end to end, because it is a
 * claim about a seam neither side's unit tests cross. So the provider here is a
 * REAL `AnalyticsService` whose driver double fails the way SQLite/knex does
 * (statement prefixed to the cause), not a mock that would assume half the seam.
 *
 * `runtimeFilter` is the load-bearing input for the same reason
 * `analytics-filter-refusal-envelope.test.ts` uses it: it is the
 * presentation-scope filter a dashboard widget carries, i.e. exactly the field
 * an author typos.
 *
 * ## Reverse verification, direction predicted BEFORE running
 *
 * Remove the three `assertWhereFields` calls from `ensureCube` and rebuild
 * `@objectstack/service-analytics` (this file exercises the BUILT package —
 * mutating sources without rebuilding proves nothing here): the three rejection
 * cases go RED, answering `500 ANALYTICS_QUERY_FAILED` again, while the positive
 * control and the `INVALID_FILTER` case — neither of which this gate produces —
 * stay GREEN. Ordinary direction. Predicted 3 red / 2 green; measured exactly
 * that, each red reading `expected 500 to be 400`.
 *
 * Note the "carries no generated SQL" case asserts the 400 as well as the
 * absence of a statement — #5520's file records why: with the gate gone, a
 * leak-free body proves nothing on its own, because the sibling fix (#5520's
 * sanitiser on the 500 branch) withholds the driver message anyway. Each fix
 * must be falsifiable on its own.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Logger } from '@objectstack/spec/contracts';
import { AnalyticsService } from '@objectstack/service-analytics';
import { RestServer } from './rest-server';

// ── harness (the shape the two sibling analytics rest tests use) ─────────────

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

/** The dataset from the issue's repro — one declared dimension, one measure. */
const dataset = {
  name: 'account_metrics',
  label: 'Account metrics',
  object: 'crm_account',
  dimensions: [{ name: 'industry', field: 'industry', type: 'string' }],
  measures: [{ name: 'account_count', aggregate: 'count' }],
};

const ACCOUNT_FIELDS = ['id', 'name', 'phone', 'industry', 'annual_revenue'];

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
 * A REAL `AnalyticsService` on the native-SQL path whose driver double fails the
 * way the SQLite/knex one does: the statement prefixed to the cause. That is
 * what made the pre-fix 500 body carry the generated SQL, so the harness
 * reproduces it rather than asserting about a hypothetical message.
 */
function realAnalytics(): AnalyticsService {
  const silent: Logger = { debug() {}, info() {}, warn() {}, error() {} };
  return new AnalyticsService({
    logger: silent,
    queryCapabilities: () => ({ nativeSql: true, objectqlAggregate: false, inMemory: false }),
    executeRawSql: async (_object: string, sql: string) => {
      const bogus = /\b(bogus_col|dropped_column)\b/.exec(sql)?.[0];
      if (bogus) throw new Error(`${sql} - no such column: ${bogus}`);
      return [{ industry: 'tech', account_count: 3 }];
    },
    isRegisteredObject: (n: string) => n === 'crm_account',
    getObjectFieldNames: (n: string) => (n === 'crm_account' ? ACCOUNT_FIELDS : undefined),
  });
}

async function post(route: any, body: unknown) {
  const res = mockRes();
  await route.handler({ method: 'POST', params: {}, headers: {}, body } as any, res);
  return res;
}

let consoleError: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => consoleError.mockRestore());

// ─────────────────────────────────────────────────────────────────────────────

describe('[#5669] a bogus `where` field answers 400 INVALID_FIELD, end to end', () => {
  it('names the field and the object — and is not a 500', async () => {
    const route = buildRoute(async () => realAnalytics());
    const res = await post(route, {
      dataset,
      selection: { measures: ['account_count'], runtimeFilter: { bogus_col: 'x' } },
    });

    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe('INVALID_FIELD');
    // The defect, asserted as the defect rather than as the fix.
    expect(res.statusCode).not.toBe(500);
    expect(res.body.code).not.toBe('ANALYTICS_QUERY_FAILED');
    expect(String(res.body.message)).toMatch(/Filter member 'bogus_col' in 'where'/);
    expect(String(res.body.message)).toMatch(/object 'crm_account' does not have/);
  });

  it('carries no generated SQL — because the statement was never built', async () => {
    const route = buildRoute(async () => realAnalytics());
    const res = await post(route, {
      dataset,
      selection: { measures: ['account_count'], runtimeFilter: { bogus_col: 'x' } },
    });

    // BOTH halves of the one claim: the answer is the field-naming 400, and that
    // answer carries no statement. See the header for why the second alone is
    // not evidence.
    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe('INVALID_FIELD');
    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/SELECT/i);
    expect(body).not.toMatch(/FROM \\"/);
    expect(body).not.toMatch(/no such column/);
  });

  it('answers the same way for a DATASET-declared filter over a dropped column', async () => {
    // The authored half of the same mistake: a dataset whose object dropped a
    // column its own declared `filter` still names.
    const route = buildRoute(async () => realAnalytics());
    const res = await post(route, {
      dataset: { ...dataset, filter: { dropped_column: 'x' } },
      selection: { measures: ['account_count'] },
    });

    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe('INVALID_FIELD');
    expect(String(res.body.message)).toMatch(/constrains field 'dropped_column'/);
  });

  it('a POSITIVE control: the same wiring with real fields → 200 with rows', async () => {
    // Without this the cases above could pass for any reason that makes the route
    // 400, including a pipeline that never reaches the gate. It also pins the
    // contract the gate must not kill: `phone` is a REAL column this dataset
    // never declared as a dimension, and filtering on it still works.
    const route = buildRoute(async () => realAnalytics());

    const declared = await post(route, {
      dataset,
      selection: { measures: ['account_count'], dimensions: ['industry'], runtimeFilter: { industry: 'tech' } },
    });
    expect(declared.statusCode).toBe(200);
    expect(declared.body.rows).toEqual([{ industry: 'tech', account_count: 3 }]);

    const undeclaredButReal = await post(route, {
      dataset,
      selection: { measures: ['account_count'], runtimeFilter: { phone: '555' } },
    });
    expect(undeclaredButReal.statusCode).toBe(200);
  });

  it('does not disturb the INVALID_FILTER family #5352 / #5367 own', async () => {
    // A structurally-invalid filter is a DIFFERENT verdict from a
    // field-that-does-not-exist, and both must keep their own code: the gate
    // stands down on a `where` the normalizer refuses, so `INVALID_FILTER` still
    // comes from where it always did.
    const route = buildRoute(async () => realAnalytics());
    const res = await post(route, {
      dataset,
      selection: { measures: ['account_count'], runtimeFilter: { industry: { $sortOf: 'tech' } } },
    });

    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe('INVALID_FILTER');
    expect(String(res.body.message)).toMatch(/\$sortOf/);
  });
});
