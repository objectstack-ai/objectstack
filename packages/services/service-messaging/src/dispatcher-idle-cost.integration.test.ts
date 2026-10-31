// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #17610, #28383 — what an IDLE `NotificationDispatcher` tick costs the store,
 * and that cutting it keeps every delivery guarantee.
 *
 * ## The measurement this pins
 *
 * Before #17610 one tick over an EMPTY outbox issued 32 statements with the
 * default 8 partitions: `claim()` and `claimDigest()` each opened with the
 * environment-wide visibility-timeout reap, in every partition — 16 identical
 * UPDATEs — plus one candidate SELECT each (16). On remote Turso every
 * statement is an HTTP round trip, and the loop never stopped. #17610 ran the
 * reap once per tick: `1 + 2 × partitionCount` engine calls, which on a kernel
 * is 18 statements — the reap's predicate UPDATE is two there, because the
 * engine reads the matched rows for the per-row `afterUpdate` dispatch before
 * it writes, and it wrote with nothing to reap.
 *
 * #28383 makes an idle tick TWO statements, whatever `partitionCount` is: the
 * reap reads one expired id before it writes and writes only on a hit, and one
 * "anything due?" read across every partition gates the per-partition claim
 * and digest probes.
 *
 * ## Counted where cloud counted it
 *
 * Two tallies, both pinned: engine calls on the delivery table, and SQL
 * statements on it, read off the driver's knex `query` events — the client
 * boundary cloud measured 18 at (#28383). The harness registers one global
 * no-op `afterUpdate` hook, as a kernel's audit plugin does, so a predicate
 * UPDATE is the read-then-write pair it is in production; on this harness the
 * pre-#28383 code measured 18 statements a tick, cloud's figure.
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
 *  - **"Write only on a hit" could be bought by never writing.** The idle pin
 *    asserts ZERO reap UPDATEs; the recovery leg asserts the UPDATE does run
 *    when a claim has expired.
 *  - **One "anything due?" read could be bought by a predicate that misses a
 *    kind of row.** A due digest-only outbox, and a deferred row that comes
 *    due, are each driven through it: both are found when due, and a row
 *    deferred into the future keeps the tick at two reads.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SqlNotificationOutbox, DELIVERY_OBJECT } from './sql-outbox.js';
import { NotificationDelivery } from './objects/notification-delivery.object.js';
import { NotificationDispatcher } from './dispatcher.js';
import type { MessagingChannel } from './channel.js';
import type { INotificationOutbox } from './outbox.js';
import { installDefaultOrganization } from './default-organization.testkit.js';

/** The production default. */
const PARTITIONS = 8;
const TICKS = 10;
const TTL = 60_000;

let engine: ObjectQL;
let outbox: SqlNotificationOutbox;
/** Engine calls against the delivery table, by method. */
let calls: { update: number; find: number; other: number };
/** SQL statements the driver sent against the delivery table, in order. */
let statements: string[];
/** `recipient` of every send, in order. */
let sent: string[];

const recordingInbox: MessagingChannel = {
    id: 'inbox',
    async send(_ctx, delivery) {
        sent.push(delivery.recipient);
        return { ok: true };
    },
};

