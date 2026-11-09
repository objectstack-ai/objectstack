// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Which adapter backs `cache`, by topology — and that the single-node default
 * is exactly what it was.
 *
 * The rule (`planCacheAdapter`'s header): memory unless the deployment
 * DECLARES multi-node and the cluster driver is `redis`; then one Redis cache
 * over the driver's connection; a declared multi-node redis deployment that
 * would end up with a per-process cache refuses the boot.
 *
 * Three layers: the pure decision table; the plugin's `init` against a context
 * double (what it registers and what it logs — the single-node boot line is
 * pinned verbatim); and real `ObjectKernel` boots composing the real cluster
 * plugin and the real redis driver over `ioredis-mock`, which is what
 * `optionalDependencies` and the driver's connection offer are only true in.
 */

// @ts-expect-error — ioredis-mock has no published types
import RedisMock from 'ioredis-mock';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { createServer, type AddressInfo } from 'node:net';
import {
  ClusterDriverLiveness,
  ClusterServicePlugin,
  offerClusterDriverConnection,
  offerClusterDriverLiveness,
  onClusterResync,
  readClusterDriverHealth,
} from '@objectstack/service-cluster';
// Importing the driver registers `redis` with `defineCluster()` — at module
// eval, so no test body pays the cold load.
import { createRedisClient } from '@objectstack/service-cluster-redis';

import { CacheServicePlugin, planCacheAdapter, type CacheAdapterPlanInput } from './cache-service-plugin.js';
import { MemoryCacheAdapter } from './memory-cache-adapter.js';
import { RedisCacheAdapter, type RedisCacheClient } from './redis-cache-adapter.js';

const opened: Array<{ quit(): Promise<unknown> }> = [];
function mockClient(): RedisCacheClient {
  const client = new RedisMock() as RedisCacheClient;
  opened.push(client);
  return client;
}

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(opened.splice(0).map((c) => c.quit().catch(() => undefined)));
});

/** A cluster double offering a redis connection, the way the redis driver's facade does. */
function redisCluster(client: RedisCacheClient = mockClient(), keyPrefix = 'os:'): object {
  const cluster = { driver: 'redis', nodeId: 'n1' };
  offerClusterDriverConnection(cluster, { driver: 'redis', client, keyPrefix });
  return cluster;
}

function plan(input: Partial<CacheAdapterPlanInput> & Pick<CacheAdapterPlanInput, 'multiNode'>) {
  return planCacheAdapter({ cluster: () => undefined, ...input });
}

