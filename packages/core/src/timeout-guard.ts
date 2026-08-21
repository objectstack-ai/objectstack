// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The one-shot timeout guard both kernel lifecycle races arm.
 *
 * A guard is a `setTimeout` plus the promise a `Promise.race` holds a reaction
 * on. Reclaiming it after the race is decided therefore has TWO halves, and
 * the kernel used to do exactly one of them at each site — a different one:
 *
 *   - `raceStartupTimeout` cleared the timer and left the promise pending.
 *   - `shutdown()` `unref()`d the timer, never cleared it, and also left the
 *     promise pending.
 *
 * Clearing the timer reclaims the TIMER. It does not settle the PROMISE: the
 * race attached `then(resolve, reject)` to that participant when it started,
 * and a promise that never settles keeps both itself and that reaction alive
 * for as long as anything can reach them. That is what
 * `vitest --detectAsyncLeaks` reports as a leaking PROMISE — two frames per
 * site, one for the guard promise and one for the race's reaction on it
 * (#10604). So `reclaim()` clears the timer AND settles the promise.
 *
 * ⛔ The guard is deliberately NOT `unref()`ed at arm time (#4813). An unref'd
 * guard also stops pinning the event loop, but it stops being a guard as well:
 * if the operation never settles and nothing else keeps the loop alive, Node
 * exits before the timer can fire and the timeout is never reported. The guard
 * has to stay ref'd exactly as long as the race is undecided — which is what
 * clearing on settle expresses and what `unref()` cannot. `unref()` is the
 * failure mode this class exists to prevent, not a second belt to add.
 */
export class TimeoutGuard {
    private timer: ReturnType<typeof setTimeout> | undefined;

    /**
     * Settles `expiry` without a value. `Promise<never>` has no resolvable
     * value in the type system, but settling it is the entire point: it is
     * only ever called from `reclaim()`, i.e. after the race it guarded has
     * already been decided, so the resolution is discarded by construction and
     * can never become a race winner. The cast localises that argument here
     * rather than pushing a lie into every caller's return type.
     */
    private settleExpiry: () => void = () => {};

    /**
     * The racing participant. Rejects with the caller's error when the guard
     * expires; resolves — settles, harmlessly — once `reclaim()` runs.
     */
    readonly expiry: Promise<never>;

    constructor(timeoutMs: number, createTimeoutError: () => Error) {
        this.expiry = new Promise<never>((resolve, reject) => {
            this.settleExpiry = resolve as unknown as () => void;
            this.timer = setTimeout(() => reject(createTimeoutError()), timeoutMs);
        });
    }

    /**
     * Reclaim the guard once the race it protects has been decided. Both
     * halves, always: the timer is cleared so it cannot fire against a
     * lifecycle phase that is already over, and `expiry` is settled so neither
     * it nor the race's reaction on it is retained.
     *
     * Idempotent — `clearTimeout` on a cleared handle and a second resolve on
     * a settled promise are both no-ops.
     */
    reclaim(): void {
        clearTimeout(this.timer);
        this.timer = undefined;
        this.settleExpiry();
    }
}

/**
 * Race `operation` against a startup/shutdown timeout guard, reclaiming the
 * guard the moment the race settles — whichever side won.
 *
 * `operation` is widened to `T | PromiseLike<T>` because the Plugin contract
 * permits a synchronous hook (`init`/`start` return `void | Promise<void>`);
 * such a hook wins the race immediately and the guard is reclaimed on the same
 * turn.
 *
 * `createTimeoutError` is a factory rather than an `Error` so a caller that
 * discriminates the timeout by IDENTITY (`shutdown()`, #5274) can hand back
 * its own pre-built instance, while callers that only need a message pay for
 * the `Error` — and its stack — only when the guard actually fires.
 */
export async function raceWithTimeout<T>(
    operation: T | PromiseLike<T>,
    timeoutMs: number,
    createTimeoutError: () => Error,
): Promise<T> {
    const guard = new TimeoutGuard(timeoutMs, createTimeoutError);

    try {
        return await Promise.race([operation, guard.expiry]);
    } finally {
        guard.reclaim();
    }
}
