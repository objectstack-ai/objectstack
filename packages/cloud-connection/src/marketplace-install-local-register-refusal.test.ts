// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #31478 — the cloud-fetched branch of `POST /api/v1/marketplace/install-local`
 * refuses every register failure the engine declares a refusal, the way the
 * inline branch does, before anything is written; only a fault stays lenient.
 *
 * ## What was wrong
 *
 * The cloud-fetched branch refused three of the registry's refusals (the held
 * names: #25366, #31296, #31392) and took #22695's lenient path for every other
 * register failure: it wrote the ledger entry and answered `200` with
 * `hotLoaded: false`, "loads at the next restart". Measured on `main` for the
 * classes below: each answered `200` and was ledgered, and at the next boot the
 * rehydrate logged the same refusal and loaded nothing. The inline branch
 * answered each `422`.
 *
 * ## What is real here
 *
 * The judge is real: an `ObjectKernel` with `ObjectQLPlugin` supplies the
 * `manifest` service over the real `SchemaRegistry`, booted to `kernel:ready`
 * (the holders and the vocabulary sealed), and the plugin's own `kernel:ready`
 * hook rehydrates the ledger after it, in that order, as on a real boot — so a
 * second boot over the same ledger directory is a restart. The holder is
 * installed through the same door. The side readers that run after the ledger
 * write (binder, translations, seeds) are recorders. The cloud leg is a stubbed
 * `fetch`.
 *
 * ## What these cases pin
 *
 *   - a fresh cloud-fetched install refused by each of: a default record page
 *     another package holds, a misplaced default page, an object another
 *     package owns, an object name two packages of one artifact define, an
 *     object the package it depends on owns, a picklist nobody declares, a
 *     bound action whose object nobody registers: `422 PLUGIN_REGISTER_FAILED`
 *     in the declared envelope with the engine's sentence, nothing registered,
 *     the ledger exactly as before the call;
 *   - an upgrade refused by a registry refusal and by a sealed-vocabulary one:
 *     the same `422`, the installed version still registered and ledgered;
 *   - the remedy a sealed-vocabulary refusal names: once the package that
 *     brings the object is installed, the same install succeeds at once, with
 *     no restart;
 *   - CONTROL, a register failure that declares no status (the runtime's own
 *     fault): the lenient answer it had — `200`, `hotLoaded: false`, ledgered —
 *     and the restart heals it: the next boot loads the package.
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

/** The package holding the object, its default record page and its namespace, installed first. */
const HOLDER_ID = 'com.acme.dispatch';
/** The package the cloud-fetched install asks for. */
const INCOMING_ID = 'com.acme.routing';
/** The register failure the CONTROL's engine throws: an `Error` declaring no status. */
const REGISTER_FAULT = 'driver connection reset while registering';

const obj = (name: string, fields: Bag = { title: { name: 'title', type: 'text', label: 'Title' } }) => ({ name, label: name, fields });
const recordPage = (name: string, object: string) => ({ name, label: name, type: 'record', object, isDefault: true, regions: [] });
/** A top-level action bound by `objectName` to `objectName`. */
const boundAction = (objectName: string) => ({
    name: 'routing_ping', label: 'Ping', objectName, type: 'url', target: 'https://example.com/ping', locations: ['record_header'],
});

/** A package version whose namespace is its id's last segment. */
const packageVersion = (id: string, version: string, extra: Bag = {}): Bag => {
    const ns = id.split('.').pop()!;
    return { id, name: ns, namespace: ns, type: 'app', version, ...extra };
};
const holderVersion = () => packageVersion(HOLDER_ID, '1.0.0', {
    objects: [obj('dispatch_job')],
    pages: [recordPage('dispatch_job_detail', 'dispatch_job')],
});
/** The incoming package, carrying an object of its own beside whatever a case adds. */
const incoming = (version: string, extra: Bag = {}) =>
    packageVersion(INCOMING_ID, version, { ...extra, objects: [obj('routing_stop'), ...(extra.objects ?? [])] });

/** A release artifact of two packages sharing namespace `crm`, both defining `crm_account`. */
const collidingArtifact = () => ({
    id: 'com.acme.crm-suite',
    version: '1.0.0',
    packages: [
        { manifest: { id: 'com.acme.crm', name: 'acme_crm', version: '1.0.0', type: 'app', namespace: 'crm', objects: [obj('crm_account')] } },
        { manifest: { id: 'com.acme.crm.billing', name: 'acme_crm_billing', version: '1.0.0', type: 'module', namespace: 'crm', objects: [obj('crm_account')] } },
    ],
});

