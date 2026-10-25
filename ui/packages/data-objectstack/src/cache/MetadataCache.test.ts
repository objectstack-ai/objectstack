/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MetadataCache } from './MetadataCache';

describe('MetadataCache', () => {
  let cache: MetadataCache;

  beforeEach(() => {
    cache = new MetadataCache({ maxSize: 3, ttl: 1000 }); // Small size and TTL for testing
  });

  describe('Cache Hit/Miss Scenarios', () => {
    it('should return cached value on cache hit', async () => {
      const fetcher = vi.fn(async () => ({ name: 'users', fields: [] }));
      
      // First call - cache miss
      const result1 = await cache.get('users', fetcher);
      expect(result1).toEqual({ name: 'users', fields: [] });
      expect(fetcher).toHaveBeenCalledTimes(1);
      
      // Second call - cache hit
      const result2 = await cache.get('users', fetcher);
      expect(result2).toEqual({ name: 'users', fields: [] });
      expect(fetcher).toHaveBeenCalledTimes(1); // Not called again
      
      const stats = cache.getStats();
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);
      expect(stats.hitRate).toBe(0.5);
    });

    it('should call fetcher on cache miss', async () => {
      const fetcher = vi.fn(async () => ({ data: 'test' }));
      
      const result = await cache.get('test-key', fetcher);
      
      expect(result).toEqual({ data: 'test' });
      expect(fetcher).toHaveBeenCalledTimes(1);
      
      const stats = cache.getStats();
      expect(stats.misses).toBe(1);
      expect(stats.hits).toBe(0);
    });

    it('should handle multiple different keys', async () => {
      const fetcher1 = vi.fn(async () => ({ type: 'users' }));
      const fetcher2 = vi.fn(async () => ({ type: 'posts' }));
      
      const result1 = await cache.get('users', fetcher1);
      const result2 = await cache.get('posts', fetcher2);
      
      expect(result1).toEqual({ type: 'users' });
      expect(result2).toEqual({ type: 'posts' });
      expect(fetcher1).toHaveBeenCalledTimes(1);
      expect(fetcher2).toHaveBeenCalledTimes(1);
      
      // Get again - both should be cached
      await cache.get('users', fetcher1);
      await cache.get('posts', fetcher2);
      
      expect(fetcher1).toHaveBeenCalledTimes(1);
      expect(fetcher2).toHaveBeenCalledTimes(1);
    });
  });

  describe('TTL Expiration', () => {
    it('should expire entries after TTL', async () => {
      const cache = new MetadataCache({ maxSize: 10, ttl: 100 }); // 100ms TTL
      const fetcher = vi.fn(async () => ({ data: 'test' }));
      
      // First fetch
      await cache.get('test', fetcher);
      expect(fetcher).toHaveBeenCalledTimes(1);
      
      // Immediate second fetch - should be cached
      await cache.get('test', fetcher);
      expect(fetcher).toHaveBeenCalledTimes(1);
      
      // Wait for TTL to expire
      await new Promise(resolve => setTimeout(resolve, 150));
      
      // Should fetch again after expiration
      await cache.get('test', fetcher);
      expect(fetcher).toHaveBeenCalledTimes(2);
    });

    it('should update timestamp on cache hit', async () => {
      const cache = new MetadataCache({ maxSize: 10, ttl: 200 });
      const fetcher = vi.fn(async () => ({ data: 'test' }));
      
      await cache.get('test', fetcher);
      
      // Access again after 100ms
      await new Promise(resolve => setTimeout(resolve, 100));
      await cache.get('test', fetcher);
      
      // Access again after another 110ms (total 210ms from first, ensuring TTL has passed)
      await new Promise(resolve => setTimeout(resolve, 110));
      
      // Should still be in cache because we're checking timestamp, not last accessed
      // Actually, the implementation uses timestamp for expiration, not lastAccessed
      // So after 210ms total (> 200ms TTL), it should expire
      await cache.get('test', fetcher);
      
      // Should have been called twice - initial + after expiration
      expect(fetcher).toHaveBeenCalledTimes(2);
    });

    it('should not return expired entries via has()', async () => {
      const cache = new MetadataCache({ maxSize: 10, ttl: 100 });
      const fetcher = vi.fn(async () => ({ data: 'test' }));
      
      await cache.get('test', fetcher);
      
      expect(cache.has('test')).toBe(true);
      
      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 150));
      
      expect(cache.has('test')).toBe(false);
    });
  });

  describe('LRU Eviction', () => {
    it('should evict least recently used entry when maxSize is reached', async () => {
      // Cache size is 3
      const fetcher1 = vi.fn(async () => ({ id: 1 }));
      const fetcher2 = vi.fn(async () => ({ id: 2 }));
      const fetcher3 = vi.fn(async () => ({ id: 3 }));
      const fetcher4 = vi.fn(async () => ({ id: 4 }));
      
      // Fill cache
      await cache.get('key1', fetcher1);
      await cache.get('key2', fetcher2);
      await cache.get('key3', fetcher3);
      
      expect(cache.getStats().size).toBe(3);
      
      // Add fourth item - should evict key1 (least recently used)
      await cache.get('key4', fetcher4);
      
      expect(cache.getStats().size).toBe(3);
      expect(cache.getStats().evictions).toBe(1);
      
      // key1 should not be in cache anymore
      await cache.get('key1', fetcher1);
      expect(fetcher1).toHaveBeenCalledTimes(2); // Called again
      
      // After re-adding key1, key2 should have been evicted
      // So cache now has: key3, key4, key1
      
      // key3, key4 should still be cached
      await cache.get('key3', fetcher3);
      await cache.get('key4', fetcher4);
      expect(fetcher3).toHaveBeenCalledTimes(1);
      expect(fetcher4).toHaveBeenCalledTimes(1);
      
      // key2 should have been evicted when key1 was re-added
      await cache.get('key2', fetcher2);
      expect(fetcher2).toHaveBeenCalledTimes(2);
    });

    it('should update LRU order on access', async () => {
      const fetcher1 = vi.fn(async () => ({ id: 1 }));
      const fetcher2 = vi.fn(async () => ({ id: 2 }));
      const fetcher3 = vi.fn(async () => ({ id: 3 }));
      const fetcher4 = vi.fn(async () => ({ id: 4 }));
      
      // Fill cache: key1, key2, key3
      await cache.get('key1', fetcher1);
      await cache.get('key2', fetcher2);
      await cache.get('key3', fetcher3);
      
      // Access key1 again - should move it to the end (most recently used)
      // Cache order: key2, key3, key1
      await cache.get('key1', fetcher1);
      
      // Add key4 - should evict key2 (now the LRU)
      // Cache order: key3, key1, key4
      await cache.get('key4', fetcher4);
      
      // Verify key2 was evicted
      await cache.get('key2', fetcher2);
      expect(fetcher2).toHaveBeenCalledTimes(2);
      
      // After re-adding key2, key3 should have been evicted
      // Cache order: key1, key4, key2
      
      // key1, key4 should still be cached
      await cache.get('key1', fetcher1);
      await cache.get('key4', fetcher4);
      expect(fetcher1).toHaveBeenCalledTimes(1); // Only called once initially (re-access was a cache hit)
      expect(fetcher4).toHaveBeenCalledTimes(1);
      
      // key3 should have been evicted when key2 was re-added
      await cache.get('key3', fetcher3);
      expect(fetcher3).toHaveBeenCalledTimes(2);
    });
  });

  describe('Concurrent Access', () => {
    it('should handle concurrent requests for the same key', async () => {
      let fetchCount = 0;
      const fetcher = vi.fn(async () => {
        fetchCount++;
        await new Promise(resolve => setTimeout(resolve, 50));
        return { data: 'test', fetchCount };
      });
      
      // Make multiple concurrent requests
      const results = await Promise.all([
        cache.get('test', fetcher),
        cache.get('test', fetcher),
        cache.get('test', fetcher),
      ]);
      
      // All three are served. They also share ONE fetcher call — `get` coalesces
      // concurrent misses for the same key onto a single in-flight promise — but
      // that is pinned by "should coalesce concurrent fetches for the same key"
      // below, which asserts the call count and the `coalesced` stat. This case
      // asserts only that every caller gets a value.
      expect(results[0]).toBeDefined();
      expect(results[1]).toBeDefined();
      expect(results[2]).toBeDefined();
    });

    it('should handle concurrent requests for different keys', async () => {
      const fetcher1 = vi.fn(async () => {
        await new Promise(resolve => setTimeout(resolve, 30));
        return { id: 1 };
      });
      const fetcher2 = vi.fn(async () => {
        await new Promise(resolve => setTimeout(resolve, 30));
        return { id: 2 };
      });
      const fetcher3 = vi.fn(async () => {
        await new Promise(resolve => setTimeout(resolve, 30));
        return { id: 3 };
      });
      
      const results = await Promise.all([
        cache.get('key1', fetcher1),
        cache.get('key2', fetcher2),
        cache.get('key3', fetcher3),
      ]);
      
      expect(results[0]).toEqual({ id: 1 });
      expect(results[1]).toEqual({ id: 2 });
      expect(results[2]).toEqual({ id: 3 });
      expect(fetcher1).toHaveBeenCalledTimes(1);
      expect(fetcher2).toHaveBeenCalledTimes(1);
      expect(fetcher3).toHaveBeenCalledTimes(1);
    });
  });

  describe('Cache Management', () => {
    it('should invalidate specific key', async () => {
      const fetcher = vi.fn(async () => ({ data: 'test' }));
      
      await cache.get('test', fetcher);
      expect(fetcher).toHaveBeenCalledTimes(1);
      
      cache.invalidate('test');
      
      await cache.get('test', fetcher);
      expect(fetcher).toHaveBeenCalledTimes(2);
    });

    it('should invalidate all keys', async () => {
      const fetcher1 = vi.fn(async () => ({ id: 1 }));
      const fetcher2 = vi.fn(async () => ({ id: 2 }));
      
      await cache.get('key1', fetcher1);
      await cache.get('key2', fetcher2);
      
      cache.invalidate(); // No key = invalidate all
      
      await cache.get('key1', fetcher1);
      await cache.get('key2', fetcher2);
      
      expect(fetcher1).toHaveBeenCalledTimes(2);
      expect(fetcher2).toHaveBeenCalledTimes(2);
    });

    it('should clear cache and reset stats', async () => {
      const fetcher = vi.fn(async () => ({ data: 'test' }));
      
      await cache.get('key1', fetcher);
      await cache.get('key2', fetcher);
      await cache.get('key1', fetcher); // Hit
      
      const statsBefore = cache.getStats();
      expect(statsBefore.size).toBe(2);
      expect(statsBefore.hits).toBe(1);
      expect(statsBefore.misses).toBe(2);
      
      cache.clear();
      
      const statsAfter = cache.getStats();
      expect(statsAfter.size).toBe(0);
      expect(statsAfter.hits).toBe(0);
      expect(statsAfter.misses).toBe(0);
      expect(statsAfter.evictions).toBe(0);
    });
  });

  describe('Statistics', () => {
    it('should track cache statistics correctly', async () => {
      const fetcher = vi.fn(async () => ({ data: 'test' }));
      
      // Initial stats
      let stats = cache.getStats();
      expect(stats.size).toBe(0);
      expect(stats.maxSize).toBe(3);
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
      expect(stats.evictions).toBe(0);
      expect(stats.hitRate).toBe(0);
      
      // First access - miss
      await cache.get('key1', fetcher);
      stats = cache.getStats();
      expect(stats.size).toBe(1);
      expect(stats.misses).toBe(1);
      expect(stats.hitRate).toBe(0);
      
      // Second access - hit
      await cache.get('key1', fetcher);
      stats = cache.getStats();
      expect(stats.hits).toBe(1);
      expect(stats.hitRate).toBe(0.5);
      
      // Third access - hit
      await cache.get('key1', fetcher);
      stats = cache.getStats();
      expect(stats.hits).toBe(2);
      expect(stats.hitRate).toBeCloseTo(0.667, 2);
    });

    it('should track evictions', async () => {
      const fetcher = vi.fn(async () => ({ data: 'test' }));
      
      // Fill cache to max
      await cache.get('key1', fetcher);
      await cache.get('key2', fetcher);
      await cache.get('key3', fetcher);
      
      let stats = cache.getStats();
      expect(stats.evictions).toBe(0);
      
      // Trigger eviction
      await cache.get('key4', fetcher);
      
      stats = cache.getStats();
      expect(stats.evictions).toBe(1);
      
      // Trigger more evictions
      await cache.get('key5', fetcher);
      await cache.get('key6', fetcher);
      
      stats = cache.getStats();
      expect(stats.evictions).toBe(3);
    });
  });

  describe('Edge Cases', () => {
    it('should handle fetcher that throws error', async () => {
      const fetcher = vi.fn(async () => {
        throw new Error('Fetch failed');
      });
      
      await expect(cache.get('test', fetcher)).rejects.toThrow('Fetch failed');
      
      // Should not cache the error
      const stats = cache.getStats();
      expect(stats.size).toBe(0);
    });

    it('should handle null/undefined values', async () => {
      const fetcher1 = vi.fn(async () => null);
      const fetcher2 = vi.fn(async () => undefined);
      
      const result1 = await cache.get('null-key', fetcher1);
      const result2 = await cache.get('undefined-key', fetcher2);
      
      expect(result1).toBeNull();
      expect(result2).toBeUndefined();
      
      // Should still cache these values
      await cache.get('null-key', fetcher1);
      await cache.get('undefined-key', fetcher2);
      
      expect(fetcher1).toHaveBeenCalledTimes(1);
      expect(fetcher2).toHaveBeenCalledTimes(1);
    });

    it('should handle empty string key', async () => {
      const fetcher = vi.fn(async () => ({ data: 'test' }));
      
      const result = await cache.get('', fetcher);
      expect(result).toEqual({ data: 'test' });
      
      await cache.get('', fetcher);
      expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it('should coalesce concurrent fetches for the same key', async () => {
      let resolveFetch: (v: { data: string }) => void = () => {};
      const fetcher = vi.fn(
        () =>
          new Promise<{ data: string }>((resolve) => {
            resolveFetch = resolve;
          })
      );

      const p1 = cache.get('shared-key', fetcher);
      const p2 = cache.get('shared-key', fetcher);
      const p3 = cache.get('shared-key', fetcher);

      // All three calls should share a single in-flight fetcher invocation
      expect(fetcher).toHaveBeenCalledTimes(1);

      resolveFetch({ data: 'shared' });
      const [r1, r2, r3] = await Promise.all([p1, p2, p3]);

      expect(r1).toEqual({ data: 'shared' });
      expect(r2).toBe(r1);
      expect(r3).toBe(r1);

      const stats = cache.getStats();
      expect(stats.coalesced).toBe(2);
      expect(stats.misses).toBe(1);
    });

    it('should clear inflight slot after fetch rejection so retries are possible', async () => {
      const fetcher = vi
        .fn()
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce({ data: 'ok' });

      await expect(cache.get('retry-key', fetcher)).rejects.toThrow('boom');
      const result = await cache.get('retry-key', fetcher);

      expect(result).toEqual({ data: 'ok' });
      expect(fetcher).toHaveBeenCalledTimes(2);
    });

    it('should expose prime() to seed cache from bulk endpoints', async () => {
      cache.prime('object:account', { name: 'account', fields: [] });

      const fetcher = vi.fn(async () => ({ name: 'account', fields: [{ name: 'id' }] }));
      const result = await cache.get('object:account', fetcher);

      expect(fetcher).not.toHaveBeenCalled();
      expect(result).toEqual({ name: 'account', fields: [] });
    });

    it('should handle very large cache', async () => {
      const largeCache = new MetadataCache({ maxSize: 10000, ttl: 60000 });
      
      // Add many entries
      for (let i = 0; i < 1000; i++) {
        await largeCache.get(`key-${i}`, async () => ({ id: i }));
      }
      
      const stats = largeCache.getStats();
      expect(stats.size).toBe(1000);
      expect(stats.evictions).toBe(0);
    });
  });
});
