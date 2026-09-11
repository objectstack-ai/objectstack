// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #17610 — in the COMPOSED plugin, an `emit()` that enqueues deliveries wakes
 * the notification dispatcher.
 *
 * The dispatcher backs off while the outbox is idle, which is only harmless
 * because the ingress that writes delivery rows wakes it. That wiring lives in
 * `MessagingServicePlugin` (`setOutbox(outbox, { onEnqueued })`), and every
 * unit test of the dispatcher would stay green if a refactor dropped it —
 * notifications would quietly start going out up to `maxIdleIntervalMs` late.
 * So this boots the real plugin on a real engine and measures delivery.
 *
 * ## Why the verdict is deterministic, not a race
 *
 * The plugin boots with `dispatchIntervalMs` = 60 s: after its first tick at
 * `kernel:ready`, no timer-driven tick can start for a minute. A delivery that
 * completes inside the few seconds this test waits can only have been started
 * by `wake()`.
 *
 * The NEGATIVE CONTROL proves that premise on the same boot: a row written
 * straight into the outbox table — no `emit()`, so no wake — is still
 * `pending` after a real wait. Without it, a dispatcher ticking fast for any
 * unrelated reason would pass the positive leg vacuously.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQLPlugin } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import type { ObjectQL } from '@objectstack/objectql';
import type { IDataEngine } from '@objectstack/spec/contracts';
import { MessagingServicePlugin } from './messaging-service-plugin.js';
import type { MessagingService } from './messaging-service.js';
import { DELIVERY_OBJECT } from './sql-outbox.js';
import { hashPartition } from './backoff.js';

/** No timer-driven tick inside the test's lifetime. */
const DISPATCH_INTERVAL_MS = 60_000;
const PARTITIONS = 1;
/** Long enough that a ticking dispatcher would have drained the control row many times over. */
const CONTROL_WAIT_MS = 500;
const DELIVERY_BUDGET_MS = 5_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(predicate: () => boolean, budgetMs: number): Promise<void> {
    const deadline = Date.now() + budgetMs;
    while (!predicate()) {
        if (Date.now() > deadline) throw new Error(`condition not met within ${budgetMs} ms`);
        await sleep(10);
    }
}

const openKernels: ObjectKernel[] = [];
const openDrivers: Array<{ disconnect?: () => Promise<void> }> = [];

afterEach(async () => {
    // Kernels first, drivers second: the kernel's own teardown still wants a
    // live driver to drain against.
    while (openKernels.length) {
        try { await openKernels.pop()?.shutdown(); } catch { /* already stopped */ }
    }
    while (openDrivers.length) {
        try { await openDrivers.pop()?.disconnect?.(); } catch { /* noop */ }
    }
});

async function bootMessagingKernel() {
    const kernel = new ObjectKernel({ logger: { level: 'silent' } } as any);
    openKernels.push(kernel);

    await kernel.use(new ObjectQLPlugin());
    await kernel.use(
        new MessagingServicePlugin({ dispatchIntervalMs: DISPATCH_INTERVAL_MS, partitionCount: PARTITIONS }),
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

    return {
        engine: kernel.getService<IDataEngine>('data'),
        messaging: kernel.getService<MessagingService>('messaging'),
    };
}

async function statusOf(engine: IDataEngine, id: string): Promise<unknown> {
    const found = await engine.findOne(DELIVERY_OBJECT, { where: { id }, fields: ['status'] });
    return found?.status;
}

describe('#17610 MessagingServicePlugin — emit() wakes the backed-off dispatcher', () => {
    it('sends an emitted notification at once, while a row nobody announced stays pending', async () => {
        const { engine, messaging } = await bootMessagingKernel();
        const sent: string[] = [];
        messaging.registerChannel({
            id: 'probe',
            async send(_ctx, delivery) {
                sent.push(delivery.recipient);
                return { ok: true };
            },
        });

        // NEGATIVE CONTROL — a ready `pending` row written straight into the
        // outbox table, the way a process with no dispatcher of its own would.
        const now = new Date();
        await engine.insert(DELIVERY_OBJECT, {
            id: 'dlv_unannounced',
            notification_id: 'evt_unannounced',
            recipient_id: 'user_quiet',
            channel: 'probe',
            payload: { title: 'quiet' },
            partition_key: hashPartition('evt_unannounced', PARTITIONS),
            status: 'pending',
            attempts: 0,
            created_at: now,
            updated_at: now,
        });
        await sleep(CONTROL_WAIT_MS);
        expect(await statusOf(engine, 'dlv_unannounced')).toBe('pending');
        expect(sent).toEqual([]);

        // The ingress: emit() enqueues and wakes. The woken tick drains the whole
        // partition, so the unannounced row goes out with it.
        const result = await messaging.emit({
            topic: 'wake.probe',
            audience: ['user_loud'],
            channels: ['probe'],
            payload: { title: 'loud' },
        });
        expect(result.enqueued).toBe(1);

        await until(() => sent.length === 2, DELIVERY_BUDGET_MS);
        expect([...sent].sort()).toEqual(['user_loud', 'user_quiet']);
        expect(await statusOf(engine, 'dlv_unannounced')).toBe('success');
    }, 20_000);
});
