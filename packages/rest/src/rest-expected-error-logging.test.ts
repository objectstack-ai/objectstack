// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#4886] Expected 4xx must not be logged as "[REST] Unhandled error".
//
// The metadata routes logged EVERY thrown error unconditionally — 29 catch
// blocks doing `logError("[REST] Unhandled error:", error); sendError(...)`.
// Studio's designer probes `GET /meta/:type/:name?state=draft` on every panel
// to decide whether to show "unsaved draft" state, and "no draft exists" is the
// overwhelmingly common answer, so `getMetaItem` throwing its structured
// `{ code: 'NO_DRAFT', status: 404 }` printed a full stack trace per panel —
// 45 in one browsing session. The wire answer was always a correct, clean 404;
// only the logging was wrong.
//
// The data routes already consulted `isExpectedDataStatus` /
// `isExpectedQueryRejection` — but in four different open-coded spellings, and
// `isExpectedQueryRejection`'s docblock records an earlier lap of the same
// drift (the filter and sort codes shipped without joining the list). Both
// families now decide through ONE predicate behind ONE door
// (`handleRouteError`), which is what these tests pin.
//
// Both directions are pinned deliberately, and they are NOT symmetric:
//  - the "quiet" tests go RED if the fix is reverted (the unconditional log
//    comes back);
//  - the "loud" tests stay GREEN under a revert — they exist to catch the
//    OPPOSITE overreach, a predicate widened to "any 4xx is expected", which
//    would silence the un-coded 400 that `mapDataError` degrades an
//    unrecognised error (a handler `TypeError`) to.
//
// [#5489] That last sentence describes the world before the unrecognised-error
// fallback became a sanitised 500. The handler-bug case below now asserts 500;
// its adversary is no longer a widened 4xx predicate but any future attempt to
// add 500 to `isExpectedDataStatus`. The invariant it guards — a real handler
// bug is never silent — is the same one, and is now carried by the status band
// rather than by the absence of a `code`.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RestServer } from './rest-server';

const META_ITEM = '/api/v1/meta/:type/:name';
const DATA_LIST = '/api/v1/data/:object';

function createMockServer() {
    return {
        get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(), use: vi.fn(),
        listen: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined),
    };
}

function makeRes() {
    const res: any = { statusCode: 200, body: undefined };
    res.status = vi.fn((c: number) => { res.statusCode = c; return res; });
    res.json = vi.fn((b: any) => { res.body = b; return res; });
    res.header = vi.fn(() => res);
    res.setHeader = vi.fn(); res.write = vi.fn(); res.end = vi.fn(); res.send = vi.fn();
    return res;
}

/** The exact error `metadata-protocol`'s `getMetaItem` throws for a draft probe. */
function noDraftError(target: string) {
    return Object.assign(
        new Error(`[no_draft] No pending draft exists for ${target}.`),
        { code: 'NO_DRAFT', status: 404 },
    );
}

function setup(protocolOverrides: Record<string, unknown> = {}) {
    const protocol: any = {
        getDiscovery: vi.fn().mockResolvedValue({
            version: 'v0', routes: { data: '', metadata: '', ui: '', auth: '/auth' },
        }),
        getMetaTypes: vi.fn().mockResolvedValue([]),
        getMetaItems: vi.fn().mockResolvedValue([{ name: 'showcase_account' }]),
        getMetaItem: vi.fn().mockResolvedValue({}),
        findData: vi.fn().mockResolvedValue([]),
        ...protocolOverrides,
    };
    const rest = new RestServer(
        createMockServer() as any,
        protocol,
        { api: { requireAuth: false } } as any,
    );
    // A resolved session — meta routes are behind an unconditional auth gate.
    (rest as any).resolveExecCtx = async () => ({ userId: 'u1' });
    rest.registerRoutes();
    return { rest, protocol };
}

function findRoute(rest: any, method: string, path: string) {
    const route = rest.getRoutes().find((r: any) => r.method === method && r.path === path);
    if (!route) throw new Error(`${method} ${path} route not registered`);
    return route;
}

async function callMetaItem(rest: any, params: any, query: any = {}) {
    const res = makeRes();
    await findRoute(rest, 'GET', META_ITEM).handler(
        { method: 'GET', params, query, headers: {} }, res,
    );
    return res;
}

async function callDataList(rest: any, object: string) {
    const res = makeRes();
    await findRoute(rest, 'GET', DATA_LIST).handler(
        { method: 'GET', params: { object }, query: {}, headers: {} }, res,
    );
    return res;
}

let errorSpy: ReturnType<typeof vi.spyOn>;

/** Only the "[REST] Unhandled error" channel — other console.error noise is not this test's business. */
const unhandledLogs = () => errorSpy.mock.calls.filter((c: unknown[]) => c[0] === '[REST] Unhandled error:');

