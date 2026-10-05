// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0123 D1 / D2 / D4] A walled session with NO active organization, at the
 * three install-local doors that seed or purge sample data.
 *
 * ## What was measured before this file
 *
 * On a posture-only (walled) boot, a signed-in admin whose session carried no
 * `activeOrganizationId`, though their user held a `sys_member` row:
 *
 *   POST …/install-local                          -> 200, seeded {mode: "skipped", reason: "multi-tenant-no-active-org"}
 *   POST …/install-local/:id/reseed-sample-data   -> 400 RESEED_SKIPPED "Reseed did not run: multi-tenant-no-active-org"
 *   POST …/install-local/:id/purge-sample-data    -> 400 RESEED_SKIPPED
 *
 * and the resolver's "first membership" fallback read an object no package
 * defines, so it threw and was swallowed. ADR-0123 already rules on this state:
 * D1 makes it legal and named, so no subsystem guesses an organization for it;
 * D2 refuses a tenant-scoped write loudly, with the catalog's
 * `PERMISSION_DENIED` / 403; D4 says the refusal names the missing active
 * organization.
 *
 * ## What this file pins
 *
 *   1. walled, no active organization, the user a member of TWO organizations:
 *      the install registers the package and reports `seeded {mode: "refused"}`
 *      with the sentence in `reason`; the reseed and the purge answer the 403
 *      envelope; no seed run starts and no organization is guessed;
 *   2. walled, an active organization: all three doors act in it, as before;
 *   3. unwalled (`single`): the active-organization read is never consulted.
 *
 * The membership rows are served by the store on purpose: a resolver that
 * guessed from them (under either object name the platform has spelled) would
 * seed into one of the two organizations, and case 1 would go red.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let loadCalls: any[] = [];

vi.mock('@objectstack/runtime', () => ({
    SeedLoaderService: class {
        async load(request: any) {
            loadCalls.push(request);
            return { summary: { totalInserted: 2, totalUpdated: 0, totalSkipped: 0 }, errors: [] };
        }
        async buildDependencyGraph(objects: string[]) {
            return { insertOrder: objects, nodes: objects.map((object) => ({ object, dependsOn: [], references: [] })) };
        }
    },
    recordSeedOutcome: vi.fn(),
}));
// Only the seed-request parse is stubbed; every other export stays the real one,
// because `@objectstack/core` reads `@objectstack/spec/data` values at module load.
vi.mock('@objectstack/spec/data', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@objectstack/spec/data')>()),
    SeedLoaderRequestSchema: { parse: (x: any) => x },
}));

import { MarketplaceInstallLocalPlugin } from './marketplace-install-local-plugin.js';
import { INSTALLER_USER_ID, withInstallerGrants } from './install-local-principal.fixtures.js';
import { LocalManifestSource } from './local-manifest-source.js';

type Handler = (c: any) => Promise<any>;

const BASE = '/api/v1/marketplace/install-local';
const MANIFEST = {
    id: 'app.test.noorg',
    version: '1.0.0',
    objects: [{ name: 'noorg_x', fields: { name: { type: 'text' } } }],
    data: [{ object: 'noorg_x', externalId: 'name', records: [{ name: 'a' }, { name: 'b' }] }],
};

/** The installer is a member of two organizations; the store says so under both spellings. */
const MEMBERSHIPS = [
    { id: 'mem_a', organization_id: 'org_a', user_id: INSTALLER_USER_ID, role: 'owner' },
    { id: 'mem_b', organization_id: 'org_b', user_id: INSTALLER_USER_ID, role: 'owner' },
];

function makeC(body: unknown, manifestId?: string) {
    return {
        req: {
            url: `http://localhost:3000${BASE}`,
            raw: new Request('http://localhost:3000/x'),
            json: async () => body,
            param: (k: string) => (k === 'manifestId' ? manifestId : undefined),
            header: () => undefined,
        },
        json: vi.fn((payload: any, status?: number) => ({ payload, status: status ?? 200 })),
    };
}

let dir: string;
beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mil-noorg-'));
    loadCalls = [];
});
afterEach(() => { rmSync(dir, { recursive: true, force: true }); vi.restoreAllMocks(); });

/**
 * Boot the real plugin. `posture` is the `tenancy` service's posture in force;
 * `activeOrg` what the session's `activeOrganizationId` says (absent: none).
 */
async function boot(opts: { posture: 'single' | 'isolated'; activeOrg?: string }) {
    const routes = new Map<string, Handler>();
    const rawApp = {
        get: (p: string, h: Handler) => routes.set(`GET ${p}`, h),
        post: (p: string, h: Handler) => routes.set(`POST ${p}`, h),
        delete: (p: string, h: Handler) => routes.set(`DELETE ${p}`, h),
    };
    const reads: Array<{ object: string; query: any }> = [];
    const granted = withInstallerGrants({
        syncSchemas: async () => undefined,
        find: async (object: string, query?: any) => { reads.push({ object, query }); return []; },
    });
    const objectql = {
        ...granted,
        find: async (object: string, query?: any) => {
            if (object === 'sys_member' || object === 'sys_organization_member') {
                reads.push({ object, query });
                return MEMBERSHIPS.map((m) => ({ ...m }));
            }
            return granted.find(object, query);
        },
    };
    const register = vi.fn();
    const services: Record<string, unknown> = {
        manifest: { register },
        auth: {
            api: {
                getSession: async () => ({
                    user: { id: INSTALLER_USER_ID },
                    session: opts.activeOrg ? { activeOrganizationId: opts.activeOrg } : {},
                }),
            },
        },
        objectql,
        metadata: {},
        tenancy: { posture: opts.posture },
    };
    const hooks = new Map<string, any>();
    const ctx = {
        hook: (e: string, h: any) => hooks.set(e, h),
        getService: (name: string) => {
            if (name === 'http-server') return { getRawApp: () => rawApp };
            const svc = services[name];
            if (svc === undefined) throw new Error(`no ${name}`);
            return svc;
        },
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    };
    const plugin = new MarketplaceInstallLocalPlugin({ controlPlaneUrl: 'off', storageDir: dir });
    const resolveActiveOrgId = vi.spyOn(plugin as any, 'resolveActiveOrgId');
    await plugin.start(ctx as any);
    await hooks.get('kernel:ready')?.();
    return {
        register,
        reads,
        resolveActiveOrgId,
        install: () => routes.get(`POST ${BASE}`)!(makeC({ manifest: MANIFEST })),
        reseed: () => routes.get(`POST ${BASE}/:manifestId/reseed-sample-data`)!(makeC({}, MANIFEST.id)),
        purge: () => routes.get(`POST ${BASE}/:manifestId/purge-sample-data`)!(makeC({}, MANIFEST.id)),
    };
}

