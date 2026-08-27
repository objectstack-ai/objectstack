// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#5532] What `GET /meta/:type/:name` puts on the wire once the PRODUCER stops
// conflating "the metadata store could not be read" with "that item does not
// exist".
//
// This file changes NOTHING in `packages/rest`. The sanitizing and logging
// boundary (#5437 / #5464 / #5489) was already correct; the defect was upstream
// in `@objectstack/metadata-protocol`, which handed this layer an error whose
// truth had already been destroyed. These are the assertions that prove the
// receiving half really does the right thing with the two envelopes the
// producer now emits — the "verify with the rest side's existing behaviour"
// half of the fix, and the regression net if either envelope drifts.
//
// The protocol is a stub here on purpose: it lets the two envelopes be stated
// literally, side by side, instead of being reconstructed through a real
// engine. The producer's own end is pinned in
// `@objectstack/metadata-protocol`'s `protocol.metadata-store-outage.test.ts`.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { INTERNAL_ERROR_MESSAGE } from '@objectstack/types';
import { RestServer } from './rest-server';

const META_ITEM = '/api/v1/meta/:type/:name';

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

function setup(protocolOverrides: Record<string, unknown> = {}) {
    const protocol: any = {
        getDiscovery: vi.fn().mockResolvedValue({
            version: 'v0', routes: { data: '', metadata: '', ui: '', auth: '/auth' },
        }),
        getMetaTypes: vi.fn().mockResolvedValue([]),
        getMetaItems: vi.fn().mockResolvedValue([]),
        getMetaItem: vi.fn().mockResolvedValue({}),
        findData: vi.fn().mockResolvedValue([]),
        ...protocolOverrides,
    };
    const rest = new RestServer(
        createMockServer() as any,
        protocol,
        { api: { requireAuth: false } } as any,
    );
    (rest as any).resolveExecCtx = async () => ({ userId: 'u1' });
    rest.registerRoutes();
    return { rest, protocol };
}

async function callMetaItem(rest: any, params: any) {
    const res = makeRes();
    const route = rest.getRoutes().find((r: any) => r.method === 'GET' && r.path === META_ITEM);
    if (!route) throw new Error(`GET ${META_ITEM} route not registered`);
    await route.handler({ method: 'GET', params, query: {}, headers: {} }, res);
    return res;
}

/** The producer's outage envelope (metadata-protocol `getMetaItem`). */
function storeUnavailable() {
    return Object.assign(
        new Error(
            'The metadata store could not be read, so whether this item exists is unknown. '
            + 'Retry once the metadata database is reachable.',
        ),
        {
            code: 'SERVICE_UNAVAILABLE',
            status: 503,
            cause: new Error('connect ECONNREFUSED 10.0.0.5:5432'),
        },
    );
}

/** The producer's miss envelope (metadata-protocol `getMetaItemCached`). */
function itemNotFound() {
    return Object.assign(new Error('Metadata item object/acct not found'), {
        code: 'RESOURCE_NOT_FOUND',
        status: 404,
    });
}

let errorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => { errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => { errorSpy.mockRestore(); });

const loggedText = () => errorSpy.mock.calls.map((c: unknown[]) => JSON.stringify(c.map(String))).join('\n');

describe('[#5532] an unreadable metadata store reaches the client as a retryable 503', () => {
    it('503 + SERVICE_UNAVAILABLE, and the prose is withheld', async () => {
        const { rest } = setup({ getMetaItem: vi.fn().mockRejectedValue(storeUnavailable()) });

        const res = await callMetaItem(rest, { type: 'object', name: 'acct' });

        // `resolveErrorResponse`'s declared-status passthrough keeps the
        // producer's 503 and its `code`, and drops the sentence (#5437). The
        // code is what a client branches on, and 503 is what tells an SDK /
        // proxy this is worth retrying.
        expect(res.statusCode).toBe(503);
        expect(res.body).toEqual({ error: INTERNAL_ERROR_MESSAGE, code: 'SERVICE_UNAVAILABLE' });
    }, 60_000);

    it('the client is never told the item does not exist', async () => {
        const { rest } = setup({ getMetaItem: vi.fn().mockRejectedValue(storeUnavailable()) });

        const res = await callMetaItem(rest, { type: 'object', name: 'acct' });

        // The regression, in the words it used to ship: before this fix the
        // producer swallowed the driver error and the wire said "not found"
        // (400, verbatim, pre-#5489) or `500 INTERNAL_ERROR` (post-#5489).
        // Either way a console rendered "this object does not exist" during a
        // metadata-plane outage.
        const body = JSON.stringify(res.body).toLowerCase();
        expect(body).not.toContain('not found');
        expect(res.body.code).not.toBe('RESOURCE_NOT_FOUND');
        expect(res.statusCode).not.toBe(404);
    }, 60_000);

    it('the operator still gets the driver error, cause chain and all', async () => {
        const { rest } = setup({ getMetaItem: vi.fn().mockRejectedValue(storeUnavailable()) });

        await callMetaItem(rest, { type: 'object', name: 'acct' });

        // 503 is an *expected* lifecycle status, so `handleRouteError` does not
        // print "[REST] Unhandled error" — `logWithheldServerFault` prints the
        // withheld message instead (#5437). Withholding is only free of cost
        // while the words are still somewhere an operator can find them, and
        // "the metadata database is unreachable" is precisely the fault that
        // must be diagnosable.
        expect(loggedText()).toContain('5xx message withheld');
        expect(loggedText()).toContain('metadata store could not be read');
    }, 60_000);
});

describe('[#5532 / fix C] a real miss reaches the client as a coded 404', () => {
    it('404 + RESOURCE_NOT_FOUND, with the caller-facing message intact', async () => {
        const { rest } = setup({ getMetaItem: vi.fn().mockRejectedValue(itemNotFound()) });

        const res = await callMetaItem(rest, { type: 'object', name: 'acct' });

        expect(res.statusCode).toBe(404);
        expect(res.body.code).toBe('RESOURCE_NOT_FOUND');
        expect(res.body.error).toBe('Metadata item object/acct not found');
    }, 60_000);

    it('and is NOT logged as an unhandled fault — a miss is a normal outcome', async () => {
        const { rest } = setup({ getMetaItem: vi.fn().mockRejectedValue(itemNotFound()) });

        await callMetaItem(rest, { type: 'object', name: 'acct' });

        // `isExpectedDataStatus(404)` is true, so the stack trace that used to
        // accompany every stale Studio link stops printing.
        expect(loggedText()).not.toContain('[REST] Unhandled error');
    }, 60_000);

    it('the un-coded shape this replaces would have been an unattributable 500', async () => {
        // Documents WHY fix C was needed rather than asserting today's code:
        // the bare `new Error('Metadata item …/… not found')` the producer used
        // to throw carries neither `status` nor `code`, so it matched no branch
        // and fell out of `mapDataError`'s terminal `UNCLASSIFIED_FAULT`
        // (#5489). A plain miss answered as a server fault — and, before
        // #5489, as a 400 shipping the internal wording verbatim.
        const { rest } = setup({
            getMetaItem: vi.fn().mockRejectedValue(new Error('Metadata item object/acct not found')),
        });

        const res = await callMetaItem(rest, { type: 'object', name: 'acct' });

        expect(res.statusCode).toBe(500);
        expect(res.body).toEqual({ error: INTERNAL_ERROR_MESSAGE, code: 'INTERNAL_ERROR' });
    }, 60_000);
});
