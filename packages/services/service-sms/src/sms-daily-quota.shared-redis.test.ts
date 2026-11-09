// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0069 D2 for the daily SMS send quota: a deployment that DECLARES
 * multiple replicas and runs the redis cluster driver spends ONE day's quota
 * across replicas — not `quota × replicas`.
 *
 * Each replica is a kernel composed the way one really is: the cluster plugin
 * with the redis driver, then `CacheServicePlugin` (which picks its adapter
 * from `OS_CLUSTER_REPLICAS`), then the real `SmsServicePlugin`, whose day
 * counter counts through `createLazyCounterStore` over `resolveKernelCache` —
 * the resolution every budget counter shares. Nothing here wires the quota to
 * Redis by hand: the shared count is the cache plugin's choice or nothing.
 *
 * The two replicas' `ioredis-mock` clients share one keyspace, the way two
 * replicas' clients share one Redis. The CONTROL beside the shared case runs
 * the same two replicas without the declaration: each keeps a per-process
 * cache and spends the quota on its own. That the two numbers differ is what
 * shows the shared number is the store's doing.
 *
 * Sends alternate between replicas one at a time, so the count is exact; two
 * replicas counting in the same instant can still both be admitted at the
 * boundary (`ICacheService` has no atomic increment), the bounded imprecision
 * ADR-0069 D2 accepts. The cross-PROCESS leg of the same store path, against a
 * real `redis-server`, lives in plugin-auth's
 * `rate-limit-storage.shared-redis.test.ts`.
 */

// @ts-expect-error — ioredis-mock publishes no type declarations
import RedisMock from 'ioredis-mock';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ObjectKernel, type Plugin, type PluginContext } from '@objectstack/core';
import { CacheServicePlugin, MemoryCacheAdapter, RedisCacheAdapter } from '@objectstack/service-cache';
import { ClusterServicePlugin } from '@objectstack/service-cluster';
// Registers the `redis` cluster driver with `defineCluster()`.
import '@objectstack/service-cluster-redis';

import { SmsServicePlugin } from './sms-plugin.js';
import type { SmsService } from './sms-service.js';

const QUOTA = 3;
const ATTEMPTS = QUOTA * 2 + 2;

/** An `sms` settings namespace carrying the quota, the way the settings service serves it. */
function settingsHost(): Plugin {
  return {
    name: 'test.host.settings',
    type: 'standard',
    version: '1.0.0',
    async init(ctx: PluginContext) {
      ctx.registerService('settings', {
        async getNamespace(ns: string) {
          return ns === 'sms' ? { values: { daily_quota: { value: QUOTA, source: 'global' } } } : { values: {} };
        },
      });
    },
  };
}

describe('daily SMS quota across replicas — in-process kernels over ioredis-mock', () => {
  const kernels: ObjectKernel[] = [];
  const clients: Array<{ quit(): Promise<unknown> }> = [];

  beforeEach(async () => {
    // The day counter's key is the UTC date, the same in every case: start each from an empty Redis.
    const admin = new RedisMock();
    await admin.flushall();
    await admin.quit();
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await Promise.all(kernels.splice(0).map((k) => k.shutdown()));
    await Promise.all(clients.splice(0).map((c) => c.quit().catch(() => undefined)));
  });

  async function replica(nodeId: string): Promise<{ kernel: ObjectKernel; sms: SmsService }> {
    const client = new RedisMock();
    clients.push(client);
    const kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false, skipSystemValidation: true } as never);
    await kernel.use(new ClusterServicePlugin({ config: { driver: 'redis', nodeId, driverOptions: { client } } }));
    await kernel.use(new CacheServicePlugin());
    await kernel.use(settingsHost());
    await kernel.use(new SmsServicePlugin());
    await kernel.bootstrap();
    kernels.push(kernel);
    return { kernel, sms: kernel.getService<SmsService>('sms') };
  }

  /** Alternate `ATTEMPTS` sends across the replicas, one at a time; answer how many were admitted. */
  async function admittedAcross(replicas: SmsService[]): Promise<number> {
    let admitted = 0;
    for (let i = 0; i < ATTEMPTS; i++) {
      const result = await replicas[i % replicas.length]!.send({ to: `+1555000${1000 + i}`, body: 'code 123456' });
      if (result.status !== 'failed') admitted++;
    }
    return admitted;
  }

  it('declared multi-node (OS_CLUSTER_REPLICAS=2) over redis: both replicas count in Redis and spend the quota ONCE', async () => {
    vi.stubEnv('OS_CLUSTER_REPLICAS', '2');
    const a = await replica('replica-a');
    const b = await replica('replica-b');
    expect(a.kernel.getService('cache')).toBeInstanceOf(RedisCacheAdapter);
    expect(b.kernel.getService('cache')).toBeInstanceOf(RedisCacheAdapter);
    expect(await admittedAcross([a.sms, b.sms])).toBe(QUOTA);
  });

  it('CONTROL — no declaration: each replica keeps a per-process cache and spends the quota on its own', async () => {
    const a = await replica('replica-a');
    const b = await replica('replica-b');
    expect(a.kernel.getService('cache')).toBeInstanceOf(MemoryCacheAdapter);
    expect(b.kernel.getService('cache')).toBeInstanceOf(MemoryCacheAdapter);
    expect(await admittedAcross([a.sms, b.sms])).toBe(QUOTA * 2);
  });
});
