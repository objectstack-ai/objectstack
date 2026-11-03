// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Per-key serialisation for the read → decide → write counters in this package
 * (the fixed-window limiter in `rate-limit-storage.ts`, the OTP send history in
 * `otp-send-guard.ts`).
 *
 * The rule it carries: **inside one process, two updates of the SAME counter
 * key never interleave.** Each update reads what the previous one wrote, so a
 * limit of `max` per window admits at most `max` however many requests for
 * that key arrive at once, and the counter in the store is exact.
 *
 * Why a chain and not a synchronous increment: the store behind a counter is
 * asynchronous — the kernel `cache` service (`ICacheService`) is, and the
 * per-process fallback answers through the same promise-returning contract so
 * that one algorithm serves both. Between the read and the write there is an
 * `await` on every path, and nothing in a store-agnostic counter can remove it.
 * Ordering the whole update per key is the shape that holds for every store,
 * shared or not.
 *
 * What it does NOT carry: anything across processes. Two nodes counting in one
 * shared cache each serialise their own updates and still read-modify-write
 * against each other; closing that needs an atomic increment in the cache
 * contract itself (ADR-0069 D2 — see `incrementFixedWindow`).
 *
 * Bounded: a key has an entry only while an update for it is in flight, and the
 * last update to finish removes it, so the map never outgrows the number of
 * keys being counted concurrently. A failing update releases its successor the
 * same as a succeeding one, and its error reaches only its own caller.
 *
 * Internal to `@objectstack/plugin-auth`: deliberately not re-exported from
 * the package root or the `./rate-limit-storage` subpath.
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
