// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #4018 — the standard-endpoints convenience surface used to serve a fully
// STATIC discovery: a hardcoded `routes` table listing auth/packages/analytics/
// workflow/automation/ai/notifications/i18n/storage/ui whether or not anything
// mounted them. That is the "advertise a route that 404s" class ADR-0076 D12
// exists to kill, and it put this surface out of step with the two real
// discovery builders (the dispatcher's `getDiscoveryInfo`, the protocol's
// `getDiscovery`), which both compute per service.
//
// These tests drive the REAL Hono app the plugin builds — no mocked route
// table — so what they assert about "is this route mounted" is what a request
// would actually find.

import { describe, it, expect } from 'vitest';
import { HonoServerPlugin } from './hono-plugin';

const REST_API_PLUGIN = 'com.objectstack.rest.api';
const RUNTIME_DISPATCHER_PLUGIN = 'com.objectstack.runtime.dispatcher';

/**
 * Register the standard endpoints on a real Hono app and hand it back so tests
 * can drive HTTP requests directly. `installedPlugins` seeds `kernel.hasPlugin`,
 * which is how this surface decides whether a real discovery owner is present.
 */
function bootStandardEndpoints(installedPlugins: string[] = []) {
    const plugin = new HonoServerPlugin({ port: 0 });
    const ctx: any = {
        logger: { info() {}, debug() {}, warn() {}, error() {} },
        getKernel: () => ({
            hasPlugin: (name: string) => installedPlugins.includes(name),
            getService: () => undefined,
        }),
        registerService: () => {},
        hook: () => {},
        getService: () => undefined,
    };
    (plugin as any).registerDiscoveryAndCrudEndpoints(ctx);
    return (plugin as any).server.getRawApp();
}

async function discoveryRoutes(app: any): Promise<Record<string, string>> {
    const res = await app.request('http://localhost/api/v1/discovery');
    expect(res.status).toBe(200);
    return (await res.json()).data.routes;
}

describe('standalone discovery — routes are computed, never hardcoded (#4018)', () => {
    it('advertises nothing for services this host does not mount', async () => {
        const app = bootStandardEndpoints();
        const routes = await discoveryRoutes(app);

        // Every one of these was advertised unconditionally by the old static
        // table; on a bare host each 404s, so none may be advertised now.
        for (const family of [
            'metadata', 'packages', 'analytics', 'workflow', 'automation',
            'ai', 'notifications', 'i18n', 'storage', 'ui',
        ]) {
            expect(routes[family], `${family} advertised but nothing mounts it`).toBeUndefined();
        }
    });

    it('advertises the families this surface really mounts, and they answer', async () => {
        const app = bootStandardEndpoints();
        const routes = await discoveryRoutes(app);

        // The block mounts /data/:object CRUD and the /auth/me/* helpers, so
        // both bases genuinely carry routes. (`/auth` on a bare host is only
        // those helpers — the sign-in surface arrives with plugin-auth.)
        expect(routes.data).toBe('/api/v1/data');
        expect(routes.auth).toBe('/api/v1/auth');

        // Not a 404: the advertised base really has a live endpoint under it.
        const res = await app.request('http://localhost/api/v1/data/thing');
        expect(res.status).not.toBe(404);
    });

    it('picks up a family once another plugin mounts it — including a wildcard', async () => {
        const app = bootStandardEndpoints();
        // How plugin-auth / the dispatcher really mount: a wildcard under the
        // family base, and a concrete child route.
        app.all('/api/v1/i18n/*', (c: any) => c.json({}));
        app.post('/api/v1/analytics/query', (c: any) => c.json({}));

        const routes = await discoveryRoutes(app);
        expect(routes.i18n).toBe('/api/v1/i18n');
        expect(routes.analytics).toBe('/api/v1/analytics');
    });

    it('reflects a mount that lands AFTER discovery is wired (not snapshotted)', async () => {
        const app = bootStandardEndpoints();

        // Sibling plugins keep registering through the rest of kernel:ready —
        // i.e. after this hook wired `/discovery` — and Hono seals its matcher
        // on the first request, so a mount can only ever arrive in this window.
        // A table built at wiring time would miss it; one built per request
        // does not.
        app.get('/api/v1/workflow/definitions', (c: any) => c.json({}));

        expect((await discoveryRoutes(app)).workflow).toBe('/api/v1/workflow');
    });

    it('does not count a wildcard mounted ABOVE the family base', async () => {
        const app = bootStandardEndpoints();
        // Global middleware and a prefix-wide wildcard match every path but
        // mount no family — treating them as a mount would re-advertise the
        // whole table, which is the bug.
        app.use('*', async (_c: any, next: any) => next());
        app.use('/api/v1/*', async (_c: any, next: any) => next());

        const routes = await discoveryRoutes(app);
        expect(routes.storage).toBeUndefined();
        expect(routes.ai).toBeUndefined();
    });

    it('never advertises realtime — no HTTP surface exists for it (D12, #2462)', async () => {
        const app = bootStandardEndpoints();
        expect((await discoveryRoutes(app)).realtime).toBeUndefined();
    });

    it('still reports transactionalBatch=false — /batch ships with @objectstack/rest (#3298)', async () => {
        const app = bootStandardEndpoints();
        const res = await app.request('http://localhost/api/v1/discovery');
        const body = await res.json();

        expect(body.data.capabilities.transactionalBatch).toEqual({ enabled: false });
        expect((await app.request('http://localhost/api/v1/batch', { method: 'POST' })).status).toBe(404);
    });
});

describe('standalone discovery — single owner (ADR-0076 D11 / OQ#9)', () => {
    it('cedes /discovery AND /.well-known to the dispatcher when it is installed', async () => {
        const app = bootStandardEndpoints([RUNTIME_DISPATCHER_PLUGIN]);

        // The dispatcher registers both during plugin start() — before this
        // kernel:ready hook — so it already served them; we must not publish a
        // third payload behind it.
        expect((await app.request('http://localhost/api/v1/discovery')).status).toBe(404);
        expect((await app.request('http://localhost/.well-known/objectstack')).status).toBe(404);
    });

    it('cedes /discovery to @objectstack/rest but keeps /.well-known (REST never registers it)', async () => {
        const app = bootStandardEndpoints([REST_API_PLUGIN]);

        expect((await app.request('http://localhost/api/v1/discovery')).status).toBe(404);

        const wellKnown = await app.request('http://localhost/.well-known/objectstack');
        expect(wellKnown.status).toBe(302);
        expect(wellKnown.headers.get('location')).toBe('/api/v1/discovery');
    });

    it('owns both when no real discovery plugin is on the kernel', async () => {
        const app = bootStandardEndpoints();

        expect((await app.request('http://localhost/api/v1/discovery')).status).toBe(200);
        expect((await app.request('http://localhost/.well-known/objectstack')).status).toBe(302);
    });
});
