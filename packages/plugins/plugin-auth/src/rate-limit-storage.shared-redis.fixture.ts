// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ONE replica, as its own OS process, for `rate-limit-storage.shared-redis.test.ts`.
 *
 * Boots the composition a replica's sign-in limit really runs on — the redis
 * cluster driver against the Redis URL in `argv[2]`, then
 * `CacheServicePlugin`, which picks its adapter from this process's
 * `OS_CLUSTER_REPLICAS` — and counts through the same seam `AuthPlugin` wires
 * into better-auth: `rateLimit.customStorage` =
 * `createLazyCacheRateLimitStorage({ resolveCache: () => resolveKernelCache(ctx) })`.
 *
 * It is a separate process on purpose: inside one process `serializePerKey`
 * orders every limiter's read-modify-write on a key through one module-level
 * queue, so two in-process "nodes" can never interleave the way two replicas
 * do. Started by the test with `tsx`, so this file and the limiter it imports
 * are this checkout's source; the framework packages it imports are their
 * built `dist/`.
 *
 * IPC protocol (parent ⇄ this process):
 *   → { type: 'consume', id, key, window, max }  ← { type: 'decision', id, allowed }
 *   → { type: 'exit' }                          (shuts the kernel down, exits 0)
 *   ← { type: 'ready', cache }                  ('redis' | 'memory' | 'other' — the `cache` adapter)
 *   ← { type: 'failed', message }               (boot failed; exits 1)
 */

import { ObjectKernel } from '@objectstack/core';
import { CacheServicePlugin, MemoryCacheAdapter, RedisCacheAdapter } from '@objectstack/service-cache';
import { ClusterServicePlugin } from '@objectstack/service-cluster';
// Registers the `redis` cluster driver with `defineCluster()`.
import '@objectstack/service-cluster-redis';

import { resolveKernelCache } from './kernel-cache.js';
import { createLazyCacheRateLimitStorage } from './rate-limit-storage.js';

type Inbound =
  | { type: 'consume'; id: number; key: string; window: number; max: number }
  | { type: 'exit' };

async function main(): Promise<void> {
  const redisUrl = process.argv[2];
  const nodeId = process.argv[3] ?? `replica-${process.pid}`;
  if (!redisUrl || typeof process.send !== 'function') {
    throw new Error('usage: fork(<this file>, [<redis url>, <node id>]) with an IPC channel');
  }

  const kernel = new ObjectKernel({ logger: { level: 'silent' }, skipSystemValidation: true } as never);
  await kernel.use(new ClusterServicePlugin({ config: { driver: 'redis', url: redisUrl, nodeId } }));
  await kernel.use(new CacheServicePlugin());
  await kernel.bootstrap();

  const ctx = {
    getKernel: () => kernel,
    getService: <T>(name: string): T => kernel.getService<T>(name),
  } as unknown as Parameters<typeof resolveKernelCache>[0];
  const storage = createLazyCacheRateLimitStorage({ resolveCache: () => resolveKernelCache(ctx) });

  process.on('message', (raw: Inbound) => {
    if (raw.type === 'exit') {
      void kernel.shutdown().finally(() => process.exit(0));
      return;
    }
    void storage
      .consume(raw.key, { window: raw.window, max: raw.max })
      .then((d) => process.send!({ type: 'decision', id: raw.id, allowed: d.allowed }))
      .catch((err: unknown) => process.send!({ type: 'decision', id: raw.id, error: String(err) }));
  });

  // By `instanceof`, not `constructor.name`: the bundled `dist/` renames classes.
  const cache = kernel.getService<object>('cache');
  const adapter = cache instanceof RedisCacheAdapter ? 'redis' : cache instanceof MemoryCacheAdapter ? 'memory' : 'other';
  process.send({ type: 'ready', cache: adapter });
}

main().catch((err: unknown) => {
  process.send?.({ type: 'failed', message: err instanceof Error ? err.message : String(err) });
  process.exitCode = 1;
  setTimeout(() => process.exit(1), 50);
});
