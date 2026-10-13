// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The claim credential survives the column that holds it.
 *
 * A Postgres table created while the `number` arm still mapped to `real`
 * keeps its epoch-ms columns as IEEE-754 binary32 — new tables get an exact
 * numeric column, existing ones are not migrated. At today's magnitude a
 * binary32 step is 131 072 ms, so `claimed_at` stores a rounding of the
 * claim's `now` and reads back a nearby decimal that is neither. A credential
 * holding the in-memory `now` then never equals the stored value: every
 * `ack()` is refused as a lost claim, the dispatcher absorbs the refusal, the
 * row stays `in_flight` with `attempts = 0`, and each reap hands it to the
 * next claim — one more send every 131 s, forever.
 *
 * ## The double, and what it models
 *
 * {@link realColumnEngine} wraps a REAL engine (`ObjectQL` + `SqlDriver`,
 * better-sqlite3 `:memory:`) and gives the epoch-ms columns the three
 * behaviours a Postgres `real` column has, each measured on PostgreSQL 16.15
 * through `SqlDriver` + node-postgres:
 *
 *  - a written number is STORED as its binary32 rounding (`Math.fround`);
 *  - a comparand in a predicate is coerced to the column's type before it is
 *    compared — node-postgres sends parameters untyped, so `claimed_at = $1`
 *    and `claimed_at < $1` compare binary32 with binary32;
 *  - a READ hands back the shortest decimal that round-trips to the stored
 *    binary32 (`float4out`, `extra_float_digits = 1`, the default since
 *    PostgreSQL 12), parsed as a double. The fidelity leg pins three readings
 *    the live server returned.
 *
 * Every write still goes through the real engine, so the compare-and-set in
 * `ack()` is evaluated by a real conditional UPDATE, never by the double.
 *
 * ## The legs
 *
 *  - **One send, one ack** on the lossy column: the row reaches `success` and
 *    no later pass sends it again. The same leg on an exact column and on the
 *    memory store is the control — the fix must not change what already
 *    worked.
 *  - **A genuinely lost claim is still refused.** Another node reaping and
 *    re-claiming the row while the first send runs must keep the late ack
 *    out (`DELIVERY_NOT_ELIGIBLE`), on every store — the fix may not turn a
 *    real lost claim into a success.
 *  - **The stuck row heals.** A row left `in_flight` by an ack that could never
 *    land (the credential claim() handed out before this fix) is reaped,
 *    re-claimed, sent once and acked by the next passes, with no operator act.
 *
 * Refusals assert the error identity — `name` + the ADR-0112 `code` — never a
 * bare throw.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import type { IDataEngine } from '@objectstack/spec/contracts';
import { MemoryNotificationOutbox } from './memory-outbox.js';
import { MemoryHttpOutbox } from './memory-http-outbox.js';
import { SqlNotificationOutbox } from './sql-outbox.js';
import { SqlHttpOutbox } from './sql-http-outbox.js';
import { NotificationDelivery } from './objects/notification-delivery.object.js';
import { HttpDelivery } from './objects/http-delivery.object.js';
import type { ClaimedDeliveryRecord, INotificationOutbox, NotificationDeliveryRecord } from './outbox.js';
import type { HttpDelivery as HttpDeliveryRow, IHttpOutbox } from './http-outbox.js';

// ── The `real` column double ────────────────────────────────────────────────

/** The epoch-ms columns the two delivery objects declare as `number`. */
const EPOCH_MS_COLUMNS: ReadonlySet<string> = new Set([
    'claimed_at',
    'next_attempt_at',
    'next_retry_at',
    'last_attempted_at',
]);

/** What a binary32 column stores for a number written into it. */
function storeReal(value: unknown): unknown {
    return typeof value === 'number' ? Math.fround(value) : value;
}

/** What Postgres hands back for a stored binary32: the shortest round-tripping decimal. */
function readReal(value: unknown): unknown {
    if (typeof value !== 'number') return value;
    const stored = Math.fround(value);
    for (let digits = 1; digits <= 9; digits++) {
        const decimal = Number(stored.toPrecision(digits));
        if (Math.fround(decimal) === stored) return decimal;
    }
    return stored;
}

