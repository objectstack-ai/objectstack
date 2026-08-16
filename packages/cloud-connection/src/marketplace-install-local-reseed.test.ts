// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * HONEST RESULT for the reseed endpoint.
 *
 * The SeedLoaderService runs row-by-row and counts write failures (a locked
 * DB, a missing table, a rejected validation) into `result.errors` rather than
 * throwing. The reseed handler used to return `success: true` — AND flip the
 * install's `withSampleData` flag to true — whenever the loader didn't outright
 * skip, so a run that wrote ZERO rows still reported success while the database
 * stayed empty (the "提示成功但没有数据" bug). These tests pin the corrected
 * behaviour: no rows written => failure + flag stays false; rows written =>
 * success + flag flips.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Controls what the (mocked) seed loader reports back. The handler under test
// only cares about result.summary.total{Inserted,Updated} + result.errors.
let seedResult: any = { summary: { totalInserted: 0, totalUpdated: 0 }, errors: [] };

vi.mock('@objectstack/runtime', () => ({
    SeedLoaderService: class {
        async load() { return seedResult; }
    },
}));
vi.mock('@objectstack/spec/data', () => ({
    SeedLoaderRequestSchema: { parse: (x: any) => x },
}));

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

const SERVICES = () => ({
    manifest: { register: vi.fn() },
    auth: installerAuthService(),
    objectql: withInstallerGrants({ syncSchemas: async () => undefined }),
    metadata: {},
});

const MANIFEST = {
    id: 'app.test.proj',
    version: '1.0.0',
    objects: [{ name: 'pm_x', fields: { name: { type: 'text' } } }],
    data: [{ object: 'pm_x', records: [{ name: 'a' }, { name: 'b' }] }],
};

let dir: string;
beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mil-reseed-'));
    seedResult = { summary: { totalInserted: 0, totalUpdated: 0 }, errors: [] };
});
afterEach(() => { rmSync(dir, { recursive: true, force: true }); vi.restoreAllMocks(); });

async function installAndGetRoutes() {
    const rawApp = makeRawApp();
    const { ctx, fire } = makeCtx(rawApp, SERVICES());
    const plugin = new MarketplaceInstallLocalPlugin({ controlPlaneUrl: 'off', storageDir: dir });
    await plugin.start(ctx as any);
    await fire();
    // Install with seed loader reporting nothing — install must still succeed.
    const installRes = await rawApp.routes.get('POST /api/v1/marketplace/install-local')!(
        makeC({ manifest: MANIFEST }),
    );
    expect(installRes.payload?.success).toBe(true);
    return rawApp;
}

describe('reseed honest result', () => {
    it('FAILS (422) when the seed run wrote zero rows but errored', async () => {
        const rawApp = await installAndGetRoutes();
        seedResult = {
            summary: { totalInserted: 0, totalUpdated: 0 },
            errors: [{ message: 'database is locked' }, { message: 'database is locked' }],
        };
        const res = await rawApp.routes.get('POST /api/v1/marketplace/install-local/:manifestId/reseed-sample-data')!(
            makeC({}, 'app.test.proj'),
        );
        expect(res.status).toBe(422);
        expect(res.payload?.success).toBe(false);
        expect(res.payload?.error?.code).toBe('RESEED_NO_ROWS');
        // The real failure reason is surfaced, not swallowed.
        expect(res.payload?.error?.message).toContain('database is locked');
        expect(res.payload?.error?.details).toMatchObject({ inserted: 0, updated: 0, errors: 2 });
    });

    it('FAILS (422) when the package seeds nothing (0 rows, 0 errors)', async () => {
        const rawApp = await installAndGetRoutes();
        seedResult = { summary: { totalInserted: 0, totalUpdated: 0 }, errors: [] };
        const res = await rawApp.routes.get('POST /api/v1/marketplace/install-local/:manifestId/reseed-sample-data')!(
            makeC({}, 'app.test.proj'),
        );
        expect(res.status).toBe(422);
        expect(res.payload?.error?.code).toBe('RESEED_NO_ROWS');
    });

    it('SUCCEEDS and flips withSampleData when rows actually land', async () => {
        const rawApp = await installAndGetRoutes();
        seedResult = { summary: { totalInserted: 2, totalUpdated: 0 }, errors: [] };
        const res = await rawApp.routes.get('POST /api/v1/marketplace/install-local/:manifestId/reseed-sample-data')!(
            makeC({}, 'app.test.proj'),
        );
        expect(res.status).toBe(200);
        expect(res.payload?.success).toBe(true);
        expect(res.payload?.data).toMatchObject({ inserted: 2, updated: 0, withSampleData: true });

        // The ledger now reflects that sample data is present.
        const listRes = await rawApp.routes.get('GET /api/v1/marketplace/install-local')!(makeC({}));
        const entry = listRes.payload.data.items.find((i: any) => i.manifestId === 'app.test.proj');
        expect(entry?.withSampleData).toBe(true);
    });

    it('partial success (some rows + some errors) still reports the error count', async () => {
        const rawApp = await installAndGetRoutes();
        seedResult = {
            summary: { totalInserted: 1, totalUpdated: 0 },
            errors: [{ message: 'one row rejected' }],
        };
        const res = await rawApp.routes.get('POST /api/v1/marketplace/install-local/:manifestId/reseed-sample-data')!(
            makeC({}, 'app.test.proj'),
        );
        expect(res.status).toBe(200);
        expect(res.payload?.success).toBe(true);
        expect(res.payload?.data?.errors).toBe(1);
    });
});
