// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `features.installLocal` is an OBSERVATION, with the constructor option kept
 * only as a ceiling (#8388).
 *
 * #8356 derived `features.marketplace` from the serving app's route table and
 * stopped there — its acceptance list named that key alone. So the two flags
 * in one object were left answered by different rules, one observed and one
 * declared, and the declared one is the key #8343 actually measured wrong on a
 * real customer deployment:
 *
 *     {"features":{"installLocal":true,"marketplace":true, …}}
 *     GET  /api/v1/marketplace/install-local -> 404 {"error":"Not found"}
 *     POST /api/v1/marketplace/install-local -> 404 {"error":"Not found"}
 *
 * ## Why the negative direction is the whole point of this file
 *
 * A suite that only asserts the mounted case passes unchanged against the
 * constructor flag it is meant to replace — it proves nothing about the defect.
 * The load-bearing case is `reports false when the host DECLARED true and
 * mounted nothing`: that is #8343's payload exactly, and it is the one that
 * goes red the moment the derivation is reverted.
 *
 * ## Why the option is a ceiling and not a plain override
 *
 * A plain override would have honoured `true` upward, and the CLI's own frozen
 * `RUNTIME_CONFIG_OPTIONS` passes `installLocal: true` unconditionally — so the
 * derivation would have been inert on precisely the product path #8343
 * reported. Pinned in both directions below: `false` still lowers a mounted
 * `true` (the published option keeps a real effect, per the triage ruling that
 * it must not be removed), and `true` cannot raise an unmounted `false`.
 *
 * ## Why the fixtures mount the REAL plugin
 *
 * The derivation keys on a path prefix `MarketplaceInstallLocalPlugin` owns. A
 * hand-spelled fixture would keep agreeing with a stale copy of that spelling
 * long after the plugin changed it — the flag would flip to `false` in
 * production with this suite still green.
 */

import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { RuntimeConfigPlugin, type RuntimeConfigPluginConfig } from './runtime-config-plugin.js';
import { MarketplaceInstallLocalPlugin } from './marketplace-install-local-plugin.js';
import { installerAuthService, withInstallerGrants } from './install-local-principal.fixtures.js';
import { MarketplaceProxyPlugin } from './marketplace-proxy-plugin.js';

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
        auth: installerAuthService(),
        objectql: withInstallerGrants({ syncSchemas: async () => undefined }),
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
async function readConfig(app: HonoShapedApp): Promise<any> {
    const handler = app.handlers.get('GET /api/v1/runtime/config');
    if (typeof handler !== 'function') throw new Error('runtime/config was never mounted');
    return handler({
        req: { header: () => undefined },
        json: (body: any) => body,
    });
}

function runtimeConfig(config: RuntimeConfigPluginConfig = {}): RuntimeConfigPlugin {
    return new RuntimeConfigPlugin({ controlPlaneUrl: '', singleEnvironment: true, ...config });
}

/** A temp ledger dir so the real install-local plugin touches no shared state. */
function tempStorageDir(): string {
    return mkdtempSync(join(tmpdir(), 'os-8388-'));
}

/** Run `body` with a temp storage dir, cleaned up either way. */
async function withStorageDir(body: (dir: string) => Promise<void>): Promise<void> {
    const dir = tempStorageDir();
    try {
        await body(dir);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

function installLocalPlugin(dir: string): MarketplaceInstallLocalPlugin {
    return new MarketplaceInstallLocalPlugin({ controlPlaneUrl: 'off', storageDir: dir });
}

describe('features.installLocal — a mounted install-local surface reports true', () => {
    it('reports true from the REAL plugin alone, with NO constructor flag at all', async () => {
        // The option is not passed, so a green here can only come from the
        // route table. Under the old code this exact fixture reported `false`.
        await withStorageDir(async (dir) => {
            const app = createApp();
            await startOn(app, installLocalPlugin(dir));
            await startOn(app, runtimeConfig());

            expect(await readConfig(app)).toMatchObject({ features: { installLocal: true } });
            // The fixture is only meaningful if install-local really mounted.
            expect(app.routes.some((r) => r.path.startsWith('/api/v1/marketplace/install-local'))).toBe(true);
        });
    });

    it('is read per request, so a plugin mounted AFTER this one still counts', async () => {
        // Plugin start() order across kernel:ready hooks is not guaranteed, so
        // a mount-time snapshot would report whichever hook happened to run
        // first. The handler runs long after every hook — that is the seam.
        await withStorageDir(async (dir) => {
            const app = createApp();
            await startOn(app, runtimeConfig());
            expect(await readConfig(app)).toMatchObject({ features: { installLocal: false } });

            await startOn(app, installLocalPlugin(dir));
            expect(await readConfig(app)).toMatchObject({ features: { installLocal: true } });
        });
    });

    it('counts a sub-path mount on its own — the ledger need not carry the bare prefix', async () => {
        // `…/install-local/:manifestId` is a real registration of this plugin's
        // (DELETE, and the two sample-data POSTs). A predicate keyed on exact
        // equality would miss a runtime that mounted only those.
        const app = createApp();
        app.delete('/api/v1/marketplace/install-local/:manifestId', () => {});
        await startOn(app, runtimeConfig());

        expect(await readConfig(app)).toMatchObject({ features: { installLocal: true } });
    });
});

describe('features.installLocal — nothing mounted reports false', () => {
    it('THE #8343 PAYLOAD — reports false where the host DECLARED true and mounted nothing', async () => {
        // This is the measured defect, reproduced as a fixture: a host passes
        // installLocal: true to a runtime with no install-local route, and the
        // Console is told to render an affordance whose endpoint 404s. Revert
        // the derivation and this is the case that goes red.
        const app = createApp();
        await startOn(app, runtimeConfig({ installLocal: true }));

        expect(await readConfig(app)).toMatchObject({ features: { installLocal: false } });
        expect(app.routes.some((r) => r.path.startsWith('/api/v1/marketplace/install-local'))).toBe(false);
    });

    it('reports false on a runtime with no marketplace mount at all', async () => {
        const app = createApp();
        await startOn(app, runtimeConfig());

        expect(await readConfig(app)).toMatchObject({ features: { installLocal: false } });
    });

    it('broad middleware and an SPA catch-all are not evidence of an install route', async () => {
        const app = createApp();
        app.use('/api/v1/*', () => {});
        app.get('/*', () => {});
        await startOn(app, runtimeConfig({ installLocal: true }));

        expect(await readConfig(app)).toMatchObject({ features: { installLocal: false } });
    });

    it('an adjacent spelling is not the install-local namespace', async () => {
        // Segment boundary, not a bare startsWith: `…/install-locality` is
        // somebody else's route and claiming it would be this bug again.
        const app = createApp();
        app.get('/api/v1/marketplace/install-locality', () => {});
        await startOn(app, runtimeConfig({ installLocal: true }));

        expect(await readConfig(app)).toMatchObject({ features: { installLocal: false } });
    });

    it('reports false — and warns once — when the raw app exposes no route table', async () => {
        // Do not claim a capability you could not verify; claiming it
        // unverified is the defect. The warning makes the downgrade traceable,
        // and now has to name BOTH derived keys.
        const opaqueApp: any = {
            handlers: new Map<string, any>(),
            get(path: string, handler?: any) { this.handlers.set(`GET ${path}`, handler); },
        };
        const warnings = await startOn(opaqueApp, runtimeConfig({ installLocal: true }));

        expect(await readConfig(opaqueApp)).toMatchObject({ features: { installLocal: false } });
        expect(warnings.filter((w) => w.includes('features.installLocal'))).toHaveLength(1);
    });
});

describe('features.installLocal — the constructor option survives as a CEILING', () => {
    it('an explicit false LOWERS a mounted surface — the published option keeps a real effect', async () => {
        // The option is not being retired (hosts pass it today, and deleting a
        // published option is a maintainer-floor call). This is what it still
        // does: an operator hiding the affordance on a box that could serve it.
        await withStorageDir(async (dir) => {
            const app = createApp();
            await startOn(app, installLocalPlugin(dir));
            await startOn(app, runtimeConfig({ installLocal: false }));

            expect(app.routes.some((r) => r.path.startsWith('/api/v1/marketplace/install-local'))).toBe(true);
            expect(await readConfig(app)).toMatchObject({ features: { installLocal: false } });
        });
    });

    it('an explicit true cannot RAISE an unmounted surface — a ceiling, not a source', async () => {
        // The whole reason it is a ceiling: the CLI's own frozen
        // RUNTIME_CONFIG_OPTIONS passes installLocal: true unconditionally, so
        // honouring true upward would leave the derivation inert on exactly the
        // path #8343 measured.
        const app = createApp();
        await startOn(app, runtimeConfig({ installLocal: true }));

        expect(await readConfig(app)).toMatchObject({ features: { installLocal: false } });
    });

    it('an OMITTED option is not an opt-out — it defers to the observation', async () => {
        // Guards the `!== false` vs `!!` distinction in the constructor: the
        // old default read an absent option as `false`, which after the
        // derivation would have vetoed every truthful `true`.
        await withStorageDir(async (dir) => {
            const app = createApp();
            await startOn(app, installLocalPlugin(dir));
            await startOn(app, runtimeConfig({}));

            expect(await readConfig(app)).toMatchObject({ features: { installLocal: true } });
        });
    });

    it('a host that knows better can still declare it through resolveFeatures', async () => {
        // The open-core seam is unchanged and is what makes the ceiling safe:
        // the derivation is the BASE value, not a veto, so an adapter with no
        // observable route table is not a dead end. It outranks the ceiling
        // too — resolveFeatures merges last, as it does for every base flag.
        const app = createApp();
        await startOn(app, runtimeConfig({
            installLocal: false,
            resolveFeatures: () => ({ installLocal: true }),
        }));

        expect(await readConfig(app)).toMatchObject({ features: { installLocal: true } });
    });
});

describe('the two derived flags stay independent', () => {
    it('install-local alone reports installLocal WITHOUT claiming browse', async () => {
        // #8356 excludes the install-local paths from the browse predicate on
        // purpose; this is that exclusion observed from the other side.
        await withStorageDir(async (dir) => {
            const app = createApp();
            await startOn(app, installLocalPlugin(dir));
            await startOn(app, runtimeConfig());

            expect(await readConfig(app)).toMatchObject({
                features: { installLocal: true, marketplace: false },
            });
        });
    });

    it('a browse proxy alone reports marketplace WITHOUT claiming install-local', async () => {
        // The mirror image, and the case a shared predicate would have broken:
        // the REAL proxy mounts `/api/v1/marketplace/*`, which a naive
        // "anything under the marketplace namespace" rule would read as an
        // install route — re-creating #8343's 404 for the other key.
        const app = createApp();
        await startOn(app, new MarketplaceProxyPlugin({ controlPlaneUrl: 'http://cloud.test', cacheDisabled: true }));
        await startOn(app, runtimeConfig({ installLocal: true }));

        expect(await readConfig(app)).toMatchObject({
            features: { installLocal: false, marketplace: true },
        });
    });

    it('both mounted reports both', async () => {
        await withStorageDir(async (dir) => {
            const app = createApp();
            await startOn(app, installLocalPlugin(dir));
            await startOn(app, new MarketplaceProxyPlugin({ controlPlaneUrl: 'http://cloud.test', cacheDisabled: true }));
            await startOn(app, runtimeConfig());

            expect(await readConfig(app)).toMatchObject({
                features: { installLocal: true, marketplace: true },
            });
        });
    });
});