function coerceOperand(operand: unknown): unknown {
    if (typeof operand === 'number') return Math.fround(operand);
    if (Array.isArray(operand)) return operand.map(coerceOperand);
    if (operand && typeof operand === 'object') {
        return Object.fromEntries(Object.entries(operand).map(([op, v]) => [op, coerceOperand(v)]));
    }
    return operand;
}

function coerceComparands(where: unknown): unknown {
    if (Array.isArray(where)) return where.map(coerceComparands);
    if (!where || typeof where !== 'object') return where;
    return Object.fromEntries(Object.entries(where).map(([key, value]) => [
        key,
        EPOCH_MS_COLUMNS.has(key) ? coerceOperand(value) : key.startsWith('$') ? coerceComparands(value) : value,
    ]));
}

function mapEpochColumns(row: unknown, fn: (value: unknown) => unknown): unknown {
    if (!row || typeof row !== 'object') return row;
    return Object.fromEntries(Object.entries(row).map(([k, v]) => [k, EPOCH_MS_COLUMNS.has(k) ? fn(v) : v]));
}

function withComparands<Q>(query: Q): Q {
    const q = query as { where?: unknown } | undefined;
    return (q && q.where !== undefined ? { ...q, where: coerceComparands(q.where) } : query) as Q;
}

/**
 * A real engine whose epoch-ms columns behave like a Postgres `real` column —
 * see the file header. Reads and writes are forwarded to `engine`; only the
 * values crossing the column boundary are changed.
 */
function realColumnEngine(engine: ObjectQL): IDataEngine {
    return new Proxy(engine, {
        get(target, prop, receiver) {
            switch (prop) {
                case 'find':
                    return async (object: string, query: unknown, options?: unknown) => {
                        const rows = await target.find(object, withComparands(query) as any, options as any);
                        return (rows as unknown[]).map((r) => mapEpochColumns(r, readReal));
                    };
                case 'findOne':
                    return async (object: string, query: unknown, options?: unknown) =>
                        mapEpochColumns(await target.findOne(object, withComparands(query) as any, options as any), readReal);
                case 'insert':
                    return (object: string, data: unknown, options?: unknown) =>
                        target.insert(object, mapEpochColumns(data, storeReal) as any, options as any);
                case 'update':
                    return (object: string, data: unknown, options?: unknown) =>
                        target.update(object, mapEpochColumns(data, storeReal) as any, withComparands(options) as any);
                default: {
                    const value = Reflect.get(target, prop, receiver);
                    return typeof value === 'function' ? value.bind(target) : value;
                }
            }
        },
    }) as unknown as IDataEngine;
}

// ── Instants ────────────────────────────────────────────────────────────────

const TTL = 60_000;
/** One binary32 step at today's epoch-ms magnitude (2^40 ≤ t < 2^41 → 2^17 ms). */
const STEP = 131_072;
/** The first claim: 2026-10-12T13:00:12.345Z — not a binary32 value. */
const T0 = 1_791_810_012_345;
/**
 * A later claim instant past the visibility timeout by more than one binary32
 * step. On a `real` column the reap compares binary32 with binary32, so it
 * fires once `now - claimTtlMs` reaches the next step — up to one step late.
 */
const T_REAPED = T0 + TTL + 2 * STEP;
/** The k-th dispatcher pass after T0, each one reap window past the last. */
const passAt = (k: number) => T0 + k * (TTL + 2 * STEP);

async function sqliteEngine(...objects: unknown[]): Promise<ObjectQL> {
    const engine = new ObjectQL();
    engine.registerDriver(new SqlDriver({
        client: 'better-sqlite3',
        connection: { filename: ':memory:' },
        useNullAsDefault: true,
    }), true);
    await engine.init();
    for (const object of objects) engine.registry.registerObject(object as any, '@objectstack/service-messaging');
    await engine.syncSchemas();
    return engine;
}

/** How each store reads back a claim instant it was handed. */
type ColumnModel = 'real' | 'exact';
const readBack = (model: ColumnModel, now: number) => (model === 'real' ? readReal(now) as number : now);

interface Store<O> {
    readonly name: string;
    readonly column: ColumnModel;
    create(): Promise<O>;
    destroy(): Promise<void>;
}

function sqlStore<O>(name: string, column: ColumnModel, object: unknown, build: (engine: IDataEngine) => O): Store<O> {
    let engine: ObjectQL | undefined;
    return {
        name,
        column,
        async create() {
            engine = await sqliteEngine(object);
            return build(column === 'real' ? realColumnEngine(engine) : engine as unknown as IDataEngine);
        },
        async destroy() {
            try { await engine?.destroy(); } catch { /* noop */ }
            engine = undefined;
        },
    };
}