describe('planCacheAdapter — the decision table', () => {
  it('single node, nothing requested: memory, and the cluster is never read', () => {
    const cluster = vi.fn(() => redisCluster());
    expect(plan({ multiNode: false, cluster })).toEqual({ kind: 'memory' });
    expect(plan({ multiNode: false, adapter: 'memory', cluster })).toEqual({ kind: 'memory' });
    expect(cluster).not.toHaveBeenCalled();
  });

  it('single node over the redis driver stays memory — Redis is chosen by the DECLARATION, not by the driver alone', () => {
    expect(plan({ multiNode: false, cluster: () => redisCluster() })).toEqual({ kind: 'memory' });
  });

  it('multi-node over redis: Redis, on a duplicate of the driver\'s connection (own lifecycle) under its prefix', () => {
    const base = mockClient();
    const result = plan({ multiNode: true, cluster: () => redisCluster(base, 'acme:') });
    expect(result).toMatchObject({ kind: 'redis', ownsClient: true, keyPrefix: 'acme:', source: 'cluster-driver' });
    if (result.kind !== 'redis') throw new Error('unreachable');
    expect(result.client).not.toBe(base);
    opened.push(result.client);
  });

  it('a driver client that cannot duplicate is borrowed as-is, and then never closed by the cache', () => {
    const { duplicate: _drop, ...noDup } = { ...stubClient(), duplicate: undefined };
    const result = plan({ multiNode: true, cluster: () => redisCluster(noDup as RedisCacheClient) });
    expect(result).toMatchObject({ kind: 'redis', ownsClient: false, source: 'cluster-driver' });
    if (result.kind === 'redis') expect(result.client).toBe(noDup);
  });

  it('multi-node over redis with `adapter: \'memory\'`: refused — a per-process cache would multiply every limit', () => {
    const result = plan({ multiNode: true, adapter: 'memory', cluster: () => redisCluster() });
    expect(result.kind).toBe('refuse');
    if (result.kind === 'refuse') expect(result.message).toMatch(/per-process cache[\s\S]*Drop `adapter`/);
  });

  it('multi-node over a redis driver that offers no connection: refused, naming the version to install', () => {
    const result = plan({ multiNode: true, cluster: () => ({ driver: 'redis', nodeId: 'n1' }) });
    expect(result.kind).toBe('refuse');
    if (result.kind === 'refuse') expect(result.message).toMatch(/offers no connection[\s\S]*service-cluster-redis/);
  });

  it('multi-node over the memory driver (the split-brain override): memory, with a warning that names the cost', () => {
    const result = plan({ multiNode: true, cluster: () => ({ driver: 'memory', nodeId: 'n1' }) });
    expect(result.kind).toBe('memory');
    if (result.kind === 'memory') expect(result.notice).toMatch(/cluster driver is "memory", not redis[\s\S]*multiply by the replica count/);
  });

  it('multi-node with no cluster service at all: memory, with the same warning', () => {
    const result = plan({ multiNode: true, cluster: () => undefined });
    expect(result.kind).toBe('memory');
    if (result.kind === 'memory') expect(result.notice).toMatch(/cluster driver is not registered/);
  });

  it('an injected `redis.client` wins over the driver\'s connection, and is never owned', () => {
    const own = stubClient();
    expect(plan({ multiNode: true, redis: { client: own }, cluster: () => redisCluster() })).toEqual({
      kind: 'redis', client: own, ownsClient: false, keyPrefix: 'os:', source: 'injected-client',
    });
    expect(plan({ multiNode: false, adapter: 'redis', redis: { client: own, keyPrefix: 'x:' } })).toMatchObject({
      kind: 'redis', client: own, keyPrefix: 'x:', source: 'injected-client',
    });
  });

  it('`adapter: \'redis\'` on a single node uses the driver\'s connection when there is one', () => {
    const result = plan({ multiNode: false, adapter: 'redis', cluster: () => redisCluster() });
    expect(result).toMatchObject({ kind: 'redis', source: 'cluster-driver' });
    if (result.kind === 'redis') opened.push(result.client);
  });

  it('`adapter: \'redis\'` with no connection anywhere is refused — and says `redisUrl` is not read', () => {
    const bare = plan({ multiNode: false, adapter: 'redis' });
    const withUrl = plan({ multiNode: false, adapter: 'redis', redisUrl: 'redis://localhost:6379' });
    expect(bare.kind).toBe('refuse');
    expect(withUrl.kind).toBe('refuse');
    if (withUrl.kind === 'refuse') expect(withUrl.message).toMatch(/`redisUrl` is not read/);
  });
});

function stubClient(): RedisCacheClient {
  return {
    get: async () => null,
    set: async () => 'OK',
    del: async () => 0,
    exists: async () => 0,
    scan: async () => ['0', []],
    quit: async () => 'OK',
  };
}

/** A PluginContext double that records registrations, service reads and log lines. */
function makeCtx(seed: Record<string, unknown> = {}) {
  const services = new Map<string, unknown>(Object.entries(seed));
  const reads: string[] = [];
  const logs: Array<[level: string, message: string]> = [];
  const hooks = new Map<string, Array<() => Promise<void>>>();
  const ctx = {
    logger: {
      info: (m: string) => { logs.push(['info', m]); },
      warn: (m: string) => { logs.push(['warn', m]); },
      error: (m: string) => { logs.push(['error', m]); },
    },
    registerService: (name: string, svc: unknown) => { services.set(name, svc); },
    getService: <T>(name: string): T => {
      reads.push(name);
      if (!services.has(name)) throw new Error(`service '${name}' not registered`);
      return services.get(name) as T;
    },
    hook: (name: string, fn: () => Promise<void>) => {
      hooks.set(name, [...(hooks.get(name) ?? []), fn]);
    },
  };
  return { ctx: ctx as any, services, reads, logs, hooks };
}

