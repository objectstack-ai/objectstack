// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#31481, cloud#3624 ruling A「两边审计」] An unmanaged grant the install-local
 * door refuses still leaves the environment's audit row.
 *
 * The cloud-connection door hands the copy of a control-plane grant to the
 * in-process install-local door with the grant beside the request
 * (`install(request, { grant })`). Pinned at that door, booted through
 * `init()` + `start()` + `kernel:ready`, with the `audit` slot's
 * `recordPackageLifecycleEvent` recording what it is handed:
 *  - each refusal before the import runs (the install capability 403, the
 *    manifest fetch, the walled catalog, the protocol handshake) hands exactly
 *    ONE `package_unmanaged_import` failure event, with the answer's code and
 *    status and the grant's package, version, environment and installer;
 *  - an import that fails still hands exactly one (the import's own), and a
 *    copy that lands one success event: never a second, refusal event;
 *  - the same refusals of a plain install-local call, which no grant started,
 *    hand none.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import '@objectstack/runtime';
import { MarketplaceInstallLocalPlugin } from './marketplace-install-local-plugin.js';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { installerAuthService, withInstallerGrants } from './install-local-principal.fixtures.js';
import type { InstallLocalDoor, InstallLocalDoorGrant } from './install-local-door-service.js';

const ROUTE = '/api/v1/marketplace/install-local';
const INSTALLER = 'usr_installer';
/** A tenant organization under the wall: not the Default Organization. */
const TENANT_ORG = 'org_acme';
const GRANT: InstallLocalDoorGrant = { packageId: 'pkg_crm', version: '4.0.0', environmentId: 'env_1', actor: INSTALLER };

/** A flat package body that permits an unmanaged install. */
function crm(extra: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        id: 'com.example.crm',
        namespace: 'crm',
        version: '4.0.0',
        type: 'app',
        name: 'CRM',
        installModes: ['managed', 'unmanaged'],
        objects: [{ name: 'crm_lead', label: 'Lead', fields: { title: { type: 'text', label: 'Title' } } }],
        ...extra,
    };
}

let dir: string;
let posture: string | undefined;
let publicBase: string | undefined;
beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'install-local-grant-audit-'));
    posture = process.env.OS_TENANCY_POSTURE;
    publicBase = process.env.OS_MARKETPLACE_PUBLIC_BASE_URL;
    delete process.env.OS_TENANCY_POSTURE;
    process.env.OS_MARKETPLACE_PUBLIC_BASE_URL = 'off';
});
afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    if (posture === undefined) delete process.env.OS_TENANCY_POSTURE;
    else process.env.OS_TENANCY_POSTURE = posture;
    if (publicBase === undefined) delete process.env.OS_MARKETPLACE_PUBLIC_BASE_URL;
    else process.env.OS_MARKETPLACE_PUBLIC_BASE_URL = publicBase;
    vi.unstubAllGlobals();
});

