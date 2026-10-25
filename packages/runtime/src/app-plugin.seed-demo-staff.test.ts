// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AppPlugin } from './app-plugin';
import { readSeedSettlement } from './seed-settlement.js';
import type { PluginContext } from '@objectstack/core';

/**
 * #25777 — when the development boot will create the stack's `demoStaff`
 * (`@objectstack/plugin-auth` registers `demo-staff` with `armed: true`), the
 * application's seed runs at `kernel:bootstrapped`, after the accounts exist,
 * so a row naming one (`owner_id: 'Legal Counsel 1'`) resolves on the first
 * boot. Every other boot seeds inside `start()` exactly as before.
 *
 * The seed source is declared in `start()` either way, so the settlement tally
 * says "still writing" across the deferral — the same answer a seed that
 * overran its budget gives — and settles when the deferred seed lands.
 *
 * The basic-insert fallback (no `metadata` service) is forced, as in
 * `app-plugin.seed.test.ts`: the deferral is the same on both branches.
 */
describe('AppPlugin defers its inline seed while demo accounts are being created (#25777)', () => {
    const OLD_BUDGET = process.env.OS_INLINE_SEED_BUDGET_MS;
    const OLD_MULTI = process.env.OS_MULTI_ORG_ENABLED;

    let trigger: ReturnType<typeof vi.fn>;
    let insert: ReturnType<typeof vi.fn>;
    let hooks: Map<string, Array<() => Promise<void> | void>>;

    const makeContext = (staffing: { armed?: unknown } | undefined): PluginContext => {
        const services = new Map<string, unknown>();
        if (staffing) services.set('demo-staff', staffing);
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
            hook: vi.fn((name: string, handler: () => Promise<void> | void) => {
                const list = hooks.get(name) ?? [];
                list.push(handler);
                hooks.set(name, list);
            }),
            trigger,
        } as unknown as PluginContext;
    };

    const bundle = () => ({
        id: 'legal-demo',
        data: [{ object: 'legal_matter', records: [{ id: 'm1', title: 'Acme v. Roe', owner_id: 'Legal Counsel 1' }] }],
    });

    const seededMatter = () => insert.mock.calls.filter(([object]) => object === 'legal_matter');

    beforeEach(() => {
        process.env.OS_INLINE_SEED_BUDGET_MS = '8000';
        delete process.env.OS_MULTI_ORG_ENABLED;
        trigger = vi.fn();
        insert = vi.fn(async () => undefined);
        hooks = new Map();
    });

    afterEach(() => {
        if (OLD_BUDGET === undefined) delete process.env.OS_INLINE_SEED_BUDGET_MS;
        else process.env.OS_INLINE_SEED_BUDGET_MS = OLD_BUDGET;
        if (OLD_MULTI === undefined) delete process.env.OS_MULTI_ORG_ENABLED;
        else process.env.OS_MULTI_ORG_ENABLED = OLD_MULTI;
    });

    it('armed: start() writes nothing, and the kernel:bootstrapped hook seeds and settles', async () => {
        const ctx = makeContext({ armed: true });

        await new AppPlugin(bundle()).start(ctx);

        expect(seededMatter(), 'the seed must not run before the demo accounts exist').toEqual([]);
        expect(trigger).not.toHaveBeenCalledWith('app:seeded', expect.anything());
        expect(readSeedSettlement(ctx)).toEqual({ pending: 1, inFlight: 1, suppressed: [] });
        expect(hooks.get('kernel:bootstrapped')).toHaveLength(1);

        for (const handler of hooks.get('kernel:bootstrapped')!) await handler();

        expect(seededMatter()).toHaveLength(1);
        expect(readSeedSettlement(ctx)).toEqual({ pending: 0, inFlight: 0, suppressed: [] });
        expect(trigger).toHaveBeenCalledWith('app:seeded', { appId: 'legal-demo', overBudget: false });
    });

    it.each([
        ['not armed', { armed: false }],
        ['armed by anything but `true`', { armed: 'yes' }],
        ['no demo-staff service (a kernel without plugin-auth)', undefined],
    ])('%s: the seed runs inside start(), as it always did', async (_label, staffing) => {
        const ctx = makeContext(staffing);

        await new AppPlugin(bundle()).start(ctx);

        expect(seededMatter()).toHaveLength(1);
        expect(readSeedSettlement(ctx)).toEqual({ pending: 0, inFlight: 0, suppressed: [] });
        expect(hooks.get('kernel:bootstrapped') ?? []).toHaveLength(0);
    });

    it('multi-tenant still suppresses: an armed boot defers nothing it would not have run', async () => {
        process.env.OS_MULTI_ORG_ENABLED = 'true';
        const ctx = makeContext({ armed: true });

        await new AppPlugin(bundle()).start(ctx);

        expect(seededMatter()).toEqual([]);
        expect(hooks.get('kernel:bootstrapped') ?? []).toHaveLength(0);
        expect(readSeedSettlement(ctx)).toEqual({ pending: 1, inFlight: 0, suppressed: ['multi-tenant-replay'] });
    });
});
