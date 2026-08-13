// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `features.marketplace` is an OBSERVATION, not a constant (#8356).
 *
 * It shipped as the literal `true`, so `/api/v1/runtime/config` told the
 * Console the catalog was browsable on every runtime that mounted
 * RuntimeConfigPlugin — including one where `MarketplaceProxyPlugin` was never
 * mounted because no control plane resolved. The SPA rendered a browse
 * affordance the runtime could not serve. That is #8343's declared-is-not-
 * enforced shape one key over, and it is why #8343 mounts install-local ALONE
 * on a cloud-less runtime: reporting install-local truthfully would have cost
 * a false browse claim.
 *
 * ## Why the negative direction is the whole point of this file
 *
 * A suite that only asserts the mounted case passes unchanged against the
 * hardcoded `true` it is meant to replace — it proves nothing about the very
 * defect. Every case here that expects `false` is load-bearing: revert the
 * derivation to `marketplace: true` and each one fails, while the positive
 * cases stay green.
 *
 * ## Why the fixtures are shaped the way they are
 *
 * The fake raw app mirrors what `getRawApp()` really hands back — a Hono
 * instance whose public `routes` array collects EVERY registration, verb
 * methods and `use()`/`all()` alike, framework-native mounts included.
 * Measured against hono@4.12.34:
 *
 *   app.use('/api/v1/*', mw)                 → { method: 'ALL',  path: '/api/v1/*' }
 *   app.all('/api/v1/marketplace/*', h)      → { method: 'ALL',  path: '/api/v1/marketplace/*' }
 *   app.post('/api/v1/marketplace/install-local', h)
 *                                            → { method: 'POST', path: '/api/v1/marketplace/install-local' }
 *
 * And the sibling plugins are the REAL ones, started against the REAL shared
 * app, rather than their route strings copied in here. That is deliberate: the
 * derivation keys on a path prefix the proxy owns, and a hand-spelled fixture
 * would keep agreeing with a stale copy of that spelling long after the proxy
 * changed it — the flag would flip to `false` in production with this suite
 * still green.
 */

import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { RuntimeConfigPlugin, type RuntimeConfigPluginConfig } from './runtime-config-plugin.js';
import { MarketplaceProxyPlugin } from './marketplace-proxy-plugin.js';
import { MarketplaceInstallLocalPlugin } from './marketplace-install-local-plugin.js';

interface RouteRecord { method: string; path: string }

interface HonoShapedApp {
    routes: RouteRecord[];
    handlers: Map<string, any>;
    get(path: string, handler?: any): void;
    post(path: string, handler?: any): void;
    put(path: string, handler?: any): void;
    delete(path: string, handler?: any): void;
    head(path: string, handler?: any): void;
    all(path: string, handler?: any): void;
    use(path: string, handler?: any): void;
}

/** A raw app shaped like the Hono instance `getRawApp()` returns. */
function createApp(): HonoShapedApp {
    const routes: RouteRecord[] = [];
    const handlers = new Map<string, any>();
    const record = (method: string) => (path: string, handler?: any) => {
        routes.push({ method, path });
        handlers.set(`${method} ${path}`, handler);
    };
    return {
        routes,
        handlers,
        get: record('GET'),
        post: record('POST'),
        put: record('PUT'),
        delete: record('DELETE'),
        head: record('HEAD'),
        all: record('ALL'),
        // Hono files middleware into the same ledger, under ALL.
        use: record('ALL'),
    };
}

/** Start a plugin against `app` and fire its `kernel:ready` hooks. */
async function startOn(app: unknown, plugin: { start(ctx: any): Promise<void> }): Promise<string[]> {
    const hooks: Array<() => Promise<void>> = [];
    const warnings: string[] = [];
    const services: Record<string, any> = {
        'http.server': { getRawApp: () => app },
        manifest: { register() {} },
        auth: { api: { getSession: async () => ({ user: { id: 'admin' } }) } },
        objectql: { syncSchemas: async () => undefined },
    };
    const ctx: any = {
        logger: { info() {}, warn: (m: unknown) => { warnings.push(String(m)); }, error() {} },
        getService: (name: string) => {
            const svc = services[name];
            if (svc === undefined) throw new Error(`no ${name}`);
            return svc;
        },
        hook: (_event: string, cb: () => Promise<void>) => { hooks.push(cb); },
    };
    await plugin.start(ctx);
    for (const cb of hooks) await cb();
    return warnings;
}

/** Ask the mounted `/api/v1/runtime/config` handler for its payload. */
async function readConfig(app: HonoShapedApp, host = ''): Promise<any> {
    const handler = app.handlers.get('GET /api/v1/runtime/config');
    if (typeof handler !== 'function') throw new Error('runtime/config was never mounted');
    return handler({
        req: { header: (n: string) => (n.toLowerCase() === 'host' ? host : undefined) },
        json: (body: any) => body,
    });
}

