// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #25366 — `POST /api/v1/marketplace/install-local` refuses a package that
 * ships a position, permission set or capability name an ENVIRONMENT-authored
 * item already holds, on both branches, before anything is written.
 *
 * ## What was wrong
 *
 * The registry's package door (`SchemaRegistry.installPackage`) refuses such a
 * package ahead of every one of its writes (`SecurityCatalogNameConflictError`,
 * ADR-0048 §3.4 narrowed; ruling Q4 = A on #15196). The inline branch answered
 * that refusal `422`. The cloud-fetched branch took its lenient path instead:
 * it wrote the ledger entry and answered `200` with `hotLoaded: false`, "loads
 * at the next restart". It never does. The environment's item is loaded from
 * `sys_metadata` at every boot, so every later load of that entry is refused
 * the same way. The reach is ordinary: a customer clones a vendor permission
 * set or position under a name, and a later version of the vendor's package
 * ships that name.
 *
 * ## What is real here
 *
 * The judge is real: an `ObjectKernel` with `ObjectQLPlugin` supplies the
 * `manifest` service over the real `SchemaRegistry`, so the refusal under test
 * is the one production raises, and "nothing registered" is read off that
 * registry. The environment's item is registered the way `sys_metadata`
 * hydration registers it: into the bare slot, with no package. The side
 * readers that run after the ledger write (binder, translations, seeds) are
 * recorders; they are not what is pinned. The cloud leg is a stubbed `fetch`.
 *
 * ## What these cases pin
 *
 *   - each catalog type × each branch × a fresh install and an upgrade over an
 *     installed version: `422 PLUGIN_REGISTER_FAILED` in the declared envelope,
 *     the colliding name and its environment holder named, the registry and
 *     the ledger exactly as before the call, and the environment's item still
 *     the environment's;
 *   - CONTROL, the same flows shipping a name nobody holds: `200`,
 *     `hotLoaded: true`, the new version registered and ledgered.
 *
 * A capability is code-only (`allowRuntimeCreate: false`), so no environment
 * save produces one; its case pins that the door judges the refusal, not the
 * type.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BaseResponseSchema, ApiErrorSchema, envelopeViolations } from '@objectstack/spec/api';
// The plugin reaches `@objectstack/runtime` through a lazy `import()`; its first
// load is paid here, at module top, never inside a clocked `it`.
import '@objectstack/runtime';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQLPlugin, type ObjectQL } from '@objectstack/objectql';
import { MarketplaceInstallLocalPlugin } from './marketplace-install-local-plugin.js';
import { LocalManifestSource } from './local-manifest-source.js';
import { installerAuthService, withInstallerGrants } from './install-local-principal.fixtures.js';

type Bag = Record<string, any>;
type Handler = (c: any) => Promise<any>;

const ROUTE = '/api/v1/marketplace/install-local';
const APP_ID = 'com.acme.field-service';
const CLOUD_URL = 'http://cloud.test';

/** One catalog type: its registry type, its manifest collection, and the names a case uses. */
interface CatalogCase {
    readonly type: 'permission' | 'position' | 'capability';
    readonly collection: 'permissions' | 'positions' | 'capabilities';
    /** What version 1 ships. */
    readonly shipped: string;
    /** The environment's item — a customer's clone — and the name version 2 also ships. */
    readonly cloned: string;
    /** CONTROL: a name version 2 adds that nobody holds. */
    readonly free: string;
}

const CASES: readonly CatalogCase[] = [
    { type: 'permission', collection: 'permissions', shipped: 'acme_dispatcher', cloned: 'acme_dispatcher_lite', free: 'acme_auditor' },
    { type: 'position', collection: 'positions', shipped: 'acme_technician', cloned: 'acme_lead_technician', free: 'acme_planner' },
    { type: 'capability', collection: 'capabilities', shipped: 'acme_export_jobs', cloned: 'acme_close_jobs', free: 'acme_reopen_jobs' },
];

const item = (k: CatalogCase, name: string): Bag =>
    k.type === 'permission' ? { name, label: name, objects: {} } : { name, label: name };

