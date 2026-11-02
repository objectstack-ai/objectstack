// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Per-key serialisation for this package's token buckets
 * (`SharedTokenBucketLimiter` in `inbound-rate-limit.ts`, which both the
 * server-level inbound limiter and the declarative endpoint limiters use).
 *
 * The rule it carries: **inside one process, two updates of the SAME bucket key
 * never interleave.** Each update reads what the previous one wrote, so a
 * bucket admits no more than its budget however many requests for that key
 * arrive at once, and the state in the store is exact.
 *
 * Why a chain and not a synchronous update: the store behind a bucket is
 * asynchronous (the kernel `cache` service, or plugin-auth's per-process
 * fallback answering through the same promise-returning contract), so there is
 * an `await` between the read and the write on every path. Ordering the whole
 * update per key is the shape that holds for every store, shared or not.
 *
 * What it does NOT carry: anything across processes. Two nodes counting in one
 * shared cache each serialise their own updates and still read-modify-write
 * against each other; closing that needs an atomic primitive in the cache
 * contract itself (ADR-0069 D2).
 *
 * Bounded: a key has an entry only while an update for it is in flight, and the
 * last update to finish removes it. A failing update releases its successor the
 * same as a succeeding one, and its error reaches only its own caller.
 *
 * A package-local copy of `@objectstack/plugin-auth`'s internal
 * `per-key-serial.ts` (same rule, same code), kept local so that package's
 * published `./rate-limit-storage` entry does not widen. Not re-exported from
 * this package.
 */

const tails = new Map<string, Promise<void>>();

const settled = (): void => undefined;

/**
 * Run `task` once every earlier task for `key` has settled, and hand back its
 * result. Tasks for different keys run concurrently; tasks for one key run one
 * at a time, in call order.
 */
export function serializePerKey<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = tails.get(key) ?? Promise.resolve();
    const run = previous.then(task);
    const tail = run.then(settled, settled);
    tails.set(key, tail);
    void tail.then(() => {
        if (tails.get(key) === tail) tails.delete(key);
    });
    return run;
}

/** @internal test seam — keys with an update in flight or queued. */
export function serializedKeysInFlight(): number {
    return tails.size;
}
