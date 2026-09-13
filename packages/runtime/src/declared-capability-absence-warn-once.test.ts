// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#14656] A DECLARED CAPABILITY ABSENCE is reported once per route per
 * process, at `warn`, naming the missing service — driven through the REAL
 * dispatcher and the REAL REST envelope writer.
 *
 * ## The ruling this pins
 *
 * Maintainer ruling 2026-09-03 (decision batch #23, verbatim reply 「同意」 to
 * this card's **B + C**):
 *
 * > A **declared capability absence** — a 5xx the platform chose because the
 * > deployment did not install an optional service (the `NOT_IMPLEMENTED` /
 * > `SERVICE_UNAVAILABLE` family answering a configuration fact) — is a
 * > configuration fact, not a fault: it is reported **once per route per
 * > process**, at `warn`, naming the missing service, and then stays quiet for
 * > that route. Everything else that reaches `logServerFault` keeps the shipped
 * > per-request `error` line.
 *
 * ## What was measured before it
 *
 * On a stock showcase boot (#14656 comment, 2026-09-04), `GET /api/v1/ai/*` —
 * the cloud-only AI service's declared `501 NOT_IMPLEMENTED` — printed one
 * `error`-level line **per request**, and Studio opens it unprompted. The
 * channel #14310 had just built to mean "an operator must look" was being
 * trained into noise by a deployment that is working exactly as configured.
 *
 * ## Why these four assertions and not others
 *
 *  1. **The second, different route.** The ruling names the global "first N"
 *     throttle as "the shape that hides the second route", so a test showing
 *     the first route going quiet is worth less than one showing a second one
 *     still speaking. Both routes here answer the SAME code and the SAME
 *     message from the SAME slot, so only the route can be discriminating.
 *  2. **The undeclared fault control.** Same process, same door, N requests —
 *     N `error` lines. Without it, "quiet" and "broken" are the same colour.
 *  3. **The two doors, on one fixture envelope.** The ruling puts the predicate
 *     in one place *because* a per-door spelling is what this repo has paid to
 *     repair twice. Here the envelope the dispatcher really answers is read off
 *     the wire and handed to the OTHER door (`sendError`, `@objectstack/types`
 *     — the exit every nested-envelope 5xx in `packages/rest` takes), and both
 *     must classify it the same way. ⚠️ The two lines are not byte-identical
 *     and are not asserted to be: the dispatcher names its route and the
 *     envelope writer has none to name. What must agree is the VERDICT — the
 *     level, and that the line names the missing service.
 *  4. **The wire does not move.** The ruling's own condition is «if any
 *     response byte moves, stop and report», so the bytes are captured rather
 *     than asserted to be unchanged: the `the wire does not move` block below
 *     runs green on `origin/main` at this branch's base too, which is what
 *     makes it a before/after measurement instead of a claim.
 */

import { describe, it, expect, vi } from 'vitest';

// Each test re-executes the dispatcher's module graph (see `boot` below), which
// the default 5s budget does not cover on a shared box — measured: the FIRST
// test paid 5s+ and timed out while the rest ran in ~1.4s each off vitest's
// transform cache. The cost is the price of the per-test isolation the ruling's
// "per process" key needs, so the budget is raised rather than the isolation
// dropped.
vi.setConfig({ testTimeout: 30_000 });

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

function makeRes() {
    const res: any = {
        statusCode: undefined as number | undefined,
        body: undefined as any,
        status(c: number) { res.statusCode = c; return res; },
        header() { return res; },
        json(b: any) { res.body = b; return res; },
        end() { return res; },
    };
    return res;
}

/**
 * Boot the real plugin over a fake transport, with a spied kernel logger —
 * in a FRESH module graph.
 *
 * ⚠️ `vi.resetModules()` is the load-bearing line, not boilerplate. The dedupe
 * registry is module state in `@objectstack/types` (that IS the ruling's "per
 * process" half), so without a reset the first test to touch a route would
 * silence it for every later test in this file, and their colour would depend
 * on execution order. Resetting gives each test its own process-equivalent,
 * which is also the only honest way to pin a per-process rule.
 *
 * `@objectstack/types` is aliased to its SOURCE for this package
 * (`packages/runtime/vitest.config.ts`), so the reset reaches the registry and
 * an edit to `packages/types/src` is visible here without a rebuild.
 *
 * Both doors are imported INSIDE this window so the dispatcher and `sendError`
 * share one registry — a two-door pin over two registries would prove nothing.
 */
async function boot(services: Record<string, any>) {
    vi.resetModules();
    const [{ createDispatcherPlugin }, { sendError }] = await Promise.all([
        import('./dispatcher-plugin.js'),
        import('@objectstack/types'),
    ]);
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const kernel = {
        getService: (n: string) => services[n],
        getServiceAsync: async (n: string) => services[n],
    };
    const { server, handlers } = makeFakeServer();
    const ctx: any = {
        getKernel: () => kernel,
        getService: (n: string) => (n === 'http.server' ? server : undefined),
        environmentId: undefined,
        logger,
        hook: () => { },
        on: () => { },
    };
    const plugin = createDispatcherPlugin({ prefix: '/api/v1', securityHeaders: false });
    await plugin.start?.(ctx);
    return { handlers, logger, sendError };
}

const FAULT_PREFIX = '[5xx]';
const lines = (spy: { mock: { calls: any[][] } }) =>
    spy.mock.calls.filter((c) => String(c[0]).startsWith(FAULT_PREFIX));

const REQ = { body: {}, query: {}, headers: {}, params: {} };

/** The analytics door, which throws and therefore answers an UNDECLARED 500. */
const throwingAnalytics = (message: string) => ({
    analytics: {
        query: async () => { throw new Error(message); },
        getMeta: async () => ({ cubes: [] }),
        generateSql: async () => ({ sql: null }),
    },
});

describe('#14656 — the dispatcher door', () => {
    it('reports a declared 501 ONCE across N requests, at warn, naming the missing service', async () => {
        const { handlers, logger } = await boot({});

        for (const _ of [0, 1, 2, 3, 4]) {
            await handlers['GET /api/v1/notifications']({ ...REQ }, makeRes());
        }

        expect(lines(logger.error), 'a configuration fact is not a fault').toHaveLength(0);
        const warned = lines(logger.warn);
        expect(warned, 'five requests, one line').toHaveLength(1);

        const [message, meta] = warned[0];
        // `serviceUnavailableMessage('notification')` — the same remedy
        // sentence discovery publishes for that slot, which is what "naming the
        // missing service" means here: the line says WHICH package to install.
        expect(String(message)).toContain('@objectstack/service-messaging');
        expect(String(message)).toContain('reported once per route per process');
        expect(meta).toMatchObject({
            status: 501,
            code: 'NOT_IMPLEMENTED',
            method: 'GET',
            path: '/api/v1/notifications',
        });
    });

    it('a SECOND, DIFFERENT route still reports — the dedupe key is the route', async () => {
        const { handlers, logger } = await boot({});

        await handlers['GET /api/v1/notifications']({ ...REQ }, makeRes());
        await handlers['GET /api/v1/notifications']({ ...REQ }, makeRes());
        await handlers['POST /api/v1/notifications/read']({ ...REQ, body: { ids: ['n1'] } }, makeRes());
        await handlers['POST /api/v1/notifications/read']({ ...REQ, body: { ids: ['n1'] } }, makeRes());

        const warned = lines(logger.warn);
        expect(warned, 'one line per route, not one line per process').toHaveLength(2);
        expect(warned.map((c) => `${(c[1] as any).method} ${(c[1] as any).path}`)).toEqual([
            'GET /api/v1/notifications',
            'POST /api/v1/notifications/read',
        ]);
        // Same slot, same code, same prose — so nothing but the route could
        // have told the two apart.
        expect((warned[0][1] as any).code).toBe('NOT_IMPLEMENTED');
        expect((warned[1][1] as any).code).toBe('NOT_IMPLEMENTED');
        expect(lines(logger.error)).toHaveLength(0);
    });

    it('an UNDECLARED 500 on the same door is still loud, once per request', async () => {
        const { handlers, logger } = await boot(throwingAnalytics('still-loud-per-request'));

        for (const _ of [0, 1, 2]) {
            await handlers['POST /api/v1/analytics/query'](
                { body: { cube: 'x', measures: ['count'] }, query: {} },
                makeRes(),
            );
        }

        expect(lines(logger.error), 'the #14310 rule is untouched for faults').toHaveLength(3);
        expect(lines(logger.warn)).toHaveLength(0);
    });

    it('a declared absence and a fault coexist in one process without either changing the other', async () => {
        const { handlers, logger } = await boot(throwingAnalytics('coexist'));

        await handlers['GET /api/v1/notifications']({ ...REQ }, makeRes());
        await handlers['POST /api/v1/analytics/query']({ body: { cube: 'x', measures: ['count'] }, query: {} }, makeRes());
        await handlers['GET /api/v1/notifications']({ ...REQ }, makeRes());
        await handlers['POST /api/v1/analytics/query']({ body: { cube: 'x', measures: ['count'] }, query: {} }, makeRes());

        expect(lines(logger.warn)).toHaveLength(1);
        expect(lines(logger.error)).toHaveLength(2);
    });
});

describe('#14656 — both doors read ONE predicate, on one fixture envelope', () => {
    it('the envelope the dispatcher answers is classified identically by the REST envelope writer', async () => {
        const { handlers, logger, sendError } = await boot({});

        // ── Door 1: the runtime dispatcher, on the real route ──────────────
        const res = makeRes();
        await handlers['GET /api/v1/notifications']({ ...REQ }, res);

        const fixture = {
            status: res.statusCode as number,
            code: res.body.error.code as string,
            message: res.body.error.message as string,
        };
        expect(fixture).toMatchObject({ status: 501, code: 'NOT_IMPLEMENTED' });

        const dispatcherWarned = lines(logger.warn);
        expect(dispatcherWarned, 'door 1 demoted it').toHaveLength(1);
        expect(lines(logger.error)).toHaveLength(0);

        // ── Door 2: `sendError`, the exit every nested-envelope 5xx takes ──
        // It takes no logger (it is reached from ~50 sites that have none), so
        // its channel is `console`. The CHANNEL differs; the VERDICT must not.
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => { });
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => { });
        try {
            sendError(makeRes(), fixture.status, fixture.code as any, fixture.message);

            const restWarned = lines(warnSpy);
            expect(restWarned, 'door 2 must not disagree with door 1 about the same envelope').toHaveLength(1);
            expect(lines(errorSpy), 'door 2 must not keep the fault line the other door dropped').toHaveLength(0);

            // Both lines name the missing service and both declare the
            // suppression — the two halves of "reported once, naming what is
            // absent" that a per-door spelling would drift on first.
            for (const line of [String(dispatcherWarned[0][0]), String(restWarned[0][0])]) {
                expect(line.startsWith(FAULT_PREFIX)).toBe(true);
                expect(line).toContain('@objectstack/service-messaging');
                expect(line).toContain('reported once per route per process');
            }
        } finally {
            warnSpy.mockRestore();
            errorSpy.mockRestore();
        }
    });
});

