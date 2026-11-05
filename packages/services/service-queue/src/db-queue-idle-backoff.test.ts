// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #17612 scope item 3 — what an IDLE `DbQueueAdapter` costs `sys_job_queue`,
 * and that cutting it keeps every delivery guarantee.
 *
 * ## The measurement this pins
 *
 * `start()` ran a flat 1 s `setInterval`, so a registered-but-idle queue issued
 * one candidate SELECT a second — 3600 an hour, per queue, forever, whatever
 * was in the table. On a remote driver every one of those is an HTTP round
 * trip. Items 1/2 of this card made each of those reads cheap (an indexed,
 * `LIMIT`-bounded scan with no full sort); what was left was their COUNT, which
 * is the subject #17610 fixed on the messaging side. `start()` now runs the one
 * `DispatchLoop` (`@objectstack/core`), so the same idle hour is 124 reads.
 *
 * ## Why the flat-poll leg is FIRST, and not decoration
 *
 * An upper bound on statements is satisfied by a worker that has stopped
 * ticking altogether — the exact failure this change could introduce and the
 * one a low number cannot distinguish. So the harness is proved against the
 * shape it replaced: with the backoff disabled the very same clock, engine and
 * counter read 3600, which is what makes the 124 below a reading about the
 * BACKOFF rather than about a dead loop. Every remaining leg then shows the
 * same adapter still claiming, still draining and still waking.
 *
 * Every leg runs on vitest's fake timers, so "when did a tick happen" is an
 * exact reading rather than a sleep-and-hope.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/objectql';
import { DEFAULT_MAX_IDLE_INTERVAL_MS } from '@objectstack/core';
import { DbQueueAdapter } from './db-queue-adapter.js';

const QUEUE_TABLE = 'sys_job_queue';
const BASE = 1000;
const HOUR = 60 * 60 * 1000;

type Row = Record<string, any>;

/**
 * Counting in-memory engine. Same `where:`-based find and `(table, {id,...})`
 * update signature as the doubles in `db-queue-adapter.test.ts` /
 * `job-queue-retention.test.ts`, plus a per-verb tally against
 * `sys_job_queue` — the count is taken on the engine boundary the adapter
 * really talks to, so a counted call is a statement production really issues.
 */
function makeCountingEngine() {
    const tables = new Map<string, Row[]>();
    const calls = { find: 0, insert: 0, update: 0, delete: 0 };
    function compare(cell: any, v: any): boolean {
        if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
            for (const [op, target] of Object.entries(v)) {
                switch (op) {
                    case '$lte': if (cell == null || !(String(cell) <= String(target))) return false; break;
                    case '$lt': if (cell == null || !(String(cell) < String(target))) return false; break;
                    case '$ne': if (cell === target) return false; break;
                    case '$in': if (!(target as unknown[]).includes(cell)) return false; break;
                    default: throw new Error(`fake driver: unsupported operator ${op}`);
                }
            }
            return true;
        }
        if (v === null) return cell == null;
        return cell === v;
    }
    function matches(row: Row, where: Record<string, any>): boolean {
        for (const [k, v] of Object.entries(where)) {
            if (k === '$or') {
                if (!(v as Array<Record<string, any>>).some((leg) => matches(row, leg))) return false;
                continue;
            }
            if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
            if (!compare(row[k], v)) return false;
        }
        return true;
    }
    return {
        tables,
        calls,
        async find(table: string, opts: any = {}) {
            if (table === QUEUE_TABLE) calls.find++;
            const t = tables.get(table) ?? [];
            let out = opts.where ? t.filter((r) => matches(r, opts.where)) : [...t];
            if (opts.orderBy) {
                for (const ord of [...opts.orderBy].reverse()) {
                    out.sort((a, b) => {
                        const av = a[ord.field], bv = b[ord.field];
                        if (av === bv) return 0;
                        const cmp = av > bv ? 1 : -1;
                        return ord.order === 'desc' ? -cmp : cmp;
                    });
                }
            }
            // [#9540] Apply the caller's bound by PRESENCE, not truthiness: a
            // `limit: 0` is a real bound meaning "no rows", and `if (opts.limit)`
            // would hand back the whole table for it — a double LOOSER than the
            // engine, on the one axis this suite counts.
            if (typeof opts?.offset === 'number') out = out.slice(opts.offset);
            if (typeof opts?.limit === 'number') out = out.slice(0, opts.limit);
            return out;
        },
        async insert(table: string, data: Row) {
            if (table === QUEUE_TABLE) calls.insert++;
            const t = tables.get(table) ?? [];
            t.push({ ...data });
            tables.set(table, t);
            return { id: data.id };
        },
        async update(table: string, patch: Row, options?: any) {
            // [#5480] Opened with ObjectQL.update's OWN dispatch predicate, for
            // the same reason `delete` below is: a predicate update rewrites
            // every matching row, so a double looser than the engine here hides
            // exactly the writes it was introduced to observe.
            const dispatch = assertEngineUpdateDispatch(patch, options);
            if (table === QUEUE_TABLE) calls.update++;
            // [#30228] A predicate write rewrites the rows its `where` matches
            // and reports how many — the compare-and-set the lease reclaim and
            // renewal ride on, which a by-id double would turn unconditional.
            if (dispatch.kind === 'multi') {
                const hit = (tables.get(table) ?? []).filter((x) => matches(x, options?.where ?? {}));
                for (const x of hit) Object.assign(x, patch);
                return hit.length;
            }
            const r = (tables.get(table) ?? []).find((x) => x.id === patch.id);
            if (!r) throw new Error(`row ${patch.id} not found in ${table}`);
            Object.assign(r, patch);
            return r;
        },
        async delete(table: string, opts: any) {
            // [#4550] Opened with ObjectQL.delete's OWN dispatch predicate rather
            // than a hand-mirrored `if`: a double looser than the engine it stands
            // in for is how #4434 shipped a dead REST route with its suite green.
            if (table === QUEUE_TABLE) calls.delete++;
            const dispatch = assertEngineDeleteDispatch(opts);
            const t = tables.get(table) ?? [];
            if (dispatch.kind === 'multi') {
                const keep = t.filter((r) => !matches(r, opts?.where ?? {}));
                tables.set(table, keep);
                return t.length - keep.length;
            }
            tables.set(table, t.filter((r) => r.id !== dispatch.id));
            return { id: dispatch.id };
        },
    };
}