function dispatcher(store: INotificationOutbox = outbox): NotificationDispatcher {
    return new NotificationDispatcher({
        nodeId: 'node-live',
        outbox: store,
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
    // A real `single` install's Default Organization: the system writes below
    // derive it (ADR-0131 D9), as a fresh NOT NULL tenant column requires (D1).
    await installDefaultOrganization(engine);
    // A kernel's audit plugin registers a global `afterUpdate`; with one
    // registered, a predicate UPDATE reads its matched rows before it writes —
    // the two-statement reap cloud counted.
    engine.registerHook('afterUpdate', async () => {});

    statements = [];
    (driver as unknown as { knex: { on(e: 'query', cb: (q: { sql?: unknown }) => void): void } }).knex
        .on('query', (q) => {
            if (typeof q.sql === 'string' && q.sql.includes(DELIVERY_OBJECT)) statements.push(q.sql);
        });
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

describe('#17610 #28383 NotificationDispatcher — idle tick cost', () => {
    it('an idle tick is TWO statements: the reap\'s expired-claim read and one due-work read, no UPDATE, no partition probe', async () => {
        const d = dispatcher();
        for (let i = 0; i < TICKS; i++) await d.tick();

        // Nothing expired, so the reap reads and never writes; nothing due, so
        // no partition's claim or digest probe runs.
        expect(calls).toEqual({ update: 0, find: 2 * TICKS, other: 0 });
        // At the client: before #28383, 18 a tick on this harness (cloud's
        // figure); the card's bar is 6.
        expect(statements).toHaveLength(2 * TICKS);
        expect(statements.every((sql) => /^select /i.test(sql))).toBe(true);
    });

    it('a row deferred into the future keeps the tick at two reads, and goes out on the first tick after it comes due', async () => {
        const d = dispatcher();
        const enqueuedAt = Date.now();
        // A retry's backoff, quiet hours and a digest window all defer a row
        // through `next_attempt_at`.
        await outbox.enqueue({
            notificationId: 'n_later', recipientId: 'u_later', channel: 'inbox', payload: { title: 't' },
            notBefore: enqueuedAt + 60_000,
        });
        statements = [];
        await d.tick();
        expect(sent).toEqual([]);
        expect(statements).toHaveLength(2);

        // The store reads `Date.now()` for the due-work read and the claim alike.
        const clock = vi.spyOn(Date, 'now').mockReturnValue(enqueuedAt + 60_001);
        try {
            await d.tick();
        } finally {
            clock.mockRestore();
        }
        expect(sent).toEqual(['u_later']);
    });

    it('a due digest-only outbox is found by the one due-work read and collapsed on that tick', async () => {
        const d = dispatcher();
        for (const notificationId of ['nd1', 'nd2', 'nd3']) {
            await outbox.enqueue({
                notificationId, recipientId: 'u_digest', channel: 'inbox', payload: { title: notificationId },
                digestKey: 'u_digest|inbox|w1',
            });
        }

        await d.tick();

        expect(sent).toEqual(['u_digest']);
        const rows = await outbox.list();
        expect(rows.every((r) => r.status === 'success')).toBe(true);
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

        calls = { update: 0, find: 0, other: 0 };
        statements = [];
        await dispatcher().tick();

        // The tick's single reap ran BEFORE its claims, so the same tick took
        // the row back and delivered it.
        expect(sent).toEqual(['u1']);
        const [row] = await outbox.list();
        expect(row).toMatchObject({ status: 'success', attempts: 1 });
        // The reap's read found the expired claim, so its UPDATE ran — once.
        const reapWrites = statements.filter((sql) => /^update .* where `status` = \? and `claimed_at` < \?$/i.test(sql));
        expect(reapWrites).toHaveLength(1);
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

    it('an outbox without reap() keeps working: its claims keep reaping, and an expired claim is still recovered', async () => {
        // The shape of a store written before `reap()` existed: the same SQL
        // store underneath, with that one method not exposed.
        const skipReapSeen: unknown[] = [];
        const legacy: INotificationOutbox = {
            enqueue: (input) => outbox.enqueue(input),
            claim: (opts) => { skipReapSeen.push(opts.skipReap); return outbox.claim(opts); },
            claimDigest: (opts) => { skipReapSeen.push(opts.skipReap); return outbox.claimDigest(opts); },
            ack: (claimed, result) => outbox.ack(claimed, result),
            list: (filter) => outbox.list(filter),
        };
        await outbox.enqueue({ notificationId: 'n_legacy', recipientId: 'u1', channel: 'inbox', payload: { title: 't' } });
        await outbox.claim({ nodeId: 'node-crashed', limit: 10, claimTtlMs: TTL, now: Date.now() - TTL - 1 });

        await dispatcher(legacy).tick();

        // No claim was told to skip the reap it is now the only source of…
        expect(skipReapSeen).toHaveLength(2 * PARTITIONS);
        expect(skipReapSeen.every((skip) => skip !== true)).toBe(true);
        // …so the expired claim is still recovered and delivered in the same tick.
        expect(sent).toEqual(['u1']);
    });
});
