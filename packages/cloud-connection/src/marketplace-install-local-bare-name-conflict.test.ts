// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #31296 — the cloud-fetched branch of `POST /api/v1/marketplace/install-local`
 * refuses a package declaring a bare name another package holds (the #30803
 * series: a flow, a webhook, a dataset, …), the way the inline branch does,
 * before anything is written.
 *
 * ## What was wrong
 *
 * The registry's package door refuses such a package ahead of every one of its
 * writes (`BareNameConflictError`, `bare-name-one-holder.ts` in
 * `@objectstack/objectql`). The inline branch answered that refusal `422`. The
 * cloud-fetched branch recognised only the security catalog's
 * environment-held refusal (#25366) and took #22695's lenient path for this
 * one: it wrote the ledger entry and answered `200` with `hotLoaded: false`,
 * "loads at the next restart". At that restart the entry is rehydrated BEFORE
 * the cold boot seals the holders, so the boot admits the clash with one
 * warning, and every consumer resolving the name is served one of the two
 * packages' items by registration order — the condition the rule refuses.
 *
 * ## What is real here
 *
 * The judge is real: an `ObjectKernel` with `ObjectQLPlugin` supplies the
 * `manifest` service over the real `SchemaRegistry`, booted to
 * `kernel:bootstrapped`, so the holders are sealed and the refusal under test
 * is the one production raises. The holding package is installed through the
 * same door. The side readers that run after the ledger write (binder,
 * translations, seeds) are recorders; they are not what is pinned. The cloud
 * leg is a stubbed `fetch`.
 *
 * ## What these cases pin
 *
 *   - a fresh cloud-fetched install and a cloud-fetched upgrade, each declaring
 *     a flow name another package holds: `422 PLUGIN_REGISTER_FAILED` in the
 *     declared envelope, both holders and the rename named, the registry and
 *     the ledger exactly as before the call, the holder's flow still the
 *     holder's;
 *   - CONTROL, an environment-held security catalog name: the same `422` it
 *     answered before (#25366; its full matrix lives in
 *     `marketplace-install-local-catalog-name-collision.test.ts`);
 *   - CONTROL, the same package declaring a flow name nobody holds: `200`,
 *     `hotLoaded: true`, registered and ledgered.
 *
 * A register failure that is NOT a registry refusal keeps #22695's lenient
 * answer; `marketplace-install-local-hot-loaded.test.ts` pins that.
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
const CLOUD_URL = 'http://cloud.test';

/** The package already holding the flow name, installed first. */
const HOLDER_ID = 'com.acme.dispatch';
/** The package the cloud-fetched install asks for. */
const INCOMING_ID = 'com.acme.routing';
/** The flow name both declare. */
const HELD_FLOW = 'assign_technician';
/** CONTROL: a flow name nobody holds. */
const FREE_FLOW = 'reassign_technician';

const flow = (name: string, tag: string): Bag => ({
    name,
    label: `${tag} flow`,
    type: 'autolaunched',
    status: 'active',
    nodes: [{ id: 'start', type: 'start', label: 'Start' }],
    edges: [],
});

/** A package version whose namespace is its id's last segment, so the refusal's rename is `NAMESPACE_NAME`. */
const packageVersion = (id: string, version: string, flows: string[], extra: Bag = {}): Bag => {
    const ns = id.split('.').pop()!;
    return {
        id,
        name: ns,
        namespace: ns,
        type: 'app',
        version,
        flows: flows.map((name) => flow(name, ns)),
        ...extra,
    };
};

let dir: string;
const kernels: ObjectKernel[] = [];
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mil-bare-name-conflict-')); });
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

/** The plugin over a REAL engine's `manifest` service and registry, booted (holders sealed) to `kernel:ready`. */
async function bootPlugin() {
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

    const plugin = new MarketplaceInstallLocalPlugin({ controlPlaneUrl: CLOUD_URL, storageDir: dir });
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
    /** The cloud-fetched branch: a `packageId` + `versionId` body, the manifest downloaded from the control plane. */
    const installFromCloud = (versionId: string) => install({ packageId: 'pkg_acme_routing', versionId });
    /** The holder, through the same door's inline branch. */
    const installHolder = async () => {
        const res = await install({ manifest: packageVersion(HOLDER_ID, '1.0.0', [HELD_FLOW]) });
        expect(res.status, JSON.stringify(res.payload)).toBe(200);
    };
    return { ql, install, installFromCloud, installHolder };
}

/** Every ledger entry, read off disk. */
const ledger = () => {
    const source = new LocalManifestSource(dir);
    return { holder: source.read(HOLDER_ID).entry, incoming: source.read(INCOMING_ID).entry };
};

/** The holder's flow is still the holder's: the registry serves its item under the bare name. */
function expectHolderFlowKept(ql: ObjectQL) {
    expect(ql.registry.getItem<Bag>('flow', HELD_FLOW)?.label).toBe('dispatch flow');
}

function expectBareNameRefusal(res: any) {
    expect(res.status, JSON.stringify(res.payload)).toBe(422);
    expect(BaseResponseSchema.safeParse(res.payload).success).toBe(true);
    expect(envelopeViolations(res.payload)).toEqual([]);
    expect(ApiErrorSchema.safeParse(res.payload.error).success).toBe(true);
    expect(res.payload.success).toBe(false);
    expect(res.payload.error.code).toBe('PLUGIN_REGISTER_FAILED');
    // The registry's own sentence: both holders, the name, and the rename.
    expect(res.payload.error.message).toContain(`package "${INCOMING_ID}"`);
    expect(res.payload.error.message).toContain(`package "${HOLDER_ID}"`);
    expect(res.payload.error.message).toContain(`"${HELD_FLOW}"`);
    expect(res.payload.error.message).toContain(`"routing_${HELD_FLOW}"`);
}

describe('install-local cloud branch refuses a package declaring a bare name another package holds, before any write', () => {
    const versions = {
        'v1-free': packageVersion(INCOMING_ID, '1.0.0', [FREE_FLOW]),
        'v1-held': packageVersion(INCOMING_ID, '1.0.0', [HELD_FLOW]),
        'v2-held': packageVersion(INCOMING_ID, '2.0.0', [FREE_FLOW, HELD_FLOW]),
    };

    it('a fresh install is refused: 422 naming both holders and the rename, nothing registered or ledgered', async () => {
        serveVersions(versions);
        const { ql, installFromCloud, installHolder } = await bootPlugin();
        await installHolder();
        const before = ledger();

        const res = await installFromCloud('v1-held');

        expectBareNameRefusal(res);
        expect(res.payload.data).toBeUndefined();
        expect(ql.registry.getPackage(INCOMING_ID)).toBeUndefined();
        expect(ledger()).toEqual(before);
        expect(ledger().incoming).toBeNull();
        expectHolderFlowKept(ql);
    });

    it('an upgrade is refused: 422, the installed version still registered and ledgered', async () => {
        serveVersions(versions);
        const { ql, installFromCloud, installHolder } = await bootPlugin();
        await installHolder();
        const first = await installFromCloud('v1-free');
        expect(first.status, JSON.stringify(first.payload)).toBe(200);
        expect(first.payload.data.hotLoaded).toBe(true);
        const before = ledger();

        const res = await installFromCloud('v2-held');

        expectBareNameRefusal(res);
        expect(ql.registry.getPackage(INCOMING_ID)?.manifest?.version).toBe('1.0.0');
        expect(ledger()).toEqual(before);
        expect(ledger().incoming?.version).toBe('1.0.0');
        expectHolderFlowKept(ql);
    });

    it('CONTROL — an environment-held security catalog name keeps its answer: 422 naming the environment catalog', async () => {
        serveVersions({
            'v1-cloned': packageVersion(INCOMING_ID, '1.0.0', [], {
                permissions: [{ name: 'acme_dispatcher_lite', label: 'acme_dispatcher_lite', objects: {} }],
            }),
        });
        const { ql, installFromCloud } = await bootPlugin();
        // The environment's item, as `sys_metadata` hydration registers it: the bare slot, no package.
        ql.registry.registerItem('permission', { name: 'acme_dispatcher_lite', label: 'customer clone', objects: {} });

        const res = await installFromCloud('v1-cloned');

        expect(res.status, JSON.stringify(res.payload)).toBe(422);
        expect(res.payload.error.code).toBe('PLUGIN_REGISTER_FAILED');
        expect(res.payload.error.message).toContain('the environment catalog');
        expect(ql.registry.getPackage(INCOMING_ID)).toBeUndefined();
        expect(ledger().incoming).toBeNull();
    });

    it('CONTROL — the same package declaring a flow name nobody holds installs: 200, hot-loaded, ledgered', async () => {
        serveVersions(versions);
        const { ql, installFromCloud, installHolder } = await bootPlugin();
        await installHolder();

        const res = await installFromCloud('v1-free');

        expect(res.status, JSON.stringify(res.payload)).toBe(200);
        expect(res.payload.data.hotLoaded).toBe(true);
        expect(res.payload.data.hotLoadError).toBeUndefined();
        expect(ql.registry.getPackage(INCOMING_ID)?.manifest?.version).toBe('1.0.0');
        expect(ledger().incoming?.version).toBe('1.0.0');
        expect(ql.registry.getItem<Bag>('flow', FREE_FLOW)?.label).toBe('routing flow');
        expectHolderFlowKept(ql);
    });
});
