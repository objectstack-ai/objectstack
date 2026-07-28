// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #3867 — the dispatcher-plugin error exit.
 *
 * `errorResponseBase` is the single error exit for EVERY route this plugin
 * mounts (`/analytics`, `/packages`, `/i18n`, `/storage`, `/automation`,
 * `/auth`, `/notifications`, `/mcp`, …): each handler catches and calls it
 * rather than re-throwing. Two defects lived there, and neither is visible
 * until a real error actually reaches it:
 *
 *  1. It returned `err.message` verbatim. `@objectstack/rest` has guarded its
 *     data routes against driver dumps forever (`mapDataError`); this boundary
 *     guarded nothing, so `POST /analytics/query` on an unresolvable cube
 *     answered with a real SQL statement in the body.
 *  2. It read only `err.statusCode`, while domain errors across this codebase
 *     carry `status` (and `HttpDispatcher.errorFromThrown` already reads
 *     `status` first). A deliberate 404 rendered as a 500.
 *
 * These drive the REAL route handler the plugin registers, through the real
 * dispatcher, so the assertions are about what an HTTP client receives.
 */

import { describe, it, expect } from 'vitest';

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

/** A kernel whose `analytics` service throws whatever the test hands it. */
function makeCtx(fakeServer: any, analyticsError: unknown) {
    const analytics = {
        query: async () => { throw analyticsError; },
        getMeta: async () => ({ cubes: [] }),
        generateSql: async () => ({ sql: null }),
    };
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

/** Drive `POST /analytics/query` with an analytics service that throws `err`. */
async function postAnalyticsQuery(err: unknown) {
    const { server, handlers } = makeFakeServer();
    const plugin = createDispatcherPlugin({ prefix: '/api/v1', securityHeaders: false });
    await plugin.start?.(makeCtx(server, err));

    const handler = handlers['POST /api/v1/analytics/query'];
    expect(handler, 'POST /api/v1/analytics/query must be mounted').toBeTypeOf('function');

    const res = makeRes();
    await handler({ body: { cube: 'x', query: {} }, query: {} }, res);
    return res;
}

describe('#3867 — dispatcher-plugin error envelope', () => {
    it('does not return raw SQL to the client (the message that motivated the issue)', async () => {
        const res = await postAnalyticsQuery(
            new Error('SELECT  FROM "sqlite_sequence" - near "FROM": syntax error'),
        );

        expect(res.statusCode).toBe(500);
        expect(res.body.success).toBe(false);
        expect(res.body.error.message).toBe('Internal server error');
        // The specifics a client must never see.
        expect(String(res.body.error.message)).not.toContain('SELECT');
        expect(String(res.body.error.message)).not.toContain('sqlite_sequence');
    });

    it('still hands the UNSANITISED error to the observability side-channel', async () => {
        // Sanitising the response must not cost server-side diagnostics: the
        // error reporter reads `__obsRecordedError`, not the response body.
        const original = new Error('UNIQUE constraint failed: sys_user.email');
        const res = await postAnalyticsQuery(original);

        expect(res.statusCode).toBe(500);
        expect(res.body.error.message).toBe('Internal server error');
        expect((res as any).__obsRecordedError).toBe(original);
    });

    it('leaves an ordinary 5xx message alone — only leaks are replaced', async () => {
        const res = await postAnalyticsQuery(new Error('analytics engine unavailable'));

        expect(res.statusCode).toBe(500);
        expect(res.body.error.message).toBe('analytics engine unavailable');
    });

    it('honours `status` (not just `statusCode`) so a domain 404 is not a 500', async () => {
        // What the #3867 cube gate throws, and the shape every protocol-layer
        // domain error uses (`OBJECT_NOT_FOUND`, `RECORD_NOT_FOUND`, …).
        const err = Object.assign(new Error("Cube 'ghost' not found: no cube is registered"), {
            code: 'CUBE_NOT_FOUND',
            status: 404,
        });
        const res = await postAnalyticsQuery(err);

        expect(res.statusCode).toBe(404);
        // A 4xx message is a deliberate answer — it must reach the caller intact.
        expect(res.body.error.message).toContain("Cube 'ghost' not found");
    });

    it('still honours `statusCode` for callers that use it', async () => {
        const err = Object.assign(new Error('bad request'), { statusCode: 400 });
        const res = await postAnalyticsQuery(err);

        expect(res.statusCode).toBe(400);
        expect(res.body.error.message).toBe('bad request');
    });

    it('does not sanitise a 4xx even when its message resembles SQL', async () => {
        // Anti-regression for the tier: the guard is scoped to 5xx precisely so
        // a deliberate client-facing answer is never swallowed.
        const err = Object.assign(new Error('unique constraint on email — pick another'), {
            status: 409,
        });
        const res = await postAnalyticsQuery(err);

        expect(res.statusCode).toBe(409);
        expect(res.body.error.message).toBe('unique constraint on email — pick another');
    });
});
