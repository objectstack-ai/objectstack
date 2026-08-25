// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#5520] `POST /analytics/dataset/query` — the caller's own view of the
 * dimension source-field gate, and of the SQL echo that rode along with it.
 *
 * Two faults, one caller typo, both visible only from this seam:
 *
 * 1. A selection naming a field the object does not have reached the driver and
 *    came back as a driver error with no envelope, so this route answered
 *    `500 ANALYTICS_QUERY_FAILED`. The service-side gate
 *    (`assertDimensionFields`, pinned in service-analytics'
 *    `dimension-source-field-gate.test.ts`) now rejects it with
 *    `INVALID_FIELD`/400, and #5352's envelope branch carries that verdict
 *    through untouched — which is what the first block asserts END TO END,
 *    because "the service throws the right shape" and "the caller receives it"
 *    are different facts.
 *
 * 2. The 500 body echoed the message verbatim. Knex prefixes the offending
 *    statement to its own message (`<sql> - <cause>`), so the response carried
 *    the generated SQL — physical table and column names included:
 *
 *    ```
 *    {"code":"ANALYTICS_QUERY_FAILED","error":"SELECT bogus_dim AS \"bogus_dim\",
 *      COUNT(*) AS \"account_count\" FROM \"crm_account\" GROUP BY bogus_dim
 *      - no such column: bogus_dim"}
 *    ```
 *
 *    The SIBLING analytics face never leaked it: `/analytics/query` exits
 *    through `dispatcher-plugin.errorResponseBase`, which has applied
 *    `looksLikeInternalErrorLeak` to every >=500 message since #3867 — which is
 *    precisely why the issue's repro ① read `"Internal server error"` while
 *    repro ③ dumped the statement. The second block pins the missing
 *    application of that same shared predicate here. Classification is NOT
 *    touched: the status stays 500, the code stays `ANALYTICS_QUERY_FAILED`,
 *    #5352's envelope branch and the transitional message list are untouched
 *    (#5367 owns that list), and the full text still reaches the operator's log.
 *
 * ## Reverse verification, direction predicted BEFORE running
 *
 * Two independent halves, and they fail in different places:
 *   - Remove `assertDimensionFields` from `ensureCube` → the first block's three
 *     rejection cases go RED (they answer 500 again) and its positive control
 *     stays GREEN. Measured: only TWO went red at first, because the "no
 *     generated SQL" case was satisfied by the OTHER fix — the sanitiser
 *     withheld the driver message, so the body was leak-free without the gate.
 *     That case now also asserts the 400, so each fix is falsifiable on its own;
 *     the mis-prediction is recorded here because it is the whole reason the
 *     second block injects its driver error directly rather than provoking one
 *     through a bogus dimension.
 *   - Restore `error: msg.slice(0, 500)` → the second block's withheld cases go
 *     RED and the first block stays GREEN (a 400 never reaches that branch).
 * Both confirmed by running them (see the PR).
 *
 * Note this file exercises the BUILT `@objectstack/service-analytics`, not its
 * sources: mutating the service without rebuilding it proves nothing here.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Logger } from '@objectstack/spec/contracts';
import { AnalyticsService } from '@objectstack/service-analytics';
import { INTERNAL_ERROR_MESSAGE } from '@objectstack/types';
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
 * way the SQLite/knex one did: the statement prefixed to the cause. That is what
 * made the leak reachable, so the harness reproduces it rather than asserting
 * about a hypothetical message.
 */
function realAnalytics(): AnalyticsService {
  const silent: Logger = { debug() {}, info() {}, warn() {}, error() {} };
  return new AnalyticsService({
    logger: silent,
    queryCapabilities: () => ({ nativeSql: true, objectqlAggregate: false, inMemory: false }),
    executeRawSql: async (_object: string, sql: string) => {
      const bogus = /\bbogus_dim\b/.exec(sql)?.[0];
      if (bogus) throw new Error(`${sql} - no such column: ${bogus}`);
      return [{ industry: 'tech', account_count: 3 }];
    },
    isRegisteredObject: (n: string) => n === 'crm_account',
    getObjectFieldNames: (n: string) => (n === 'crm_account' ? ACCOUNT_FIELDS : undefined),
  });
}

/** A service double whose `queryDataset` throws exactly the given error. */
function throwingAnalytics(error: unknown) {
  return { queryDataset: vi.fn().mockRejectedValue(error) };
}

async function post(route: any, body: unknown) {
  const res = mockRes();
  await route.handler({ method: 'POST', params: {}, headers: {}, body } as any, res);
  return res;
}

/** The generated statement the pre-fix response carried, verbatim from repro ③. */
const LEAKED_SQL =
  'SELECT bogus_dim AS "bogus_dim", COUNT(*) AS "account_count" FROM "crm_account" GROUP BY bogus_dim';

