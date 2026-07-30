// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

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
 * nothing (`readServiceSelfInfo` knows `__serviceInfo` and the legacy `_dev`),
 * so discovery reported it as fully `available`. `handlerReady: false` because
 * no HTTP surface is mounted for `cache` at all — the same reason realtime
 * reports false.
 */
export function createMemoryCache() {
  const store = new Map<string, { value: unknown; expires?: number }>();
  let hits = 0;
  let misses = 0;
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
      store.set(key, { value, expires: ttl ? Date.now() + ttl * 1000 : undefined });
    },
    async delete(key: string): Promise<boolean> { return store.delete(key); },
    async has(key: string): Promise<boolean> { return store.has(key); },
    async clear(): Promise<void> { store.clear(); },
    async stats() { return { hits, misses, keyCount: store.size }; },
  };
}
