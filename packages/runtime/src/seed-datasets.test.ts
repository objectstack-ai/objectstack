// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * #3453 — the multi-tenant seed-replay seam.
 *
 * In multi-tenant mode a new org replays the kernel's `seed-datasets` list on the
 * `sys_organization` insert, so that list MUST hold the union of every seed source
 * (every config app + every marketplace package). Two framework traps used to
 * shrink it to just the first source — the same pair #3444 fixed for seed-summary:
 *
 *   ① the standard PluginContext has NO `.kernel` handle, so the old
 *      `(ctx as any).kernel?.getService('seed-datasets')` read was always
 *      undefined and each source clobbered rather than extended the list; and
 *   ② `registerService` throws on a duplicate name, so the second source's
 *      re-register was swallowed and its datasets lost.
 *
 * Part A pins the register-once-then-mutate helper directly against a faithful
 * kernel fake (getService throws on miss, registerService throws on dupe, no
 * `.kernel` — mirrors seed-summary.test.ts). Part B boots the REAL AppPlugin and
 * proves its per-org replayer replays the live union of two config apps plus a
 * marketplace-style merge — not just whichever app registered first.
 */

// ── Part B plumbing: capture what the replayer feeds the seed loader ──────────
let loadCalls: any[] = [];
let seedResult: any = { summary: { totalInserted: 0, totalUpdated: 0, totalSkipped: 0 }, errors: [] };

vi.mock('./seed-loader.js', () => ({
    SeedLoaderService: class {
        constructor(..._args: any[]) { /* ql / metadata / logger ignored — mocked */ }
        async load(request: any) { loadCalls.push(request); return seedResult; }
    },
}));
// Keep every other `@objectstack/spec/data` export real; only stub the schema so
// the datasets pass through verbatim and stay assert-able (the heal test does the
// same passthrough).
vi.mock('@objectstack/spec/data', async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>();
    return { ...actual, SeedLoaderRequestSchema: { parse: (x: any) => x } };
});

import { mergeSeedDatasets, readSeedDatasets, registerSeedReplayerOnce } from './seed-datasets.js';
import { AppPlugin } from './app-plugin';

/** A faithful kernel context: getService throws on miss, registerService throws on
 *  dupe, and — crucially — NO `.kernel` property (mirrors packages/core/src/kernel.ts). */
function makeKernelCtx() {
    const services = new Map<string, unknown>();
    return {
        services,
        getService: (n: string) => {
            if (!services.has(n)) throw new Error(`[Kernel] Service '${n}' not found`);
            return services.get(n);
        },
        registerService: (n: string, v: unknown) => {
            if (services.has(n)) throw new Error(`[Kernel] Service '${n}' already registered`);
            services.set(n, v);
        },
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    };
}

const ds = (object: string, id: string) => ({ object, records: [{ id }] });

/**
 * A config-app bundle carrying a single seed dataset via the modern top-level
 * `data` field. The `manifest: { id }` matters: AppPlugin collects seeds from BOTH
 * top-level `data` AND `(bundle.manifest ?? bundle).data`, so a bundle whose
 * manifest falls back to the bundle itself re-collects its own `data` array twice
 * (a separate legacy quirk, #3434). Giving `manifest` a distinct object (with the
 * id the constructor requires, but no `data`) keeps each app's contribution to
 * exactly one dataset, so this seam test asserts on the cross-SOURCE union rather
 * than incidental self-duplication.
 */
const appBundle = (id: string, dataset: { object: string; records: unknown[] }) => ({
    id,
    manifest: { id },
    data: [dataset],
});

// ────────────────────────────────────────────────────────────────────────────
describe('seed-datasets helper — register-once-then-mutate (#3453)', () => {
    it('reads the live service through ctx.getService even though ctx has no .kernel (defect ①)', () => {
        const ctx = makeKernelCtx();
        expect('kernel' in ctx).toBe(false); // the real PluginContext shape

        const list = mergeSeedDatasets(ctx, [ds('crm_account', 'a')]);
        // Registered under the real service name, and the SAME reference is read
        // back through the context's own resolver — the only channel that works.
        expect(ctx.services.get('seed-datasets')).toBe(list);
        expect(readSeedDatasets(ctx)).toBe(list);
        expect(readSeedDatasets(ctx)).toEqual([ds('crm_account', 'a')]);
    });

    it('accumulates a second source instead of clobbering, with no duplicate-register throw (defects ①②)', () => {
        const ctx = makeKernelCtx();
        const app = ds('crm_account', 'a');
        const market = ds('hot_lead', 'm');

        mergeSeedDatasets(ctx, [app]); // config app registers the list
        // The marketplace merge would blow up on `registerService('seed-datasets')`
        // if it re-registered — it must mutate the existing list in place instead.
        expect(() => mergeSeedDatasets(ctx, [market])).not.toThrow();

        const stored = ctx.services.get('seed-datasets') as unknown[];
        expect(stored).toEqual([app, market]); // union, in source order
        expect(readSeedDatasets(ctx)).toBe(stored); // same reference throughout
    });

    it('exposes the LIVE array so a reference captured early still grows (the replayer contract)', () => {
        const ctx = makeKernelCtx();
        const captured = mergeSeedDatasets(ctx, [ds('a', '1')]); // e.g. a replayer closure holds this
        mergeSeedDatasets(ctx, [ds('b', '2')]); // a later source appends
        mergeSeedDatasets(ctx, [ds('c', '3')]);

        expect(readSeedDatasets(ctx)).toHaveLength(3);
        expect(captured).toHaveLength(3); // the captured ref grew in place, no re-snapshot
    });

    it('registerSeedReplayerOnce registers once, then reuses — never re-registers (defect ②)', () => {
        const ctx = makeKernelCtx();
        const first = () => 'first';
        const second = () => 'second';

        expect(registerSeedReplayerOnce(ctx, first)).toBe(true);
        expect(registerSeedReplayerOnce(ctx, second)).toBe(false); // reused, no throw
        expect(ctx.services.get('seed-replayer')).toBe(first); // first wins
    });

    it('never throws when the context exposes no service methods', () => {
        expect(() => mergeSeedDatasets({}, [ds('x', '1')])).not.toThrow();
        expect(readSeedDatasets({})).toBeUndefined();
        expect(readSeedDatasets(undefined)).toBeUndefined();
        expect(registerSeedReplayerOnce({}, () => 0)).toBe(false);
    });
});

