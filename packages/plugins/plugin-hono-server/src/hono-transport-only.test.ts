// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #4073, end state: this plugin is a TRANSPORT ADAPTER.
 *
 * It owns the socket, the middleware and the three current-user endpoints —
 * nothing else. The data and discovery APIs belong to `@objectstack/rest` and
 * the runtime dispatcher: one owner per route (ADR-0076 D11). The convenience
 * surface that duplicated them here, and the `registerStandardEndpoints` flag
 * that gated it, are deleted.
 *
 * This replaces the suite that pinned that flag's default. It pins the property
 * the flag was in the way of, plus the one behaviour the deletion adds:
 *
 * A host that mounts neither owner has NO data or discovery API. That is a real
 * composition, and its failure mode is a bare 404 with nothing pointing at the
 * cause. So the boot says it out loud — the same honesty rule #4018 applied to
 * the discovery cede — and stays silent when an owner IS mounted, so
 * transport-only compositions are not nagged toward something that no longer
 * exists.
 */

import { describe, it, expect } from 'vitest';
import { HonoServerPlugin } from './hono-plugin';

const RETIRED_ROUTES = ['/api/v1/data/:object', '/api/v1/discovery', '/.well-known/objectstack'];
const ME_ROUTES = [
    '/api/v1/auth/me/permissions',
    '/api/v1/auth/me/localization',
    '/api/v1/me/apps',
];

/**
 * Boot through the real `init()`/`start()` and fire the registered
 * `kernel:ready` hooks, with a warn recorder and a configurable `hasPlugin` so
 * the composed/bare distinction is testable.
 */
async function boot(installedPlugins: string[] = [], options: Record<string, unknown> = {}) {
    const plugin = new HonoServerPlugin({ port: 0, cors: false, ...options } as never);
    const warns: string[] = [];
    const readyHooks: Array<() => unknown> = [];
    const ctx: any = {
        logger: {
            info() {}, debug() {}, error() {},
            warn(msg: string) { warns.push(String(msg)); },
        },
        getKernel: () => ({
            hasPlugin: (name: string) => installedPlugins.includes(name),
            getService: () => undefined,
        }),
        registerService: () => {},
        hook: (event: string, fn: () => unknown) => {
            if (event === 'kernel:ready') readyHooks.push(fn);
        },
        getService: () => undefined,
    };

    await plugin.init(ctx);
    await plugin.start(ctx);
    for (const fn of readyHooks) await fn();

    return { app: (plugin as any).server.getRawApp(), warns };
}

const paths = (app: any): string[] => (app.routes ?? []).map((r: any) => r.path);
const pointer = (warns: string[]) => warns.filter((w) => w.includes('No data or discovery API'));

describe('#4073 end state — the plugin serves transport and /me/* only', () => {
    it('mounts the current-user endpoints and none of the retired surface', async () => {
        const registered = paths((await boot()).app);
        for (const route of ME_ROUTES) expect(registered).toContain(route);
        for (const route of RETIRED_ROUTES) {
            expect(registered, `${route} is owned by REST/the dispatcher now`).not.toContain(route);
        }
    });

    it('has no way to opt the retired surface back in', async () => {
        // The flag is GONE, not merely defaulted off. Passing the old option
        // must resurrect nothing — if this fails, the surface came back and a
        // route has two owners again.
        const registered = paths((await boot([], { registerStandardEndpoints: true })).app);
        for (const route of RETIRED_ROUTES) expect(registered).not.toContain(route);
    });

    it('a BARE boot says so loudly: one warn naming both owners', async () => {
        const hit = pointer((await boot([])).warns);
        expect(hit, 'a host with no API owner must be told why /data and /discovery are absent')
            .toHaveLength(1);
        // The message must carry the remedy, not just the diagnosis.
        expect(hit[0]).toContain('@objectstack/rest');
        expect(hit[0]).toContain('@objectstack/runtime');
        expect(hit[0]).toContain('#4073');
    });

    it('a REST-composed boot stays quiet', async () => {
        expect(pointer((await boot(['com.objectstack.rest.api'])).warns)).toHaveLength(0);
    });

    it('a dispatcher-composed boot stays quiet', async () => {
        expect(pointer((await boot(['com.objectstack.runtime.dispatcher'])).warns)).toHaveLength(0);
    });
});
