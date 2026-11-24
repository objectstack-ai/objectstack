// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `POST /api/v1/marketplace/install-local` parses the `namespace` of every
 * package it installs through its declaration — `ManifestSchema.shape.namespace`
 * (`NAMESPACE_PATTERN`), by reference — the way it already parses the id.
 *
 * ## What was wrong
 *
 * The door parsed `manifest.id` and `installModes` through the declaration but
 * never `namespace`, so an inline manifest declaring `''`, `'QA_N'` or
 * `'9-Bad Ns!'` installed with a 200 and was registered and ledgered under it.
 * `QA_N` installed beside an existing owner of `qa_n`: the registry's
 * install-time namespace gate (ADR-0048 §2, unique per installation) compares
 * namespaces as written and never read the two as one.
 *
 * ## What these cases pin
 *
 *   - each refused value answers `400 PLUGIN_MANIFEST_INVALID` in the declared
 *     envelope, carrying the declaration's own sentence (read from the schema
 *     here, never copied), and nothing is registered, synced or ledgered — on
 *     a flat manifest and a compiled bundle's nested manifest, judged on the
 *     body registration reads (its top-level `namespace`); a cloud snapshot
 *     answers the same code at `502`; a multi-package artifact's MEMBER keeps
 *     the refusal the artifact-entry parse already gave it;
 *   - a conforming namespace and an ABSENT one still install (the declaration
 *     makes the key optional);
 *   - over a real engine: `QA_N` beside an owner of `qa_n` is the 400 above and
 *     the registry does not hold it, while `qa_n` beside that owner still meets
 *     the registry's own namespace gate — the gate's comparison needed no change.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ManifestSchema } from '@objectstack/spec/kernel';
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

/** The three values the card's probe installed. */
const REFUSED: ReadonlyArray<readonly [string, string]> = [
    ['the empty string', ''],
    ['upper case (a case variant of an owned namespace)', 'QA_N'],
    ['a digit-initial value with a hyphen, spaces and punctuation', '9-Bad Ns!'],
];

/**
 * A compiled body whose own manifest still carries a nested `manifest` object
 * after the door's one-level normalization: registration reads the outer
 * body's top-level `namespace`, so that is the key the gate must judge.
 */
const stillNested = (id: string, namespace: string): Bag => ({
    manifest: { id, name: 'p', version: '1.0.0', type: 'app', namespace, manifest: { namespace: 'qa_ok' } },
});

/** The declaration's own sentence for a value, read from the schema — never a copy of it. */
function declaredSentence(value: unknown): string {
    const parsed = ManifestSchema.shape.namespace.safeParse(value);
    expect(parsed.success).toBe(false);
    return parsed.success ? '' : parsed.error.issues[0]!.message;
}

