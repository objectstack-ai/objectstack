// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  InMemoryMetricsRegistry,
  OBSERVABILITY_METRICS_SERVICE,
  SEMCONV,
} from '@objectstack/observability';
import { StorageServicePlugin } from './storage-service-plugin';

/**
 * Mirror of `cache-service-plugin.metrics.test.ts` — verifies the
 * metrics resolution chain for the storage plugin AND that the
 * `buildAdapterFromValues` path used by settings live-rebuilds carries
 * metrics through to the new adapter.
 */

function makeCtx() {
  const services = new Map<string, any>();
  const hooks: Array<() => Promise<void> | void> = [];
  return {
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    registerService: (name: string, svc: any) => { services.set(name, svc); },
    getService: <T>(name: string): T => {
      const s = services.get(name);
      if (!s) throw new Error(`service '${name}' not registered`);
      return s as T;
    },
    hook: (event: string, fn: () => Promise<void> | void) => {
      if (event === 'kernel:ready') hooks.push(fn);
    },
    _services: services,
    _flushReady: async () => { for (const h of hooks) await h(); },
  } as any;
}

async function tmpRoot(prefix: string): Promise<string> {
  return fs.mkdtemp(join(tmpdir(), prefix));
}

describe('StorageServicePlugin observability wiring', () => {
  it('uses an explicit metrics option when provided', async () => {
    const metrics = new InMemoryMetricsRegistry();
    const ctx = makeCtx();
    const root = await tmpRoot('os-storage-metrics-');

    const plugin = new StorageServicePlugin({
      adapter: 'local',
      local: { rootDir: root },
      bindToSettings: false,
      metrics,
    });
    await plugin.init(ctx);

    const storage = ctx._services.get('storage');
    await storage.upload('k.txt', Buffer.from('hi'));
    await storage.download('k.txt');

    expect(metrics.samples.length).toBeGreaterThan(0);
    expect(metrics.samples.some((s) => s.name === SEMCONV.storageOperationsTotal)).toBe(true);
  });

  it('falls back to the metrics service registered under observability:metrics', async () => {
    const metrics = new InMemoryMetricsRegistry();
    const ctx = makeCtx();
    ctx._services.set(OBSERVABILITY_METRICS_SERVICE, metrics);
    const root = await tmpRoot('os-storage-metrics-');

    await new StorageServicePlugin({
      adapter: 'local',
      local: { rootDir: root },
      bindToSettings: false,
    }).init(ctx);

    const storage = ctx._services.get('storage');
    await storage.upload('k.txt', Buffer.from('hi'));
    expect(metrics.samples.some((s) => s.name === SEMCONV.storageOperationsTotal)).toBe(true);
  });

  it('threads metrics through buildAdapterFromValues (settings rebuild path)', async () => {
    const metrics = new InMemoryMetricsRegistry();
    const ctx = makeCtx();
    ctx._services.set(OBSERVABILITY_METRICS_SERVICE, metrics);
    const root1 = await tmpRoot('os-storage-init-');
    const root2 = await tmpRoot('os-storage-swap-');

    const plugin = new StorageServicePlugin({
      adapter: 'local',
      local: { rootDir: root1 },
      bindToSettings: false,
    });
    await plugin.init(ctx);

    // Use the private rebuild path directly to simulate a settings change.
    // `buildAdapterFromValues` returns a new adapter that should be wired
    // with the same metrics registry resolved during init().
    const next = await (plugin as any).buildAdapterFromValues({ adapter: 'local', local_root: root2 });
    const storage = ctx._services.get('storage');
    storage.swap(next);

    const before = metrics.samples.length;
    await storage.upload('after-swap.txt', Buffer.from('x'));
    expect(metrics.samples.length).toBeGreaterThan(before);
  });

  it('uses a noop registry when neither option nor service is present', async () => {
    const ctx = makeCtx();
    const root = await tmpRoot('os-storage-noop-');
    await new StorageServicePlugin({
      adapter: 'local',
      local: { rootDir: root },
      bindToSettings: false,
    }).init(ctx);
    const storage = ctx._services.get('storage');
    await storage.upload('k.txt', Buffer.from('hi'));
    const buf = await storage.download('k.txt');
    expect(buf.toString('utf-8')).toBe('hi');
  });
});
