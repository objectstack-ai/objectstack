// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import {
  NoopMetricsRegistry,
  SEMCONV,
  type MetricsRegistry,
} from '@objectstack/observability';
import type { ICacheService, CacheStats } from '@objectstack/spec/contracts';

/**
 * In-memory cache entry with optional TTL expiry.
 */
interface CacheEntry<T = unknown> {
  value: T;
  expires?: number;
}

/**
 * Configuration options for MemoryCacheAdapter.
 */
export interface MemoryCacheAdapterOptions {
  /** Maximum number of entries before eviction (0 = unlimited) */
  maxSize?: number;
  /** Default TTL in seconds (0 = no expiry) */
  defaultTtl?: number;
  /** Optional MetricsRegistry for instrumentation. Defaults to NoopMetricsRegistry. */
  metrics?: MetricsRegistry;
}

/**
 * In-memory cache adapter implementing ICacheService.
 *
 * Uses a Map-backed store with TTL-based expiry and **insertion-order (FIFO)
 * eviction**: once `maxSize` is reached, a new key evicts the oldest-inserted
 * entry. This is deliberately **not** LRU — neither reading an entry nor
 * overwriting its value moves it back in the queue, so a hot key is evicted on
 * age like any other (pinned by the FIFO tests in `memory-cache-adapter.test.ts`).
 * `maxSize` defaults to `0` (unlimited), which leaves the eviction path off.
 *
 * Suitable for single-process environments, development, and testing.
 */
export class MemoryCacheAdapter implements ICacheService {
  private readonly store = new Map<string, CacheEntry>();
  private hits = 0;
  private misses = 0;
  private readonly maxSize: number;
  private readonly defaultTtl: number;
  private readonly metrics: MetricsRegistry;
  private static readonly LABELS = { adapter: 'memory' } as const;

  constructor(options: MemoryCacheAdapterOptions = {}) {
    this.maxSize = options.maxSize ?? 0;
    this.defaultTtl = options.defaultTtl ?? 0;
    this.metrics = options.metrics ?? new NoopMetricsRegistry();
  }

  private recordLookup(result: 'hit' | 'miss'): void {
    try {
      this.metrics.counter(SEMCONV.cacheLookupsTotal, { ...MemoryCacheAdapter.LABELS, result });
    } catch { /* never throw from instrumentation */ }
  }

  private recordWrite(op: 'set' | 'delete' | 'clear'): void {
    try {
      this.metrics.counter(SEMCONV.cacheWritesTotal, { ...MemoryCacheAdapter.LABELS, op });
    } catch { /* never throw from instrumentation */ }
  }

  async get<T = unknown>(key: string): Promise<T | undefined> {
    const entry = this.store.get(key);
    if (!entry || (entry.expires && Date.now() > entry.expires)) {
      if (entry) this.store.delete(key);
      this.misses++;
      this.recordLookup('miss');
      return undefined;
    }
    this.hits++;
    this.recordLookup('hit');
    return entry.value as T;
  }

  async set<T = unknown>(key: string, value: T, ttl?: number): Promise<void> {
    const effectiveTtl = ttl ?? this.defaultTtl;
    if (this.maxSize > 0 && !this.store.has(key) && this.store.size >= this.maxSize) {
      // Evict oldest entry (first key in Map insertion order)
      const firstKey = this.store.keys().next().value;
      if (firstKey !== undefined) this.store.delete(firstKey);
    }
    this.store.set(key, {
      value,
      expires: effectiveTtl > 0 ? Date.now() + effectiveTtl * 1000 : undefined,
    });
    this.recordWrite('set');
  }

  async delete(key: string): Promise<boolean> {
    const result = this.store.delete(key);
    this.recordWrite('delete');
    return result;
  }

  async has(key: string): Promise<boolean> {
    const entry = this.store.get(key);
    if (!entry) {
      this.recordLookup('miss');
      return false;
    }
    if (entry.expires && Date.now() > entry.expires) {
      this.store.delete(key);
      this.recordLookup('miss');
      return false;
    }
    this.recordLookup('hit');
    return true;
  }

  async clear(): Promise<void> {
    this.store.clear();
    this.recordWrite('clear');
  }

  async stats(): Promise<CacheStats> {
    return {
      hits: this.hits,
      misses: this.misses,
      keyCount: this.store.size,
    };
  }
}
