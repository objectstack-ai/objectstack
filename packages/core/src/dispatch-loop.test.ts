// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #29919 — `DispatchLoop` wakes at the next due time, and a sole writer's loop
 * does not re-run the idle ramp after a cold start.
 *
 * Before #29919 every `start()` re-ran the backoff's ramp from `intervalMs`
 * against stores that were empty: with the dispatchers' 500 ms base, six ticks
 * in a fresh loop's first minute (0, 1, 3, 7, 15, 31 s), every one idle, while the only thing the ramp ever bought — early
 * notice of a row another process wrote — cannot happen on a sole writer. And
 * a deferred row was noticed only at the next backed-off tick, up to the
 * ceiling late.
 *
 * Every leg runs on vitest's fake timers, so "when did a tick start" is an
 * exact reading rather than a sleep-and-hope.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { DispatchLoop, type DispatchLoopOptions } from './dispatch-loop.js';

const BASE = 500;
const MINUTE = 60_000;
const FIVE_MINUTES = 5 * MINUTE;

afterEach(() => { vi.useRealTimers(); });

/** Fake timers with the clock at 0, so a tick's start reads as ms since `start()`. */
function useClockAtZero(): void {
    vi.useFakeTimers();
    vi.setSystemTime(0);
}

/**
 * A store of deferred rows: `runTick` claims every row due by the fake clock,
 * `nextDueAt` answers the earliest row still in the future. Both are recorded.
 */
function harness(options: Partial<DispatchLoopOptions> & { dueRows?: number[] } = {}) {
    const dueRows = [...(options.dueRows ?? [])];
    const tickStarts: number[] = [];
    const claimedAt: number[] = [];
    let dueReads = 0;
    const errors: unknown[] = [];
    const loop = new DispatchLoop({
        intervalMs: BASE,
        runTick: async () => {
            const now = Date.now();
            tickStarts.push(now);
            let claimed = 0;
            for (let i = dueRows.length - 1; i >= 0; i--) {
                if (dueRows[i]! <= now) {
                    dueRows.splice(i, 1);
                    claimedAt.push(now);
                    claimed++;
                }
            }
            return claimed;
        },
        nextDueAt: async () => {
            dueReads++;
            const future = dueRows.filter((t) => t > Date.now());
            return future.length > 0 ? Math.min(...future) : null;
        },
        onTickError: (err) => { errors.push(err); },
        ...options,
    });
    return {
        loop,
        tickStarts,
        claimedAt,
        errors,
        dueRows,
        get dueReads() { return dueReads; },
    };
}

describe('#29919 DispatchLoop — a sole writer does not ramp from a cold start', () => {
    it('a fresh loop on an empty store ticks ONCE in its first minute', async () => {
        useClockAtZero();
        const h = harness({ soleWriter: true, maxIdleIntervalMs: FIVE_MINUTES });
        h.loop.start();
        await vi.advanceTimersByTimeAsync(MINUTE);
        await h.loop.stop();

        expect(h.tickStarts).toEqual([0]);
        // The one tick's one due read — nothing deferred, so the ceiling.
        expect(h.dueReads).toBe(1);
    });

    it('CONTROL: the same loop without soleWriter still runs the ramp it always had', async () => {
        useClockAtZero();
        const h = harness({ maxIdleIntervalMs: FIVE_MINUTES });
        h.loop.start();
        await vi.advanceTimersByTimeAsync(MINUTE);
        await h.loop.stop();

        // 1, 2, 4, 8, 16 s apart — six ticks. The harness can see a ramp, so the
        // single tick above is a reading about soleWriter, not a dead clock.
        expect(h.tickStarts).toEqual([0, 1_000, 3_000, 7_000, 15_000, 31_000]);
    });

    it('without a nextDueAt reader, soleWriter alone sleeps straight to the ceiling', async () => {
        useClockAtZero();
        const h = harness({ soleWriter: true, maxIdleIntervalMs: 30_000, nextDueAt: undefined });
        h.loop.start();
        await vi.advanceTimersByTimeAsync(2 * MINUTE);
        await h.loop.stop();

        expect(h.tickStarts).toEqual([0, 30_000, 60_000, 90_000, 120_000]);
    });

    it('steady state costs no extra read: an idle hour at the ceiling reads the due time once', async () => {
        useClockAtZero();
        const h = harness({ soleWriter: true, maxIdleIntervalMs: 30_000 });
        h.loop.start();
        await vi.advanceTimersByTimeAsync(60 * MINUTE);
        await h.loop.stop();

        // 3600 s / 30 s, plus the tick start() runs.
        expect(h.tickStarts).toHaveLength(121);
        expect(h.dueReads).toBe(1);
    });
});