async function boot(opts: {
    /** The installer holds no permission set: no install capability. */
    grantless?: boolean;
    /**
     * A walled deployment, as the kernel's `tenancy` service answers it, and the
     * session naming the installer's organization active: an organization's
     * `manage_metadata` holder, past the capability, and refused by the wall.
     */
    walled?: boolean;
    /** What the cloud's manifest fetch answers. */
    cloud?: { status: number; body?: unknown };
    importer?: (request: any) => Promise<any>;
} = {}) {
    const routes = new Map<string, (c: any) => Promise<any>>();
    const rawApp = {
        get: (p: string, h: any) => routes.set(`GET ${p}`, h),
        post: (p: string, h: any) => routes.set(`POST ${p}`, h),
        delete: (p: string, h: any) => routes.set(`DELETE ${p}`, h),
    };
    const hooks = new Map<string, any>();
    const importUnmanagedPackage = vi.fn(opts.importer ?? (async (request: any) => ({
        sourcePackageId: request.manifest.id,
        sourceVersion: request.manifest.version,
        targetPackageId: `${request.manifest.id}-copy`,
        namespace: request.manifest.namespace,
        copiedCount: 1,
        copied: [{ type: 'object', name: 'crm_lead' }],
        strippedLocks: [],
    })));
    const objectql = withInstallerGrants({
        syncSchemas: async () => undefined,
        manifests: new Map(),
        registry: { getAllPackages: () => [], getNamespaceOwners: () => [], getPackage: () => undefined },
    } as Record<string, any>, INSTALLER);
    if (opts.walled) {
        // The installer's grant is held in a tenant organization, not the Default
        // Organization, so under the wall it confers the set but no platform standing.
        const find = objectql.find;
        objectql.find = async (object: string, options?: unknown) => {
            const rows: any = await find(object, options);
            if (object === 'sys_user_permission_set') return rows.map((row: any) => ({ ...row, organization_id: TENANT_ORG }));
            if (object === 'sys_member') return [{ id: 'mem_1', user_id: INSTALLER, organization_id: TENANT_ORG, role: 'admin' }];
            return rows;
        };
    }
    if (opts.grantless) {
        // The wrapped engine is kept (the security catalog is bound to it); only its grant read answers empty.
        const find = objectql.find;
        objectql.find = async (object: string, options?: unknown) => (object === 'sys_user_permission_set' ? [] : find(object, options));
    }
    const auditEvents: any[] = [];
    const services: Record<string, any> = {
        manifest: { register: async () => undefined },
        auth: opts.walled
            ? { api: { getSession: async () => ({ user: { id: INSTALLER }, session: { activeOrganizationId: TENANT_ORG } }) } }
            : installerAuthService(INSTALLER),
        objectql,
        protocol: { importUnmanagedPackage },
        audit: { recordPackageLifecycleEvent: async (event: unknown) => { auditEvents.push(event); } },
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
        ...(opts.walled ? {
            getKernel: () => ({
                getServiceAsync: async (name: string) => {
                    if (name === 'tenancy') return { posture: 'isolated', isolationActive: true };
                    throw new Error(`Service '${name}' not found`);
                },
            }),
        } : {}),
    };
    const fetchSpy = vi.fn(async () => new Response(
        JSON.stringify(opts.cloud?.body ?? { success: true, data: { manifest: crm(), version_id: 'ver_9', version: '4.0.0' } }),
        { status: opts.cloud?.status ?? 200 },
    ));
    vi.stubGlobal('fetch', fetchSpy);
    const plugin = new MarketplaceInstallLocalPlugin({ controlPlaneUrl: 'http://cloud.test', storageDir: dir });
    await plugin.init(ctx as any);
    await plugin.start(ctx as any);
    await hooks.get('kernel:ready')?.();
    const door = services['marketplace-install-local'] as InstallLocalDoor;
    /**
     * The request the cloud-connection door builds for a grant: the cloud
     * branch, unmanaged; [#31963] with `extra` (the grant's own `manifest`,
     * `seedSampleData`) merged into its body.
     */
    const request = (extra: Record<string, unknown> = {}) => new Request(`http://localhost${ROUTE}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ packageId: 'pkg_crm', versionId: 'ver_9', installMode: 'unmanaged', ...extra }),
    });
    const answered = async (r: Response) => ({ status: r.status, payload: await r.json() as any });
    return {
        auditEvents,
        importUnmanagedPackage,
        fetchSpy,
        logger,
        viaGrant: async () => answered(await door.install(request(), { grant: GRANT })),
        plain: async () => answered(await door.install(request())),
        /** [#31963] The grant path with `extra` in the body and `grant` beside it. */
        viaGrantWith: async (extra: Record<string, unknown>, grant: InstallLocalDoorGrant) => answered(await door.install(request(extra), { grant })),
        /** [#31963] The same body, sent by no grant: a caller's file import. */
        plainWith: async (extra: Record<string, unknown>) => answered(await door.install(request(extra))),
        route: () => routes.get(`POST ${ROUTE}`)!,
    };
}

/** The one failure event a refused grant hands the audit slot. */
function refusalEvent(errorCode: string, status: number) {
    return {
        action: 'package_unmanaged_import',
        packageId: 'pkg_crm',
        version: '4.0.0',
        environmentId: 'env_1',
        actor: INSTALLER,
        outcome: 'failure',
        errorCode,
        status,
    };
}

/** The four refusals after the grant, each before the import runs. */
const REFUSALS: {
    name: string; arrange: () => Parameters<typeof boot>[0]; before?: () => void; code: string; status: number;
    /** A phrase of the refusal's own message, so the case reaches the refusal it names. */
    says: string;
}[] = [
    { name: 'the install capability', arrange: () => ({ grantless: true }), code: 'FORBIDDEN', status: 403, says: 'requires the `manage_metadata` capability' },
    { name: 'the manifest fetch', arrange: () => ({ cloud: { status: 500, body: { error: 'down' } } }), code: 'CLOUD_FETCH_FAILED', status: 502, says: 'Cloud returned 500' },
    {
        name: 'the walled catalog',
        arrange: () => ({ walled: true }),
        code: 'FORBIDDEN',
        status: 403,
        says: 'requires the platform operator',
    },
    {
        name: 'the protocol handshake',
        arrange: () => ({ cloud: { status: 200, body: { success: true, data: { manifest: crm({ engines: { protocol: '^1.0.0' } }), version_id: 'ver_9', version: '4.0.0' } } } }),
        code: 'OS_PROTOCOL_INCOMPATIBLE',
        status: 422,
        says: 'protocol',
    },
];

describe('[#31481] an unmanaged grant the install-local door refuses before the import is audited once', () => {
    for (const refusal of REFUSALS) {
        it(`${refusal.name}: ${refusal.status} ${refusal.code}, the import never called, exactly one failure event`, async () => {
            refusal.before?.();
            const h = await boot(refusal.arrange());
            const res = await h.viaGrant();
            expect(res.status, JSON.stringify(res.payload)).toBe(refusal.status);
            expect(res.payload.error.code).toBe(refusal.code);
            expect(res.payload.error.message).toContain(refusal.says);
            expect(h.importUnmanagedPackage).not.toHaveBeenCalled();
            expect(h.auditEvents).toEqual([refusalEvent(refusal.code, refusal.status)]);
        });

        it(`${refusal.name}, refused for a plain install-local call that no grant started: no event`, async () => {
            refusal.before?.();
            const h = await boot(refusal.arrange());
            const res = await h.plain();
            expect(res.status, JSON.stringify(res.payload)).toBe(refusal.status);
            expect(res.payload.error.code).toBe(refusal.code);
            expect(res.payload.error.message).toContain(refusal.says);
            expect(h.auditEvents).toEqual([]);
        });
    }

    it('a granted copy that lands hands its one success event, and no refusal event', async () => {
        const h = await boot();
        const res = await h.viaGrant();
        expect(res.status, JSON.stringify(res.payload)).toBe(200);
        expect(h.importUnmanagedPackage).toHaveBeenCalledTimes(1);
        expect(h.auditEvents).toHaveLength(1);
        expect(h.auditEvents[0]).toMatchObject({
            action: 'package_unmanaged_import',
            packageId: 'com.example.crm',
            targetPackageId: 'com.example.crm-copy',
            outcome: 'success',
            actor: INSTALLER,
        });
    });

    it('a granted copy whose import fails hands the import\'s one failure event, never a second', async () => {
        const h = await boot({
            importer: async () => { throw Object.assign(new Error('base exists'), { code: 'RESOURCE_CONFLICT', status: 409 }); },
        });
        const res = await h.viaGrant();
        expect(res.status, JSON.stringify(res.payload)).toBe(409);
        expect(h.auditEvents).toHaveLength(1);
        expect(h.auditEvents[0]).toMatchObject({
            action: 'package_unmanaged_import',
            packageId: 'com.example.crm',
            outcome: 'failure',
            errorCode: 'RESOURCE_CONFLICT',
            status: 409,
        });
    });

    it('an audit slot that throws changes no answer: the refusal is answered and the failure is logged at error', async () => {
        const h = await boot({ grantless: true });
        h.auditEvents.push = () => { throw new Error('ledger offline'); };
        const res = await h.viaGrant();
        expect(res.status).toBe(403);
        const errors = h.logger.error.mock.calls.map((call: unknown[]) => String(call[0]));
        expect(errors.join('\n')).toContain('package_unmanaged_import');
    });
});

// ── [#31963, cloud#3624 ruling A] the grant's own manifest, handed inline ──
//
// The cloud fetch cannot read an organization's PRIVATE manifest with the
// shared service key: here it answers 404, as the catalog does. The
// cloud-connection door hands the grant's `data.manifest` inline with the
// grant (`manifestId`, `version`) beside it; the door copies it only when it is
// the granted package and version, and every check of the cloud branch runs.

describe('[#31963] an unmanaged grant copies from the grant\'s own manifest, inline', () => {
    /** The grant of a private package, as the cloud-connection door hands it with an inline manifest. */
    const INLINE_GRANT: InstallLocalDoorGrant = { ...GRANT, manifestId: 'com.example.crm' };
    /** The catalog's answer to the shared service key for a private manifest. */
    const PRIVATE = { cloud: { status: 404, body: { error: 'not found' } } };

    it('the fix: a private package\'s grant with its manifest inline copies it, and the catalog is never asked', async () => {
        const h = await boot(PRIVATE);
        const res = await h.viaGrantWith({ manifest: crm() }, INLINE_GRANT);
        expect(res.status, JSON.stringify(res.payload)).toBe(200);
        expect(h.fetchSpy).not.toHaveBeenCalled();
        expect(h.importUnmanagedPackage).toHaveBeenCalledTimes(1);
        expect(h.importUnmanagedPackage.mock.calls[0][0].manifest).toMatchObject({ id: 'com.example.crm', version: '4.0.0' });
        // [#31481] The copy's own success row, and no refusal row.
        expect(h.auditEvents).toHaveLength(1);
        expect(h.auditEvents[0]).toMatchObject({ action: 'package_unmanaged_import', packageId: 'com.example.crm', outcome: 'success' });
    });

    it('CONTROL: the same private grant with no manifest in the body (an older control plane) takes the cloud fetch, which answers 404', async () => {
        const h = await boot(PRIVATE);
        const res = await h.viaGrant();
        expect(res.status, JSON.stringify(res.payload)).toBe(404);
        expect(res.payload.error.code).toBe('CLOUD_FETCH_FAILED');
        expect(h.fetchSpy).toHaveBeenCalledTimes(1);
        expect(h.importUnmanagedPackage).not.toHaveBeenCalled();
        expect(h.auditEvents).toEqual([refusalEvent('CLOUD_FETCH_FAILED', 404)]);
    });

    for (const c of [
        { name: 'a manifest declaring another package', manifest: () => crm({ id: 'com.example.other' }), grant: INLINE_GRANT },
        { name: 'a manifest at another version', manifest: () => crm({ version: '4.0.1' }), grant: INLINE_GRANT },
        { name: 'a grant naming no manifest id', manifest: () => crm(), grant: GRANT },
        { name: 'a grant naming no version', manifest: () => crm(), grant: { packageId: 'pkg_crm', manifestId: 'com.example.crm', environmentId: 'env_1', actor: INSTALLER } },
    ]) {
        it(`fails closed on ${c.name}: 502 PLUGIN_MANIFEST_INVALID, nothing copied, audited once`, async () => {
            const h = await boot(PRIVATE);
            const res = await h.viaGrantWith({ manifest: c.manifest() }, c.grant);
            expect(res.status, JSON.stringify(res.payload)).toBe(502);
            expect(res.payload.error.code).toBe('PLUGIN_MANIFEST_INVALID');
            expect(res.payload.error.message).toContain('Nothing was copied');
            expect(h.importUnmanagedPackage).not.toHaveBeenCalled();
            expect(h.fetchSpy).not.toHaveBeenCalled();
            expect(h.auditEvents).toHaveLength(1);
            expect(h.auditEvents[0]).toMatchObject({ action: 'package_unmanaged_import', packageId: 'pkg_crm', outcome: 'failure', errorCode: 'PLUGIN_MANIFEST_INVALID', status: 502 });
        });
    }

    // Every check of the cloud branch is judged on the inline manifest too.
    for (const c of [
        { name: 'the installModes gate', manifest: () => crm({ installModes: ['managed'] }), code: 'INSTALL_MODE_NOT_PERMITTED', status: 422 },
        { name: 'the ADR-0087 engines handshake', manifest: () => crm({ engines: { protocol: '^1.0.0' } }), code: 'OS_PROTOCOL_INCOMPATIBLE', status: 422 },
        { name: 'the ADR-0141 dependency check', manifest: () => crm({ dependencies: { 'com.example.sales': '6.x' } }), code: 'DEPENDENCY_MISSING', status: 422 },
    ]) {
        it(`${c.name} judges the grant's inline manifest: ${c.status} ${c.code}, nothing copied, audited once`, async () => {
            const h = await boot(PRIVATE);
            const res = await h.viaGrantWith({ manifest: c.manifest() }, INLINE_GRANT);
            expect(res.status, JSON.stringify(res.payload)).toBe(c.status);
            expect(res.payload.error.code).toBe(c.code);
            expect(h.importUnmanagedPackage).not.toHaveBeenCalled();
            expect(h.auditEvents).toEqual([refusalEvent(c.code, c.status)]);
        });
    }

    it('the walled catalog judges the grant\'s inline manifest: 403, nothing copied', async () => {
        const h = await boot({ ...PRIVATE, walled: true });
        const res = await h.viaGrantWith({ manifest: crm() }, INLINE_GRANT);
        expect(res.status, JSON.stringify(res.payload)).toBe(403);
        expect(h.importUnmanagedPackage).not.toHaveBeenCalled();
        expect(h.auditEvents).toEqual([refusalEvent('FORBIDDEN', 403)]);
    });

    it('seedSampleData reaches the import as on the cloud branch (#30808)', async () => {
        const h = await boot(PRIVATE);
        const res = await h.viaGrantWith({ manifest: crm(), seedSampleData: true }, INLINE_GRANT);
        expect(res.status, JSON.stringify(res.payload)).toBe(200);
        expect(h.importUnmanagedPackage.mock.calls[0][0]).toMatchObject({ seedData: true });
    });

    it('an invalid id in the grant\'s manifest answers 502, as a fetched one does; a caller\'s file still answers 400', async () => {
        const bad = () => crm({ id: 'late-app' });
        const granted = await boot(PRIVATE);
        const viaGrant = await granted.viaGrantWith({ manifest: bad() }, INLINE_GRANT);
        expect(viaGrant.status, JSON.stringify(viaGrant.payload)).toBe(502);
        expect(viaGrant.payload.error.code).toBe('PLUGIN_MANIFEST_INVALID');
        const fetched = await boot({ cloud: { status: 200, body: { success: true, data: { manifest: bad(), version_id: 'ver_9', version: '4.0.0' } } } });
        expect((await fetched.viaGrant()).status).toBe(502);
        const plain = await boot(PRIVATE);
        const file = await plain.plainWith({ manifest: bad() });
        expect(file.status, JSON.stringify(file.payload)).toBe(400);
        expect(file.payload.error.code).toBe('PLUGIN_MANIFEST_INVALID');
    });

    it('CONTROL: a caller\'s file import, which no grant started, is not held to a grant: it copies its own manifest, as before', async () => {
        const h = await boot(PRIVATE);
        const res = await h.plainWith({ manifest: crm({ id: 'com.example.other' }) });
        expect(res.status, JSON.stringify(res.payload)).toBe(200);
        expect(h.importUnmanagedPackage.mock.calls[0][0].manifest).toMatchObject({ id: 'com.example.other' });
    });
});

