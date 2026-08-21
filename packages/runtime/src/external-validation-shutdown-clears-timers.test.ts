// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#10772] `await kernel.shutdown()` must actually clear this plugin's armed
 * drift-check intervals.
 *
 * THE DEFECT, AND WHY THIS MEMBER IS THE LOAD-BEARING ONE.
 * `ExternalValidationPlugin` arms one `setInterval` per opted-in datasource
 * from `scheduleDriftChecks()` at `kernel:ready` (ADR-0015 §5.2), keyed by
 * name in `driftTimers`. The `clearInterval` sweep over them was spelled
 * `stop = (): void => …`. `Plugin` (`@objectstack/core`'s `types.ts`) declares
 * `init()`, `start?(ctx)` and `destroy?()` — and NO `stop()` — so
 * `ObjectKernel.performShutdown()` and `LiteKernel.destroy()`, which walk the
 * plugins in reverse calling `plugin.destroy()`, walked straight past it. The
 * only caller `stop()` had anywhere in the tree was this class's own
 * `scheduleDriftChecks()` re-arming itself. So on kernel shutdown the
 * intervals were NEVER cleared — the #9371 mechanism verbatim, in one of only
 * two `Plugin` implementations in this tree that own `setInterval` at all
 * (`ReportsServicePlugin` is the other, repaired under #10371).
 *
 * This plugin is mounted on the real serve path
 * (`packages/cli/src/commands/serve.ts` — `kernel.use(createExternalValidationPlugin())`),
 * so the leak is not confined to tests.
 *
 * WHY THE LEAK STAYED SILENT. `scheduleDriftChecks()` `unref()`s each timer,
 * so a long-lived host process still exits and nothing complains in
 * production. Under vitest the worker is alive throughout teardown, so a tick
 * fires after the file is over and lands in whatever the suite has already
 * disconnected — which is exactly how #9371's bill arrived, as merge-queue
 * evictions of runs in which every test passed.
 *
 * WHY THE ASSERTIONS ARE BEHAVIOURAL. `expect(plugin.destroy).toBeDefined()`
 * would pass on a plugin the kernel still never reaches. These drive a real
 * `LiteKernel` through a real bootstrap (so the timers are armed by the real
 * `kernel:ready` path) and a real shutdown, and read the timer count and the
 * drift checker's own call count.
 *
 * EVERY PRE-SHUTDOWN LEG IS A POSITIVE CONTROL: without it a plugin that armed
 * nothing would satisfy the post-shutdown assertion vacuously.
 *
 * THE `stop()` LEG IS THE OTHER DIRECTION. The repair keeps `stop()` as a
 * delegating alias because it is public API of an exported class and an
 * embedder may have learned to call it directly PRECISELY BECAUSE the kernel
 * never did. Pinning only the shutdown direction would go green on an
 * implementation that simply deletes `stop()`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LiteKernel } from '@objectstack/core';
import type { Plugin, PluginContext } from '@objectstack/core';
import { ExternalValidationPlugin } from './external-validation-plugin.js';

const INTERVAL_MS = 1000;

/** Counts the drift checker's reads, so "still ticking" is measurable. */
class FakeFederationPlugin implements Plugin {
    name = 'test.federation';
    type = 'standard';
    version = '1.0.0';
    providesServices = ['external-datasource', 'metadata'];
    validateAllCalls = 0;
    init(ctx: PluginContext): void {
        ctx.registerService('external-datasource', {
            validateAll: async () => {
                this.validateAllCalls += 1;
                return { ok: true, results: [] };
            },
        });
        ctx.registerService('metadata', {
            list: async () => [
                { name: 'warehouse', external: { validation: { checkIntervalMs: INTERVAL_MS } } },
            ],
        });
    }
}

async function boot() {
    const kernel = new LiteKernel({ logger: { level: 'error' } });
    const federation = new FakeFederationPlugin();
    kernel.use(federation);
    const plugin = new ExternalValidationPlugin();
    kernel.use(plugin);
    await kernel.bootstrap();
    return { kernel, plugin, federation };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('#10772 ExternalValidationPlugin clears its drift timers on kernel shutdown', () => {
    it('leaves no armed interval once shutdown() has resolved', async () => {
        const { kernel } = await boot();

        // POSITIVE CONTROL — a drift timer really is armed by the real
        // `kernel:ready` path, so the assertion below measures a release.
        expect(vi.getTimerCount()).toBe(1);

        await kernel.shutdown();

        // THE PIN. Before the fix this stayed 1: the kernel had no `destroy()`
        // to call, and `stop()`'s only caller was this class re-arming itself.
        expect(vi.getTimerCount()).toBe(0);
    });

    it('issues no further drift reads once shutdown() has resolved', async () => {
        const { kernel, federation } = await boot();

        // POSITIVE CONTROL — the armed timer really does fire and really does
        // read, so a count that stops climbing means something.
        await vi.advanceTimersByTimeAsync(INTERVAL_MS);
        expect(federation.validateAllCalls).toBeGreaterThan(0);

        await kernel.shutdown();
        const atShutdown = federation.validateAllCalls;

        await vi.advanceTimersByTimeAsync(INTERVAL_MS * 5);

        // THE PIN. shutdown() resolving means the plugin is done reading.
        // Before the fix this count kept climbing.
        expect(federation.validateAllCalls).toBe(atShutdown);
    });

    it('the kernel reaches destroy() during shutdown', async () => {
        const { kernel, plugin } = await boot();

        let reached = 0;
        const real = plugin.destroy;
        plugin.destroy = () => { reached += 1; real(); };

        expect(reached).toBe(0);

        await kernel.shutdown();

        expect(reached).toBe(1);
    });

    it('the retained stop() alias still clears the timers for a direct caller', async () => {
        const { plugin } = await boot();

        expect(vi.getTimerCount()).toBe(1);

        plugin.stop();

        expect(vi.getTimerCount()).toBe(0);
    });

    it('the alias stays SYNCHRONOUS and survives being detached from the instance', async () => {
        // It was `stop = (): void =>`, an arrow property. A non-awaiting call
        // site and a detached `const { stop } = plugin` are both call shapes
        // the pre-repair class supported; widening the alias to a Promise, or
        // converting it to an unbound method, would break them.
        const { plugin } = await boot();

        const { stop } = plugin;
        const returned = stop();

        expect(returned).toBeUndefined();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('a teardown on a plugin that armed nothing is a no-op rather than a throw', async () => {
        const plugin = new ExternalValidationPlugin();
        expect(() => plugin.destroy()).not.toThrow();
        expect(() => plugin.destroy()).not.toThrow();
        expect(() => plugin.stop()).not.toThrow();
    });
});
