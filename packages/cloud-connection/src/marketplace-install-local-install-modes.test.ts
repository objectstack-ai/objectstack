// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0131 D6] install-local's `installMode` — the door of the manifest key
 * `installModes`, at the real install seam (the plugin's own route, mounted
 * through `start()` + `kernel:ready`).
 *
 * Pinned, each with the zero-write evidence a refusal owes (no register, no
 * schema sync, no ledger entry, no import):
 *  - `installMode` is parsed against the key's enum; absent means `managed`;
 *  - the package must PERMIT the requested mode (`installModes`, absent meaning
 *    `['managed']`): `422 INSTALL_MODE_NOT_PERMITTED`, naming what it permits;
 *    an `installModes` its declaration refuses answers `PLUGIN_MANIFEST_INVALID`;
 *  - `unmanaged` under a walled REQUESTED posture: `409
 *    UNMANAGED_INSTALL_WALLED_POSTURE`, the import never called — with the lit
 *    control of a managed install on the same posture;
 *  - the `unmanaged` branch calls the import with ONE flat package body and the
 *    installer as actor, and runs none of the managed install's steps
 *    (register, ledger, sync); the answer names the base and `installedFrom`,
 *    and relays the import's `strippedLocks` — each protection lock the copy
 *    dropped, with the package's reason — as the import states it;
 *    the import's refusals are relayed with their own code, status and
 *    `details`, a 5xx's message withheld;
 *  - a managed install of a package whose namespace a WRITABLE base holds is
 *    refused `409 RESOURCE_CONFLICT` naming the base, on BOTH sources; a
 *    namespace held by a code package is not this refusal's.
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

function makeC(body: any, sent?: { contentType: string; text: string }) {
    const json = vi.fn((payload: any, status?: number) => ({ payload, status: status ?? 200 }));
    // [#23914] `sent`: a body as the client sent it, served the way Hono 4.13's
    // `HonoRequest` serves one (`json()` is the cached `text()` then `JSON.parse`).
    const text = sent ? Promise.resolve(sent.text) : undefined;
    return {
        req: {
            url: `http://localhost:3000${ROUTE}`,
            raw: new Request(`http://localhost:3000${ROUTE}`),
            json: text ? () => text.then((t) => JSON.parse(t)) : async () => body,
            ...(sent ? { text: () => text, header: (n: string) => (n.toLowerCase() === 'content-type' ? sent.contentType : undefined) } : {}),
            param: () => undefined,
        },
        json,
    };
}

/** A namespace's holders, and the packages behind them, as the registry answers. */
interface RegistryState {
    owners?: Record<string, string[]>;
    packages?: Record<string, { manifest: Record<string, unknown> }>;
    /** Booted code packages — `engine.manifests`. */
    codePackages?: string[];
}

async function mount(dir: string, opts: {
    controlPlaneUrl?: string;
    importer?: ((request: any) => Promise<any>) | null;
    registry?: RegistryState;
} = {}) {
    const routes = new Map<string, Handler>();
    const rawApp = {
        get: (p: string, h: Handler) => routes.set(`GET ${p}`, h),
        post: (p: string, h: Handler) => routes.set(`POST ${p}`, h),
        delete: (p: string, h: Handler) => routes.set(`DELETE ${p}`, h),
    };
    const hooks = new Map<string, any>();
    const register = vi.fn(async () => undefined);
    const syncSchemas = vi.fn(async () => undefined);
    const importUnmanagedPackage = opts.importer === null ? undefined : vi.fn(opts.importer ?? (async (request: any) => ({
        sourcePackageId: request.manifest.id,
        sourceVersion: request.manifest.version,
        targetPackageId: `${request.manifest.id}-copy`,
        namespace: request.manifest.namespace,
        copiedCount: 2,
        copied: [{ type: 'object', name: 'crm_lead' }, { type: 'view', name: 'crm_lead_open' }],
        strippedLocks: [],
    })));
    const state = opts.registry ?? {};
    const services: Record<string, any> = {
        manifest: { register },
        auth: installerAuthService(INSTALLER),
        objectql: withInstallerGrants({
            syncSchemas,
            manifests: new Map((state.codePackages ?? []).map((id) => [id, { id }])),
            registry: {
                getAllPackages: () => [],
                getNamespaceOwners: (ns: string) => [...(state.owners?.[ns] ?? [])],
                getPackage: (id: string) => state.packages?.[id],
            },
        }, INSTALLER),
        ...(importUnmanagedPackage ? { protocol: { importUnmanagedPackage } } : {}),
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
    const plugin = new MarketplaceInstallLocalPlugin({ controlPlaneUrl: opts.controlPlaneUrl ?? 'off', storageDir: dir });
    await plugin.start(ctx as any);
    await hooks.get('kernel:ready')?.();
    register.mockClear();
    return {
        install: (body: unknown) => routes.get(`POST ${ROUTE}`)!(makeC(body)),
        installSent: (contentType: string, text: string) => routes.get(`POST ${ROUTE}`)!(makeC(undefined, { contentType, text })),
        register,
        syncSchemas,
        importUnmanagedPackage,
        logger,
        ledgerHas: (id: string) => new LocalManifestSource(dir).read(id).entry !== null,
    };
}

/** A flat package body — its manifest fields beside its collections. */
function crm(extra: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        id: 'com.example.crm',
        namespace: 'crm',
        version: '4.0.0',
        type: 'app',
        name: 'CRM',
        objects: [{ name: 'crm_lead', label: 'Lead', fields: { title: { type: 'text', label: 'Title' } } }],
        ...extra,
    };
}

