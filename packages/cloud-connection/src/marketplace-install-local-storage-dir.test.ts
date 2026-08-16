// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #6721 — the install POST reports WHERE it cached the manifest.
 *
 * The two endpoints of this plugin had diverged on one fact. `GET
 * /api/v1/marketplace/install-local` (the console's Installed Apps list) served
 * `storageDir: this.storageDir`; the `POST` that performs the install did not,
 * so its only consumer — `os package install`, which runs on a DIFFERENT machine
 * and never touches this host's disk — had no resolved value to quote and could
 * only describe the ledger directory by literal. That literal is the ctor's
 * default, i.e. wrong for every host that configures `storageDir`.
 *
 * The non-default-`storageDir` case below is therefore the point of this file,
 * not a variation on it: it is exactly the configuration the old literal
 * misreported, and the only one that can tell "quotes the resolved value" apart
 * from "restates the default".
 *
 * `this.storageDir` is `this.ledger.dir` — already resolved by
 * `LocalManifestSource`'s ctor — so both endpoints must keep reading that one
 * field. A second derivation is how they diverged in the first place, which is
 * why the parity case asserts POST and GET are the same string rather than
 * asserting each against a separately-computed expectation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { MarketplaceInstallLocalPlugin } from './marketplace-install-local-plugin.js';
import { installerAuthService, withInstallerGrants } from './install-local-principal.fixtures.js';
import { DEFAULT_INSTALLED_PACKAGES_DIR } from './local-manifest-source.js';

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

function makeCtx(rawApp: any) {
    const hooks = new Map<string, any>();
    const services: Record<string, any> = {
        manifest: { register: vi.fn() },
        auth: installerAuthService(),
        objectql: withInstallerGrants({ syncSchemas: async () => undefined }),
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
    return {
        req: {
            url: 'http://localhost:3000/api/v1/marketplace/install-local',
            raw: new Request('http://localhost:3000/x'),
            json: async () => body,
            param: () => undefined,
        },
        json,
    };
}

/** Boot the plugin far enough that its routes are mounted. */
async function mount(storageDir?: string) {
    const rawApp = makeRawApp();
    const { ctx, fire } = makeCtx(rawApp);
    const plugin = new MarketplaceInstallLocalPlugin({ controlPlaneUrl: 'off', storageDir });
    await plugin.start(ctx as any);
    await fire();
    return {
        install: async (manifest: any) =>
            rawApp.routes.get('POST /api/v1/marketplace/install-local')!(makeC({ manifest })),
        list: async () =>
            rawApp.routes.get('GET /api/v1/marketplace/install-local')!(makeC({})),
    };
}

const MANIFEST = { id: 'com.acme.crm', name: 'Acme CRM', version: '1.0.0', objects: [] };

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mil-storage-dir-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); vi.restoreAllMocks(); });

describe('install-local POST response — storageDir', () => {
    it('carries the RESOLVED ledger directory of a host that configured a non-default storageDir', async () => {
        const { install } = await mount(dir);

        const res = await install(MANIFEST);

        expect(res.payload?.success).toBe(true);
        // The configured directory, resolved — not the ctor default. Both
        // halves matter: the first is the value the CLI must be able to quote,
        // the second is the assertion the old literal would have failed.
        expect(res.payload.data.storageDir).toBe(resolve(dir));
        expect(res.payload.data.storageDir).not.toContain(DEFAULT_INSTALLED_PACKAGES_DIR);
    });

    it('carries the ctor-default directory when the host configured nothing', async () => {
        // chdir into the temp dir first: with no `storageDir` the ledger
        // resolves against `process.cwd()`, and the install genuinely writes a
        // file there. Without this the case would litter the repo checkout.
        const prevCwd = process.cwd();
        process.chdir(dir);
        try {
            const { install } = await mount(undefined);

            const res = await install(MANIFEST);

            expect(res.payload?.success).toBe(true);
            expect(res.payload.data.storageDir).toBe(resolve(process.cwd(), DEFAULT_INSTALLED_PACKAGES_DIR));
        } finally {
            process.chdir(prevCwd);
        }
    });

    it('reports the same directory as the GET listing — one field, two endpoints', async () => {
        const { install, list } = await mount(dir);

        const installed = await install(MANIFEST);
        const listed = await list();

        expect(installed.payload.data.storageDir).toBe(listed.payload.data.storageDir);
        expect(typeof installed.payload.data.storageDir).toBe('string');
        expect(installed.payload.data.storageDir.length).toBeGreaterThan(0);
    });
});
