// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The instrument the ref'd-timer leak pins measure with (#4813, #4952, #10604,
 * #10685) — subject-scoped, so a co-tenant test file cannot move the reading.
 *
 * ## Why the obvious probe is not enough
 *
 * `process.getActiveResourcesInfo()` reports the WHOLE process, and a
 * `Test Core` CI shard runs ~37 core test files in one worker. So the absolute
 * `'Timeout'` count is AMBIENT: it belongs to every co-tenant file, not to the
 * test reading it. Scoring a subject against it —
 *
 * ```ts
 * const before = refdTimeouts();
 * await subject();                       // ⛔ anything can happen in here
 * expect(refdTimeouts()).toBe(before);
 * ```
 *
 * — is sound only while nothing else can move the count between the two
 * samples, i.e. only when the window crosses no event-loop turn: timer
 * callbacks run in the timers phase and a microtask drain never reaches it.
 * Three pins depended on that silently (#10685) and passed only because the
 * hooks they awaited happened to settle on microtasks — a property of code
 * they did not own. `timeout-guard.test.ts`'s fourth pin had the same shape
 * plus a leg that spends real time on the loop, and CI duly reddened it with
 * `expected 2 to be 4`: two FOREIGN timers expired mid-test and pulled the
 * reading DOWN, with a failure message pointing at the timer count rather than
 * at anything the test was about.
 *
 * Co-tenant test files are not the only foreign source. The runner shares this
 * loop too and keeps a **non-unref'd 100ms** timer on it
 * (`throttle(sendTasksUpdate, 100)` in `@vitest/runner`), which is what made
 * the health-monitor suite flaky in the merge queue (#6329): once the window
 * between two reads stretched past 100ms under full concurrent load — the
 * failing run measured 105ms — that timer fired inside the window and the
 * count fell by one for a reason that had nothing to do with the subject. So
 * "this file runs alone" is not a defence either.
 *
 * ## What this module does instead
 *
 * Name the guards, then ask about those handles only:
 *
 * ```ts
 * const guards = await recordGuards(120_000, () => kernel.bootstrap());
 * expect(guards).toHaveLength(2);              // the guards were really armed
 * expect(stillPinningTheLoop(guards)).toBe(0); // and none outlived its race
 * ```
 *
 * `recordGuards` captures the `Timeout` handles the subject arms, told apart
 * from every other timer on the shared loop by the very timeout they were
 * configured with. `stillPinningTheLoop` then reports how many of THOSE are
 * still holding the loop open — and it is deliberately a **synchronous**
 * function, which is what makes the invariant structural instead of a comment:
 * its two samples are adjacent statements, no `await` can be inserted between
 * them without turning it into a different (and visibly `async`) function, and
 * between two adjacent synchronous statements no timer callback can run at
 * all. The ambient value cancels; what survives is the subject's own delta.
 *
 * ⛔ Do not "fix" the ambience by isolating a file or pinning the shard layout
 * instead: that would make a pin's validity a property of the runner config
 * rather than of its own assertion.
 *
 * `.testkit.ts`, not `.test.ts`: it holds no assertions and must not be
 * collected as a suite. It is imported only by tests, so tsup (entries
 * `src/index.ts` and `src/logger.ts`) never bundles it into `dist`.
 *
 * ⚠️ Real timers only. Under `vi.useFakeTimers()` the handles are fakes and
 * `getActiveResourcesInfo()` cannot see them — use `vi.getTimerCount()` there,
 * which is the complementary pin (it counts `unref()`'d timers too, so it tells
 * "the guard was reclaimed" apart from "the guard was merely detached from the
 * loop").
 */

/**
 * Ref'd `Timeout` handles currently keeping THIS PROCESS's event loop alive —
 * an ambient, process-global reading.
 *
 * ⚠️ Only ever compare two of these across a window that contains no `await`
 * (see the module docblock). If you are about to write `const before = …` and
 * then `await` something, you want {@link recordGuards} plus
 * {@link stillPinningTheLoop} instead.
 */
export const refdTimeouts = (): number =>
    process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length;

/**
 * Run `body` while capturing the `Timeout` handles `setTimeout` hands out with
 * exactly `delay` ms — the subject's guards, identified by the timeout they
 * were configured with rather than by counting the world.
 *
 * The interception is installed around `body` only and restored in a `finally`,
 * so a throwing subject cannot leave a patched global behind for the next test.
 */
export async function recordGuards(
    delay: number,
    body: () => Promise<unknown> | unknown
): Promise<NodeJS.Timeout[]> {
    const guards: NodeJS.Timeout[] = [];
    const real = globalThis.setTimeout;

    const recording = ((...args: Parameters<typeof globalThis.setTimeout>) => {
        const handle = real(...args);
        if (args[1] === delay) guards.push(handle);
        return handle;
    }) as typeof globalThis.setTimeout;
    // Carry `setTimeout.__promisify__` & friends over, so anything reaching for
    // them through the global while `body` runs still finds them.
    Object.assign(recording, real);

    globalThis.setTimeout = recording;
    try {
        await body();
    } finally {
        globalThis.setTimeout = real;
    }

    return guards;
}

/**
 * How many of `handles` are STILL armed and pinning the event loop — the leak,
 * measured on the subject's own handles and on nothing else.
 *
 * `clearTimeout` on a handle that was already reclaimed is a no-op, so the
 * count only drops for a guard that really did outlive its race. Both samples
 * are adjacent synchronous statements: no timer callback can run between them,
 * so the ambient count cancels exactly and the difference is the subject's.
 *
 * ⚠️ Destructive by design — it reclaims whatever was still armed. Call it once,
 * at the point where the guards are supposed to be gone already.
 *
 * Throws on an empty `handles`, because "nothing was armed" and "nothing was
 * left behind" are different facts and a zero must never stand for both: the
 * caller that recorded no guards has a broken instrument (wrong `delay`, or a
 * subject that never armed one), not a clean subject.
 */
export function stillPinningTheLoop(handles: readonly NodeJS.Timeout[]): number {
    if (handles.length === 0) {
        throw new Error(
            'stillPinningTheLoop() got no handles: recordGuards() captured nothing, ' +
                'so this measurement would be vacuously 0. Check the `delay` it filters ' +
                'on still matches the timeout the subject arms its guard with.'
        );
    }

    const before = refdTimeouts();
    for (const handle of handles) clearTimeout(handle);
    return before - refdTimeouts();
}
