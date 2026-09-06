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

describe('RestServer metadata routes — anonymous-deny gate (#3963)', () => {
    it('401s an anonymous caller (unconditional — no opt-out)', async () => {
        const protocol: any = { getMetaItems: vi.fn().mockResolvedValue({ type: 'object', items: [] }) };
        const rest = new RestServer(makeServer() as any, protocol, {} as any);
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
        const rest = new RestServer(makeServer() as any, protocol, {} as any);
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

    // [#15542 / #15854] The per-item family's later members register through
    // `registerPerItemRoute` rather than by a direct `this.routeManager.register(`
    // call. That helper reads `this.routeManager` at CALL time, so it registers
    // through the same `guardedRouteManager` swap the direct sites do — but that
    // is a source argument, and the gate is worth a MEASUREMENT. Without this
    // case the whole helper-routed half of the surface (`PUT`, `DELETE`,
    // `/history`, `/audit`, `/diff`, `/published`, `/publish`, `/rollback`) had
    // no test proving it is still anonymously denied, and a future refactor that
    // captured `this.routeManager` at definition time would register all eight
    // past the gate with every existing test still green.
    //
    // It is also what licenses `authz-probe-blind-spot.census.ts` counting those
    // 8 as REACHABLE by `meta:rest-server.ts:registerMetadataEndpoints`.
    it('401s an anonymous helper-routed per-item route — the gate travels with `registerPerItemRoute` (#15542)', async () => {
        const protocol: any = { historyMetaItem: vi.fn().mockResolvedValue({ events: [] }) };
        const rest = new RestServer(makeServer() as any, protocol, {} as any);
        rest.registerRoutes();
        const route = rest
            .getRoutes()
            .find((r) => r.method === 'GET' && /\/meta\/:type\/:name\/history$/.test(r.path));
        if (!route) throw new Error('GET /meta/:type/:name/history route not registered');

        const { res, state } = makeRes();
        await (route.handler as (req: any, res: any) => Promise<void>)(
            { method: 'GET', params: { type: 'object', name: 'sys_metadata' }, query: {}, headers: {} },
            res,
        );

        expect(state.status).toBe(401);
        expect(state.body?.error).toBe('UNAUTHENTICATED');
        // Short-circuited BEFORE the history read — the per-org event log did
        // not leak, which is the same property the direct sites are pinned for.
        expect(protocol.historyMetaItem).not.toHaveBeenCalled();
    });

    it('still 401s an anonymous /meta/object — the opt-out is retired (#3963)', async () => {
        // `api.requireAuth: false` used to serve object schemas anonymously. The
        // opt-out is gone: object metadata is never public. (Only the book/doc
        // read surface is anonymously reachable, and only for `audience:'public'`
        // — proven in meta-public-book-grant.test.ts.)
        const protocol: any = { getMetaItems: vi.fn().mockResolvedValue({ type: 'object', items: [] }) };
        const rest = new RestServer(makeServer() as any, protocol, {} as any);
        rest.registerRoutes();
        const handler = metaListHandler(rest);

        const { res, state } = makeRes();
        await handler({ method: 'GET', params: { type: 'object' }, query: {}, headers: {} }, res);

        expect(state.status).toBe(401);
        expect(protocol.getMetaItems).not.toHaveBeenCalled();
    });
});