/**
 * The compiled artifact `os package install <file>` sends: the manifest NESTED
 * under `manifest:`, the collections beside it, `id` / `version` hoisted.
 */
function compiledArtifact(manifestExtra: Record<string, unknown> = {}): Record<string, unknown> {
    const manifest = { id: 'com.example.crm', namespace: 'crm', version: '4.0.0', type: 'app', name: 'CRM', ...manifestExtra };
    return {
        manifest,
        id: manifest.id,
        version: manifest.version,
        objects: [{ name: 'crm_lead', label: 'Lead', fields: { title: { type: 'text', label: 'Title' } } }],
        data: [{ object: 'crm_lead', records: [{ title: 'First' }] }],
        i18n: { defaultLocale: 'en' },
    };
}

/** Serve one manifest snapshot from the cloud leg; the public fast-path is off. */
function serveSnapshot(manifest: unknown) {
    vi.stubEnv('OS_MARKETPLACE_PUBLIC_BASE_URL', 'off');
    vi.stubEnv('OS_CLOUD_API_KEY', 'svc-test-key');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
        JSON.stringify({ data: { manifest, version: '4.0.1', version_id: 'ver_2' } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
    )));
}

const BOTH = ['managed', 'unmanaged'];

let dir: string;
let savedPosture: string | undefined;
beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mil-install-modes-'));
    savedPosture = process.env.OS_TENANCY_POSTURE;
    delete process.env.OS_TENANCY_POSTURE;
});
afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    if (savedPosture === undefined) delete process.env.OS_TENANCY_POSTURE;
    else process.env.OS_TENANCY_POSTURE = savedPosture;
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
});

describe('install-local — the requested `installMode`', () => {
    it('refuses a mode outside the key\'s enum with 400 INVALID_REQUEST, before anything else', async () => {
        const h = await mount(dir);
        const res = await h.install({ manifest: crm({ installModes: BOTH }), installMode: 'template' });
        expect(res.status).toBe(400);
        expect(res.payload.error.code).toBe('INVALID_REQUEST');
        expect(res.payload.error.message).toContain("'managed' or 'unmanaged'");
        expect(h.register).not.toHaveBeenCalled();
        expect(h.importUnmanagedPackage).not.toHaveBeenCalled();
    });

    it('an absent `installMode` is a managed install, exactly as before', async () => {
        const h = await mount(dir);
        const res = await h.install({ manifest: crm() });
        expect(res.status).toBe(200);
        expect(res.payload.data).not.toHaveProperty('installMode');
        expect(h.register).toHaveBeenCalledTimes(1);
        expect(h.importUnmanagedPackage).not.toHaveBeenCalled();
        expect(h.ledgerHas('com.example.crm')).toBe(true);
    });
});

