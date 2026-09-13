// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #17623 — the `HttpDispatcher` loop backs off while `sys_http_delivery` is
 * idle, and new work wakes it.
 *
 * The loop used to tick every `intervalMs` (500 ms) forever, whatever it found —
 * the shape #17610 removed from `NotificationDispatcher`. Both dispatchers now
 * run the one `DispatchLoop` (`dispatch-loop.ts`), whose mechanics are pinned in
 * full through the notification side in `dispatcher-idle-backoff.test.ts`. This
 * file pins the same behaviour through `HttpDispatcher`, plus what only the HTTP
 * side has: a retry schedule the backoff must not starve, and its own ingress —
 * `MessagingService.enqueueHttp()` and `redeliverHttp()` — waking it.
 *
 * Every leg runs on vitest's fake timers, so "when did a tick start" is an
 * exact reading rather than a sleep-and-hope. With one partition the dispatcher
 * issues exactly one `claim()` per tick, so a tick is timestamped there.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MemoryHttpOutbox } from './memory-http-outbox.js';
import { HttpDispatcher } from './http-dispatcher.js';
import { DEFAULT_MAX_IDLE_INTERVAL_MS } from './dispatcher.js';
import { MessagingService } from './messaging-service.js';
import type { FetchImpl } from './http-sender.js';
import type { EnqueueHttpInput, HttpAckResult, HttpClaimCredential, HttpClaimOptions, HttpDelivery } from './http-outbox.js';

const BASE = 500;
const CAP = 30_000;
const MINUTE = 60_000;

const silentLogger = { info() {}, warn() {}, error() {} };

/** A memory outbox that records the (fake) instant every tick starts, and every retry it is told to schedule. */
class TickRecordingOutbox extends MemoryHttpOutbox {
    readonly tickStarts: number[] = [];
    readonly retriesDueAt: number[] = [];
    override async claim(opts: HttpClaimOptions): Promise<HttpDelivery[]> {
        this.tickStarts.push(Date.now());
        return super.claim(opts);
    }
    override async ack(id: string, result: HttpAckResult, claimed?: HttpClaimCredential): Promise<void> {
        if (!result.success && result.nextRetryAt !== undefined) this.retriesDueAt.push(result.nextRetryAt);
        // [#17634] Forward the claim credential, so the dispatcher's acks keep their ownership check.
        return super.ack(id, result, claimed);
    }
}

function delivery(refId: string, over: Partial<EnqueueHttpInput> = {}): EnqueueHttpInput {
    return { source: 'flow', refId, dedupKey: `d_${refId}`, url: urlOf(refId), payload: { refId }, ...over };
}

function urlOf(refId: string): string {
    return `https://receiver.example/${refId}`;
}

function gaps(ts: readonly number[]): number[] {
    return ts.slice(1).map((t, i) => t - ts[i]);
}

function last(ts: readonly number[]): number {
    return ts[ts.length - 1];
}

/** A 200-answering fetch that records every POST; `posts(n)` resolves once n have gone out. */
interface FetchProbe {
    readonly posted: string[];
    posts(n: number): Promise<void>;
    impl: FetchImpl;
}

function fetchProbe(hold?: { url: string; until: Promise<void> }): FetchProbe {
    const posted: string[] = [];
    let waiters: Array<{ n: number; resolve: () => void }> = [];
    return {
        posted,
        posts(n) {
            if (posted.length >= n) return Promise.resolve();
            return new Promise<void>((resolve) => waiters.push({ n, resolve }));
        },
        impl: async (url) => {
            posted.push(url);
            waiters = waiters.filter((w) => (posted.length >= w.n ? (w.resolve(), false) : true));
            if (hold && url === hold.url) await hold.until;
            return { ok: true, status: 200, async text() { return 'ok'; } };
        },
    };
}

