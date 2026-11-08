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
import { declareInstallerPlatformOwner, installerAuthService, withInstallerGrants } from './install-local-principal.fixtures.js';
import { LocalManifestSource } from './local-manifest-source.js';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';

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
    // The request carries no organization, so under a wall the installer is
    // the deployment's declared platform owner.
    let restoreOwner: () => void;
    beforeEach(() => { restoreOwner = declareInstallerPlatformOwner(INSTALLER); });
    afterEach(() => restoreOwner());
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

    // A 4xx refusal either carries its reason in the body, or writes the log
    // line the body points at. Each throw below resolves to a 4xx through a
    // declaration other than a numeric `status`, so its message is withheld.
    it.each([
        ['`statusCode` 409', Object.assign(new Error('Record is locked by approval apv_7'), { statusCode: 409, code: 'RECORD_LOCKED' })],
        ['the validation shape (no status)', Object.assign(new Error('Validation failed: crm_lead.plan is required'), {
            code: 'VALIDATION_FAILED',
            fields: [{ field: 'plan', code: 'required', message: 'plan is required' }],
        })],
    ])('a 4xx refusal declared by %s: the body carries its reason, or the log line it points at is written', async (_label, thrown) => {
        const h = await mount(dir, { importer: async () => { throw thrown; } });
        const res = await h.install({ manifest: crm({ installModes: BOTH }), installMode: 'unmanaged' });
        expect(res.status, JSON.stringify(res.payload)).toBeGreaterThanOrEqual(400);
        expect(res.status).toBeLessThan(500);
        const warned = h.logger.warn.mock.calls.map((call: any[]) => String(call[0])).join('\n');
        if (res.payload.error.message.includes('the reason is in the server log')) {
            expect(warned).toContain(thrown.message);
        } else {
            expect(res.payload.error.message).toContain(thrown.message);
        }
    });

    it('a 4xx refusal whose reason reaches the body writes no log line', async () => {
        const refusal = Object.assign(new Error("Package 'com.example.crm' already has a writable copy."), { status: 409, code: 'RESOURCE_CONFLICT' });
        const h = await mount(dir, { importer: async () => { throw refusal; } });
        const res = await h.install({ manifest: crm({ installModes: BOTH }), installMode: 'unmanaged' });
        expect(res.status).toBe(409);
        expect(res.payload.error.message).toBe(refusal.message);
        expect(h.logger.warn.mock.calls.map((call: any[]) => String(call[0])).join('\n')).not.toContain(refusal.message);
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

describe('install-local — `targetNamespace` renames an unmanaged copy, and only an unmanaged one (#30794)', () => {
    /** The import as it answers a renamed copy: the request's namespace, and the source's beside it. */
    const renamingImporter = async (request: any) => ({
        sourcePackageId: request.manifest.id,
        sourceVersion: request.manifest.version,
        targetPackageId: `${request.manifest.id}-copy`,
        namespace: request.targetNamespace ?? request.manifest.namespace,
        ...(request.targetNamespace !== undefined ? { sourceNamespace: request.manifest.namespace } : {}),
        copiedCount: 1,
        copied: [{ type: 'object', name: `${request.targetNamespace ?? request.manifest.namespace}_lead` }],
        strippedLocks: [],
    });

    it('hands `targetNamespace` to the import, and records the source namespace beside `installedFrom`', async () => {
        const h = await mount(dir, { importer: renamingImporter });
        const res = await h.install({ manifest: crm({ installModes: BOTH }), installMode: 'unmanaged', targetNamespace: 'acme' });
        expect(res.status, JSON.stringify(res.payload)).toBe(200);

        expect(h.importUnmanagedPackage).toHaveBeenCalledTimes(1);
        expect(h.importUnmanagedPackage!.mock.calls[0]![0]).toMatchObject({ targetNamespace: 'acme', actor: INSTALLER });
        // The mapping the rename applied: `installedFrom.namespace` → `namespace`.
        expect(res.payload.data).toMatchObject({
            installMode: 'unmanaged',
            namespace: 'acme',
            installedFrom: { packageId: 'com.example.crm', version: '4.0.0', namespace: 'crm' },
            copied: [{ type: 'object', name: 'acme_lead' }],
        });
        const info = h.logger.info.mock.calls.map((call: any[]) => String(call[0])).join('\n');
        expect(info).toContain("(namespace 'acme', renamed from 'crm')");
    });

    it('without it the import is asked as before, and `installedFrom` carries no namespace — the key set unchanged', async () => {
        const h = await mount(dir, { importer: renamingImporter });
        const res = await h.install({ manifest: crm({ installModes: BOTH }), installMode: 'unmanaged' });
        expect(res.status).toBe(200);
        expect(h.importUnmanagedPackage!.mock.calls[0]![0]).not.toHaveProperty('targetNamespace');
        expect(res.payload.data.installedFrom).toEqual({ packageId: 'com.example.crm', version: '4.0.0' });
    });

    for (const installMode of [undefined, 'managed'] as const) {
        it(`beside a ${installMode ?? 'default (managed)'} install: 400 INVALID_REQUEST — a managed install is never renamed; nothing fetched or written`, async () => {
            const h = await mount(dir, { importer: renamingImporter });
            const fetchSpy = vi.fn();
            vi.stubGlobal('fetch', fetchSpy);
            const res = await h.install({
                manifest: crm({ installModes: BOTH }),
                ...(installMode ? { installMode } : {}),
                targetNamespace: 'acme',
            });
            expect(res.status).toBe(400);
            expect(res.payload.error.code).toBe('INVALID_REQUEST');
            expect(res.payload.error.message).toContain('a managed install is never renamed');
            expect(fetchSpy).not.toHaveBeenCalled();
            expect(h.importUnmanagedPackage).not.toHaveBeenCalled();
            expect(h.register).not.toHaveBeenCalled();
            expect(h.syncSchemas).not.toHaveBeenCalled();
            expect(h.ledgerHas('com.example.crm')).toBe(false);
        });
    }
});

describe('install-local — the import\'s own `targetNamespace` refusal, as the door answers it (#30794)', () => {
    // The REAL copy-once import, not a double: the refusal is judged by its
    // plan before the engine is asked anything, so an empty engine suffices.
    const realImporter = () => {
        const protocol = new ObjectStackProtocolImplementation({ registry: {} } as any, () => new Map()) as any;
        return (request: any) => protocol.importUnmanagedPackage(request);
    };

    for (const [label, targetNamespace, sentence] of [
        ['a value the namespace declaration refuses', 'Acme', "Invalid package namespace 'Acme' on `targetNamespace`"],
        ['a platform-reserved namespace', 'sys', "`targetNamespace` 'sys' is a platform-reserved namespace"],
    ] as const) {
        it(`${label}: 400 INVALID_REQUEST, the reason in the body and \`details.targetNamespace\`; nothing written`, async () => {
            const h = await mount(dir, { importer: realImporter() });
            const res = await h.install({ manifest: crm({ installModes: BOTH }), installMode: 'unmanaged', targetNamespace });
            expect(res.status, JSON.stringify(res.payload)).toBe(400);
            expect(res.payload.error.code).toBe('INVALID_REQUEST');
            expect(res.payload.error.message).toContain(sentence);
            expect(res.payload.error.message).not.toContain('the reason is in the server log');
            expect(res.payload.error.details).toEqual({ targetNamespace });
            expect(h.register).not.toHaveBeenCalled();
            expect(h.ledgerHas('com.example.crm')).toBe(false);
        });
    }
});

describe('install-local — Q6 after a RENAMED copy: the managed install is admitted; after an unrenamed one, refused (#30794)', () => {
    // The ruling (record 6709037798, Q6 = B): a copy renamed into a namespace
    // of its own does not hold the source namespace, so a later managed
    // install of the same source package is not refused. A copy that kept the
    // source namespace still holds it, and Q6 (step 1f) refuses as written.
    const renamedCopyHeld: RegistryState = {
        owners: { acme: ['com.example.crm-copy'] },
        packages: { 'com.example.crm-copy': { manifest: { id: 'com.example.crm-copy', namespace: 'acme' } } },
    };
    const unrenamedCopyHeld: RegistryState = {
        owners: { crm: ['com.example.crm-copy'] },
        packages: { 'com.example.crm-copy': { manifest: { id: 'com.example.crm-copy', namespace: 'crm' } } },
    };

    it('beside a copy renamed to `acme`: the managed install of `com.example.crm` proceeds to its own steps', async () => {
        const h = await mount(dir, { registry: renamedCopyHeld });
        const res = await h.install({ manifest: crm({ installModes: BOTH }) });
        expect(res.payload?.error?.code, JSON.stringify(res.payload)).not.toBe('RESOURCE_CONFLICT');
        expect(h.register).toHaveBeenCalledTimes(1);
    });

    it('TWIN: beside a copy that kept `crm`, the same install is refused 409 RESOURCE_CONFLICT, before any write', async () => {
        const h = await mount(dir, { registry: unrenamedCopyHeld });
        const res = await h.install({ manifest: crm({ installModes: BOTH }) });
        expect(res.status).toBe(409);
        expect(res.payload.error.code).toBe('RESOURCE_CONFLICT');
        expect(res.payload.error.details).toEqual({ namespace: 'crm', base: 'com.example.crm-copy' });
        expect(h.register).not.toHaveBeenCalled();
        expect(h.ledgerHas('com.example.crm')).toBe(false);
    });
});

describe('install-local — an unmanaged copy\'s sample data, asked for with `seedSampleData` (#30808)', () => {
    type Row = Record<string, unknown> & { id: string };
    /** The audit/ownership columns every user-authored object carries. */
    const OWNED = { owner_id: { type: 'lookup', reference: 'sys_user' }, created_by: { type: 'lookup', reference: 'sys_user' } };
    /** Account ← contact, the contact naming its account by the account's natural key; listed child first. */
    const seededCrm = (extra: Record<string, unknown> = {}) => crm({
        installModes: BOTH,
        objects: [
            { name: 'crm_account', label: 'Account', fields: { name: { type: 'text' }, ...OWNED } },
            { name: 'crm_contact', label: 'Contact', fields: { email: { type: 'text' }, account: { type: 'lookup', reference: 'crm_account' }, ...OWNED } },
        ],
        data: [
            { object: 'crm_contact', externalId: 'email', records: [{ email: 'ada@acme.test', account: 'Acme' }] },
            { object: 'crm_account', externalId: 'name', records: [{ name: 'Acme' }, { name: 'Globex' }] },
        ],
        ...extra,
    });

    /**
     * The door over an in-memory data engine the REAL `SeedLoaderService`
     * writes through, and a protocol double standing in for the import: it
     * registers the copied objects, writes each dataset the door asks for as
     * a `seed` item of the new base (the verb's own pins live in
     * `@objectstack/metadata-protocol`'s `package-unmanaged-install.test.ts`),
     * and serves them back through `getMetaItems`. `tables` and `seedItems`
     * outlive a mount, so a second mount is a restart over the same database.
     */
    function world() {
        const tables: Record<string, Row[]> = {};
        const objects = new Map<string, any>();
        const packages = new Map<string, { manifest: Record<string, unknown> }>();
        const seedItems = new Map<string, Record<string, unknown>>();
        const writes: string[] = [];
        let nextId = 0;
        const known = (object: string) => {
            if (!objects.has(object)) throw new Error(`Object '${object}' not found`);
            return (tables[object] ??= []);
        };
        // The platform tables the loader probes (`sys_organization`, the landed-key
        // ledger) hold no row here; every other unknown object is refused.
        const readable = (object: string) => (object.startsWith('sys_') && !objects.has(object) ? [] : known(object));
        const matches = (row: Row, where: Record<string, unknown>) => Object.entries(where).every(([k, v]) => {
            if (k.startsWith('$')) throw new Error(`engine double: combinator '${k}' is not implemented`);
            if (v === null) return row[k] == null;
            if (v && typeof v === 'object') {
                const ops = Object.keys(v);
                if (ops.length !== 1 || ops[0] !== '$in') throw new Error(`engine double: operator(s) ${ops.join(', ')} not implemented`);
                return ((v as { $in: unknown[] }).$in).includes(row[k]);
            }
            return row[k] === v;
        });
        const engine: any = {
            syncSchemas: vi.fn(async () => undefined),
            manifests: new Map(),
            getSchema: (name: string) => objects.get(name),
            registry: {
                getAllPackages: () => [],
                getNamespaceOwners: () => [],
                getPackage: (id: string) => packages.get(id),
                getObject: (name: string) => objects.get(name),
            },
            async find(object: string, query?: any): Promise<unknown[]> {
                const rows = readable(object).filter((row) => matches(row, query?.where ?? {}));
                return (typeof query?.limit === 'number' ? rows.slice(0, query.limit) : rows).map((row) => ({ ...row }));
            },
            // One record, or the batch the loader inserts a dataset in.
            async insert(object: string, record: Record<string, unknown> | Record<string, unknown>[]): Promise<Row | Row[]> {
                const one = (r: Record<string, unknown>) => {
                    const row = { ...r, id: `r${++nextId}` } as Row;
                    known(object).push(row);
                    writes.push(`insert ${object}`);
                    return { ...row };
                };
                return Array.isArray(record) ? record.map(one) : one(record);
            },
            async update(object: string, data: Record<string, unknown>, options: any) {
                let n = 0;
                for (const row of known(object)) {
                    if (!matches(row, options?.where ?? {})) continue;
                    Object.assign(row, data);
                    n += 1;
                }
                return n;
            },
            async delete(object: string, options?: any): Promise<boolean> {
                const id = String(options?.where?.id ?? '');
                const table = known(object);
                const at = table.findIndex((r) => r.id === id);
                if (at < 0) return false;
                table.splice(at, 1);
                writes.push(`delete ${object}`);
                return true;
            },
        };
        const importUnmanagedPackage = vi.fn(async (request: any) => {
            const source = request.manifest;
            const targetPackageId = `${source.id}-copy`;
            if (packages.has(targetPackageId)) {
                throw Object.assign(new Error(`Package '${targetPackageId}' already exists.`), {
                    code: 'RESOURCE_CONFLICT', status: 409, details: { targetPackageId },
                });
            }
            packages.set(targetPackageId, { manifest: { id: targetPackageId, namespace: source.namespace } });
            const copied: Array<{ type: string; name: string }> = [];
            for (const o of source.objects ?? []) {
                objects.set(o.name, o);
                copied.push({ type: 'object', name: o.name });
            }
            if (request.seedData === true) {
                for (const d of source.data ?? []) {
                    const name = `${d.object}_seed`;
                    seedItems.set(name, { ...d, _packageId: targetPackageId });
                    copied.push({ type: 'seed', name });
                }
            }
            return { sourcePackageId: source.id, targetPackageId, namespace: source.namespace, copiedCount: copied.length, copied, strippedLocks: [] };
        });
        const getMetaItems = vi.fn(async ({ type, packageId }: { type: string; packageId?: string }) => ({
            type,
            items: type !== 'seed' ? [] : [...seedItems.values()]
                .filter((b) => !packageId || b._packageId === packageId)
                .map((b) => ({ ...b, _diagnostics: { valid: true } })),
        }));

        async function boot() {
            const routes = new Map<string, Handler>();
            const rawApp = {
                get: (p: string, h: Handler) => routes.set(`GET ${p}`, h),
                post: (p: string, h: Handler) => routes.set(`POST ${p}`, h),
                delete: (p: string, h: Handler) => routes.set(`DELETE ${p}`, h),
            };
            const hooks = new Map<string, any>();
            const register = vi.fn(async () => undefined);
            const services: Record<string, any> = {
                manifest: { register },
                auth: installerAuthService(INSTALLER),
                objectql: withInstallerGrants(engine, INSTALLER),
                metadata: { getObject: async (name: string) => objects.get(name) },
                protocol: { importUnmanagedPackage, getMetaItems },
            };
            const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
            const ctx = {
                hook: (e: string, h: any) => hooks.set(e, h),
                getService: (name: string) => {
                    if (name === 'http-server') return { getRawApp: () => rawApp };
                    const svc = services[name];
                    if (svc === undefined) throw new Error(`no ${name}`);
                    return svc;
                },
                registerService: (name: string, svc: unknown) => { services[name] = svc; },
                logger,
            };
            const plugin = new MarketplaceInstallLocalPlugin({ controlPlaneUrl: 'off', storageDir: dir });
            await plugin.start(ctx as any);
            await hooks.get('kernel:ready')?.();
            register.mockClear();
            const purgeC = (manifestId: string) => ({ ...makeC(undefined), req: { ...makeC(undefined).req, param: (k: string) => (k === 'manifestId' ? manifestId : undefined) } });
            return {
                install: (body: unknown) => routes.get(`POST ${ROUTE}`)!(makeC(body)),
                purge: (manifestId: string) => routes.get(`POST ${ROUTE}/:manifestId/purge-sample-data`)!(purgeC(manifestId)),
                register,
                logger,
            };
        }
        return { tables, writes, seedItems, packages, importUnmanagedPackage, getMetaItems, boot };
    }

    it('off by default: the import is not asked for the sample data, no row lands, and the answer says it was skipped', async () => {
        const w = world();
        const h = await w.boot();
        const res = await h.install({ manifest: seededCrm(), installMode: 'unmanaged' });
        expect(res.status, JSON.stringify(res.payload)).toBe(200);
        expect(w.importUnmanagedPackage.mock.calls[0]![0]).not.toHaveProperty('seedData');
        expect(res.payload.data.seeded).toEqual({
            mode: 'skipped',
            reason: 'an unmanaged install copies metadata, not data: the package\'s sample data was not loaded',
        });
        expect(w.seedItems.size).toBe(0);
        expect(w.writes).toEqual([]);
    });

    it('asked for: the rows land from the stored seed items, owned by the installer, the lookup resolved in load order', async () => {
        const w = world();
        const h = await w.boot();
        const res = await h.install({ manifest: seededCrm(), installMode: 'unmanaged', seedSampleData: true });
        expect(res.status, JSON.stringify(res.payload)).toBe(200);
        expect(w.importUnmanagedPackage.mock.calls[0]![0]).toMatchObject({ seedData: true, actor: INSTALLER });
        expect(res.payload.data.seeded).toEqual({ mode: 'inline', inserted: 3, updated: 0, skipped: 0, errors: 0 });
        const acme = w.tables.crm_account!.find((r) => r.name === 'Acme')!;
        expect(w.tables.crm_account!.map((r) => r.name).sort()).toEqual(['Acme', 'Globex']);
        // The contact's `account: 'Acme'` is the parent row's id: the account dataset loaded first.
        expect(w.tables.crm_contact).toEqual([expect.objectContaining({ email: 'ada@acme.test', account: acme.id })]);
        for (const row of [...w.tables.crm_account!, ...w.tables.crm_contact!]) {
            expect({ owner_id: row.owner_id, created_by: row.created_by }).toEqual({ owner_id: INSTALLER, created_by: INSTALLER });
        }
        // Nothing is ledgered or registered under the package's id.
        expect(h.register).not.toHaveBeenCalled();
        expect(new LocalManifestSource(dir).read('com.example.crm').entry).toBeNull();
    });

    it('the purge of the copy\'s base deletes exactly the sample rows; a row the customer wrote in a seeded object stays', async () => {
        const w = world();
        const h = await w.boot();
        await h.install({ manifest: seededCrm(), installMode: 'unmanaged', seedSampleData: true });
        w.tables.crm_account!.push({ id: 'u1', name: 'Initech', owner_id: INSTALLER });
        const res = await h.purge('com.example.crm-copy');
        expect(res.status, JSON.stringify(res.payload)).toBe(200);
        expect(res.payload).toEqual({
            success: true,
            data: { manifestId: 'com.example.crm-copy', deleted: 3, skipped: 0, errors: 0, withSampleData: false },
        });
        expect(w.tables.crm_account!.map((r) => r.id)).toEqual(['u1']);
        expect(w.tables.crm_contact).toEqual([]);
        // The receipt stays: a second purge finds nothing left to delete.
        const again = await h.purge('com.example.crm-copy');
        expect(again.payload.data).toMatchObject({ deleted: 0, skipped: 3, errors: 0 });
    });

    it('a restart after the copy, and after the purge, re-inserts nothing', async () => {
        const w = world();
        const first = await w.boot();
        await first.install({ manifest: seededCrm(), installMode: 'unmanaged', seedSampleData: true });
        const loaded = w.writes.length;
        await w.boot();
        expect(w.writes.length).toBe(loaded);
        const third = await w.boot();
        await third.purge('com.example.crm-copy');
        const purged = w.writes.length;
        await w.boot();
        expect(w.writes.length).toBe(purged);
        expect(w.tables.crm_account).toEqual([]);
    });

    it('a re-run is refused 409 by the import before anything is loaded again', async () => {
        const w = world();
        const h = await w.boot();
        await h.install({ manifest: seededCrm(), installMode: 'unmanaged', seedSampleData: true });
        const before = w.writes.length;
        const res = await h.install({ manifest: seededCrm(), installMode: 'unmanaged', seedSampleData: true });
        expect(res.status).toBe(409);
        expect(res.payload.error.code).toBe('RESOURCE_CONFLICT');
        expect(w.writes.length).toBe(before);
    });

    it('`seedSampleData` that is not a boolean, or beside a managed install: 400 INVALID_REQUEST, nothing imported or registered', async () => {
        for (const body of [
            { manifest: seededCrm(), installMode: 'unmanaged', seedSampleData: 'yes' },
            { manifest: seededCrm(), seedSampleData: true },
            { manifest: seededCrm(), installMode: 'managed', seedSampleData: false },
        ]) {
            const w = world();
            const h = await w.boot();
            const res = await h.install(body);
            expect(res.status, JSON.stringify(body)).toBe(400);
            expect(res.payload.error.code).toBe('INVALID_REQUEST');
            expect(res.payload.error.message).toContain('seedSampleData');
            expect(w.importUnmanagedPackage).not.toHaveBeenCalled();
            expect(h.register).not.toHaveBeenCalled();
            expect(w.writes).toEqual([]);
        }
    });

    it('the purge of an id that is no installed base still answers 404; an unreadable receipt answers 503 and deletes nothing', async () => {
        const w = world();
        const h = await w.boot();
        expect((await h.purge('com.example.nothing')).status).toBe(404);
        await h.install({ manifest: seededCrm(), installMode: 'unmanaged', seedSampleData: true });
        w.getMetaItems.mockRejectedValueOnce(new Error('sys_metadata is unreachable'));
        const before = w.writes.length;
        const res = await h.purge('com.example.crm-copy');
        expect(res.status).toBe(503);
        expect(res.payload.error.code).toBe('SERVICE_UNAVAILABLE');
        expect(w.writes.length).toBe(before);
    });
});
