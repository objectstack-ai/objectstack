// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Rehydrate-time sample-data healing.
 *
 * The install ledger lives under `<cwd>/.objectstack/installed-packages/` while
 * the database can be swapped out from under it (`os dev --fresh`, a deleted
 * dev.db, a `--database` switch). Rehydrate deliberately skips seeding
 * (existing rows must not be re-upserted over user edits on every boot), which
 * used to leave a rehydrated package PERMANENTLY empty on a new database: app
 * in the switcher, tables created, zero rows — the "HotCRM installed but every
 * KPI is 0" bug. These tests pin the healer that closes the gap:
 *
 *   • all seeded objects empty  → seeds run, `withSampleData` flips true
 *   • any surviving row         → untouched (no silent demo-data reverts)
 *   • explicit purge            → stays empty across restarts
 *   • multi-tenant mode         → left to the per-org replay
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// What the (mocked) seed loader reports back, plus a call journal so tests can
// assert whether/what the healer actually seeded.
let seedResult: any = { summary: { totalInserted: 0, totalUpdated: 0, totalSkipped: 0 }, errors: [] };
let loadCalls: any[] = [];

vi.mock('@objectstack/runtime', () => ({
    SeedLoaderService: class {
        async load(request: any) { loadCalls.push(request); return seedResult; }
    },
}));
vi.mock('@objectstack/spec/data', () => ({
    SeedLoaderRequestSchema: { parse: (x: any) => x },
}));

import { MarketplaceInstallLocalPlugin } from './marketplace-install-local-plugin.js';
import { LocalManifestSource } from './local-manifest-source.js';

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

/** A Hono-ish context. `param` carries the :manifestId route value. */
function makeC(body: any, manifestId?: string) {
    const json = vi.fn((payload: any, status?: number) => ({ payload, status: status ?? 200 }));
    return {
        req: {
            url: 'http://localhost:3000/api/v1/marketplace/install-local',
            raw: new Request('http://localhost:3000/x'),
            json: async () => body,
            param: (k: string) => (k === 'manifestId' ? manifestId : undefined),
            header: () => undefined,
        },
        json,
    };
}

const MANIFEST = {
    id: 'app.test.crm',
    version: '1.0.0',
    objects: [{ name: 'crm_x', fields: { name: { type: 'text' } } }],
    data: [
        { object: 'crm_x', records: [{ id: 'a', name: 'a' }, { id: 'b', name: 'b' }] },
        { object: 'crm_y', records: [{ id: 'c', name: 'c' }] },
    ],
};

/** Services with a controllable emptiness probe. */
function makeServices(findRows: Record<string, any[]>) {
    return {
        manifest: { register: vi.fn() },
        auth: { api: { getSession: async () => ({ user: { id: 'admin' } }) } },
        objectql: {
            syncSchemas: async () => undefined,
            find: vi.fn(async (object: string) => findRows[object] ?? []),
        },
        metadata: {},
        driver: { delete: vi.fn(async () => true) },
    };
}

let dir: string;
beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mil-heal-'));
    seedResult = { summary: { totalInserted: 0, totalUpdated: 0, totalSkipped: 0 }, errors: [] };
    loadCalls = [];
});
afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.OS_MULTI_ORG_ENABLED;
    vi.restoreAllMocks();
});

/** Pre-write a ledger entry, then boot a fresh plugin so rehydrate runs. */
async function rehydrateWith(entryOverrides: Record<string, any>, findRows: Record<string, any[]>) {
    new LocalManifestSource(dir).write({
        packageId: 'pkg_1',
        versionId: 'pkgv_1',
        manifestId: MANIFEST.id,
        version: MANIFEST.version,
        manifest: MANIFEST,
        installedAt: '2026-01-01T00:00:00.000Z',
        installedBy: 'admin',
        withSampleData: false,
        ...entryOverrides,
    });
    const rawApp = makeRawApp();
    const services = makeServices(findRows);
    const { ctx, fire } = makeCtx(rawApp, services);
    const plugin = new MarketplaceInstallLocalPlugin({ controlPlaneUrl: 'off', storageDir: dir });
    await plugin.start(ctx as any);
    await fire();
    return { rawApp, services, ctx };
}

