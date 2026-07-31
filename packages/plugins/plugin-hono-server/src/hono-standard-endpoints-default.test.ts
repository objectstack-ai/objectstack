// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #4073 — the DEFAULT of `registerStandardEndpoints` is `false`.
 *
 * The sibling suite (`hono-current-user-endpoints.test.ts`) pins the flag's two
 * EXPLICIT positions. This one pins the position nobody writes down: a host
 * that does not pass the option at all. Defaults are invisible at call sites —
 * this issue's first correction was literally "I checked who passes the option,
 * not who relies on the default" — so the default's behavior gets its own pins
 * rather than riding on the explicit-`false` ones and hoping the constructor
 * spread never drifts.
 *
 * Also pinned: the boot pointer. The flip is a no-op for a composed host
 * (#4260: byte-identical answers with REST/the dispatcher mounted either way);
 * the one composition it changes is a BARE host that mounted none of the three,
 * which used to inherit `/data` + `/discovery` implicitly and now 404s. That
 * absence must be LOUD — a warn naming the flag and the remedy — because a
 * silent 404 is exactly the shape of failure this session of work kept paying
 * for (`--with-ui` reusing a stale dist, CI green while `objectstack dev` sat
 * dead). And it must stay QUIET when a real API owner is mounted, so
 * transport-only compositions are not nagged into cargo-culting the flag back.
 */

import { describe, it, expect } from 'vitest';
import { HonoServerPlugin } from './hono-plugin';

const SURFACE_ROUTES = ['/api/v1/data/:object', '/api/v1/discovery', '/.well-known/objectstack'];
const ME_ROUTES = [
    '/api/v1/auth/me/permissions',
    '/api/v1/auth/me/localization',
    '/api/v1/me/apps',
];

/**
 * Boot through the real `init()`/`start()` and fire the registered
 * `kernel:ready` hooks — mirrors the sibling suite, plus a warn recorder and a
 * configurable `hasPlugin` so the composed/bare distinction is testable.
 */
async function boot(opts: {
    pluginOptions?: ConstructorParameters<typeof HonoServerPlugin>[0];
    installedPlugins?: string[];
}) {
    const plugin = new HonoServerPlugin({ port: 0, cors: false, ...opts.pluginOptions });
    const warns: string[] = [];
    const readyHooks: Array<() => unknown> = [];
    const ctx: any = {
        logger: {
            info() {}, debug() {}, error() {},
            warn(msg: string) { warns.push(String(msg)); },
        },
        getKernel: () => ({
            hasPlugin: (name: string) => (opts.installedPlugins ?? []).includes(name),
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

describe('registerStandardEndpoints defaults to OFF (#4073)', () => {
    it('a host that does not pass the option gets no convenience surface — and keeps /me/*', async () => {
        const { app } = await boot({});
        const registered = paths(app);
        for (const route of SURFACE_ROUTES) {
            expect(registered, `${route} must NOT mount by default — the surface is opt-in now`)
                .not.toContain(route);
        }
        // The flip must not take the unconditional endpoints with it.
        for (const route of ME_ROUTES) expect(registered).toContain(route);
    });

    it('explicit opt-in still mounts the legacy surface during the deprecation window', async () => {
        const { app } = await boot({ pluginOptions: { registerStandardEndpoints: true } });
        const registered = paths(app);
        for (const route of SURFACE_ROUTES) expect(registered).toContain(route);
    });

    it('a BARE boot says so loudly: one warn naming the flag and the remedy', async () => {
        const { warns } = await boot({ installedPlugins: [] });
        const pointer = warns.filter((w) => w.includes('registerStandardEndpoints'));
        expect(pointer, 'a bare host must be told why /data and /discovery are absent').toHaveLength(1);
        // The message must carry the remedy, not just the diagnosis.
        expect(pointer[0]).toContain('@objectstack/rest');
        expect(pointer[0]).toContain('#4073');
    });

    it('a COMPOSED boot stays quiet — REST owns the routes, nothing is missing', async () => {
        const { warns } = await boot({ installedPlugins: ['com.objectstack.rest.api'] });
        expect(warns.filter((w) => w.includes('registerStandardEndpoints'))).toHaveLength(0);
    });

    it('a dispatcher-composed boot stays quiet too', async () => {
        const { warns } = await boot({ installedPlugins: ['com.objectstack.runtime.dispatcher'] });
        expect(warns.filter((w) => w.includes('registerStandardEndpoints'))).toHaveLength(0);
    });

    it('opting in silences the pointer — the legacy surface IS the data API then', async () => {
        const { warns } = await boot({
            pluginOptions: { registerStandardEndpoints: true },
            installedPlugins: [],
        });
        expect(warns.filter((w) => w.includes('registerStandardEndpoints'))).toHaveLength(0);
    });
});