describe('CacheServicePlugin.init — the single-node default is unchanged', () => {
  it('registers a MemoryCacheAdapter, logs the one line it always logged, warns nothing, reads no cluster', async () => {
    const { ctx, services, reads, logs } = makeCtx({ cluster: redisCluster() });
    await new CacheServicePlugin().init(ctx);

    expect(services.get('cache')).toBeInstanceOf(MemoryCacheAdapter);
    expect(logs).toEqual([['info', 'CacheServicePlugin: registered memory cache adapter (metrics=NoopMetricsRegistry)']]);
    expect(reads).not.toContain('cluster');
  });

  it('declares the cluster plugin as an optional dependency, so a composed cluster always initialises first', () => {
    expect(new CacheServicePlugin().optionalDependencies).toEqual(['com.objectstack.service.cluster']);
  });
});

describe('CacheServicePlugin.init — a declared multi-node deployment', () => {
  it('over redis: registers a RedisCacheAdapter, says so at info, and closes its own connection on shutdown', async () => {
    vi.stubEnv('OS_CLUSTER_REPLICAS', '3');
    const { ctx, services, logs, hooks } = makeCtx({ cluster: redisCluster() });
    await new CacheServicePlugin().init(ctx);

    const cache = services.get('cache');
    expect(cache).toBeInstanceOf(RedisCacheAdapter);
    expect(logs).toHaveLength(1);
    expect(logs[0]![0]).toBe('info');
    expect(logs[0]![1]).toMatch(/registered redis cache adapter[\s\S]*connection=cluster-driver, namespace=os:cache:/);

    for (const fn of hooks.get('kernel:shutdown') ?? []) await fn();
    await expect((cache as RedisCacheAdapter).get('k')).rejects.toThrow('closed');
  });

  it('OS_EXPECT_MULTI_NODE=true is the same declaration as OS_CLUSTER_REPLICAS>1', async () => {
    vi.stubEnv('OS_EXPECT_MULTI_NODE', 'true');
    const { ctx, services } = makeCtx({ cluster: redisCluster() });
    await new CacheServicePlugin().init(ctx);
    expect(services.get('cache')).toBeInstanceOf(RedisCacheAdapter);
    await (services.get('cache') as RedisCacheAdapter).close();
  });

  it('over redis with `adapter: \'memory\'`: init throws and registers nothing', async () => {
    vi.stubEnv('OS_CLUSTER_REPLICAS', '2');
    const { ctx, services } = makeCtx({ cluster: redisCluster() });
    await expect(new CacheServicePlugin({ adapter: 'memory' }).init(ctx)).rejects.toThrow(/per-process cache/);
    expect(services.has('cache')).toBe(false);
  });

  it('over the memory driver: registers memory and warns once, after the unchanged info line', async () => {
    vi.stubEnv('OS_CLUSTER_REPLICAS', '2');
    const { ctx, services, logs } = makeCtx({ cluster: { driver: 'memory', nodeId: 'n1' } });
    await new CacheServicePlugin().init(ctx);
    expect(services.get('cache')).toBeInstanceOf(MemoryCacheAdapter);
    expect(logs.map(([level]) => level)).toEqual(['info', 'warn']);
    expect(logs[1]![1]).toMatch(/cluster driver is "memory", not redis/);
  });
});

