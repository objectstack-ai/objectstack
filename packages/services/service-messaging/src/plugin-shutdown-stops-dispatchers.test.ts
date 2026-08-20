// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#9371] `await kernel.shutdown()` must leave NOTHING of this plugin still
 * touching the database.
 *
 * THE DEFECT. `MessagingServicePlugin` starts two `setInterval` dispatchers at
 * `kernel:ready` — `NotificationDispatcher` over `sys_notification_delivery`
 * and `HttpDispatcher` over `sys_http_delivery`. The teardown that stops them
 * was spelled `stop()`. The kernel's plugin teardown hook is `destroy()`
 * (`Plugin.destroy?()` in `@objectstack/core`'s `types.ts`; the only teardown
 * `ObjectKernel.performShutdown()` and `LiteKernel.destroy()` invoke), and
 * `stop()` is not part of that interface — so nothing in the repo ever called
 * it and both dispatchers went on ticking after shutdown had resolved.
 *
 * WHY IT WENT UNNOTICED, AND WHERE THE BILL LANDED. `start()` `unref()`s both
 * timers, so a long-lived host process still exits and the leak is silent in
 * production. Under vitest the worker process is alive throughout teardown, so
 * a tick fires AFTER the test file is over, reads a delivery table through a
 * driver the suite has already disconnected, and `SqlDriver`'s console
 * fallback warns. `console.*` inside a worker is an RPC to the main process
 * (`onUserConsoleLog`); one issued after `rpcDone()` has snapshotted the
 * pending set is rejected by `$rejectPendingCalls` as `EnvironmentTeardownError:
 * [vitest-worker]: Closing rpc while "onUserConsoleLog" was pending`. Nothing
 * awaits that promise, so it surfaces as an unhandled rejection and fails a run
 * in which every test passed — twice measured on `examples/app-showcase`
 * (334/334 and 337/337 green, exit 1, a merge-queue eviction each time).
 *
 * WHAT THIS PINS, AND WHY IN THIS SHAPE. The assertion is behavioural — "after
 * shutdown the plugin issues no further delivery reads/writes" — and not
 * `expect(plugin.destroy).toBeDefined()`, because the hook merely EXISTING is
 * not the property that was missing; being reached by the kernel is. The
 * counter is installed on the very `IDataEngine` the dispatchers captured, so
 * it observes the production call path (`outbox.claim()` → `engine.update()` /
 * `engine.find()`) rather than a stand-in.
 *
 * The pre-shutdown leg is a POSITIVE CONTROL and load-bearing: without it a
 * dispatcher that never started would satisfy the post-shutdown assertion
 * vacuously, and this test would pass on a plugin that does nothing at all.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQLPlugin } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import type { ObjectQL } from '@objectstack/objectql';
import type { IDataEngine } from '@objectstack/spec/contracts';
import { MessagingServicePlugin } from './messaging-service-plugin.js';

/** Fast enough that a handful of ticks fit in a short window; still real time. */
const TICK_MS = 10;
/** ~8 ticks. Wide enough that "no reads" cannot be a scheduling coincidence. */
const OBSERVE_MS = 80;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const openKernels: ObjectKernel[] = [];
const openDrivers: Array<{ disconnect?: () => Promise<void> }> = [];

afterEach(async () => {
    // Kernels first, drivers second: the kernel's own teardown still wants a
    // live driver to drain against. (Reversing these is what makes a suite
    // shout DATABASE_ERROR at teardown time.)
    while (openKernels.length) {
        try { await openKernels.pop()?.shutdown(); } catch { /* already stopped */ }
    }
    while (openDrivers.length) {
        try { await openDrivers.pop()?.disconnect?.(); } catch { /* noop */ }
    }
});

interface Booted {
    kernel: ObjectKernel;
    /** Reads/writes the dispatchers have made against the delivery tables. */
    deliveryCalls: () => number;
}

async function bootMessagingKernel(): Promise<Booted> {
    const kernel = new ObjectKernel({ logger: { level: 'silent' } } as any);
    openKernels.push(kernel);

    await kernel.use(new ObjectQLPlugin());
    await kernel.use(
        new MessagingServicePlugin({ dispatchIntervalMs: TICK_MS, partitionCount: 1 }),
    );
    await kernel.bootstrap();

    const objectql = kernel.getService<ObjectQL>('objectql');
    const driver: any = new SqlDriver({
        client: 'better-sqlite3',
        connection: { filename: ':memory:' },
        useNullAsDefault: true,
    });
    await driver.connect();
    objectql.registerDriver(driver, true);
    openDrivers.push(driver);
    await objectql.syncSchemas();

    // Count on the engine instance the dispatchers captured at `kernel:ready`
    // (`getData()` resolves the `data` service, which is this same object), so
    // the tally is of real `outbox.claim()` traffic.
    type EngineCall = (name: string, ...rest: unknown[]) => unknown;
    const engine = kernel.getService<IDataEngine>('data') as unknown as
        Record<'find' | 'findOne' | 'update', EngineCall>;
    let calls = 0;
    for (const method of ['find', 'findOne', 'update'] as const) {
        const orig = engine[method].bind(engine);
        engine[method] = (name: string, ...rest: unknown[]) => {
            if (String(name).includes('_delivery')) calls++;
            return orig(name, ...rest);
        };
    }

    return { kernel, deliveryCalls: () => calls };
}

describe('#9371 MessagingServicePlugin releases its dispatchers on kernel shutdown', () => {
    it('stops touching the delivery tables once shutdown() has resolved', async () => {
        const { kernel, deliveryCalls } = await bootMessagingKernel();

        // POSITIVE CONTROL — the dispatchers really are running, so the
        // post-shutdown assertion below is measuring silence and not absence.
        await sleep(OBSERVE_MS);
        expect(deliveryCalls()).toBeGreaterThan(0);

        await kernel.shutdown();

        const atShutdown = deliveryCalls();
        await sleep(OBSERVE_MS);

        // The contract: shutdown() resolving means the plugin is done with the
        // database. Before the fix both dispatchers kept ticking here and this
        // count kept climbing.
        expect(deliveryCalls()).toBe(atShutdown);
    });

    it('a second shutdown is a no-op rather than a throw', async () => {
        const { kernel } = await bootMessagingKernel();
        await sleep(TICK_MS * 2);
        await kernel.shutdown();
        // Idempotence matters because `destroy()` nulls the handles it stopped;
        // a teardown that only works once is a teardown that fails in a suite.
        const plugin = new MessagingServicePlugin();
        await expect(plugin.destroy()).resolves.toBeUndefined();
    });
});
