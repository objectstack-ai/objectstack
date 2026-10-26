// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0141 D2 at `POST /api/v1/marketplace/install-local`: an install whose
 * delivered packages declare `dependencies` this runtime does not satisfy is
 * refused `422 DEPENDENCY_MISSING`, with the answer the other package-install
 * doors give, before the manifest service sees the artifact.
 *
 * ## What these cases pin
 *
 *   - the refusal on both install branches (inline manifest, cloud snapshot):
 *     the declared envelope, the code and status, and the closed details shape
 *     (`compatible`, `issues`, `unmet`);
 *   - nothing is registered, no ledger file is written, no schema is synced;
 *   - a dependency installed inside its range is admitted (the lit control);
 *   - a multi-package artifact whose module declares its app — delivered by
 *     the same artifact — installs, judged for presence only, while an entry
 *     naming a package outside the artifact is still judged;
 *   - the `kernel:ready` rehydrate does NOT run the check: a ledger entry whose
 *     dependency is absent at boot still re-registers (ADR-0141 D2, "where it
 *     does not run").
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BaseResponseSchema, ApiErrorSchema, envelopeViolations } from '@objectstack/spec/api';
// An install binds the package's handlers through `@objectstack/runtime` (a
// lazy `import()` inside the plugin); its first load is paid here, at module
// top, never inside a clocked `it`.
import '@objectstack/runtime';
import { MarketplaceInstallLocalPlugin } from './marketplace-install-local-plugin.js';
import { LocalManifestSource } from './local-manifest-source.js';
import { installerAuthService, withInstallerGrants } from './install-local-principal.fixtures.js';

type Handler = (c: any) => Promise<any>;

const ROUTE = '/api/v1/marketplace/install-local';

/** The dependent: 「请先安装 Sales 6.x」. */
const PSA = {
    id: 'com.example.psa', name: 'PSA', version: '1.0.0', scope: 'project', type: 'app',
    dependencies: { 'com.example.sales': '6.x' },
};

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
 * Mount the plugin through its real lifecycle (`start()` + `kernel:ready`),
 * over a registry that already holds `installed` (id → version).
 */
