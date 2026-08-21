// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#10772] `await kernel.shutdown()` must actually reach `WebhookOutboxPlugin`'s
 * teardown.
 *
 * THE DEFECT, AND HOW FAR IT WENT. At `kernel:ready` the plugin binds two
 * hooks onto the data engine and starts an {@link AutoEnqueuer}, which holds
 * TWO realtime subscriptions, a crypto-provider listener and a `setInterval`
 * refresh timer. The teardown that released all of it was spelled `dispose()`.
 * `Plugin` (`@objectstack/core`'s `types.ts`) declares `init()`, `start?(ctx)`
 * and `destroy?()` — and NO `dispose()` — and `ObjectKernel.performShutdown()`
 * / `LiteKernel.destroy()` walk the plugins in reverse calling
 * `plugin.destroy()`.
 *
 * Measured repo-wide on this revision: `dispose()` had ZERO callers anywhere
 * — not the kernel, not a test, not an example. This teardown had therefore
 * never run in any process at all, and everything above outlived every kernel
 * that started it.
 *
 * THE SPELLING. This member and `EmailServicePlugin` are the `dispose()` half
 * of the family — the seventh spelling the #10619 gate's roster was widened
 * for before any instance of it was known, already present when the roster was
 * measured. A census looking only for `stop()` misses both.
 *
 * WHY THE ASSERTIONS ARE BEHAVIOURAL. `expect(plugin.destroy).toBeDefined()`
 * would pass on a plugin the kernel still never reaches. These drive a real
 * `LiteKernel` through a real bootstrap and a real shutdown and read the
 * realtime service's own subscription ledger and the live timer count.
 *
 * EVERY PRE-SHUTDOWN LEG IS A POSITIVE CONTROL: without it a plugin that
 * subscribed to nothing would satisfy the post-shutdown assertion vacuously.
 *
 * THE `dispose()` LEG IS THE OTHER DIRECTION. The repair keeps `dispose()` as
 * a delegating alias because it is public API of an exported class, and an
 * embedder may have learned to call it directly PRECISELY BECAUSE the kernel
 * never did. Pinning only the shutdown direction would go green on an
 * implementation that simply deletes `dispose()` — which, given the zero-caller
 * census above, is exactly the shortcut this file exists to refuse.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LiteKernel } from '@objectstack/core';
import type { Plugin, PluginContext } from '@objectstack/core';
import { WebhookOutboxPlugin } from './webhook-outbox-plugin.js';

type AnyRecord = Record<string, any>;

/** Realtime double whose whole job is to record what is still subscribed. */
function fakeRealtime() {
    let next = 0;
    const live = new Set<string>();
    return {
        live,
        async subscribe() {
            const id = `sub_${++next}`;
            live.add(id);
            return id;
        },
        async unsubscribe(id: string) { live.delete(id); },
        async publish() { /* nothing under test */ },
    };
}

/** The slice of ObjectQL the enqueuer's cache refresh and the hooks touch. */
function fakeEngine() {
    return {
        registry: { listItems: () => [], getObject: () => undefined },
        async find() { return []; },
        async insert(_o: string, row: AnyRecord) { return { id: 'row_1', ...row }; },
        // No `update()` / `delete()` on purpose. Nothing on the path under
        // test writes through them, and a double that declares a write verb
        // it never serves is a double looser than `ObjectQL` for no reason —
        // which is the shape `check:engine-double-contract` exists to refuse.
        registerHook() { /* provenance stamp + headers gate */ },
        unregisterHooksByPackage() { return 0; },
    };
}

/**
 * Stands in for the plugin's declared dependency
 * (`dependencies = ['com.objectstack.service.messaging']`) and registers the
 * collaborators it resolves. Nothing here is under test — the plugin's own
 * teardown is.
 */
class FixturePlugin implements Plugin {
    name = 'com.objectstack.service.messaging';
    type = 'standard';
    version = '1.0.0';
    providesServices = ['manifest', 'objectql', 'realtime', 'messaging'];
    readonly realtime = fakeRealtime();
    readonly engine = fakeEngine();
    init(ctx: PluginContext): void {
        ctx.registerService('manifest', { register: () => {}, list: () => [] });
        ctx.registerService('objectql', this.engine);
        ctx.registerService('realtime', this.realtime);
        ctx.registerService('messaging', {
            enqueueHttp: async () => ({ id: 'delivery_1' }),
            isHttpDeliveryReady: () => true,
            registerRedeliverGuard: () => {},
        });
    }
}

async function boot() {
    const kernel = new LiteKernel({ logger: { level: 'error' } });
    const fixture = new FixturePlugin();
    kernel.use(fixture);
    const plugin = new WebhookOutboxPlugin();
    kernel.use(plugin);
    await kernel.bootstrap();
    return { kernel, plugin, fixture };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('#10772 WebhookOutboxPlugin stops its auto-enqueuer on kernel shutdown', () => {
    it('releases every realtime subscription once shutdown() has resolved', async () => {
        const { kernel, fixture } = await boot();

        // POSITIVE CONTROL — the enqueuer really did subscribe, so the
        // assertion below measures a release and not an absence.
        expect(fixture.realtime.live.size).toBe(2);

        await kernel.shutdown();

        // THE PIN. Before the fix these stayed live: the kernel had no
        // `destroy()` to call, and `dispose()` had no caller in the repo at
        // all — this teardown had never run in any process.
        expect(fixture.realtime.live.size).toBe(0);
    });

    it('leaves no armed refresh interval once shutdown() has resolved', async () => {
        const { kernel } = await boot();

        // POSITIVE CONTROL — the enqueuer's periodic refresh timer is armed.
        // Note for the census: this plugin owns a `setInterval` TRANSITIVELY,
        // through the collaborator it constructs, so a scan of the plugin
        // class's own text does not see it.
        expect(vi.getTimerCount()).toBeGreaterThan(0);

        await kernel.shutdown();

        expect(vi.getTimerCount()).toBe(0);
    });

    it('the kernel reaches destroy() during shutdown', async () => {
        const { kernel, plugin } = await boot();

        let reached = 0;
        const real = plugin.destroy.bind(plugin);
        plugin.destroy = async () => { reached += 1; await real(); };

        expect(reached).toBe(0);

        await kernel.shutdown();

        expect(reached).toBe(1);
    });

    it('the retained dispose() alias still tears down for an embedder that calls it directly', async () => {
        const { plugin, fixture } = await boot();

        expect(fixture.realtime.live.size).toBe(2);

        await plugin.dispose();

        expect(fixture.realtime.live.size).toBe(0);
    });

    it('a teardown on a plugin the kernel never started is a no-op rather than a throw', async () => {
        // Idempotence matters because `destroy()` clears the handles it
        // released; the kernel calls it on every plugin it walks.
        const plugin = new WebhookOutboxPlugin();
        await expect(plugin.destroy()).resolves.toBeUndefined();
        await expect(plugin.destroy()).resolves.toBeUndefined();
        await expect(plugin.dispose()).resolves.toBeUndefined();
    });
});
