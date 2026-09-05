// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AppPlugin } from './app-plugin';
import { readSeedDatasets } from './seed-datasets.js';
import { readSeedSettlement } from './seed-settlement.js';
import type { PluginContext } from '@objectstack/core';

/**
 * #2996 — AppPlugin emits `app:seeded` when its inline seed settles, so
 * reconcilers that read seeded rows (plugin-auth's ADR-0093 D6 membership
 * backfill) can re-run for users inserted by a seed that overran the inline
 * budget and finished in the background AFTER `kernel:ready`.
 *
 * These tests force the basic-insert fallback path (no `metadata` service) so
 * the SeedLoaderService plumbing is unnecessary — the settle signalling is the
 * same on both branches.
 */
describe('AppPlugin inline-seed settle signal (app:seeded, #2996)', () => {
    const OLD_BUDGET = process.env.OS_INLINE_SEED_BUDGET_MS;
    const OLD_MULTI = process.env.OS_MULTI_ORG_ENABLED;

    let trigger: ReturnType<typeof vi.fn>;
    let insert: ReturnType<typeof vi.fn>;

    const makeContext = (overrides: Partial<PluginContext> = {}): PluginContext =>
        ({
            logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
            registerService: vi.fn(),
            getService: vi.fn((name: string) => {
                if (name === 'objectql') return { insert };
                // `metadata` absent → basic-insert fallback; all others absent too.
                return undefined;
            }),
            getServices: vi.fn(() => new Map()),
            hook: vi.fn(),
            trigger,
            ...overrides,
        }) as unknown as PluginContext;

    const bundleWithUser = () => ({
        id: 'seed-test-app',
        data: [{ object: 'sys_user', records: [{ id: 'seeded_u1' }] }],
    });

    beforeEach(() => {
        delete process.env.OS_MULTI_ORG_ENABLED;
        trigger = vi.fn();
    });

    afterEach(() => {
        if (OLD_BUDGET === undefined) delete process.env.OS_INLINE_SEED_BUDGET_MS;
        else process.env.OS_INLINE_SEED_BUDGET_MS = OLD_BUDGET;
        if (OLD_MULTI === undefined) delete process.env.OS_MULTI_ORG_ENABLED;
        else process.env.OS_MULTI_ORG_ENABLED = OLD_MULTI;
    });

    it('emits app:seeded with overBudget=true after a background seed finishes past the budget', async () => {
        process.env.OS_INLINE_SEED_BUDGET_MS = '10';
        // Insert resolves well after the 10ms budget, so the race yields to the
        // budget and the seed continues in the background.
        insert = vi.fn(() => new Promise((resolve) => setTimeout(resolve, 60)));
        const ctx = makeContext();
        const plugin = new AppPlugin(bundleWithUser());

        await plugin.start(ctx);

        // start() returned once the budget elapsed — the background seed (and
        // thus the settle signal) has NOT fired yet.
        expect(trigger).not.toHaveBeenCalledWith('app:seeded', expect.anything());

        await vi.waitFor(() => {
            expect(trigger).toHaveBeenCalledWith('app:seeded', {
                appId: 'seed-test-app',
                overBudget: true,
            });
        });
        // The user was still inserted by the background seed.
        expect(insert).toHaveBeenCalledWith('sys_user', { id: 'seeded_u1' }, expect.anything());
    });

    it('emits app:seeded with overBudget=false when the seed completes within budget', async () => {
        process.env.OS_INLINE_SEED_BUDGET_MS = '8000';
        insert = vi.fn(async () => undefined); // resolves immediately
        const ctx = makeContext();
        const plugin = new AppPlugin(bundleWithUser());

        await plugin.start(ctx);

        expect(trigger).toHaveBeenCalledWith('app:seeded', {
            appId: 'seed-test-app',
            overBudget: false,
        });
    });

    it('does not emit app:seeded when the app has no seed datasets', async () => {
        insert = vi.fn(async () => undefined);
        const ctx = makeContext();
        const plugin = new AppPlugin({ id: 'seed-test-app' });

        await plugin.start(ctx);

        expect(trigger).not.toHaveBeenCalledWith('app:seeded', expect.anything());
    });

    it('does not throw when the kernel context has no trigger() function', async () => {
        process.env.OS_INLINE_SEED_BUDGET_MS = '8000';
        insert = vi.fn(async () => undefined);
        const ctx = makeContext({ trigger: undefined as any });
        const plugin = new AppPlugin(bundleWithUser());

        await expect(plugin.start(ctx)).resolves.toBeUndefined();
        expect(insert).toHaveBeenCalledWith('sys_user', { id: 'seeded_u1' }, expect.anything());
    });

    it('does not run the inline seed (or emit) in multi-tenant mode', async () => {
        process.env.OS_MULTI_ORG_ENABLED = 'true';
        insert = vi.fn(async () => undefined);
        const ctx = makeContext();
        const plugin = new AppPlugin(bundleWithUser());

        await plugin.start(ctx);

        expect(insert).not.toHaveBeenCalled();
        expect(trigger).not.toHaveBeenCalledWith('app:seeded', expect.anything());
    });

    /**
     * #4795 — the same three branches, seen through the `seed-settlement`
     * contract. `app:seeded` alone cannot answer "is a seed still landing?"
     * because the two branches that never emit it are exactly the two where
     * the answer is "yes, and it never will be" — so the settle signal needs a
     * standing tally beside it, declared before the branch is chosen.
     */
    describe('seed-settlement signal (#4795)', () => {
        /** Like `makeContext`, but with a service map the tally can live in. */
        const makeSettlementContext = (): PluginContext => {
            const services = new Map<string, unknown>();
            return makeContext({
                registerService: vi.fn((name: string, svc: unknown) => {
                    if (services.has(name)) throw new Error(`service '${name}' already registered`);
                    services.set(name, svc);
                }),
                getService: vi.fn((name: string) => {
                    if (name === 'objectql') return { insert };
                    if (services.has(name)) return services.get(name);
                    return undefined; // `metadata` absent → basic-insert fallback
                }),
            } as unknown as Partial<PluginContext>);
        };

        it('an over-budget seed stays pending until the background run settles', async () => {
            process.env.OS_INLINE_SEED_BUDGET_MS = '10';
            insert = vi.fn(() => new Promise((resolve) => setTimeout(resolve, 60)));
            const ctx = makeSettlementContext();

            await new AppPlugin(bundleWithUser()).start(ctx);

            // start() returned on the budget; the rows are still landing. This
            // is the window in which `kernel:ready` used to certify the store.
            expect(readSeedSettlement(ctx)).toEqual({ pending: 1, inFlight: 1, suppressed: [] });

            await vi.waitFor(() => {
                expect(readSeedSettlement(ctx)).toEqual({ pending: 0, inFlight: 0, suppressed: [] });
            });
            expect(trigger).toHaveBeenCalledWith('app:seeded', {
                appId: 'seed-test-app',
                overBudget: true,
            });
        });

        it('a seed that fits its budget has already settled when start() returns', async () => {
            process.env.OS_INLINE_SEED_BUDGET_MS = '8000';
            insert = vi.fn(async () => undefined);
            const ctx = makeSettlementContext();

            await new AppPlugin(bundleWithUser()).start(ctx);

            expect(readSeedSettlement(ctx)).toEqual({ pending: 0, inFlight: 0, suppressed: [] });
        });

        it('multi-tenant suppresses its source, which therefore never settles', async () => {
            process.env.OS_MULTI_ORG_ENABLED = 'true';
            insert = vi.fn(async () => undefined);
            const ctx = makeSettlementContext();

            await new AppPlugin(bundleWithUser()).start(ctx);

            expect(readSeedSettlement(ctx)).toEqual({
                pending: 1,
                inFlight: 0,
                suppressed: ['multi-tenant-replay'],
            });
        });

        it('skipSeedData suppresses its source, which therefore never settles', async () => {
            insert = vi.fn(async () => undefined);
            const ctx = makeSettlementContext();

            await new AppPlugin(bundleWithUser(), undefined, { skipSeedData: true }).start(ctx);

            expect(insert).not.toHaveBeenCalled();
            expect(readSeedSettlement(ctx)).toEqual({
                pending: 1,
                inFlight: 0,
                suppressed: ['skip-seed-data'],
            });
        });

        it('registers no tally at all when the app has no seed datasets', async () => {
            insert = vi.fn(async () => undefined);
            const ctx = makeSettlementContext();

            await new AppPlugin({ id: 'seed-test-app' }).start(ctx);

            // Nothing to wait for — the attestation backstop runs unchanged.
            expect(readSeedSettlement(ctx)).toBeUndefined();
        });

        /**
         * The settle must land before the `trigger` guard, not after it: a
         * kernel context with no `trigger()` still finished its seed, and
         * leaving the tally pending there would strand every consumer waiting
         * on a signal that cannot arrive.
         */
        it('settles even when the kernel context has no trigger()', async () => {
            process.env.OS_INLINE_SEED_BUDGET_MS = '8000';
            insert = vi.fn(async () => undefined);
            const base = makeSettlementContext();
            const ctx = { ...base, trigger: undefined } as unknown as PluginContext;

            await new AppPlugin(bundleWithUser()).start(ctx);

            expect(readSeedSettlement(ctx)).toEqual({ pending: 0, inFlight: 0, suppressed: [] });
        });
    });
});

