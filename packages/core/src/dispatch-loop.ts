// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The timer loop every polling worker in the platform runs —
 * `NotificationDispatcher` over `sys_notification_delivery`, `HttpDispatcher`
 * over `sys_http_delivery`, and `DbQueueAdapter` over `sys_job_queue`.
 *
 * #17610 wrote this loop inside `NotificationDispatcher`. #17623 found
 * `HttpDispatcher` still on the fixed 500 ms `setInterval` the notification side
 * had just left, and pulled the loop out into one implementation of these rules
 * instead of two copies that can drift. #17612 found the third copy —
 * `DbQueueAdapter` on a flat 1 s `setInterval` — and that is why the loop
 * lives HERE, in `@objectstack/core`, rather than in either service: it is a
 * timing primitive, owned by neither the messaging domain nor the queue
 * domain, and a service-to-service dependency between them to share it would
 * invert the direction (a queue service depending on a messaging service).
 * `@objectstack/core` is the package all three already depend on.
 *
 * The rules, one implementation:
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
 *
 * ## Waking at the next due time (#29919)
 *
 * Two of those three are not unknowable: a deferred row and a claim carry the
 * instant they become claimable. A loop given {@link DispatchLoopOptions.nextDueAt}
 * asks for the earliest such instant once, after the first empty tick of an
 * idle streak (after `start()`, after a tick that claimed work, after a wake,
 * and after the due time it was sleeping towards arrives), and never sleeps
 * past it: a deferred row goes out within one tick of coming due, whatever the
 * ceiling. The answer is remembered, not re-read on every ceiling tick, so an
 * idle loop's steady-state cost is unchanged; a deferred row written in this
 * process later in the streak reaches the loop through
 * {@link DispatchLoop.wakeAt} instead, at no read at all.
 *
 * Only the third case — a row another process wrote — is left to the backoff.
 * A host on which no other process writes the store (a hosted tenant kernel:
 * one kernel per tenant database) says so with
 * {@link DispatchLoopOptions.soleWriter}, and an empty tick then sleeps
 * straight to the next due time or the ceiling instead of re-running the
 * `intervalMs` ramp. Before #29919 every boot re-ran that ramp against empty
 * stores: five ticks in the first minute per loop, every one of them idle.
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
    /**
     * [#29919] The earliest instant (epoch ms, on `Date.now()`'s clock) at
     * which work this loop's tick would claim becomes claimable — a deferred
     * row's due time, a claim's expiry — or `null` when nothing is deferred.
     * Read once per idle streak, after its first empty tick; the loop then never
     * sleeps past the answer. An answer at or before the start of the tick that
     * just found nothing is not chased (that work was visible and not claimable
     * by this loop — another node's partition, say), so it cannot make the loop
     * spin. A rejection is reported through `onTickError` and the loop sleeps as
     * if it had no answer.
     *
     * Absent, the loop sleeps by the backoff alone, as it always has.
     */
    nextDueAt?: () => Promise<number | null | undefined>;
    /**
     * [#29919] No other process writes the store this loop drains: every row it
     * can claim is written here, by a producer that calls
     * {@link DispatchLoop.wake} (or {@link DispatchLoop.wakeAt} for a deferred
     * row). The idle backoff's ramp only ever bought latency on rows another
     * process wrote, so with this set an empty tick sleeps straight to the
     * ceiling, or to the next due time when {@link nextDueAt} is given. Default
     * `false`: the ramp from `intervalMs` is kept.
     */
    soleWriter?: boolean;
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
    private readonly nextDueAt: (() => Promise<number | null | undefined>) | undefined;
    private readonly soleWriter: boolean;
    private timer: ReturnType<typeof setTimeout> | undefined;
    /** When the pending timer fires (epoch ms); meaningful only while `timer` is set. */
    private timerFiresAt = 0;
    /** [#29919] Earliest known instant work becomes claimable, from the last read and every hint since. */
    private knownDueAt: number | null = null;
    /** [#29919] The next empty tick reads {@link DispatchLoopOptions.nextDueAt}. */
    private dueReadOwed = false;
    /** [#29919] Hints ({@link DispatchLoop.wakeAt}) since the running tick began — a read in flight cannot see them. */
    private hintedDueAt: number | null = null;
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
        this.nextDueAt = options.nextDueAt;
        this.soleWriter = options.soleWriter ?? false;
    }

    /** Begin the loop; the first tick runs immediately. Idempotent. */
    start(): void {
        if (this.running) return;
        this.running = true;
        this.idleTicks = 0;
        this.knownDueAt = null;
        this.dueReadOwed = true;
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
        this.dueReadOwed = true;
        this.loopTick();
    }

    /**
     * [#29919] Work becomes claimable at `dueAtMs` (epoch ms, on `Date.now()`'s
     * clock) — a deferred row this process just wrote: make sure a tick runs
     * then. Costs no read and no tick now, and leaves the idle backoff where it
     * is; a timer already due sooner is kept. An instant already past ticks at
     * once. No-op while stopped, or for a non-finite instant.
     */
    wakeAt(dueAtMs: number): void {
        if (!this.running || !Number.isFinite(dueAtMs)) return;
        this.knownDueAt = earliest(this.knownDueAt, dueAtMs);
        this.hintedDueAt = earliest(this.hintedDueAt, dueAtMs);
        // The running tick schedules its successor from `knownDueAt` when it settles.
        if (this.inflightTick) return;
        if (this.timer !== undefined && this.timerFiresAt <= dueAtMs) return;
        const delayMs = dueAtMs - Date.now();
        if (delayMs <= 0) {
            this.dueReadOwed = true;
            this.loopTick();
            return;
        }
        this.schedule(delayMs, true);
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
        this.hintedDueAt = null;
        this.inflightTick = this.runTick()
            .then(async (claimed) => {
                if (claimed > 0) {
                    this.idleTicks = 0;
                    // The work just done may have deferred more (a retry, a backoff).
                    this.dueReadOwed = true;
                    return;
                }
                this.idleTicks += 1;
                if (this.nextDueAt && this.dueReadOwed) await this.readNextDueAt();
            })
            .catch((err) => {
                // A failing store is not work: back off rather than hammer it.
                this.idleTicks += 1;
                this.dueReadOwed = true;
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
                const { delayMs, forDue } = this.nextDelay(startedAt);
                this.schedule(Math.max(0, delayMs - (Date.now() - startedAt)), forDue);
            });
    }

    /** [#29919] One read of the next due time, folded with the hints that arrived while it ran. */
    private async readNextDueAt(): Promise<void> {
        this.dueReadOwed = false;
        try {
            const due = await this.nextDueAt!();
            this.knownDueAt = earliest(
                typeof due === 'number' && Number.isFinite(due) ? due : null,
                this.hintedDueAt,
            );
        } catch (err) {
            // No answer: sleep by the backoff alone, and ask again next idle tick.
            this.dueReadOwed = true;
            this.onTickError(err);
        }
    }

    /**
     * Delay before the next loop tick, measured from the START of the last one
     * (`startedAt`), and whether it is a due time's: the backoff's delay
     * ({@link nextIntervalMs}), cut short by the earliest known due time.
     */
    private nextDelay(startedAt: number): { delayMs: number; forDue: boolean } {
        const backoffMs = this.nextIntervalMs();
        if (this.idleTicks === 0 || this.knownDueAt === null) return { delayMs: backoffMs, forDue: false };
        if (this.knownDueAt <= startedAt) {
            // Claimable before this tick began, and the tick claimed nothing: the
            // work is not this loop's to take right now (another node holds its
            // partition, say). Chasing it would spin; the backoff covers it.
            this.knownDueAt = null;
            return { delayMs: backoffMs, forDue: false };
        }
        const untilDueMs = this.knownDueAt - startedAt;
        return untilDueMs < backoffMs ? { delayMs: untilDueMs, forDue: true } : { delayMs: backoffMs, forDue: false };
    }

    /**
     * The backoff's delay before the next loop tick, measured from the START of
     * the last one: `intervalMs` while ticks claim work, doubled for every
     * consecutive empty tick after that, capped at `maxIdleIntervalMs` — or the
     * cap at once after an empty tick when the loop is the store's sole writer.
     */
    private nextIntervalMs(): number {
        if (this.idleTicks === 0) return this.intervalMs;
        if (this.soleWriter) return this.maxIdleIntervalMs;
        // Exponent clamped so the product stays finite long after the cap wins.
        return Math.min(this.maxIdleIntervalMs, this.intervalMs * 2 ** Math.min(this.idleTicks, 30));
    }

    private schedule(delayMs: number, forDue: boolean): void {
        this.clearTimer();
        this.timerFiresAt = Date.now() + delayMs;
        this.timer = setTimeout(() => {
            this.timer = undefined;
            // The due time arrived: the tick takes that work, and the next idle
            // tick asks for the one after it.
            if (forDue) this.dueReadOwed = true;
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

/** The earlier of two optional instants. */
function earliest(a: number | null, b: number | null): number | null {
    if (a === null) return b;
    if (b === null) return a;
    return Math.min(a, b);
}