describe('the real-column double reproduces the live Postgres readings', () => {
    it('stores binary32, reads back the shortest decimal (PostgreSQL 16.15, extra_float_digits = 1)', () => {
        // Measured: written through SqlDriver into a `real` column, read back
        // through it. Neither reading is the written value, nor its fround.
        expect(readReal(storeReal(1_791_810_012_345))).toBe(1_791_810_100_000);
        expect(readReal(storeReal(1_791_813_456_789))).toBe(1_791_813_500_000);
        expect(readReal(storeReal(1_791_857_407_123))).toBe(1_791_857_400_000);
        // So the legs below exercise a lossy column, not an exact one.
        expect(readBack('real', T0)).not.toBe(T0);
        expect(Math.fround(T0)).not.toBe(T0);
    });
});

// ── SqlNotificationOutbox ───────────────────────────────────────────────────

const NOTIFY_REFUSAL = { name: 'NotificationAckError', code: 'DELIVERY_NOT_ELIGIBLE' };

const notificationStores: Store<INotificationOutbox>[] = [
    sqlStore('SqlNotificationOutbox on a real column', 'real', NotificationDelivery,
        (engine) => new SqlNotificationOutbox(engine, { partitionCount: 1 })),
    sqlStore('SqlNotificationOutbox on an exact column (control)', 'exact', NotificationDelivery,
        (engine) => new SqlNotificationOutbox(engine, { partitionCount: 1 })),
    {
        name: 'MemoryNotificationOutbox (control)',
        column: 'exact',
        async create() { return new MemoryNotificationOutbox(1); },
        async destroy() { /* nothing to tear down */ },
    },
];

function notifyClaim(nodeId: string, now: number) {
    return { nodeId, limit: 10, claimTtlMs: TTL, now };
}

/** One state line a human can diff: status, holder, claim instant, attempts. */
function notifyFingerprint(r: NotificationDeliveryRecord): string {
    return `${r.status}:${r.claimedBy ?? '-'}:${r.claimedAt ?? '-'}:${r.attempts}`;
}

/**
 * One dispatcher pass, the shape `NotificationDispatcher.runTick` runs: the
 * reap, a claim, a send per claimed row, its ack — with the dispatcher's
 * tolerance of a refused ack (`DELIVERY_NOT_ELIGIBLE` is absorbed, the row
 * left to the next reap). Returns the ids it sent.
 */
async function notifyPass(outbox: INotificationOutbox, nodeId: string, now: number): Promise<string[]> {
    await outbox.reap?.({ claimTtlMs: TTL, now });
    const claimed = await outbox.claim({ ...notifyClaim(nodeId, now), skipReap: true });
    for (const row of claimed) {
        try {
            await outbox.ack(row, { success: true });
        } catch (err) {
            if ((err as { code?: string }).code !== 'DELIVERY_NOT_ELIGIBLE') throw err;
        }
    }
    return claimed.map((r) => r.id);
}