describe('#14656 — the wire does not move', () => {
    /**
     * ⚠️ This block is written to be RUNNABLE AT THIS BRANCH'S BASE. It names
     * no `warn`, no count and nothing else this card introduces, so running it
     * on `origin/main` and here answers one question: did any response byte
     * move? The ruling's condition — «if any response byte moves, stop and
     * report» — is a measurement, and this is the instrument.
     */
    it('answers the same bytes it answered before this change, on every request', async () => {
        const { handlers } = await boot({});

        const seen: string[] = [];
        for (const _ of [0, 1, 2]) {
            const res = makeRes();
            await handlers['GET /api/v1/notifications']({ ...REQ }, res);
            seen.push(`${res.statusCode} ${JSON.stringify(res.body)}`);
        }

        // Identical on every request: the dedupe changes what is LOGGED, never
        // what is ANSWERED — a caller cannot tell the first request from the
        // hundredth.
        expect(new Set(seen).size, 'the answer must not depend on how many times it was asked').toBe(1);
        expect(seen[0]).toBe(
            '501 {"success":false,"error":{"code":"NOT_IMPLEMENTED",'
            + '"message":"Install @objectstack/service-messaging to enable",'
            + '"httpStatus":501}}',
        );
    });

    it('answers the same bytes for a fault, too', async () => {
        const { handlers } = await boot(throwingAnalytics('wire-unchanged-for-faults'));

        const res = makeRes();
        await handlers['POST /api/v1/analytics/query'](
            { body: { cube: 'x', measures: ['count'] }, query: {} },
            res,
        );

        expect(`${res.statusCode} ${JSON.stringify(res.body)}`).toBe(
            '500 {"success":false,"error":{"code":"INTERNAL_ERROR","message":"wire-unchanged-for-faults","httpStatus":500}}',
        );
    });
});