/**
 * #15262 — a FLAT bundle (manifest fields written directly on the bundle, no
 * `manifest:` key) had every seed dataset collected TWICE.
 *
 * `start()` reads seed data from two locations: the top-level `data` field and
 * the legacy `manifest.data`. The legacy read resolves its base as
 * `this.bundle.manifest || this.bundle`, so on a flat bundle it re-reads the
 * very array the top-level read just contributed. `mergeSeedDatasets` is a
 * plain `push` with no de-duplication, so both copies reach the shared
 * `seed-datasets` registry AND the inline loader — for a `mode: 'insert'`
 * dataset that is the row applied twice per boot, not merely doubled work.
 *
 * The sibling two-location collector for `translations` (`loadTranslations`)
 * has always carried the reference guard that makes the same read safe. These
 * tests pin BOTH halves of that guard: the flat bundle collects once, and a
 * bundle whose `manifest.data` is a genuinely DIFFERENT array still collects
 * both — a fix that simply deleted the legacy read would pass the first
 * assertion and fail the second.
 */
describe('AppPlugin flat-bundle seed collection (#15262)', () => {
    const OLD_BUDGET = process.env.OS_INLINE_SEED_BUDGET_MS;
    const OLD_MULTI = process.env.OS_MULTI_ORG_ENABLED;

    let insert: ReturnType<typeof vi.fn>;

    /** A context with a real service map, so `seed-datasets` can be read back. */
    const makeContext = (): PluginContext => {
        const services = new Map<string, unknown>();
        return {
            logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
            registerService: vi.fn((name: string, svc: unknown) => {
                if (services.has(name)) throw new Error(`service '${name}' already registered`);
                services.set(name, svc);
            }),
            getService: vi.fn((name: string) => {
                if (name === 'objectql') return { insert };
                if (services.has(name)) return services.get(name);
                return undefined; // `metadata` absent → basic-insert fallback
            }),
            getServices: vi.fn(() => new Map()),
            hook: vi.fn(),
            trigger: vi.fn(),
        } as unknown as PluginContext;
    };

    /** The shape the card names: NO `manifest` key, a top-level `data` array. */
    const flatBundle = () => ({
        id: 'com.test.flat-seed',
        name: 'flat-seed',
        data: [
            {
                object: 'sys_user',
                mode: 'insert',
                records: [{ id: 'flat_u1', name: 'Flat One' }],
            },
        ],
    });

    beforeEach(() => {
        delete process.env.OS_MULTI_ORG_ENABLED;
        process.env.OS_INLINE_SEED_BUDGET_MS = '8000';
        insert = vi.fn(async () => undefined);
    });

    afterEach(() => {
        if (OLD_BUDGET === undefined) delete process.env.OS_INLINE_SEED_BUDGET_MS;
        else process.env.OS_INLINE_SEED_BUDGET_MS = OLD_BUDGET;
        if (OLD_MULTI === undefined) delete process.env.OS_MULTI_ORG_ENABLED;
        else process.env.OS_MULTI_ORG_ENABLED = OLD_MULTI;
    });

    it('collects a flat bundle seed dataset ONCE, not once per read location', async () => {
        const ctx = makeContext();

        await new AppPlugin(flatBundle()).start(ctx);

        expect(readSeedDatasets(ctx)).toHaveLength(1);
    });

    it('applies a mode:insert record ONCE per boot on a flat bundle', async () => {
        const ctx = makeContext();

        await new AppPlugin(flatBundle()).start(ctx);

        // The row consequence, not the collection count: the doubled dataset
        // was applied twice by the inline seed — the #3434 end state reached
        // by a different route.
        expect(insert).toHaveBeenCalledTimes(1);
        expect(insert).toHaveBeenCalledWith('sys_user', { id: 'flat_u1', name: 'Flat One' }, expect.anything());
    });

    it('still collects BOTH sources when manifest.data is a genuinely different array', async () => {
        const ctx = makeContext();
        const bundle = {
            manifest: {
                id: 'com.test.nested-seed',
                data: [{ object: 'sys_user', mode: 'insert', records: [{ id: 'legacy_u1' }] }],
            },
            data: [{ object: 'sys_user', mode: 'insert', records: [{ id: 'top_u1' }] }],
        };

        await new AppPlugin(bundle).start(ctx);

        // Anti-vacuity: the legacy fallback is GUARDED, not removed.
        expect(readSeedDatasets(ctx)).toHaveLength(2);
        expect(insert).toHaveBeenCalledTimes(2);
        expect(insert).toHaveBeenCalledWith('sys_user', { id: 'top_u1' }, expect.anything());
        expect(insert).toHaveBeenCalledWith('sys_user', { id: 'legacy_u1' }, expect.anything());
    });
});
