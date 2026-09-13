// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#12281] `errorResponseBase` withholds the message of EVERY **declared** 5xx,
 * aligning this exit to `/data` — and still keeps an **undeclared** 5xx legible.
 *
 * ## The ruling this pins
 *
 * Maintainer, 2026-08-27, on #12509 (option D), propagated verbatim to #12281:
 *
 * > `errorResponseBase` adopts the **structural withhold for every declared 5xx
 * > message**, aligning to `/data`'s rule; the author-facing text channel is
 * > `userMessage` (#9934), never the raw message.
 *
 * ## The two axes it closes
 *
 * The predicate this exit used, `declaresServerFault`, is `status >= 500` **and**
 * a non-empty string `code`. `/data`'s `declaredHttpStatus` reads
 * `status ?? statusCode` and does not look at `code` at all. So two bands of
 * declared 5xx were withheld one door over and shipped their prose here:
 *
 *  1. **no `code`** — the card's title case. The structural half of #5811's
 *     withhold required a code, so the no-code half of the declared band fell
 *     back to `looksLikeInternalErrorLeak` alone — the heuristic over SQL/driver
 *     *phrasing* that #5811's own argument found insufficient, which is why the
 *     withhold was made structural in the first place.
 *  2. **the `statusCode` spelling** — wider, and NOT named in the card's body. A
 *     producer declaring `{ statusCode: 503, code: 'SERVICE_UNAVAILABLE' }` is
 *     *fully* ADR-0112-compliant and was still withheld at `/data` and legible
 *     here, purely because `declaresServerFault` read the `status` key only.
 *
 * Both are now one read: `serverFaultProvenance(thrown) === 'declared'`, the
 * shared judgement #12509 landed in `@objectstack/types`, already read by
 * `demotedDeclaredCode` for the code channel. ⛔ Not re-derived at this door —
 * "one rule, every door inherits" is the point of #12509.
 *
 * ## ⛔ Why every case below DRIVES the shape rather than asserting the predicate
 *
 * The #12281 measurement established that the population reaching this door is
 * **EMPTY** today: `metadata-protocol`'s `deleteMetaItem` reaches only the REST
 * `/meta` door (the dispatcher plugin mounts neither `/meta` nor `/data`), and
 * `action-execution.ts`'s seven `statusCode` throws are all caught before this
 * exit. This change is therefore a **no-op on today's tree** — which is exactly
 * why it was the cheapest moment to make it, and exactly why a green suite
 * proves nothing by itself. Nothing here can be established by a passing route
 * test that never reaches the ternary, so every case throws its shape through the
 * REAL mounted `POST /api/v1/analytics/query` route (the throw-transparent
 * instrument `analytics-query-read-scope-withhold.test.ts` established) and reads
 * the answer off the wire.
 *
 * Two controls make each reading falsifiable rather than merely green:
 *
 *  - a **positive control on the same instrument** — this door demonstrably CAN
 *    ship prose (the 4xx case, and the undeclared-5xx case), so "withheld" is a
 *    measured difference and not an instrument that always says the same thing;
 *  - the withheld term is never a substring of any probe's prose, so a case
 *    cannot pass by the two strings accidentally coinciding.
 *
 * ## ⛔ The gate is the DECLARED status, never the resolved one
 *
 * `errorResponseBase`'s own `httpStatus` falls back to **500** for a throw that
 * declared nothing, so a naive `httpStatus >= 500` test would silently delete
 * #5667's undeclared-5xx tiering — a bare `Error` from our own code is the
 * operator's own bug report, names nothing tenant-sensitive, and stays readable.
 * That is the one way this change could do real harm, so it is pinned in both
 * directions below.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { INTERNAL_ERROR_MESSAGE } from '@objectstack/types';

import { createDispatcherPlugin } from './dispatcher-plugin.js';

// ── harness (the shape the sibling withhold test uses) ───────────────────────

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

/**
 * Drive the REAL `POST /api/v1/analytics/query` route with an analytics service
 * that throws `thrown`.
 *
 * The route is throw-transparent — `HttpDispatcher.dispatch`'s foot catch handles
 * `PermissionDenied` and rethrows everything else — so the error reaching
 * `errorResponseBase` is the one this stub actually threw.
 */
async function throwFromAnalyticsQuery(thrown: unknown) {
    const { server, handlers } = makeFakeServer();
    const plugin = createDispatcherPlugin({ prefix: '/api/v1', securityHeaders: false });
    await plugin.start?.(makeCtx(server, { query: async () => { throw thrown; } }));

    const handler = handlers['POST /api/v1/analytics/query'];
    expect(handler, 'POST /api/v1/analytics/query must be mounted').toBeTypeOf('function');

    const res = makeRes();
    await handler({ body: { cube: 'pipeline', measures: ['revenue'] }, query: {} }, res);
    return res;
}

/** A thrown shape carrying `props`, with prose that is not a driver dump. */
function declaring(props: Record<string, unknown>, message: string) {
    return Object.assign(new Error(message), props);
}

// ─────────────────────────────────────────────────────────────────────────────

describe('[#12281] a DECLARED 5xx has its prose withheld at the dispatcher exit', () => {
    let logSpy: ReturnType<typeof vi.spyOn>;
    beforeEach(() => { logSpy = vi.spyOn(console, 'error').mockImplementation(() => {}); });
    afterEach(() => { logSpy.mockRestore(); });

    /**
     * One row per way a producer can DECLARE a 5xx. `secret` is the detail the
     * prose names and the wire must not carry.
     *
     * ⚠️ No probe message contains the withheld string as a substring, so a case
     * cannot pass by coincidence; and none of them *sounds* like a driver dump,
     * so `looksLikeInternalErrorLeak` cannot be what withholds them — the
     * declaration has to be doing the work. Rows 1 and 4 differ ONLY in the
     * presence of `code`; rows 1 and 3 differ ONLY in the status spelling.
     */
    const DECLARED: Array<{ name: string; props: Record<string, unknown>; message: string; secret: string }> = [
        {
            name: 'AXIS 1 — `status`, NO code (the card\'s title case)',
            props: { status: 503 },
            message: 'Upstream warehouse pool exhausted for tenant acme_prod.',
            secret: 'acme_prod',
        },
        {
            name: 'AXIS 2 — `statusCode` WITH a registered code (a fully compliant producer)',
            props: { statusCode: 503, code: 'SERVICE_UNAVAILABLE' },
            message: 'Upstream warehouse pool exhausted for tenant acme_prod.',
            secret: 'acme_prod',
        },
        {
            name: 'BOTH axes at once — `statusCode`, no code',
            props: { statusCode: 503 },
            message: 'Upstream warehouse pool exhausted for tenant acme_prod.',
            secret: 'acme_prod',
        },
        {
            name: 'REGRESSION — `status` WITH a code (what #5811 already withheld)',
            props: { status: 503, code: 'SERVICE_UNAVAILABLE' },
            message: 'Upstream warehouse pool exhausted for tenant acme_prod.',
            secret: 'acme_prod',
        },
        {
            name: 'LIVE SHAPE — `metadata-protocol`\'s deleteMetaItem sentence, {status:500}, no code',
            props: { status: 500 },
            message: 'Failed to delete customization overlay for object/crm_account_secret_overlay.',
            secret: 'crm_account_secret_overlay',
        },
        {
            name: 'LIVE SHAPE — `action-execution`\'s bare `statusCode` throw',
            props: { statusCode: 503 },
            message: 'Data service not available for datasource warehouse_replica_eu.',
            secret: 'warehouse_replica_eu',
        },
        {
            name: 'a declared 5xx above 503 is not special-cased',
            props: { status: 504 },
            message: 'Aggregation timed out against shard shard_finance_07.',
            secret: 'shard_finance_07',
        },
    ];

    for (const c of DECLARED) {
        it(`${c.name} → prose withheld`, async () => {
            const res = await throwFromAnalyticsQuery(declaring(c.props, c.message));

            expect(res.statusCode).toBe(c.props.status ?? c.props.statusCode);
            expect(res.body.success).toBe(false);
            expect(res.body.error.message).toBe(INTERNAL_ERROR_MESSAGE);

            // Asserted over the WHOLE body, not just `message`: a leak that moved
            // to another key would still be a leak.
            const wire = JSON.stringify(res.body);
            expect(wire).not.toContain(c.secret);
            // The probe prose and the withheld string are disjoint, so the
            // assertion above cannot be satisfied by them coinciding.
            expect(c.message).not.toContain(INTERNAL_ERROR_MESSAGE);

            // The classification still travels — only the prose is withheld.
            expect(typeof res.body.error.code).toBe('string');
            expect(res.body.error.code.length).toBeGreaterThan(0);

            // …and the untouched error still reaches the operator through the
            // `__obsRecordedError` side-channel. "Withheld" is only acceptable
            // because the full text is still somewhere.
            expect(String((res as any).__obsRecordedError?.message)).toContain(c.secret);
        });
    }

    it('POSITIVE CONTROL — the same door SHIPS prose on a declared 4xx', async () => {
        // Without this, every case above could pass for a reason that has nothing
        // to do with the withhold — a door that answered `INTERNAL_ERROR_MESSAGE`
        // to everything would satisfy all seven. `serverFaultProvenance` answers
        // `undefined` below 500, so a 4xx is untouched and the caller reads the
        // refusal it is entitled to.
        const res = await throwFromAnalyticsQuery(
            declaring({ status: 409, code: 'RECORD_LOCKED' }, 'Cube pipeline is locked by an in-flight rebuild.'),
        );
        expect(res.statusCode).toBe(409);
        expect(res.body.error.message).toBe('Cube pipeline is locked by an in-flight rebuild.');
        expect(res.body.error.message).not.toBe(INTERNAL_ERROR_MESSAGE);
    });

    it('⛔ an UNDECLARED 5xx keeps #5667 tiering — the gate is the DECLARED status', async () => {
        // The second positive control, and the one that matters most: this is the
        // case a naive `httpStatus >= 500` rewrite would silently delete. The
        // throw declares NO status, so `errorResponseBase`'s own `httpStatus`
        // falls back to 500 — but `serverFaultProvenance` reads `declaredStatus`,
        // which is absent, and answers `'undeclared'`. The prose survives.
        const res = await throwFromAnalyticsQuery(
            new Error('[Analytics] no strategy can handle query for cube "pipeline"'),
        );
        expect(res.statusCode).toBe(500);
        expect(String(res.body.error.message)).toMatch(/no strategy can handle query/);
        expect(res.body.error.message).not.toBe(INTERNAL_ERROR_MESSAGE);
    });

    it('an UNDECLARED 5xx that SOUNDS like a driver dump is still withheld by the heuristic', async () => {
        // The heuristic limb is untouched by this change and still carries the
        // undeclared band. Pinned so a later simplification cannot drop it while
        // the declared limb keeps the suite green.
        const res = await throwFromAnalyticsQuery(
            new Error('SQLITE_ERROR: no such column: crm_account.secret_policy_field'),
        );
        expect(res.statusCode).toBe(500);
        expect(res.body.error.message).toBe(INTERNAL_ERROR_MESSAGE);
        expect(JSON.stringify(res.body)).not.toContain('secret_policy_field');
    });

    it('a declared 4xx with NO code is untouched — the widened rule stays 5xx-only', async () => {
        // `declaresServerFault` could never reach a 4xx because it required
        // `status >= 500`; `serverFaultProvenance` must not either. Pinned
        // because "the withhold got broader" and "the withhold swallowed
        // everything" are one edit apart.
        const res = await throwFromAnalyticsQuery(
            declaring({ status: 422 }, 'Measure revenue is not additive across the stage dimension.'),
        );
        expect(res.statusCode).toBe(422);
        expect(res.body.error.message).toBe('Measure revenue is not additive across the stage dimension.');
    });
});

/**
 * [#16146 / #17153] The ONE exception the prose limb above now has, and the
 * reason this file's seven cases stay red-proof: none of them declares it.
 *
 * ## What changed, and what did not
 *
 * `serverFaultProvenance` answers WHO named this 5xx. It cannot answer WHAT
 * KIND it is, so this exit withheld a deliberate REFUSAL — prose a producer
 * authored FOR its caller — exactly as it withholds a driver fault. The
 * director seat ruled that distinction a producer-side DECLARATION on the
 * published ADR-0112 envelope (decision batch #58, 2026-09-06, option C):
 * `ApiErrorSchema.refusal`, which this exit's own `ErrorResponseSchema` nests.
 *
 * This exit is the THIRD of three arms that withhold on a declaration, and the
 * only one outside `@objectstack/rest`. It reads the same
 * `declaredRefusalMessage` (`@objectstack/types`) the other two read — ⛔ not a
 * second copy, for the reason `dispatcher-plugin.ts:691` already gives about
 * this exact family.
 *
 * ## Every case here is a DIFFERENTIAL against a case above
 *
 * The `DECLARED` table's row 4 (`{ status: 503, code: 'SERVICE_UNAVAILABLE' }`)
 * is the fault twin of the first case below: the two throws differ in exactly
 * one key. That is what makes the reading the field's, rather than the
 * instrument's.
 */
describe('[#16146] …unless the producer DECLARED the 5xx to be a refusal', () => {
    let logSpy: ReturnType<typeof vi.spyOn>;
    beforeEach(() => { logSpy = vi.spyOn(console, 'error').mockImplementation(() => {}); });
    afterEach(() => { logSpy.mockRestore(); });

    /** Prose authored FOR the caller; names nothing tenant-sensitive. */
    const AUTHORED = 'Cube pipeline cannot be rebuilt while a migration holds it. Ask for cube pipeline_v2 instead.';

    it('a DECLARED REFUSAL keeps its prose verbatim — the fault twin one describe up does not', async () => {
        const res = await throwFromAnalyticsQuery(
            declaring({ status: 503, code: 'SERVICE_UNAVAILABLE', refusal: true }, AUTHORED),
        );
        expect(res.statusCode).toBe(503);
        expect(res.body.error.message).toBe(AUTHORED);
        expect(res.body.error.message).not.toBe(INTERNAL_ERROR_MESSAGE);
        // The classification is untouched — only the prose moved.
        expect(typeof res.body.error.code).toBe('string');
        // Disjoint strings, so the assertion cannot be satisfied by coincidence.
        expect(AUTHORED).not.toContain(INTERNAL_ERROR_MESSAGE);
    });

    it('the `statusCode` spelling declares the same refusal — no per-spelling dialect (#7525)', async () => {
        const res = await throwFromAnalyticsQuery(
            declaring({ statusCode: 503, code: 'SERVICE_UNAVAILABLE', refusal: true }, AUTHORED),
        );
        expect(res.statusCode).toBe(503);
        expect(res.body.error.message).toBe(AUTHORED);
    });

    it('⛔ `refusal: true` with NO `code` is not the declared shape — still withheld', async () => {
        // The spec's own table row is `status >= 500`, a `code`, and the flag.
        // Fail-closed: a producer that declares half the shape declares nothing.
        const res = await throwFromAnalyticsQuery(declaring({ status: 503, refusal: true }, AUTHORED));
        expect(res.body.error.message).toBe(INTERNAL_ERROR_MESSAGE);
    });

    it('⛔ `true` is the only value — a guessed spelling declares nothing', async () => {
        for (const value of ['yes', 1, false] as unknown[]) {
            const res = await throwFromAnalyticsQuery(
                declaring({ status: 503, code: 'SERVICE_UNAVAILABLE', refusal: value }, AUTHORED),
            );
            expect(res.body.error.message, `refusal: ${JSON.stringify(value)}`).toBe(INTERNAL_ERROR_MESSAGE);
        }
    });

    it('⛔ SECURITY FLOOR — a refusal cannot buy leaky prose past the heuristic this exit has run since #3867', async () => {
        const res = await throwFromAnalyticsQuery(
            declaring(
                { status: 503, code: 'SERVICE_UNAVAILABLE', refusal: true },
                'SQLITE_ERROR: no such column: crm_account.secret_policy_field',
            ),
        );
        expect(res.body.error.message).toBe(INTERNAL_ERROR_MESSAGE);
        expect(JSON.stringify(res.body)).not.toContain('secret_policy_field');
    });

    it('⛔ the flag QUALIFIES a declared status — it never invents one', async () => {
        // No `status`/`statusCode`: `errorResponseBase`'s own `httpStatus`
        // falls back to 500 and `serverFaultProvenance` answers `'undeclared'`,
        // so #5667's tiering runs and the flag is inert. A leaky message is
        // therefore still withheld by the heuristic limb.
        const res = await throwFromAnalyticsQuery(
            Object.assign(new Error('SQLITE_ERROR: no such column: crm_account.secret_policy_field'), { refusal: true }),
        );
        expect(res.statusCode).toBe(500);
        expect(res.body.error.message).toBe(INTERNAL_ERROR_MESSAGE);
    });

    it('the untouched error still reaches the operator on a relayed refusal', async () => {
        // The withhold's compensation is not lost when the withhold is: the
        // `__obsRecordedError` side-channel still hands `errorReporter` the
        // original throw, so an operator reading a refusal sees the same object
        // they see for a fault.
        const res = await throwFromAnalyticsQuery(
            declaring({ status: 503, code: 'SERVICE_UNAVAILABLE', refusal: true }, AUTHORED),
        );
        expect(String((res as any).__obsRecordedError?.message)).toBe(AUTHORED);
    });
});
