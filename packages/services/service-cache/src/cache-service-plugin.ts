// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { Plugin, PluginContext } from '@objectstack/core';
import {
  OBSERVABILITY_METRICS_SERVICE,
  NoopMetricsRegistry,
  type MetricsRegistry,
} from '@objectstack/observability';
import { MemoryCacheAdapter } from './memory-cache-adapter.js';
import type { MemoryCacheAdapterOptions } from './memory-cache-adapter.js';

/**
 * Configuration options for the CacheServicePlugin.
 */
export interface CacheServicePluginOptions {
  /** Cache adapter type (default: 'memory') */
  adapter?: 'memory' | 'redis';
  /** Options for the memory cache adapter */
  memory?: MemoryCacheAdapterOptions;
  /** Redis connection URL (used when adapter is 'redis') */
  redisUrl?: string;
  /**
   * Optional explicit metrics backend. Wins over the service-registry
   * lookup. Mostly an escape hatch for tests — production code should
   * register `ObservabilityServicePlugin` (from `@objectstack/runtime`)
   * once and let every service pick the host's metrics backend up
   * automatically.
   */
  metrics?: MetricsRegistry;
}

/**
 * CacheServicePlugin — Production ICacheService implementation.
 *
 * Registers a cache service with the kernel during the init phase.
 * Supports in-memory and Redis adapters.
 *
 * ## Metrics
 *
 * The adapter emits `cache_lookups_total` and `cache_writes_total`
 * counters (see `SEMCONV` in `@objectstack/observability`). The
 * MetricsRegistry is resolved in this order:
 *
 *   1. `options.metrics` (explicit constructor wiring)
 *   2. `ctx.getService('observability:metrics')` (registered by
 *      `ObservabilityServicePlugin`)
 *   3. `NoopMetricsRegistry` (silent; no instrumentation)
 *
 * @example
 * ```ts
 * import { ObjectKernel } from '@objectstack/core';
 * import { CacheServicePlugin } from '@objectstack/service-cache';
 *
 * const kernel = new ObjectKernel();
 * kernel.use(new CacheServicePlugin({ adapter: 'memory', memory: { maxSize: 1000 } }));
 * await kernel.bootstrap();
 *
 * const cache = kernel.getService('cache');
 * await cache.set('key', 'value', 60);
 * ```
 */
export class CacheServicePlugin implements Plugin {
  name = 'com.objectstack.service.cache';
  /**
   * Services init() registers on every path (ADR-0116, #4131) — lets the
   * kernel name this plugin when a consumer requires one before it inits.
   */
  providesServices = ['cache'];
  version = '1.0.0';
  type = 'standard';

  private readonly options: CacheServicePluginOptions;

  constructor(options: CacheServicePluginOptions = {}) {
    this.options = { adapter: 'memory', ...options };
  }

  async init(ctx: PluginContext): Promise<void> {
    const adapter = this.options.adapter;
    if (adapter === 'redis') {
      // Redis adapter is a skeleton — throw an informative error for now
      throw new Error(
        'Redis cache adapter is not yet implemented. ' +
        'Use adapter: "memory" or provide a custom ICacheService via ctx.registerService("cache", impl).'
      );
    }

    const metrics = resolveMetrics(ctx, this.options.metrics);
    const cache = new MemoryCacheAdapter({ ...this.options.memory, metrics });
    ctx.registerService('cache', cache);
    ctx.logger.info(
      `CacheServicePlugin: registered memory cache adapter (metrics=${metrics.constructor?.name ?? 'unknown'})`,
    );
  }
}

/**
 * Look up the host's MetricsRegistry from the service registry, with
 * the canonical fallback chain (explicit override → registered service
 * → noop). Local helper to avoid making `service-cache` depend on
 * `@objectstack/runtime`.
 */
function resolveMetrics(
  ctx: PluginContext,
  override: MetricsRegistry | undefined,
): MetricsRegistry {
  if (override) return override;
  try {
    const m = ctx.getService<MetricsRegistry | undefined>(OBSERVABILITY_METRICS_SERVICE);
    if (m) return m;
  } catch {
    // Service not registered — silent fall-through.
  }
  return new NoopMetricsRegistry();
}