function runtimeConfig(config: RuntimeConfigPluginConfig = {}): RuntimeConfigPlugin {
    return new RuntimeConfigPlugin({ controlPlaneUrl: '', singleEnvironment: true, ...config });
}

/** A temp ledger dir so the real install-local plugin touches no shared state. */
function tempStorageDir(): string {
    return mkdtempSync(join(tmpdir(), 'os-8356-'));
}

describe('features.marketplace — mounted proxy reports true', () => {
    it('reports true when the REAL MarketplaceProxyPlugin is mounted on the same app', async () => {
        const app = createApp();
        await startOn(app, new MarketplaceProxyPlugin({ controlPlaneUrl: 'http://cloud.test', cacheDisabled: true }));
        await startOn(app, runtimeConfig());

        expect(await readConfig(app)).toMatchObject({ features: { marketplace: true } });
    });

    it('is read per request, so a proxy mounted AFTER this plugin still counts', async () => {
        // Plugin start() order across kernel:ready hooks is not guaranteed, so
        // a mount-time snapshot would report whichever hook happened to run
        // first. The handler runs long after every hook — that is the seam.
        const app = createApp();
        await startOn(app, runtimeConfig());
        expect(await readConfig(app)).toMatchObject({ features: { marketplace: false } });

        await startOn(app, new MarketplaceProxyPlugin({ controlPlaneUrl: 'http://cloud.test', cacheDisabled: true }));
        expect(await readConfig(app)).toMatchObject({ features: { marketplace: true } });
    });

    it('counts a NATIVE browse mount this package never installed', async () => {
        // The cloud control plane serves /api/v1/marketplace/packages from its
        // own route module with no proxy anywhere; the flag's meaning there is
        // already "reachable (proxy or native)". A proxy-specific signal would
        // report false on the one deployment that definitely has a catalog.
        const app = createApp();
        app.get('/api/v1/marketplace/packages', () => {});
        app.get('/api/v1/marketplace/packages/:id', () => {});
        await startOn(app, runtimeConfig());

        expect(await readConfig(app)).toMatchObject({ features: { marketplace: true } });
    });
});

describe('features.marketplace — no browse surface reports false', () => {
    it('reports false on a runtime with no marketplace mount at all', async () => {
        const app = createApp();
        await startOn(app, runtimeConfig());

        expect(await readConfig(app)).toMatchObject({ features: { marketplace: false } });
    });

    it('the cloud-less runtime reports installLocal truthfully WITHOUT claiming browse', async () => {
        // #8356's acceptance, and the reason #8343 could not mount this plugin
        // on an air-gapped runtime: the REAL install-local plugin mounted alone
        // must give the Console install-local and nothing else.
        const dir = tempStorageDir();
        try {
            const app = createApp();
            await startOn(app, new MarketplaceInstallLocalPlugin({ controlPlaneUrl: 'off', storageDir: dir }));
            await startOn(app, runtimeConfig({ installLocal: true }));

            const body = await readConfig(app);
            expect(body.features.installLocal).toBe(true);
            expect(body.features.marketplace).toBe(false);
            // The fixture is only meaningful if install-local really did mount.
            expect(app.routes.some((r) => r.path.startsWith('/api/v1/marketplace/install-local'))).toBe(true);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('broad middleware and an SPA catch-all are not evidence of a catalog', async () => {
        const app = createApp();
        app.use('/api/v1/*', () => {});
        app.get('/*', () => {});
        app.get('/api/v1/marketplaceish/packages', () => {}); // adjacent namespace
        await startOn(app, runtimeConfig());

        expect(await readConfig(app)).toMatchObject({ features: { marketplace: false } });
    });

    it('reports false — and warns once — when the raw app exposes no route table', async () => {
        // Do not claim a capability you could not verify; claiming it
        // unverified is the defect. The warning makes the downgrade traceable.
        const opaqueApp: any = {
            handlers: new Map<string, any>(),
            get(path: string, handler?: any) { this.handlers.set(`GET ${path}`, handler); },
        };
        const warnings = await startOn(opaqueApp, runtimeConfig());

        expect(await readConfig(opaqueApp)).toMatchObject({ features: { marketplace: false } });
        expect(warnings.filter((w) => w.includes('no route table'))).toHaveLength(1);
    });

    it('a host that knows better can still declare it through resolveFeatures', async () => {
        // The open-core seam is unchanged: the derivation is the BASE value,
        // not a veto, so an exotic adapter is not a dead end.
        const app = createApp();
        await startOn(app, runtimeConfig({ resolveFeatures: () => ({ marketplace: true }) }));

        expect(await readConfig(app)).toMatchObject({ features: { marketplace: true } });
    });
});
