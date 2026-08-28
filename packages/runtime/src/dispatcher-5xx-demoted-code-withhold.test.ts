// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#12509] This package's THREE dispatcher exits inherit ADR-0112's 5xx code
 * scope from the shared resolver — none of them carries a copy of it.
 *
 * ## What was measured on the wire before the change
 *
 * `origin/main` @ `aef1b7e64`, through the REAL route for the exit that has
 * one:
 *
 * ```
 * POST /api/v1/analytics/query, the analytics service throws
 *   { code: 'SQLITE_ERROR' } → 500 {"error":{"code":"INTERNAL_ERROR",
 *       "message":"Internal server error","httpStatus":500,
 *       "declaredCode":"SQLITE_ERROR"}}
 *   { code: '42P01' }        → 500 {…,"declaredCode":"42P01"}
 * ```
 *
 * ⭐ That measurement is also the ruling's FIRST named reading, answered: the
 * card's premise was that a driver errno cannot reach a producing seam, and
 * that had been measured at `PackageService`'s four seams ONLY — where the
 * service discriminates on the STATUS channel, so a driver fault is converted
 * to a declared `503 SERVICE_UNAVAILABLE` and never demotes. This door has no
 * such producer in front of it. `errorResponseBase` catches whatever the
 * service threw and resolves it directly, so a coded driver fault reaches the
 * wire verbatim in `declaredCode`. **The premise does not hold here** — which
 * is what makes the ruling a repair rather than a tidy-up.
 *
 * ## Why no line changes at the exits
 *
 * All three read `demotedDeclaredCode(thrown)` and emit what it answers. The
 * ruling put the judgement inside that function, so the exits inherit it.
 * Section 3 compares each exit's body against the shared function itself, so
 * an exit that ever grew a rule of its own turns red. ⛔ Do not "fix" a red
 * there by teaching an exit the condition — that is the per-door variant the
 * 2026-08-27 ruling declined by name.
 *
 * ## What is deliberately NOT touched here
 *
 * The MESSAGE. `errorResponseBase` still withholds on `declaresServerFault`
 * (which needs a string code) rather than on every declared 5xx; aligning it
 * to `/data` is the same ruling's prose axis and it is #12281's card, with its
 * own measurement-first step. Section 4 pins the message behaviour AS IT
 * STANDS so that card's change is visible as a change rather than as a silent
 * drift, and names what will move.
 */

import { describe, it, expect, vi } from 'vitest';
import { ApiErrorSchema, BaseResponseSchema, envelopeViolations } from '@objectstack/spec/api';
import { resolveThrownHttpError, demotedDeclaredCode, INTERNAL_ERROR_MESSAGE } from '@objectstack/types';
import { HttpDispatcher } from './http-dispatcher.js';
import type { DomainHandlerDeps } from './domain-handler-registry.js';
import { endpointErrorAnswer } from './endpoint-executor.js';
import { createDispatcherPlugin } from './dispatcher-plugin.js';

/** The REAL exit `domains/*.ts` calls, reached through the dispatcher's own seam. */
const errorFromThrown: DomainHandlerDeps['errorFromThrown'] = (() => {
    const dispatcher: any = new HttpDispatcher({ context: { getService: () => null } } as any);
    return (dispatcher.domainDeps as DomainHandlerDeps).errorFromThrown;
})();

/** A producer's throw, carrying whatever it declares. */
function thrown(message: string, carried: Record<string, unknown>): Error {
    return Object.assign(new Error(message), carried);
}

// --- the third exit, driven through its real HTTP route ---------------------

function makeFakeServer() {
    const handlers: Record<string, (req: any, res: any) => any> = {};
    const rec = (verb: string) => (path: string, handler: any) => { handlers[`${verb} ${path}`] = handler; };
    return {
        handlers,
        server: { get: rec('GET'), post: rec('POST'), put: rec('PUT'), delete: rec('DELETE'), patch: rec('PATCH') },
    };
}

function makeCtx(fakeServer: any, analyticsError: unknown) {
    const analytics = {
        query: async () => { throw analyticsError; },
        getMeta: async () => ({ cubes: [] }),
        generateSql: async () => ({ sql: null }),
    };
    const kernel = {
        getService: (n: string) => (n === 'analytics' ? analytics : undefined),
        getServiceAsync: async (n: string) => (n === 'analytics' ? analytics : undefined),
    };
    return {
        getKernel: () => kernel,
        getService: (n: string) => (n === 'http.server' ? fakeServer : undefined),
        environmentId: undefined,
        logger: { info() {}, warn() {}, error() {}, debug() {} },
        hook: () => {}, on: () => {},
    } as any;
}

