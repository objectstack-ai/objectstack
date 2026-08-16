// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * install-local accepts a COMPILED stack bundle (`dist/objectstack.json`
 * shape: meta nested under `.manifest`, sections top-level) — what publish
 * uploads as the version payload — by flattening it to the app shape
 * ObjectQL's registerApp expects. Without the normalization every install
 * of a published compiled bundle failed with "Invalid manifest payload".
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MarketplaceInstallLocalPlugin } from './marketplace-install-local-plugin.js';
import { installerAuthService, withInstallerGrants } from './install-local-principal.fixtures.js';

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

function makeCtx(rawApp: any, services: Record<string, any>) {
    const hooks = new Map<string, any>();
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
    return { req: { url: 'http://localhost:3000/api/v1/marketplace/install-local', raw: new Request('http://localhost:3000/x'), json: async () => body, param: () => undefined }, json };
}

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mil-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); vi.restoreAllMocks(); });

describe('install-local compiled-bundle normalization', () => {
    it('flattens {manifest:{id…}, objects…} and registers the app shape', async () => {
        const register = vi.fn();
        const rawApp = makeRawApp();
        const { ctx, fire } = makeCtx(rawApp, {
            manifest: { register },
            auth: installerAuthService(),
            objectql: withInstallerGrants({ syncSchemas: async () => undefined }),
        });
        const plugin = new MarketplaceInstallLocalPlugin({ controlPlaneUrl: 'off', storageDir: dir });
        await plugin.start(ctx as any);
        await fire();

        const compiledBundle = {
            manifest: { id: 'app.acme.crm', namespace: 'crm', version: '2.0.0', type: 'app' },
            objects: [{ name: 'account', fields: {} }],
            views: [],
        };
        const res = await rawApp.routes.get('POST /api/v1/marketplace/install-local')!(
            makeC({ manifest: compiledBundle }),
        );
        expect(res.payload?.success).toBe(true);

        // The UI bundle registers at kernel:ready; the LAST register call is
        // the installed package — flattened: top-level id + sections.
        const installed = register.mock.calls.at(-1)![0];
        expect(installed.id).toBe('app.acme.crm');
        expect(installed.namespace).toBe('crm');
        expect(installed.version).toBe('2.0.0');
        expect(Array.isArray(installed.objects)).toBe(true);
        expect(installed.manifest).toBeUndefined();
    });

    it('leaves an already-flat manifest untouched', async () => {
        const register = vi.fn();
        const rawApp = makeRawApp();
        const { ctx, fire } = makeCtx(rawApp, {
            manifest: { register },
            auth: installerAuthService(),
            objectql: withInstallerGrants({ syncSchemas: async () => undefined }),
        });
        const plugin = new MarketplaceInstallLocalPlugin({ controlPlaneUrl: 'off', storageDir: dir });
        await plugin.start(ctx as any);
        await fire();

        const flat = { id: 'com.acme.flat', version: '1.0.0', objects: [] };
        const res = await rawApp.routes.get('POST /api/v1/marketplace/install-local')!(
            makeC({ manifest: flat }),
        );
        expect(res.payload?.success).toBe(true);
        expect(register.mock.calls.at(-1)![0].id).toBe('com.acme.flat');
    });
});
