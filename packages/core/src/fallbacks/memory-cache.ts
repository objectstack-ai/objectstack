// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/** The fewest entries at which a write sweeps expired entries out. */
const SWEEP_FLOOR = 1024;

/**
 * In-memory Map-backed cache fallback.
 *
 * Implements the ICacheService contract with basic get/set/delete/has/clear
 * and TTL expiry.  Used by ObjectKernel as an automatic fallback when no
 * real cache plugin (e.g. Redis) is registered.
 *
 * [#4058] Self-describes as `degraded`, not `stub` (ADR-0076 D12): this is a
 * real cache — it stores, expires, and reports true stats — just process-local
 * and unshared. The non-standard `_fallback: true` it used to carry was read by
 * nothing (`readServiceSelfInfo` reads only `__serviceInfo` — `_dev`, the other
 * marker it knew back then, was itself retired in #4319), so discovery reported
 * it as fully `available`. `handlerReady: false` because
 * no HTTP surface is mounted for `cache` at all — the same reason realtime
 * reports false.
 *
 * Bounded by what is live: an entry whose TTL has passed is evicted without
 * having to be read again. A `get` of an expired key drops it as before, and a
 * `set` that grows the map to the next sweep mark walks it once and drops every
 * expired entry. The mark is then set to twice the entries left (never below
 * {@link SWEEP_FLOOR}), so the map holds at most about twice its live entries
 * and the walks cost O(1) per write, amortised. A key that is written once and
 * never read again — a per-caller counter, say — therefore does not stay
 * forever. Nothing live is ever evicted: an entry with no TTL, or a TTL still
 * running, survives every sweep, so the `ICacheService` contract is unchanged.
 */
export function createMemoryCache() {
  const store = new Map<string, { value: unknown; expires?: number }>();
  let hits = 0;
  let misses = 0;
  let sweepAt = SWEEP_FLOOR;
  const sweepExpired = (now: number): void => {
    for (const [key, entry] of store) {
      if (entry.expires && now > entry.expires) store.delete(key);
    }
    sweepAt = Math.max(SWEEP_FLOOR, store.size * 2);
  };
  return {
    __serviceInfo: {
      status: 'degraded' as const,
      handlerReady: false,
      message: 'In-process Map cache — not shared across instances, lost on restart. Register a cache plugin (e.g. Redis) for a real one.',
    },
    _serviceName: 'cache',
    async get<T = unknown>(key: string): Promise<T | undefined> {
      const entry = store.get(key);
      if (!entry || (entry.expires && Date.now() > entry.expires)) {
        store.delete(key);
        misses++;
        return undefined;
      }
      hits++;
      return entry.value as T;
    },
    async set<T = unknown>(key: string, value: T, ttl?: number): Promise<void> {
      const now = Date.now();
      store.set(key, { value, expires: ttl ? now + ttl * 1000 : undefined });
      if (store.size >= sweepAt) sweepExpired(now);
    },
    async delete(key: string): Promise<boolean> { return store.delete(key); },
    async has(key: string): Promise<boolean> { return store.has(key); },
    async clear(): Promise<void> { store.clear(); },
    async stats() { return { hits, misses, keyCount: store.size }; },
  };
}