function adapterOn(
    engine: ReturnType<typeof makeCountingEngine>,
    options: Record<string, unknown> = {},
): DbQueueAdapter {
    return new DbQueueAdapter({
        engine: engine as any,
        options: { pollIntervalMs: BASE, autoStart: false, ...options },
    });
}

afterEach(() => { vi.useRealTimers(); });

describe('#17612 DbQueueAdapter — idle poll cost', () => {
    it('NEGATIVE CONTROL: with the backoff disabled the same harness reads a flat 3600 an idle hour', async () => {
        vi.useFakeTimers();
        const engine = makeCountingEngine();
        // A ceiling at or below the base interval is the documented "no backoff"
        // setting — i.e. exactly the 1 s `setInterval` this change replaced.
        const adapter = adapterOn(engine, { maxIdleIntervalMs: BASE });
        await adapter.subscribe('q1', async () => {});
        adapter.start();
        await vi.advanceTimersByTimeAsync(HOUR);
        await adapter.stop();

        // 3600 s / 1 s, plus the tick `start()` runs immediately — and [#30228]
        // one lease-reclaim read per 30 s lease window (t = 0, 30 s, … 3600 s).
        expect(engine.calls.find).toBe(3601 + 121);
    });

    it('backs off while idle: the same hour, same queue, is 124 claim reads instead of 3600', async () => {
        vi.useFakeTimers();
        const engine = makeCountingEngine();
        const adapter = adapterOn(engine);
        await adapter.subscribe('q1', async () => {});
        adapter.start();
        await vi.advanceTimersByTimeAsync(HOUR);
        await adapter.stop();

        // 1s,2s,4s,8s,16s then the 30 s ceiling — pinned exactly, because a
        // bound alone is met by a loop that stopped. [#30228] Plus the
        // lease-reclaim read, at most once per 30 s lease window: on the first
        // tick and on every ceiling tick (the ramp ticks at 2, 6 and 14 s fall
        // inside the first window), 124 - 3 = 121 of them.
        expect(engine.calls.find).toBe(124 + 121);
        // Nothing was claimed, so nothing was written.
        expect(engine.calls.update).toBe(0);
    });

    it('costs exactly one read per registered queue per tick, plus one lease read per lease window', async () => {
        for (const n of [1, 3]) {
            const engine = makeCountingEngine();
            const adapter = adapterOn(engine);
            for (let i = 0; i < n; i++) await adapter.subscribe(`q${i}`, async () => {});
            expect(await adapter.pollOnce()).toBe(0);
            // [#30228] One reclaim read answers every queue at once…
            expect(engine.calls.find).toBe(n + 1);
            // …and a tick inside the same lease window skips it.
            expect(await adapter.pollOnce()).toBe(0);
            expect(engine.calls.find).toBe(2 * n + 1);
        }
    });

    it('VACUITY TRAP: the same backed-off adapter still drains work it is given', async () => {
        vi.useFakeTimers();
        const engine = makeCountingEngine();
        const adapter = adapterOn(engine);
        const seen: unknown[] = [];
        await adapter.subscribe('q1', async (msg: any) => { seen.push(msg.data); });
        adapter.start();
        // Idle long enough to be deep in the backoff.
        await vi.advanceTimersByTimeAsync(5 * 60_000);
        expect(seen).toEqual([]);

        await adapter.publish('q1', { n: 1 });
        await vi.advanceTimersByTimeAsync(BASE);
        await adapter.stop();

        expect(seen).toEqual([{ n: 1 }]);
        const [row] = engine.tables.get(QUEUE_TABLE) ?? [];
        expect(row?.status).toBe('completed');
    });

    it('a due publish WAKES the loop — latency stays at the base interval, not the 30 s ceiling', async () => {
        vi.useFakeTimers();
        const engine = makeCountingEngine();
        const adapter = adapterOn(engine);
        const at: number[] = [];
        await adapter.subscribe('q1', async () => { at.push(Date.now()); });
        adapter.start();
        await vi.advanceTimersByTimeAsync(5 * 60_000);

        const publishedAt = Date.now();
        await adapter.publish('q1', { n: 1 });
        // Run only the microtask/immediate work the wake schedules: far less
        // than one backed-off interval, so a loop that merely waited fails here.
        await vi.advanceTimersByTimeAsync(1);
        await adapter.stop();

        expect(at).toHaveLength(1);
        expect(at[0]! - publishedAt).toBeLessThan(DEFAULT_MAX_IDLE_INTERVAL_MS);
        expect(at[0]! - publishedAt).toBeLessThanOrEqual(BASE);
    });

    it('a DEFERRED publish does not wake the loop — the backoff is kept for a tick that would claim nothing', async () => {
        vi.useFakeTimers();
        const engine = makeCountingEngine();
        const adapter = adapterOn(engine);
        await adapter.subscribe('q1', async () => {});
        adapter.start();
        await vi.advanceTimersByTimeAsync(5 * 60_000);
        const findsWhileIdle = engine.calls.find;

        // Due in ten minutes: the loop's own contract already covers noticing it
        // within one backed-off interval of it coming due.
        await adapter.publish('q1', { n: 1 }, { delay: 10 * 60_000 });
        await vi.advanceTimersByTimeAsync(1);
        await adapter.stop();

        expect(engine.calls.find).toBe(findsWhileIdle);
    });

    it('replay() wakes the loop — a re-armed dead letter is not left to the ceiling', async () => {
        vi.useFakeTimers();
        const engine = makeCountingEngine();
        const adapter = adapterOn(engine);
        await adapter.subscribe('q1', async () => { throw new Error('boom'); });
        const id = await adapter.publish('q1', { n: 1 }, { maxAttempts: 1 });
        // Drain it into the dead-letter surface without the loop running.
        await adapter.pollOnce();
        expect((engine.tables.get(QUEUE_TABLE) ?? [])[0]?.status).toBe('dlq');

        adapter.start();
        await vi.advanceTimersByTimeAsync(5 * 60_000);
        const findsWhileIdle = engine.calls.find;

        await adapter.replay(id);
        await vi.advanceTimersByTimeAsync(1);
        await adapter.stop();

        expect(engine.calls.find).toBeGreaterThan(findsWhileIdle);
    });

    it('stop() is final: no tick survives it, and a later wake() is a no-op', async () => {
        vi.useFakeTimers();
        const engine = makeCountingEngine();
        const adapter = adapterOn(engine);
        await adapter.subscribe('q1', async () => {});
        adapter.start();
        await vi.advanceTimersByTimeAsync(10 * BASE);
        await adapter.stop();
        const findsAtStop = engine.calls.find;

        adapter.wake();
        await vi.advanceTimersByTimeAsync(HOUR);

        expect(engine.calls.find).toBe(findsAtStop);
    });
});