// ────────────────────────────────────────────────────────────────────────────
describe('AppPlugin per-org replayer replays the live union (#3453 seam)', () => {
    const OLD_MULTI = process.env.OS_MULTI_ORG_ENABLED;

    beforeEach(() => {
        loadCalls = [];
        seedResult = { summary: { totalInserted: 0, totalUpdated: 0, totalSkipped: 0 }, errors: [] };
        process.env.OS_MULTI_ORG_ENABLED = 'true'; // per-org replay path; skip inline seed
    });
    afterEach(() => {
        if (OLD_MULTI === undefined) delete process.env.OS_MULTI_ORG_ENABLED;
        else process.env.OS_MULTI_ORG_ENABLED = OLD_MULTI;
        vi.restoreAllMocks();
    });

    /** Boot-tolerant kernel ctx: returns undefined for unknown services so
     *  AppPlugin.start() survives, but registerService still throws on dupe (so the
     *  register-once guards are exercised for real) and there is no `.kernel`. */
    function makeBootCtx() {
        const services = new Map<string, any>();
        services.set('objectql', { insert: vi.fn(async () => undefined) });
        services.set('metadata', {}); // truthy; all start() uses are `typeof x.method`-guarded
        const ctx: any = {
            logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
            getService: (n: string) => (services.has(n) ? services.get(n) : undefined),
            registerService: (n: string, v: any) => {
                if (services.has(n)) throw new Error(`[Kernel] Service '${n}' already registered`);
                services.set(n, v);
            },
            getServices: () => new Map(services),
            hook: vi.fn(),
            trigger: vi.fn(),
        };
        return { ctx, services };
    }

    it('replays every config app AND a marketplace merge — not just the first source', async () => {
        const { ctx, services } = makeBootCtx();

        // Two real config apps boot against the SAME kernel context.
        await new AppPlugin(appBundle('config-app-a', ds('crm_account', 'a1'))).start(ctx);
        // The second app must boot without a duplicate-register throw and EXTEND the
        // shared list rather than replace it.
        await expect(
            new AppPlugin(appBundle('config-app-b', ds('crm_contact', 'b1'))).start(ctx),
        ).resolves.toBeUndefined();

        // A marketplace package installs at runtime and merges its seeds the same
        // way (cloud-connection calls this very helper via @objectstack/runtime).
        mergeSeedDatasets(ctx, [ds('hot_lead', 'm1')]);

        // Exactly ONE replayer is registered (app A's; app B reused it).
        const replayer = services.get('seed-replayer');
        expect(typeof replayer).toBe('function');

        // A brand-new org is created → the middleware invokes the replayer.
        seedResult = { summary: { totalInserted: 3, totalUpdated: 0, totalSkipped: 0 }, errors: [] };
        const result = await replayer('org_fresh');

        // The replayer fed the loader the FULL union in source order — the crux of
        // #3453. Pre-fix it would have replayed only app A's snapshot.
        expect(loadCalls).toHaveLength(1);
        expect(loadCalls[0].seeds.map((s: any) => s.object)).toEqual([
            'crm_account',
            'crm_contact',
            'hot_lead',
        ]);
        // Tenant-scoped, upsert, multi-pass — as the org replay requires.
        expect(loadCalls[0].config).toMatchObject({
            defaultMode: 'upsert',
            multiPass: true,
            organizationId: 'org_fresh',
        });
        expect(result).toMatchObject({ inserted: 3 });
    });

    it('a later marketplace merge is visible to the already-registered replayer (live read)', async () => {
        const { ctx, services } = makeBootCtx();
        await new AppPlugin(appBundle('config-app-a', ds('crm_account', 'a1'))).start(ctx);

        const replayer = services.get('seed-replayer');
        expect(typeof replayer).toBe('function');

        // Org #1 is created BEFORE the marketplace install: only app A's seed.
        await replayer('org_one');
        expect(loadCalls.at(-1).seeds.map((s: any) => s.object)).toEqual(['crm_account']);

        // Marketplace installs AFTER the replayer closure was built…
        mergeSeedDatasets(ctx, [ds('hot_lead', 'm1')]);

        // …and org #2 replays BOTH, because the closure re-reads the live list.
        await replayer('org_two');
        expect(loadCalls.at(-1).seeds.map((s: any) => s.object)).toEqual(['crm_account', 'hot_lead']);
    });
});