async function mount(dir: string, installed: Record<string, string> = {}, opts: { controlPlaneUrl?: string } = {}) {
    const rawApp = makeRawApp();
    const hooks = new Map<string, any>();
    const registered: any[] = [];
    const register = vi.fn((m: any) => { registered.push({ manifest: m }); });
    const syncSchemas = vi.fn(async () => undefined);
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const registry = {
        getAllPackages: () => registered,
        getPackage: (id: string) => (id in installed ? { manifest: { id, version: installed[id] } } : undefined),
    };
    const services: Record<string, any> = {
        manifest: { register },
        auth: installerAuthService(),
        objectql: withInstallerGrants({ syncSchemas, registry }),
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
    const syncedAtBoot = syncSchemas.mock.calls.length;
    return {
        install: (body: unknown) => rawApp.routes.get(`POST ${ROUTE}`)!(makeC(body)),
        installRegistrations: () => register.mock.calls.slice(registeredAtBoot).map((call) => call[0]),
        installSyncs: () => syncSchemas.mock.calls.length - syncedAtBoot,
        bootRegistrations: () => register.mock.calls.slice(0, registeredAtBoot).map((call) => call[0]),
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

function expectDependencyRefusal(res: { payload: any; status: number }, unmet: unknown[]) {
    expect(res.status, JSON.stringify(res.payload)).toBe(422);
    expect(BaseResponseSchema.safeParse(res.payload).success).toBe(true);
    expect(envelopeViolations(res.payload)).toEqual([]);
    expect(ApiErrorSchema.safeParse(res.payload.error).success).toBe(true);
    const { error } = res.payload;
    expect(error.code).toBe('DEPENDENCY_MISSING');
    expect(Object.keys(error.details).sort()).toEqual(['compatible', 'issues', 'unmet']);
    expect(error.details.compatible).toBe(false);
    expect(error.details.unmet).toEqual(unmet);
    expect(error.details.issues.map((i: any) => i.category)).toEqual(unmet.map(() => 'dependency_missing'));
}

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mil-dependency-')); });
afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
});

function expectNothingWritten(h: { installRegistrations: () => unknown[]; installSyncs: () => number }) {
    expect(h.installRegistrations()).toEqual([]);
    expect(h.installSyncs()).toBe(0);
    expect(readdirSync(dir)).toEqual([]);
}

describe('POST install-local: ADR-0141 D2 refuses an unsatisfied dependency, and installs nothing', () => {
    it('refuses an absent dependency (inline manifest)', async () => {
        const h = await mount(dir);
        expectDependencyRefusal(await h.install({ manifest: PSA }), [
            { packageId: 'com.example.psa', dependency: 'com.example.sales', range: '6.x', found: 'absent' },
        ]);
        expectNothingWritten(h);
    });

    it('refuses a dependency installed outside the range', async () => {
        const h = await mount(dir, { 'com.example.sales': '5.4.0' });
        expectDependencyRefusal(await h.install({ manifest: PSA }), [
            { packageId: 'com.example.psa', dependency: 'com.example.sales', range: '6.x', found: 'out-of-range', installedVersion: '5.4.0' },
        ]);
        expectNothingWritten(h);
    });

    it('refuses a cloud snapshot the same way: 422, not the 502 of an upstream fault', async () => {
        vi.stubEnv('OS_MARKETPLACE_PUBLIC_BASE_URL', 'off');
        vi.stubEnv('OS_CLOUD_API_KEY', 'svc-test-key');
        const fetchMock = vi.fn(async () => new Response(
            JSON.stringify({ data: { manifest: PSA, version: '1.0.0', version_id: 'ver_1' } }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
        ));
        vi.stubGlobal('fetch', fetchMock);
        const h = await mount(dir, {}, { controlPlaneUrl: 'http://cloud.test' });
        const res = await h.install({ packageId: 'pkg_psa' });
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expectDependencyRefusal(res, [
            { packageId: 'com.example.psa', dependency: 'com.example.sales', range: '6.x', found: 'absent' },
        ]);
        expectNothingWritten(h);
    });

    it('lit control: installs once the dependency is installed inside the range', async () => {
        const h = await mount(dir, { 'com.example.sales': '6.2.0' });
        const res = await h.install({ manifest: PSA });
        expect(res.status, JSON.stringify(res.payload)).toBe(200);
        expect(h.installRegistrations()).toHaveLength(1);
    });
});

describe('POST install-local: a multi-package artifact judges each entry, presence-only inside the artifact', () => {
    const artifact = (ordersDeps: Record<string, string>) => ({
        id: 'com.example.multi', name: 'Multi', version: '1.0.0', scope: 'project', type: 'app',
        packages: [
            { manifest: { id: 'com.example.multi.orders', name: 'Orders', version: '1.0.0', type: 'module', dependencies: ordersDeps } },
            { manifest: { id: 'com.example.multi.core', name: 'Core', version: '2.0.0', type: 'app' } },
        ],
    });

    it('admits a module that declares its app delivered beside it, whatever the range says', async () => {
        const h = await mount(dir);
        const res = await h.install({ manifest: artifact({ 'com.example.multi.core': '^1.0.0' }) });
        expect(res.status, JSON.stringify(res.payload)).not.toBe(422);
        expect(res.payload?.error?.code).not.toBe('DEPENDENCY_MISSING');
    });

    it('does not count the artifact wrapper\'s own id as delivered when it names no package', async () => {
        // `com.example.multi` is the wrapper's id, not a package the artifact
        // carries: a module declaring it would pass here and be `absent` on a
        // later standalone install, so it is judged like any other entry.
        const h = await mount(dir);
        expectDependencyRefusal(
            await h.install({ manifest: artifact({ 'com.example.multi': '^1.0.0' }) }),
            [{ packageId: 'com.example.multi.orders', dependency: 'com.example.multi', range: '^1.0.0', found: 'absent' }],
        );
        expectNothingWritten(h);
    });

    it('still judges an entry naming a package outside the artifact', async () => {
        const h = await mount(dir);
        expectDependencyRefusal(
            await h.install({ manifest: artifact({ 'com.example.multi.core': '^1.0.0', 'com.example.sales': '^6' }) }),
            [{ packageId: 'com.example.multi.orders', dependency: 'com.example.sales', range: '^6', found: 'absent' }],
        );
        expectNothingWritten(h);
    });
});

describe('kernel:ready rehydrate: the check does not run at re-registration', () => {
    it('re-registers a ledger entry whose dependency is absent at boot', async () => {
        new LocalManifestSource(dir).write({
            packageId: PSA.id, versionId: PSA.version, manifestId: PSA.id, version: PSA.version,
            manifest: PSA, installedAt: '2026-01-01T00:00:00.000Z', installedBy: 'admin', withSampleData: false,
        });
        const h = await mount(dir);
        expect(h.bootRegistrations().map((m: any) => m.id)).toContain(PSA.id);
    });
});
