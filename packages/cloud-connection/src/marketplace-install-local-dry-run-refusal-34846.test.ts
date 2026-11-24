// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#34846] The dry run (`dryRun: true`, step 2a′) compares the installed copy
 * — the body the last install stored in the ledger — with the incoming
 * version through the `manifest` service's `planUpgrade`, which folds each
 * side through the artifact resolver (`resolveStackCollection`). When today's
 * resolver refuses either side, the dry run answers as the real install does
 * at step 2c″: that refusal's own declared status and code, the sentence
 * naming whose body was refused (the stored copy and the way out, or the
 * incoming package), and nothing planned or written. Before, the refusal was
 * thrown out of the door, and the transport, which renders no `422`, answered
 * `500 INTERNAL_ERROR`.
 *
 * Driven through the real `POST /api/v1/marketplace/install-local` handler
 * under the `single` posture, over a runtime that predates the step-1c code
 * judgements (`@objectstack/runtime` mocked without `collectJobsWithoutBody` /
 * `collectHooksWithoutBody`, as in
 * `marketplace-install-local-resolver-refusal-34432.test.ts`), so an incoming
 * body the resolver refuses reaches the dry run at all: a runtime carrying
 * those judgements answers it at step 1c first. The installed side is read by
 * no step before the dry run, so its refusal reaches it on every runtime.
 * `planUpgrade` here is the comparison the real service runs (each side folded
 * by `resolveStackCollection`, then `comparePackageVersions`), as in
 * `marketplace-install-local-upgrade-plan.test.ts`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

vi.mock('@objectstack/runtime', () => ({
    SeedLoaderService: class {
        async loadStored() { return this.load(); }
        async load() { return { summary: { totalInserted: 0, totalUpdated: 0, totalSkipped: 0 }, errors: [] }; }
        async buildDependencyGraph(objects: string[]) { return { objects }; }
    },
    resolveSeedLocaleForLoad: async () => undefined,
    appDefaultSeedLocale: () => undefined,
    describeSeedLocale: () => 'none',
}));

import { resolveStackCollection } from '@objectstack/core';
import { comparePackageVersions } from '@objectstack/metadata-core';
import { MarketplaceInstallLocalPlugin } from './marketplace-install-local-plugin.js';
import { declareInstallerPlatformOwner, installerAuthService, withInstallerGrants } from './install-local-principal.fixtures.js';
import { LocalManifestSource } from './local-manifest-source.js';

type Handler = (c: any) => Promise<any>;
type Row = Record<string, any>;

const ROUTE = '/api/v1/marketplace/install-local';
const SUITE = 'com.example.suite';

const LEAD = { name: 'crm_lead', label: 'Lead', fields: { account_name: { type: 'text', label: 'Account' } } };
const ACCOUNT = { name: 'crm_account', label: 'Account', fields: { name: { type: 'text', label: 'Name' } } };
/** An object still carrying the retired bare `indexes[].unique: true`, which the package-entry contract refuses. */
const RETIRED_ACCOUNT = { ...ACCOUNT, indexes: [{ fields: ['name'], unique: true }] };

const entry = (id: string, objects: Row[]): Row => ({
    manifest: { id, name: id, version: '1.0.0', type: 'module', objects },
});

/**
 * A composed artifact: `packages[]` and no top-level `objects`, so every reader goes through the resolver.
 * Its top-level `datasources` map (empty) is what step 2a, the datasource holder, reads instead of
 * resolving the packages, so an incoming body the resolver refuses reaches the dry run.
 */
const composed = (packages: unknown): Row => ({ id: SUITE, name: 'Suite', version: '1.0.0', type: 'app', datasources: {}, packages });
const WELL_FORMED = (): Row[] => [entry(`${SUITE}.core`, [ACCOUNT]), entry(`${SUITE}.leads`, [LEAD])];
const REFUSED = (): Row[] => [entry(`${SUITE}.core`, [RETIRED_ACCOUNT]), entry(`${SUITE}.leads`, [LEAD])];

const INCOMING_SENTENCE = `Package '${SUITE}' cannot be installed:`;
const INSTALLED_SENTENCE = `The installed copy of package '${SUITE}', stored here by its last install, is refused by this runtime:`;

function makeRawApp() {
    const routes = new Map<string, Handler>();
    return {
        routes,
        get: (p: string, h: Handler) => routes.set(`GET ${p}`, h),
        post: (p: string, h: Handler) => routes.set(`POST ${p}`, h),
        delete: (p: string, h: Handler) => routes.set(`DELETE ${p}`, h),
    };
}

function makeC(reqBody: any) {
    return {
        req: {
            url: `http://localhost:3000${ROUTE}`,
            raw: new Request(`http://localhost:3000${ROUTE}`),
            json: async () => reqBody,
            param: () => undefined,
            header: () => undefined,
            query: () => undefined,
        },
        json: vi.fn((payload: any, status?: number) => ({ payload, status: status ?? 200 })),
    };
}

const fold = (artifact: unknown) => ({
    objects: resolveStackCollection(artifact, 'objects'),
    objectExtensions: resolveStackCollection(artifact, 'objectExtensions'),
    data: resolveStackCollection(artifact, 'data'),
});