describe('#29919 DispatchLoop — wakes at the next due time', () => {
    it('a row due at T+20 s is claimed at T+20 s, under a five-minute ceiling', async () => {
        useClockAtZero();
        const h = harness({ soleWriter: true, maxIdleIntervalMs: FIVE_MINUTES, dueRows: [20_000] });
        h.loop.start();
        await vi.advanceTimersByTimeAsync(MINUTE);
        await h.loop.stop();

        expect(h.claimedAt).toEqual([20_000]);
        // The cold-start tick, the due tick, and the tick after a claim
        // (`intervalMs` later) — then nothing is deferred and the ceiling wins.
        expect(h.tickStarts).toEqual([0, 20_000, 20_500]);
    });

    it('the ramp keeps its shape, cut short only by the due time (no soleWriter)', async () => {
        useClockAtZero();
        const h = harness({ maxIdleIntervalMs: FIVE_MINUTES, dueRows: [2_000] });
        h.loop.start();
        await vi.advanceTimersByTimeAsync(4_000);
        await h.loop.stop();

        expect(h.claimedAt).toEqual([2_000]);
        expect(h.tickStarts).toEqual([0, 1_000, 2_000, 2_500, 3_500]);
    });

    it('consecutive deferred rows are each claimed on time — the read is re-asked after each due time', async () => {
        useClockAtZero();
        const h = harness({ soleWriter: true, maxIdleIntervalMs: FIVE_MINUTES, dueRows: [10_000, 40_000] });
        h.loop.start();
        await vi.advanceTimersByTimeAsync(MINUTE);
        await h.loop.stop();

        expect(h.claimedAt).toEqual([10_000, 40_000]);
    });

    it('wakeAt(): a deferred row written later in the streak is claimed on time with no read', async () => {
        useClockAtZero();
        const h = harness({ soleWriter: true, maxIdleIntervalMs: FIVE_MINUTES });
        h.loop.start();
        await vi.advanceTimersByTimeAsync(10_000);
        const readsBefore = h.dueReads;
        const ticksBefore = h.tickStarts.length;

        h.dueRows.push(35_000);
        h.loop.wakeAt(35_000);
        // No tick now: the hint only moves the timer.
        await vi.advanceTimersByTimeAsync(1);
        expect(h.tickStarts).toHaveLength(ticksBefore);

        await vi.advanceTimersByTimeAsync(MINUTE);
        await h.loop.stop();
        expect(h.claimedAt).toEqual([35_000]);
        // The hint cost no read; the read after the claim is the next streak's.
        expect(h.dueReads).toBe(readsBefore + 1);
    });

    it('wakeAt() keeps a timer that is already due sooner', async () => {
        useClockAtZero();
        const h = harness({ soleWriter: true, maxIdleIntervalMs: FIVE_MINUTES, dueRows: [20_000] });
        h.loop.start();
        await vi.advanceTimersByTimeAsync(1);
        h.dueRows.push(50_000);
        h.loop.wakeAt(50_000);
        await vi.advanceTimersByTimeAsync(MINUTE);
        await h.loop.stop();

        expect(h.claimedAt).toEqual([20_000, 50_000]);
    });
});

