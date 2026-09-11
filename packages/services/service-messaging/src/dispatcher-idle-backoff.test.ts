// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #17610 — the `NotificationDispatcher` loop backs off while the outbox is
 * idle, and new work wakes it.
 *
 * The loop used to tick every `intervalMs` (500 ms) forever, whatever it found.
 * Now each tick that claims nothing doubles the delay to the next one, capped at
 * `maxIdleIntervalMs`; a tick that claims work snaps it back to `intervalMs`;
 * and `wake()` — called by `MessagingService` whenever `emit()` enqueues
 * deliveries — ticks at once.
 *
 * Every leg runs on vitest's fake timers, so "when did a tick start" is an
 * exact reading rather than a sleep-and-hope. A tick is timestamped at its
 * `reap()`, which the dispatcher issues exactly once, first, per tick.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MemoryNotificationOutbox } from './memory-outbox.js';
import { NotificationDispatcher } from './dispatcher.js';
import { MessagingService } from './messaging-service.js';
import type { MessagingChannel } from './channel.js';
import type { EnqueueDeliveryInput, ReapOptions } from './outbox.js';

const BASE = 500;
const CAP = 30_000;
const MINUTE = 60_000;

const silentLogger = { info() {}, warn() {}, error() {} };

/** A memory outbox that records the (fake) instant every tick starts. */
class TickRecordingOutbox extends MemoryNotificationOutbox {
    readonly tickStarts: number[] = [];
    override async reap(opts: ReapOptions): Promise<void> {
        this.tickStarts.push(Date.now());
        return super.reap(opts);
    }
}

function row(recipientId: string): EnqueueDeliveryInput {
    return { notificationId: `n_${recipientId}`, recipientId, channel: 'inbox', payload: { title: 'hi' } };
}

function gaps(ts: readonly number[]): number[] {
    return ts.slice(1).map((t, i) => t - ts[i]);
}

/** Resolves the next time `recipient` is sent to. */
interface SendProbe {
    readonly sent: string[];
    sentTo(recipient: string): Promise<void>;
    channel: MessagingChannel;
}

function sendProbe(hold?: { recipient: string; until: Promise<void> }): SendProbe {
    const sent: string[] = [];
    const waiters = new Map<string, () => void>();
    return {
        sent,
        sentTo(recipient) {
            if (sent.includes(recipient)) return Promise.resolve();
            return new Promise<void>((resolve) => waiters.set(recipient, resolve));
        },
        channel: {
            id: 'inbox',
            async send(_ctx, delivery) {
                sent.push(delivery.recipient);
                waiters.get(delivery.recipient)?.();
                if (hold && delivery.recipient === hold.recipient) await hold.until;
                return { ok: true };
            },
        },
    };
}