const ledgerEntry = () => new LocalManifestSource(dir).read(MANIFEST.id).entry;

describe('walled, no active organization — refused at every sample-data door, and no organization is guessed', () => {
    it('install: the package registers, and `seeded` reports the refusal instead of seeding', async () => {
        const m = await boot({ posture: 'isolated' });
        const res = await m.install();

        expect(res.status).toBe(200);
        expect(res.payload.success).toBe(true);
        expect(m.register).toHaveBeenCalled();
        expect(ledgerEntry()?.manifestId).toBe(MANIFEST.id);
        expect(Object.keys(res.payload.data.seeded).sort()).toEqual(['mode', 'reason']);
        expect(res.payload.data.seeded.mode).toBe('refused');
        expect(res.payload.data.seeded.reason).toContain('this session has no active organization');
        expect(loadCalls).toHaveLength(0);
        expect(ledgerEntry()?.withSampleData).not.toBe(true);
    });

    it('reseed: 403 PERMISSION_DENIED naming the missing active organization, and no seed run', async () => {
        const m = await boot({ posture: 'isolated' });
        await m.install();
        const res = await m.reseed();

        expect(res.status).toBe(403);
        expect(res.payload.success).toBe(false);
        expect(res.payload.error.code).toBe('PERMISSION_DENIED');
        expect(res.payload.error.message).toContain('this session has no active organization');
        expect(loadCalls).toHaveLength(0);
        expect(ledgerEntry()?.withSampleData).not.toBe(true);
    });

    it('purge: 403 PERMISSION_DENIED naming the missing active organization, and no seed object is read', async () => {
        const m = await boot({ posture: 'isolated' });
        await m.install();
        const res = await m.purge();

        expect(res.status).toBe(403);
        expect(res.payload.success).toBe(false);
        expect(res.payload.error.code).toBe('PERMISSION_DENIED');
        expect(res.payload.error.message).toContain('this session has no active organization');
        expect(m.reads.filter((r) => r.object === 'noorg_x')).toEqual([]);
        expect(ledgerEntry()?.sampleDataPurged).toBeUndefined();
    });
});

describe('walled, an active organization — all three doors act in it, as before', () => {
    it('install seeds inline into the active organization', async () => {
        const m = await boot({ posture: 'isolated', activeOrg: 'org_b' });
        const res = await m.install();

        expect(res.status).toBe(200);
        expect(res.payload.data.seeded).toMatchObject({ mode: 'inline', inserted: 2 });
        expect(loadCalls).toHaveLength(1);
        expect(loadCalls[0].config.organizationId).toBe('org_b');
    });

    it('reseed seeds into the active organization', async () => {
        const m = await boot({ posture: 'isolated', activeOrg: 'org_b' });
        await m.install();
        const res = await m.reseed();

        expect(res.status).toBe(200);
        expect(res.payload.data).toMatchObject({ inserted: 2, withSampleData: true });
        expect(loadCalls).toHaveLength(2);
        expect(loadCalls[1].config.organizationId).toBe('org_b');
    });

    it('purge reads the seed object in the active organization only', async () => {
        const m = await boot({ posture: 'isolated', activeOrg: 'org_b' });
        await m.install();
        const res = await m.purge();

        expect(res.status).toBe(200);
        expect(res.payload.success).toBe(true);
        const seedReads = m.reads.filter((r) => r.object === 'noorg_x');
        expect(seedReads).toHaveLength(1);
        expect(seedReads[0].query.where).toEqual({ organization_id: 'org_b' });
    });
});

describe('unwalled (`single`) — the active-organization read is never consulted', () => {
    it('install, reseed and purge act table-wide with no organization, and never ask for one', async () => {
        const m = await boot({ posture: 'single' });

        const install = await m.install();
        expect(install.status).toBe(200);
        expect(install.payload.data.seeded).toMatchObject({ mode: 'inline', inserted: 2 });
        const reseed = await m.reseed();
        expect(reseed.status).toBe(200);
        const purge = await m.purge();
        expect(purge.status).toBe(200);

        expect(loadCalls).toHaveLength(2);
        for (const call of loadCalls) expect(call.config.organizationId).toBeUndefined();
        const seedReads = m.reads.filter((r) => r.object === 'noorg_x');
        expect(seedReads).toHaveLength(1);
        expect(seedReads[0].query.where).toBeUndefined();
        expect(m.resolveActiveOrgId).not.toHaveBeenCalled();
    });
});
