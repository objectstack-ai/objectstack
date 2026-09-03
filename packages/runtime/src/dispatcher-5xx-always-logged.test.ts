// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#14310] Every 5xx this dispatcher answers leaves an `error`-level record.
 *
 * ## What went wrong
 *
 * Measured on `main` @ ca48cf377, through the real plugin and the real route
 * handlers: a plain `Error` thrown out of a dispatcher route answered
 * `500 INTERNAL_ERROR` with **zero** log records at any level. The only
 * evidence a fault had happened was the client's console and the response
 * body, which is why the `/packages` regression this card was filed beside
 * stayed invisible for a week.
 *
 * Two independent reasons the existing machinery did not cover it, both
 * pinned below:
 *
 *  1. `errorReporter.captureException` defaults to `NoopErrorReporter`, so on
 *     any surface nobody wired an APM into — a dev server, above all — the
 *     capture was a no-op. A log line is the operator's floor; APM is opt-in
 *     telemetry on top.
 *  2. The reporter is fed by `res.__obsRecordedError`, which only the THROWN
 *     exit sets. A route that catches its own fault and RETURNS a 5xx
 *     envelope — which is how every `/packages` handler answers
 *     (`deps.errorFromThrown`) — recorded nothing at all.
 *
 * ## Why the assertions are shaped this way
 *
 * The logger is INJECTED (`ctx.logger`, the kernel logger the plugin already
 * receives) and spied. ⛔ Not a `console` mock: what this card is about is a
 * record reaching the operator's configured sink at a level that survives
 * `--log-level`'s default, and a console spy would pass just as green if the
 * line bypassed the level system entirely.
 *
 * `error` level is the load-bearing choice: the CLI's default is `warn`
 * (`packages/cli/src/utils/log-level.ts`, `DEFAULT_LOG_LEVEL`) and `error`
 * (40) outranks `warn` (30) in `LEVEL_PRIORITY`, so the record clears the
 * default threshold without any bypass. Asserting the LEVEL rather than "some
 * output happened" is what keeps that true.
 *
 * The counts are exact (`toHaveLength(1)`), not `toBeGreaterThan(0)`. Two
 * doors serve `/api/v1/packages` and the whole point of centralising the rule
 * was that a fault produces ONE line rather than one per exit it passes.
 */

import { describe, it, expect, vi } from 'vitest';

import { createDispatcherPlugin } from './dispatcher-plugin.js';

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
    };
    return res;
}

/** Boot the real plugin over a fake transport, with a spied kernel logger. */
async function boot(services: Record<string, any>) {
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
    return { handlers, logger };
}

/** Only the records this card is about — boot-time chatter is not a fault. */
function faultRecords(logger: { error: { mock: { calls: any[][] } } }) {
    return logger.error.mock.calls.filter((c) => String(c[0]).startsWith('[5xx]'));
}

describe('#14310 — a 5xx is never silent', () => {
    it('a handler throwing a plain Error yields a 500 AND one error-level record carrying the message', async () => {
        const { handlers, logger } = await boot({
            analytics: {
                query: async () => { throw new Error('boom-plain-error'); },
                getMeta: async () => ({ cubes: [] }),
                generateSql: async () => ({ sql: null }),
            },
        });

        const res = makeRes();
        await handlers['POST /api/v1/analytics/query'](
            { body: { cube: 'x', measures: ['count'] }, query: {} },
            res,
        );

        expect(res.statusCode).toBe(500);

        const records = faultRecords(logger);
        expect(records, 'exactly one fault line per fault').toHaveLength(1);

        // The message the card names. The client no longer reads a 5xx's own
        // words (#5437) — the operator must, so this is the assertion that
        // makes the line worth printing.
        expect(String(records[0][0])).toContain('boom-plain-error');

        // …and the stack, via `Logger.error`'s error parameter, which both
        // shipped loggers fold into the record as `error` + `stack`.
        expect((records[0][1] as Error)?.stack).toContain('boom-plain-error');

        // Method, path and request id — the coordinates that turn a line into
        // a diagnosis. They ride `res.__obsRequest`, parked by
        // `instrumentRouteHandler`.
        expect(records[0][2]).toMatchObject({
            status: 500,
            method: 'POST',
            path: '/api/v1/analytics/query',
        });
        expect(String((records[0][2] as any).requestId)).not.toHaveLength(0);
    });

    it('still hands the same error to the observability side-channel — the log does not replace APM', async () => {
        const original = new Error('UNIQUE constraint failed: sys_user.email');
        const { handlers, logger } = await boot({
            analytics: {
                query: async () => { throw original; },
                getMeta: async () => ({ cubes: [] }),
                generateSql: async () => ({ sql: null }),
            },
        });

        const res = makeRes();
        await handlers['POST /api/v1/analytics/query'](
            { body: { cube: 'x', measures: ['count'] }, query: {} },
            res,
        );

        expect((res as any).__obsRecordedError).toBe(original);
        // The withheld prose reaches the operator through BOTH channels: the
        // body says `Internal server error`, the log says what happened.
        expect(res.body.error.message).toBe('Internal server error');
        expect(String(faultRecords(logger)[0][0])).toContain('UNIQUE constraint failed');
    });

    it('a RETURNED 5xx envelope logs too — the path that leaves no throw to catch', async () => {
        // `/notifications` with no messaging service answers through
        // `deps.error(...)`: nothing is thrown, so `errorResponseBase` is never
        // reached and `__obsRecordedError` is never set. This is the shape
        // every `/packages` handler answers with, and the one that was
        // completely untraceable before this change.
        const { handlers, logger } = await boot({});

        const res = makeRes();
        await handlers['GET /api/v1/notifications']({ body: {}, query: {}, headers: {}, params: {} }, res);

        expect(res.statusCode).toBeGreaterThanOrEqual(500);
        expect((res as any).__obsRecordedError).toBeUndefined();

        const records = faultRecords(logger);
        expect(records, 'the returned exit owes exactly one line too').toHaveLength(1);
        expect(records[0][2]).toMatchObject({ status: res.statusCode });
    });

    it('a 4xx stays quiet — the predicate must not turn client mistakes into fault noise', async () => {
        // An anonymous caller on an auth-gated route: a deliberate 401, the
        // caller's own business. Logging these is how a `?state=draft` probe
        // once printed 45 stack traces in one browsing session.
        const pkgSvc = { list: async () => [] };
        const { handlers, logger } = await boot({ package: pkgSvc, packages: pkgSvc });

        const res = makeRes();
        await handlers['GET /api/v1/packages']({ body: {}, query: {}, headers: {}, params: {} }, res);

        expect(res.statusCode).toBeGreaterThanOrEqual(400);
        expect(res.statusCode).toBeLessThan(500);
        expect(faultRecords(logger)).toHaveLength(0);
    });
});
