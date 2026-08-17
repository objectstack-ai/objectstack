// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#9070] The marketplace install merges seed datasets but never registered the
// thing that CONSUMES them.
//
// ## The shape this file pins, and why nothing else caught it
//
// `applySideEffects` step 2 appends the installed package's `data` blocks onto
// the shared `seed-datasets` service (#3453 fixed that half). The per-organization
// replay that turns those datasets into a new org's private copy is a SEPARATE
// service, `seed-replayer`, and it is registered in `AppPlugin`'s seeder path —
// i.e. only when the HOST runtime declares seed data of its own.
//
// A runtime that declares no data of its own — `objects: []`, no `data`, which is
// exactly what a marketplace-install target looks like and exactly what
// `apps/objectos-ee` is — therefore ended up with `seed-datasets` POPULATED and
// `seed-replayer` ABSENT. The org-scoping middleware reads both, finds the
// datasets, finds no replayer, logs `datasets present but no replayer registered`
// and does nothing. Every organization founded after the install boots EMPTY,
// while the installer's own organization looks fine — it got its rows from the
// install-time inline seed, not from the replay. That asymmetry is why the defect
// survived: the probe everyone reaches for reports success.
//
// ⚠️ So a single-environment boot proves NOTHING here, and neither does asserting
// that the merge happened. Every test below is the walled / no-host-data
// direction, and the load-bearing assertion is always about the REPLAYER —
// registered, and actually replaying the union into a named organization.
//
// ## Shape of the harness
//
// Real plugin, real routes, real ledger on a real temp dir. The context is a
// standard `PluginContext` with NO `.kernel` handle and a registry that behaves
// like the kernel's: `getService` THROWS on a miss, `registerService` THROWS on a
// duplicate (`packages/core/src/plugin-loader.ts`). Both throws are load-bearing —
// they are the two framework traps #3453 was about, and a permissive fake would
// let a broken registration pass.
//
// Nothing in this file mounts an AppPlugin, on purpose: the absence of a host
// replayer IS the scenario.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let seedResult: any = { summary: { totalInserted: 2, totalUpdated: 0, totalSkipped: 0 }, errors: [] };
let loadCalls: any[] = [];

/**
 * Whether the mocked `@objectstack/runtime` exposes the seed helpers at all.
 *
 * Both states are real. In production the helpers exist and the plugin must use
 * them (register-once lives there, not in a caller-side probe). Under an older
 * runtime build — or in the five sibling suites in this package that mock this
 * module with only `SeedLoaderService` + `recordSeedOutcome` — they do not, and
 * the plugin must fall back to the inline equivalent. A silent no-op in the
 * fallback would restore this exact defect, invisibly, so both paths are pinned.
 *
 * Read through getters below so the toggle applies per call (the plugin resolves
 * the module lazily, at call time).
 */
let helpersPresent = true;

/**
 * Faithful-enough stand-ins. The REAL register-once/merge semantics are pinned
 * where they live — `packages/runtime/src/seed-datasets.test.ts` — so these exist
 * only to let this file observe that the plugin routes through them and honours
 * what they answer.
 */
const helperRegisterOnce = vi.fn((ctx: any, replayer: unknown): boolean => {
    try { if (ctx.getService('seed-replayer') !== undefined) return false; } catch { /* absent */ }
    try { ctx.registerService('seed-replayer', replayer); return true; } catch { return false; }
});
const helperMerge = vi.fn((ctx: any, datasets: readonly unknown[]): unknown[] => {
    let current: any[] | undefined;
    try { const v = ctx.getService('seed-datasets'); if (Array.isArray(v)) current = v; } catch { /* absent */ }
    const list: any[] = current ?? [];
    list.push(...datasets);
    if (!current) { try { ctx.registerService('seed-datasets', list); } catch { /* best effort */ } }
    return list;
});

vi.mock('@objectstack/runtime', () => ({
    SeedLoaderService: class {
        async load(request: any) { loadCalls.push(request); return seedResult; }
    },
    recordSeedOutcome: vi.fn(),
    get mergeSeedDatasets() { return helpersPresent ? helperMerge : undefined; },
    get registerSeedReplayerOnce() { return helpersPresent ? helperRegisterOnce : undefined; },
}));
vi.mock('@objectstack/spec/data', () => ({
    SeedLoaderRequestSchema: { parse: (x: any) => x },
}));

