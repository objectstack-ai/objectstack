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
 *   1. ~~The message list still classifies the families that carry no envelope.~~
 *      **Retired.** #5352 left six entries here; #5367 enveloped all six
 *      producers and deleted every entry — five as `DATASET_INVALID` / 400 and,
 *      after the maintainer's 2026-08-06 ruling, `read-scope-sql`'s ten as
 *      `READ_SCOPE_COMPILE_FAILED` / 500. The block near the bottom of this file
 *      pins each deletion in both directions, which is now the only thing
 *      standing between this catch and a fresh message test.
 *   2. A genuine internal fault must still be a 500 with its `logError` line —
 *      "read the envelope" must not become "call everything a 400".
 *   3. A 5xx-status error is NOT passed through, so an internal fault can never
 *      be re-labelled with a code of its own choosing.
 */

import { describe, it, expect, vi } from 'vitest';
import type { Logger } from '@objectstack/spec/contracts';
import { AnalyticsService } from '@objectstack/service-analytics';
import { INTERNAL_ERROR_MESSAGE } from '@objectstack/types';
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
 * `executeAggregate` evaluates the engine-side filter it receives over one
 * fixed bucket, so a query that gets far enough to touch data succeeds — which
 * is what makes the refusal cases meaningful: they fail on the FILTER, on a
 * route that demonstrably answers 200 otherwise. It is filter-AWARE (not a
 * constant) so the #5322 identity cases are load-bearing too: the zero-row
 * constant — `{$not: {}}`, the spelling `filterNodeToCondition` emits for
 * FALSE — must come back as 200 with NO rows, distinguishable from both a 400
 * and from an ignored filter.
 */
