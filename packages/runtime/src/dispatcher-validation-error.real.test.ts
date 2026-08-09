// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #3918 follow-up — pin both dispatcher exits against the REAL `ValidationError`.
 *
 * `dispatcher-validation-error.test.ts` drives the exits with a hand-built
 * fixture: an `Error` with `name = 'ValidationError'`, `code =
 * 'VALIDATION_FAILED'` and a `fields[]`. That is deliberate — it proves the
 * duck-typing predicate accepts the SHAPE, including for hand-thrown errors
 * that never touched objectql.
 *
 * What it cannot prove is that the shape it asserts is still the shape objectql
 * actually throws. The whole fix rests on three facts about that class —
 * `.code`, `.fields[]`, and the deliberate ABSENCE of `.status` — and a fixture
 * restates those facts rather than checking them. Give `ValidationError` a
 * `.status` one day, or rename `.fields`, and every fixture-based test here
 * keeps passing while production quietly regresses.
 *
 * So these construct the genuine article and send it through both exits. They
 * are the tests that fail if the contract moves.
 */

import { describe, it, expect, vi } from 'vitest';
import { ValidationError } from '@objectstack/objectql';

import { HttpDispatcher } from './http-dispatcher.js';
import { createDispatcherPlugin } from './dispatcher-plugin.js';

const FIELDS = [
    { field: 'email', code: 'invalid_email' as const, message: 'email must be a valid email address' },
    { field: 'name', code: 'required' as const, message: 'name is required' },
];

