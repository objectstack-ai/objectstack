// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import { cacheSecondaryStorage } from './secondary-storage.js';

/** Minimal in-memory ICacheService stand-in. */
function makeCache() {
  const store = new Map<string, unknown>();
  return {
    store,
    get: vi.fn(async (k: string) => (store.has(k) ? store.get(k) : undefined)),
    set: vi.fn(async (k: string, v: unknown, _ttl?: number) => { store.set(k, v); }),
    delete: vi.fn(async (k: string) => store.delete(k)),
    has: vi.fn(async (k: string) => store.has(k)),
    clear: vi.fn(async () => store.clear()),
    stats: vi.fn(async () => ({ hits: 0, misses: 0, keys: store.size })),
  };
}

describe('cacheSecondaryStorage (ADR-0069 D2 — shared rate-limit/session store)', () => {
  it('round-trips a value through the cache service', async () => {
    const cache = makeCache();
    const ss = cacheSecondaryStorage(cache as any);
    await ss.set('k1', '{"count":1}', 60);
    expect(cache.set).toHaveBeenCalledWith('k1', '{"count":1}', 60);
    expect(await ss.get('k1')).toBe('{"count":1}');
  });

  it('maps a cache MISS (undefined) to null (better-auth contract)', async () => {
    const cache = makeCache();
    const ss = cacheSecondaryStorage(cache as any);
    expect(await ss.get('absent')).toBeNull();
  });

  it('forwards the TTL (seconds) to the cache set', async () => {
    const cache = makeCache();
    const ss = cacheSecondaryStorage(cache as any);
    await ss.set('k', 'v', 10);
    expect(cache.set).toHaveBeenCalledWith('k', 'v', 10);
  });

  it('deletes via the cache service', async () => {
    const cache = makeCache();
    const ss = cacheSecondaryStorage(cache as any);
    await ss.set('k', 'v');
    await ss.delete('k');
    expect(cache.delete).toHaveBeenCalledWith('k');
    expect(await ss.get('k')).toBeNull();
  });
});

// better-auth 1.7 promoted both of these from optional to REQUIRED on
// SecondaryStorage: single-use verification values are consumed through
// getAndDelete, and `rateLimit.storage: 'secondary-storage'` throws at boot
// without `increment`.
describe('cacheSecondaryStorage — getAndDelete (single-use verification values)', () => {
  it('returns the value and removes it in one call', async () => {
    const cache = makeCache();
    const ss = cacheSecondaryStorage(cache as any);
    await ss.set('verification:abc', '{"value":"token"}');

    expect(await ss.getAndDelete!('verification:abc')).toBe('{"value":"token"}');
    expect(cache.delete).toHaveBeenCalledWith('verification:abc');
    // A replay of the same token finds nothing.
    expect(await ss.getAndDelete!('verification:abc')).toBeNull();
  });

  it('maps a MISS to null (better-auth contract) and still issues the delete', async () => {
    const cache = makeCache();
    const ss = cacheSecondaryStorage(cache as any);
    expect(await ss.getAndDelete!('absent')).toBeNull();
  });
});

describe('cacheSecondaryStorage — increment (fixed-window rate-limit counter)', () => {
  it('creates the counter at 1 with the requested TTL', async () => {
    const cache = makeCache();
    const ss = cacheSecondaryStorage(cache as any);

    expect(await ss.increment!('rl:ip', 60)).toBe(1);
    expect(cache.set).toHaveBeenCalledWith('rl:ip', expect.any(String), 60);
  });

  it('returns the POST-increment count on every call in the window', async () => {
    const cache = makeCache();
    const ss = cacheSecondaryStorage(cache as any);

    expect(await ss.increment!('rl:ip', 60)).toBe(1);
    expect(await ss.increment!('rl:ip', 60)).toBe(2);
    expect(await ss.increment!('rl:ip', 60)).toBe(3);
  });

  it('never extends the window — later increments carry only the REMAINING ttl', async () => {
    vi.useFakeTimers();
    try {
      const cache = makeCache();
      const ss = cacheSecondaryStorage(cache as any);

      await ss.increment!('rl:ip', 60);
      vi.advanceTimersByTime(45_000);
      await ss.increment!('rl:ip', 60);

      // 60s window opened 45s ago → 15s left, NOT a fresh 60s.
      expect(cache.set).toHaveBeenLastCalledWith('rl:ip', expect.any(String), 15);
    } finally {
      vi.useRealTimers();
    }
  });

  it('restarts the count once the window has elapsed', async () => {
    vi.useFakeTimers();
    try {
      const cache = makeCache();
      const ss = cacheSecondaryStorage(cache as any);

      await ss.increment!('rl:ip', 10);
      await ss.increment!('rl:ip', 10);
      vi.advanceTimersByTime(10_001);

      // The cache stand-in has no TTL eviction, so this also proves the window
      // end is enforced by the envelope rather than by cache expiry alone.
      expect(await ss.increment!('rl:ip', 10)).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('accepts an envelope handed back as an object (memory-style adapter)', async () => {
    const cache = makeCache();
    const ss = cacheSecondaryStorage(cache as any);

    await ss.increment!('rl:ip', 60);
    // Re-store the same envelope unparsed, the way a memory cache would.
    cache.store.set('rl:ip', JSON.parse(cache.store.get('rl:ip') as string));

    expect(await ss.increment!('rl:ip', 60)).toBe(2);
  });

  it('restarts the window on a corrupt or foreign value instead of throwing', async () => {
    const cache = makeCache();
    const ss = cacheSecondaryStorage(cache as any);

    cache.store.set('rl:ip', 'not-json');
    expect(await ss.increment!('rl:ip', 60)).toBe(1);
  });
});