/** A package version shipping `names` in `k`'s collection. */
const packageVersion = (k: CatalogCase, version: string, names: string[]): Bag => ({
    id: APP_ID,
    name: 'acme_field_service',
    type: 'app',
    version,
    [k.collection]: names.map((name) => item(k, name)),
});

let dir: string;
const kernels: ObjectKernel[] = [];
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mil-catalog-collision-')); });
afterEach(async () => {
    while (kernels.length) {
        const k = kernels.pop()!;
        if (k.getState() === 'running') await k.shutdown();
    }
    rmSync(dir, { recursive: true, force: true });
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
});

/**
 * Serve package versions from the cloud leg, by the `versionId` the install
 * asks for; the public fast-path is off and a service key is set, so the
 * credential read never reaches the developer's own on-disk binding.
 */
function serveVersions(versions: Record<string, Bag>) {
    vi.stubEnv('OS_MARKETPLACE_PUBLIC_BASE_URL', 'off');
    vi.stubEnv('OS_CLOUD_API_KEY', 'svc-test-key');
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
        const versionId = decodeURIComponent(String(url).split('/versions/')[1]?.split('/')[0] ?? '');
        const manifest = versions[versionId];
        if (!manifest) return new Response('not found', { status: 404 });
        return new Response(
            JSON.stringify({ data: { manifest, version: manifest.version, version_id: versionId } }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
    }));
}

/** The plugin over a REAL engine's `manifest` service and registry, booted to `kernel:ready`. */
async function bootPlugin(controlPlaneUrl: string) {
    const kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false } as never);
    kernels.push(kernel);
    await kernel.use(new ObjectQLPlugin());
    await kernel.bootstrap();
    const ql = kernel.getService<ObjectQL>('objectql');
    ql.registry.logLevel = 'silent';

    const routes = new Map<string, Handler>();
    const rawApp = {
        get: (p: string, h: Handler) => routes.set(`GET ${p}`, h),
        post: (p: string, h: Handler) => routes.set(`POST ${p}`, h),
        delete: (p: string, h: Handler) => routes.set(`DELETE ${p}`, h),
    };
    const hooks = new Map<string, () => Promise<void>>();
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const services: Record<string, unknown> = {
        manifest: kernel.getService('manifest'),
        auth: installerAuthService(),
        objectql: withInstallerGrants({
            convertPackageBodyForward: (body: unknown) => ql.convertPackageBodyForward(body),
            registry: ql.registry,
            syncSchemas: async () => undefined,
        }),
    };
    const ctx = {
        hook: (e: string, h: () => Promise<void>) => hooks.set(e, h),
        getService: (name: string) => {
            if (name === 'http-server') return { getRawApp: () => rawApp };
            if (!(name in services)) throw new Error(`no ${name}`);
            return services[name];
        },
        logger,
    };

    const plugin = new MarketplaceInstallLocalPlugin({ controlPlaneUrl, storageDir: dir });
    const p = plugin as unknown as Record<string, unknown>;
    p.bindArtifactHandlers = async () => undefined;
    p.applySideEffects = async () => ({ translationsLoaded: 0, seeded: { mode: 'none' } });

    await plugin.start(ctx as never);
    await hooks.get('kernel:ready')?.();

    const install = async (body: Bag) => {
        const json = vi.fn((payload: any, status?: number) => ({ payload, status: status ?? 200 }));
        return routes.get(`POST ${ROUTE}`)!({
            req: {
                url: `http://localhost:3000${ROUTE}`,
                raw: new Request(`http://localhost:3000${ROUTE}`),
                json: async () => body,
                param: () => undefined,
            },
            json,
        });
    };
    return { ql, install };
}

/** The two branches, each asked for one version by the shape that branch's body takes. */
const BRANCHES = [
    {
        branch: 'inline',
        controlPlaneUrl: 'off',
        serve: (_versions: Record<string, Bag>) => undefined,
        body: (versions: Record<string, Bag>, versionId: string) => ({ manifest: versions[versionId] }),
    },
    {
        branch: 'cloud-fetched',
        controlPlaneUrl: CLOUD_URL,
        serve: (versions: Record<string, Bag>) => serveVersions(versions),
        body: (_versions: Record<string, Bag>, versionId: string) => ({ packageId: 'pkg_acme_field_service', versionId }),
    },
] as const;

