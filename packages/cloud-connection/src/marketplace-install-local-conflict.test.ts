// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * findConflict: an ORPHANED marketplace install (registered in the engine but
 * with no ledger entry on disk — e.g. a half-finished upgrade left the entry as
 * a `.bak`) must NOT be mistaken for user/config code. Previously such a state
 * returned 'user-code' and the install endpoint refused the upgrade with a
 * misleading "defined by this runtime's local code" 409. It now resolves to
 * 'marketplace' so the upgrade can overwrite it. Genuine user code (present in
 * the registry at boot, before rehydrate) is still protected.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MarketplaceInstallLocalPlugin } from './marketplace-install-local-plugin.js';

type Handler = (c: any) => Promise<any>;

function makeRawApp() {
    const routes = new Map<string, Handler>();
    return {
        routes,
        get: (p: string, h: Handler) => routes.set(`GET ${p}`, h),
        post: (p: string, h: Handler) => routes.set(`POST ${p}`, h),
        delete: (p: string, h: Handler) => routes.set(`DELETE ${p}`, h),
    };
}

/**
 * ctx whose `objectql` exposes a registry backed by `registry` (an array). The
 * `manifest.register()` mock pushes into it, so hot-registering a manifest makes
 * the engine "know" it — exactly what findConflict reads via getAllPackages().
 */
function makeCtx(rawApp: any, registry: any[]) {
    const hooks = new Map<string, any>();
    const services: Record<string, any> = {
        manifest: { register: (m: any) => registry.push({ manifest: m }) },
        auth: { api: { getSession: async () => ({ user: { id: 'admin' } }) } },
        objectql: { syncSchemas: async () => undefined, registry: { getAllPackages: () => registry } },
        metadata: {},
    };
    return {
        ctx: {
            hook: (e: string, h: any) => hooks.set(e, h),
            getService: (name: string) => {
                if (name === 'http-server') return { getRawApp: () => rawApp };
                const svc = services[name];
                if (svc === undefined) throw new Error(`no ${name}`);
                return svc;
            },
            logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
        },
        fire: async () => { await hooks.get('kernel:ready')?.(); },
    };
}

function makeC(body: any) {
    const json = vi.fn((payload: any, status?: number) => ({ payload, status: status ?? 200 }));
    return { req: { url: 'http://localhost:3000/x', raw: new Request('http://localhost:3000/x'), json: async () => body, param: () => undefined }, json };
}

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mil-conflict-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); vi.restoreAllMocks(); });

const MANIFEST = (id: string, version = '1.0.0') => ({ id, version, objects: [] });

describe('findConflict — orphaned ledger vs real user code', () => {
    it('refuses to overwrite genuine user/config code (registered at boot)', async () => {
        const rawApp = makeRawApp();
        // AppPlugin-style local code present in the registry BEFORE kernel:ready.
        const registry: any[] = [{ manifest: { id: 'app.user.foo', objects: [] } }];
        const { ctx, fire } = makeCtx(rawApp, registry);
        const plugin = new MarketplaceInstallLocalPlugin({ controlPlaneUrl: 'off', storageDir: dir });
        await plugin.start(ctx as any);
        await fire(); // captures bootUserCodeIds = { app.user.foo }

        const res = await rawApp.routes.get('POST /api/v1/marketplace/install-local')!(
            makeC({ manifest: MANIFEST('app.user.foo') }),
        );
        expect(res.status).toBe(409);
        expect(res.payload?.error?.code).toBe('manifest_conflict');
    });

    it('allows upgrading an orphaned marketplace install (registered, ledger entry gone)', async () => {
        const rawApp = makeRawApp();
        const registry: any[] = []; // empty at boot → empty user-code snapshot
        const { ctx, fire } = makeCtx(rawApp, registry);
        const plugin = new MarketplaceInstallLocalPlugin({ controlPlaneUrl: 'off', storageDir: dir });
        await plugin.start(ctx as any);
        await fire();

        const install = rawApp.routes.get('POST /api/v1/marketplace/install-local')!;

        // First install: succeeds, writes a ledger entry, registers the manifest.
        const first = await install(makeC({ manifest: MANIFEST('app.mk.bar', '1.0.0') }));
        expect(first.payload?.success).toBe(true);
        expect(registry.some((p) => p.manifest.id === 'app.mk.bar')).toBe(true);

        // Orphan it: drop the ledger file but leave it registered in the engine.
        for (const f of readdirSync(dir)) rmSync(join(dir, f));

        // Re-install (upgrade): must NOT be refused as "user-code".
        const second = await install(makeC({ manifest: MANIFEST('app.mk.bar', '1.0.1') }));
        expect(second.status).not.toBe(409);
        expect(second.payload?.success).toBe(true);
        expect(second.payload?.error?.code).not.toBe('manifest_conflict');
    });

    it('still treats a fresh, never-seen manifest as a clean install', async () => {
        const rawApp = makeRawApp();
        const registry: any[] = [];
        const { ctx, fire } = makeCtx(rawApp, registry);
        const plugin = new MarketplaceInstallLocalPlugin({ controlPlaneUrl: 'off', storageDir: dir });
        await plugin.start(ctx as any);
        await fire();

        const res = await rawApp.routes.get('POST /api/v1/marketplace/install-local')!(
            makeC({ manifest: MANIFEST('app.brand.new') }),
        );
        expect(res.payload?.success).toBe(true);
    });
});