function setup(options: { maxIdleIntervalMs?: number; probe?: FetchProbe } = {}) {
    const outbox = new TickRecordingOutbox();
    const probe = options.probe ?? fetchProbe();
    const dispatcher = new HttpDispatcher({
        nodeId: 'node-test',
        outbox,
        fetchImpl: probe.impl,
        partitionCount: 1,
        intervalMs: BASE,
        maxIdleIntervalMs: options.maxIdleIntervalMs,
    });
    return { outbox, probe, dispatcher };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('#17623 HttpDispatcher — idle backoff', () => {
    it('doubles the interval on every empty tick, up to maxIdleIntervalMs', async () => {
        const { outbox, dispatcher } = setup({ maxIdleIntervalMs: CAP });
        dispatcher.start();
        await vi.advanceTimersByTimeAsync(10 * MINUTE);
        await dispatcher.stop();

        const g = gaps(outbox.tickStarts);
        expect(g.slice(0, 6)).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, CAP]);
        expect(g.slice(5).every((gap) => gap === CAP)).toBe(true);
        // Ten idle minutes: 24 ticks, where the fixed 500 ms loop ran 1,201.
        expect(outbox.tickStarts).toHaveLength(24);
    });

    it('defaults the ceiling to 30 s — the notification dispatcher’s default', async () => {
        const { outbox, dispatcher } = setup();
        dispatcher.start();
        await vi.advanceTimersByTimeAsync(5 * MINUTE);
        await dispatcher.stop();
        expect(DEFAULT_MAX_IDLE_INTERVAL_MS).toBe(30_000);
        expect(Math.max(...gaps(outbox.tickStarts))).toBe(DEFAULT_MAX_IDLE_INTERVAL_MS);
    });

    it('a ceiling at or below intervalMs disables the backoff', async () => {
        const { outbox, dispatcher } = setup({ maxIdleIntervalMs: BASE });
        dispatcher.start();
        await vi.advanceTimersByTimeAsync(5_000);
        await dispatcher.stop();
        expect(outbox.tickStarts).toHaveLength(11);
        expect(new Set(gaps(outbox.tickStarts))).toEqual(new Set([BASE]));
    });

    it('a row nobody announced waits at most one backed-off interval, and the tick that claims it resets the backoff', async () => {
        const { outbox, probe, dispatcher } = setup({ maxIdleIntervalMs: CAP });
        dispatcher.start();
        await vi.advanceTimersByTimeAsync(5 * MINUTE); // fully backed off

        // Written without a wake() — as a row enqueued by another process is.
        const enqueuedAt = Date.now();
        await outbox.enqueue(delivery('r1'));
        await vi.advanceTimersByTimeAsync(CAP + BASE);
        await dispatcher.stop();

        expect(probe.posted).toEqual([urlOf('r1')]);
        const claimedAt = outbox.tickStarts.findIndex((t) => t >= enqueuedAt);
        // The latency bound #17623 trades for the idle savings: one ceiling.
        expect(outbox.tickStarts[claimedAt] - enqueuedAt).toBeLessThanOrEqual(CAP);
        // …and work found means the very next tick is back on the base interval.
        expect(outbox.tickStarts[claimedAt + 1] - outbox.tickStarts[claimedAt]).toBe(BASE);
    });

    it('a retry coming due while backed off is attempted less than min(its delay + intervalMs, maxIdleIntervalMs) late', async () => {
        const outbox = new TickRecordingOutbox();
        const attemptedAt: number[] = [];
        const statuses = [500, 500, 500, 200];
        const fetchImpl: FetchImpl = async () => {
            const status = statuses[Math.min(attemptedAt.length, statuses.length - 1)];
            attemptedAt.push(Date.now());
            return { ok: status < 400, status, async text() { return ''; } };
        };
        const dispatcher = new HttpDispatcher({
            nodeId: 'node-test', outbox, fetchImpl, partitionCount: 1, intervalMs: BASE, maxIdleIntervalMs: CAP,
            rng: () => 0.5, // no jitter: the retry delays are exactly 1 s, 10 s, 60 s
        });
        await outbox.enqueue(delivery('r1'));
        dispatcher.start();
        await vi.advanceTimersByTimeAsync(3 * MINUTE);
        await dispatcher.stop();

        expect(attemptedAt).toHaveLength(4);
        expect(outbox.retriesDueAt).toHaveLength(3);
        for (let i = 0; i < 3; i++) {
            const delay = outbox.retriesDueAt[i] - attemptedAt[i];
            const late = attemptedAt[i + 1] - outbox.retriesDueAt[i];
            expect(late).toBeGreaterThanOrEqual(0); // never before it is due
            expect(late).toBeLessThan(Math.min(delay + BASE, CAP));
        }
        expect((await outbox.list())[0]).toMatchObject({ status: 'success', attempts: 4 });
    });
});