const VERSIONS: Record<string, Bag> = {
    'v1-free': incoming('1.0.0'),
    'v1-default-page': incoming('1.0.0', { pages: [recordPage('routing_job_detail', 'dispatch_job')] }),
    'v2-default-page': incoming('2.0.0', { pages: [recordPage('routing_job_detail', 'dispatch_job')] }),
    'v1-misplaced-default': incoming('1.0.0', { pages: [{ name: 'routing_home', label: 'Home', type: 'home', isDefault: true, regions: [] }] }),
    'v1-owned-object': incoming('1.0.0', { objects: [obj('dispatch_job')] }),
    'v1-artifact-object': collidingArtifact(),
    'v1-dependency-object': incoming('1.0.0', { namespace: 'dispatch', dependencies: { [HOLDER_ID]: '^1.0.0' }, objects: [obj('dispatch_job')] }),
    'v1-picklist': incoming('1.0.0', {
        objects: [obj('routing_visit', { status: { name: 'status', label: 'Status', type: 'select', picklist: 'routing_visit_status' } })],
    }),
    'v1-unbound': incoming('1.0.0', { actions: [boundAction('routing_nowhere')] }),
    'v2-unbound': incoming('2.0.0', { actions: [boundAction('routing_nowhere')] }),
    'v1-binds-holder': incoming('1.0.0', { actions: [boundAction('dispatch_job')] }),
};

/**
 * The engine's `manifest` service, whose `register` throws {@link REGISTER_FAULT}
 * — a plain `Error`, no status — for the one package id named.
 */
function faultingFor(manifest: any, packageId: string) {
    return new Proxy(manifest, {
        get(target, key, receiver) {
            if (key !== 'register') return Reflect.get(target, key, receiver);
            return async (artifact: any, options?: unknown) => {
                if (artifact?.id === packageId) throw new Error(REGISTER_FAULT);
                return target.register(artifact, options);
            };
        },
    });
}

let dir: string;
const kernels: ObjectKernel[] = [];
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mil-register-refusal-')); });
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

/**
 * The plugin over a REAL engine's `manifest` service and registry, booted (the
 * holders and the vocabulary sealed) to `kernel:ready`, whose hook then
 * rehydrates the ledger in `dir`: a second call over the same `dir` IS a
 * restart. `failRegisterOf` makes the engine's register throw an undeclared
 * fault for that one package id.
 */