function setup(options: { maxIdleIntervalMs?: number; probe?: SendProbe } = {}) {
    const outbox = new TickRecordingOutbox(1);
    const probe = options.probe ?? sendProbe();
    const dispatcher = new NotificationDispatcher({
        nodeId: 'node-test',
        outbox,
        channels: { getChannel: (id) => (id === probe.channel.id ? probe.channel : undefined) },
        channelContext: { logger: silentLogger },
        partitionCount: 1,
        intervalMs: BASE,
        maxIdleIntervalMs: options.maxIdleIntervalMs,
    });
    return { outbox, probe, dispatcher };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('#17610 NotificationDispatcher — idle backoff', () => {
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

    it('defaults the ceiling to 30 s', async () => {
        const { outbox, dispatcher } = setup();
        dispatcher.start();
        await vi.advanceTimersByTimeAsync(5 * MINUTE);
        await dispatcher.stop();
        expect(Math.max(...gaps(outbox.tickStarts))).toBe(30_000);
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
        await outbox.enqueue(row('u1'));
        await vi.advanceTimersByTimeAsync(CAP + BASE);
        await dispatcher.stop();

        expect(probe.sent).toEqual(['u1']);
        const claimedAt = outbox.tickStarts.findIndex((t) => t >= enqueuedAt);
        // The latency bound #17610 trades for the idle savings: one ceiling.
        expect(outbox.tickStarts[claimedAt] - enqueuedAt).toBeLessThanOrEqual(CAP);
        // …and work found means the very next tick is back on the base interval.
        expect(outbox.tickStarts[claimedAt + 1] - outbox.tickStarts[claimedAt]).toBe(BASE);
    });
});

describe('#17610 NotificationDispatcher — wake()', () => {
    it('ticks immediately, not at the next backed-off slot, and restarts from intervalMs', async () => {
        const { outbox, probe, dispatcher } = setup({ maxIdleIntervalMs: CAP });
        dispatcher.start();
        // 5 min 10 s: between two backed-off ticks, the next one 20 s away.
        await vi.advanceTimersByTimeAsync(5 * MINUTE + 10_000);
        const ticksBefore = outbox.tickStarts.length;

        await outbox.enqueue(row('u1'));
        dispatcher.wake();
        // No timer time passes here — only the woken tick's own promise chain.
        await probe.sentTo('u1');
        expect(outbox.tickStarts).toHaveLength(ticksBefore + 1);
        expect(outbox.tickStarts[outbox.tickStarts.length - 1]).toBe(Date.now());

        await vi.advanceTimersByTimeAsync(BASE);
        await dispatcher.stop();
        expect(outbox.tickStarts).toHaveLength(ticksBefore + 2);
        expect(outbox.tickStarts[ticksBefore + 1] - outbox.tickStarts[ticksBefore]).toBe(BASE);
    });

    it('wakes during a running tick collapse into ONE follow-up tick, run the moment it settles', async () => {
        let release!: () => void;
        const until = new Promise<void>((resolve) => { release = resolve; });
        const probe = sendProbe({ recipient: 'u1', until });
        const { outbox, dispatcher } = setup({ maxIdleIntervalMs: CAP, probe });

        await outbox.enqueue(row('u1'));
        dispatcher.start();
        await probe.sentTo('u1'); // tick 1 is now parked inside u1's send

        // u2 lands in the partition tick 1 has already claimed past.
        await outbox.enqueue(row('u2'));
        dispatcher.wake();
        dispatcher.wake();
        dispatcher.wake();
        expect(outbox.tickStarts).toHaveLength(1); // never two ticks at once

        release();
        await probe.sentTo('u2');
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

describe('#17610 MessagingService.emit() wakes the dispatcher its outbox is wired to', () => {
    function wiredStack() {
        const outbox = new TickRecordingOutbox(1);
        const probe = sendProbe();
        const service = new MessagingService({ logger: silentLogger });
        service.registerChannel(probe.channel);
        const dispatcher = new NotificationDispatcher({
            nodeId: 'node-test',
            outbox,
            channels: service,
            channelContext: { logger: silentLogger },
            partitionCount: 1,
            intervalMs: BASE,
            maxIdleIntervalMs: CAP,
        });
        // The seam MessagingServicePlugin wires.
        service.setOutbox(outbox, { onEnqueued: () => dispatcher.wake() });
        return { outbox, probe, service, dispatcher };
    }

    it('an emit() that enqueues a delivery is sent at once by a backed-off dispatcher', async () => {
        const { outbox, probe, service, dispatcher } = wiredStack();
        dispatcher.start();
        await vi.advanceTimersByTimeAsync(5 * MINUTE + 10_000);
        const ticksBefore = outbox.tickStarts.length;

        const result = await service.emit({ topic: 'deal.won', audience: ['user_1'], payload: { title: 'Won' } });
        expect(result.enqueued).toBe(1);

        await probe.sentTo('user_1');
        expect(outbox.tickStarts).toHaveLength(ticksBefore + 1);
        expect(outbox.tickStarts[outbox.tickStarts.length - 1]).toBe(Date.now());
        await dispatcher.stop();
    });

    it('an emit() that enqueues nothing does not wake it', async () => {
        const { outbox, service, dispatcher } = wiredStack();
        dispatcher.start();
        await vi.advanceTimersByTimeAsync(5 * MINUTE + 10_000);
        const ticksBefore = outbox.tickStarts.length;

        const result = await service.emit({ topic: 'deal.won', audience: [], payload: { title: 'Won' } });
        expect(result.enqueued).toBe(0);

        await vi.advanceTimersByTimeAsync(0);
        expect(outbox.tickStarts).toHaveLength(ticksBefore);
        await dispatcher.stop();
    });
});
