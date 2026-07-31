// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  InMemoryMetricsRegistry,
  OBSERVABILITY_METRICS_SERVICE,
  SEMCONV,
} from '@objectstack/observability';
import { CacheServicePlugin } from './cache-service-plugin.js';

/**
 * Verifies the metrics resolution chain wired in PR #3:
 *   option override → service-registry lookup → noop fallback
 *
 * Without these tests it's easy to silently regress to the pre-PR-3
 * behaviour where the plugin built an unmetered adapter and OTLP saw
 * zero cache traffic.
 */

function makeCtx() {
  const services = new Map<string, any>();
  return {
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    registerService: (name: string, svc: any) => { services.set(name, svc); },
    getService: <T>(name: string): T => {
      const s = services.get(name);
      if (!s) throw new Error(`service '${name}' not registered`);
      return s as T;
    },
    _services: services,
  } as any;
}

describe('CacheServicePlugin observability wiring', () => {
  it('uses an explicit metrics option when provided', async () => {
    const metrics = new InMemoryMetricsRegistry();
    const ctx = makeCtx();
    await new CacheServicePlugin({ metrics }).init(ctx);

    const cache = ctx._services.get('cache');
    await cache.set('k', 'v', 60);
    await cache.get('k');

    expect(metrics.samples.length).toBeGreaterThan(0);
    expect(metrics.samples.some((s) => s.name === SEMCONV.cacheLookupsTotal)).toBe(true);
  });

  it('falls back to the metrics service registered under observability:metrics', async () => {
    const metrics = new InMemoryMetricsRegistry();
    const ctx = makeCtx();
    ctx._services.set(OBSERVABILITY_METRICS_SERVICE, metrics);

    await new CacheServicePlugin().init(ctx);
    const cache = ctx._services.get('cache');
    await cache.set('k', 'v', 60);
    await cache.get('k');

    expect(metrics.samples.some((s) => s.name === SEMCONV.cacheLookupsTotal)).toBe(true);
  });

  it('uses a noop registry when neither option nor service is present', async () => {
    const ctx = makeCtx();
    await new CacheServicePlugin().init(ctx);
    const cache = ctx._services.get('cache');
    // Should not throw — proves the adapter got *something*.
    await cache.set('k', 'v', 60);
    expect(await cache.get('k')).toBe('v');
  });

  it('explicit option wins over a registered service', async () => {
    const fromOption = new InMemoryMetricsRegistry();
    const fromService = new InMemoryMetricsRegistry();
    const ctx = makeCtx();
    ctx._services.set(OBSERVABILITY_METRICS_SERVICE, fromService);

    await new CacheServicePlugin({ metrics: fromOption }).init(ctx);
    const cache = ctx._services.get('cache');
    await cache.set('k', 'v', 60);

    expect(fromOption.samples.length).toBeGreaterThan(0);
    expect(fromService.samples.length).toBe(0);
  });
});