async function bootPlugin(failRegisterOf?: string) {
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
        manifest: failRegisterOf === undefined ? kernel.getService('manifest') : faultingFor(kernel.getService('manifest'), failRegisterOf),
        auth: installerAuthService(),
        objectql: withInstallerGrants({
            convertPackageBodyForward: (body: unknown) => ql.convertPackageBodyForward(body),
            registry: ql.registry,
            // [#31392] The engine's registered code packages, read live, so a
            // package this door installed reads as code and not as a writable
            // base (`isWritablePackage`), as on the real `objectql` service.
            get manifests() { return (ql as unknown as { manifests: Map<string, unknown> }).manifests; },
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
        const res = await install({ manifest: holderVersion() });
        expect(res.status, JSON.stringify(res.payload)).toBe(200);
    };
    return { ql, install, installFromCloud, installHolder };
}


/** Every ledger entry, read off disk, as `id@version`. */
const ledger = () => new LocalManifestSource(dir).list().entries.map((e) => `${e.manifestId}@${e.version}`).sort();

function expectRefusal(res: any, manifestId: string, says: string) {
    expect(res.status, JSON.stringify(res.payload)).toBe(422);
    expect(BaseResponseSchema.safeParse(res.payload).success).toBe(true);
    expect(envelopeViolations(res.payload)).toEqual([]);
    expect(ApiErrorSchema.safeParse(res.payload.error).success).toBe(true);
    expect(res.payload.success).toBe(false);
    expect(res.payload.data).toBeUndefined();
    expect(res.payload.error.code).toBe('PLUGIN_REGISTER_FAILED');
    // The engine's own sentence, after the door's.
    expect(res.payload.error.message).toContain(`Package '${manifestId}' cannot be installed: `);
    expect(res.payload.error.message).toContain(says);
}

/** Each refusal: the version the cloud serves, the package it registers as, and a fragment of the engine's sentence. */
const CASES = [
    {
        title: 'a default record page another package holds',
        versionId: 'v1-default-page', manifestId: INCOMING_ID, registered: [INCOMING_ID],
        says: `Default record page conflict: page "routing_job_detail" of package "${INCOMING_ID}"`,
    },
    {
        title: 'a default page that is not a record page',
        versionId: 'v1-misplaced-default', manifestId: INCOMING_ID, registered: [INCOMING_ID],
        says: 'Page "routing_home" of package "com.acme.routing": `isDefault: true` is refused',
    },
    {
        title: 'an object another package owns',
        versionId: 'v1-owned-object', manifestId: INCOMING_ID, registered: [INCOMING_ID],
        says: `Object "dispatch_job" is already owned by package "${HOLDER_ID}"`,
    },
    {
        title: 'an object name two packages of one artifact define',
        // Only the refused member: the manifest service registers an artifact's
        // packages one by one, so `com.acme.crm`, registered before
        // `com.acme.crm.billing` was refused, stays in the RUNNING kernel —
        // unledgered, so gone at the restart. Measured the same on the inline
        // branch; not this door's to withdraw, and not pinned here.
        versionId: 'v1-artifact-object', manifestId: 'com.acme.crm-suite', registered: ['com.acme.crm.billing'],
        says: 'Object name conflict inside one release artifact: object "crm_account"',
    },
    {
        title: 'an object the package it depends on owns',
        versionId: 'v1-dependency-object', manifestId: INCOMING_ID, registered: [INCOMING_ID],
        says: 'Object name conflict between packages that share a namespace through a declared dependency',
    },
    {
        title: 'a picklist no loaded package declares',
        versionId: 'v1-picklist', manifestId: INCOMING_ID, registered: [INCOMING_ID],
        says: "field 'routing_visit.status' (package 'com.acme.routing') references picklist 'routing_visit_status'",
    },
    {
        title: 'a bound action whose object no loaded package registers',
        versionId: 'v1-unbound', manifestId: INCOMING_ID, registered: [INCOMING_ID],
        says: "action 'routing_ping' (package 'com.acme.routing') is bound to object 'routing_nowhere'",
    },
] as const;

describe('install-local cloud branch refuses a register the engine refuses, before any write (#31478)', () => {
    for (const c of CASES) {
        it(`a fresh install of ${c.title} is refused: 422 with the engine's sentence, nothing registered or ledgered`, async () => {
            serveVersions(VERSIONS);
            const { ql, installFromCloud, installHolder } = await bootPlugin();
            await installHolder();
            const before = ledger();

            const res = await installFromCloud(c.versionId);

            expectRefusal(res, c.manifestId, c.says);
            for (const id of c.registered) expect(ql.registry.getPackage(id), id).toBeUndefined();
            expect(ledger()).toEqual(before);
            expect(ql.registry.getObjectOwner('dispatch_job')?.packageId).toBe(HOLDER_ID);
        });
    }

    for (const [title, versionId, says] of [
        ['a default record page another package holds', 'v2-default-page', 'Default record page conflict'],
        ['a bound action whose object no loaded package registers', 'v2-unbound', "is bound to object 'routing_nowhere'"],
    ] as const) {
        it(`an upgrade to ${title} is refused: 422, the installed version still registered and ledgered`, async () => {
            serveVersions(VERSIONS);
            const { ql, installFromCloud, installHolder } = await bootPlugin();
            await installHolder();
            const first = await installFromCloud('v1-free');
            expect(first.status, JSON.stringify(first.payload)).toBe(200);
            expect(first.payload.data.hotLoaded).toBe(true);
            const before = ledger();

            const res = await installFromCloud(versionId);

            expectRefusal(res, INCOMING_ID, says);
            expect(ql.registry.getPackage(INCOMING_ID)?.manifest?.version).toBe('1.0.0');
            expect(ledger()).toEqual(before);
            expect(ledger()).toContain(`${INCOMING_ID}@1.0.0`);
        });
    }

    it('the remedy a bound action\'s refusal names: once the object\'s package is installed, the same install succeeds at once', async () => {
        serveVersions(VERSIONS);
        const { ql, installFromCloud, installHolder } = await bootPlugin();

        const refused = await installFromCloud('v1-binds-holder');
        expectRefusal(refused, INCOMING_ID, "is bound to object 'dispatch_job'");
        expect(ledger()).toEqual([]);

        await installHolder();
        const res = await installFromCloud('v1-binds-holder');

        expect(res.status, JSON.stringify(res.payload)).toBe(200);
        expect(res.payload.data.hotLoaded).toBe(true);
        expect(ql.registry.getPackage(INCOMING_ID)?.manifest?.version).toBe('1.0.0');
        expect(ledger()).toEqual([`${HOLDER_ID}@1.0.0`, `${INCOMING_ID}@1.0.0`]);
    });

    it('CONTROL — a register fault declaring no status keeps the lenient answer, and the restart heals it', async () => {
        serveVersions(VERSIONS);
        const { ql, installFromCloud } = await bootPlugin(INCOMING_ID);

        const res = await installFromCloud('v1-free');

        expect(res.status, JSON.stringify(res.payload)).toBe(200);
        expect(res.payload.data.hotLoaded).toBe(false);
        expect(res.payload.data.hotLoadError).toBe(REGISTER_FAULT);
        expect(ql.registry.getPackage(INCOMING_ID)).toBeUndefined();
        expect(ledger()).toEqual([`${INCOMING_ID}@1.0.0`]);

        // The restart: a fresh kernel over the same ledger, whose register works.
        const restarted = await bootPlugin();
        expect(restarted.ql.registry.getPackage(INCOMING_ID)?.manifest?.version).toBe('1.0.0');
        expect(restarted.ql.registry.getObjectOwner('routing_stop')?.packageId).toBe(INCOMING_ID);
    });
});
