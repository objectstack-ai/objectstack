// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { TimeoutGuard, raceWithTimeout } from './timeout-guard.js';
import {
    recordGuards,
    refdTimeouts,
    stillPinningTheLoop,
} from '@objectstack/refd-timer-testkit';

/**
 * A guard has two reclaimable halves — the TIMER and the PROMISE — and the
 * kernel's two race sites used to do one each (#10604). These pins hold both
 * halves and the property that makes a guard a guard, so a future "cleanup"
 * cannot buy leak-freedom by disarming it.
 */
describe('TimeoutGuard (#4813, #10604)', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    /**
     * Whether `expiry` has SETTLED, decided without hanging the suite: a
     * settled promise runs its reaction in the current microtask drain, which
     * is many orders of magnitude before a real 50ms timer. An unsettled
     * guard — the leak — reports 'pending' in 50ms instead of timing the test
     * out in five seconds.
     */
    const settlementOf = (expiry: Promise<never>) =>
        Promise.race([
            expiry.then(() => 'settled' as const, () => 'settled' as const),
            new Promise<'pending'>((resolve) => setTimeout(() => resolve('pending'), 50)),
        ]);

    describe('reclaim() does BOTH halves', () => {
        it('clears the timer, so nothing is left armed against a phase that is over', () => {
            vi.useFakeTimers();

            const before = vi.getTimerCount();
            const guard = new TimeoutGuard(120_000, () => new Error('must not fire'));
            expect(vi.getTimerCount()).toBe(before + 1);

            guard.reclaim();

            // `vi.getTimerCount()` counts unref'd timers too, so this
            // distinguishes "the guard was reclaimed" from "the guard was
            // merely detached from the loop" — the shutdown site's old bug.
            expect(vi.getTimerCount()).toBe(before);
        });

        it('settles `expiry`, so neither it nor the race\'s reaction on it is retained', async () => {
            const guard = new TimeoutGuard(120_000, () => new Error('must not fire'));

            // The leak, stated directly: before #10604 the losing promise was
            // never settled, so `Promise.race`'s reaction on it stayed pending
            // for the life of the process. Clearing the timer does NOT do this.
            guard.reclaim();

            await expect(settlementOf(guard.expiry)).resolves.toBe('settled');
        });

        it('is idempotent', async () => {
            const guard = new TimeoutGuard(120_000, () => new Error('must not fire'));

            guard.reclaim();
            guard.reclaim();

            await expect(settlementOf(guard.expiry)).resolves.toBe('settled');
        });
    });

    describe('reclaiming must not mean disarming', () => {
        it('still rejects with the caller\'s own error object when it is never reclaimed', async () => {
            // Identity, not message: `shutdown()` discriminates a genuine
            // timeout from any exception escaping teardown by comparing this
            // exact object (#5274).
            const timeoutError = new Error('Shutdown timeout exceeded');
            const guard = new TimeoutGuard(10, () => timeoutError);

            await expect(guard.expiry).rejects.toBe(timeoutError);
        });

        it('arms a REF\'D timer, so an otherwise-idle process cannot exit before it fires', () => {
            // ⛔ The regression this forbids is `unref()` at arm time. It looks
            // like a fix — no ref'd timer, no leak — and it silently removes
            // the guarantee the guard exists for: with nothing else on the
            // loop, Node exits before an unref'd guard can report the timeout
            // (#4813). A leak-free kernel that no longer enforces its timeouts
            // is strictly worse than the leak.
            // `refdTimeouts()` is the RAW, process-global reading, and it is
            // sound here for the one reason it is ever sound: this whole window
            // is synchronous. No `await` sits between the samples, so no timer
            // callback can run between them and the ambient value cancels
            // exactly. Adding an `await` anywhere below silently invalidates it
            // — that is when `recordGuards`/`stillPinningTheLoop` is the answer.
            const before = refdTimeouts();
            const guard = new TimeoutGuard(120_000, () => new Error('must not fire'));

            expect(refdTimeouts()).toBe(before + 1);

            guard.reclaim();
            expect(refdTimeouts()).toBe(before);
        });

        it('builds the timeout error only when the guard actually fires', async () => {
            let built = 0;
            const guard = new TimeoutGuard(120_000, () => {
                built++;
                return new Error('must not fire');
            });

            guard.reclaim();
            await settlementOf(guard.expiry);

            expect(built).toBe(0);
        });
    });
});

