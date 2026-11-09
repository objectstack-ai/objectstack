// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * @objectstack/service-cluster-redis
 *
 * Redis driver for `@objectstack/service-cluster`. Import this package
 * once at process start to register the `'redis'` driver:
 *
 * ```ts
 * import '@objectstack/service-cluster-redis';
 * import { defineCluster } from '@objectstack/service-cluster';
 *
 * const cluster = defineCluster({
 *     driver: 'redis',
 *     url: 'redis://localhost:6379',
 *     nodeId: 'web-1',
 * });
 * ```
 *
 * The driver also exports raw constructors so callers who already own
 * an ioredis client can compose primitives by hand.
 */

import type { Redis } from 'ioredis';
import {
    ClusterDriverLiveness,
    ComposedClusterService,
    offerClusterDriverConnection,
    offerClusterDriverLiveness,
    registerClusterDriver,
    type ClusterDriverLivenessLogger,
    type DriverFactoryConfig,
} from '@objectstack/service-cluster';
import { createRedisClient, describeRedisTarget, watchRedisConnection } from './client.js';
import { RedisPubSub } from './pubsub.js';
import { RedisLock } from './lock.js';
import { RedisKV } from './kv.js';
import { RedisCounter } from './counter.js';

// Re-exports for advanced composition.
export {
    createRedisClient,
    duplicateForPubSub,
    watchRedisConnection,
    describeRedisTarget,
    REDIS_COMMAND_TIMEOUT_MS,
    type CreateRedisOptions,
} from './client.js';
export { RedisPubSub, type RedisPubSubOptions } from './pubsub.js';
export { RedisLock, type RedisLockOptions } from './lock.js';
export { RedisKV, VersionMismatchError, type RedisKVOptions } from './kv.js';
export { RedisCounter, type RedisCounterOptions } from './counter.js';

/**
 * Driver-specific options accepted under `driverOptions` in
 * `ClusterCapabilityConfig`. All are optional — supply a `client` to
 * share a Redis pool with other services (e.g. `service-cache`).
 */
export interface RedisDriverOptions {
    /** Pre-built ioredis client. When provided, `url` is ignored. */
    client?: Redis;
    /** Key prefix applied to every Redis key (default: 'os:'). */
    keyPrefix?: string;
    /** Default lock TTL in ms. Overridden by `LockAcquireOptions.ttlMs`. */
    lockTtlMs?: number;
    /** Pub/sub subscriber error sink. */
    onError?: (err: unknown, channel: string) => void;
    /** Where the connection-outage lines go (one warning per outage). Default: `console`. */
    logger?: ClusterDriverLivenessLogger;
}

/**
 * Factory consumed by `defineCluster({ driver: 'redis' })`. Builds an
 * `IClusterService` backed by Redis. Owns the underlying ioredis client
 * iff it created it (i.e. when caller didn't pass `driverOptions.client`).
 */
function redisDriverFactory(config: DriverFactoryConfig) {
    const driverOpts = (config.driverOptions ?? {}) as RedisDriverOptions;
    const ownsClient = !driverOpts.client;
    const client =
        driverOpts.client ??
        createRedisClient({ url: config.url });

    const keyPrefix = driverOpts.keyPrefix ?? 'os:';
    const ttlMs = config.lockTtlMs ?? driverOpts.lockTtlMs;

    // One liveness for both connections (command + subscriber): the outage is
    // the store's, logged once; its end emits `cluster.resync` once.
    const liveness = new ClusterDriverLiveness({
        driver: 'redis',
        nodeId: config.nodeId,
        target: describeRedisTarget(client),
        logger: driverOpts.logger,
    });
    const unwatchCommand = watchRedisConnection(client, liveness, 'command');

    const pubsub = new RedisPubSub({
        client,
        nodeId: config.nodeId,
        keyPrefix,
        onError: driverOpts.onError,
        liveness,
    });
    const lock = new RedisLock({
        client,
        keyPrefix,
        defaultTtlMs: ttlMs,
        nodeId: config.nodeId,
    });
    const kv = new RedisKV({ client, keyPrefix });
    const counter = new RedisCounter({ client, keyPrefix });

    const facade = new ComposedClusterService(
        config.nodeId,
        'redis',
        pubsub,
        lock,
        kv,
        counter,
    );

    // Offer the connection for reuse (`offerClusterDriverConnection`): the
    // shared `cache` a multi-node deployment counts its rate limits in
    // (`@objectstack/service-cache`, ADR-0069 D2) reaches THIS Redis through it
    // rather than through a second client configuration that could name a
    // different server. The borrower derives its own connection
    // (`client.duplicate()`) and writes under `<keyPrefix>cache:`; this facade
    // keeps owning `client` and is the only one that closes it.
    offerClusterDriverConnection(facade, { driver: 'redis', client, keyPrefix });
    // Offer the liveness: `readClusterDriverHealth(cluster)` for a passive
    // reading of the connection state (the active store probe is
    // `probeClusterDriverHealth()`), `onClusterResync(cluster, …)` for every
    // cache holding cross-node state.
    offerClusterDriverLiveness(facade, liveness);

    // Wrap close() so we also tear down the publisher client if we own it.
    const originalClose = facade.close.bind(facade);
    facade.close = async () => {
        // A deliberate close is not an outage: stop reporting before anything quits.
        liveness.close();
        unwatchCommand();
        await originalClose();
        if (ownsClient) {
            try { await client.quit(); } catch { /* swallow */ }
        }
    };

    return facade;
}

// Module-load registration — importing this package is enough.
registerClusterDriver('redis', redisDriverFactory);
