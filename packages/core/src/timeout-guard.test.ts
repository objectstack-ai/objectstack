// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { TimeoutGuard, raceWithTimeout } from './timeout-guard.js';

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

    const refdTimers = () =>
        process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length;

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
            const before = refdTimers();
            const guard = new TimeoutGuard(120_000, () => new Error('must not fire'));

            expect(refdTimers()).toBe(before + 1);

            guard.reclaim();
            expect(refdTimers()).toBe(before);
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

    it('leaves no ref\'d timer behind on any of the three outcomes', async () => {
        const refd = () => process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length;
        const before = refd();

        await raceWithTimeout(Promise.resolve('ok'), 120_000, () => new Error('must not fire'));
        expect(refd()).toBe(before);

        await expect(
            raceWithTimeout(Promise.reject(new Error('x')), 120_000, () => new Error('must not fire')),
        ).rejects.toThrow('x');
        expect(refd()).toBe(before);

        await expect(
            raceWithTimeout(new Promise(() => {}), 10, () => new Error('hung')),
        ).rejects.toThrow('hung');
        expect(refd()).toBe(before);
    });
});