describe('raceWithTimeout (#10604)', () => {
    it('returns the operation\'s value when the operation wins', async () => {
        await expect(
            raceWithTimeout(Promise.resolve('ok'), 120_000, () => new Error('must not fire')),
        ).resolves.toBe('ok');
    });

    it('accepts a synchronous operation, which wins on the same turn', async () => {
        await expect(
            raceWithTimeout('sync', 120_000, () => new Error('must not fire')),
        ).resolves.toBe('sync');
    });

    it('propagates the operation\'s own rejection unchanged', async () => {
        const boom = new Error('operation failed');

        await expect(
            raceWithTimeout(Promise.reject(boom), 120_000, () => new Error('must not fire')),
        ).rejects.toBe(boom);
    });

    it('rejects with the timeout error when the operation hangs', async () => {
        const timeoutError = new Error('hung');

        await expect(
            raceWithTimeout(new Promise(() => {}), 10, () => timeoutError),
        ).rejects.toBe(timeoutError);
    });

    /**
     * ⚠️ Why this no longer reads the process-global count at all (#10785).
     *
     * `process.getActiveResourcesInfo()` is PROCESS-wide, and in CI this file
     * shares one worker with three dozen others — so the absolute count is
     * AMBIENT and this test does not own it. Foreign timers alive at the sample
     * expire while this test awaits, pulling the reading DOWN: the shard read
     * `expected 2 to be 4` on the third leg (#10604), the only one that spends
     * real time on the loop (the first two settle on microtasks, where no timer
     * phase can run and the reading cannot move under the test).
     *
     * #10661 repaired that by asserting NON-INCREASE, on the reasoning that a
     * leak is a GROWTH so the direction that matters survives while foreign
     * expiry stops being a signal. That decision was deliberate and correct as
     * far as it went — and it is superseded here rather than reverted, because
     * the reading it kept is still the whole process, and the arithmetic
     * composes the wrong way on the one leg that spends real time on the loop:
     *
     *     subject leaks              +1
     *     two foreign timers expire  -2
     *     reading            before - 1   =>   toBeLessThanOrEqual PASSES
     *
     * A real leak, green. Nothing was ever red from this — the ablation cited
     * on #10661 does red, run without ambient noise — but under shard load the
     * detection is probabilistic rather than certain, which is a narrower
     * guarantee than the comment above it claimed.
     *
     * The instrument removes the ambience instead of choosing a direction that
     * survives it: `recordGuards` captures the `Timeout` handles THIS subject
     * arms, told apart from every other timer on the shared loop by the very
     * timeout they were configured with, and `stillPinningTheLoop` reports how
     * many of those are still holding the loop open across a window that is
     * synchronous by construction. So the assertion is `toBe(0)` again — an
     * exact count of the subject's OWN leak, immune to foreign expiry in either
     * direction, on all three legs including the one that burns 10ms of real
     * time. `@objectstack/refd-timer-testkit` carries the full argument.
     *
     * ⚠️ The third leg's guard is SUPPOSED to fire — that is how the race is
     * decided — so what it pins is different from the first two and is stated
     * rather than implied: exactly one guard is armed for the losing race, and a
     * fired guard reclaims itself (`stillPinningTheLoop` counts what a
     * `clearTimeout` can still take away, and a timer that already ran is gone
     * either way). The `clearTimeout`-half leak is detected by the first two
     * legs, whose 120s guards are `+1` there when `reclaim()` stops clearing.
     *
     * ⛔ Do not "fix" the ambience by isolating this file or pinning the shard
     * layout: that would make the pin's validity a property of the runner
     * config rather than of its own assertion.
     */
    it('leaves no ref\'d timer behind on any of the three outcomes', async () => {
        // Leg 1 — the operation wins. Each leg re-anchors on its own recording,
        // so a verdict spans one outcome instead of the whole test.
        const won = await recordGuards(120_000, () =>
            raceWithTimeout(Promise.resolve('ok'), 120_000, () => new Error('must not fire')),
        );
        expect(won).toHaveLength(1);
        expect(stillPinningTheLoop(won)).toBe(0);

        // Leg 2 — the operation rejects.
        const threw = await recordGuards(120_000, async () => {
            await expect(
                raceWithTimeout(Promise.reject(new Error('x')), 120_000, () => new Error('must not fire')),
            ).rejects.toThrow('x');
        });
        expect(threw).toHaveLength(1);
        expect(stillPinningTheLoop(threw)).toBe(0);

        // Leg 3 — the guard wins, after 10ms of real time on the loop. The leg
        // #10661 had to weaken; it needs no weakening now.
        const fired = await recordGuards(10, async () => {
            await expect(
                raceWithTimeout(new Promise(() => {}), 10, () => new Error('hung')),
            ).rejects.toThrow('hung');
        });
        expect(fired).toHaveLength(1);
        expect(stillPinningTheLoop(fired)).toBe(0);
    });
});
