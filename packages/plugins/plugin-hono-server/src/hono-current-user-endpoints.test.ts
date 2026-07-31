// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #4073 — the three current-user endpoints are this plugin's SOLE supply, and
// nothing may gate them.
//
// `packages/rest` and `packages/runtime` register no `/me/*` route at all. The
// console's whole permission layer reads `/auth/me/permissions`, and `core`'s
// auth gate allow-lists `/me/apps` + `/me/localization` as endpoints a gated
// user MUST still reach. They used to sit behind `registerStandardEndpoints`
// alongside a duplicate `/data` + discovery surface — one flag over two opposite
// things, so turning it off took the console down with it. The split landed
// first (#4144); the duplicate half has since been deleted outright, and these
// endpoints are all this plugin serves beyond the socket itself.
//
// These tests pin both halves of that end state: the `/me/*` routes mount on a
// plain boot, and nothing of the retired surface comes back.

import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import { HonoServerPlugin } from './hono-plugin';
import { currentUserRoutePaths, registerCurrentUserEndpoints } from './current-user-endpoints';

const ME_ROUTES = [
    '/api/v1/auth/me/permissions',
    '/api/v1/auth/me/localization',
    '/api/v1/me/apps',
];

/**
 * Boot a plugin through its real `start()` and fire the `kernel:ready` hooks it
 * registered — the actual wiring, not a hand-picked pair of method calls, so a
 * regression that re-gates the current-user endpoints is caught here.
 */
async function boot() {
    const plugin = new HonoServerPlugin({ port: 0, cors: false });
    const readyHooks: Array<() => unknown> = [];
    const ctx: any = {
        logger: { info() {}, debug() {}, warn() {}, error() {} },
        getKernel: () => ({ hasPlugin: () => false, getService: () => undefined }),
        registerService: () => {},
        hook: (event: string, fn: () => unknown) => {
            if (event === 'kernel:ready') readyHooks.push(fn);
        },
        getService: vi.fn(() => undefined),
    };

    await plugin.init(ctx);
    await plugin.start(ctx);
    for (const fn of readyHooks) await fn();

    return (plugin as any).server.getRawApp();
}

/** Registered paths on the live Hono app, ignoring middleware catch-alls. */
function paths(app: any): string[] {
    return (app.routes ?? []).map((r: any) => r.path);
}

describe('current-user endpoints are this plugin\'s own supply (#4073)', () => {
    it('mounts /me/* on a plain boot', async () => {
        const app = await boot();
        for (const route of ME_ROUTES) {
            expect(paths(app), `${route} must be mounted — this plugin is their only provider`).toContain(route);
        }
    });

    it('mounts nothing of the retired convenience surface', async () => {
        // The raw `/data` CRUD and the third discovery payload are gone (#4073);
        // their owners are @objectstack/rest and the runtime dispatcher. If any
        // of these come back, one route has two owners again (ADR-0076 D11).
        const registered = paths(await boot());

        expect(registered).not.toContain('/api/v1/data/:object');
        expect(registered).not.toContain('/api/v1/discovery');
        expect(registered).not.toContain('/.well-known/objectstack');
    });

    it('answers /me/* rather than 404ing', async () => {
        const app = await boot();

        // No auth service is wired, so each endpoint takes its anonymous branch
        // — which is a real answer, not the "route does not exist" 404 the
        // console used to get when these sat behind the retired flag.
        const permissions = await app.request('http://localhost/api/v1/auth/me/permissions');
        expect(permissions.status).toBe(200);
        expect(await permissions.json()).toEqual({ authenticated: false });

        const localization = await app.request('http://localhost/api/v1/auth/me/localization');
        expect(localization.status).toBe(200);
        expect(await localization.json()).toEqual({ authenticated: false });

        const apps = await app.request('http://localhost/api/v1/me/apps');
        expect(apps.status).toBe(200);
        expect(await apps.json()).toEqual({ apps: [] });
    });

    /**
     * The case that used to live here pinned `/me/*` registering BEFORE this
     * plugin's own CRUD block, because plugin-auth mounts a catch-all over
     * `/api/v1/auth/*` and `/auth/me/*` won the match only by registering
     * first. Both halves of that are gone: the CRUD block was deleted (#4073),
     * and #4088 made the auth catch-all fall through for paths better-auth does
     * not implement, so the surface no longer depends on `kernel.use()` order
     * at all. `plugin-auth/auth-catchall-fallthrough.test.ts` pins that
     * directly, registering the catch-all FIRST — the order that used to fail.
     */
});