describe('rehydrate sample-data healing', () => {
    it('reseeds a rehydrated package when every seeded object is empty', async () => {
        seedResult = { summary: { totalInserted: 3, totalUpdated: 0, totalSkipped: 0 }, errors: [] };
        await rehydrateWith({}, { crm_x: [], crm_y: [] });

        expect(loadCalls).toHaveLength(1);
        // The full bundled datasets are replayed, as an upsert.
        expect(loadCalls[0].seeds).toHaveLength(2);
        expect(loadCalls[0].config).toMatchObject({ defaultMode: 'upsert', multiPass: true });
        // No org id in single-tenant mode.
        expect(loadCalls[0].config.organizationId).toBeUndefined();

        // The ledger now records that sample data is present again.
        const entry = new LocalManifestSource(dir).read(MANIFEST.id)!;
        expect(entry.withSampleData).toBe(true);
        expect(entry.sampleDataPurged).toBe(false);
    });

    it('does NOT reseed when any seeded object still has rows', async () => {
        await rehydrateWith({}, { crm_x: [], crm_y: [{ id: 'c' }] });
        expect(loadCalls).toHaveLength(0);
    });

    it('does NOT resurrect explicitly purged sample data', async () => {
        await rehydrateWith({ sampleDataPurged: true }, { crm_x: [], crm_y: [] });
        expect(loadCalls).toHaveLength(0);
    });

    it('leaves multi-tenant seeding to the per-org replay', async () => {
        process.env.OS_MULTI_ORG_ENABLED = 'true';
        await rehydrateWith({}, { crm_x: [], crm_y: [] });
        expect(loadCalls).toHaveLength(0);
    });

    it('keeps withSampleData false when the heal run lands no rows', async () => {
        seedResult = { summary: { totalInserted: 0, totalUpdated: 0, totalSkipped: 0 }, errors: [{ message: 'database is locked' }] };
        const { ctx } = await rehydrateWith({}, { crm_x: [], crm_y: [] });
        expect(loadCalls).toHaveLength(1);
        const entry = new LocalManifestSource(dir).read(MANIFEST.id)!;
        expect(entry.withSampleData).toBe(false);
        // The failure is loud, with the underlying reason.
        expect((ctx.logger.warn as any).mock.calls.some((c: any[]) => String(c[0]).includes('database is locked'))).toBe(true);
    });

    it('purge → restart keeps the package empty (end to end through the endpoints)', async () => {
        // Install over an empty DB, with rows landing.
        seedResult = { summary: { totalInserted: 3, totalUpdated: 0, totalSkipped: 0 }, errors: [] };
        const rawApp = makeRawApp();
        const services = makeServices({ crm_x: [], crm_y: [] });
        const { ctx, fire } = makeCtx(rawApp, services);
        const plugin = new MarketplaceInstallLocalPlugin({ controlPlaneUrl: 'off', storageDir: dir });
        await plugin.start(ctx as any);
        await fire();
        const installRes = await rawApp.routes.get('POST /api/v1/marketplace/install-local')!(
            makeC({ manifest: MANIFEST }),
        );
        expect(installRes.payload?.success).toBe(true);

        // Purge the sample data.
        const purgeRes = await rawApp.routes.get('POST /api/v1/marketplace/install-local/:manifestId/purge-sample-data')!(
            makeC({}, MANIFEST.id),
        );
        expect(purgeRes.payload?.success).toBe(true);
        expect(new LocalManifestSource(dir).read(MANIFEST.id)?.sampleDataPurged).toBe(true);

        // Restart (fresh plugin over the same ledger, DB now empty): no reseed.
        loadCalls = [];
        const rawApp2 = makeRawApp();
        const { ctx: ctx2, fire: fire2 } = makeCtx(rawApp2, makeServices({ crm_x: [], crm_y: [] }));
        const plugin2 = new MarketplaceInstallLocalPlugin({ controlPlaneUrl: 'off', storageDir: dir });
        await plugin2.start(ctx2 as any);
        await fire2();
        expect(loadCalls).toHaveLength(0);
    });

    it('install marks withSampleData=true when rows were skipped (already present)', async () => {
        // Reinstall over a database that already holds the demo rows: the
        // loader reports all-skipped. The ledger must still say the install
        // carries sample data — this was the stale-`false` quirk that made
        // older ledgers look purge-like.
        seedResult = { summary: { totalInserted: 0, totalUpdated: 0, totalSkipped: 3 }, errors: [] };
        const rawApp = makeRawApp();
        const { ctx, fire } = makeCtx(rawApp, makeServices({ crm_x: [{ id: 'a' }], crm_y: [{ id: 'c' }] }));
        const plugin = new MarketplaceInstallLocalPlugin({ controlPlaneUrl: 'off', storageDir: dir });
        await plugin.start(ctx as any);
        await fire();
        const installRes = await rawApp.routes.get('POST /api/v1/marketplace/install-local')!(
            makeC({ manifest: MANIFEST }),
        );
        expect(installRes.payload?.success).toBe(true);
        expect(new LocalManifestSource(dir).read(MANIFEST.id)?.withSampleData).toBe(true);
    });
});
