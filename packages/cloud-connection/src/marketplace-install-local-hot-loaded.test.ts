// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #22695 — `POST /api/v1/marketplace/install-local` answers `hotLoaded` from
 * what its hot-register (step 3, `manifest.register`) actually did.
 *
 * ## What was wrong
 *
 * The answer wrote `hotLoaded: true` as a literal. A cloud-fetched manifest
 * whose register throws takes the LENIENT path — the install still persists its
 * ledger entry and answers `200`, and the package loads at the next restart —
 * so that answer told its caller the running kernel held a package it did not.
 * The console read it as "the app should now appear" and refreshed an app list
 * that did not have the app.
 *
 * ## What these cases pin
 *
 *   - the lenient path: `200`, `hotLoaded: false`, the register error's message
 *     as `hotLoadError`, the ledger entry written (the path stays lenient — ⛔
 *     whether it should is not decided here), and the note no longer claims the
 *     app is available;
 *   - CONTROL, a register that resolves: `hotLoaded: true` and NO `hotLoadError`
 *     key at all — omitted, not nulled, so the success answer is unchanged;
 *   - CONTROL, an inline manifest whose register throws: still refused with
 *     `422 PLUGIN_REGISTER_FAILED` in the declared envelope, nothing written.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BaseResponseSchema, ApiErrorSchema, envelopeViolations } from '@objectstack/spec/api';
// An install binds the package's handlers through `@objectstack/runtime` (a
// lazy `import()` inside the plugin). Its first load is paid here, at module
// top — never inside a clocked `it` (`scripts/check-test-source-alias.mjs`).
import '@objectstack/runtime';
import { MarketplaceInstallLocalPlugin } from './marketplace-install-local-plugin.js';
import { LocalManifestSource } from './local-manifest-source.js';
import { installerAuthService, withInstallerGrants } from './install-local-principal.fixtures.js';

type Handler = (c: any) => Promise<any>;

const ROUTE = '/api/v1/marketplace/install-local';
const APP_ID = 'com.example.crm';
const REGISTER_FAILURE = 'object crm_account: field owner references unknown object sys_owner';

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
 * Mount the plugin through its real lifecycle (`start()` + `kernel:ready`).
 * `failRegisterOf` names the ONE manifest id whose register throws — the
 * plugin's own UI bundle still registers at `kernel:ready`, as on a real boot.
 */
async function mount(dir: string, opts: { controlPlaneUrl?: string; failRegisterOf?: string } = {}) {
    const rawApp = makeRawApp();
    const hooks = new Map<string, any>();
    const registry: any[] = [];
    const register = vi.fn(async (m: any) => {
        if (opts.failRegisterOf !== undefined && m?.id === opts.failRegisterOf) {
            throw new Error(REGISTER_FAILURE);
        }
        registry.push({ manifest: m });
    });
    const syncSchemas = vi.fn(async () => undefined);
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const services: Record<string, any> = {
        manifest: { register },
        auth: installerAuthService(),
        objectql: withInstallerGrants({ syncSchemas, registry: { getAllPackages: () => registry } }),
    };
    const ctx = {
        hook: (e: string, h: any) => hooks.set(e, h),
        getService: (name: string) => {
            if (name === 'http-server') return { getRawApp: () => rawApp };
            const svc = services[name];
            if (svc === undefined) throw new Error(`no ${name}`);
            return svc;
        },
        logger,
    };
    const plugin = new MarketplaceInstallLocalPlugin({ controlPlaneUrl: opts.controlPlaneUrl ?? 'off', storageDir: dir });
    await plugin.start(ctx as any);
    await hooks.get('kernel:ready')?.();
    const registeredAtBoot = register.mock.calls.length;
    return {
        install: (body: unknown) => rawApp.routes.get(`POST ${ROUTE}`)!(makeC(body)),
        logger,
        /** The manifest ids the install ASKED to register, whether or not the register resolved. */
        installRegisterAttempts: () => register.mock.calls.slice(registeredAtBoot).map((call) => call[0]?.id),
    };
}

