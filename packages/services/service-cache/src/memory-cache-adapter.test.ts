// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { MemoryCacheAdapter } from './memory-cache-adapter.js';
import type { ICacheService } from '@objectstack/spec/contracts';

describe('MemoryCacheAdapter', () => {
  it('should implement ICacheService contract', () => {
    const cache: ICacheService = new MemoryCacheAdapter();
    expect(typeof cache.get).toBe('function');
    expect(typeof cache.set).toBe('function');
    expect(typeof cache.delete).toBe('function');
    expect(typeof cache.has).toBe('function');
    expect(typeof cache.clear).toBe('function');
    expect(typeof cache.stats).toBe('function');
  });

  it('should set and get a value', async () => {
    const cache = new MemoryCacheAdapter();
    await cache.set('key1', 'value1');
    expect(await cache.get('key1')).toBe('value1');
  });

  it('should return undefined for missing key', async () => {
    const cache = new MemoryCacheAdapter();
    expect(await cache.get('nonexistent')).toBeUndefined();
  });

  it('should delete a key', async () => {
    const cache = new MemoryCacheAdapter();
    await cache.set('key1', 'value1');
    expect(await cache.delete('key1')).toBe(true);
    expect(await cache.get('key1')).toBeUndefined();
  });

  it('should return false when deleting missing key', async () => {
    const cache = new MemoryCacheAdapter();
    expect(await cache.delete('missing')).toBe(false);
  });

  it('should check if a key exists with has()', async () => {
    const cache = new MemoryCacheAdapter();
    expect(await cache.has('key1')).toBe(false);
    await cache.set('key1', 'value1');
    expect(await cache.has('key1')).toBe(true);
  });

  it('should clear all entries', async () => {
    const cache = new MemoryCacheAdapter();
    await cache.set('a', 1);
    await cache.set('b', 2);
    await cache.clear();
    expect(await cache.has('a')).toBe(false);
    expect(await cache.has('b')).toBe(false);
  });

  it('should expire entries based on TTL', async () => {
    const cache = new MemoryCacheAdapter();
    await cache.set('temp', 'data', 0.001); // 1ms TTL
    await new Promise(r => setTimeout(r, 20));
    expect(await cache.get('temp')).toBeUndefined();
  });

  it('should track hit/miss stats', async () => {
    const cache = new MemoryCacheAdapter();
    await cache.set('key1', 'value1');
    await cache.get('key1');      // hit
    await cache.get('missing');   // miss
    const stats = await cache.stats();
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(1);
    expect(stats.keyCount).toBe(1);
  });

  it('should apply defaultTtl when no TTL is provided', async () => {
    const cache = new MemoryCacheAdapter({ defaultTtl: 0.001 });
    await cache.set('key', 'value');
    await new Promise(r => setTimeout(r, 20));
    expect(await cache.get('key')).toBeUndefined();
  });

  it('should evict oldest entry when maxSize is reached', async () => {
    const cache = new MemoryCacheAdapter({ maxSize: 2 });
    await cache.set('a', 1);
    await cache.set('b', 2);
    await cache.set('c', 3); // should evict 'a'
    expect(await cache.has('a')).toBe(false);
    expect(await cache.get('b')).toBe(2);
    expect(await cache.get('c')).toBe(3);
  });

  it('should not evict when updating existing key at maxSize', async () => {
    const cache = new MemoryCacheAdapter({ maxSize: 2 });
    await cache.set('a', 1);
    await cache.set('b', 2);
    await cache.set('a', 10); // update, not new entry
    expect(await cache.get('a')).toBe(10);
    expect(await cache.get('b')).toBe(2);
  });

  it('should handle has() with expired TTL', async () => {
    const cache = new MemoryCacheAdapter();
    await cache.set('expiring', 'val', 0.001);
    await new Promise(r => setTimeout(r, 20));
    expect(await cache.has('expiring')).toBe(false);
  });
});

// ─── eviction is insertion-order (FIFO), and the class JSDoc says so ─────────
//
// The class comment used to advertise "LRU-style eviction" while `get()` has
// never re-inserted the key it reads, so eviction has always been oldest-
// INSERTED, not least-recently-USED. The comment was corrected rather than the
// code; these tests are what stops that corrected sentence from being another
// unenforced claim.
//
// Every case below is written to be a DISCRIMINATOR: each one passes under the
// shipped FIFO store and fails under an LRU store, because each performs a
// read (or an overwrite) on the oldest entry and then asserts that the entry
// was evicted anyway. A test that merely fills the cache past `maxSize` without
// touching anything first cannot tell the two policies apart, which is how the
// pre-existing eviction tests above sat green over a comment they contradicted.
describe('MemoryCacheAdapter — insertion-order (FIFO) eviction', () => {
  it('a read does NOT refresh eviction order — the read-hot oldest entry is still evicted', async () => {
    const cache = new MemoryCacheAdapter({ maxSize: 2 });
    await cache.set('a', 1);
    await cache.set('b', 2);

    // Read 'a' repeatedly: under LRU this promotes it to most-recently-used and
    // makes 'b' the eviction candidate. Under FIFO it changes nothing at all.
    expect(await cache.get('a')).toBe(1);
    expect(await cache.get('a')).toBe(1);
    expect(await cache.has('a')).toBe(true);

    await cache.set('c', 3);

    expect(await cache.has('a')).toBe(false); // oldest-inserted, evicted despite being hot
    expect(await cache.get('b')).toBe(2);     // untouched, survives — the inverse of LRU
    expect(await cache.get('c')).toBe(3);
  });

  it('an overwrite does NOT refresh eviction order either — Map.set keeps the original slot', async () => {
    const cache = new MemoryCacheAdapter({ maxSize: 2 });
    await cache.set('a', 1);
    await cache.set('b', 2);

    // Overwriting an existing key never evicts (it is not a new key) and never
    // moves the entry: `Map.set` on a present key keeps its insertion position.
    await cache.set('a', 10);
    expect(await cache.get('a')).toBe(10);

    await cache.set('c', 3);

    expect(await cache.has('a')).toBe(false); // freshly written, still the oldest slot
    expect(await cache.get('b')).toBe(2);
    expect(await cache.get('c')).toBe(3);
  });

  it('evicts strictly in insertion order across a longer run, reads notwithstanding', async () => {
    const cache = new MemoryCacheAdapter({ maxSize: 3 });
    await cache.set('a', 1);
    await cache.set('b', 2);
    await cache.set('c', 3);

    // Make 'a' the hottest key in the cache and 'c' the coldest.
    await cache.get('a');
    await cache.get('a');
    await cache.get('a');

    await cache.set('d', 4); // evicts 'a' (first in), not 'c' (least recently used)
    expect(await cache.has('a')).toBe(false);
    expect(await cache.has('c')).toBe(true);

    await cache.set('e', 5); // evicts 'b' — the queue keeps advancing by age
    expect(await cache.has('b')).toBe(false);

    expect(await cache.get('c')).toBe(3);
    expect(await cache.get('d')).toBe(4);
    expect(await cache.get('e')).toBe(5);
    expect((await cache.stats()).keyCount).toBe(3);
  });

  it('leaves the eviction path off entirely at the default maxSize of 0 (unlimited)', async () => {
    const cache = new MemoryCacheAdapter(); // maxSize defaults to 0
    for (let i = 0; i < 50; i++) await cache.set(`k${i}`, i);

    expect(await cache.get('k0')).toBe(0); // the very first key is still there
    expect(await cache.get('k49')).toBe(49);
    expect((await cache.stats()).keyCount).toBe(50);
  });
});
