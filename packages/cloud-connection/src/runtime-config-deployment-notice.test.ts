// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `features.deploymentNotice` is an OBSERVATION of the composition
 * (objectstack#34186).
 *
 * The Console's home asks `GET /api/settings/deployment/notice` of every
 * administrator. `SettingsServicePlugin` serves it when it mounts the settings
 * routes with its door; a hosted environment mounts the settings family itself
 * with no door, and the same route answers `503` there. Both arms mount the
 * route, so the route table cannot tell them apart: the door's registration
 * (`DEPLOYMENT_NOTICE_SERVICE`) can, and this flag reads it per request.
 *
 * The fixtures boot the REAL settings plugin, so the service name this package
 * spells and the one the settings package registers cannot drift apart with
 * this suite still green.
 */

import { describe, it, expect } from 'vitest';
import { SettingsServicePlugin, registerSettingsRoutes } from '@objectstack/service-settings';
import { RuntimeConfigPlugin, type RuntimeConfigPluginConfig } from './runtime-config-plugin.js';

type Handler = (...args: any[]) => any;

/** A raw app shaped like the Hono instance `getRawApp()` returns, and the adapter verbs the settings routes mount through. */
function createHttp() {
    const routes: Array<{ method: string; path: string }> = [];
    const handlers = new Map<string, Handler>();
    const record = (method: string) => (path: string, handler?: Handler) => {
        routes.push({ method, path });
        if (handler) handlers.set(`${method} ${path}`, handler);
    };
    const app = {
        routes,
        handlers,
        get: record('GET'),
        post: record('POST'),
        put: record('PUT'),
        delete: record('DELETE'),
        patch: record('PATCH'),
        head: record('HEAD'),
        all: record('ALL'),
        use: record('ALL'),
    };
    const server = { ...app, getRawApp: () => app, async listen() {}, async close() {} };
    return { app, server };
}

/**
 * Boot the settings plugin and the runtime config on one kernel-shaped context.
 * `hostMountsRoutes`: the hosted shape, where the settings plugin mounts no
 * routes and the host mounts the settings family itself, without a door.
 */
async function boot(opts: { hostMountsRoutes: boolean; runtimeConfig?: RuntimeConfigPluginConfig }) {
    const { app, server } = createHttp();
    const services: Record<string, unknown> = { 'http-server': server, 'http.server': server };
    const hooks: Array<() => Promise<void>> = [];
    const ctx: any = {
        logger: { info() {}, warn() {}, error() {}, debug() {} },
        registerService: (name: string, value: unknown) => {
            if (name in services) throw new Error(`Service '${name}' already registered`);
            services[name] = value;
        },
        getService: (name: string) => {
            if (!(name in services)) throw new Error(`[Kernel] Service '${name}' not found`);
            return services[name];
        },
        hook: (event: string, fn: () => Promise<void>) => {
            if (event === 'kernel:ready') hooks.push(fn);
        },
    };
    const settings = new SettingsServicePlugin({
        manifests: [],
        env: {},
        actionHandlers: {},
        ...(opts.hostMountsRoutes ? { registerRoutes: false } : {}),
    });
    const runtimeConfig = new RuntimeConfigPlugin({ controlPlaneUrl: '', singleEnvironment: true, ...opts.runtimeConfig });
    await settings.init(ctx);
    await runtimeConfig.init(ctx);
    await settings.start(ctx);
    await runtimeConfig.start(ctx);
    for (const hook of hooks) await hook();
    if (opts.hostMountsRoutes) {
        // The hosted shape: the settings family, mounted by the host, with no door.
        registerSettingsRoutes(server as any, services.settings as any, {
            contextFromRequest: () => ({ enforced: true, userId: 'usr_admin', permissions: ['setup.access', 'manage_platform_settings'] }),
        });
    }
    return { app, services };
}

/** Ask the mounted `/api/v1/runtime/config` handler for its payload. */
async function readConfig(app: ReturnType<typeof createHttp>['app']): Promise<any> {
    const handler = app.handlers.get('GET /api/v1/runtime/config');
    if (typeof handler !== 'function') throw new Error('runtime/config was never mounted');
    return handler({ req: { header: () => undefined }, json: (body: any) => body });
}

/** Ask the notice route as an administrator, the way the Console does, and return the status it answers. */
async function askNotice(app: ReturnType<typeof createHttp>['app']): Promise<number> {
    const handler = app.handlers.get('GET /api/settings/deployment/notice');
    if (typeof handler !== 'function') throw new Error('the notice route was never mounted');
    let status = 200;
    const res: any = {
        status(code: number) { status = code; return res; },
        json() { return res; },
        send() { return res; },
        header() { return res; },
    };
    await handler({ params: {}, query: {}, headers: {}, method: 'GET', path: '/api/settings/deployment/notice' }, res);
    return status;
}

describe('features.deploymentNotice — observed from the composition (objectstack#34186)', () => {
    it("reports true where SettingsServicePlugin mounted the routes with its door", async () => {
        const { app } = await boot({ hostMountsRoutes: false });
        expect((await readConfig(app)).features.deploymentNotice).toBe(true);
    });

    it('reports false for a host that mounts the settings routes without a door, whose notice answers 503', async () => {
        const { app } = await boot({ hostMountsRoutes: true });
        // Both arms mount the route: this one answers it 503.
        expect(await askNotice(app)).toBe(503);
        expect((await readConfig(app)).features.deploymentNotice).toBe(false);
    });

    it("a host's feature policy can neither claim the notice nor withhold it", async () => {
        const claimed = await boot({
            hostMountsRoutes: true,
            runtimeConfig: { resolveFeatures: () => ({ deploymentNotice: true }) },
        });
        expect((await readConfig(claimed.app)).features.deploymentNotice).toBe(false);
        const withheld = await boot({
            hostMountsRoutes: false,
            runtimeConfig: { resolveFeatures: () => ({ deploymentNotice: false }) },
        });
        expect((await readConfig(withheld.app)).features.deploymentNotice).toBe(true);
    });
});
