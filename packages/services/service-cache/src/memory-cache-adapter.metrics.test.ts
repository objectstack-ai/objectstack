// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { InMemoryMetricsRegistry, SEMCONV } from '@objectstack/observability';
import { MemoryCacheAdapter } from './memory-cache-adapter.js';

describe('MemoryCacheAdapter instrumentation', () => {
    it('emits cache_lookups_total{result=hit|miss} on get()', async () => {
        const metrics = new InMemoryMetricsRegistry();
        const cache = new MemoryCacheAdapter({ metrics });
        await cache.set('k', 'v');
        await cache.get('k');           // hit
        await cache.get('missing');     // miss

        expect(metrics.totalCounter(SEMCONV.cacheLookupsTotal, { adapter: 'memory', result: 'hit' })).toBe(1);
        expect(metrics.totalCounter(SEMCONV.cacheLookupsTotal, { adapter: 'memory', result: 'miss' })).toBe(1);
    });

    it('emits a miss when an entry has expired', async () => {
        const metrics = new InMemoryMetricsRegistry();
        const cache = new MemoryCacheAdapter({ metrics });
        await cache.set('k', 'v', 0.001); // 1ms ttl
        await new Promise((r) => setTimeout(r, 5));
        expect(await cache.get('k')).toBeUndefined();
        expect(metrics.totalCounter(SEMCONV.cacheLookupsTotal, { adapter: 'memory', result: 'miss' })).toBe(1);
        expect(metrics.totalCounter(SEMCONV.cacheLookupsTotal, { adapter: 'memory', result: 'hit' })).toBe(0);
    });

    it('emits cache_writes_total{op=set|delete|clear}', async () => {
        const metrics = new InMemoryMetricsRegistry();
        const cache = new MemoryCacheAdapter({ metrics });
        await cache.set('a', 1);
        await cache.set('b', 2);
        await cache.delete('a');
        await cache.clear();

        expect(metrics.totalCounter(SEMCONV.cacheWritesTotal, { adapter: 'memory', op: 'set' })).toBe(2);
        expect(metrics.totalCounter(SEMCONV.cacheWritesTotal, { adapter: 'memory', op: 'delete' })).toBe(1);
        expect(metrics.totalCounter(SEMCONV.cacheWritesTotal, { adapter: 'memory', op: 'clear' })).toBe(1);
    });

    it('has() emits hit / miss', async () => {
        const metrics = new InMemoryMetricsRegistry();
        const cache = new MemoryCacheAdapter({ metrics });
        await cache.set('k', 'v');
        expect(await cache.has('k')).toBe(true);
        expect(await cache.has('missing')).toBe(false);
        expect(metrics.totalCounter(SEMCONV.cacheLookupsTotal, { adapter: 'memory', result: 'hit' })).toBe(1);
        expect(metrics.totalCounter(SEMCONV.cacheLookupsTotal, { adapter: 'memory', result: 'miss' })).toBe(1);
    });

    it('records no metrics when no registry is provided (backwards-compat)', async () => {
        const cache = new MemoryCacheAdapter();
        await cache.set('k', 'v');
        expect(await cache.get('k')).toBe('v');
        // Constructing with no metrics option must not crash.
    });
});
