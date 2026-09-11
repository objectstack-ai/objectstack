// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #17610 — what an IDLE `NotificationDispatcher` tick costs the store, and that
 * cutting it keeps every delivery guarantee.
 *
 * ## The measurement this pins
 *
 * Before #17610 one tick over an EMPTY outbox issued 32 statements with the
 * default 8 partitions: `claim()` and `claimDigest()` each opened with the
 * environment-wide visibility-timeout reap, in every partition — 16 identical
 * UPDATEs — plus one candidate SELECT each (16). On remote Turso every
 * statement is an HTTP round trip, and the loop never stopped. The reap now
 * runs once per tick, so an idle tick is `1 + 2 × partitionCount` = 17.
 *
 * ## Why a real engine
 *
 * The count is taken on the `IDataEngine` the outbox talks to — the boundary
 * this package controls — over a real `ObjectQL` + `SqlDriver` (better-sqlite3
 * `:memory:`), so every counted call is a statement the production outbox
 * really issues. On this harness one engine call is one SQL statement (measured
 * with the driver's query events while writing this file: 32 and 32 before,
 * 17 and 17 after).
 *
 * ## The vacuity traps closed here
 *
 *  - **An upper bound alone is satisfied by a dispatcher that does nothing.**
 *    The reap count is pinned EXACTLY — once per tick, because zero would
 *    strand a crashed node's rows forever — and the legs below prove the very
 *    same harness claims, sends, collapses digests and recovers.
 *  - **"Reap once" could be bought by recovering less.** The recovery leg drives
 *    a real expired claim through ONE tick; its negative leg proves a claim
 *    that has not expired is left alone, so the TTL is still a floor.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SqlNotificationOutbox, DELIVERY_OBJECT } from './sql-outbox.js';
import { NotificationDelivery } from './objects/notification-delivery.object.js';
import { NotificationDispatcher } from './dispatcher.js';
import type { MessagingChannel } from './channel.js';

/** The production default. */
const PARTITIONS = 8;
const TICKS = 10;
const TTL = 60_000;

let engine: ObjectQL;
let outbox: SqlNotificationOutbox;
/** Engine calls against the delivery table, by method. */
let calls: { update: number; find: number; other: number };
/** `recipient` of every send, in order. */
let sent: string[];

const recordingInbox: MessagingChannel = {
    id: 'inbox',
    async send(_ctx, delivery) {
        sent.push(delivery.recipient);
        return { ok: true };
    },
};

function dispatcher(): NotificationDispatcher {
    return new NotificationDispatcher({
        nodeId: 'node-live',
        outbox,
        channels: { getChannel: (id) => (id === recordingInbox.id ? recordingInbox : undefined) },
        channelContext: { logger: { info() {}, warn() {}, error() {} } },
        partitionCount: PARTITIONS,
        claimTtlMs: TTL,
        intervalMs: 10_000, // ticks are driven manually
    });
}

beforeEach(async () => {
    const driver = new SqlDriver({
        client: 'better-sqlite3',
        connection: { filename: ':memory:' },
        useNullAsDefault: true,
    });
    engine = new ObjectQL();
    engine.registerDriver(driver, true);
    await engine.init();
    engine.registry.registerObject(NotificationDelivery as any, '@objectstack/service-messaging');
    await engine.syncSchemas();

    calls = { update: 0, find: 0, other: 0 };
    sent = [];
    // Count on the engine instance the outbox holds, so the tally is of real
    // outbox traffic rather than a stand-in's.
    type EngineCall = (name: string, ...rest: unknown[]) => unknown;
    const e = engine as unknown as Record<string, EngineCall>;
    for (const method of ['find', 'findOne', 'update', 'insert', 'delete', 'count'] as const) {
        const orig = e[method].bind(engine);
        e[method] = (name: string, ...rest: unknown[]) => {
            if (name === DELIVERY_OBJECT) {
                if (method === 'update') calls.update++;
                else if (method === 'find') calls.find++;
                else calls.other++;
            }
            return orig(name, ...rest);
        };
    }
    outbox = new SqlNotificationOutbox(engine as any, { partitionCount: PARTITIONS });
});