async function boot(dir: string) {
    const rawApp = makeRawApp();
    const hooks = new Map<string, any>();
    const register = vi.fn();
    const syncSchemas = vi.fn(async () => undefined);
    const planUpgrade = vi.fn(async (installed: unknown, incoming: unknown) => ({
        plan: comparePackageVersions(fold(installed), fold(incoming)),
        environment: { columns: [], removedObjects: [], seeds: [] },
    }));
    const services: Record<string, any> = {
        manifest: { register, planUpgrade },
        auth: installerAuthService(),
        objectql: withInstallerGrants({ syncSchemas, registry: { getObject: () => undefined } }),
        metadata: {},
    };
    const ctx = {
        hook: (e: string, h: any) => hooks.set(e, h),
        getService: (name: string) => {
            if (name === 'http-server') return { getRawApp: () => rawApp };
            const svc = services[name];
            if (svc === undefined) throw new Error(`no ${name}`);
            return svc;
        },
        registerService: (name: string, svc: unknown) => { services[name] = svc; },
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    };
    const plugin = new MarketplaceInstallLocalPlugin({ controlPlaneUrl: 'off', storageDir: dir });
    await plugin.start(ctx as any);
    await hooks.get('kernel:ready')?.();
    // The door registers its own plugin manifest at boot; only the dry run's registrations count.
    register.mockClear();
    return {
        dryRun: (manifest: unknown) => rawApp.routes.get(`POST ${ROUTE}`)!(makeC({ manifest, dryRun: true })),
        register,
        syncSchemas,
        planUpgrade,
    };
}

let dir: string;
let posture: string | undefined;
let restoreOwner: () => void;
beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mil-dry-run-refusal-'));
    posture = process.env.OS_TENANCY_POSTURE;
    process.env.OS_TENANCY_POSTURE = 'single';
    restoreOwner = declareInstallerPlatformOwner('admin');
});
afterEach(() => {
    restoreOwner();
    rmSync(dir, { recursive: true, force: true });
    if (posture === undefined) delete process.env.OS_TENANCY_POSTURE;
    else process.env.OS_TENANCY_POSTURE = posture;
    vi.restoreAllMocks();
});

/** The ledger entry an earlier install would have written: `manifest` is the stored copy. */
function seedInstalledCopy(manifest: Row): void {
    new LocalManifestSource(dir).write({
        packageId: SUITE,
        versionId: 'local',
        manifestId: SUITE,
        version: '1.0.0',
        manifest,
        installedAt: '2026-01-01T00:00:00.000Z',
        installedBy: 'admin',
        withSampleData: false,
    });
}

/** Every ledger file and its bytes. */
const ledgerFiles = (): Record<string, string> =>
    Object.fromEntries(readdirSync(dir).sort().map((f) => [f, readFileSync(join(dir, f), 'utf8')]));

/** No plan read, nothing registered or synced, and the ledger byte-for-byte as it was. */
function expectNothingPlannedOrWritten(rt: Awaited<ReturnType<typeof boot>>, before: Record<string, string>) {
    expect(rt.planUpgrade).not.toHaveBeenCalled();
    expect(rt.register).not.toHaveBeenCalled();
    expect(rt.syncSchemas).not.toHaveBeenCalled();
    expect(ledgerFiles()).toEqual(before);
}

describe('#34846 — a dry-run re-install answers a resolver refusal of either side as the real install does, never a throw', () => {
    it('the installed copy refused, the incoming version well-formed: the resolver\'s 422 naming the stored copy and the remedy', async () => {
        const rt = await boot(dir);
        seedInstalledCopy(composed(REFUSED()));
        const before = ledgerFiles();

        const res = await rt.dryRun(composed(WELL_FORMED()));

        expect(res.status, JSON.stringify(res.payload)).toBe(422);
        expect(res.payload.success).toBe(false);
        expect(res.payload.error.code).toBe('INVALID_ARTIFACT_PACKAGE_ENTRY');
        expect(res.payload.error.message.startsWith(INSTALLED_SENTENCE), res.payload.error.message).toBe(true);
        expect(res.payload.error.message).not.toContain(INCOMING_SENTENCE);
        expectNothingPlannedOrWritten(rt, before);
    });

    it('the incoming version refused over a well-formed installed copy: the resolver\'s 422 naming the incoming package', async () => {
        const rt = await boot(dir);
        seedInstalledCopy(composed(WELL_FORMED()));
        const before = ledgerFiles();

        const res = await rt.dryRun(composed(REFUSED()));

        expect(res.status, JSON.stringify(res.payload)).toBe(422);
        expect(res.payload.success).toBe(false);
        expect(res.payload.error.code).toBe('INVALID_ARTIFACT_PACKAGE_ENTRY');
        expect(res.payload.error.message.startsWith(INCOMING_SENTENCE), res.payload.error.message).toBe(true);
        expect(res.payload.error.message).not.toContain('installed copy');
        expectNothingPlannedOrWritten(rt, before);
    });

    it('both refused: the incoming package\'s refusal is the answer, asked first, as at step 2c″', async () => {
        const rt = await boot(dir);
        seedInstalledCopy(composed(REFUSED()));
        const before = ledgerFiles();

        const res = await rt.dryRun(composed(REFUSED()));

        expect(res.status, JSON.stringify(res.payload)).toBe(422);
        expect(res.payload.error.code).toBe('INVALID_ARTIFACT_PACKAGE_ENTRY');
        expect(res.payload.error.message.startsWith(INCOMING_SENTENCE), res.payload.error.message).toBe(true);
        expectNothingPlannedOrWritten(rt, before);
    });

    it('CONTROL: a well-formed installed copy and a well-formed incoming version answer the plan, as before', async () => {
        const rt = await boot(dir);
        seedInstalledCopy(composed(WELL_FORMED()));
        const before = ledgerFiles();

        const res = await rt.dryRun(composed(WELL_FORMED()));

        expect(res.status, JSON.stringify(res.payload)).toBe(200);
        expect(res.payload.success).toBe(true);
        expect(res.payload.data.dryRun).toBe(true);
        expect(res.payload.data.installedVersion).toBe('1.0.0');
        expect(rt.planUpgrade).toHaveBeenCalledTimes(1);
        expect(rt.register).not.toHaveBeenCalled();
        expect(ledgerFiles()).toEqual(before);
    });
});
