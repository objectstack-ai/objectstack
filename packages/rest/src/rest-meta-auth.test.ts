// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.
//
// Regression coverage for the metadata-route auth gate. The `/meta/*` routes
// were registered WITHOUT the `enforceAuth` call the `/data` routes have, so on
// a `requireAuth` deployment an anonymous caller could read object/field
// schemas (system-object schemas on a tenant-less host — a public leak).
// registerMetadataEndpoints now wraps every meta route so it inherits the same
// gate; these tests lock that in.

import { describe, it, expect, vi } from 'vitest';
import { RestServer } from './rest-server';

const makeServer = () => ({
    get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(),
    use: vi.fn(), listen: vi.fn(), close: vi.fn(),
});

const makeRes = () => {
    const state: any = { status: 200, body: undefined };
    const res: any = {
        status: (c: number) => { state.status = c; return res; },
        json: (b: any) => { state.body = b; return res; },
        header: () => res,
        send: () => {},
    };
    return { res, state };
};

// The list handler for `GET /meta/:type` — the exact route the leak probe hit.
const metaListHandler = (rest: RestServer) => {
    const route = rest
        .getRoutes()
        .find((r) => r.method === 'GET' && /\/meta\/:type$/.test(r.path));
    if (!route) throw new Error('GET /meta/:type route not registered');
    return route.handler as (req: any, res: any) => Promise<void>;
};

describe('RestServer metadata routes — requireAuth gate', () => {
    it('401s an anonymous caller when requireAuth is on', async () => {
        const protocol: any = { getMetaItems: vi.fn().mockResolvedValue({ type: 'object', items: [] }) };
        const rest = new RestServer(makeServer() as any, protocol, { api: { requireAuth: true } } as any);
        rest.registerRoutes();
        const handler = metaListHandler(rest);

        const { res, state } = makeRes();
        await handler({ method: 'GET', params: { type: 'object' }, query: {}, headers: {} }, res);

        expect(state.status).toBe(401);
        expect(state.body?.error).toBe('UNAUTHENTICATED');
        // The gate short-circuits BEFORE the schema read — nothing leaked.
        expect(protocol.getMetaItems).not.toHaveBeenCalled();
    });

    it('lets an authenticated caller read metadata (gate passes through)', async () => {
        const protocol: any = { getMetaItems: vi.fn().mockResolvedValue({ type: 'object', items: [{ name: 'sys_metadata' }] }) };
        const rest = new RestServer(makeServer() as any, protocol, { api: { requireAuth: true } } as any);
        // A resolved session — the same shape resolveExecCtx yields for a
        // signed-in request (per-env session via hostname / scoped id).
        (rest as any).resolveExecCtx = vi.fn().mockResolvedValue({ userId: 'u1' });
        rest.registerRoutes();
        const handler = metaListHandler(rest);

        const { res, state } = makeRes();
        await handler({ method: 'GET', params: { type: 'object' }, query: {}, headers: {} }, res);

        expect(state.status).not.toBe(401);
        expect(protocol.getMetaItems).toHaveBeenCalled();
    });

    it('serves anonymously when requireAuth is off (unchanged public behaviour)', async () => {
        const protocol: any = { getMetaItems: vi.fn().mockResolvedValue({ type: 'object', items: [] }) };
        const rest = new RestServer(makeServer() as any, protocol, { api: { requireAuth: false } } as any);
        rest.registerRoutes();
        const handler = metaListHandler(rest);

        const { res, state } = makeRes();
        await handler({ method: 'GET', params: { type: 'object' }, query: {}, headers: {} }, res);

        expect(state.status).not.toBe(401);
        expect(protocol.getMetaItems).toHaveBeenCalled();
    });
});
