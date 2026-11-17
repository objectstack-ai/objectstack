// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#34432] Step 2c″ of the install door (the declared renames) reads every
 * package body of a composed artifact through the artifact resolver, as the
 * `isolated`-posture D5e gate (2b) does. A body the resolver refuses is
 * answered with that refusal's own declared status and code — the resolver's
 * `422 INVALID_ARTIFACT_PACKAGES` / `INVALID_ARTIFACT_PACKAGE_ENTRY` — and
 * nothing is written. Before, every throw out of the rename plan was answered
 * `503 SERVICE_UNAVAILABLE` "Retry once the database answers", so an author
 * whose bundle is malformed was told the database was down.
 *
 * Driven through the real `POST /api/v1/marketplace/install-local` handler
 * under the `single` posture, where the D5e gate reads no body, over a runtime
 * that predates the step-1c code judgements (`@objectstack/runtime` is mocked
 * without `collectJobsWithoutBody` / `collectHooksWithoutBody`, as in
 * `marketplace-install-local-composed-top-level-reads.test.ts`), so 2c″ is the
 * first step to resolve the packages. (A runtime that carries those
 * judgements resolves the packages at step 1c first, and the resolver's
 * refusal leaves the door as a throw.) The controls pin the rest of the
 * contract: a table that really could not be read still answers 503, and an
 * undeclared throw out of the resolver (its own dependency-cycle error) is
 * rethrown, never relabelled.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

vi.mock('@objectstack/runtime', () => ({
    SeedLoaderService: class {
        // [#34613] The stored-seed funnel the plugin calls; it ends in `load`.
        async loadStored() { return this.load(); }
        async load() { return { summary: { totalInserted: 0, totalUpdated: 0, totalSkipped: 0 }, errors: [] }; }
        async buildDependencyGraph(objects: string[]) { return { objects }; }
    },
    resolveSeedLocaleForLoad: async () => undefined,
    appDefaultSeedLocale: () => undefined,
    describeSeedLocale: () => 'none',
}));

import { MarketplaceInstallLocalPlugin } from './marketplace-install-local-plugin.js';
import { declareInstallerPlatformOwner, installerAuthService, withInstallerGrants } from './install-local-principal.fixtures.js';
import { LocalManifestSource } from './local-manifest-source.js';

type Handler = (c: any) => Promise<any>;
type Row = Record<string, any>;

const ROUTE = '/api/v1/marketplace/install-local';
const SUITE = 'com.example.suite';

/** An object whose field declares a rename, so step 2c″ asks the driver to read its table. */
const LEAD = { name: 'crm_lead', label: 'Lead', fields: { account_name: { type: 'text', label: 'Account', renamedFrom: ['company'] } } };
const ACCOUNT = { name: 'crm_account', label: 'Account', fields: { name: { type: 'text', label: 'Name' } } };

const entry = (id: string, objects: Row[], dependencies?: Record<string, string>): Row => ({
    manifest: { id, name: id, version: '1.0.0', type: 'module', ...(dependencies ? { dependencies } : {}), objects },
});

/** A composed artifact: `packages[]` and no top-level `objects`, so every reader goes through the resolver. */
const composed = (packages: unknown): Row => ({ id: SUITE, name: 'Suite', version: '1.0.0', type: 'app', packages });
const WELL_FORMED = (): Row[] => [entry(`${SUITE}.core`, [ACCOUNT]), entry(`${SUITE}.leads`, [LEAD])];

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

/**
 * A driver with the declared-rename members the door asks. Its plan reads no
 * table and carries nothing; `planThrows` makes the table read fail the way a
 * database that does not answer fails it (an undeclared throw).
 */
function fakeDriver(opts: { planThrows?: boolean } = {}) {
    return {
        planDeclaredRenames: vi.fn(async () => {
            if (opts.planThrows) throw new Error('connect ECONNREFUSED');
            return { carries: [], refusals: [] };
        }),
        carryDeclaredRenames: vi.fn(async () => []),
        reverseDeclaredRenames: vi.fn(async () => undefined),
    };
}

