// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The timer loop both outbox dispatchers run — `NotificationDispatcher` over
 * `sys_notification_delivery` and `HttpDispatcher` over `sys_http_delivery`.
 *
 * #17610 wrote this loop inside `NotificationDispatcher`. #17623 found
 * `HttpDispatcher` still on the fixed 500 ms `setInterval` the notification side
 * had just left, and moved the loop here, so the two dispatchers run one
 * implementation of these rules instead of two copies that can drift:
 *
 *  - **Never two ticks at once.** A tick asked for while one is running (a
 *    {@link DispatchLoop.wake}, typically) becomes ONE follow-up tick, run the
 *    moment the running one settles, and every request in that window collapses
 *    into it. The follow-up is not optional: the running tick may already be
 *    past the partition the new work hashed into.
 *  - **Idle backoff.** Each tick that claims nothing doubles the delay to the
 *    next, from `intervalMs` up to `maxIdleIntervalMs`; a tick that claims
 *    anything, or a wake, snaps it back to `intervalMs`. A tick that REJECTS
 *    counts as idle — a failing store is not work, and hammering it helps no
 *    one. Delays are measured from the START of the previous tick.
 *  - **`stop()` is final.** It cancels the pending timer and any follow-up
 *    request, then waits out the running tick; a `wake()` after it is a no-op.
 *    The timer is `unref()`ed, so the loop never keeps a process alive by
 *    itself.
 *
 * The price of the backoff is paid in latency by work nobody wakes the loop
 * for — a deferred row coming due, a row another process wrote, a crashed
 * node's claim passing its timeout: it is noticed within one backed-off
 * interval, never more than `maxIdleIntervalMs` after it became claimable.
 */

/** Default ceiling of the idle backoff, in ms — see {@link DispatchLoopOptions.maxIdleIntervalMs}. */
export const DEFAULT_MAX_IDLE_INTERVAL_MS = 30_000;

export interface DispatchLoopOptions {
    /** Delay between ticks while ticks claim work, in ms. */
    intervalMs: number;
    /**
     * Idle backoff ceiling in ms (default {@link DEFAULT_MAX_IDLE_INTERVAL_MS}).
     * A value at or below `intervalMs` disables the backoff.
     */
    maxIdleIntervalMs?: number;
    /** One full pass over the outbox. Resolves to the number of rows it claimed. */
    runTick: () => Promise<number>;
    /** A tick rejected. The loop has already counted it as idle; report it. */
    onTickError: (err: unknown) => void;
}

export class DispatchLoop {
    private readonly intervalMs: number;
    private readonly maxIdleIntervalMs: number;
    private readonly runTick: () => Promise<number>;
    private readonly onTickError: (err: unknown) => void;
    private timer: ReturnType<typeof setTimeout> | undefined;
    private running = false;
    private inflightTick: Promise<void> | undefined;
    /** Consecutive loop ticks that claimed nothing — the idle backoff's exponent. */
    private idleTicks = 0;
    /** A tick was asked for while one was running: run one more the moment it settles. */
    private tickRequested = false;

    constructor(options: DispatchLoopOptions) {
        this.intervalMs = options.intervalMs;
        // A ceiling below the base interval just means "no backoff".
        this.maxIdleIntervalMs = Math.max(
            options.intervalMs,
            options.maxIdleIntervalMs ?? DEFAULT_MAX_IDLE_INTERVAL_MS,
        );
        this.runTick = options.runTick;
        this.onTickError = options.onTickError;
    }

    /** Begin the loop; the first tick runs immediately. Idempotent. */
    start(): void {
        if (this.running) return;
        this.running = true;
        this.idleTicks = 0;
        this.loopTick();
    }

    /** Stop the loop and drain the in-flight tick. */
    async stop(): Promise<void> {
        if (!this.running) return;
        this.running = false;
        this.tickRequested = false;
        this.clearTimer();
        if (this.inflightTick) {
            try { await this.inflightTick; } catch { /* already reported */ }
        }
    }

    /**
     * Work arrived: tick now — or once more the moment the running tick settles —
     * and reset the idle backoff. No-op while stopped.
     */
    wake(): void {
        if (!this.running) return;
        this.idleTicks = 0;
        this.loopTick();
    }

    /**
     * One tick of the loop, then the timer for the next. Never two at once: a
     * call that finds a tick in flight becomes a follow-up request instead.
     */
    private loopTick(): void {
        if (!this.running) return;
        this.clearTimer();
        if (this.inflightTick) {
            this.tickRequested = true;
            return;
        }
        const startedAt = Date.now();
        this.inflightTick = this.runTick()
            .then((claimed) => {
                this.idleTicks = claimed > 0 ? 0 : this.idleTicks + 1;
            })
            .catch((err) => {
                // A failing store is not work: back off rather than hammer it.
                this.idleTicks += 1;
                this.onTickError(err);
            })
            .finally(() => {
                this.inflightTick = undefined;
                if (!this.running) return;
                if (this.tickRequested) {
                    this.tickRequested = false;
                    this.idleTicks = 0;
                    this.loopTick();
                    return;
                }
                this.schedule(Math.max(0, this.nextIntervalMs() - (Date.now() - startedAt)));
            });
    }

    /**
     * Delay before the next loop tick, measured from the START of the last one:
     * `intervalMs` while ticks claim work, doubled for every consecutive empty
     * tick after that, capped at `maxIdleIntervalMs`.
     */
    private nextIntervalMs(): number {
        if (this.idleTicks === 0) return this.intervalMs;
        // Exponent clamped so the product stays finite long after the cap wins.
        return Math.min(this.maxIdleIntervalMs, this.intervalMs * 2 ** Math.min(this.idleTicks, 30));
    }

    private schedule(delayMs: number): void {
        this.clearTimer();
        this.timer = setTimeout(() => {
            this.timer = undefined;
            this.loopTick();
        }, delayMs);
        // Don't keep the event loop alive solely for the dispatcher.
        (this.timer as { unref?: () => void })?.unref?.();
    }

    private clearTimer(): void {
        if (this.timer === undefined) return;
        clearTimeout(this.timer);
        this.timer = undefined;
    }
}