describe.each(notificationStores)('$name — the claim credential round-trips the column', (store) => {
    let outbox: INotificationOutbox;

    beforeEach(async () => { outbox = await store.create(); });
    afterEach(async () => { await store.destroy(); });

    function enqueueOne(): Promise<string> {
        return outbox.enqueue({ notificationId: 'n1', recipientId: 'u1', channel: 'inbox', payload: { title: 'hello' } });
    }

    async function readRow(id: string): Promise<NotificationDeliveryRecord> {
        const row = (await outbox.list()).find((r) => r.id === id);
        if (!row) throw new Error(`row '${id}' vanished — the harness, not the contract, is broken`);
        return row;
    }

    it('one send, one ack: the row reaches success, and no later pass sends it again', async () => {
        const id = await enqueueOne();

        const claimed = await outbox.claim(notifyClaim('node-a', T0));
        expect(claimed.map((r) => r.id)).toEqual([id]);
        const stored = (await readRow(id)).claimedAt;

        await expect(outbox.ack(claimed[0], { success: true, durationMs: 5 })).resolves.toBeUndefined();
        expect(notifyFingerprint(await readRow(id))).toBe('success:-:-:1');
        // The credential that landed is the claim instant AS THE STORE HOLDS
        // IT — what a read of the cell returned — never the `now` written.
        expect(claimed[0].claimedAt).toBe(stored);
        expect(claimed[0].claimedAt).toBe(readBack(store.column, T0));

        // The loop is closed: passes over three later reap windows send nothing.
        const sent = [
            ...await notifyPass(outbox, 'node-a', passAt(1)),
            ...await notifyPass(outbox, 'node-a', passAt(2)),
            ...await notifyPass(outbox, 'node-a', passAt(3)),
        ];
        expect(sent).toEqual([]);
        expect(notifyFingerprint(await readRow(id))).toBe('success:-:-:1');
    });

    it('a claim lost to another node still refuses the late ack, and the holder\'s ack lands', async () => {
        const id = await enqueueOne();

        // node A claims and starts a send that outruns the visibility timeout;
        // node B's claim reaps the row and re-claims it.
        const [claimA] = await outbox.claim(notifyClaim('node-a', T0));
        const [claimB] = await outbox.claim(notifyClaim('node-b', T_REAPED));
        expect([claimA?.id, claimB?.id]).toEqual([id, id]);

        // A's late ack is refused by identity and writes nothing.
        await expect(outbox.ack(claimA, { success: true, durationMs: TTL + 5 })).rejects.toMatchObject(NOTIFY_REFUSAL);
        expect(notifyFingerprint(await readRow(id))).toBe(`in_flight:node-b:${readBack(store.column, T_REAPED)}:0`);

        // B's ack — the live attempt A would have overwritten — lands.
        await expect(outbox.ack(claimB, { success: true, durationMs: 3 })).resolves.toBeUndefined();
        expect(notifyFingerprint(await readRow(id))).toBe('success:-:-:1');
        expect(claimB.claimedAt).toBe(readBack(store.column, T_REAPED));
    });

    // The stuck state exists only where the old credential failed: the lossy column.
    if (store.column === 'real') it('a row stuck in_flight behind an ack that could never land is sent once more, acked, and left alone', async () => {
        const id = await enqueueOne();

        // The production state: claim() stored the row in_flight, and the ack
        // carried the in-memory `now` as its credential — what claim() handed
        // out before the credential was read back. That ack can never land.
        const [stale] = await outbox.claim(notifyClaim('node-old', T0));
        const preFixCredential: ClaimedDeliveryRecord = { ...stale, claimedAt: T0 };
        await expect(outbox.ack(preFixCredential, { success: true })).rejects.toMatchObject(NOTIFY_REFUSAL);
        expect(notifyFingerprint(await readRow(id))).toBe(`in_flight:node-old:${readBack('real', T0)}:0`);

        // The dispatcher's passes from here on, with no operator act: the reap
        // returns the row, the next claim takes it, the send's ack lands — and
        // every pass after that finds nothing.
        const sent: string[] = [];
        for (let k = 1; k <= 5; k++) sent.push(...await notifyPass(outbox, 'node-a', passAt(k)));
        expect(sent).toEqual([id]);
        expect(notifyFingerprint(await readRow(id))).toBe('success:-:-:1');
    });
});

// ── SqlHttpOutbox ───────────────────────────────────────────────────────────

const HTTP_REFUSAL = { name: 'HttpAckError', code: 'DELIVERY_NOT_ELIGIBLE' };
const HTTP_OK = { success: true as const, httpStatus: 200, durationMs: 4 };

const httpStores: Store<IHttpOutbox>[] = [
    sqlStore('SqlHttpOutbox on a real column', 'real', HttpDelivery,
        (engine) => new SqlHttpOutbox(engine, { partitionCount: 1 })),
    sqlStore('SqlHttpOutbox on an exact column (control)', 'exact', HttpDelivery,
        (engine) => new SqlHttpOutbox(engine, { partitionCount: 1 })),
    {
        name: 'MemoryHttpOutbox (control)',
        column: 'exact',
        async create() { return new MemoryHttpOutbox(); },
        async destroy() { /* nothing to tear down */ },
    },
];

function httpClaim(nodeId: string, now: number) {
    return { nodeId, limit: 10, claimTtlMs: TTL, now };
}

function httpFingerprint(r: HttpDeliveryRow): string {
    return `${r.status}:${r.claimedBy ?? '-'}:${r.claimedAt ?? '-'}:${r.attempts}`;
}