function realAnalytics(): AnalyticsService {
  const silent: Logger = { debug() {}, info() {}, warn() {}, error() {} };
  const bucket = { stage: 'won', revenue: 100 };
  const matches = (cond: Record<string, unknown>): boolean =>
    Object.entries(cond).every(([key, value]) => {
      if (key === '$and') return (value as Record<string, unknown>[]).every(matches);
      if (key === '$or') return (value as Record<string, unknown>[]).some(matches);
      if (key === '$not') return !matches(value as Record<string, unknown>);
      if (value !== null && typeof value === 'object' && '$eq' in (value as object)) {
        return (bucket as Record<string, unknown>)[key] === (value as { $eq: unknown }).$eq;
      }
      return (bucket as Record<string, unknown>)[key] === value;
    });
  return new AnalyticsService({
    logger: silent,
    queryCapabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }),
    executeAggregate: async (_object: string, options: { filter?: Record<string, unknown> }) =>
      matches(options?.filter ?? {}) ? [{ ...bucket }] : [],
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
      // FLIPPED with the #5322 ruling (2026-08-04): this entry was `{$or: []}`
      // pinning the "requires a non-empty array" refusal. The empty array is
      // now the OR identity — FALSE, zero rows, asserted in the #5322 block
      // below — so the refusal that survives at the same guard site is the
      // non-array spelling, same envelope.
      name: 'an $or that is not an array',
      runtimeFilter: { $or: 'won' },
      message: /"\$or" requires an array of filter objects/,
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

describe('[#5322] empty combinators are boolean identities at the REST face — evaluated, not refused', () => {
  // Until the 2026-08-04 #5322 ruling, `{$or: []}` sat in REFUSALS above and
  // this route answered it 400 ("requires a non-empty array"). The ruling took
  // the identity reduction the five FILTER_LOGIC_CASES backends already gave:
  // these four shapes are ANSWERS now, so each asserts its 200 AND its row
  // semantics — the row count is what separates the two identities from each
  // other and from a filter that was silently dropped.
  const IDENTITIES: Array<{ name: string; runtimeFilter: unknown; rows: unknown[] }> = [
    {
      // FALSE — the OR identity. Zero rows is the fail-closed direction: a
      // disjunct list that looped to zero items hides the data, it does not
      // chart the whole dataset (#5134).
      name: 'an empty $or → the zero-row constant',
      runtimeFilter: { $or: [] },
      rows: [],
    },
    {
      // TRUE — the AND identity: a conjunction of zero conditions constrains
      // nothing, so the bucket comes back.
      name: 'an empty $and → no constraint',
      runtimeFilter: { $and: [] },
      rows: [{ stage: 'won', revenue: 100 }],
    },
    {
      // NOT TRUE ≡ FALSE (#5325's square, crossing this seam).
      name: 'a $not of {} → the zero-row constant',
      runtimeFilter: { $not: {} },
      rows: [],
    },
    {
      // A `{}` disjunct is TRUE and ABSORBS the $or: every row, NOT the
      // narrowed `stage = lost` branch (which would return zero rows here —
      // the bucket is stage 'won' — so absorption and narrowing are
      // distinguishable in this fixture).
      name: 'a {} disjunct absorbs its $or',
      runtimeFilter: { $or: [{ stage: 'lost' }, {}] },
      rows: [{ stage: 'won', revenue: 100 }],
    },
  ];

  for (const c of IDENTITIES) {
    it(`${c.name} → 200, rows ${JSON.stringify(c.rows.length)}`, async () => {
      const route = buildRoute(async () => realAnalytics());
      const res = await post(route, { dataset, selection: { ...selection, runtimeFilter: c.runtimeFilter } });
      expect(res.statusCode).toBe(200);
      expect(res.body.code).toBeUndefined();
      expect(res.body.rows).toEqual(c.rows);
    });
  }
});

describe('[#5352 → #5367] the message-sniffing fallback is GONE', () => {
  // ── The last entry, retired ────────────────────────────────────────────────
  // ⚠️ RE-JUDGED. This case used to read "read-scope-sql: a fail-closed read
  // scope → still 400 DATASET_INVALID by the message list", and the comment
  // above it said the verdict for that family was a separate judgement still
  // pending. The maintainer made it on 2026-08-06 (option B on #5367's decision
  // card): the ten refusals are a SERVER fault, they now declare
  // `READ_SCOPE_COMPILE_FAILED` / 500 themselves, and the list is deleted.
  //
  // So the same input is asserted the other way round — and the bare form, which
  // is what the list used to rescue, is asserted too. Between them they pin that
  // no message test survives anywhere in this catch.
  it('read-scope-sql: the DECLARED 500 → 500 READ_SCOPE_COMPILE_FAILED, policy content withheld', async () => {
    const message = '[read-scope-sql] unsupported operator "$regex" on "owner_email" (fail-closed).';
    const err = Object.assign(new Error(message), { code: 'READ_SCOPE_COMPILE_FAILED', status: 500 });
    const route = buildRoute(async () => ({ queryDataset: vi.fn().mockRejectedValue(err) }));
    const res = await post(route, { dataset, selection });
    expect(res.statusCode).toBe(500);
    // [#11718] The declared code is RELAYED now, not overwritten — see this
    // file's sibling `analytics-read-scope-refusal-envelope.test.ts` header.
    // The status this test is really about is untouched: still 500, still not
    // the sniffed 400 the deleted message list used to produce.
    expect(res.body.code).toBe('READ_SCOPE_COMPILE_FAILED');
    expect(res.body.code).not.toBe('DATASET_INVALID');
    // The disclosure half: an RLS policy's field name must not come back.
    expect(String(res.body.error)).not.toMatch(/owner_email/);
    expect(String(res.body.error)).not.toMatch(/read-scope-sql/);
  });

  it('read-scope-sql: the same message BARE is not sniffed either (500, and readable)', async () => {
    // Bare = no producer declaration. It still lands on 500 because the list is
    // gone, not because anything recognised its prose; and it keeps #5667's
    // tiering, so an undeclared fault stays readable. That difference is the
    // point of making the withhold depend on the DECLARATION.
    const message = '[read-scope-sql] unsupported operator "$regex" on "owner_email" (fail-closed).';
    const route = buildRoute(async () => ({ queryDataset: vi.fn().mockRejectedValue(new Error(message)) }));
    const res = await post(route, { dataset, selection });
    expect(res.statusCode).toBe(500);
    expect(res.body.code).toBe('ANALYTICS_QUERY_FAILED');
    expect(String(res.body.error)).toMatch(/read-scope-sql/);
  });

  // ── The five entries #5367's first PR deleted, pinned in BOTH directions ────
  // These rows used to assert "a bare `Error` with this message → 400", which is
  // precisely the fragility #5367 removed: the status was a property of the
  // wording. Re-asserting it would now be asserting the defect. So each family
  // is pinned twice instead:
  //
  //   - ENVELOPED (what its producer now throws) → 400 `DATASET_INVALID` by ①,
  //     i.e. the same outward answer, reached by reading the error rather than
  //     by matching its prose;
  //   - BARE with the identical message → 500, which is what proves the regex
  //     entry is really gone. Re-adding one turns this half red.
  //
  // The producer end — that these are the messages and envelopes the real
  // `dataset-compiler` / `dataset-executor` / `native-sql-strategy` throw — is
  // pinned in `service-analytics`'s `dataset-refusal-envelope.test.ts`, and the
  // whole path is driven end-to-end in `analytics-dataset-refusal-envelope.test.ts`.
  const RETIRED: Array<{ name: string; message: string }> = [
    {
      name: 'dataset-compiler: undeclared relationship path',
      message: '[dataset-compiler] dimension "region" references relationship path "account" via "account.region", but "account" is not declared in the dataset\'s `include`.',
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
      name: 'dataset-executor: order key that is not selected',
      message: '[dataset-executor] order key(s) "profit" — not a selected dimension or measure. Selectable here: stage, revenue.',
    },
    {
      name: 'dataset-executor: totals grouping outside the selection',
      message: '[dataset-executor] totals grouping [region] is not a subset of the selected dimensions — unknown: region.',
    },
  ];

  for (const c of RETIRED) {
    it(`${c.name} → 400 DATASET_INVALID by its ENVELOPE`, async () => {
      const err = Object.assign(new Error(c.message), { code: 'DATASET_INVALID', status: 400 });
      const route = buildRoute(async () => ({ queryDataset: vi.fn().mockRejectedValue(err) }));
      const res = await post(route, { dataset, selection });
      expect(res.statusCode).toBe(400);
      expect(res.body.code).toBe('DATASET_INVALID');
      expect(String(res.body.message)).toBe(c.message);
    });

    it(`${c.name} → the same message WITHOUT an envelope is no longer sniffed (500)`, async () => {
      const route = buildRoute(async () => ({ queryDataset: vi.fn().mockRejectedValue(new Error(c.message)) }));
      const res = await post(route, { dataset, selection });
      expect(res.statusCode).toBe(500);
      expect(res.body.code).toBe('ANALYTICS_QUERY_FAILED');
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

  it('[#11718 — INVERTED] a declared 5xx IS relayed, and is still logged and still withheld', async () => {
    // ── This pin asserted the collapse. It is inverted, not deleted ─────────
    //
    // What it asserted, verbatim: "a 5xx-status error is NOT passed through —
    // an internal fault keeps the 500 envelope, message withheld", reasoned as
    // "the passthrough is 4xx-only, so a producer cannot re-label a server
    // fault with a code of its own and slip past the `logError` line that makes
    // it visible to operators."
    //
    // That REASON is answered rather than overruled, and answering it is what
    // made the repair safe: `logError` runs BEFORE the relay branch and is
    // unconditional, so every declared 5xx is still on the operator's line with
    // its full original text. Asserted here, not assumed — the argument for the
    // old behaviour is only retired if its concern is actually covered.
    //
    // What was NOT answerable was the collapse itself. `/data` relays a declared
    // 5xx's status and code (#5582: `502`/`503` are `isExpectedDataStatus`
    // lifecycle outcomes proxies and retry policies read differently from a
    // `500`), and so does the sibling `/analytics/query`. Measured door-to-door
    // in `rest-hook-refusal-message-parity.test.ts` §8f.
    const err = Object.assign(new Error('upstream analytics warehouse is unavailable'), {
      code: 'WAREHOUSE_UNAVAILABLE',
      status: 503,
    });
    const route = buildRoute(async () => ({ queryDataset: vi.fn().mockRejectedValue(err) }));
    const logSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    let res: any;
    let logged: string;
    try {
      res = await post(route, { dataset, selection });
      // Read the calls BEFORE restoring: `mockRestore` resets the recorded
      // calls as well as the implementation, so reading after it reports an
      // empty log for a route that logged perfectly well.
      logged = logSpy.mock.calls.map((args) => args.map(String).join(' ')).join('\n');
    } finally {
      logSpy.mockRestore();
    }

    expect(res.statusCode).toBe(503);
    expect(res.statusCode).not.toBe(500);
    // [#9232] `WAREHOUSE_UNAVAILABLE` is not an ADR-0112 member, so it is
    // DEMOTED to `declaredCode` beside the code the status derives — the same
    // answer `/data` gives it, which is the whole point of importing that arm
    // instead of hand-building a second envelope here.
    expect(res.body.code).toBe('SERVICE_UNAVAILABLE');
    expect(res.body.declaredCode).toBe('WAREHOUSE_UNAVAILABLE');
    expect(res.body.code).not.toBe('ANALYTICS_QUERY_FAILED');
    // The operator still has the whole thing — the concern the old pin named.
    expect(logged).toContain('Analytics dataset query error');
    expect(logged).toContain('upstream analytics warehouse is unavailable');
    // [#5367] Second half of the asymmetry, added with the read-scope ruling: a
    // producer that DECLARES a server fault has declared that the detail is the
    // operator's, so the message is withheld here and kept in `logError`. This
    // case is the generic form of the rule the RLS lowering needed — it applies
    // to any declared 5xx, not to a list of recognised phrasings.
    expect(res.body.error).toBe(INTERNAL_ERROR_MESSAGE);
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