describe('install-local — the package must permit the mode (`installModes`)', () => {
    it('refuses `unmanaged` for a package that declares no `installModes` (managed only) — 422, nothing written', async () => {
        const h = await mount(dir);
        const res = await h.install({ manifest: crm(), installMode: 'unmanaged' });
        expect(res.status).toBe(422);
        expect(res.payload.error.code).toBe('INSTALL_MODE_NOT_PERMITTED');
        expect(res.payload.error.details).toEqual({ installMode: 'unmanaged', permitted: ['managed'] });
        expect(res.payload.error.message).toContain("absent, which means ['managed']");
        expect(h.importUnmanagedPackage).not.toHaveBeenCalled();
        expect(h.register).not.toHaveBeenCalled();
        expect(h.ledgerHas('com.example.crm')).toBe(false);
    });

    it('refuses `managed` for a copy-only package — 422, naming `unmanaged`', async () => {
        const h = await mount(dir);
        const res = await h.install({ manifest: crm({ installModes: ['unmanaged'] }) });
        expect(res.status).toBe(422);
        expect(res.payload.error.code).toBe('INSTALL_MODE_NOT_PERMITTED');
        expect(res.payload.error.details.permitted).toEqual(['unmanaged']);
        expect(h.register).not.toHaveBeenCalled();
        expect(h.ledgerHas('com.example.crm')).toBe(false);
    });

    it('refuses an `installModes` its declaration refuses — PLUGIN_MANIFEST_INVALID, 400 for an inline manifest', async () => {
        const h = await mount(dir);
        const res = await h.install({ manifest: crm({ installModes: ['template'] }) });
        expect(res.status).toBe(400);
        expect(res.payload.error.code).toBe('PLUGIN_MANIFEST_INVALID');
        expect(res.payload.error.message).toContain('installModes');
        expect(h.register).not.toHaveBeenCalled();
    });

    it('reads `installModes` where a compiled artifact declares it — on its nested `manifest:`', async () => {
        const h = await mount(dir);
        const res = await h.install({ manifest: compiledArtifact({ installModes: BOTH }), installMode: 'unmanaged' });
        expect(res.status, JSON.stringify(res.payload)).toBe(200);
        expect(res.payload.data.installMode).toBe('unmanaged');
    });
});

describe('install-local — `unmanaged` under a walled REQUESTED posture', () => {
    // An UNRECOGNISED posture value is read as walled by the same function
    // (pinned in `package-unmanaged-install.test.ts`); at this door the
    // install-capability admission refuses such a boot first, so it is not a
    // case this suite can reach.
    for (const posture of ['isolated', 'group']) {
        it(`'${posture}': 409 UNMANAGED_INSTALL_WALLED_POSTURE naming the posture, the import never called, nothing written`, async () => {
            process.env.OS_TENANCY_POSTURE = posture;
            const h = await mount(dir);
            const res = await h.install({ manifest: crm({ installModes: BOTH }), installMode: 'unmanaged' });
            expect(res.status).toBe(409);
            expect(res.payload.error.code).toBe('UNMANAGED_INSTALL_WALLED_POSTURE');
            expect(res.payload.error.details.posture).toBe(posture);
            expect(h.importUnmanagedPackage).not.toHaveBeenCalled();
            expect(h.register).not.toHaveBeenCalled();
            expect(h.syncSchemas).not.toHaveBeenCalled();
            expect(h.ledgerHas('com.example.crm')).toBe(false);
        });
    }

    it('CONTROL: the same package installed MANAGED under `isolated` installs', async () => {
        process.env.OS_TENANCY_POSTURE = 'isolated';
        const h = await mount(dir);
        const res = await h.install({ manifest: crm({ installModes: BOTH }), installMode: 'managed' });
        expect(res.status, JSON.stringify(res.payload)).toBe(200);
        expect(h.register).toHaveBeenCalledTimes(1);
    });
});