describe('real ObjectKernel boots — cluster plugin + redis driver over ioredis-mock', () => {
  async function boot(cache: CacheServicePlugin, client: RedisCacheClient, opts: { cacheFirst?: boolean } = {}) {
    // `skipSystemValidation`: these boots compose only what the cache decision
    // reads; the kernel's required-service check (a `data` engine) is not the
    // subject here.
    const kernel = new ObjectKernel({ logger: { level: 'silent' }, skipSystemValidation: true } as any);
    const cluster = new ClusterServicePlugin({ config: { driver: 'redis', nodeId: `node-${Math.random()}`, driverOptions: { client } } });
    // Registration order must not matter: `optionalDependencies` hoists the
    // cluster plugin ahead of the cache whichever was `use`d first.
    if (opts.cacheFirst) {
      await kernel.use(cache);
      await kernel.use(cluster);
    } else {
      await kernel.use(cluster);
      await kernel.use(cache);
    }
    await kernel.bootstrap();
    return kernel;
  }

  it('two declared-multi-node kernels on one Redis share ONE cache — even with the cache plugin registered first', async () => {
    vi.stubEnv('OS_CLUSTER_REPLICAS', '2');
    const nodeA = await boot(new CacheServicePlugin(), mockClient(), { cacheFirst: true });
    const nodeB = await boot(new CacheServicePlugin(), mockClient());
    try {
      const cacheA = nodeA.getService<RedisCacheAdapter>('cache');
      const cacheB = nodeB.getService<RedisCacheAdapter>('cache');
      expect(cacheA).toBeInstanceOf(RedisCacheAdapter);
      expect(cacheB).toBeInstanceOf(RedisCacheAdapter);
      await cacheA.set('kernel-shared', { n: 1 }, 60);
      expect(await cacheB.get('kernel-shared')).toEqual({ n: 1 });
      await cacheB.delete('kernel-shared');
    } finally {
      await nodeA.shutdown();
      await nodeB.shutdown();
    }
  });

  it('a single-node kernel over the same redis driver keeps the memory cache', async () => {
    const kernel = await boot(new CacheServicePlugin(), mockClient());
    try {
      expect(kernel.getService('cache')).toBeInstanceOf(MemoryCacheAdapter);
    } finally {
      await kernel.shutdown();
    }
  });

  it('a declared multi-node kernel with `adapter: \'memory\'` refuses to boot', async () => {
    vi.stubEnv('OS_CLUSTER_REPLICAS', '2');
    await expect(boot(new CacheServicePlugin({ adapter: 'memory' }), mockClient())).rejects.toThrow(/per-process cache/);
  });
});