function makeC(body: any) {
    const json = vi.fn((payload: any, status?: number) => ({ payload, status: status ?? 200 }));
    return {
        req: {
            url: `http://localhost:3000${ROUTE}`,
            raw: new Request(`http://localhost:3000${ROUTE}`),
            json: async () => body,
            param: () => undefined,
        },
        json,
    };
}

/** Serve one manifest snapshot from the cloud leg; the public fast-path is off. */
function serveSnapshot(manifest: unknown) {
    vi.stubEnv('OS_MARKETPLACE_PUBLIC_BASE_URL', 'off');
    // A non-empty service key, so the credential read never reaches the
    // developer's own on-disk binding.
    vi.stubEnv('OS_CLOUD_API_KEY', 'svc-test-key');
    const fetchMock = vi.fn(async () => new Response(
        JSON.stringify({ data: { manifest, version: '1.0.0', version_id: 'ver_1' } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
    ));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
}

const MANIFEST = { id: APP_ID, version: '1.0.0', objects: [] };

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mil-hot-loaded-')); });
afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
});

describe('install-local answers hotLoaded from what the hot-register did', () => {
    it('a cloud-fetched manifest whose register throws answers 200 with hotLoaded: false and the register error as hotLoadError', async () => {
        const fetchMock = serveSnapshot(MANIFEST);
        const h = await mount(dir, { controlPlaneUrl: 'http://cloud.test', failRegisterOf: APP_ID });

        const res = await h.install({ packageId: 'pkg_crm' });

        // Identity: the manifest came from the cloud leg, and the install
        // really asked the kernel to register it — the throw is step 3's.
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(h.installRegisterAttempts()).toEqual([APP_ID]);

        expect(res.status, JSON.stringify(res.payload)).toBe(200);
        expect(res.payload.success).toBe(true);
        expect(res.payload.data.manifestId).toBe(APP_ID);
        expect(res.payload.data.hotLoaded).toBe(false);
        expect(res.payload.data.hotLoadError).toBe(REGISTER_FAILURE);
        // The note makes the same claim `hotLoaded` does, so it no longer says
        // the app is available in a kernel that does not hold it.
        expect(res.payload.data.note).not.toContain('now available');

        // Still lenient: the ledger entry is written, so the next restart
        // loads it. Whether this path should stay lenient is not decided here.
        expect(new LocalManifestSource(dir).read(APP_ID).entry?.manifestId).toBe(APP_ID);
    });

    it('CONTROL — a register that resolves answers hotLoaded: true, with no hotLoadError key at all', async () => {
        serveSnapshot(MANIFEST);
        const h = await mount(dir, { controlPlaneUrl: 'http://cloud.test' });

        const res = await h.install({ packageId: 'pkg_crm' });

        expect(res.status, JSON.stringify(res.payload)).toBe(200);
        expect(res.payload.success).toBe(true);
        expect(h.installRegisterAttempts()).toEqual([APP_ID]);
        expect(res.payload.data.hotLoaded).toBe(true);
        expect(Object.keys(res.payload.data)).not.toContain('hotLoadError');
        expect(res.payload.data.note).toContain('now available');
    });

    it('CONTROL — an inline manifest whose register throws is still refused: 422 PLUGIN_REGISTER_FAILED, nothing written', async () => {
        const h = await mount(dir, { failRegisterOf: APP_ID });

        const res = await h.install({ manifest: MANIFEST });

        expect(h.installRegisterAttempts()).toEqual([APP_ID]);
        expect(res.status).toBe(422);
        expect(BaseResponseSchema.safeParse(res.payload).success).toBe(true);
        expect(envelopeViolations(res.payload)).toEqual([]);
        expect(ApiErrorSchema.safeParse(res.payload.error).success).toBe(true);
        expect(res.payload.success).toBe(false);
        expect(res.payload.error.code).toBe('PLUGIN_REGISTER_FAILED');
        expect(res.payload.error.message).toContain(REGISTER_FAILURE);
        expect(readdirSync(dir)).toEqual([]);
    });
});
