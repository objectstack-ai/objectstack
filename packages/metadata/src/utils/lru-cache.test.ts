// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LRUCache } from './lru-cache.js';

describe('LRUCache', () => {
  describe('basic set / get', () => {
    it('returns undefined for missing keys', () => {
      const cache = new LRUCache<string, number>();
      expect(cache.get('missing')).toBeUndefined();
    });

    it('stores and retrieves a value', () => {
      const cache = new LRUCache<string, number>();
      cache.set('a', 1);
      expect(cache.get('a')).toBe(1);
    });

    it('overwrites existing keys without growing size', () => {
      const cache = new LRUCache<string, number>();
      cache.set('a', 1);
      cache.set('a', 2);
      expect(cache.get('a')).toBe(2);
      expect(cache.size).toBe(1);
    });

    it('has() returns true only for live entries', () => {
      const cache = new LRUCache<string, number>();
      cache.set('a', 1);
      expect(cache.has('a')).toBe(true);
      expect(cache.has('b')).toBe(false);
    });

    it('delete() removes entries', () => {
      const cache = new LRUCache<string, number>();
      cache.set('a', 1);
      expect(cache.delete('a')).toBe(true);
      expect(cache.delete('a')).toBe(false);
      expect(cache.get('a')).toBeUndefined();
    });

    it('clear() drops every entry', () => {
      const cache = new LRUCache<string, number>();
      cache.set('a', 1);
      cache.set('b', 2);
      cache.clear();
      expect(cache.size).toBe(0);
    });
  });

  describe('TTL expiration (lazy)', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('expires entries after the TTL elapses', () => {
      const cache = new LRUCache<string, number>({ ttl: 1000 });
      cache.set('a', 1);
      expect(cache.get('a')).toBe(1);
      vi.advanceTimersByTime(1001);
      expect(cache.get('a')).toBeUndefined();
    });

    it('counts an expired read as a miss in stats', () => {
      const cache = new LRUCache<string, number>({ ttl: 100 });
      cache.set('a', 1);
      vi.advanceTimersByTime(101);
      cache.get('a');
      expect(cache.stats().misses).toBe(1);
      expect(cache.stats().hits).toBe(0);
    });

    it('ttl <= 0 disables expiration', () => {
      const cache = new LRUCache<string, number>({ ttl: 0 });
      cache.set('a', 1);
      vi.advanceTimersByTime(10_000_000);
      expect(cache.get('a')).toBe(1);
    });
  });

  describe('size cap & eviction', () => {
    it('evicts the least-recently-used entry when full', () => {
      const cache = new LRUCache<string, number>({ maxSize: 2 });
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3); // 'a' is LRU and should evict
      expect(cache.get('a')).toBeUndefined();
      expect(cache.get('b')).toBe(2);
      expect(cache.get('c')).toBe(3);
    });

    it('promote-on-get keeps the touched entry alive', () => {
      const cache = new LRUCache<string, number>({ maxSize: 2 });
      cache.set('a', 1);
      cache.set('b', 2);
      // Touching 'a' makes 'b' the LRU.
      expect(cache.get('a')).toBe(1);
      cache.set('c', 3);
      expect(cache.get('b')).toBeUndefined();
      expect(cache.get('a')).toBe(1);
      expect(cache.get('c')).toBe(3);
    });

    it('maxSize <= 0 disables eviction', () => {
      const cache = new LRUCache<string, number>({ maxSize: 0 });
      for (let i = 0; i < 100; i++) cache.set(`k${i}`, i);
      expect(cache.size).toBe(100);
    });
  });

  describe('stats()', () => {
    it('tracks hits, misses, and hitRate', () => {
      const cache = new LRUCache<string, number>();
      cache.set('a', 1);
      cache.get('a'); // hit
      cache.get('a'); // hit
      cache.get('b'); // miss
      const stats = cache.stats();
      expect(stats.size).toBe(1);
      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(1);
      expect(stats.hitRate).toBeCloseTo(2 / 3);
    });

    it('hitRate is 0 when no reads have happened', () => {
      const cache = new LRUCache<string, number>();
      expect(cache.stats().hitRate).toBe(0);
    });

    it('resetStats() zeros counters but preserves entries', () => {
      const cache = new LRUCache<string, number>();
      cache.set('a', 1);
      cache.get('a');
      cache.get('b');
      cache.resetStats();
      const stats = cache.stats();
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
      expect(cache.get('a')).toBe(1);
    });
  });
});
