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
    /** The request the cloud-connection door builds for a grant: the cloud branch, unmanaged. */
    const request = () => new Request(`http://localhost${ROUTE}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ packageId: 'pkg_crm', versionId: 'ver_9', installMode: 'unmanaged' }),
    });
    return {
        auditEvents,
        importUnmanagedPackage,
        fetchSpy,
        logger,
        viaGrant: async () => { const r = await door.install(request(), { grant: GRANT }); return { status: r.status, payload: await r.json() as any }; },
        plain: async () => { const r = await door.install(request()); return { status: r.status, payload: await r.json() as any }; },
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
