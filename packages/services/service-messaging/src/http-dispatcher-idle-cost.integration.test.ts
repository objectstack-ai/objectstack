// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #17623, #28383 — what an IDLE `HttpDispatcher` tick costs the store, and that
 * cutting it keeps every delivery guarantee.
 *
 * ## The measurement this pins
 *
 * Before #17623 one tick over an EMPTY `sys_http_delivery` outbox issued 16
 * statements with the default 8 partitions: every partition's `claim()` opened
 * with the environment-wide visibility-timeout reap — 8 identical UPDATEs —
 * before its candidate SELECT (8). On remote Turso every statement is an HTTP
 * round trip, and the loop never stopped. #17623 ran the reap once per tick:
 * `1 + partitionCount` engine calls, which on a kernel is 10 statements — the
 * reap's predicate UPDATE is two there (the engine reads the matched rows for
 * the per-row `afterUpdate` dispatch before it writes), and it wrote with
 * nothing to reap.
 *
 * #28383 makes an idle tick TWO statements, whatever `partitionCount` is: the
 * reap reads one expired id before it writes and writes only on a hit, and one
 * "anything due?" read across every partition gates the per-partition probes.
 * `NotificationDispatcher` has the same shape (its idle-cost file).
 *
 * ## Counted where cloud counted it
 *
 * Two tallies, both pinned: engine calls on the delivery table, and SQL
 * statements on it, read off the driver's knex `query` events — the client
 * boundary cloud measured 10 at (#28383). The harness registers one global
 * no-op `afterUpdate` hook, as a kernel's audit plugin does, so a predicate
 * UPDATE is the read-then-write pair it is in production.
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
 *  - **"Write only on a hit" could be bought by never writing.** The idle pin
 *    asserts ZERO reap UPDATEs; the recovery leg asserts the UPDATE does run
 *    when a claim has expired.
 *  - **One "anything due?" read could be bought by a predicate that misses a
 *    deferred row.** A row whose retry is not yet due keeps the tick at two
 *    reads, and goes out on the first tick after it comes due.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SqlHttpOutbox } from './sql-http-outbox.js';
import { HttpDelivery, SYS_HTTP_DELIVERY } from './objects/http-delivery.object.js';
import { HttpDispatcher } from './http-dispatcher.js';
import { hashPartition } from './backoff.js';
import type { FetchImpl } from './http-sender.js';
import type { EnqueueHttpInput, HttpClaimCredential, IHttpOutbox } from './http-outbox.js';
import { installDefaultOrganization } from './default-organization.testkit.js';

/** The production default. */
const PARTITIONS = 8;
const TICKS = 10;
const TTL = 60_000;

let engine: ObjectQL;
let outbox: SqlHttpOutbox;
/** Engine calls against the delivery table, by method. */
let calls: { update: number; find: number; other: number };
/** SQL statements the driver sent against the delivery table, in order. */
let statements: string[];
/**
 * The dispatcher's injected clock — `HttpDispatcher` hands its `now` to the
 * store. Unset, it is `Date.now()`.
 */
let clock: number | undefined;
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
        now: () => clock ?? Date.now(),
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
    // A real `single` install's Default Organization: the system writes below
    // derive it (ADR-0131 D9), as a fresh NOT NULL tenant column requires (D1).
    await installDefaultOrganization(engine);
    // A kernel's audit plugin registers a global `afterUpdate`; with one
    // registered, a predicate UPDATE reads its matched rows before it writes —
    // the two-statement reap cloud counted.
    engine.registerHook('afterUpdate', async () => {});

    clock = undefined;
    statements = [];
    (driver as unknown as { knex: { on(e: 'query', cb: (q: { sql?: unknown }) => void): void } }).knex
        .on('query', (q) => {
            if (typeof q.sql === 'string' && q.sql.includes(SYS_HTTP_DELIVERY)) statements.push(q.sql);
        });
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

describe('#17623 #28383 HttpDispatcher — idle tick cost', () => {
    it('an idle tick is TWO statements: the reap\'s expired-claim read and one due-work read, no UPDATE, no partition probe', async () => {
        const d = dispatcher();
        for (let i = 0; i < TICKS; i++) await d.tick();

        // Nothing expired, so the reap reads and never writes; nothing due, so
        // no partition's candidate probe runs.
        expect(calls).toEqual({ update: 0, find: 2 * TICKS, other: 0 });
        // At the client: before #28383, 10 a tick on this harness (cloud's
        // figure); the card's bar is 6.
        expect(statements).toHaveLength(2 * TICKS);
        expect(statements.every((sql) => /^select /i.test(sql))).toBe(true);
    });

    it('a row whose retry is not yet due keeps the tick at two reads, and goes out on the first tick after it comes due', async () => {
        const d = dispatcher();
        const t0 = Date.now();
        clock = t0;
        await outbox.enqueue(delivery('r_retry'));
        // One failed attempt deferred the row a minute: claim it and ack the
        // failure with a retry time, as a dispatcher whose POST failed does.
        const [row] = await outbox.claim({ nodeId: 'node-other', limit: 10, claimTtlMs: TTL, now: t0 });
        await outbox.ack(row.id, { success: false, error: 'boom', durationMs: 1, nextRetryAt: t0 + 60_000 }, row as HttpClaimCredential);
        statements = [];

        await d.tick();
        expect(posted).toEqual([]);
        expect(statements).toHaveLength(2);

        clock = t0 + 60_001;
        await d.tick();
        expect(posted).toEqual(['https://receiver.example/r_retry']);
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

        statements = [];
        await dispatcher().tick();

        // The tick's single reap ran BEFORE its claims, so the same tick took
        // the row back and delivered it.
        expect(posted).toEqual(['https://receiver.example/r_crashed']);
        const [row] = await outbox.list();
        expect(row).toMatchObject({ status: 'success', attempts: 1 });
        // The reap's read found the expired claim, so its UPDATE ran — once.
        const reapWrites = statements.filter((sql) => /^update .* where `status` = \? and `claimed_at` < \?$/i.test(sql));
        expect(reapWrites).toHaveLength(1);
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
