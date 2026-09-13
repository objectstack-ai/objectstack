// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #17623 — what an IDLE `HttpDispatcher` tick costs the store, and that cutting
 * it keeps every delivery guarantee.
 *
 * ## The measurement this pins
 *
 * Before #17623 one tick over an EMPTY `sys_http_delivery` outbox issued 16
 * statements with the default 8 partitions: every partition's `claim()` opened
 * with the environment-wide visibility-timeout reap — 8 identical UPDATEs —
 * before its candidate SELECT (8). On remote Turso every statement is an HTTP
 * round trip, and the loop never stopped. The reap now runs once per tick, so
 * an idle tick is `1 + partitionCount` = 9. It is the shape #17610 removed from
 * `NotificationDispatcher`, which pays one more probe per partition for its
 * digest pass.
 *
 * ## Why a real engine
 *
 * The count is taken on the `IDataEngine` the outbox talks to — the boundary
 * this package controls — over a real `ObjectQL` + `SqlDriver` (better-sqlite3
 * `:memory:`), so every counted call is a statement the production outbox
 * really issues. On this harness one engine call is one SQL statement.
 *
 * ## The vacuity traps closed here
 *
 *  - **An upper bound alone is satisfied by a dispatcher that does nothing.**
 *    The reap count is pinned EXACTLY — once per tick, because zero would
 *    strand a crashed node's rows forever — and the legs below prove the very
 *    same harness claims, POSTs and recovers.
 *  - **"Reap once" could be bought by recovering less.** The recovery leg drives
 *    a real expired claim through ONE tick; its negative leg proves a claim
 *    that has not expired is left alone, so the TTL is still a floor.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SqlHttpOutbox } from './sql-http-outbox.js';
import { HttpDelivery, SYS_HTTP_DELIVERY } from './objects/http-delivery.object.js';
import { HttpDispatcher } from './http-dispatcher.js';
import { hashPartition } from './backoff.js';
import type { FetchImpl } from './http-sender.js';
import type { EnqueueHttpInput, IHttpOutbox } from './http-outbox.js';

/** The production default. */
const PARTITIONS = 8;
const TICKS = 10;
const TTL = 60_000;

let engine: ObjectQL;
let outbox: SqlHttpOutbox;
/** Engine calls against the delivery table, by method. */
let calls: { update: number; find: number; other: number };
/** URL of every POST, in order. */
let posted: string[];

const recordingFetch: FetchImpl = async (url) => {
    posted.push(url);
    return { ok: true, status: 200, async text() { return 'ok'; } };
};

function dispatcher(store: IHttpOutbox = outbox): HttpDispatcher {
    return new HttpDispatcher({
        nodeId: 'node-live',
        outbox: store,
        fetchImpl: recordingFetch,
        partitionCount: PARTITIONS,
        claimTtlMs: TTL,
        intervalMs: 10_000, // ticks are driven manually
    });
}

function delivery(refId: string): EnqueueHttpInput {
    return { source: 'flow', refId, dedupKey: `d_${refId}`, url: `https://receiver.example/${refId}`, payload: { refId } };
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
    engine.registry.registerObject(HttpDelivery as any, '@objectstack/service-messaging');
    await engine.syncSchemas();

    calls = { update: 0, find: 0, other: 0 };
    posted = [];
    // Count on the engine instance the outbox holds, so the tally is of real
    // outbox traffic rather than a stand-in's.
    type EngineCall = (name: string, ...rest: unknown[]) => unknown;
    const e = engine as unknown as Record<string, EngineCall>;
    for (const method of ['find', 'findOne', 'update', 'insert', 'delete', 'count', 'resolveInternalField'] as const) {
        if (typeof e[method] !== 'function') continue;
        const orig = e[method].bind(engine);
        e[method] = (name: string, ...rest: unknown[]) => {
            if (name === SYS_HTTP_DELIVERY) {
                if (method === 'update') calls.update++;
                else if (method === 'find') calls.find++;
                else calls.other++;
            }
            return orig(name, ...rest);
        };
    }
    outbox = new SqlHttpOutbox(engine as any, { partitionCount: PARTITIONS });
});

afterEach(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
});