afterEach(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
});

describe('#17610 NotificationDispatcher — idle tick cost', () => {
    it('an idle tick is 1 + 2 × partitionCount statements: ONE reap, then a claim and a digest probe per partition', async () => {
        const d = dispatcher();
        for (let i = 0; i < TICKS; i++) await d.tick();

        // On an empty outbox the only UPDATE a tick issues is the reap. It is
        // environment-wide, so once per tick is all it can use — and exactly
        // once, never zero: it is the only crash recovery there is.
        expect(calls.update).toBe(TICKS);
        // Before #17610: 2 × PARTITIONS reaps + 2 × PARTITIONS probes = 32 a tick.
        expect(calls.update + calls.find + calls.other).toBeLessThanOrEqual(TICKS * (1 + 2 * PARTITIONS));
    });

    it('rows enqueued after an idle stretch go out on the very next tick — every partition, digests collapsed', async () => {
        const d = dispatcher();
        for (let i = 0; i < TICKS; i++) await d.tick();
        expect(sent).toEqual([]);

        // Enough distinct notifications that they hash across several of the 8
        // partitions: the next tick must drain all of them, wherever they landed.
        const recipients = Array.from({ length: 16 }, (_, i) => `u${i}`);
        for (const [i, recipientId] of recipients.entries()) {
            await outbox.enqueue({ notificationId: `n${i}`, recipientId, channel: 'inbox', payload: { title: 't' } });
        }
        // Two batched rows of ONE digest window: the digest probe must claim them
        // whole and the dispatcher must send them as one message.
        for (const notificationId of ['nd1', 'nd2']) {
            await outbox.enqueue({
                notificationId, recipientId: 'u_digest', channel: 'inbox', payload: { title: notificationId },
                digestKey: 'u_digest|inbox|w1',
            });
        }
        const partitions = new Set((await outbox.list()).map((r) => r.partitionKey));
        expect(partitions.size).toBeGreaterThan(1);

        await d.tick();

        expect([...sent].sort()).toEqual([...recipients, 'u_digest'].sort());
        const rows = await outbox.list();
        expect(rows).toHaveLength(18);
        expect(rows.every((r) => r.status === 'success' && r.attempts === 1)).toBe(true);
    });

    it("recovers a crashed node's expired claim and delivers it within ONE tick", async () => {
        await outbox.enqueue({ notificationId: 'n_crashed', recipientId: 'u1', channel: 'inbox', payload: { title: 't' } });
        // A node claims the row and dies: its claim was stamped TTL + 1 ms ago.
        const [abandoned] = await outbox.claim({
            nodeId: 'node-crashed', limit: 10, claimTtlMs: TTL, now: Date.now() - TTL - 1,
        });
        expect(abandoned?.status).toBe('in_flight');

        await dispatcher().tick();

        // The tick's single reap ran BEFORE its claims, so the same tick took
        // the row back and delivered it.
        expect(sent).toEqual(['u1']);
        const [row] = await outbox.list();
        expect(row).toMatchObject({ status: 'success', attempts: 1 });
    });

    it('leaves a claim that has NOT expired alone — the TTL is still a floor', async () => {
        await outbox.enqueue({ notificationId: 'n_live', recipientId: 'u1', channel: 'inbox', payload: { title: 't' } });
        // Another node's claim, 5 s inside its visibility timeout.
        await outbox.claim({ nodeId: 'node-busy', limit: 10, claimTtlMs: TTL, now: Date.now() - TTL + 5_000 });

        await dispatcher().tick();

        expect(sent).toEqual([]);
        const [row] = await outbox.list();
        expect(row).toMatchObject({ status: 'in_flight', claimedBy: 'node-busy', attempts: 0 });
    });
});