import { MarketplaceInstallLocalPlugin } from './marketplace-install-local-plugin.js';
import { installerAuthService, withInstallerGrants } from './install-local-principal.fixtures.js';
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

/**
 * A standard `PluginContext` over a kernel-faithful service registry.
 * `preRegistered` seeds services that already exist at install time — used to
 * stand up the "this host DOES have a replayer" control.
 */
function makeCtx(
    rawApp: any,
    services: Record<string, any>,
    effectivePosture: string,
    preRegistered: Record<string, any> = {},
) {
    const hooks = new Map<string, any>();
    const registry = new Map<string, any>(Object.entries(preRegistered));
    const ctx = {
        hook: (e: string, h: any) => hooks.set(e, h),
        getService: (name: string) => {
            if (name === 'http-server') return { getRawApp: () => rawApp };
            if (name === 'tenancy') return { posture: effectivePosture };
            if (registry.has(name)) return registry.get(name);
            const svc = services[name];
            // Kernel semantics: a miss THROWS, it does not answer undefined.
            if (svc === undefined) throw new Error(`[Kernel] Service '${name}' not found.`);
            return svc;
        },
        registerService: (name: string, svc: unknown) => {
            // Kernel semantics: a duplicate THROWS. This is framework trap ② of
            // #3453 — the one that used to swallow a second source's replayer.
            if (registry.has(name) || services[name] !== undefined) {
                throw new Error(`Service '${name}' already registered`);
            }
            registry.set(name, svc);
        },
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    };
    return {
        ctx,
        registry,
        /** Resolve without throwing, so an absent service is an ASSERTION failure. */
        peek: (name: string) => registry.get(name),
        fire: async () => { await hooks.get('kernel:ready')?.(); },
    };
}

function makeC(body: any) {
    const json = vi.fn((payload: any, status?: number) => ({ payload, status: status ?? 200 }));
    return {
        req: {
            url: 'http://localhost:3000/api/v1/marketplace/install-local',
            raw: new Request('http://localhost:3000/x'),
            json: async () => body,
            param: () => undefined,
            header: () => undefined,
        },
        json,
    };
}

/** The installed package: it carries the data. */
const MANIFEST = {
    id: 'app.test.crm',
    version: '1.0.0',
    objects: [{ name: 'crm_x', fields: { name: { type: 'text' } } }],
    data: [{ object: 'crm_x', records: [{ id: 'a', name: 'a' }, { id: 'b', name: 'b' }] }],
};

/** A second package, for the union assertion. */
const MANIFEST_2 = {
    id: 'app.test.helpdesk',
    version: '1.0.0',
    objects: [{ name: 'hd_ticket', fields: { subject: { type: 'text' } } }],
    data: [{ object: 'hd_ticket', records: [{ id: 't1', subject: 't1' }] }],
};

const SERVICES = () => ({
    manifest: { register: vi.fn() },
    auth: installerAuthService(),
    objectql: withInstallerGrants({
        syncSchemas: async () => undefined,
        find: vi.fn(async () => []),
    }),
    metadata: {},
    driver: { delete: vi.fn(async () => true) },
});

const OLD_POSTURE = process.env.OS_TENANCY_POSTURE;
const OLD_LEGACY = process.env.OS_MULTI_ORG_ENABLED;

let dir: string;
beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mil-replayer-'));
    seedResult = { summary: { totalInserted: 2, totalUpdated: 0, totalSkipped: 0 }, errors: [] };
    loadCalls = [];
    helpersPresent = true;
    helperRegisterOnce.mockClear();
    helperMerge.mockClear();
    // The walled deployment the defect was measured on.
    process.env.OS_TENANCY_POSTURE = 'isolated';
    delete process.env.OS_MULTI_ORG_ENABLED;
});
afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    if (OLD_POSTURE === undefined) delete process.env.OS_TENANCY_POSTURE;
    else process.env.OS_TENANCY_POSTURE = OLD_POSTURE;
    if (OLD_LEGACY === undefined) delete process.env.OS_MULTI_ORG_ENABLED;
    else process.env.OS_MULTI_ORG_ENABLED = OLD_LEGACY;
});

/**
 * Boot the plugin on a host with no seed data of its own and install `manifest`
 * through the real route. Walled posture with no active organization on the
 * request, which is the measured shape AND a useful property for these
 * assertions: the install-time inline seed is skipped, so the seed loader is
 * untouched until something invokes the REPLAYER.
 */
