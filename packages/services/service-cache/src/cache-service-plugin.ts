// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { Plugin, PluginContext } from '@objectstack/core';
import {
  OBSERVABILITY_METRICS_SERVICE,
  NoopMetricsRegistry,
  type MetricsRegistry,
} from '@objectstack/observability';
import {
  ClusterDriverLiveness,
  declaresMultiNode,
  readClusterDriverConnection,
  readClusterDriverHealth,
  watchClusterDriverConnection,
} from '@objectstack/service-cluster';
import { MemoryCacheAdapter } from './memory-cache-adapter.js';
import type { MemoryCacheAdapterOptions } from './memory-cache-adapter.js';
import { RedisCacheAdapter, type RedisCacheClient } from './redis-cache-adapter.js';

/**
 * Options for the Redis adapter, read whenever the adapter in use is `'redis'`
 * — named explicitly or chosen by topology.
 */
export interface CacheServicePluginRedisOptions {
  /**
   * An ioredis client you own. Wins over the cluster driver's connection; the
   * plugin never closes it. Omit it to share the redis cluster driver's Redis.
   */
  client?: RedisCacheClient;
  /** Key namespace (default: the cluster driver's, `'os:'`). Entries live at `<keyPrefix>cache:<key>`. */
  keyPrefix?: string;
  /** Default TTL in seconds (0 = no expiry). */
  defaultTtl?: number;
}

/**
 * Configuration options for the CacheServicePlugin.
 */
