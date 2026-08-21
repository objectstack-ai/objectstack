// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#10772] `await kernel.shutdown()` must actually reach `AppPlugin`'s
 * teardown.
 *
 * THE DEFECT. `AppPlugin` emits `app:registered` on the kernel bus at start so
 * the control plane's `AppCatalogService` can upsert the `sys_app` row, and it
 * emitted the matching `app:unregistered` from a teardown spelled
 * `stop = async (ctx) => …`. `Plugin` (`@objectstack/core`'s `types.ts`)
 * declares `init()`, `start?(ctx)` and `destroy?()` — and NO `stop()` — so
 * `ObjectKernel.performShutdown()` and `LiteKernel.destroy()`, which walk the
 * plugins in reverse calling `plugin.destroy()`, walked straight past it.
 * Nothing in the repo ever called `stop()` on a plugin, so the catalog row
 * outlived every kernel that registered it.
 *
 * WHY THE #10371 CENSUS MISSED IT. The alias is an arrow PROPERTY, not a
 * method, so a method-only reading of the class does not see it at all.
 *
 * THE ASYMMETRY THAT HID IT. `start?(ctx)` IS on the interface and does fire.
 * A `start`/`stop` pair where only one half is wired reads as symmetric in
 * review — which is the whole reason this shape survived in eleven classes.
 *
 * WHY THE ASSERTIONS ARE BEHAVIOURAL. `expect(plugin.destroy).toBeDefined()`
 * would pass on a plugin the kernel still never reaches. These drive a real
 * `LiteKernel` through a real bootstrap and a real shutdown and read the
 * events that actually landed on the bus.
 *
 * EVERY PRE-SHUTDOWN LEG IS A POSITIVE CONTROL: without it a plugin that never
 * registered anything would satisfy the post-shutdown assertion vacuously.
 *
 * THE `stop()` LEG IS THE OTHER DIRECTION. The repair keeps `stop()` as a
 * delegating alias because it is public API of an exported class and an
 * embedder may have learned to call it directly PRECISELY BECAUSE the kernel
 * never did. Pinning only the shutdown direction would go green on an
 * implementation that simply deletes `stop()`.
 */

import { describe, it, expect } from 'vitest';
import { LiteKernel } from '@objectstack/core';
import type { Plugin, PluginContext } from '@objectstack/core';
import { ObjectQLPlugin } from '@objectstack/objectql';
import { AppPlugin, type AppPluginProjectContext } from './app-plugin.js';

const PROJECT: AppPluginProjectContext = {
    environmentId: 'env_1',
    organizationId: 'org_1',
    projectName: 'catalog-teardown',
};

const BUNDLE = { manifest: { id: 'demo_app', name: 'demo_app', label: 'Demo' } };

/** Captures the catalog events AppPlugin puts on the kernel bus. */
class CatalogRecorderPlugin implements Plugin {
    name = 'test.catalog-recorder';
    type = 'standard';
    version = '1.0.0';
    readonly events: string[] = [];
    init(ctx: PluginContext): void {
        ctx.hook('app:registered', () => { this.events.push('app:registered'); });
        ctx.hook('app:unregistered', () => { this.events.push('app:unregistered'); });
    }
}

/** `emitCatalogEvent` does not await `ctx.trigger`, so let the bus settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * The REAL composition an app kernel runs: the engine (which also provides the
 * `manifest` service `AppPlugin` declares it cannot degrade without) plus the
 * app itself. Booting without the engine makes `start()` return before it
 * reaches the `app:registered` emit — which would leave the positive control
 * below unsatisfiable and the pin vacuous.
 */
async function boot() {
    const kernel = new LiteKernel({ logger: { level: 'error' } });
    const recorder = new CatalogRecorderPlugin();
    kernel.use(new ObjectQLPlugin({}));
    kernel.use(recorder);
    const plugin = new AppPlugin(BUNDLE, PROJECT, { skipSeedData: true });
    kernel.use(plugin);
    await kernel.bootstrap();
    await settle();
    return { kernel, plugin, recorder };
}

describe('#10772 AppPlugin emits app:unregistered on kernel shutdown', () => {
    it('puts app:unregistered on the bus once shutdown() has resolved', async () => {
        const { kernel, recorder } = await boot();

        // POSITIVE CONTROL — the catalog wiring really is live, so the
        // assertion below measures an emit and not a dead hook.
        expect(recorder.events).toContain('app:registered');
        expect(recorder.events).not.toContain('app:unregistered');

        await kernel.shutdown();
        await settle();

        // THE PIN. Before the fix this never arrived: the kernel had no
        // `destroy()` to call, and `stop()` was never anybody's business.
        expect(recorder.events).toContain('app:unregistered');
    });

    it('the kernel reaches destroy() during shutdown', async () => {
        const { kernel, plugin } = await boot();

        let reached = 0;
        const real = plugin.destroy;
        plugin.destroy = async () => { reached += 1; await real(); };

        expect(reached).toBe(0);

        await kernel.shutdown();

        expect(reached).toBe(1);
    });

    it('the retained stop() alias still tears down for an embedder that calls it directly', async () => {
        const { plugin, recorder } = await boot();

        expect(recorder.events).not.toContain('app:unregistered');

        // No argument — the shape an embedder writes against a property whose
        // parameter the repair made optional.
        await plugin.stop();
        await settle();

        expect(recorder.events).toContain('app:unregistered');
    });

    it('the stop() alias still accepts the PluginContext argument it used to require', async () => {
        const { plugin, recorder } = await boot();

        // The pre-repair signature was `stop(ctx: PluginContext)`, required.
        // An embedder holding that call shape must keep compiling AND keep
        // working — the entire reason the alias was retained.
        const ctx = {
            logger: { info() {}, warn() {}, error() {}, debug() {} },
        } as unknown as PluginContext;
        await plugin.stop(ctx);
        await settle();

        expect(recorder.events).toContain('app:unregistered');
    });

    it('the alias survives being detached from the instance', async () => {
        // It is an arrow PROPERTY, not a method — `const { stop } = plugin` is
        // a call shape the pre-repair class supported, so the repair must not
        // quietly convert it into an unbound method.
        const { plugin, recorder } = await boot();

        const { stop } = plugin;
        await stop();
        await settle();

        expect(recorder.events).toContain('app:unregistered');
    });

    it('a teardown on a plugin the kernel never initialized is a no-op rather than a throw', async () => {
        // The kernel calls `destroy()` on every plugin it walks, including one
        // whose `init()` never ran because an earlier plugin threw.
        const plugin = new AppPlugin(BUNDLE, PROJECT, { skipSeedData: true });
        await expect(plugin.destroy()).resolves.toBeUndefined();
        await expect(plugin.stop()).resolves.toBeUndefined();
    });
});