describe('[#31482] the copy-once import\'s own namespace refusals, reached through the grant path, keep their codes and statuses', () => {
    // The REAL copy-once import, not a double. The cloud-connection door hands
    // the grant's `data.target_namespace` as `targetNamespace`; what the import
    // answers about that name is the caller's to fix (another name), so the
    // grant path keeps the import's 409 / 400, never the 502 an unreadable
    // grant answers. Each is audited once, by the import's own failure event.
    const realImporter = (owners: Record<string, string[]> = {}) => {
        const protocol = new ObjectStackProtocolImplementation(
            { registry: { getNamespaceOwners: (ns: string) => owners[ns] ?? [] } } as any,
            () => new Map(),
        ) as any;
        return (request: any) => protocol.importUnmanagedPackage(request);
    };

    it('a namespace another package owns: 409 RESOURCE_CONFLICT with `details { namespace, owners }`, audited once', async () => {
        const h = await boot({ importer: realImporter({ acme: ['com.example.other'] }) });
        const res = await h.viaGrantWith({ targetNamespace: 'acme' }, GRANT);
        expect(res.status, JSON.stringify(res.payload)).toBe(409);
        expect(res.payload.error.code).toBe('RESOURCE_CONFLICT');
        expect(res.payload.error.details).toEqual({ namespace: 'acme', owners: ['com.example.other'] });
        expect(h.importUnmanagedPackage.mock.calls[0][0]).toMatchObject({ targetNamespace: 'acme' });
        expect(h.auditEvents).toHaveLength(1);
        expect(h.auditEvents[0]).toMatchObject({ action: 'package_unmanaged_import', outcome: 'failure', errorCode: 'RESOURCE_CONFLICT', status: 409 });
    });

    it('a platform-reserved namespace: 400 INVALID_REQUEST with `details.targetNamespace`, audited once', async () => {
        const h = await boot({ importer: realImporter() });
        const res = await h.viaGrantWith({ targetNamespace: 'sys' }, GRANT);
        expect(res.status, JSON.stringify(res.payload)).toBe(400);
        expect(res.payload.error.code).toBe('INVALID_REQUEST');
        expect(res.payload.error.details).toEqual({ targetNamespace: 'sys' });
        expect(h.auditEvents).toHaveLength(1);
        expect(h.auditEvents[0]).toMatchObject({ outcome: 'failure', errorCode: 'INVALID_REQUEST', status: 400 });
    });
});