beforeEach(() => { errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => { errorSpy.mockRestore(); });

describe('metadata routes — expected 4xx respond without an "Unhandled error" log (#4886)', () => {
    it('NO_DRAFT from the designer draft probe logs NOTHING and still 404s cleanly', async () => {
        const { rest } = setup({
            getMetaItem: vi.fn().mockRejectedValue(noDraftError('app/showcase_app')),
        });

        const res = await callMetaItem(rest, { type: 'app', name: 'showcase_app' }, { state: 'draft' });

        // The whole point: no stack trace for the overwhelmingly common answer.
        expect(unhandledLogs()).toHaveLength(0);
        // ...and the wire answer is byte-for-byte what it always was.
        expect(res.statusCode).toBe(404);
        expect(res.body).toEqual({
            error: '[no_draft] No pending draft exists for app/showcase_app.',
            code: 'NO_DRAFT',
        });
    });

    it('stays quiet across the sibling expected statuses, not just 404', async () => {
        // 403 RBAC denial / 409 conflict / 503 provisioning are all normal
        // outcomes `isExpectedDataStatus` already named for the data family.
        for (const status of [403, 404, 409, 502, 503]) {
            const { rest } = setup({
                getMetaItem: vi.fn().mockRejectedValue(
                    Object.assign(new Error('expected'), { code: 'SOME_CODE', status }),
                ),
            });
            const res = await callMetaItem(rest, { type: 'object', name: 'showcase_account' });
            expect(res.statusCode).toBe(status);
        }
        expect(unhandledLogs()).toHaveLength(0);
    });

    it('a VALIDATION_FAILED 400 is also expected (client-caused, body already explains it)', async () => {
        const { rest } = setup({
            getMetaItem: vi.fn().mockRejectedValue(
                Object.assign(new Error('bad'), { code: 'VALIDATION_FAILED', status: 400 }),
            ),
        });

        const res = await callMetaItem(rest, { type: 'object', name: 'showcase_account' });

        expect(unhandledLogs()).toHaveLength(0);
        expect(res.statusCode).toBe(400);
    });
});

describe('metadata routes — genuine faults keep the loud log (#4886)', () => {
    it('a 500 still logs the full error object', async () => {
        const boom = Object.assign(new Error('driver exploded'), { status: 500 });
        const { rest } = setup({ getMetaItem: vi.fn().mockRejectedValue(boom) });

        const res = await callMetaItem(rest, { type: 'object', name: 'showcase_account' });

        expect(unhandledLogs()).toHaveLength(1);
        // The error itself is logged, not a summary — the stack is the point here.
        expect(unhandledLogs()[0][1]).toBe(boom);
        expect(res.statusCode).toBe(500);
    });

    it('an UNRECOGNISED error (handler bug) stays loud — and is a 500, not a 400 (#5489)', async () => {
        // The loudness is what #4886 pinned, and it is unchanged. What moved is
        // WHY it is structural: this case used to land on `mapDataError`'s
        // un-coded 400 fallback, so the guard read "loud even though it maps to
        // 400" and its adversary was a predicate widened to "any 4xx is
        // expected". #5489 made that fallback a sanitised 500
        // (`UNCLASSIFIED_FAULT`) because a handler bug is not the caller's
        // fault and an SDK must not read "do not retry" off it. 500 is outside
        // `isExpectedDataStatus` entirely, so the log line no longer depends on
        // the predicate staying narrow in the 4xx band.
        const bug = new TypeError('Cannot read properties of undefined (reading \'name\')');
        const { rest } = setup({ getMetaItem: vi.fn().mockRejectedValue(bug) });

        const res = await callMetaItem(rest, { type: 'object', name: 'showcase_account' });

        expect(unhandledLogs()).toHaveLength(1);
        expect(unhandledLogs()[0][1]).toBe(bug);
        expect(res.statusCode).toBe(500);
        expect(res.body?.code).toBe('INTERNAL_ERROR');
        // The bug's own words are the operator's, not the client's — and the
        // log line above is where they went.
        expect(JSON.stringify(res.body)).not.toContain('Cannot read properties');
    });
});

describe('both route families share ONE verdict — the anti-drift pin (#4886)', () => {
    it('the same structured 404 is silent on a metadata route AND a data route', async () => {
        const meta = setup({ getMetaItem: vi.fn().mockRejectedValue(noDraftError('object/showcase_account')) });
        const metaRes = await callMetaItem(meta.rest, { type: 'object', name: 'showcase_account' });
        const afterMeta = unhandledLogs().length;

        const data = setup({ findData: vi.fn().mockRejectedValue(noDraftError('object/showcase_account')) });
        const dataRes = await callDataList(data.rest, 'showcase_account');
        const afterData = unhandledLogs().length;

        expect(metaRes.statusCode).toBe(404);
        expect(dataRes.statusCode).toBe(404);
        expect(afterMeta).toBe(0);
        expect(afterData).toBe(0);
    });

    it('the same unrecognised fault is loud on a metadata route AND a data route', async () => {
        const bug = new TypeError('boom');

        const meta = setup({ getMetaItem: vi.fn().mockRejectedValue(bug) });
        await callMetaItem(meta.rest, { type: 'object', name: 'showcase_account' });
        expect(unhandledLogs()).toHaveLength(1);

        const data = setup({ findData: vi.fn().mockRejectedValue(bug) });
        await callDataList(data.rest, 'showcase_account');
        expect(unhandledLogs()).toHaveLength(2);
    });

    it('a client-caused query rejection is silent on the data list route (the earlier drift lap)', async () => {
        // `isExpectedQueryRejection`'s docblock: the filter and sort codes
        // shipped WITHOUT joining the expected list, so every rejection they
        // produced was ALSO logged as an unhandled error. Same shape, and now
        // the same single predicate for every family.
        const { rest } = setup({
            findData: vi.fn().mockRejectedValue(
                Object.assign(new Error('Unknown filter operator'), { code: 'INVALID_FILTER', status: 400 }),
            ),
        });

        const res = await callDataList(rest, 'showcase_account');

        expect(unhandledLogs()).toHaveLength(0);
        expect(res.statusCode).toBe(400);
        expect(res.body?.code).toBe('INVALID_FILTER');
    });
});