let logged: string[] = [];
let consoleError: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  logged = [];
  consoleError = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    logged.push(args.map((a) => (a instanceof Error ? a.message : String(a))).join(' '));
  });
});
afterEach(() => consoleError.mockRestore());

// ─────────────────────────────────────────────────────────────────────────────

describe('[#5520] a bogus selection dimension answers 400 INVALID_FIELD, end to end', () => {
  it('names the field and the object — and is not a 500 (repro ③)', async () => {
    const route = buildRoute(async () => realAnalytics());
    const res = await post(route, {
      dataset,
      selection: { measures: ['account_count'], dimensions: ['bogus_dim'] },
    });

    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe('INVALID_FIELD');
    // The defect, asserted as the defect rather than as the fix.
    expect(res.statusCode).not.toBe(500);
    expect(res.body.code).not.toBe('ANALYTICS_QUERY_FAILED');
    expect(String(res.body.message)).toMatch(/groups by field 'bogus_dim'/);
    expect(String(res.body.message)).toMatch(/object 'crm_account' does not have/);
  });

  it('carries no generated SQL — because the statement was never built', async () => {
    // Written first as "the body contains no SELECT/GROUP BY" and REJECTED at
    // that: with the gate removed it stayed green, because the message that
    // replaced it was withheld by the sanitiser in the second block. A leak-free
    // body is not evidence of this fix unless the body is also the 400 the gate
    // produces, so the assertion pins BOTH halves of the one claim: the answer
    // is the field-naming 400, and that answer carries no statement.
    const route = buildRoute(async () => realAnalytics());
    const res = await post(route, {
      dataset,
      selection: { measures: ['account_count'], dimensions: ['bogus_dim'] },
    });

    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe('INVALID_FIELD');
    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/SELECT/i);
    expect(body).not.toMatch(/GROUP BY/i);
    expect(body).not.toMatch(/no such column/);
  });

  it('a POSITIVE control: the same wiring with a real field → 200 with rows', async () => {
    // Without this the cases above could pass for any reason that makes the
    // route 400, including a pipeline that never reaches the gate. It also pins
    // the contract the gate must not kill: `phone` is a REAL column that this
    // dataset never declared as a dimension, and it still groups.
    const route = buildRoute(async () => realAnalytics());

    const declared = await post(route, {
      dataset,
      selection: { measures: ['account_count'], dimensions: ['industry'] },
    });
    expect(declared.statusCode).toBe(200);
    expect(declared.body.rows).toEqual([{ industry: 'tech', account_count: 3 }]);

    const undeclaredButReal = await post(route, {
      dataset,
      selection: { measures: ['account_count'], dimensions: ['phone'] },
    });
    expect(undeclaredButReal.statusCode).toBe(200);
  });

  it('a bogus TIME dimension answers the same way, naming that request key', async () => {
    const route = buildRoute(async () => realAnalytics());
    const res = await post(route, {
      dataset,
      selection: {
        measures: ['account_count'],
        dimensions: [],
        timeDimensions: [{ dimension: 'bogus_dim', granularity: 'month' }],
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe('INVALID_FIELD');
  });
});

describe('[#5520] the 500 body no longer ships driver internals', () => {
  it('withholds a message carrying the generated statement, and logs it instead', async () => {
    // The class the gate cannot close: any other driver fault whose message
    // arrives with the statement attached.
    const driverError = new Error(`${LEAKED_SQL} - no such column: bogus_dim`);
    const route = buildRoute(async () => throwingAnalytics(driverError));
    const res = await post(route, { dataset, selection: { measures: ['account_count'], dimensions: ['industry'] } });

    // Classification is unchanged — only the prose is withheld.
    expect(res.statusCode).toBe(500);
    expect(res.body.code).toBe('ANALYTICS_QUERY_FAILED');
    expect(res.body.error).toBe(INTERNAL_ERROR_MESSAGE);
    expect(JSON.stringify(res.body)).not.toContain('crm_account');
    expect(JSON.stringify(res.body)).not.toContain('GROUP BY');

    // The operator keeps the whole diagnostic: after this change the log line is
    // the ONLY copy, which is the reason it is asserted here and not assumed.
    expect(logged.join('\n')).toContain(LEAKED_SQL);
  });

  it('withholds a dialect error code as well (`SQLITE_ERROR`, `SQLSTATE`)', async () => {
    for (const message of [
      'SQLITE_ERROR: no such column: bogus_dim',
      'error: column "bogus_dim" does not exist (SQLSTATE 42703)',
    ]) {
      const route = buildRoute(async () => throwingAnalytics(new Error(message)));
      const res = await post(route, { dataset, selection: { measures: ['account_count'], dimensions: ['industry'] } });

      expect(res.statusCode, message).toBe(500);
      expect(res.body.code, message).toBe('ANALYTICS_QUERY_FAILED');
      expect(res.body.error, message).toBe(INTERNAL_ERROR_MESSAGE);
    }
  });

  it('keeps an ordinary internal fault readable — the narrowing is targeted, not a blanket withhold', async () => {
    // `looksLikeInternalErrorLeak` is a heuristic over the MESSAGE, deliberately
    // not a driver taxonomy, and applying it here must not turn every 500 into
    // an opaque one: a self-authored fault still says what happened. (The 5xx
    // family that withholds unconditionally is #5437's `sendError` path; this
    // route composes its own body and keeps the #3867 tiering.)
    const route = buildRoute(async () =>
      throwingAnalytics(new Error('[Analytics] no strategy can handle query for cube "account_metrics"')),
    );
    const res = await post(route, { dataset, selection: { measures: ['account_count'], dimensions: ['industry'] } });

    expect(res.statusCode).toBe(500);
    expect(res.body.code).toBe('ANALYTICS_QUERY_FAILED');
    expect(String(res.body.error)).toMatch(/no strategy can handle query/);
  });

  it('does not disturb the classification branches #5352 and #5367 own', async () => {
    // ① a producer-declared 4xx envelope still passes through with its own code…
    const enveloped = Object.assign(new Error('Unsupported filter operator "$sortOf" on "stage".'), {
      code: 'INVALID_FILTER',
      status: 400,
    });
    const a = await post(
      buildRoute(async () => throwingAnalytics(enveloped)),
      { dataset, selection: { measures: ['account_count'], dimensions: ['industry'] } },
    );
    expect(a.statusCode).toBe(400);
    expect(a.body.code).toBe('INVALID_FILTER');
    expect(String(a.body.message)).toMatch(/\$sortOf/);

    // …② and so does a dataset refusal, with its message intact.
    //
    // [#5367] This half used to send a BARE `Error` reading "… is not declared
    // in the dataset." and rely on the route's transitional message list to
    // classify it. #5367 enveloped that producer (`dataset-compiler` now throws
    // `datasetInvalidError`) and deleted the list entry, so the same refusal is
    // now carried by branch ① — same outward answer, chosen by reading the error
    // instead of by matching its prose. This change is still 5xx-only.
    const b = await post(
      buildRoute(async () =>
        throwingAnalytics(
          Object.assign(
            new Error('[dataset-compiler] dimension "region" references relationship path "account" via "account.region", but "account" is not declared in the dataset\'s `include`.'),
            { code: 'DATASET_INVALID', status: 400 },
          ),
        ),
      ),
      { dataset, selection: { measures: ['account_count'], dimensions: ['industry'] } },
    );
    expect(b.statusCode).toBe(400);
    expect(b.body.code).toBe('DATASET_INVALID');
    expect(String(b.body.message)).toMatch(/not declared in the dataset/);

    // …③ RE-JUDGED. This half asserted that the one remaining message-list entry
    // still answered 400 for `read-scope-sql`'s bare refusals. The maintainer
    // ruled on 2026-08-06 that the family is a SERVER fault: it now declares
    // `READ_SCOPE_COMPILE_FAILED` / 500, the list is deleted, and — because the
    // messages name RLS policy fields — the 5xx branch withholds the text. So
    // what this half now guards is that #5520's `looksLikeInternalErrorLeak`
    // withhold and #5367's declared-server-fault withhold COMPOSE rather than
    // fight: same 500, message withheld, log intact. [#11718] The CODE on the
    // wire is now the producer's own `READ_SCOPE_COMPILE_FAILED`; the status
    // and the withhold — this half's actual subject — do not move.
    const c = await post(
      buildRoute(async () =>
        throwingAnalytics(
          Object.assign(
            new Error('[read-scope-sql] unsupported operator "$regex" on "owner_email" (fail-closed).'),
            { code: 'READ_SCOPE_COMPILE_FAILED', status: 500 },
          ),
        ),
      ),
      { dataset, selection: { measures: ['account_count'], dimensions: ['industry'] } },
    );
    expect(c.statusCode).toBe(500);
    // [#11718] The declared code is RELAYED rather than overwritten with
    // `ANALYTICS_QUERY_FAILED`. What this half guards is unchanged and is
    // asserted on the next two lines: #5520's `looksLikeInternalErrorLeak`
    // withhold and #5367's declared-server-fault withhold still COMPOSE rather
    // than fight — same 500, message withheld, no policy field in the body.
    expect(c.body.code).toBe('READ_SCOPE_COMPILE_FAILED');
    expect(c.body.error).toBe(INTERNAL_ERROR_MESSAGE);
    expect(String(c.body.error)).not.toMatch(/owner_email/);
  });
});