export interface CacheServicePluginOptions {
  /**
   * Cache adapter. Omit it (the default) to let the deployment's topology
   * decide: `'memory'`, unless the deployment DECLARES multi-node
   * (`OS_EXPECT_MULTI_NODE=true` / `OS_CLUSTER_REPLICAS` > 1) and the cluster
   * driver is `redis` — then `'redis'`, over the cluster driver's connection.
   * Naming it overrides the choice, except that a per-process `'memory'` cache
   * is refused in a declared multi-node redis deployment.
   */
  adapter?: 'memory' | 'redis';
  /** Options for the memory cache adapter */
  memory?: MemoryCacheAdapterOptions;
  /** Options for the Redis cache adapter. */
  redis?: CacheServicePluginRedisOptions;
  /**
   * @deprecated Never read: the plugin constructs no Redis client from a URL.
   * The Redis a deployment shares is the cluster driver's (`OS_CLUSTER_DRIVER=redis`
   * + `OS_REDIS_URL`); a host with its own client passes `redis.client`.
   */
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

/** What {@link planCacheAdapter} decided. */
export type CacheAdapterPlan =
  | {
      readonly kind: 'memory';
      /** A multi-node deployment this plugin cannot share a cache for: said once, at `warn`. */
      readonly notice?: string;
    }
  | {
      readonly kind: 'redis';
      readonly client: RedisCacheClient;
      readonly ownsClient: boolean;
      readonly keyPrefix: string;
      /** Where the connection came from, for the boot line. */
      readonly source: 'cluster-driver' | 'injected-client';
    }
  | { readonly kind: 'refuse'; readonly message: string };

/** Everything {@link planCacheAdapter} reads. */
export interface CacheAdapterPlanInput {
  readonly adapter?: 'memory' | 'redis';
  readonly redis?: CacheServicePluginRedisOptions;
  readonly redisUrl?: string;
  /** `declaresMultiNode(env)` — the operator's declaration, the same one the split-brain guard reads. */
  readonly multiNode: boolean;
  /**
   * The registered `cluster` service, read lazily and only on the branches
   * that need it — a single-node boot that asked for no Redis never touches it.
   */
  readonly cluster: () => unknown;
}

const REDIS_FIX =
  'run the redis cluster driver (OS_CLUSTER_DRIVER=redis with OS_REDIS_URL, from @objectstack/service-cluster-redis) ' +
  'so the cache shares its connection, or pass `redis.client`';

/**
 * Decide which adapter backs the `cache` service. Pure — every input is an
 * argument — so the whole decision table is pinned without a kernel.
 *
 * The rule (cloud ADR-0010 path A's declaration, ADR-0069 D2's shared counter):
 *
 * 1. `adapter: 'redis'` → Redis, over `redis.client` or else the redis cluster
 *    driver's connection; neither ⇒ refuse.
 * 2. No multi-node declaration → memory. The single-node default: nothing else
 *    is read, so its boot is the one it always was.
 * 3. Multi-node declared over the `redis` cluster driver → Redis (`redis.client`
 *    or the driver's connection). A per-process cache here is refused, whether
 *    named (`adapter: 'memory'`) or forced by a driver that offers no
 *    connection — N replicas each counting alone is the hole this closes, and a
 *    boot that would open it must not look healthy.
 * 4. Multi-node declared over any other driver (or none) → memory, with a
 *    `warn`. This plugin shares a cache only over Redis; the declaration still
 *    deserves to hear what that costs.
 */
export function planCacheAdapter(input: CacheAdapterPlanInput): CacheAdapterPlan {
  const requested = input.adapter;
  const injected = input.redis?.client;
  const prefixOverride = input.redis?.keyPrefix;

  const viaInjected = (): CacheAdapterPlan => ({
    kind: 'redis',
    client: injected!,
    ownsClient: false,
    keyPrefix: prefixOverride ?? 'os:',
    source: 'injected-client',
  });
  const viaCluster = (): CacheAdapterPlan | undefined => {
    const conn = readClusterDriverConnection<RedisCacheClient>(input.cluster(), 'redis');
    if (!conn) return undefined;
    const base = conn.client;
    // Same settings, own connection: the driver's connection carries its
    // WATCH/MULTI state for the coordination KV, and its lifecycle is the
    // driver's. Borrowed as-is only from a client that cannot duplicate.
    const derived = typeof base.duplicate === 'function' ? base.duplicate() : undefined;
    return {
      kind: 'redis',
      client: derived ?? base,
      ownsClient: derived !== undefined,
      keyPrefix: prefixOverride ?? conn.keyPrefix,
      source: 'cluster-driver',
    };
  };

  if (requested === 'redis') {
    if (injected) return viaInjected();
    const plan = viaCluster();
    if (plan) return plan;
    return {
      kind: 'refuse',
      message:
        "CacheServicePlugin: adapter 'redis' was requested but there is no Redis connection to use" +
        (input.redisUrl ? ' (`redisUrl` is not read: this plugin constructs no client from a URL)' : '') +
        ` — ${REDIS_FIX}.`,
    };
  }

  if (!input.multiNode) return { kind: 'memory' };

  const cluster = input.cluster();
  const driver = describeDriver(cluster);
  if (driver === 'redis') {
    if (requested === 'memory') {
      return {
        kind: 'refuse',
        message:
          'CacheServicePlugin: a multi-node deployment is declared (OS_EXPECT_MULTI_NODE / OS_CLUSTER_REPLICAS>1) ' +
          "over the redis cluster driver, but `adapter: 'memory'` asks for a per-process cache — every replica " +
          'would keep its own copy, so cache-backed limits (sign-in rate limits, the inbound API budget) would be ' +
          'enforced per replica and multiply by the replica count. Drop `adapter` to share the cluster driver\'s Redis.',
      };
    }
    if (injected) return viaInjected();
    const plan = viaCluster();
    if (plan) return plan;
    return {
      kind: 'refuse',
      message:
        'CacheServicePlugin: a multi-node deployment is declared (OS_EXPECT_MULTI_NODE / OS_CLUSTER_REPLICAS>1) ' +
        'over the redis cluster driver, but the driver offers no connection to share, so the only cache this ' +
        'plugin could register is per-process — and cache-backed limits would then multiply by the replica count. ' +
        'Install @objectstack/service-cluster-redis released with this @objectstack/service-cache (it offers its ' +
        'connection), or pass `redis.client`.',
    };
  }

  return {
    kind: 'memory',
    notice:
      `CacheServicePlugin: a multi-node deployment is declared (OS_EXPECT_MULTI_NODE / OS_CLUSTER_REPLICAS>1) but the ` +
      `cluster driver is ${driver === undefined ? 'not registered' : `"${driver}"`}, not redis — the cache stays ` +
      'per-process, so cache-backed limits (sign-in rate limits, the inbound API budget) are enforced per replica ' +
      `and multiply by the replica count. To share it, ${REDIS_FIX}.`,
  };
}

/** The registered cluster's driver name, or `undefined` with no cluster service. */
function describeDriver(cluster: unknown): string | undefined {
  if (!cluster || typeof cluster !== 'object') return undefined;
  const driver = (cluster as { driver?: unknown }).driver;
  return typeof driver === 'string' ? driver : undefined;
}

/**
 * CacheServicePlugin — Production ICacheService implementation.
 *
 * Registers a cache service with the kernel during the init phase.
 * Supports in-memory and Redis adapters; which one is {@link planCacheAdapter}'s
 * call (the single-node default is memory, and its boot is unchanged).
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
 * kernel.use(new CacheServicePlugin({ memory: { maxSize: 1000 } }));
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
  /**
   * ADR-0116: when the cluster plugin is composed it initialises first, so the
   * `cluster` service {@link planCacheAdapter} reads on a multi-node or Redis
   * boot is already registered — its absence is then a fact, not a race.
   */
  optionalDependencies = ['com.objectstack.service.cluster'];
  version = '1.0.0';
  type = 'standard' as const;

