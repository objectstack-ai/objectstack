// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#5367, maintainer ruling 2026-08-06] A read-scope lowering failure reaches the
 * caller as a **500 with the RLS policy withheld**, and the full text reaches the
 * operator's log.
 *
 * [#11718] The CODE in that sentence was `ANALYTICS_QUERY_FAILED` and is now
 * `READ_SCOPE_COMPILE_FAILED` — the one these refusals declare. Nothing in the
 * 2026-08-06 ruling moved: the family is still a SERVER fault, still `500`, still
 * has its policy content withheld, and the `400 DATASET_INVALID` it was rescued
 * from is still asserted against below. What changed is that
 * `/analytics/dataset/query` stopped OVERWRITING the producer's declaration with
 * a code of its own. That overwrite was never ruled — it was what ③'s hand-built
 * envelope happened to emit — and it made this face the only one of three that
 * did it: `/data` relays a declared 5xx's status and code (#5582), and the
 * SIBLING analytics face `/analytics/query` has shipped
 * `READ_SCOPE_COMPILE_FAILED` to clients all along
 * (`analytics-query-read-scope-withhold.test.ts`, measured against a real
 * `AnalyticsService`). So this file's answer now equals its sibling's for one
 * refusal, where before the same fault was named two different things depending
 * on which analytics door the caller used.
 *
 * ## What this closes
 *
 * `read-scope-sql.ts`'s ten fail-closed refusals were the last family
 * `/analytics/dataset/query` classified by PROSE — the final entry of #5352's
 * hardcoded substring list, answering `400 DATASET_INVALID`. Two defects in one
 * verdict, and the second is a disclosure:
 *
 * ```
 * POST /analytics/dataset/query        (tenant caller, dataset with an RLS scope)
 * → 400 {"code":"DATASET_INVALID",
 *        "message":"[read-scope-sql] unsafe field identifier \"secret_policy_field\"
 *                   — refusing to build read scope (fail-closed)."}
 * ```
 *
 * The caller never wrote that field name. It comes from an administrator's sharing
 * rule, compiled by the security service — the one document a tenant must not be
 * able to read out of an error body. And `400` told them to fix a request that was
 * never the problem, while keeping the real fault (a broken policy, or drift
 * between two of our own components) out of the 5xx alerting that should have
 * seen it.
 *
 * ## Why the withhold had to be DECLARED, not inherited
 *
 * #5367's dispatch expected these to inherit #5667's
 * `looksLikeInternalErrorLeak` withhold once the 500 landed. Measured, they do
 * not: that predicate is a heuristic over SQL/driver PHRASING (`sqlite_`,
 * `SQLSTATE`, a message that starts as a statement, constraint dumps), and all
 * eleven read-scope message shapes return FALSE from it — `[read-scope-sql] …
 * (fail-closed).` looks nothing like a driver dump. Retiring the message list on
 * its own would therefore have moved the policy content from a 400 body to a 500
 * body rather than out of the response.
 *
 * Widening the heuristic to recognise `[read-scope-sql]` would have been *more*
 * message sniffing — the exact mechanism this issue retires. So the rule is
 * structural instead: **a producer that declares `status >= 500` with a `code` has
 * declared a server fault, and a server fault's detail belongs in the log.** It is
 * a property of the ADR-0112 envelope, not a guess about prose, and it leaves
 * #5667's tiering intact for UNDECLARED 5xx errors — pinned below, because "the
 * withhold got broader" and "the withhold swallowed everything" are one edit apart.
 *
 * ## Why this file boots the REAL analytics service
 *
 * Producer and boundary are different facts, and #5352 was a defect that read as
 * fixed from either side alone. `read-scope-refusal-envelope.test.ts` in
 * `service-analytics` pins that all ten sites declare the envelope; this file
 * makes a real `AnalyticsService` compile a real dataset with a real RLS scope, so
 * the error entering the catch is the one `compileScopedFilterToSql` actually
 * threw.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Logger } from '@objectstack/spec/contracts';
import { AnalyticsService } from '@objectstack/service-analytics';
import { INTERNAL_ERROR_MESSAGE } from '@objectstack/types';
import { RestServer } from './rest-server';

// ── harness (the shape the sibling analytics envelope tests use) ──────────────