// cloud#924 — #4079 freed these three from the wrong flag, but left the SUPPLY
// welded to this plugin. A host that stands up a bare `HonoHttpServer` instead
// of mounting the plugin got no provider at all: that is cloud's default
// (Vercel/serverless) `bootKernel` branch, whose `OS_NODE_SERVE=1` sibling
// mounts the real plugin — so the console's whole permission layer had a
// server-side answer on one startup path and a 404 on the other. Registration
// needs a Hono app and a service locator, not ownership of the socket, so the
// registrar is exported and both shapes call it.

/** A minimal locator: no services wired, so handlers take their anon branch. */
function bareCtx() {
    return {
        logger: { debug() {}, warn() {} },
        getService: vi.fn(() => undefined),
    };
}

describe('registerCurrentUserEndpoints is usable without the plugin (cloud#924)', () => {
    it('mounts and answers all three on a bare Hono app', async () => {
        const app = new Hono();

        expect(registerCurrentUserEndpoints({ rawApp: app, ctx: bareCtx() })).toBe(true);

        for (const route of ME_ROUTES) expect(paths(app)).toContain(route);
        // Answering is the point — before this, the serverless branch 404'd.
        const permissions = await app.request('http://localhost/api/v1/auth/me/permissions');
        expect(permissions.status).toBe(200);
        expect(await permissions.json()).toEqual({ authenticated: false });
        const localization = await app.request('http://localhost/api/v1/auth/me/localization');
        expect(localization.status).toBe(200);
        expect(await localization.json()).toEqual({ authenticated: false });
        const apps = await app.request('http://localhost/api/v1/me/apps');
        expect(apps.status).toBe(200);
        expect(await apps.json()).toEqual({ apps: [] });
    });

    it('honours a non-default prefix', () => {
        const app = new Hono();

        registerCurrentUserEndpoints({ rawApp: app, ctx: bareCtx(), prefix: '/api/v2' });

        expect(paths(app)).toEqual(expect.arrayContaining(currentUserRoutePaths('/api/v2')));
        expect(paths(app)).not.toContain('/api/v1/auth/me/permissions');
    });

    it('is idempotent — a second call registers nothing', () => {
        const app = new Hono();

        expect(registerCurrentUserEndpoints({ rawApp: app, ctx: bareCtx() })).toBe(true);
        expect(registerCurrentUserEndpoints({ rawApp: app, ctx: bareCtx() })).toBe(false);

        for (const route of ME_ROUTES) {
            expect(paths(app).filter((p) => p === route)).toHaveLength(1);
        }
    });

    it('re-registers the rest when a host owns only one of the three', () => {
        // `every`, not `some`: treating one host-owned path as "already provided"
        // would silently drop the other two.
        const app = new Hono();
        app.get('/api/v1/me/apps', (c) => c.json({ apps: ['host-owned'] }));

        expect(registerCurrentUserEndpoints({ rawApp: app, ctx: bareCtx() })).toBe(true);

        for (const route of ME_ROUTES) expect(paths(app)).toContain(route);
    });
});

describe('a host that pre-registers AND mounts the plugin gets ONE registration', () => {
    /**
     * cloud's `bootKernel` reaches the raw app before `kernel.bootstrap()`, so a
     * host call lands ahead of the plugin's `kernel:ready` hook. The host's
     * registration must win (it is the one that can see the host's own service
     * graph) and the plugin must not append dead duplicates behind it.
     */
    it('the host wins and the plugin adds no duplicate', async () => {
        const plugin = new HonoServerPlugin({ port: 0, cors: false });
        const rawApp = (plugin as any).server.getRawApp();
        const readyHooks: Array<() => unknown> = [];
        const ctx: any = {
            logger: { info() {}, debug() {}, warn() {}, error() {} },
            getKernel: () => ({ hasPlugin: () => false, getService: () => undefined }),
            registerService: () => {},
            hook: (event: string, fn: () => unknown) => {
                if (event === 'kernel:ready') readyHooks.push(fn);
            },
            getService: vi.fn(() => undefined),
        };

        // Host pre-registers with a recognizable body, the way cloud's bare
        // `HonoHttpServer` branch does before any plugin is used.
        rawApp.get('/api/v1/auth/me/permissions', (c: any) => c.json({ from: 'host' }));
        rawApp.get('/api/v1/auth/me/localization', (c: any) => c.json({ from: 'host' }));
        rawApp.get('/api/v1/me/apps', (c: any) => c.json({ from: 'host' }));

        await plugin.init(ctx);
        await plugin.start(ctx);
        for (const fn of readyHooks) await fn();

        for (const route of ME_ROUTES) {
            expect(paths(rawApp).filter((p) => p === route), route).toHaveLength(1);
        }
        const res = await rawApp.request('http://localhost/api/v1/auth/me/permissions');
        expect(await res.json()).toEqual({ from: 'host' });
    });
});