/** The `HttpDispatcher` pass — same shape as {@link notifyPass}. */
async function httpPass(outbox: IHttpOutbox, nodeId: string, now: number): Promise<string[]> {
    await outbox.reap?.({ claimTtlMs: TTL, now });
    const claimed = await outbox.claim({ ...httpClaim(nodeId, now), skipReap: true });
    for (const row of claimed) {
        try {
            await outbox.ack(row.id, HTTP_OK, row as { claimedBy: string; claimedAt: number });
        } catch (err) {
            if ((err as { code?: string }).code !== 'DELIVERY_NOT_ELIGIBLE') throw err;
        }
    }
    return claimed.map((r) => r.id);
}

describe.each(httpStores)('$name — the claim credential round-trips the column', (store) => {
    let outbox: IHttpOutbox;

    beforeEach(async () => { outbox = await store.create(); });
    afterEach(async () => { await store.destroy(); });

    function enqueueOne(): Promise<string> {
        return outbox.enqueue({ source: 'flow', refId: 'r1', dedupKey: 'd_r1', url: 'https://receiver.example/r1', payload: { n: 1 } });
    }

    async function readRow(id: string): Promise<HttpDeliveryRow> {
        const row = (await outbox.list()).find((r) => r.id === id);
        if (!row) throw new Error(`row '${id}' vanished — the harness, not the contract, is broken`);
        return row;
    }

    function credentialOf(row: HttpDeliveryRow) {
        return { claimedBy: row.claimedBy as string, claimedAt: row.claimedAt as number };
    }

    it('one send, one ack: the row reaches success, and no later pass sends it again', async () => {
        const id = await enqueueOne();

        const claimed = await outbox.claim(httpClaim('node-a', T0));
        expect(claimed.map((r) => r.id)).toEqual([id]);
        const stored = (await readRow(id)).claimedAt;

        await expect(outbox.ack(id, HTTP_OK, credentialOf(claimed[0]))).resolves.toBeUndefined();
        expect(httpFingerprint(await readRow(id))).toBe('success:-:-:1');
        expect(claimed[0].claimedAt).toBe(stored);
        expect(claimed[0].claimedAt).toBe(readBack(store.column, T0));

        const sent = [
            ...await httpPass(outbox, 'node-a', passAt(1)),
            ...await httpPass(outbox, 'node-a', passAt(2)),
            ...await httpPass(outbox, 'node-a', passAt(3)),
        ];
        expect(sent).toEqual([]);
        expect(httpFingerprint(await readRow(id))).toBe('success:-:-:1');
    });

    it('a claim lost to another node still refuses the late ack, and the holder\'s ack lands', async () => {
        const id = await enqueueOne();

        const [claimA] = await outbox.claim(httpClaim('node-a', T0));
        const [claimB] = await outbox.claim(httpClaim('node-b', T_REAPED));
        expect([claimA?.id, claimB?.id]).toEqual([id, id]);

        await expect(outbox.ack(id, HTTP_OK, credentialOf(claimA))).rejects.toMatchObject(HTTP_REFUSAL);
        expect(httpFingerprint(await readRow(id))).toBe(`in_flight:node-b:${readBack(store.column, T_REAPED)}:0`);

        await expect(outbox.ack(id, HTTP_OK, credentialOf(claimB))).resolves.toBeUndefined();
        expect(httpFingerprint(await readRow(id))).toBe('success:-:-:1');
        expect(claimB.claimedAt).toBe(readBack(store.column, T_REAPED));
    });

    if (store.column === 'real') it('a row stuck in_flight behind an ack that could never land is sent once more, acked, and left alone', async () => {
        const id = await enqueueOne();

        const [stale] = await outbox.claim(httpClaim('node-old', T0));
        await expect(outbox.ack(id, HTTP_OK, { claimedBy: stale.claimedBy as string, claimedAt: T0 }))
            .rejects.toMatchObject(HTTP_REFUSAL);
        expect(httpFingerprint(await readRow(id))).toBe(`in_flight:node-old:${readBack('real', T0)}:0`);

        const sent: string[] = [];
        for (let k = 1; k <= 5; k++) sent.push(...await httpPass(outbox, 'node-a', passAt(k)));
        expect(sent).toEqual([id]);
        expect(httpFingerprint(await readRow(id))).toBe('success:-:-:1');
    });
});