describe('install-local — the `unmanaged` branch is the import, and nothing of the managed install', () => {
    it('hands the import ONE flat package body and the installer as actor; registers, ledgers and syncs nothing', async () => {
        const h = await mount(dir);
        const res = await h.install({ manifest: compiledArtifact({ installModes: BOTH }), installMode: 'unmanaged' });
        expect(res.status, JSON.stringify(res.payload)).toBe(200);

        expect(h.importUnmanagedPackage).toHaveBeenCalledTimes(1);
        const request = h.importUnmanagedPackage!.mock.calls[0]![0];
        expect(request.actor).toBe(INSTALLER);
        // Flat: the nested manifest's fields beside the collections, no `manifest:` left.
        expect(request.manifest).not.toHaveProperty('manifest');
        expect(request.manifest).toMatchObject({
            id: 'com.example.crm', namespace: 'crm', version: '4.0.0', installModes: BOTH,
        });
        expect(Array.isArray(request.manifest.objects)).toBe(true);

        expect(h.register).not.toHaveBeenCalled();
        expect(h.syncSchemas).not.toHaveBeenCalled();
        expect(h.ledgerHas('com.example.crm')).toBe(false);
    });

    it('answers the copy: mode, base, items, and `installedFrom` — and says the sample data was not loaded', async () => {
        const h = await mount(dir);
        const res = await h.install({ manifest: compiledArtifact({ installModes: BOTH }), installMode: 'unmanaged' });
        expect(res.payload.success).toBe(true);
        expect(res.payload.data).toMatchObject({
            manifestId: 'com.example.crm',
            installMode: 'unmanaged',
            targetPackageId: 'com.example.crm-copy',
            namespace: 'crm',
            copiedCount: 2,
            installedFrom: { packageId: 'com.example.crm', version: '4.0.0' },
            seeded: { mode: 'skipped' },
        });
        expect(res.payload.data.seeded.reason).toContain('sample data was not loaded');
        expect(res.payload.data).not.toHaveProperty('hotLoaded');
        expect(res.payload.data).not.toHaveProperty('storageDir');
        // Recorded for information on the operator log too.
        const info = h.logger.info.mock.calls.map((call: any[]) => String(call[0])).join('\n');
        expect(info).toContain("installed com.example.crm unmanaged: 2 item(s) copied into the environment base 'com.example.crm-copy'");
        expect(info).toContain('installed from com.example.crm@4.0.0');
    });

    it('relays each protection lock the copy dropped, as the import states it — the package\'s reason verbatim', async () => {
        const strippedLocks = [
            { type: 'view', name: 'crm_lead_open', lock: 'full', reason: 'Board-pack figures — edit the source package.' },
            { type: 'app', name: 'crm', lock: 'no-delete' },
        ];
        const h = await mount(dir, {
            importer: async (request: any) => ({
                sourcePackageId: request.manifest.id,
                targetPackageId: `${request.manifest.id}-copy`,
                namespace: request.manifest.namespace,
                copiedCount: 3,
                copied: [{ type: 'object', name: 'crm_lead' }, { type: 'view', name: 'crm_lead_open' }, { type: 'app', name: 'crm' }],
                strippedLocks,
            }),
        });
        const res = await h.install({ manifest: crm({ installModes: BOTH }), installMode: 'unmanaged' });
        expect(res.status, JSON.stringify(res.payload)).toBe(200);
        expect(res.payload.data.strippedLocks).toEqual(strippedLocks);
    });

    it('a copy that dropped no lock answers an empty `strippedLocks`', async () => {
        const h = await mount(dir);
        const res = await h.install({ manifest: crm({ installModes: BOTH }), installMode: 'unmanaged' });
        expect(res.status).toBe(200);
        expect(res.payload.data.strippedLocks).toEqual([]);
    });

    it('a package with no seed data answers no `seeded` at all', async () => {
        const h = await mount(dir);
        const res = await h.install({ manifest: crm({ installModes: BOTH }), installMode: 'unmanaged' });
        expect(res.status).toBe(200);
        expect(res.payload.data).not.toHaveProperty('seeded');
    });

    it('relays the import\'s refusal with its own code, status, message and `details` — no `issues`', async () => {
        const refusal = Object.assign(new Error("Package 'com.example.crm' cannot be installed unmanaged: `jobs` — 1 'job' item(s)."), {
            code: 'UNMANAGED_INSTALL_UNCOPYABLE',
            status: 422,
            details: { findings: [{ key: 'jobs', reason: 'runtime-uncreatable' }] },
            issues: [{ path: 'jobs', message: 'x' }],
        });
        const h = await mount(dir, { importer: async () => { throw refusal; } });
        const res = await h.install({ manifest: crm({ installModes: BOTH }), installMode: 'unmanaged' });
        expect(res.status).toBe(422);
        expect(res.payload.error).toEqual({
            code: 'UNMANAGED_INSTALL_UNCOPYABLE',
            message: refusal.message,
            details: { findings: [{ key: 'jobs', reason: 'runtime-uncreatable' }] },
        });
    });

    it('withholds a 5xx\'s message and logs it', async () => {
        const h = await mount(dir, {
            importer: async () => { throw Object.assign(new Error('SQLITE_ERROR: disk I/O error'), { status: 500 }); },
        });
        const res = await h.install({ manifest: crm({ installModes: BOTH }), installMode: 'unmanaged' });
        expect(res.status).toBe(500);
        expect(res.payload.error.message).not.toContain('SQLITE_ERROR');
        expect(res.payload.error.message).toContain('the reason is in the server log');
        expect(h.logger.warn.mock.calls.map((call: any[]) => String(call[0])).join('\n')).toContain('SQLITE_ERROR');
    });

    it('a runtime whose protocol has no copy-once import answers 503 SERVICE_UNAVAILABLE — never a managed install instead', async () => {
        const h = await mount(dir, { importer: null });
        const res = await h.install({ manifest: crm({ installModes: BOTH }), installMode: 'unmanaged' });
        expect(res.status).toBe(503);
        expect(res.payload.error.code).toBe('SERVICE_UNAVAILABLE');
        expect(h.register).not.toHaveBeenCalled();
        expect(h.ledgerHas('com.example.crm')).toBe(false);
    });
});