/** The environment's item under `name`, as `sys_metadata` hydration registers it: the bare slot, no package. */
function authorEnvironmentItem(ql: ObjectQL, k: CatalogCase, name: string) {
    ql.registry.registerItem(k.type, { ...item(k, name), label: `${name} (customer clone)` });
}

function expectRefusal(res: any, k: CatalogCase) {
    expect(res.status, JSON.stringify(res.payload)).toBe(422);
    expect(BaseResponseSchema.safeParse(res.payload).success).toBe(true);
    expect(envelopeViolations(res.payload)).toEqual([]);
    expect(ApiErrorSchema.safeParse(res.payload.error).success).toBe(true);
    expect(res.payload.success).toBe(false);
    expect(res.payload.error.code).toBe('PLUGIN_REGISTER_FAILED');
    // The registry's own sentence: the colliding name, and the environment as its holder.
    expect(res.payload.error.message).toContain(`"${k.cloned}"`);
    expect(res.payload.error.message).toContain('the environment catalog');
}

/** The environment's item is untouched: still in the bare slot, bound to no package. */
function expectEnvironmentItemKept(ql: ObjectQL, k: CatalogCase) {
    const kept = ql.registry.getItem<Bag>(k.type, k.cloned);
    expect(kept?.label).toBe(`${k.cloned} (customer clone)`);
    expect(kept?._packageId).toBeUndefined();
}

describe('install-local refuses a package whose catalog name an environment-authored item holds, before any write', () => {
    for (const b of BRANCHES) {
        for (const k of CASES) {
            describe(`${b.branch} branch · ${k.type}`, () => {
                const versions = {
                    'v1': packageVersion(k, '1.0.0', [k.shipped]),
                    'v2-collides': packageVersion(k, '2.0.0', [k.shipped, k.cloned]),
                    'v2-free': packageVersion(k, '2.0.0', [k.shipped, k.free]),
                };

                it('a fresh install is refused: 422, nothing registered, no ledger entry', async () => {
                    b.serve(versions);
                    const { ql, install } = await bootPlugin(b.controlPlaneUrl);
                    authorEnvironmentItem(ql, k, k.cloned);

                    const res = await install(b.body(versions, 'v2-collides'));

                    expectRefusal(res, k);
                    expect(ql.registry.getPackage(APP_ID)).toBeUndefined();
                    expect(new LocalManifestSource(dir).read(APP_ID).entry).toBeNull();
                    expectEnvironmentItemKept(ql, k);
                });

                it('an upgrade is refused: 422, the installed version still registered and ledgered', async () => {
                    b.serve(versions);
                    const { ql, install } = await bootPlugin(b.controlPlaneUrl);
                    const first = await install(b.body(versions, 'v1'));
                    expect(first.status, JSON.stringify(first.payload)).toBe(200);
                    // The customer clones under a name version 1 does not ship.
                    authorEnvironmentItem(ql, k, k.cloned);

                    const res = await install(b.body(versions, 'v2-collides'));

                    expectRefusal(res, k);
                    expect(ql.registry.getPackage(APP_ID)?.manifest?.version).toBe('1.0.0');
                    expect(new LocalManifestSource(dir).read(APP_ID).entry?.version).toBe('1.0.0');
                    expectEnvironmentItemKept(ql, k);
                });

                it('CONTROL — an upgrade shipping a name nobody holds installs unchanged: 200, hot-loaded, ledgered', async () => {
                    b.serve(versions);
                    const { ql, install } = await bootPlugin(b.controlPlaneUrl);
                    expect((await install(b.body(versions, 'v1'))).status).toBe(200);
                    authorEnvironmentItem(ql, k, k.cloned);

                    const res = await install(b.body(versions, 'v2-free'));

                    expect(res.status, JSON.stringify(res.payload)).toBe(200);
                    expect(res.payload.data.hotLoaded).toBe(true);
                    expect(res.payload.data.upgradedFrom).toBe('previous-marketplace-version');
                    expect(ql.registry.getPackage(APP_ID)?.manifest?.version).toBe('2.0.0');
                    expect(new LocalManifestSource(dir).read(APP_ID).entry?.version).toBe('2.0.0');
                    expectEnvironmentItemKept(ql, k);
                });
            });
        }
    }
});