/** `POST /api/v1/analytics/query` with an analytics service that throws. */
async function postAnalyticsQuery(err: unknown) {
    const { server, handlers } = makeFakeServer();
    const plugin = createDispatcherPlugin({ prefix: '/api/v1', securityHeaders: false });
    await plugin.start?.(makeCtx(server, err));
    const handler = handlers['POST /api/v1/analytics/query'];
    expect(handler, 'POST /api/v1/analytics/query must be mounted').toBeTypeOf('function');
    const res: any = {
        statusCode: undefined, body: undefined,
        status(c: number) { res.statusCode = c; return res; },
        header() { return res; },
        json(b: any) { res.body = b; return res; },
    };
    // [#3878] The body must pass entry validation, so the SERVICE's throw is
    // what reaches the exit rather than an entry 400.
    await handler({ body: { cube: 'x', measures: ['count'] }, query: {} }, res);
    return { status: res.statusCode as number, body: res.body };
}

/** The three exits, each as `(error) => { status, body }`. */
const EXITS: Array<{ name: string; run: (e: unknown) => Promise<{ status: number; body: any }> }> = [
    {
        name: 'HttpDispatcher.errorFromThrown',
        run: async (e) => {
            const r: any = errorFromThrown(e as any, 500);
            return { status: r.status, body: r.body };
        },
    },
    {
        name: 'endpoint-executor.endpointErrorAnswer',
        run: async (e) => {
            const r = endpointErrorAnswer(e as any, 500);
            return { status: r.status, body: r.body as any };
        },
    },
    {
        name: 'dispatcher-plugin.errorResponseBase (real route POST /api/v1/analytics/query)',
        run: (e) => postAnalyticsQuery(e),
    },
];

function expectDeclaredEnvelope(body: any): any {
    expect(BaseResponseSchema.safeParse(body).success).toBe(true);
    expect(envelopeViolations(body)).toEqual([]);
    const parsed = ApiErrorSchema.safeParse(body?.error);
    expect(parsed.error?.issues ?? []).toEqual([]);
    expect(parsed.success).toBe(true);
    return body.error;
}

// ---------------------------------------------------------------------------
// 1. The withhold, at every exit
// ---------------------------------------------------------------------------

describe('[#12509] every dispatcher exit withholds an UNDECLARED 5xx spelling', () => {
    const WITHHELD: Array<{ name: string; error: unknown; spelling: string }> = [
        {
            name: 'a sqlite errno',
            error: thrown('SQLITE_ERROR: no such table: leave_request', { code: 'SQLITE_ERROR' }),
            spelling: 'SQLITE_ERROR',
        },
        {
            name: 'a postgres errno',
            error: thrown('relation "leave_request" does not exist', { code: '42P01' }),
            spelling: '42P01',
        },
        {
            name: 'an app spelling that declared no status',
            error: thrown('the widget refused the write', { code: 'WIDGET_REFUSED_THE_WRITE' }),
            spelling: 'WIDGET_REFUSED_THE_WRITE',
        },
    ];

    for (const exit of EXITS) {
        for (const c of WITHHELD) {
            it(`${exit.name}: ${c.name}`, async () => {
                const answer = await exit.run(c.error);
                const error = expectDeclaredEnvelope(answer.body);

                // Positive shape first, so the absence cannot pass vacuously.
                expect(answer.status).toBe(500);
                expect(error.code).toBe('INTERNAL_ERROR');
                expect('declaredCode' in error).toBe(false);
                expect(JSON.stringify(answer.body)).not.toContain(c.spelling);
            });
        }
    }
});

// ---------------------------------------------------------------------------
// 2. The author channel survives, at every exit
// ---------------------------------------------------------------------------