describe('install-local — a managed install never takes over an unmanaged copy (both sources)', () => {
    const copyHeld: RegistryState = {
        owners: { crm: ['com.example.crm-copy'] },
        packages: { 'com.example.crm-copy': { manifest: { id: 'com.example.crm-copy', namespace: 'crm' } } },
    };

    it('inline: 409 RESOURCE_CONFLICT naming the base, before any write', async () => {
        const h = await mount(dir, { registry: copyHeld });
        const res = await h.install({ manifest: crm({ installModes: BOTH }) });
        expect(res.status).toBe(409);
        expect(res.payload.error.code).toBe('RESOURCE_CONFLICT');
        expect(res.payload.error.details).toEqual({ namespace: 'crm', base: 'com.example.crm-copy' });
        expect(res.payload.error.message).toContain("'com.example.crm-copy'");
        expect(h.register).not.toHaveBeenCalled();
        expect(h.syncSchemas).not.toHaveBeenCalled();
        expect(h.ledgerHas('com.example.crm')).toBe(false);
    });

    it('cloud-fetched (the lenient branch): the same refusal, before the lenient register and its ledger entry', async () => {
        serveSnapshot(crm({ version: '4.0.1', installModes: BOTH }));
        const h = await mount(dir, { controlPlaneUrl: 'http://cloud.test', registry: copyHeld });
        const res = await h.install({ packageId: 'com.example.crm' });
        expect(res.status).toBe(409);
        expect(res.payload.error.code).toBe('RESOURCE_CONFLICT');
        expect(res.payload.error.details.base).toBe('com.example.crm-copy');
        expect(h.register).not.toHaveBeenCalled();
        expect(h.ledgerHas('com.example.crm')).toBe(false);
    });

    it('reads the namespace the package derives from its id when it declares none', async () => {
        const h = await mount(dir, { registry: copyHeld });
        const { namespace: _ns, ...undeclared } = crm();
        const res = await h.install({ manifest: undeclared });
        expect(res.status).toBe(409);
        expect(res.payload.error.details).toEqual({ namespace: 'crm', base: 'com.example.crm-copy' });
    });

    it('CONTROL: a namespace held by a CODE package is not this refusal\'s — the install proceeds to its own steps', async () => {
        const h = await mount(dir, {
            registry: {
                owners: { crm: ['com.example.other'] },
                packages: { 'com.example.other': { manifest: { id: 'com.example.other', namespace: 'crm' } } },
                codePackages: ['com.example.other'],
            },
        });
        const res = await h.install({ manifest: crm() });
        expect(res.payload?.error?.code).not.toBe('RESOURCE_CONFLICT');
        expect(h.register).toHaveBeenCalledTimes(1);
    });
});

describe('[#23914] a truncated install body is refused, and nothing is written', () => {
    it('a declared JSON body that does not parse → 400 INVALID_REQUEST naming the parse failure, zero writes', async () => {
        const m = await mount(dir);
        const sent = '{"packageId": "com.example.crm", "installMode": "unmanaged"';
        const res = await m.installSent('application/json', sent);
        expect(res.status).toBe(400);
        expect(res.payload).toEqual({
            success: false,
            error: { code: 'INVALID_REQUEST', message: expect.stringMatching(/parsed as JSON/) },
        });
        expect(res.payload.error.message).not.toContain(sent);
        expect(m.register).not.toHaveBeenCalled();
        expect(m.syncSchemas).not.toHaveBeenCalled();
        expect(m.importUnmanagedPackage).not.toHaveBeenCalled();
        expect(m.ledgerHas('com.example.crm')).toBe(false);
    });

    it('CONTROL — an empty JSON body is still no body: the door answers what it answered for {}', async () => {
        const m = await mount(dir);
        const empty = await m.installSent('application/json', '');
        const none = await m.install({});
        expect(empty.status).toBe(none.status);
        expect(empty.payload).toEqual(none.payload);
    });
});