describe('#17623 HttpDispatcher — idle tick cost', () => {
    it('an idle tick is 1 + partitionCount statements: ONE reap, then one candidate probe per partition', async () => {
        const d = dispatcher();
        for (let i = 0; i < TICKS; i++) await d.tick();

        // On an empty outbox the only UPDATE a tick issues is the reap. It is
        // environment-wide, so once per tick is all it can use — and exactly
        // once, never zero: it is the only crash recovery there is.
        expect(calls).toEqual({ update: TICKS, find: TICKS * PARTITIONS, other: 0 });
        // Before #17623: PARTITIONS reaps + PARTITIONS probes = 16 a tick.
        expect(calls.update + calls.find + calls.other).toBeLessThanOrEqual(TICKS * (1 + PARTITIONS));
    });

    it('rows enqueued after an idle stretch go out on the very next tick, in every partition', async () => {
        const d = dispatcher();
        for (let i = 0; i < TICKS; i++) await d.tick();
        expect(posted).toEqual([]);

        // Enough distinct anchors that they hash across several of the 8
        // partitions: the next tick must drain all of them, wherever they landed.
        const refIds = Array.from({ length: 16 }, (_, i) => `r${i}`);
        for (const refId of refIds) await outbox.enqueue(delivery(refId));
        expect(new Set(refIds.map((r) => hashPartition(r, PARTITIONS))).size).toBeGreaterThan(1);

        await d.tick();

        expect([...posted].sort()).toEqual(refIds.map((r) => `https://receiver.example/${r}`).sort());
        const rows = await outbox.list();
        expect(rows).toHaveLength(16);
        expect(rows.every((r) => r.status === 'success' && r.attempts === 1)).toBe(true);
    });

    it("recovers a crashed node's expired claim and delivers it within ONE tick", async () => {
        await outbox.enqueue(delivery('r_crashed'));
        // A node claims the row and dies: its claim was stamped TTL + 1 ms ago.
        const [abandoned] = await outbox.claim({
            nodeId: 'node-crashed', limit: 10, claimTtlMs: TTL, now: Date.now() - TTL - 1,
        });
        expect(abandoned?.status).toBe('in_flight');

        await dispatcher().tick();

        // The tick's single reap ran BEFORE its claims, so the same tick took
        // the row back and delivered it.
        expect(posted).toEqual(['https://receiver.example/r_crashed']);
        const [row] = await outbox.list();
        expect(row).toMatchObject({ status: 'success', attempts: 1 });
    });

    it('leaves a claim that has NOT expired alone — the TTL is still a floor', async () => {
        await outbox.enqueue(delivery('r_live'));
        // Another node's claim, 5 s inside its visibility timeout.
        await outbox.claim({ nodeId: 'node-busy', limit: 10, claimTtlMs: TTL, now: Date.now() - TTL + 5_000 });

        await dispatcher().tick();

        expect(posted).toEqual([]);
        const [row] = await outbox.list();
        expect(row).toMatchObject({ status: 'in_flight', claimedBy: 'node-busy', attempts: 0 });
    });

    it('an outbox without reap() keeps working: its claims keep reaping, and an expired claim is still recovered', async () => {
        // The shape of a store written before `reap()` existed: the same SQL
        // store underneath, with that one method not exposed.
        const skipReapSeen: unknown[] = [];
        const legacy: IHttpOutbox = {
            enqueue: (input) => outbox.enqueue(input),
            recordUndeliverable: (input) => outbox.recordUndeliverable(input),
            claim: (opts) => { skipReapSeen.push(opts.skipReap); return outbox.claim(opts); },
            ack: (id, result) => outbox.ack(id, result),
            list: (filter) => outbox.list(filter),
            redeliver: (id, options) => outbox.redeliver(id, options),
        };
        await outbox.enqueue(delivery('r_legacy'));
        await outbox.claim({ nodeId: 'node-crashed', limit: 10, claimTtlMs: TTL, now: Date.now() - TTL - 1 });

        await dispatcher(legacy).tick();

        // No claim was told to skip the reap it is now the only source of…
        expect(skipReapSeen).toHaveLength(PARTITIONS);
        expect(skipReapSeen.every((skip) => skip !== true)).toBe(true);
        // …so the expired claim is still recovered and delivered in the same tick.
        expect(posted).toEqual(['https://receiver.example/r_legacy']);
    });
});