/**
 * [#30228] A worker that dies mid-handler — a crash, an OOM kill, a redeploy —
 * leaves its row `running`. `leaseMs` documents that another worker reclaims
 * it once the lease runs out; before #30228 nothing did, and the row sat
 * `running` forever: never retried, never dead-lettered.
 *
 * The CRASHED-WORKER FIXTURE is that row written straight into the table: the
 * state a dead process leaves behind, with no adapter alive to have written
 * it. Measured before the fix (this file's legs run against
 * `origin/main`'s adapter): the fixture stays `running` with `attempts: 0`
 * through an hour of ticks and its handler never runs.
 *
 * The risk the fix itself introduces is the opposite one — reclaiming a row
 * whose handler is still running, and running it twice. The live-handler legs
 * pin that against a handler that runs three leases long.
 */
describe('#30228 DbQueueAdapter — a running row whose lease ran out is reclaimed', () => {
    const LEASE = 3_000;

    function crashedRow(over: Row = {}): Row {
        const nowMs = Date.now();
        return {
            id: 'msg_crashed',
            queue: 'q1',
            payload_json: JSON.stringify({ n: 1 }),
            status: 'running',
            priority: 100,
            attempts: 0,
            max_attempts: 3,
            backoff_type: 'exponential',
            backoff_delay_ms: 1000,
            backoff_max_delay_ms: null,
            scheduled_for: new Date(nowMs - 60_000).toISOString(),
            locked_by: 'worker_dead',
            locked_until: new Date(nowMs - 1).toISOString(),
            created_at: new Date(nowMs - 60_000).toISOString(),
            ...over,
        };
    }

    it('CRASHED-WORKER FIXTURE: an expired lease goes back to the retry path with the lost run counted, then runs', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(1_000_000);
        const engine = makeCountingEngine();
        engine.tables.set(QUEUE_TABLE, [crashedRow()]);
        const adapter = adapterOn(engine, { leaseMs: LEASE });
        const seen: Array<{ data: unknown; attempts: number }> = [];
        await adapter.subscribe('q1', async (msg: any) => { seen.push({ data: msg.data, attempts: msg.attempts }); });

        // One tick reclaims it — and reports the row as moved, so the loop does
        // not back off over work it just made claimable.
        expect(await adapter.pollOnce()).toBe(1);
        const [row] = engine.tables.get(QUEUE_TABLE) ?? [];
        expect(row).toMatchObject({
            status: 'pending',
            attempts: 1,
            locked_by: null,
            locked_until: null,
            // exponential, base 1 s, attempt 1 → 1 s
            scheduled_for: new Date(1_000_000 + 1000).toISOString(),
        });
        expect(row!.last_error).toMatch(/^lease expired: worker worker_dead /);
        expect(seen).toEqual([]);

        // On its backoff the ordinary claim path runs it, as attempt 2.
        vi.setSystemTime(1_000_000 + 1000);
        expect(await adapter.pollOnce()).toBe(1);
        expect(seen).toEqual([{ data: { n: 1 }, attempts: 2 }]);
        expect(row).toMatchObject({ status: 'completed', attempts: 2 });
    });

    it('a lease that runs out while the loop is deep in its idle backoff is reclaimed within one idle tick', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
        const engine = makeCountingEngine();
        const adapter = adapterOn(engine, { leaseMs: LEASE });
        const at: number[] = [];
        await adapter.subscribe('q1', async () => { at.push(Date.now()); });
        adapter.start();
        await vi.advanceTimersByTimeAsync(5 * 60_000);

        // Another node claimed a row and died: its lease runs out 10 s from now,
        // and nothing tells this process about it.
        const expiresAt = Date.now() + 10_000;
        engine.tables.set(QUEUE_TABLE, [crashedRow({ locked_until: new Date(expiresAt).toISOString() })]);
        await vi.advanceTimersByTimeAsync(10_000 + DEFAULT_MAX_IDLE_INTERVAL_MS + 2 * BASE);
        await adapter.stop();

        const [row] = engine.tables.get(QUEUE_TABLE) ?? [];
        expect(row).toMatchObject({ status: 'completed', attempts: 2 });
        // Reclaimed on the first tick after expiry (≤ one 30 s idle interval),
        // then claimed on the base interval the reclaim snapped the loop to.
        expect(at).toHaveLength(1);
        expect(at[0]! - expiresAt).toBeLessThanOrEqual(DEFAULT_MAX_IDLE_INTERVAL_MS + 2 * BASE);
    });

    it('the lost run counts: a row whose last attempt died with its worker is dead-lettered, not retried forever', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(1_000_000);
        const engine = makeCountingEngine();
        engine.tables.set(QUEUE_TABLE, [crashedRow({ attempts: 2, max_attempts: 3 })]);
        const adapter = adapterOn(engine, { leaseMs: LEASE });
        let ran = 0;
        await adapter.subscribe('q1', async () => { ran++; });

        expect(await adapter.pollOnce()).toBe(1);
        const [row] = engine.tables.get(QUEUE_TABLE) ?? [];
        expect(row).toMatchObject({ status: 'dlq', attempts: 3, locked_by: null, locked_until: null });
        expect(row!.last_error).toMatch(/^lease expired: /);
        expect(await adapter.listFailed('q1')).toHaveLength(1);
        await adapter.pollOnce();
        expect(ran).toBe(0);
    });

    it('a row INSIDE its lease is never reclaimed', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(1_000_000);
        const engine = makeCountingEngine();
        const live = crashedRow({ locked_by: 'worker_live', locked_until: new Date(1_000_000 + 10_000).toISOString() });
        engine.tables.set(QUEUE_TABLE, [{ ...live }]);
        const adapter = adapterOn(engine, { leaseMs: LEASE });
        let ran = 0;
        await adapter.subscribe('q1', async () => { ran++; });

        expect(await adapter.pollOnce()).toBe(0);
        expect((engine.tables.get(QUEUE_TABLE) ?? [])[0]).toEqual(live);
        expect(ran).toBe(0);
        expect(engine.calls.update).toBe(0);
    });

    it('the reclaim is a compare-and-set: a lease renewed between its read and its write keeps its run', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(1_000_000);
        const engine = makeCountingEngine();
        engine.tables.set(QUEUE_TABLE, [crashedRow({ locked_by: 'worker_slow' })]);
        // The holder renews right after the reclaim read saw the lease expired.
        const find = engine.find.bind(engine);
        engine.find = async (table: string, opts: any = {}) => {
            // Copies, as a driver hands out: the read is a snapshot, so the
            // renewal below changes the table and not what the reclaim saw.
            const out = (await find(table, opts)).map((r) => ({ ...r }));
            if (opts?.where?.status === 'running') {
                const [held] = engine.tables.get(QUEUE_TABLE) ?? [];
                held!.locked_until = new Date(1_000_000 + LEASE).toISOString();
            }
            return out;
        };
        const adapter = adapterOn(engine, { leaseMs: LEASE });
        await adapter.subscribe('q1', async () => {});

        expect(await adapter.pollOnce()).toBe(0);
        expect((engine.tables.get(QUEUE_TABLE) ?? [])[0]).toMatchObject({
            status: 'running', locked_by: 'worker_slow', attempts: 0,
        });
    });

    it('a LIVE handler three leases long is never double-claimed: its worker renews the lease while it runs', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
        const engine = makeCountingEngine();
        const runs: string[] = [];
        const slow = (who: string) => async () => {
            runs.push(who);
            await new Promise((r) => setTimeout(r, 3 * LEASE));
        };
        const a = adapterOn(engine, { leaseMs: LEASE, workerId: 'worker_a' });
        const b = adapterOn(engine, { leaseMs: LEASE, workerId: 'worker_b' });
        await a.subscribe('q1', slow('a'));
        await b.subscribe('q1', slow('b'));
        await a.publish('q1', { n: 1 });
        a.start();
        // A is inside the handler before B starts polling the same table.
        await vi.advanceTimersByTimeAsync(10);
        expect(runs).toEqual(['a']);
        b.start();

        // Past A's run and past any second run a reclaim would have started, so
        // `stop()` — which waits out an in-flight tick — has nothing left to wait for.
        await vi.advanceTimersByTimeAsync(7 * LEASE + 5 * BASE);
        await a.stop();
        await b.stop();

        expect(runs).toEqual(['a']);
        expect((engine.tables.get(QUEUE_TABLE) ?? [])[0]).toMatchObject({ status: 'completed', attempts: 1 });
    });
});