async function boot(dir: string, driver: ReturnType<typeof fakeDriver>) {
    const rawApp = makeRawApp();
    const hooks = new Map<string, any>();
    const register = vi.fn();
    const services: Record<string, any> = {
        manifest: { register },
        auth: installerAuthService(),
        objectql: withInstallerGrants({
            syncSchemas: async () => undefined,
            getDriverForObject: () => driver,
            registry: { getObject: () => undefined },
        }),
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
    // The door registers its own plugin manifest at boot; only the install's registrations count.
    register.mockClear();
    return {
        install: (reqBody: Row) => rawApp.routes.get(`POST ${ROUTE}`)!(makeC(reqBody)),
        register,
    };
}

let dir: string;
let posture: string | undefined;
let restoreOwner: () => void;
beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mil-resolver-refusal-'));
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

/** Nothing registered, no ledger entry, and the table never read. */
function expectNothingWritten(rt: Awaited<ReturnType<typeof boot>>, driver: ReturnType<typeof fakeDriver>) {
    expect(rt.register).not.toHaveBeenCalled();
    expect(new LocalManifestSource(dir).read(SUITE).entry).toBeNull();
    expect(driver.planDeclaredRenames).not.toHaveBeenCalled();
    expect(driver.carryDeclaredRenames).not.toHaveBeenCalled();
}

describe('#34432 — step 2c″ answers a body the artifact resolver refuses with that refusal, under the single posture', () => {
    it('a `packages` that is not a list answers 422 INVALID_ARTIFACT_PACKAGES, and nothing is written', async () => {
        const driver = fakeDriver();
        const rt = await boot(dir, driver);

        const res = await rt.install({ manifest: composed('not-a-list') });

        expect(res.status, JSON.stringify(res.payload)).toBe(422);
        expect(res.payload.success).toBe(false);
        expect(res.payload.error.code).toBe('INVALID_ARTIFACT_PACKAGES');
        expectNothingWritten(rt, driver);
    });

    it('a package entry carrying a retired bare `indexes[].unique: true` answers 422 INVALID_ARTIFACT_PACKAGE_ENTRY, and nothing is written', async () => {
        const driver = fakeDriver();
        const rt = await boot(dir, driver);
        const retired = { ...ACCOUNT, indexes: [{ fields: ['name'], unique: true }] };

        const res = await rt.install({ manifest: composed([entry(`${SUITE}.core`, [retired]), entry(`${SUITE}.leads`, [LEAD])]) });

        expect(res.status, JSON.stringify(res.payload)).toBe(422);
        expect(res.payload.success).toBe(false);
        expect(res.payload.error.code).toBe('INVALID_ARTIFACT_PACKAGE_ENTRY');
        expectNothingWritten(rt, driver);
    });
});

describe('#34432 — controls: the 503 stays the unread table\'s, and an undeclared throw stays a throw', () => {
    it('CONTROL: a well-formed composed artifact whose renamed field\'s table cannot be read still answers 503 SERVICE_UNAVAILABLE', async () => {
        const driver = fakeDriver({ planThrows: true });
        const rt = await boot(dir, driver);

        const res = await rt.install({ manifest: composed(WELL_FORMED()) });

        expect(res.status, JSON.stringify(res.payload)).toBe(503);
        expect(res.payload.error.code).toBe('SERVICE_UNAVAILABLE');
        expect(driver.planDeclaredRenames).toHaveBeenCalledTimes(1);
        expect(rt.register).not.toHaveBeenCalled();
        expect(new LocalManifestSource(dir).read(SUITE).entry).toBeNull();
    });

    it('CONTROL: the same artifact over a table that reads installs', async () => {
        const driver = fakeDriver();
        const rt = await boot(dir, driver);

        const res = await rt.install({ manifest: composed(WELL_FORMED()) });

        expect(res.status, JSON.stringify(res.payload)).toBe(200);
        expect(driver.planDeclaredRenames).toHaveBeenCalledTimes(1);
    });

    it('an undeclared throw out of the resolver (a dependency cycle between two packages) is rethrown, never answered 503', async () => {
        const driver = fakeDriver();
        const rt = await boot(dir, driver);
        const cyclic = [
            entry(`${SUITE}.core`, [ACCOUNT], { [`${SUITE}.leads`]: '*' }),
            entry(`${SUITE}.leads`, [LEAD], { [`${SUITE}.core`]: '*' }),
        ];

        const outcome = await rt.install({ manifest: composed(cyclic) }).then(
            (res: any) => ({ answered: res }),
            (err: unknown) => ({ thrown: err as Error }),
        );

        expect('answered' in outcome ? JSON.stringify(outcome.answered.payload) : 'thrown').toBe('thrown');
        expect((outcome as { thrown: Error }).thrown.message).toContain('Circular dependency');
        expectNothingWritten(rt, driver);
    });
});
