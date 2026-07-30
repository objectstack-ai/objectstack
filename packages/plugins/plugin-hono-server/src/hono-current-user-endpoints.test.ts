// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #4073 — `registerStandardEndpoints` used to gate two unrelated things:
//
//   * DUPLICATE supply — raw `/data` C+R that `@objectstack/rest` also serves
//     (and, registering first, really serves), plus a discovery the dispatcher
//     and REST own (#4018).
//   * SOLE supply — `/auth/me/permissions`, `/auth/me/localization`, `/me/apps`.
//     Nothing else in the platform mounts these: `packages/rest` and
//     `packages/runtime` register no `/me/*` route, the console's whole
//     permission layer reads `/auth/me/permissions`, and `core`'s auth gate
//     allow-lists `/me/apps` + `/me/localization` as endpoints a gated user MUST
//     still reach. `os serve` gets them only via the flag's `true` default.
//
// So turning the flag off took the console down with it. These tests pin the
// split: the flag now covers the duplicate half only, and the current-user
// endpoints are registered whatever it says.

import { describe, it, expect, vi } from 'vitest';
import { HonoServerPlugin } from './hono-plugin';

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
async function boot(registerStandardEndpoints: boolean) {
    const plugin = new HonoServerPlugin({ port: 0, registerStandardEndpoints, cors: false });
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

describe('current-user endpoints are not gated by registerStandardEndpoints (#4073)', () => {
    it('mounts /me/* with the convenience surface OFF', async () => {
        const app = await boot(false);
        for (const route of ME_ROUTES) {
            expect(paths(app), `${route} must survive registerStandardEndpoints:false`).toContain(route);
        }
    });

    it('mounts /me/* with the convenience surface ON (unchanged for os serve)', async () => {
        const app = await boot(true);
        for (const route of ME_ROUTES) expect(paths(app)).toContain(route);
    });

    it('still gates the duplicate half — no /data CRUD, no /discovery when OFF', async () => {
        const app = await boot(false);
        const registered = paths(app);

        expect(registered).not.toContain('/api/v1/data/:object');
        expect(registered).not.toContain('/api/v1/discovery');
        expect(registered).not.toContain('/.well-known/objectstack');
    });

    it('registers the duplicate half when ON', async () => {
        const registered = paths(await boot(true));

        expect(registered).toContain('/api/v1/data/:object');
        expect(registered).toContain('/api/v1/discovery');
    });

    it('answers /me/* with the flag OFF instead of 404ing', async () => {
        const app = await boot(false);

        // No auth service is wired, so each endpoint takes its anonymous branch
        // — which is a real answer, not the "route does not exist" 404 the
        // console used to get when the flag was off.
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

    it('registers /me/* BEFORE the CRUD block — the order plugin-auth collides with', async () => {
        // plugin-auth mounts a TERMINAL `rawApp.all('/api/v1/auth/*')` from its
        // own kernel:ready hook, so `/auth/me/*` only wins the match by being
        // registered first. The split must not have moved these later.
        const registered = paths(await boot(true));
        const firstMe = registered.indexOf('/api/v1/auth/me/permissions');
        const firstData = registered.indexOf('/api/v1/data/:object');

        expect(firstMe).toBeGreaterThanOrEqual(0);
        expect(firstData).toBeGreaterThanOrEqual(0);
        expect(firstMe).toBeLessThan(firstData);
    });
});
