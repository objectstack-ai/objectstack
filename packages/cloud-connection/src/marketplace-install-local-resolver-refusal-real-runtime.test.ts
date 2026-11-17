// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#34574] Over the REAL `@objectstack/runtime` — no module mock — the first
 * step of `POST /api/v1/marketplace/install-local` to resolve a composed
 * bundle's packages is 1c, the runtime binder's unrunnable-code judgements
 * (`collectJobsWithoutBody` and its siblings read every package body through
 * the artifact resolver). That step answers a refusal of the resolver with
 * that refusal, as 2a / 2b / 2c″ do: its own declared `422`, its code, its
 * `details`, and nothing written.
 *
 * Before, the resolver's refusal left the door there as a throw, and the
 * transport (which renders no `422`) answered `500 INTERNAL_ERROR` with no
 * reason — for all four refusals, and a dependency cycle was a bare `Error`
 * on top of that. `marketplace-install-local-resolver-refusal-34432.test.ts`
 * pins the later steps under a runtime that predates the judgements; this
 * file pins the door a real deployment runs.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
// The door reaches the runtime through a lazy `import()`; its first load is
// paid here, during collection, never inside a clocked test body.
import '@objectstack/runtime';

import { MarketplaceInstallLocalPlugin } from './marketplace-install-local-plugin.js';
import { declareInstallerPlatformOwner, installerAuthService, withInstallerGrants } from './install-local-principal.fixtures.js';
import { LocalManifestSource } from './local-manifest-source.js';

type Handler = (c: any) => Promise<any>;
type Row = Record<string, any>;

const ROUTE = '/api/v1/marketplace/install-local';
const SUITE = 'com.example.suite';

const ACCOUNT = { name: 'crm_account', label: 'Account', fields: { name: { type: 'text', label: 'Name' } } };
const LEAD = { name: 'crm_lead', label: 'Lead', fields: { company: { type: 'text', label: 'Company' } } };

const entry = (id: string, objects: Row[], dependencies?: Record<string, string>): Row => ({
    manifest: { id, name: id, version: '1.0.0', type: 'module', ...(dependencies ? { dependencies } : {}), objects },
});

/** A composed artifact: `packages[]` and no top-level `objects`, so every reader goes through the resolver. */
const composed = (packages: unknown): Row => ({ id: SUITE, name: 'Suite', version: '1.0.0', type: 'app', packages });

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

/** A driver with the declared-rename members the door asks; it reads no table. */
function fakeDriver() {
    return {
        planDeclaredRenames: vi.fn(async () => ({ carries: [], refusals: [] })),
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
        // A throw here is the defect: the door must ANSWER, never let a refusal reach the transport.
        install: (reqBody: Row) => rawApp.routes.get(`POST ${ROUTE}`)!(makeC(reqBody)),
        register,
        warn: ctx.logger.warn,
    };
}

let dir: string;
let posture: string | undefined;
let restoreOwner: () => void;
beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mil-resolver-refusal-real-runtime-'));
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
}

describe('#34574 — over the real runtime, step 1c answers a refusal of the artifact resolver with that refusal', () => {
    it('the runtime under test carries the judgements, so step 1c is the first reader of the packages', async () => {
        const runtime = await import('@objectstack/runtime');
        expect(typeof runtime.collectJobsWithoutBody).toBe('function');
    });

    it('two packages that depend on each other answer 422 CYCLIC_ARTIFACT_PACKAGES naming the cycle, and nothing is written', async () => {
        const driver = fakeDriver();
        const rt = await boot(dir, driver);
        const cyclic = [
            entry(`${SUITE}.core`, [ACCOUNT], { [`${SUITE}.leads`]: '*' }),
            entry(`${SUITE}.leads`, [LEAD], { [`${SUITE}.core`]: '*' }),
        ];

        const res = await rt.install({ manifest: composed(cyclic) });

        expect(res.status, JSON.stringify(res.payload)).toBe(422);
        expect(res.payload.success).toBe(false);
        expect(res.payload.error.code).toBe('CYCLIC_ARTIFACT_PACKAGES');
        expect(res.payload.error.details).toEqual({ cycle: [`${SUITE}.core`, `${SUITE}.leads`, `${SUITE}.core`] });
        expect(res.payload.error.message).toContain(`"${SUITE}.core" -> "${SUITE}.leads" -> "${SUITE}.core"`);
        expectNothingWritten(rt, driver);
    });

    it('a `packages` that is not a list answers 422 INVALID_ARTIFACT_PACKAGES, and nothing is written', async () => {
        const driver = fakeDriver();
        const rt = await boot(dir, driver);

        const res = await rt.install({ manifest: composed('not-a-list') });

        expect(res.status, JSON.stringify(res.payload)).toBe(422);
        expect(res.payload.error.code).toBe('INVALID_ARTIFACT_PACKAGES');
        expectNothingWritten(rt, driver);
    });

    it('a package id declared twice answers 422 DUPLICATE_ARTIFACT_PACKAGE, and nothing is written', async () => {
        const driver = fakeDriver();
        const rt = await boot(dir, driver);

        const res = await rt.install({ manifest: composed([entry(`${SUITE}.core`, [ACCOUNT]), entry(`${SUITE}.core`, [LEAD])]) });

        expect(res.status, JSON.stringify(res.payload)).toBe(422);
        expect(res.payload.error.code).toBe('DUPLICATE_ARTIFACT_PACKAGE');
        expectNothingWritten(rt, driver);
    });

    it('CONTROL: the same packages without the closing dependency install', async () => {
        const driver = fakeDriver();
        const rt = await boot(dir, driver);

        const res = await rt.install({
            manifest: composed([entry(`${SUITE}.core`, [ACCOUNT]), entry(`${SUITE}.leads`, [LEAD], { [`${SUITE}.core`]: '*' })]),
        });

        expect(res.status, JSON.stringify(res.payload)).toBe(200);
        expect(res.payload.success).toBe(true);
        expect(rt.register).toHaveBeenCalled();
    });
});
