// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#5811] `POST /analytics/query` — a read-scope lowering failure reaches the
 * caller as a 500 **with the RLS policy withheld**, and the full text reaches the
 * operator's log / error reporter.
 *
 * ## What this closes
 *
 * #5367 (maintainer ruling 2026-08-06) made `read-scope-sql.ts`'s ten fail-closed
 * RLS refusals `READ_SCOPE_COMPILE_FAILED` / 500, and taught
 * `/analytics/dataset/query` — served by `@objectstack/rest` — to withhold the
 * message of any producer that DECLARES a server fault. The reason was a
 * disclosure: those messages name the field names and comparands of the sharing
 * rule the tenant is being filtered by.
 *
 * ```
 * [read-scope-sql] unsafe field identifier "secret_policy_field" — refusing to
 * build read scope (fail-closed).
 * ```
 *
 * The caller never wrote that field name — an administrator did, and the security
 * service compiled it. But the SIBLING analytics face was never closed. Both
 * `NativeSQLStrategy.applyReadScope` and `ObjectQLStrategy`'s echoed SQL run
 * `compileScopedFilterToSql`, and both serve `/analytics/query`, which exits
 * through `dispatcher-plugin.errorResponseBase`. That exit's only message guard
 * was `looksLikeInternalErrorLeak` — a heuristic over SQL/driver PHRASING — and
 * measured, all eleven read-scope message shapes return FALSE from it. #5811
 * measured the result at this boundary: **11/11 echoed verbatim**, at 500, with
 * the policy content in `error.message`.
 *
 * ## Why the rule is DECLARED, not sniffed
 *
 * Teaching the heuristic to recognise `[read-scope-sql]` would be more message
 * sniffing — the mechanism #5352/#5367 exist to remove — and it would only ever
 * cover the family someone remembered to add. So #5808's in-line criterion was
 * promoted to `declaresServerFault` in `@objectstack/types`, beside the heuristic
 * it complements, and BOTH boundaries read it. One rule, one implementation
 * (#3843/#3867 paid for the alternative twice).
 *
 * ⛔ It is NOT "withhold every 5xx". #5667 deliberately kept UNDECLARED 5xx
 * legible — a bare `Error` from our own code is the operator's own bug report and
 * names nothing tenant-sensitive. That tiering is pinned below, because "the
 * withhold got broader" and "the withhold swallowed everything" are one edit
 * apart.
 *
 * ⚠️ [#12281] The DECLARED half of that predicate has since widened, and this
 * file's half-envelope case was reversed with it. `declaresServerFault` required
 * a non-empty string `code` beside the 5xx and read the `status` spelling only,
 * so this exit withheld a NARROWER band than `/data`. Ruled 2026-08-27 on #12509
 * (option D): the door now reads `serverFaultProvenance` — "the producer named
 * this 5xx itself", `status ?? statusCode`, with `code` not consulted — and
 * withholds EVERY declared 5xx message. The UNDECLARED tiering below is untouched
 * by that change and is exactly what it must not break.
 *
 * ## Why this file boots the REAL analytics service
 *
 * Producer and boundary are different facts, and a hand-written `Object.assign(new
 * Error(...), { status: 500, code: '…' })` fixture proves only that the boundary
 * withholds what the TEST declared. Here a real `AnalyticsService` compiles a real
 * dataset with a real RLS scope on the real native-SQL path, so the error entering
 * `errorResponseBase` is the one `compileScopedFilterToSql` actually threw — the
 * same discipline `packages/rest`'s `analytics-read-scope-refusal-envelope.test.ts`
 * applies to the sibling face.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Logger } from '@objectstack/spec/contracts';
import { AnalyticsService } from '@objectstack/service-analytics';
import { INTERNAL_ERROR_MESSAGE } from '@objectstack/types';

import { createDispatcherPlugin } from './dispatcher-plugin.js';

// ── harness (the shape `dispatcher-plugin.error-envelope.test.ts` uses) ───────

function makeFakeServer() {
    const handlers: Record<string, (req: any, res: any) => any> = {};
    const rec = (verb: string) => (path: string, handler: any) => {
        handlers[`${verb} ${path}`] = handler;
    };
    return {
        handlers,
        server: {
            get: rec('GET'),
            post: rec('POST'),
            put: rec('PUT'),
            delete: rec('DELETE'),
            patch: rec('PATCH'),
        },
    };
}

function makeCtx(fakeServer: any, analytics: unknown) {
    const kernel = {
        getService: (name: string) => (name === 'analytics' ? analytics : undefined),
        getServiceAsync: async (name: string) => (name === 'analytics' ? analytics : undefined),
    };
    return {
        getKernel: () => kernel,
        getService: (name: string) => (name === 'http.server' ? fakeServer : undefined),
        environmentId: undefined,
        logger: { info() {}, warn() {}, error() {}, debug() {} },
        hook: () => {},
        on: () => {},
    } as any;
}

function makeRes() {
    const res: any = {
        statusCode: undefined as number | undefined,
        body: undefined as any,
        status(c: number) { res.statusCode = c; return res; },
        header() { return res; },
        json(b: any) { res.body = b; return res; },
    };
    return res;
}

/** Drive the REAL `POST /api/v1/analytics/query` route against `analytics`. */
async function postAnalyticsQuery(analytics: unknown, body: unknown) {
    const { server, handlers } = makeFakeServer();
    const plugin = createDispatcherPlugin({ prefix: '/api/v1', securityHeaders: false });
    await plugin.start?.(makeCtx(server, analytics));

    const handler = handlers['POST /api/v1/analytics/query'];
    expect(handler, 'POST /api/v1/analytics/query must be mounted').toBeTypeOf('function');

    const res = makeRes();
    await handler({ body, query: {} }, res);
    return res;
}

const silent: Logger = { debug() {}, info() {}, warn() {}, error() {} };

/**
 * A real `AnalyticsService` on the raw-SQL path whose read scope is `scope`.
 *
 * `getReadScope` is the seam an administrator's policy arrives through: in
 * production it resolves to the security service's `getReadFilter`, i.e. to a
 * sharing rule / permission set the tenant's admin authored. Handing it a shape
 * `read-scope-sql.ts` cannot lower is exactly the live condition, and
 * `NativeSQLStrategy.applyReadScope` calls it for the base table of every query.
 */
function analyticsWithScope(scope: unknown): AnalyticsService {
    const svc = new AnalyticsService({
        logger: silent,
        queryCapabilities: () => ({ nativeSql: true, objectqlAggregate: false, inMemory: false }),
        executeRawSql: async () => [{ stage: 'won', revenue: 100 }],
        getReadScope: () => scope as never,
        isRegisteredObject: () => true,
    });
    // Registering the dataset publishes its Cube, which is what `query({ cube })`
    // resolves — the `/analytics/query` face queries cubes by name.
    svc.registerDataset(dataset as never);
    return svc;
}

const dataset = {
    name: 'pipeline',
    label: 'Pipeline',
    object: 'crm_opportunity',
    dimensions: [{ name: 'stage', field: 'stage', type: 'string' }],
    measures: [{ name: 'revenue', aggregate: 'sum', field: 'amount' }],
};
const query = { cube: 'pipeline', measures: ['revenue'], dimensions: ['stage'] };

// ─────────────────────────────────────────────────────────────────────────────

describe('[#5811] POST /analytics/query — a read-scope failure says nothing about the policy', () => {
    let logSpy: ReturnType<typeof vi.spyOn>;
    beforeEach(() => { logSpy = vi.spyOn(console, 'error').mockImplementation(() => {}); });
    afterEach(() => { logSpy.mockRestore(); });

    /**
     * One row per shape of RLS policy the lowering refuses, each carrying a
     * `secret` — the policy detail the message names and the response must not.
     * Mirrors the sibling face's case table so the two boundaries are pinned
     * against the same inputs.
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
        {
            name: 'a bare array value the lowering refuses to guess at',
            scope: { classified_tier: ['red', 'amber'] },
            secret: 'classified_tier',
        },
    ];

    for (const c of CASES) {
        it(`${c.name} → 500, body carries no policy detail`, async () => {
            const res = await postAnalyticsQuery(analyticsWithScope(c.scope), query);

            // Classification: a server fault, and the producer's code survives.
            expect(res.statusCode).toBe(500);
            expect(res.body.success).toBe(false);
            // [#3842] `errorResponseBase` puts `err.code` in `details`, and the
            // shared builder (`buildApiError` → `splitSemanticCode`) then PROMOTES
            // it into the declared `error.code` field, leaving `details` empty and
            // therefore omitted. So the code a machine reads arrives at
            // `error.code`, not `error.details.code` — asserted where it actually
            // lands, since what matters is that the classification survives the
            // withhold untouched.
            expect(res.body.error.code).toBe('READ_SCOPE_COMPILE_FAILED');

            // Disclosure: the policy detail is gone from the body — asserted over
            // the WHOLE body, not just `message`, because a leak that moved to
            // another key would still be a leak.
            expect(res.body.error.message).toBe(INTERNAL_ERROR_MESSAGE);
            const wire = JSON.stringify(res.body);
            expect(wire).not.toContain(c.secret);
            expect(wire).not.toMatch(/read-scope-sql/);
            expect(wire).not.toMatch(/fail-closed/);

            // …and the untouched error still reaches the operator: the
            // observability wrapper hands `__obsRecordedError` to `errorReporter`.
            // Asserted rather than assumed — "withheld" is only acceptable
            // because the full text is still somewhere.
            const recorded = (res as any).__obsRecordedError;
            expect(String(recorded?.message)).toContain('read-scope-sql');
            expect(String(recorded?.message)).toContain(c.secret);
            expect(recorded?.code).toBe('READ_SCOPE_COMPILE_FAILED');
        });
    }

    it('POSITIVE control: a lowerable read scope still scopes the query → 200 with rows', async () => {
        // Without this, every case above could pass for any reason that makes the
        // route 500 — including the read scope never being consulted at all.
        const res = await postAnalyticsQuery(analyticsWithScope({ organization_id: 'org_A' }), query);
        expect(res.statusCode).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.rows).toEqual([{ stage: 'won', revenue: 100 }]);
    });

    it('an UNDECLARED 5xx keeps #5667 tiering — a self-authored fault stays readable', async () => {
        // The other side of the declared-withhold rule, and the reason it is scoped
        // to producers that DECLARE a server fault rather than to every 500: a bare
        // `Error` from our own code is the operator's own bug report, carries
        // nothing tenant-sensitive, and #5667 deliberately kept it legible.
        // Widening the withhold to all 500s would delete that decision.
        const res = await postAnalyticsQuery(
            { query: async () => { throw new Error('[Analytics] no strategy can handle query for cube "pipeline"'); } },
            query,
        );
        expect(res.statusCode).toBe(500);
        expect(String(res.body.error.message)).toMatch(/no strategy can handle query/);
    });

    it('[#12281] a 5xx with only HALF an envelope is ALSO withheld — a status alone declares it', async () => {
        // ⚠️ REVERSED, deliberately. Until #12281 this case asserted the opposite
        // ("a code is required, not just a status"), on the reasoning that a
        // producer shipping a status without a code "has not declared anything".
        //
        // The maintainer ruled otherwise on #12509, 2026-08-27 (option D),
        // propagated to #12281: `errorResponseBase` adopts the structural
        // withhold for EVERY declared 5xx message, aligning to `/data` — whose
        // `declaredHttpStatus` never looked at `code` at all. Naming a 5xx status
        // IS the declaration; the code is a second, independent channel (#9106),
        // and requiring it here is what left the no-code half of the band on
        // `looksLikeInternalErrorLeak` alone — the phrasing heuristic #5811's own
        // argument found insufficient, which is why the withhold was made
        // structural in the first place.
        //
        // ⛔ This is NOT the consumer-side leniency PD #12 removes: nothing is
        // invented for the half that was not declared. The code channel still
        // reports exactly what the producer spelled (here: nothing, so the
        // status-derived `SERVICE_UNAVAILABLE`), and only the prose is withheld.
        // The full text still reaches the operator through `__obsRecordedError`.
        const err = Object.assign(new Error('analytics engine unavailable'), { status: 503 });
        const res = await postAnalyticsQuery({ query: async () => { throw err; } }, query);
        expect(res.statusCode).toBe(503);
        expect(res.body.error.message).toBe(INTERNAL_ERROR_MESSAGE);
        // The operator still gets the untouched sentence.
        expect(String((res as any).__obsRecordedError?.message)).toBe('analytics engine unavailable');
    });

    it('a DECLARED 4xx is untouched — the withhold is 5xx-only', async () => {
        // The message here names the caller's own typo and is theirs to read.
        // `declaresServerFault` can never reach it (it requires status >= 500),
        // and this pins that at the boundary rather than only in the unit test.
        const err = Object.assign(new Error('Unsupported filter operator "$sortOf" on "stage".'), {
            code: 'INVALID_FILTER',
            status: 400,
        });
        const res = await postAnalyticsQuery({ query: async () => { throw err; } }, query);
        expect(res.statusCode).toBe(400);
        expect(String(res.body.error.message)).toMatch(/\$sortOf/);
        expect(res.body.error.code).toBe('INVALID_FILTER');
    });
});
