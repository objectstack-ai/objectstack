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
import { assertEngineDeleteDispatch } from '@objectstack/objectql';
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
            if (opts.offset) out = out.slice(opts.offset);
            if (opts.limit) out = out.slice(0, opts.limit);
            return out;
        },
        async insert(table: string, data: Row) {
            if (table === QUEUE_TABLE) calls.insert++;
            const t = tables.get(table) ?? [];
            t.push({ ...data });
            tables.set(table, t);
            return { id: data.id };
        },
        async update(table: string, patch: Row) {
            if (table === QUEUE_TABLE) calls.update++;
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

        // 3600 s / 1 s, plus the tick `start()` runs immediately.
        expect(engine.calls.find).toBe(3601);
    });

    it('backs off while idle: the same hour, same queue, is 124 reads instead of 3600', async () => {
        vi.useFakeTimers();
        const engine = makeCountingEngine();
        const adapter = adapterOn(engine);
        await adapter.subscribe('q1', async () => {});
        adapter.start();
        await vi.advanceTimersByTimeAsync(HOUR);
        await adapter.stop();

        // 1s,2s,4s,8s,16s then the 30 s ceiling — pinned exactly, because a
        // bound alone is met by a loop that stopped.
        expect(engine.calls.find).toBe(124);
        // Nothing was claimed, so nothing was written.
        expect(engine.calls.update).toBe(0);
    });

    it('costs exactly one read per registered queue per tick', async () => {
        for (const n of [1, 3]) {
            const engine = makeCountingEngine();
            const adapter = adapterOn(engine);
            for (let i = 0; i < n; i++) await adapter.subscribe(`q${i}`, async () => {});
            expect(await adapter.pollOnce()).toBe(0);
            expect(engine.calls.find).toBe(n);
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
