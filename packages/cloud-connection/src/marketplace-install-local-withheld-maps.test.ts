// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#28640 ruling ③A] install-local reads a package export's `withheldMaps` —
 * the connector header and environment maps the export withheld whole — in
 * BOTH install modes, at the real install seam (the plugin's own route,
 * mounted through `start()` + `kernel:ready`).
 *
 * Pinned:
 *  - a managed install of a body carrying the list installs, and its answer
 *    names each map, as the export wrote it, with one `warn` line naming them;
 *  - an unmanaged install of such a body copies it, and its answer names each
 *    map the same way;
 *  - a body without the list answers with no `withheldMaps` key at all, in
 *    either mode — the answer's key set is unchanged;
 *  - a list the export's declaration refuses (a position outside the four, a
 *    header name) answers `PLUGIN_MANIFEST_INVALID`, 400 inline, before any
 *    write: nothing registered, ledgered or imported.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
// The runtime binder the door's step 1d loads lazily — paid here, at module
// top, never inside a clocked `it` (`scripts/check-test-source-alias.mjs`).
import '@objectstack/runtime';
import { MarketplaceInstallLocalPlugin } from './marketplace-install-local-plugin.js';
import { installerAuthService, withInstallerGrants } from './install-local-principal.fixtures.js';
import { LocalManifestSource } from './local-manifest-source.js';

const ROUTE = '/api/v1/marketplace/install-local';
const INSTALLER = 'usr_installer';

type Handler = (c: any) => Promise<any>;

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

async function mount(dir: string) {
    const routes = new Map<string, Handler>();
    const rawApp = {
        get: (p: string, h: Handler) => routes.set(`GET ${p}`, h),
        post: (p: string, h: Handler) => routes.set(`POST ${p}`, h),
        delete: (p: string, h: Handler) => routes.set(`DELETE ${p}`, h),
    };
    const hooks = new Map<string, any>();
    const register = vi.fn(async () => undefined);
    const importUnmanagedPackage = vi.fn(async (request: any) => ({
        sourcePackageId: request.manifest.id,
        sourceVersion: request.manifest.version,
        targetPackageId: `${request.manifest.id}-copy`,
        namespace: request.manifest.namespace,
        copiedCount: request.manifest.connectors?.length ?? 0,
        copied: (request.manifest.connectors ?? []).map((c: any) => ({ type: 'connector', name: c.name })),
        strippedLocks: [],
    }));
    const services: Record<string, any> = {
        manifest: { register },
        auth: installerAuthService(INSTALLER),
        objectql: withInstallerGrants({
            syncSchemas: vi.fn(async () => undefined),
            manifests: new Map(),
            registry: { getAllPackages: () => [], getNamespaceOwners: () => [], getPackage: () => undefined },
        }, INSTALLER),
        protocol: { importUnmanagedPackage },
    };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
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
    const plugin = new MarketplaceInstallLocalPlugin({ controlPlaneUrl: 'off', storageDir: dir });
    await plugin.start(ctx as any);
    await hooks.get('kernel:ready')?.();
    register.mockClear();
    return {
        install: (body: unknown) => routes.get(`POST ${ROUTE}`)!(makeC(body)),
        register,
        importUnmanagedPackage,
        logger,
        ledgerHas: (id: string) => new LocalManifestSource(dir).read(id).entry !== null,
    };
}

const WITHHELD = [
    { type: 'connector', name: 'crm_billing', path: 'providerConfig.headers' },
    { type: 'connector', name: 'crm_billing', path: 'providerConfig.defaultHeaders' },
    { type: 'connector', name: 'crm_tools', path: 'providerConfig.transport.env' },
];

/** A package as `GET /packages/:id/export` writes it: connectors served, their maps absent. */
function exported(extra: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        id: 'com.example.crm',
        name: 'crm',
        version: '4.0.0',
        namespace: 'crm',
        installModes: ['managed', 'unmanaged'],
        connectors: [
            { name: 'crm_billing', label: 'Billing', type: 'api', provider: 'rest', providerConfig: { baseUrl: 'https://billing.example.com' } },
            { name: 'crm_tools', label: 'Tools', type: 'api', provider: 'mcp', providerConfig: { transport: { kind: 'stdio', command: 'crm-tools' } } },
        ],
        ...extra,
    };
}

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mil-withheld-maps-')); });
afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
});

describe('install-local — the maps a package export withheld (`withheldMaps`)', () => {
    it('a managed install accepts the package and names each withheld map in its answer and one warn line', async () => {
        const h = await mount(dir);
        const res = await h.install({ manifest: exported({ withheldMaps: WITHHELD }) });
        expect(res.status, JSON.stringify(res.payload)).toBe(200);
        expect(res.payload.data.withheldMaps).toEqual(WITHHELD);
        expect(h.register).toHaveBeenCalledTimes(1);
        expect(h.ledgerHas('com.example.crm')).toBe(true);
        const lines = h.logger.warn.mock.calls.map((call) => String(call[0])).filter((l) => l.includes('withheld whole'));
        expect(lines).toHaveLength(1);
        for (const m of WITHHELD) expect(lines[0]).toContain(`connector '${m.name}' ${m.path}`);
    });

    it('an unmanaged install copies the package and names each withheld map in its answer', async () => {
        const h = await mount(dir);
        const res = await h.install({ manifest: exported({ withheldMaps: WITHHELD }), installMode: 'unmanaged' });
        expect(res.status, JSON.stringify(res.payload)).toBe(200);
        expect(res.payload.data.installMode).toBe('unmanaged');
        expect(res.payload.data.withheldMaps).toEqual(WITHHELD);
        expect(h.importUnmanagedPackage).toHaveBeenCalledTimes(1);
        expect(h.register).not.toHaveBeenCalled();
        const lines = h.logger.warn.mock.calls.map((call) => String(call[0])).filter((l) => l.includes('withheld whole'));
        expect(lines).toHaveLength(1);
        expect(lines[0]).toContain('unmanaged');
    });

    it.each([['managed'], ['unmanaged']] as const)('a %s install of a body without the list answers no `withheldMaps` key, and warns nothing', async (installMode) => {
        const h = await mount(dir);
        const res = await h.install({ manifest: exported(), installMode });
        expect(res.status, JSON.stringify(res.payload)).toBe(200);
        expect(res.payload.data).not.toHaveProperty('withheldMaps');
        expect(h.logger.warn.mock.calls.some((call) => String(call[0]).includes('withheld whole'))).toBe(false);
    });

    it.each([
        ['a position outside the four', [{ type: 'connector', name: 'crm_billing', path: 'auth.token' }]],
        ['a list of header names', [{ type: 'connector', name: 'crm_billing', path: 'providerConfig.headers', keys: ['Authorization'] }]],
        ['a value that is not a list', 'providerConfig.headers'],
    ])('refuses %s — PLUGIN_MANIFEST_INVALID, 400 inline, nothing written in either mode', async (_label, withheldMaps) => {
        for (const installMode of ['managed', 'unmanaged'] as const) {
            const h = await mount(dir);
            const res = await h.install({ manifest: exported({ withheldMaps }), installMode });
            expect(res.status, JSON.stringify(res.payload)).toBe(400);
            expect(res.payload.error.code).toBe('PLUGIN_MANIFEST_INVALID');
            expect(res.payload.error.message).toContain('withheldMaps');
            expect(h.register).not.toHaveBeenCalled();
            expect(h.importUnmanagedPackage).not.toHaveBeenCalled();
            expect(h.ledgerHas('com.example.crm')).toBe(false);
        }
    });
});