describe('#3918 — the real objectql ValidationError still has the shape the fix relies on', () => {
    const err = new ValidationError(FIELDS);

    it('carries `code` and `fields[]`', () => {
        expect(err.code).toBe('VALIDATION_FAILED');
        expect(err.fields).toEqual(FIELDS);
        expect(err.name).toBe('ValidationError');
    });

    it('carries NO `status` / `statusCode` — which is why the boundary must supply 400', () => {
        // If this ever fails, the dispatcher's `.status`-first precedence will
        // start winning over the 400 default and these exits change behaviour
        // silently. That is the assumption the whole fix is built on.
        expect((err as any).status).toBeUndefined();
        expect((err as any).statusCode).toBeUndefined();
    });

    it('carries no `issues` — the property the old `details` builder read', () => {
        expect((err as any).issues).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------

/** Exit 1 — the RETURNED path, through a route whose fallback is 500. */
async function publishDrafts(thrown: unknown) {
    const protocol = { publishPackageDrafts: async () => { throw thrown; } };
    const objectql = { registry: {} };
    const resolve = (name: string) =>
        name === 'protocol' ? protocol : name === 'objectql' ? objectql : undefined;
    const kernel: any = { getService: resolve, getServiceAsync: async (n: string) => resolve(n) };
    const dispatcher = new HttpDispatcher(kernel);
    // [#7033 / #7023] publish-drafts now demands `manage_metadata` on top of the
    // anonymous floor. This suite pins the ERROR-MAPPING exit (a real
    // ValidationError → 400 + fields[]), so the caller must clear the write gate;
    // otherwise every case stops at the 401/403. Only the caller's capability is
    // stubbed — the mapping under test is unchanged.
    (dispatcher as any).timedResolveExecutionContext = async () => ({
        userId: 'u1', systemPermissions: ['manage_metadata'],
    });
    const result: any = await dispatcher.dispatch(
        'POST', '/packages/demo/publish-drafts', {}, {}, {} as any,
    );
    return result.response;
}

/** Exit 2 — the THROWN path, through the plugin's real route handler. */
async function analyticsQuery(thrown: unknown) {
    const handlers: Record<string, (req: any, res: any) => any> = {};
    const rec = (verb: string) => (path: string, h: any) => { handlers[`${verb} ${path}`] = h; };
    const server = {
        get: rec('GET'), post: rec('POST'), put: rec('PUT'),
        delete: rec('DELETE'), patch: rec('PATCH'),
    };
    const analytics = {
        query: async () => { throw thrown; },
        getMeta: async () => ({ cubes: [] }),
        generateSql: async () => ({ sql: null }),
    };
    const kernel = {
        getService: (n: string) => (n === 'analytics' ? analytics : undefined),
        getServiceAsync: async (n: string) => (n === 'analytics' ? analytics : undefined),
    };
    const plugin = createDispatcherPlugin({ prefix: '/api/v1', securityHeaders: false });
    await plugin.start?.({
        getKernel: () => kernel,
        getService: (n: string) => (n === 'http.server' ? server : undefined),
        environmentId: undefined,
        logger: { info() {}, warn() {}, error() {}, debug() {} },
        hook: () => {}, on: () => {},
    } as any);

    const res: any = {
        statusCode: undefined, body: undefined,
        status(c: number) { res.statusCode = c; return res; },
        header() { return res; },
        json(b: any) { res.body = b; return res; },
    };
    // [#3878] Body must pass entry validation so the SERVICE's thrown error —
    // the thing under test — is what reaches the exit, not an entry 400.
    await handlers['POST /api/v1/analytics/query']({ body: { cube: 'x', measures: ['count'] }, query: {} }, res);
    return res;
}

describe('#3918 — both exits serve the real ValidationError as 400 + fields[]', () => {
    it('errorFromThrown (returned path)', async () => {
        const res = await publishDrafts(new ValidationError(FIELDS));

        expect(res.status).toBe(400);
        // [#3842] `VALIDATION_FAILED` moved from `details` into `error.code`.
        expect(res.body.error.code).toBe('VALIDATION_FAILED');
        expect(res.body.error.details).toEqual({ fields: FIELDS });
        // The class builds its message from the human field messages — that is
        // what a toast shows, so it must survive intact rather than being
        // replaced by the 5xx sanitiser.
        expect(res.body.error.message).toContain('email must be a valid email address');
    });

    it('errorResponseBase (thrown path)', async () => {
        const res = await analyticsQuery(new ValidationError(FIELDS));

        expect(res.statusCode).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION_FAILED');
        expect(res.body.error.details).toEqual({ fields: FIELDS });
        expect(res.body.error.message).toContain('name is required');
        // Not a server fault: the errorReporter side-channel stays clear.
        expect(res.__obsRecordedError).toBeUndefined();
    });

    it('an empty-fields ValidationError still answers 400, not 500', async () => {
        // The class defaults its message to 'Validation failed' for an empty
        // list; the status must not depend on the list being non-empty.
        const res = await publishDrafts(new ValidationError([]));

        expect(res.status).toBe(400);
        expect(res.body.error.details.fields).toEqual([]);
    });
});

// ---------------------------------------------------------------------------

/** [#3878] Post `body` through the real route handler; the service never throws. */
async function postAnalyticsBody(body: unknown) {
    const handlers: Record<string, (req: any, res: any) => any> = {};
    const rec = (verb: string) => (path: string, h: any) => { handlers[`${verb} ${path}`] = h; };
    const server = {
        get: rec('GET'), post: rec('POST'), put: rec('PUT'),
        delete: rec('DELETE'), patch: rec('PATCH'),
    };
    const query = vi.fn(async () => ({ rows: [] }));
    const analytics = { query, getMeta: async () => ({ cubes: [] }), generateSql: async () => ({ sql: null }) };
    const kernel = {
        getService: (n: string) => (n === 'analytics' ? analytics : undefined),
        getServiceAsync: async (n: string) => (n === 'analytics' ? analytics : undefined),
    };
    const plugin = createDispatcherPlugin({ prefix: '/api/v1', securityHeaders: false });
    await plugin.start?.({
        getKernel: () => kernel,
        getService: (n: string) => (n === 'http.server' ? server : undefined),
        environmentId: undefined,
        logger: { info() {}, warn() {}, error() {}, debug() {} },
        hook: () => {}, on: () => {},
    } as any);

    const res: any = {
        statusCode: undefined, body: undefined,
        status(c: number) { res.statusCode = c; return res; },
        header() { return res; },
        json(b: any) { res.body = b; return res; },
    };
    await handlers['POST /api/v1/analytics/query']({ body, query: {} }, res);
    return { res, query };
}

describe('#3878 — entry validation reaches the wire as a 400, service untouched', () => {
    it('the retired envelope answers 400 with the tombstone prescription', async () => {
        const { res, query } = await postAnalyticsBody({ cube: 'x', query: { measures: ['count'] } });

        expect(res.statusCode).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION_FAILED');
        expect(res.body.error.message).toContain('top level');
        expect(query).not.toHaveBeenCalled();
        // A caller mistake, not a server fault: the reporter side-channel stays clear.
        expect(res.__obsRecordedError).toBeUndefined();
    });

    it('a valid bare body passes through and answers 200', async () => {
        const { res, query } = await postAnalyticsBody({ cube: 'x', measures: ['count'] });

        expect(res.statusCode).toBe(200);
        expect(query).toHaveBeenCalledOnce();
    });
});
