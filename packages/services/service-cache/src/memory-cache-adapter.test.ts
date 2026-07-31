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