  private readonly options: CacheServicePluginOptions;

  constructor(options: CacheServicePluginOptions = {}) {
    this.options = { ...options };
  }

  async init(ctx: PluginContext): Promise<void> {
    const plan = planCacheAdapter({
      adapter: this.options.adapter,
      redis: this.options.redis,
      redisUrl: this.options.redisUrl,
      multiNode: declaresMultiNode(),
      cluster: () => readRegisteredCluster(ctx),
    });
    if (plan.kind === 'refuse') {
      // Same posture as the cluster split-brain guard: a declared topology the
      // composition cannot honour fails the boot, before anything registers.
      throw new Error(plan.message);
    }

    const metrics = resolveMetrics(ctx, this.options.metrics);

    if (plan.kind === 'redis') {
      const cache = new RedisCacheAdapter({
        client: plan.client,
        keyPrefix: plan.keyPrefix,
        defaultTtl: this.options.redis?.defaultTtl,
        metrics,
        ownsClient: plan.ownsClient,
      });
      ctx.registerService('cache', cache);
      // Only the connection this plugin derived is watched: an injected client
      // and a borrowed driver connection belong to their owners, who listen.
      const unwatch =
        plan.ownsClient && plan.source === 'cluster-driver'
          ? watchDerivedConnection(readRegisteredCluster(ctx), plan.client, ctx.logger)
          : () => {};
      ctx.hook('kernel:shutdown', async () => {
        // Detach first: the close the deliberate quit causes is not an outage.
        unwatch();
        await cache.close();
      });
      ctx.logger.info(
        `CacheServicePlugin: registered redis cache adapter — one cache for every node on this Redis ` +
          `(connection=${plan.source}, namespace=${cache.keyNamespace}, metrics=${metrics.constructor?.name ?? 'unknown'})`,
      );
      return;
    }

    const cache = new MemoryCacheAdapter({ ...this.options.memory, metrics });
    ctx.registerService('cache', cache);
    ctx.logger.info(
      `CacheServicePlugin: registered memory cache adapter (metrics=${metrics.constructor?.name ?? 'unknown'})`,
    );
    if (plan.notice) ctx.logger.warn(plan.notice);
  }
}

/** The events a derived ioredis connection emits, checked structurally (a test double may have none). */
type WatchableConnection = Parameters<ClusterDriverLiveness['watchConnection']>[0];

function isWatchable(client: unknown): client is WatchableConnection {
  const c = client as Partial<Record<'on' | 'off', unknown>> | null;
  return !!c && typeof c.on === 'function' && typeof c.off === 'function';
}

/**
 * Watch the connection this plugin derived from the cluster driver's, so an
 * outage is never an unhandled `error` event (ioredis prints one, with a stack,
 * per reconnect attempt). Returns the disposer to call before the cache quits.
 *
 * - The driver offers a liveness (the redis driver does): the connection
 *   reports into it as `'cache'`, the same way the driver's own connections
 *   do — one outage logs once across all of them, and `cluster.resync` waits
 *   for this connection too.
 * - It offers none (a driver released before the liveness offer): the
 *   connection gets a liveness of its own, so its outage is still logged once,
 *   credential-free, through this plugin's logger — never one line per
 *   reconnect attempt, and never silently swallowed. Nothing subscribes to
 *   that liveness's resync.
 */
function watchDerivedConnection(
  cluster: unknown,
  client: unknown,
  logger: PluginContext['logger'],
): () => void {
  if (!isWatchable(client)) return () => {};
  if (readClusterDriverHealth(cluster) !== undefined) {
    return watchClusterDriverConnection(cluster, client, 'cache');
  }
  const own = new ClusterDriverLiveness({
    driver: describeDriver(cluster) ?? 'redis',
    nodeId: describeNodeId(cluster) ?? 'node',
    logger,
  });
  const unwatch = own.watchConnection(client, 'cache');
  return () => {
    unwatch();
    own.close();
  };
}

/** The registered cluster's node id, or `undefined`. */
function describeNodeId(cluster: unknown): string | undefined {
  if (!cluster || typeof cluster !== 'object') return undefined;
  const nodeId = (cluster as { nodeId?: unknown }).nodeId;
  return typeof nodeId === 'string' ? nodeId : undefined;
}

/**
 * The registered `cluster` service, or `undefined` when none is. Read only by
 * the branches of {@link planCacheAdapter} that need it; `optionalDependencies`
 * above orders the cluster plugin ahead, so "none" here is final.
 */
function readRegisteredCluster(ctx: PluginContext): unknown {
  try {
    return ctx.getService<unknown>('cluster');
  } catch {
    return undefined;
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