function makeRawApp() {
    const routes = new Map<string, Handler>();
    return {
        routes,
        get: (p: string, h: Handler) => routes.set(`GET ${p}`, h),
        post: (p: string, h: Handler) => routes.set(`POST ${p}`, h),
        delete: (p: string, h: Handler) => routes.set(`DELETE ${p}`, h),
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

/** The plugin through its real lifecycle, every writer the install path reaches recorded. */
async function mount(dir: string, opts: { controlPlaneUrl?: string } = {}) {
    const rawApp = makeRawApp();
    const hooks = new Map<string, any>();
    const registry: any[] = [];
    const register = vi.fn((m: any) => { registry.push({ manifest: m }); });
    const syncSchemas = vi.fn(async () => undefined);
    const services: Record<string, any> = {
        manifest: { register },
        auth: installerAuthService(),
        objectql: withInstallerGrants({ syncSchemas, registry: { getAllPackages: () => registry } }),
    };
    const ctx = {
        hook: (e: string, h: any) => hooks.set(e, h),
        getService: (name: string) => {
            if (name === 'http-server') return { getRawApp: () => rawApp };
            const svc = services[name];
            if (svc === undefined) throw new Error(`no ${name}`);
            return svc;
        },
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    };
    const plugin = new MarketplaceInstallLocalPlugin({ controlPlaneUrl: opts.controlPlaneUrl ?? 'off', storageDir: dir });
    await plugin.start(ctx as any);
    await hooks.get('kernel:ready')?.();
    const registeredAtBoot = register.mock.calls.length;
    const syncedAtBoot = syncSchemas.mock.calls.length;
    return {
        install: (body: Bag) => rawApp.routes.get(`POST ${ROUTE}`)!(makeC(body)),
        installRegistrations: () => register.mock.calls.slice(registeredAtBoot).map((call) => call[0]),
        installSyncs: () => syncSchemas.mock.calls.length - syncedAtBoot,
    };
}

function expectDeclaredRefusal(res: { payload: any; status: number }, status: number) {
    expect(res.status, JSON.stringify(res.payload)).toBe(status);
    expect(BaseResponseSchema.safeParse(res.payload).success).toBe(true);
    expect(envelopeViolations(res.payload)).toEqual([]);
    expect(ApiErrorSchema.safeParse(res.payload.error).success).toBe(true);
    expect(res.payload.success).toBe(false);
    expect(res.payload.error.code).toBe('PLUGIN_MANIFEST_INVALID');
}

let dir: string;
const kernels: ObjectKernel[] = [];
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mil-namespace-gate-')); });
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

function expectNothingWritten(h: { installRegistrations: () => unknown[]; installSyncs: () => number }) {
    expect(h.installRegistrations()).toEqual([]);
    expect(h.installSyncs()).toBe(0);
    expect(readdirSync(dir)).toEqual([]);
}

describe('install-local parses the inline manifest\'s `namespace` through its declaration', () => {
    for (const [why, namespace] of REFUSED) {
        it(`refuses ${why} (${JSON.stringify(namespace)}) — 400, the declaration's sentence, nothing written`, async () => {
            const h = await mount(dir);
            const res = await h.install({
                manifest: { id: 'com.qa.p-up', name: 'p', version: '1.0.0', type: 'app', namespace, objects: [] },
            });
            expectDeclaredRefusal(res, 400);
            expect(res.payload.error.message).toContain('`namespace`');
            expect(res.payload.error.message).toContain(declaredSentence(namespace));
            expectNothingWritten(h);
        });
    }

    it('refuses a non-string namespace rather than registering it', async () => {
        const h = await mount(dir);
        const res = await h.install({ manifest: { id: 'com.qa.p-num', version: '1.0.0', namespace: 7, objects: [] } });
        expectDeclaredRefusal(res, 400);
        expect(res.payload.error.message).toContain(declaredSentence(7));
        expectNothingWritten(h);
    });

    it('refuses a COMPILED bundle whose nested `manifest.namespace` is refused', async () => {
        const h = await mount(dir);
        const res = await h.install({
            manifest: { manifest: { id: 'com.qa.p-up', namespace: 'QA_N', version: '1.0.0', type: 'app' }, objects: [] },
        });
        expectDeclaredRefusal(res, 400);
        expect(res.payload.error.message).toContain(declaredSentence('QA_N'));
        expectNothingWritten(h);
    });

    it('UNMOVED — an artifact MEMBER\'s refused namespace keeps the artifact-entry parse\'s refusal, nothing written', async () => {
        // Each `packages[]` entry is parsed whole through `ArtifactPackageSchema`
        // before any write; this door adds no second judge of it. [#34574] The
        // refusal is ANSWERED with its own 422 and code (step 1c reads the
        // packages first over this real runtime), where it used to leave the
        // door as a throw the transport answered `500`.
        const h = await mount(dir);
        const res = await h.install({
            manifest: {
                id: 'com.qa.suite',
                version: '1.0.0',
                packages: [
                    { manifest: { id: 'com.qa.one', name: 'qa_one', version: '1.0.0', type: 'app', namespace: 'qa_one', objects: [] } },
                    { manifest: { id: 'com.qa.two', name: 'qa_two', version: '1.0.0', type: 'module', namespace: 'QA_N', objects: [] } },
                ],
            },
        });
        expect(res.status, JSON.stringify(res.payload)).toBe(422);
        expect(envelopeViolations(res.payload)).toEqual([]);
        expect(res.payload.success).toBe(false);
        expect(res.payload.error.code).toBe('INVALID_ARTIFACT_PACKAGE_ENTRY');
        expect(res.payload.error.message).toContain(declaredSentence('QA_N'));
        expectNothingWritten(h);
    });

    it('lit control — the same artifact with conforming member namespaces installs', async () => {
        const h = await mount(dir);
        const res = await h.install({
            manifest: {
                id: 'com.qa.suite',
                version: '1.0.0',
                packages: [
                    { manifest: { id: 'com.qa.one', name: 'qa_one', version: '1.0.0', type: 'app', namespace: 'qa_one', objects: [] } },
                    { manifest: { id: 'com.qa.two', name: 'qa_two', version: '1.0.0', type: 'module', namespace: 'qa_two', objects: [] } },
                ],
            },
        });
        expect(res.status, JSON.stringify(res.payload)).toBe(200);
        expect(readdirSync(dir)).toEqual(['com.qa.suite.json']);
    });

    it('judges the namespace on the body registration reads, not a nested `manifest` it still carries', async () => {
        const h = await mount(dir);
        const res = await h.install({ manifest: stillNested('com.qa.p-up', 'QA_N') });
        expectDeclaredRefusal(res, 400);
        expect(res.payload.error.message).toContain(declaredSentence('QA_N'));
        expectNothingWritten(h);
    });

    it('lit control — a conforming namespace still installs', async () => {
        const h = await mount(dir);
        const res = await h.install({ manifest: { id: 'com.qa.p-ok', version: '1.0.0', type: 'app', namespace: 'qa_ok', objects: [] } });
        expect(res.status, JSON.stringify(res.payload)).toBe(200);
        expect(h.installRegistrations().map((m) => m.namespace)).toEqual(['qa_ok']);
        expect(readdirSync(dir)).toEqual(['com.qa.p-ok.json']);
    });

    it('lit control — an ABSENT namespace installs, as the declaration allows', async () => {
        expect(ManifestSchema.shape.namespace.safeParse(undefined).success).toBe(true);
        const h = await mount(dir);
        const res = await h.install({ manifest: { id: 'com.qa.p-none', version: '1.0.0', type: 'app', objects: [] } });
        expect(res.status, JSON.stringify(res.payload)).toBe(200);
        expect(h.installRegistrations().map((m) => m.id)).toEqual(['com.qa.p-none']);
        expect(new LocalManifestSource(dir).read('com.qa.p-none').entry?.manifestId).toBe('com.qa.p-none');
    });
});

describe('install-local parses the cloud snapshot\'s `namespace` through the same declaration', () => {
    it('refuses a snapshot whose namespace the declaration refuses — 502 (an upstream payload), nothing written', async () => {
        vi.stubEnv('OS_MARKETPLACE_PUBLIC_BASE_URL', 'off');
        vi.stubEnv('OS_CLOUD_API_KEY', 'svc-test-key');
        const fetchMock = vi.fn(async () => new Response(
            JSON.stringify({ data: { manifest: { id: 'com.qa.p-up', version: '1.0.0', namespace: 'QA_N', objects: [] }, version: '1.0.0', version_id: 'ver_1' } }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
        ));
        vi.stubGlobal('fetch', fetchMock);
        const h = await mount(dir, { controlPlaneUrl: 'http://cloud.test' });
        const res = await h.install({ packageId: 'pkg_qa' });
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expectDeclaredRefusal(res, 502);
        expect(res.payload.error.message).toContain(declaredSentence('QA_N'));
        expectNothingWritten(h);
    });

    it('judges a snapshot\'s namespace on the body registration reads too — 502, nothing written', async () => {
        vi.stubEnv('OS_MARKETPLACE_PUBLIC_BASE_URL', 'off');
        vi.stubEnv('OS_CLOUD_API_KEY', 'svc-test-key');
        const fetchMock = vi.fn(async () => new Response(
            JSON.stringify({ data: { manifest: stillNested('com.qa.p-up', 'QA_N'), version: '1.0.0', version_id: 'ver_1' } }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
        ));
        vi.stubGlobal('fetch', fetchMock);
        const h = await mount(dir, { controlPlaneUrl: 'http://cloud.test' });
        const res = await h.install({ packageId: 'pkg_qa' });
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expectDeclaredRefusal(res, 502);
        expect(res.payload.error.message).toContain(declaredSentence('QA_N'));
        expectNothingWritten(h);
    });
});

describe('over a real engine, the case variant never reaches the registry\'s namespace gate', () => {
    const HOLDER = { id: 'com.qa.n-one', name: 'n', version: '1.0.0', type: 'app', namespace: 'qa_n', objects: [] };

    /** The plugin over a REAL engine's `manifest` service and registry, booted to `kernel:ready`. */
    async function bootPlugin() {
        const kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false } as never);
        kernels.push(kernel);
        await kernel.use(new ObjectQLPlugin());
        await kernel.bootstrap();
        const ql = kernel.getService<ObjectQL>('objectql');
        ql.registry.logLevel = 'silent';
        const rawApp = makeRawApp();
        const hooks = new Map<string, () => Promise<void>>();
        const services: Record<string, unknown> = {
            manifest: kernel.getService('manifest'),
            auth: installerAuthService(),
            objectql: withInstallerGrants({
                convertPackageBodyForward: (body: unknown) => ql.convertPackageBodyForward(body),
                registry: ql.registry,
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
            logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
        };
        const plugin = new MarketplaceInstallLocalPlugin({ controlPlaneUrl: 'off', storageDir: dir });
        const p = plugin as unknown as Record<string, unknown>;
        p.bindArtifactHandlers = async () => undefined;
        p.applySideEffects = async () => ({ translationsLoaded: 0, seeded: { mode: 'none' } });
        await plugin.start(ctx as never);
        await hooks.get('kernel:ready')?.();
        const install = (body: Bag) => rawApp.routes.get(`POST ${ROUTE}`)!(makeC(body));
        const holderRes = await install({ manifest: HOLDER });
        expect(holderRes.status, JSON.stringify(holderRes.payload)).toBe(200);
        return { ql, install };
    }

    const ledgerIds = () => new LocalManifestSource(dir).list().entries.map((e) => e.manifestId).sort();

    it('`QA_N` beside an owner of `qa_n` answers the 400 and the registry does not hold it', async () => {
        const { ql, install } = await bootPlugin();
        const res = await install({ manifest: { id: 'com.qa.p-up', name: 'p', version: '1.0.0', type: 'app', namespace: 'QA_N', objects: [] } });
        expectDeclaredRefusal(res, 400);
        expect(res.payload.error.message).toContain(declaredSentence('QA_N'));
        expect(ql.registry.getPackage('com.qa.p-up')).toBeUndefined();
        expect(ql.registry.getNamespaceOwners('qa_n')).toEqual([HOLDER.id]);
        expect(ledgerIds()).toEqual([HOLDER.id]);
    });

    it('the same refusal on the body registration reads: the registry holds nothing under that namespace', async () => {
        const { ql, install } = await bootPlugin();
        const res = await install({ manifest: stillNested('com.qa.p-up', 'QA_N') });
        expectDeclaredRefusal(res, 400);
        expect(ql.registry.getPackage('com.qa.p-up')).toBeUndefined();
        expect(ql.registry.getNamespaceOwners('QA_N')).toEqual([]);
        expect(ledgerIds()).toEqual([HOLDER.id]);
    });

    it('CONTROL — `qa_n` beside that owner still meets the registry\'s own namespace gate, unchanged', async () => {
        const { ql, install } = await bootPlugin();
        const res = await install({ manifest: { id: 'com.qa.n-two', name: 'n2', version: '1.0.0', type: 'app', namespace: 'qa_n', objects: [] } });
        expect(res.status, JSON.stringify(res.payload)).toBe(422);
        expect(res.payload.error.code).toBe('PLUGIN_REGISTER_FAILED');
        expect(res.payload.error.message).toContain(HOLDER.id);
        expect(res.payload.error.message).toContain('qa_n');
        expect(ql.registry.getPackage('com.qa.n-two')).toBeUndefined();
        expect(ql.registry.getNamespaceOwners('qa_n')).toEqual([HOLDER.id]);
        expect(ledgerIds()).toEqual([HOLDER.id]);
    });
});
