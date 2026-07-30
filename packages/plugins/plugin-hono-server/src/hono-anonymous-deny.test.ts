// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #2567 — the raw-hono standard `/data` endpoints must honour the same
// secure-by-default (`requireAuth`) anonymous-deny posture as the REST `/data`
// routes. Before the gate, these routes delegated straight to ObjectQL and were
// only *shadowed* when the REST plugin registered the same paths first — so the
// anonymous posture depended on plugin registration order. These tests drive the
// real routes on a real Hono app (no REST plugin in the picture) to prove the
// gate stands on its own.

import { describe, it, expect } from 'vitest';
import { HonoServerPlugin } from './hono-plugin';

/**
 * Boot a plugin and register ONLY the standard CRUD routes on its real Hono
 * app, then hand back the app so tests can drive HTTP requests directly. No
 * listening socket, no CORS/static — we exercise the data routes in isolation.
 */
function bootStandardEndpoints(opts: {
    restConfig?: { api?: { requireAuth?: boolean } };
    services: Record<string, unknown>;
}) {
    const plugin = new HonoServerPlugin({ port: 0, restConfig: opts.restConfig as any });
    const ctx: any = {
        logger: { info() {}, debug() {}, warn() {}, error() {} },
        getKernel: () => ({ getService: (n: string) => opts.services[n] }),
        registerService: () => {},
        hook: () => {},
        getService: (n: string) => {
            const s = opts.services[n];
            if (s === undefined) throw new Error(`no service: ${n}`);
            return s;
        },
    };
    (plugin as any).registerDiscoveryAndCrudEndpoints(ctx);
    return (plugin as any).server.getRawApp();
}

// ObjectQL stub — every read returns empty, every write echoes an id. Enough
// for the routes to reach a 200 once the gate has been cleared.
const objectql = {
    find: async () => [],
    insert: async () => ({ id: 'new-id' }),
};

// Auth stub — resolves a session ONLY when the request carries `x-test-user`,
// so the same boot serves both anonymous and authenticated requests.
const auth = {
    api: {
        getSession: async ({ headers }: { headers: Headers }) => {
            const uid = headers?.get?.('x-test-user');
            return uid ? { user: { id: uid }, session: {} } : null;
        },
    },
};

const REQ = 'http://localhost/api/v1/data/thing';

describe('raw-hono /data — anonymous-deny gate (#2567)', () => {
    it('secure-by-default (no restConfig): anonymous LIST is 401', async () => {
        const app = bootStandardEndpoints({ services: { objectql, auth } });
        const res = await app.request(REQ, { method: 'GET' });
        expect(res.status).toBe(401);
    });

    it('secure-by-default: anonymous GET-by-id is 401', async () => {
        const app = bootStandardEndpoints({ services: { objectql, auth } });
        const res = await app.request(`${REQ}/abc`, { method: 'GET' });
        expect(res.status).toBe(401);
    });

    it('secure-by-default: anonymous CREATE is 401', async () => {
        const app = bootStandardEndpoints({ services: { objectql, auth } });
        const res = await app.request(REQ, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: 'x' }),
        });
        expect(res.status).toBe(401);
    });

    it('an AUTHENTICATED caller is served (deny targets anonymity, not the route)', async () => {
        const app = bootStandardEndpoints({ services: { objectql, auth } });
        const res = await app.request(REQ, { method: 'GET', headers: { 'x-test-user': 'u1' } });
        expect(res.status).toBe(200);
    });

    it('there is no opt-out — an anonymous read is 401 regardless of config (#3963)', async () => {
        // `api.requireAuth: false` is retired: it no longer opens the surface.
        const app = bootStandardEndpoints({
            restConfig: { api: { requireAuth: false } as any },
            services: { objectql, auth },
        });
        const res = await app.request(REQ, { method: 'GET' });
        expect(res.status).toBe(401);
    });
});