describe('[#12509] an AUTHOR-DECLARED code still reaches the wire at every exit', () => {
    const SURVIVES: Array<{ name: string; error: unknown; status: number; code: string; declaredCode: string }> = [
        {
            name: 'a declared 503',
            error: thrown('the acme ledger service is down', { status: 503, code: 'ACME_LEDGER_OFFLINE' }),
            status: 503, code: 'SERVICE_UNAVAILABLE', declaredCode: 'ACME_LEDGER_OFFLINE',
        },
        {
            name: 'a declared 500 — declaring the fallback VALUE is still declaring',
            error: thrown('the importer gave up', { status: 500, code: 'ACME_IMPORT_ABORTED' }),
            status: 500, code: 'INTERNAL_ERROR', declaredCode: 'ACME_IMPORT_ABORTED',
        },
        {
            name: 'a declared 409 — below the sanitisation band entirely',
            error: thrown('invoices still open', { status: 409, code: 'CLOSE_PERIOD_LOCKED' }),
            status: 409, code: 'RESOURCE_CONFLICT', declaredCode: 'CLOSE_PERIOD_LOCKED',
        },
    ];

    for (const exit of EXITS) {
        for (const c of SURVIVES) {
            it(`${exit.name}: ${c.name}`, async () => {
                const answer = await exit.run(c.error);
                const error = expectDeclaredEnvelope(answer.body);
                expect(answer.status).toBe(c.status);
                expect(error.code).toBe(c.code);
                expect(error.declaredCode).toBe(c.declaredCode);
            });
        }
    }
});

// ---------------------------------------------------------------------------
// 3. Each exit's wire IS the shared rule
// ---------------------------------------------------------------------------

describe('[#12509] the exits read the shared rule, they do not restate it', () => {
    const SHAPES: unknown[] = [
        thrown('sqlite errno, undeclared', { code: 'SQLITE_ERROR' }),
        thrown('postgres errno, undeclared', { code: '42P01' }),
        thrown('app spelling, undeclared', { code: 'WIDGET_REFUSED_THE_WRITE' }),
        thrown('app spelling, declared 503', { status: 503, code: 'ACME_LEDGER_OFFLINE' }),
        thrown('app spelling, declared 500', { status: 500, code: 'ACME_IMPORT_ABORTED' }),
        thrown('app spelling, declared 409', { status: 409, code: 'CLOSE_PERIOD_LOCKED' }),
        thrown('registered code', { status: 409, code: 'DESTRUCTIVE_CHANGE' }),
        thrown('a bare fault', {}),
    ];

    for (const exit of EXITS) {
        for (const shape of SHAPES) {
            it(`${exit.name}: "${(shape as Error).message}"`, async () => {
                const expected = demotedDeclaredCode(resolveThrownHttpError(shape, 500));
                const answer = await exit.run(shape);
                expect(answer.body?.error?.declaredCode).toBe(expected);
            });
        }
    }

    it('the shapes above do not all answer the same thing', () => {
        // Anti-vacuity: if every shape demoted to `undefined` the comparisons
        // would pass against an exit that emits the channel never — option B,
        // which the ruling declined.
        const answers = SHAPES.map((s) => demotedDeclaredCode(resolveThrownHttpError(s, 500)));
        expect(answers.filter((a) => a !== undefined).length).toBeGreaterThan(2);
        expect(answers.filter((a) => a === undefined).length).toBeGreaterThan(2);
    });
});

// ---------------------------------------------------------------------------
// 4. The prose axis, pinned AS IT STANDS — #12281's card, not this one
// ---------------------------------------------------------------------------

describe('[#12509] the MESSAGE is untouched here — #12281 owns that axis', () => {
    it('a declared 5xx WITH a code still has its prose withheld at errorResponseBase', async () => {
        // `declaresServerFault` needs both a 5xx status and a string code, and
        // this shape has both, so the withhold already fires.
        const answer = await postAnalyticsQuery(
            thrown('the acme ledger service is down', { status: 503, code: 'ACME_LEDGER_OFFLINE' }),
        );
        expect(answer.status).toBe(503);
        expect(answer.body.error.message).toBe(INTERNAL_ERROR_MESSAGE);
        // …and the code channel is the half THIS card rules: author-declared,
        // so it survives beside the withheld prose.
        expect(answer.body.error.declaredCode).toBe('ACME_LEDGER_OFFLINE');
    });

    it('⚠️ a declared 5xx with NO code keeps its prose — this is what #12281 changes', async () => {
        // The population measurement the ruling asked for is non-empty:
        // `action-execution.ts` throws `{ statusCode: 503, message: 'Data
        // service not available' }` at six sites and a 501 at a seventh, all
        // code-less. `declaresServerFault` is false for them, so their prose
        // travels today. When #12281 lands this expectation flips to the
        // generic sentence — deliberately pinned so that lands as a CHANGE
        // rather than as drift nobody sees.
        const answer = await postAnalyticsQuery({ statusCode: 503, message: 'Data service not available' });
        expect(answer.status).toBe(503);
        expect(answer.body.error.message).toBe('Data service not available');
        // Nothing to withhold on the code channel: the producer declared none.
        expect(answer.body.error).not.toHaveProperty('declaredCode');
    });
});
