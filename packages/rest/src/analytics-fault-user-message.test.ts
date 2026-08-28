// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#12710] `POST /analytics/dataset/query` carries the producer's `userMessage`
 * on the THREE terminals it builds by hand — the ADR-0112 envelope passthrough
 * (①), the declared-fault relay (③a) and the generic `ANALYTICS_QUERY_FAILED`
 * (③b).
 *
 * ## Scope is by ARM, and the arm count was measured here, not inherited
 *
 * The card was filed for the two 5xx terminals and reported this door's
 * classified arm as already correct. Measured on `4af6c4419`, that is true of
 * ONE of its two classified arms and false of the other, so this file pins
 * three arms rather than two:
 *
 * ```text
 * throw { code: 'INVALID_FILTER', status: 400, userMessage: 'Check the filter…' }
 *   ① analytics (rest-server.ts, the `{ code, message }` it builds by hand)
 *                            → 400 {"code":"INVALID_FILTER","message":"…"}   ⛔ no mark
 *   /data door               → 400 {"error":"…","code":"INVALID_FILTER",
 *                                   "userMessage":"Check the filter…"}
 * ```
 *
 * ①b — the arm that re-dresses `classifiedRefusalAnswer`'s body with
 * `...refusalFields` — IS the arm the card measured, and it does carry the mark
 * because that body comes from `resolveErrorResponse`, whose arms already ride
 * it (`withDeclaredUserMessage`, #9934). §5 pins ①b as untouched, so the two
 * classified arms are not flattened into one story in either direction.
 *
 * What ①, ③a and ③b have in common is that none of them holds a classified body
 * to ride on: ① and ③b build their envelope by hand, ③a receives
 * `declaredServerFaultAnswer`'s hand-shaped one and sends it verbatim. So the
 * value comes from `boundedDeclaredUserMessage` (#12693) — the same rule
 * (`declaredUserMessage`'s presence answer with #5423's bound) asked of the RAW
 * thrown error rather than of a classification. §6 pins that the two doors agree
 * on that value.
 *
 * ## Why the repair is at the CALL SITE and not inside `declaredServerFaultAnswer`
 *
 * Censused on `4af6c4419`: that shared function has exactly **two** consumers in
 * `packages/rest/src` —
 *
 *   1. `classifyDataError` (`error-response.ts`), whose only caller is the
 *      exported `mapDataError`, which IS `withDeclaredUserMessage(error,
 *      classifyDataError(…))`. That door already carries the mark, applied one
 *      layer OUT and branch-agnostically over every arm — the shape #9934 chose
 *      deliberately, and the reason the shared body-builder carries no mark of
 *      its own.
 *   2. this route's ③a.
 *
 * So "put the mark in the shared function" would be a no-op duplicate for
 * consumer 1 (its wrapper adds the identical value from the identical helper)
 * and would still miss ① and ③b, which never call that function at all. Moving
 * the mark inward would also split a one-per-door wrapper rule across two
 * layers. The mark stays a door-exit decision; this door's exit is these three
 * arms, and the route resolves it once for all of them.
 *
 * ## Reproduced before it was repaired, on `4af6c4419`
 *
 * One marked producer per arm, driven through the REAL route, against the flat
 * `/data` door (`handleRouteError`) for the identical throw:
 *
 * ```text
 * throw { code: 'READ_SCOPE_COMPILE_FAILED', status: 500, userMessage: '…' }
 *   ③a analytics → 500 {"error":"Internal server error",
 *                       "code":"READ_SCOPE_COMPILE_FAILED"}
 *   /data door   → 500 {"error":"Internal server error",
 *                       "code":"READ_SCOPE_COMPILE_FAILED","userMessage":"…"}
 *
 * throw Error('[Analytics] no strategy can handle query …') + userMessage
 *   ③b analytics → 500 {"code":"ANALYTICS_QUERY_FAILED","error":"no strategy …"}
 *   /data door   → 500 {"code":"INTERNAL_ERROR","userMessage":"…"}
 * ```
 *
 * §4 is that comparison, and it is the reproduction: its `/data` half is the
 * positive control that makes the analytics door's silence a DISAGREEMENT rather
 * than two doors agreeing that the mark does not belong on a fault terminal.
 *
 * ## What reds when the repair is ablated
 *
 * §1, §2, §3, §4 and §6 — every assertion that a MARKED producer's sentence
 * reaches the body. §5's ABSENCE assertions stay green, deliberately and by
 * construction: an unrepaired door also emits no `userMessage`. They are the
 * Clause ② criterion (no existing key moves or changes value), not the pin, and
 * an ablation that reds only §5 would mean the pin had stopped measuring.
 *
 * ## Producer census (this door, at claim — ⛔ not inherited from #12693)
 *
 * ZERO in-repo producers can reach these terminals with a mark:
 * `packages/services/**` contains no `userMessage` of any kind (positive
 * controls in the same tree: 102 `code:` hits, 278 `status` hits), and
 * `service-analytics` dispatches no sandbox hook (positive control: 1013
 * `await ` hits), so the QuickJS side-channel — the other in-repo carrier — does
 * not reach here either. This is a DECLARED channel that was not wired up at
 * these three arms, not a report that anyone is being harmed today. The
 * published contract does already promise the field on this door's envelope
 * (`content/docs/references/api/analytics.mdx`, `ApiError.userMessage`), and the
 * intended producer is an out-of-repo one: an app author's analytics datasource
 * or strategy.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { INTERNAL_ERROR_MESSAGE } from '@objectstack/types';
import { RestServer } from './rest-server';
import { handleRouteError } from './error-response.js';

// ── harness (the shape the sibling analytics envelope tests use) ──────────────

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

/** The REAL `/analytics/dataset/query` route, with a provider that rejects. */
function buildRoute(rejectWith: unknown) {
  const rest = new RestServer(
    mockServer() as any, mockProtocol() as any, { api: { requireAuth: false } } as any,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined,
    async () => ({ queryDataset: vi.fn().mockRejectedValue(rejectWith) }),
  );
  (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
  rest.registerRoutes();
  return rest.getRoutes().find((r) => r.method === 'POST' && r.path.endsWith('/analytics/dataset/query'))!;
}

const dataset = {
  name: 'pipeline',
  label: 'Pipeline',
  object: 'crm_opportunity',
  dimensions: [{ name: 'stage', field: 'stage', type: 'string' }],
  measures: [{ name: 'revenue', aggregate: 'sum', field: 'amount' }],
};
const selection = { dimensions: ['stage'], measures: ['revenue'] };

/** Drive the analytics door with a producer that throws `error`. */
async function analyticsDoor(error: unknown) {
  const route = buildRoute(error);
  const res = mockRes();
  await route.handler({ method: 'POST', params: {}, headers: {}, body: { dataset, selection } } as any, res);
  return { status: res.statusCode as number, body: res.body as Record<string, unknown> };
}

/** The wire answer the flat `/data` door gives for the same error. */
function dataDoor(error: unknown) {
  const res = mockRes();
  handleRouteError(res, error);
  return { status: res.statusCode as number, body: res.body as Record<string, unknown> };
}

const MARK = 'Ask an admin to review the dataset read policy.';
const FILTER_MARK = 'Check the filter on the "stage" column.';

/** A producer that marked its refusal, with a declared server fault. */
function declaredMarked(extra: Record<string, unknown> = {}) {
  return Object.assign(
    new Error('[read-scope-sql] unsafe field identifier "secret_policy_field" — refusing to build read scope (fail-closed).'),
    { code: 'READ_SCOPE_COMPILE_FAILED', status: 500, userMessage: MARK, ...extra },
  );
}

let logSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => { logSpy = vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => { logSpy.mockRestore(); });

// ─────────────────────────────────────────────────────────────────────────────
// §1 arm ① — the ADR-0112 envelope this route re-shapes by hand
// ─────────────────────────────────────────────────────────────────────────────

describe('[#12710] §1 ① — a declared 4xx envelope carries the mark', () => {
  it('a declared 400 with a registered code', async () => {
    const err = Object.assign(new Error('Unsupported filter operator "$sortOf" on "stage".'), {
      code: 'INVALID_FILTER', status: 400, userMessage: FILTER_MARK,
    });
    const { status, body } = await analyticsDoor(err);
    expect(status).toBe(400);
    expect(body.code).toBe('INVALID_FILTER');
    // ①'s own dialect — `message`, not `error` — is untouched by this card.
    expect(String(body.message)).toMatch(/\$sortOf/);
    expect(body.userMessage).toBe(FILTER_MARK);
  });

  it('a declared 404 too — the arm is status-agnostic across the 4xx band', async () => {
    const err = Object.assign(new Error('Cube "pipeline" is not registered.'), {
      code: 'CUBE_NOT_FOUND', status: 404, userMessage: 'That report was removed. Pick another from the list.',
    });
    const { status, body } = await analyticsDoor(err);
    expect(status).toBe(404);
    expect(body.code).toBe('CUBE_NOT_FOUND');
    expect(body.userMessage).toBe('That report was removed. Pick another from the list.');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 arm ③a — the DECLARED 5xx relay
// ─────────────────────────────────────────────────────────────────────────────

describe('[#12710] §2 ③a — a relayed declared server fault carries the mark', () => {
  it('a declared 500 with a registered code', async () => {
    const { status, body } = await analyticsDoor(declaredMarked());
    expect(status).toBe(500);
    expect(body.code).toBe('READ_SCOPE_COMPILE_FAILED');
    expect(body.userMessage).toBe(MARK);
    // ⛔ the mark never buys the PROSE past #5437's withhold.
    expect(body.error).toBe(INTERNAL_ERROR_MESSAGE);
    expect(String(body.error)).not.toContain('secret_policy_field');
    // …and the withheld text still reaches the operator.
    const logged = logSpy.mock.calls.map((a: unknown[]) => a.map(String).join(' ')).join('\n');
    expect(logged).toContain('secret_policy_field');
  });

  it('a declared 503 — the relay #11718 exists for — keeps status, code and mark', async () => {
    const err = Object.assign(new Error('warehouse connection reset'), {
      code: 'SERVICE_UNAVAILABLE', status: 503, userMessage: 'The warehouse is restarting; retry in a minute.',
    });
    const { status, body } = await analyticsDoor(err);
    expect(status).toBe(503);
    expect(body.code).toBe('SERVICE_UNAVAILABLE');
    expect(body.userMessage).toBe('The warehouse is restarting; retry in a minute.');
  });

  it('a HALF declaration — 5xx status, no code — relays the status and the mark, and invents no code', async () => {
    // `declaredServerFaultAnswer`'s gate is `declaredHttpStatus >= 500`, NOT
    // `declaresServerFault`, and that difference is load-bearing (its docblock).
    // The mark rides the same arm, so the two halves of the envelope stay
    // independent: nothing is invented for the half that was not declared.
    const err = Object.assign(new Error('warehouse connection reset'), {
      status: 503, userMessage: 'The warehouse is restarting; retry in a minute.',
    });
    const { status, body } = await analyticsDoor(err);
    expect(status).toBe(503);
    expect(body.code).toBeUndefined();
    expect(body.userMessage).toBe('The warehouse is restarting; retry in a minute.');
  });

  it('an UNREGISTERED declared code still demotes (#9232) and still carries the mark', async () => {
    const { status, body } = await analyticsDoor(declaredMarked({ code: 'WAREHOUSE_UNAVAILABLE', status: 503 }));
    expect(status).toBe(503);
    expect(body.declaredCode).toBe('WAREHOUSE_UNAVAILABLE');
    expect(body.userMessage).toBe(MARK);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 arm ③b — the generic 500 for a fault nobody declared
// ─────────────────────────────────────────────────────────────────────────────

describe('[#12710] §3 ③b — the generic ANALYTICS_QUERY_FAILED carries the mark', () => {
  it('an undeclared fault that marked a sentence', async () => {
    const err = Object.assign(new Error('[Analytics] no strategy can handle query for cube "pipeline"'), {
      userMessage: 'This report is unavailable right now — ask an admin to check the dataset.',
    });
    const { status, body } = await analyticsDoor(err);
    expect(status).toBe(500);
    // ⛔ The mark moves neither the status nor the code, and #5667's tiering —
    // a self-authored fault stays readable — is untouched.
    expect(body.code).toBe('ANALYTICS_QUERY_FAILED');
    expect(String(body.error)).toMatch(/no strategy can handle query/);
    expect(body.userMessage).toBe('This report is unavailable right now — ask an admin to check the dataset.');
  });

  it('…and a marked fault whose prose IS withheld still carries the sentence', async () => {
    // The withhold arm of ③b: `declaresServerFault` true for a `status: 700`
    // that `declaredHttpStatus`'s <600 bound keeps out of ③a → generic prose.
    const err = Object.assign(new Error('SQLSTATE[42P01]: relation "crm_opportunity" does not exist'), {
      code: 'WAREHOUSE_FAULT', status: 700, userMessage: MARK,
    });
    const { status, body } = await analyticsDoor(err);
    expect(status).toBe(500);
    expect(body.code).toBe('ANALYTICS_QUERY_FAILED');
    expect(body.error).toBe(INTERNAL_ERROR_MESSAGE);
    expect(body.userMessage).toBe(MARK);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 door-to-door — the reproduction
// ─────────────────────────────────────────────────────────────────────────────

describe('[#12710] §4 both doors carry the same producer mark for the same throw', () => {
  const CASES: Array<{ name: string; error: () => unknown; mark: string }> = [
    {
      name: '① declared 400',
      error: () => Object.assign(new Error('Unsupported filter operator "$sortOf" on "stage".'), {
        code: 'INVALID_FILTER', status: 400, userMessage: FILTER_MARK,
      }),
      mark: FILTER_MARK,
    },
    { name: '③a declared 500', error: () => declaredMarked(), mark: MARK },
    {
      name: '③b undeclared fault',
      error: () => Object.assign(new Error('[Analytics] no strategy can handle query for cube "pipeline"'), { userMessage: MARK }),
      mark: MARK,
    },
  ];

  for (const c of CASES) {
    it(`${c.name}: analytics door and /data door both carry it`, async () => {
      const flat = dataDoor(c.error());
      // POSITIVE CONTROL — without this the analytics assertion below could pass
      // for the wrong reason (two doors agreeing the mark does not belong on
      // this terminal). #9934 rules that it does; `/data` is where that ruling
      // already lives.
      expect(
        flat.body.userMessage,
        `positive control — the /data door must carry the mark: ${JSON.stringify(flat.body)}`,
      ).toBe(c.mark);
      const analytics = await analyticsDoor(c.error());
      expect(
        analytics.body.userMessage,
        `the analytics door dropped the producer's userMessage: ${JSON.stringify(analytics.body)}`,
      ).toBe(c.mark);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 the Clause ② criterion, and the arm that was already right
// ─────────────────────────────────────────────────────────────────────────────

describe('[#12710] §5 no existing key moves or changes value', () => {
  it('① for an UNMARKED producer — byte-identical to before', async () => {
    const err = Object.assign(new Error('Unsupported filter operator "$sortOf" on "stage".'), {
      code: 'INVALID_FILTER', status: 400,
    });
    const { status, body } = await analyticsDoor(err);
    expect(status).toBe(400);
    expect(Object.keys(body)).toEqual(['code', 'message']);
    expect(body).toEqual({ code: 'INVALID_FILTER', message: 'Unsupported filter operator "$sortOf" on "stage".' });
  });

  it('③a for an UNMARKED producer — byte-identical to before', async () => {
    const err = Object.assign(new Error('[read-scope-sql] unsafe field identifier (fail-closed).'), {
      code: 'READ_SCOPE_COMPILE_FAILED', status: 500,
    });
    const { status, body } = await analyticsDoor(err);
    expect(status).toBe(500);
    expect(Object.keys(body)).toEqual(['error', 'code']);
    expect(body).toEqual({ error: INTERNAL_ERROR_MESSAGE, code: 'READ_SCOPE_COMPILE_FAILED' });
  });

  it('③b for an UNMARKED producer — byte-identical to before', async () => {
    const { status, body } = await analyticsDoor(new Error('[Analytics] no strategy can handle query for cube "pipeline"'));
    expect(status).toBe(500);
    expect(Object.keys(body)).toEqual(['code', 'error']);
    expect(body).toEqual({
      code: 'ANALYTICS_QUERY_FAILED',
      error: '[Analytics] no strategy can handle query for cube "pipeline"',
    });
  });

  it('a blank or non-string mark is NOT a declaration — no arm invents a key', async () => {
    const a = await analyticsDoor(declaredMarked({ userMessage: '   ' }));
    expect(a.body.userMessage).toBeUndefined();
    const b = await analyticsDoor(Object.assign(new Error('no strategy'), { userMessage: 42 }));
    expect(b.body.userMessage).toBeUndefined();
    const c = await analyticsDoor(Object.assign(new Error('bad filter'), {
      code: 'INVALID_FILTER', status: 400, userMessage: '',
    }));
    expect(c.body.userMessage).toBeUndefined();
  });

  it('arm ①b was already right and is NOT touched by this repair', async () => {
    // ①b is the arm the card measured: it re-dresses `classifiedRefusalAnswer`'s
    // body, which already rides the mark. Reached here by the `statusCode`
    // spelling (#7525), which ①'s `error.status`-only read cannot see. A repair
    // that reached this arm would be one rule applied twice.
    const err = Object.assign(new Error('Unsupported filter operator "$sortOf" on "stage".'), {
      code: 'INVALID_FILTER', statusCode: 400, userMessage: FILTER_MARK,
    });
    const { status, body } = await analyticsDoor(err);
    expect(status).toBe(400);
    expect(body.code).toBe('INVALID_FILTER');
    expect(body.userMessage).toBe(FILTER_MARK);
    // …and the mark appears exactly once, from ①b's own spread.
    expect(Object.keys(body).filter((k) => k === 'userMessage')).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §6 one rule, not two agreeing copies
// ─────────────────────────────────────────────────────────────────────────────

describe('[#12710] §6 the two doors agree on the VALUE, bound included', () => {
  it('a mark past #5423 bound is truncated identically at both doors', async () => {
    const long = 'x'.repeat(900);
    const err = () => Object.assign(new Error('warehouse down'), {
      code: 'SERVICE_UNAVAILABLE', status: 503, userMessage: long,
    });
    const flat = dataDoor(err());
    const analytics = await analyticsDoor(err());
    expect(typeof flat.body.userMessage).toBe('string');
    expect((flat.body.userMessage as string).length).toBeLessThan(long.length);
    expect(analytics.body.userMessage).toBe(flat.body.userMessage);
  });
});