describe('#29919 DispatchLoop — wake() still delivers at once', () => {
    it('a wake on a sole writer sleeping towards its ceiling ticks immediately', async () => {
        useClockAtZero();
        const h = harness({ soleWriter: true, maxIdleIntervalMs: FIVE_MINUTES });
        h.loop.start();
        await vi.advanceTimersByTimeAsync(MINUTE);

        h.dueRows.push(MINUTE);
        h.loop.wake();
        await vi.advanceTimersByTimeAsync(0);
        await h.loop.stop();

        expect(h.claimedAt).toEqual([MINUTE]);
    });
});

describe('#29919 DispatchLoop — nothing it reads can make it spin', () => {
    it('a rejected tick counts as idle: a failing store is ticked once per ceiling, not hammered', async () => {
        useClockAtZero();
        const h = harness({
            soleWriter: true,
            maxIdleIntervalMs: 30_000,
            runTick: async () => { h.tickStarts.push(Date.now()); throw new Error('store down'); },
        });
        h.loop.start();
        await vi.advanceTimersByTimeAsync(MINUTE);
        await h.loop.stop();

        expect(h.tickStarts).toEqual([0, 30_000, 60_000]);
        expect(h.errors).toHaveLength(3);
        // A rejected tick asks for no due time.
        expect(h.dueReads).toBe(0);
    });

    it('a rejected tick after a due time was learned still sleeps until that due time, not 0 ms', async () => {
        useClockAtZero();
        const tickStarts: number[] = [];
        const loop = new DispatchLoop({
            intervalMs: BASE,
            maxIdleIntervalMs: FIVE_MINUTES,
            soleWriter: true,
            // The cold-start tick finds nothing; every later tick rejects.
            runTick: async () => {
                tickStarts.push(Date.now());
                if (tickStarts.length > 1) throw new Error('store down');
                return 0;
            },
            nextDueAt: async () => 20_000,
            onTickError: () => {},
        });
        loop.start();
        await vi.advanceTimersByTimeAsync(MINUTE);
        await loop.stop();

        // The due tick at 20 s rejects; the next is a ceiling away.
        expect(tickStarts).toEqual([0, 20_000]);
    });

    it('a due time at or before the tick that found nothing is not chased (visible, but not this loop\'s to claim)', async () => {
        useClockAtZero();
        const h = harness({
            soleWriter: true,
            maxIdleIntervalMs: 30_000,
            // Another node holds the row's partition: it is due, and never claimable here.
            runTick: async () => { h.tickStarts.push(Date.now()); return 0; },
            nextDueAt: async () => 0,
        });
        h.loop.start();
        await vi.advanceTimersByTimeAsync(MINUTE);
        await h.loop.stop();

        expect(h.tickStarts).toEqual([0, 30_000, 60_000]);
    });

    it('a rejected due read is reported, and the loop sleeps by its backoff alone', async () => {
        useClockAtZero();
        const h = harness({
            soleWriter: true,
            maxIdleIntervalMs: 30_000,
            nextDueAt: async () => { throw new Error('read failed'); },
        });
        h.loop.start();
        await vi.advanceTimersByTimeAsync(MINUTE);
        await h.loop.stop();

        expect(h.tickStarts).toEqual([0, 30_000, 60_000]);
        expect(h.errors).toHaveLength(3);
    });

    it('stop() is final: a wakeAt() after it is a no-op', async () => {
        useClockAtZero();
        const h = harness({ soleWriter: true, maxIdleIntervalMs: FIVE_MINUTES });
        h.loop.start();
        await vi.advanceTimersByTimeAsync(1);
        await h.loop.stop();
        h.loop.wakeAt(10_000);
        await vi.advanceTimersByTimeAsync(MINUTE);

        expect(h.tickStarts).toEqual([0]);
    });
});