function mockServer() {
  return {
    get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(),
    use: vi.fn(), listen: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined),
  };
}
function mockProtocol() {
  return {
    // [#5674] `routes` (ApiRoutesSchema) is what the producer emits and what
    // `DiscoverySchema` requires. This double was copy-pasted from a sibling
    // before #5674 landed and spelled `endpoints` — the dispatcher-only copy of
    // `routes` that #4828 retired under ADR-0049, and which no producer ever
    // emitted. It was inert here (nothing in this file drives discovery), which
    // is exactly why the key kept surviving; `discovery-double-retired-key.test.ts`
    // pins it out of the fixture layer so the next copy-paste cannot regrow it.
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

/**
 * A real `AnalyticsService` on the raw-SQL path whose read scope is `scope`.
 *
 * `getReadScope` is the seam an administrator's policy arrives through: the
 * production bridge resolves it from the security service's `getReadFilter`, i.e.
 * from a sharing rule / permission set the tenant's admin authored. Handing it a
 * shape `read-scope-sql.ts` cannot lower is exactly the live condition.
 */
function analyticsWithScope(scope: unknown): AnalyticsService {
  return new AnalyticsService({
    logger: silent,
    queryCapabilities: () => ({ nativeSql: true, objectqlAggregate: false, inMemory: false }),
    executeRawSql: async () => [{ stage: 'won', revenue: 100 }],
    getReadScope: () => scope as never,
    isRegisteredObject: () => true,
  });
}

const dataset = {
  name: 'pipeline',
  label: 'Pipeline',
  object: 'crm_opportunity',
  dimensions: [{ name: 'stage', field: 'stage', type: 'string' }],
  measures: [{ name: 'revenue', aggregate: 'sum', field: 'amount' }],
};
const selection = { dimensions: ['stage'], measures: ['revenue'] };

// ─────────────────────────────────────────────────────────────────────────────

describe('[#5367] POST /analytics/dataset/query — a read-scope failure is a 500, and says nothing about the policy', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => { logSpy = vi.spyOn(console, 'error').mockImplementation(() => {}); });
  afterEach(() => { logSpy.mockRestore(); });

  /**
   * One row per shape of RLS policy the lowering refuses, each carrying a
   * `secret` — the policy detail the message names and the response must not.
   */
  const CASES: Array<{ name: string; scope: unknown; secret: string }> = [
    {
      name: 'a policy field name the identifier guard refuses',
      scope: { 'secret policy field': 'u1' },
      secret: 'secret policy field',
    },
    {
      name: 'an operator the lowering cannot express',
      scope: { owner_email: { $regex: 'admin@internal' } },
      secret: 'owner_email',
    },
    {
      name: 'a nested / relation value a flat read scope cannot join',
      scope: { approved_by_manager: { manager_id: 'usr_ceo' } },
      secret: 'approved_by_manager',
    },
    {
      name: 'an $in whose comparand is not an array',
      scope: { restricted_region: { $in: 'emea' } },
      secret: 'restricted_region',
    },
    {
      name: 'a combinator whose operand is not an array',
      scope: { $and: { owner_id: 'u1' } },
      secret: '$and',
    },
  ];

  for (const c of CASES) {
    it(`${c.name} → 500 READ_SCOPE_COMPILE_FAILED, body carries no policy detail`, async () => {
      const route = buildRoute(async () => analyticsWithScope(c.scope));
      const res = await post(route, { dataset, selection });

      // Classification: a server fault, not the caller's mistake.
      expect(res.statusCode).toBe(500);
      // [#11718] …named by its PRODUCER. `read-scope-sql` declares
      // `READ_SCOPE_COMPILE_FAILED` / 500 and the route relays it instead of
      // overwriting it with `ANALYTICS_QUERY_FAILED`. The status is untouched
      // by that repair — this family declares 500 — so the 2026-08-06 ruling's
      // own subject is asserted unchanged, immediately above.
      expect(res.body.code).toBe('READ_SCOPE_COMPILE_FAILED');
      expect(res.body.code).not.toBe('ANALYTICS_QUERY_FAILED');
      // …and specifically NOT the pre-ruling answer.
      expect(res.statusCode).not.toBe(400);
      expect(res.body.code).not.toBe('DATASET_INVALID');

      // Disclosure: the policy detail is gone from the body.
      expect(res.body.error).toBe(INTERNAL_ERROR_MESSAGE);
      expect(String(res.body.error)).not.toContain(c.secret);
      expect(String(res.body.error)).not.toMatch(/read-scope-sql/);
      expect(String(res.body.error)).not.toMatch(/fail-closed/);
      // The 4xx body shape must not appear either — `message` is the 4xx field.
      expect(res.body.message).toBeUndefined();

      // …and it is in the LOG, which is now its only destination. Asserted rather
      // than assumed: "withheld" is only acceptable because the operator still
      // has the whole thing.
      const logged = logSpy.mock.calls.map((args: unknown[]) => args.map(String).join(' ')).join('\n');
      expect(logged).toMatch(/Analytics dataset query error/);
      expect(logged).toContain('read-scope-sql');
      expect(logged).toContain(c.secret);
    });
  }

  it('POSITIVE control: a lowerable read scope still scopes the query → 200 with rows', async () => {
    // Without this, every case above could pass for any reason that makes the
    // route 500 — including the read scope never being consulted at all.
    const route = buildRoute(async () => analyticsWithScope({ organization_id: 'org_A' }));
    const res = await post(route, { dataset, selection });
    expect(res.statusCode).toBe(200);
    expect(res.body.rows).toEqual([{ stage: 'won', revenue: 100 }]);
  });

  it('an UNDECLARED 5xx keeps #5667 tiering — a self-authored fault stays readable', async () => {
    // The other side of the declared-withhold rule, and the reason it is scoped to
    // producers that DECLARE a server fault rather than to every 500: a bare
    // `Error` from our own code is the operator's own bug report, carries nothing
    // tenant-sensitive, and #5667 deliberately kept it legible. Widening the
    // withhold to all 500s would delete that decision.
    const route = buildRoute(async () => ({
      queryDataset: vi.fn().mockRejectedValue(
        new Error('[Analytics] no strategy can handle query for cube "pipeline"'),
      ),
    }));
    const res = await post(route, { dataset, selection });
    expect(res.statusCode).toBe(500);
    expect(res.body.code).toBe('ANALYTICS_QUERY_FAILED');
    expect(String(res.body.error)).toMatch(/no strategy can handle query/);
  });

  it('a declared 4xx is still served by the envelope branch — the withhold is 5xx-only', async () => {
    // Guards the seam from the other direction: making 5xx withhold must not have
    // touched the 4xx passthrough, where the message IS the caller's to read
    // (it names their own typo).
    const err = Object.assign(new Error('Unsupported filter operator "$sortOf" on "stage".'), {
      code: 'INVALID_FILTER',
      status: 400,
    });
    const route = buildRoute(async () => ({ queryDataset: vi.fn().mockRejectedValue(err) }));
    const res = await post(route, { dataset, selection });
    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe('INVALID_FILTER');
    expect(String(res.body.message)).toMatch(/\$sortOf/);
  });
});