async function installOn(
    harness: ReturnType<typeof makeCtx>,
    rawApp: any,
    manifest: any = MANIFEST,
    plugin?: MarketplaceInstallLocalPlugin,
) {
    const p = plugin ?? new MarketplaceInstallLocalPlugin({ controlPlaneUrl: 'off', storageDir: dir });
    if (!plugin) {
        await p.start(harness.ctx as any);
        await harness.fire();
    }
    const res = await rawApp.routes.get('POST /api/v1/marketplace/install-local')!(makeC({ manifest }));
    return { res, plugin: p };
}

function freshHarness(preRegistered: Record<string, any> = {}) {
    const rawApp = makeRawApp();
    const harness = makeCtx(rawApp, SERVICES(), 'isolated', preRegistered);
    return { rawApp, harness };
}

describe('#9070 — install-local registers the per-org seed replayer, not just the datasets', () => {
    it('registers `seed-replayer` on a host runtime that declares no data of its own', async () => {
        // THE regression. Before the fix `seed-datasets` was populated and
        // `seed-replayer` was absent, which is precisely the state that makes the
        // org-scoping middleware log "datasets present but no replayer
        // registered" and leave every future organization empty.
        const { rawApp, harness } = freshHarness();
        const { res } = await installOn(harness, rawApp);

        expect(res.payload?.success).toBe(true);
        expect(harness.peek('seed-datasets')).toHaveLength(1);
        expect(typeof harness.peek('seed-replayer')).toBe('function');
    });

    it('the registered replayer seeds a NAMED organization from the merged datasets', async () => {
        // Registration alone is not the contract — being invocable the way the
        // middleware invokes it is. The install itself never ran the loader
        // (walled, no active org), so every call recorded here belongs to the
        // replay.
        const { rawApp, harness } = freshHarness();
        await installOn(harness, rawApp);
        expect(loadCalls).toHaveLength(0);

        const replayer = harness.peek('seed-replayer') as (id: string) => Promise<any>;
        const summary = await replayer('org_new');

        expect(loadCalls).toHaveLength(1);
        expect(loadCalls[0].config.organizationId).toBe('org_new');
        expect(loadCalls[0].seeds).toEqual(MANIFEST.data);
        expect(summary.inserted).toBe(2);
    });

    it('replays the UNION — an org founded after a LATER install gets that install too', async () => {
        // The reason the shared list exists at all (#3453). The replayer must read
        // the live list at invoke time; a snapshot captured when the closure was
        // built would hand the second package's customers an empty app.
        const { rawApp, harness } = freshHarness();
        const { plugin } = await installOn(harness, rawApp);
        await installOn(harness, rawApp, MANIFEST_2, plugin);

        const replayer = harness.peek('seed-replayer') as (id: string) => Promise<any>;
        await replayer('org_new');

        expect(loadCalls).toHaveLength(1);
        expect(loadCalls[0].seeds).toEqual([...MANIFEST.data, ...MANIFEST_2.data]);
    });

    it('reports `errors` as the loader ARRAY, the shape the consumer reads', async () => {
        // The middleware logs `summary?.errors?.length` and samples
        // `summary?.errors?.slice(0, 5)`. Hand it a count and both read through
        // optional chaining as "0 error(s)" — a failed replay that reports clean.
        seedResult = {
            summary: { totalInserted: 0, totalUpdated: 0, totalSkipped: 0 },
            errors: [{ message: 'boom one' }, { message: 'boom two' }],
        };
        const { rawApp, harness } = freshHarness();
        await installOn(harness, rawApp);

        const replayer = harness.peek('seed-replayer') as (id: string) => Promise<any>;
        const summary = await replayer('org_new');

        expect(Array.isArray(summary.errors)).toBe(true);
        expect(summary.errors).toHaveLength(2);
        expect(summary.errors.slice(0, 5)[0].message).toBe('boom one');
    });

    it('goes through the runtime helper when it is available', async () => {
        // Register-once is the helper's guarantee, not a caller-side probe. The
        // real semantics are pinned in packages/runtime/src/seed-datasets.test.ts.
        const { rawApp, harness } = freshHarness();
        await installOn(harness, rawApp);

        expect(helperRegisterOnce).toHaveBeenCalledTimes(1);
        expect(helperRegisterOnce.mock.calls[0][0]).toBe(harness.ctx);
        expect(typeof helperRegisterOnce.mock.calls[0][1]).toBe('function');
    });

    it('still registers when the runtime exposes no helper — the fallback is not decoration', async () => {
        // An older runtime build, or any of the sibling suites that mock this
        // module without the helpers. A no-op here would restore the defect and
        // nothing would say so.
        helpersPresent = false;
        const { rawApp, harness } = freshHarness();
        await installOn(harness, rawApp);

        expect(helperRegisterOnce).not.toHaveBeenCalled();
        expect(harness.peek('seed-datasets')).toHaveLength(1);
        expect(typeof harness.peek('seed-replayer')).toBe('function');

        const replayer = harness.peek('seed-replayer') as (id: string) => Promise<any>;
        await replayer('org_new');
        expect(loadCalls[0].config.organizationId).toBe('org_new');
    });

    it('never displaces a replayer the host already registered, and never throws', async () => {
        // Register-once by construction: a host WITH an AppPlugin app that has
        // seed data is unaffected. The incumbent reads the same shared list, so
        // it replays this package's datasets anyway. A caller that instead
        // re-registered would hit the duplicate-register throw (trap ② of #3453).
        const incumbent = vi.fn(async () => ({ inserted: 0, updated: 0, skipped: 0, errors: [] }));
        const { rawApp, harness } = freshHarness({ 'seed-replayer': incumbent });
        const { res } = await installOn(harness, rawApp);

        expect(res.payload?.success).toBe(true);
        expect(harness.peek('seed-replayer')).toBe(incumbent);
        expect(harness.peek('seed-datasets')).toHaveLength(1);
        expect(
            (harness.ctx.logger.warn as any).mock.calls.some((c: any[]) =>
                String(c[0]).includes('failed to register seed-replayer'),
            ),
        ).toBe(false);
    });

    it('registers on the REHYDRATE path too — a restarted runtime gets its replayer back', async () => {
        // The kernel is new on every boot, so the registration has to happen again
        // even though no install request arrives. Rehydrate calls applySideEffects
        // with `seedNow: false`, which is why the registration lives beside the
        // merge rather than inside the immediate-seed branch.
        new LocalManifestSource(dir).write({
            packageId: 'pkg_1',
            versionId: 'pkgv_1',
            manifestId: MANIFEST.id,
            version: MANIFEST.version,
            manifest: MANIFEST,
            installedAt: '2026-01-01T00:00:00.000Z',
            installedBy: 'admin',
            withSampleData: false,
        } as any);

        // No route call on this path — rehydrate runs off `kernel:ready` alone.
        const { harness } = freshHarness();
        const plugin = new MarketplaceInstallLocalPlugin({ controlPlaneUrl: 'off', storageDir: dir });
        await plugin.start(harness.ctx as any);
        await harness.fire();

        expect(harness.peek('seed-datasets')).toHaveLength(1);
        expect(typeof harness.peek('seed-replayer')).toBe('function');

        const replayer = harness.peek('seed-replayer') as (id: string) => Promise<any>;
        await replayer('org_new');
        expect(loadCalls).toHaveLength(1);
        expect(loadCalls[0].config.organizationId).toBe('org_new');
    });

    it('is a TOTAL function — a composition gap answers the zero summary, never a throw', async () => {
        // The middleware calls this inside a try/catch and falls back on failure,
        // so a throw is survivable — but it is reported as "replay failed" and
        // costs the operator a diagnosis. Mirror the AppPlugin replayer: say it
        // once, answer zeros, leave the fallbacks free to run.
        const rawApp = makeRawApp();
        const services: Record<string, any> = SERVICES();
        const harness = makeCtx(rawApp, services, 'isolated');
        await installOn(harness, rawApp);
        const replayer = harness.peek('seed-replayer') as (id: string) => Promise<any>;

        // (a) no organization id — nothing to scope a replay to.
        await expect(replayer('')).resolves.toEqual({ inserted: 0, updated: 0, skipped: 0, errors: [] });

        // (b) the services the loader needs went away under it.
        delete services.objectql;
        delete services.metadata;
        await expect(replayer('org_new')).resolves.toEqual({ inserted: 0, updated: 0, skipped: 0, errors: [] });

        expect(loadCalls).toHaveLength(0);
        expect(
            (harness.ctx.logger.warn as any).mock.calls.some((c: any[]) =>
                String(c[0]).includes('seed-replayer: objectql/metadata unavailable'),
            ),
        ).toBe(true);
    });
});
