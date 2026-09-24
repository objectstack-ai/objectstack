// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A seed dataset declared ONCE on an ADDITIVE multi-package artifact is applied
 * once per boot, after registration has stamped the package body's copy.
 *
 * The additive shape carries every definition twice: flattened at the top
 * level and again under `packages[i].manifest`. It is what every multi-package
 * artifact built before the emitter stopped writing the flattened copy looks
 * like, and what `composeStacks(…, { manifest: 'preserve' })` still emits for a
 * composition whose bodies do not reproduce the flattened half. Compiled to
 * `objectstack.json`, the two copies are equal values but different objects.
 *
 * `AppPlugin.init` hands the artifact to the `manifest` service, which
 * registers `packages[]` only; `registerItem('data', …)` stamps `_packageId` /
 * `_provenance` onto the body's dataset IN PLACE. `AppPlugin.start` then
 * resolves its collections, and a dataset has no `name`, so it is claimed by
 * value. With the stamps counted as part of that value the body copy was a
 * second dataset: two entries in the shared `seed-datasets` registry, and a
 * `mode: 'insert'` row written twice.
 *
 * The fixtures elsewhere could not see this: they are `upsert`-only, which is
 * idempotent, and their additive fixture shares object REFERENCES between the
 * two halves, which the reference claim catches before any value is compared.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LiteKernel, type PluginContext } from '@objectstack/core';
import { ObjectQLPlugin } from '@objectstack/objectql';
import { applyProtection } from '@objectstack/spec/shared';

import { AppPlugin } from './app-plugin.js';
import { readSeedDatasets } from './seed-datasets.js';

const CORE_ID = 'com.test.stamped.core';

const coreBody = () => ({
    id: CORE_ID,
    name: 'stamped_core',
    version: '1.0.0',
    type: 'app',
    objects: [{ name: 'stamped_account', label: 'Account', fields: { name: { name: 'name', type: 'text', label: 'Name' } } }],
    data: [{ object: 'stamped_account', mode: 'insert', records: [{ name: 'once' }] }],
});

const ordersBody = (withOwnDataset = false) => ({
    id: 'com.test.stamped.orders',
    name: 'stamped_orders',
    version: '1.0.0',
    type: 'module',
    dependencies: { [CORE_ID]: '^1.0.0' },
    objects: [{ name: 'stamped_order', label: 'Order', fields: { name: { name: 'name', type: 'text', label: 'Name' } } }],
    ...(withOwnDataset ? { data: [{ object: 'stamped_order', mode: 'insert', records: [{ name: 'second' }] }] } : {}),
});

/** The compiled additive shape: both halves, round-tripped through JSON. */
const compiledAdditive = (withOwnDataset = false): any => {
    const core = coreBody();
    const orders = ordersBody(withOwnDataset);
    return JSON.parse(JSON.stringify({
        manifest: { id: CORE_ID, name: 'stamped_core', version: '1.0.0', type: 'app' },
        objects: [...core.objects, ...orders.objects],
        data: [...core.data, ...((orders as { data?: unknown[] }).data ?? [])],
        packages: [{ manifest: core }, { manifest: orders }],
    }));
};

const coreBodyOf = (artifact: any) => artifact.packages.find((p: any) => p.manifest.id === CORE_ID).manifest;

describe('additive artifact — real registration, then the seed registry', () => {
    const boot = async (artifact: unknown) => {
        const kernel = new LiteKernel({ logger: { level: 'error' } });
        kernel.use(new ObjectQLPlugin({}));
        kernel.use(new AppPlugin(artifact));
        await kernel.bootstrap();
        const seeds = kernel.getService<unknown[]>('seed-datasets');
        await kernel.shutdown();
        return seeds;
    };

    it('registers a dataset declared once exactly once', async () => {
        const artifact = compiledAdditive();

        const seeds = await boot(artifact);

        // Registration really did stamp the body's copy and leave the top level
        // alone — without this the case is the unstamped one, which was never
        // broken.
        expect(coreBodyOf(artifact).data[0]).toMatchObject({ _packageId: CORE_ID, _provenance: 'package' });
        expect(artifact.data[0]._packageId).toBeUndefined();

        expect(seeds).toHaveLength(1);
        expect(seeds).toEqual([expect.objectContaining({ object: 'stamped_account', mode: 'insert' })]);
    });

    it('still registers a second package\'s OWN dataset', async () => {
        // The count above is not a collapse of everything into one: a dataset
        // the other package declares is a second definition and arrives.
        const seeds = await boot(compiledAdditive(true));

        expect((seeds as Array<{ object: string }>).map((d) => d.object).sort())
            .toEqual(['stamped_account', 'stamped_order']);
    });
});

describe('additive artifact — a stamped body copy writes its insert row once', () => {
    const OLD_BUDGET = process.env.OS_INLINE_SEED_BUDGET_MS;
    const OLD_MULTI = process.env.OS_MULTI_ORG_ENABLED;
    let insert: ReturnType<typeof vi.fn>;

    /** A context with a real service map, `objectql.insert` spied, `metadata` absent (basic-insert path). */
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
                return services.get(name);
            }),
            getServices: vi.fn(() => new Map()),
            hook: vi.fn(),
            trigger: vi.fn(),
        } as unknown as PluginContext;
    };

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

    it('applies the mode:insert record once per boot', async () => {
        const artifact = compiledAdditive();
        // What registration does to the body's copy before `start()` reads it,
        // with the registrar's own function.
        applyProtection(coreBodyOf(artifact).data[0], { packageId: CORE_ID });
        const ctx = makeContext();

        await new AppPlugin(artifact).start(ctx);

        expect(readSeedDatasets(ctx)).toHaveLength(1);
        expect(insert).toHaveBeenCalledTimes(1);
        expect(insert).toHaveBeenCalledWith('stamped_account', { name: 'once' }, expect.anything());
    });
});