describe('the derived connection reports its outage — never an unhandled error event', () => {
  /** A port nothing listens on: every connect attempt is refused at once. */
  async function refusedPort(): Promise<number> {
    const server = createServer();
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const { port } = server.address() as AddressInfo;
    await new Promise<void>((r) => server.close(() => r()));
    return port;
  }

  /** Records the connection the cache derives through `base.duplicate()`. */
  function captureDerived<C extends { duplicate?: () => unknown }>(base: C): { client?: any } {
    const box: { client?: any } = {};
    const original = base.duplicate!.bind(base);
    base.duplicate = () => (box.client = original());
    return box;
  }

  async function until(check: () => boolean, what: string): Promise<void> {
    const deadline = Date.now() + 5_000;
    while (!check()) {
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
      await new Promise((r) => setTimeout(r, 10));
    }
  }

  function livenessFor(cluster: object, port?: number) {
    const warns: string[] = [];
    const liveness = new ClusterDriverLiveness({
      driver: 'redis',
      nodeId: 'n1',
      target: port === undefined ? undefined : `127.0.0.1:${port}`,
      logger: { warn: (m) => warns.push(m), info: () => {} },
    });
    offerClusterDriverLiveness(cluster, liveness);
    return { liveness, warns };
  }

  async function shutdown(hooks: Map<string, Array<() => Promise<void>>>): Promise<void> {
    for (const fn of hooks.get('kernel:shutdown') ?? []) await fn();
  }

  /** Real ioredis against a refused port, with a password in the URL and a fast reconnect. */
  async function refusedRedis() {
    const port = await refusedPort();
    const base = createRedisClient({
      url: `redis://:s3cret@127.0.0.1:${port}`,
      options: { retryStrategy: () => 20, maxRetriesPerRequest: 1 },
    });
    const derived = captureDerived(base);
    const cluster = { driver: 'redis', nodeId: 'n1' };
    offerClusterDriverConnection(cluster, { driver: 'redis', client: base, keyPrefix: 'os:' });
    return { port, base, derived, cluster };
  }

  /** Init a multi-node cache over `cluster`, fail a GET, and let the derived connection retry a few times. */
  async function failThroughOutage(cluster: object, derived: { client?: any }) {
    vi.stubEnv('OS_CLUSTER_REPLICAS', '2');
    const { ctx, services, logs, hooks } = makeCtx({ cluster });
    await new CacheServicePlugin().init(ctx);
    let reconnects = 0;
    derived.client.on('reconnecting', () => { reconnects += 1; });
    await expect((services.get('cache') as RedisCacheAdapter).get('k')).rejects.toThrow();
    await until(() => reconnects >= 3, 'three reconnect attempts');
    return { logs, hooks };
  }

  const unhandledLines = (spy: { mock: { calls: unknown[][] } }) =>
    spy.mock.calls.filter((call) => String(call[0]).includes('Unhandled error event'));

  it('a refused store over the redis driver: no unhandled error event, ONE outage warning in the driver\'s liveness, no credential', async () => {
    const { port, base, derived, cluster } = await refusedRedis();
    const { warns } = livenessFor(cluster, port);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { logs, hooks } = await failThroughOutage(cluster, derived);
      expect(unhandledLines(consoleError)).toEqual([]);
      expect(warns).toHaveLength(1);
      expect(warns[0]).toMatch(/lost its connection/);
      expect(warns.join('\n')).not.toContain('s3cret');
      expect(readClusterDriverHealth(cluster)).toMatchObject({ state: 'down', outages: 1 });
      // The plugin adds no outage line of its own.
      expect(logs.filter(([level]) => level !== 'info')).toEqual([]);
      await shutdown(hooks);
    } finally {
      consoleError.mockRestore();
      derived.client?.disconnect();
      base.disconnect();
    }
  });

  it('a driver that offers no liveness: still no unhandled error event — the outage is logged once through the plugin\'s logger', async () => {
    const { base, derived, cluster } = await refusedRedis();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { logs, hooks } = await failThroughOutage(cluster, derived);
      expect(unhandledLines(consoleError)).toEqual([]);
      const warnings = logs.filter(([level]) => level === 'warn').map(([, message]) => message);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatch(/lost its connection/);
      expect(warnings[0]).not.toContain('s3cret');
      await shutdown(hooks);
    } finally {
      consoleError.mockRestore();
      derived.client?.disconnect();
      base.disconnect();
    }
  });

  it('a deliberate shutdown is not an outage: the cache detaches before it quits its connection', async () => {
    vi.stubEnv('OS_CLUSTER_REPLICAS', '2');
    const base = mockClient();
    const derived = captureDerived(base as { duplicate?: () => unknown });
    const cluster = redisCluster(base);
    const { warns } = livenessFor(cluster);
    const { ctx, hooks } = makeCtx({ cluster });
    await new CacheServicePlugin().init(ctx);
    derived.client.emit('ready');
    expect(readClusterDriverHealth(cluster)?.state).toBe('up');
    // ioredis emits `close` when the quit closes the socket.
    const quit = derived.client.quit.bind(derived.client);
    derived.client.quit = async () => { derived.client.emit('close'); return quit(); };

    await shutdown(hooks);

    expect(warns).toEqual([]);
    expect(readClusterDriverHealth(cluster)).toMatchObject({ state: 'up', outages: 0 });
  });

  it('`cluster.resync` waits for the cache\'s connection too — the reason it shares the driver\'s liveness', async () => {
    vi.stubEnv('OS_CLUSTER_REPLICAS', '2');
    const base = mockClient() as any;
    const derived = captureDerived(base);
    const cluster = redisCluster(base);
    const { liveness, warns } = livenessFor(cluster);
    liveness.watchConnection(base, 'command');
    const { ctx, hooks } = makeCtx({ cluster });
    await new CacheServicePlugin().init(ctx);
    let resyncs = 0;
    onClusterResync(cluster, () => { resyncs += 1; });

    derived.client.emit('error', new Error('ECONNREFUSED'));
    base.emit('error', new Error('ECONNREFUSED'));
    base.emit('ready');
    expect(resyncs).toBe(0);
    expect(readClusterDriverHealth(cluster)?.state).toBe('down');

    derived.client.emit('ready');
    expect(resyncs).toBe(1);
    expect(warns).toHaveLength(1);
    await shutdown(hooks);
  });

  it('CONTROL: an injected client is its owner\'s — the cache attaches no listener to it', async () => {
    vi.stubEnv('OS_CLUSTER_REPLICAS', '2');
    const own = mockClient() as any;
    const before = ['error', 'close', 'ready'].map((e) => own.listenerCount(e));
    const cluster = redisCluster();
    livenessFor(cluster);
    const { ctx, hooks } = makeCtx({ cluster });
    await new CacheServicePlugin({ redis: { client: own } }).init(ctx);
    expect(['error', 'close', 'ready'].map((e) => own.listenerCount(e))).toEqual(before);
    await shutdown(hooks);
  });
});