describe('#17623 HttpDispatcher — wake()', () => {
    it('ticks immediately, not at the next backed-off slot, and restarts from intervalMs', async () => {
        const { outbox, probe, dispatcher } = setup({ maxIdleIntervalMs: CAP });
        dispatcher.start();
        // 5 min 10 s: between two backed-off ticks, the next one 20 s away.
        await vi.advanceTimersByTimeAsync(5 * MINUTE + 10_000);
        const ticksBefore = outbox.tickStarts.length;

        await outbox.enqueue(delivery('r1'));
        dispatcher.wake();
        // No timer time passes here — only the woken tick's own promise chain.
        await probe.posts(1);
        expect(outbox.tickStarts).toHaveLength(ticksBefore + 1);
        expect(last(outbox.tickStarts)).toBe(Date.now());

        await vi.advanceTimersByTimeAsync(BASE);
        await dispatcher.stop();
        expect(outbox.tickStarts).toHaveLength(ticksBefore + 2);
        expect(outbox.tickStarts[ticksBefore + 1] - outbox.tickStarts[ticksBefore]).toBe(BASE);
    });

    it('wakes during a running tick collapse into ONE follow-up tick, run the moment it settles', async () => {
        let release!: () => void;
        const until = new Promise<void>((resolve) => { release = resolve; });
        const probe = fetchProbe({ url: urlOf('r1'), until });
        const { outbox, dispatcher } = setup({ maxIdleIntervalMs: CAP, probe });

        await outbox.enqueue(delivery('r1'));
        dispatcher.start();
        await probe.posts(1); // tick 1 is now parked inside r1's POST

        // r2 lands after tick 1 has already claimed its batch.
        await outbox.enqueue(delivery('r2'));
        dispatcher.wake();
        dispatcher.wake();
        dispatcher.wake();
        expect(outbox.tickStarts).toHaveLength(1); // never two ticks at once

        release();
        await probe.posts(2);
        // Exactly one follow-up, at the same instant tick 1 settled.
        expect(outbox.tickStarts).toHaveLength(2);
        expect(outbox.tickStarts[1]).toBe(outbox.tickStarts[0]);

        // Three wakes did not queue three ticks: the next one is a base interval out.
        await vi.advanceTimersByTimeAsync(BASE - 1);
        expect(outbox.tickStarts).toHaveLength(2);
        await dispatcher.stop();
    });

    it('stop() cancels the pending backed-off tick, and a wake() after stop is a no-op', async () => {
        const { outbox, dispatcher } = setup({ maxIdleIntervalMs: CAP });
        dispatcher.start();
        await vi.advanceTimersByTimeAsync(MINUTE);
        await dispatcher.stop();
        const ticksAtStop = outbox.tickStarts.length;

        dispatcher.wake();
        await vi.advanceTimersByTimeAsync(10 * MINUTE);
        expect(outbox.tickStarts).toHaveLength(ticksAtStop);
    });
});

describe('#17623 MessagingService wakes the HTTP dispatcher its outbox is wired to', () => {
    function wiredStack() {
        const outbox = new TickRecordingOutbox();
        const probe = fetchProbe();
        const service = new MessagingService({ logger: silentLogger });
        const dispatcher = new HttpDispatcher({
            nodeId: 'node-test',
            outbox,
            fetchImpl: probe.impl,
            partitionCount: 1,
            intervalMs: BASE,
            maxIdleIntervalMs: CAP,
        });
        // The seam MessagingServicePlugin wires.
        service.setHttpOutbox(outbox, { onEnqueued: () => dispatcher.wake() });
        return { outbox, probe, service, dispatcher };
    }

    it('an enqueueHttp() delivery is POSTed at once by a backed-off dispatcher', async () => {
        const { outbox, probe, service, dispatcher } = wiredStack();
        dispatcher.start();
        await vi.advanceTimersByTimeAsync(5 * MINUTE + 10_000);
        const ticksBefore = outbox.tickStarts.length;

        await service.enqueueHttp(delivery('r1'));

        await probe.posts(1);
        expect(probe.posted).toEqual([urlOf('r1')]);
        expect(outbox.tickStarts).toHaveLength(ticksBefore + 1);
        expect(last(outbox.tickStarts)).toBe(Date.now());
        await dispatcher.stop();
    });

    it('an enqueueHttp() that PARKS an undeliverable row does not wake it — there is nothing to send', async () => {
        const { outbox, service, dispatcher } = wiredStack();
        dispatcher.start();
        await vi.advanceTimersByTimeAsync(5 * MINUTE + 10_000);
        const ticksBefore = outbox.tickStarts.length;

        await service.enqueueHttp(delivery('r1', { undeliverableReason: 'signing secret could not be resolved' }));

        await vi.advanceTimersByTimeAsync(0);
        expect(outbox.tickStarts).toHaveLength(ticksBefore);
        expect((await outbox.list())[0]).toMatchObject({ status: 'dead', attempts: 0 });
        await dispatcher.stop();
    });

    it('a redeliverHttp() puts the row back to pending and wakes the dispatcher to re-send it', async () => {
        const { outbox, probe, service, dispatcher } = wiredStack();
        dispatcher.start();
        const id = await service.enqueueHttp(delivery('r1'));
        await probe.posts(1);
        await vi.advanceTimersByTimeAsync(5 * MINUTE + 10_000);
        expect((await outbox.list())[0]).toMatchObject({ status: 'success', attempts: 1 });
        const ticksBefore = outbox.tickStarts.length;

        await service.redeliverHttp(id, { tenantId: undefined });

        await probe.posts(2);
        expect(probe.posted).toEqual([urlOf('r1'), urlOf('r1')]);
        expect(outbox.tickStarts).toHaveLength(ticksBefore + 1);
        expect(last(outbox.tickStarts)).toBe(Date.now());
        await dispatcher.stop();
    });
});
