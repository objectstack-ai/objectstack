// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { Redis, type RedisOptions } from 'ioredis';
import type { ClusterDriverLiveness } from '@objectstack/service-cluster';

/**
 * The longest one Redis command may take before it fails: 2 s.
 *
 * Without a bound a black-holed Redis (a socket that accepts and never
 * answers) holds every caller until ioredis' own connection limits give up —
 * measured at about 30 s for a sign-in counting through the shared cache.
 * Every command this driver and the cache it shares its connection with issue
 * is O(1) (GET/SET/INCR/EVAL of a short script/PUBLISH), answered in well under
 * a millisecond by a healthy server, so 2 s leaves three orders of magnitude
 * for a loaded server or a cross-zone hop while keeping a request that touches
 * an unreachable store to about 2 s. The bound applies to commands queued
 * while the connection is down too (ioredis arms the timer before queueing).
 * It is a default: `options.commandTimeout` overrides it.
 */
export const REDIS_COMMAND_TIMEOUT_MS = 2_000;

/**
 * Options accepted by {@link createRedisClient}.
 *
 * Either pass `url` (e.g. `redis://user:pass@host:6379/0`) or a full
 * ioredis `options` bag. The two are merged with `options` taking
 * precedence so callers can override individual fields parsed from the
 * URL.
 *
 * This factory is intended to be the single Redis-client construction
 * point across ObjectStack — `service-cluster-redis` uses it for the
 * driver, and `service-cache` will eventually share the same connection
 * pool via {@link CreateRedisOptions.existing}.
 */
export interface CreateRedisOptions {
    /** Connection URL. Ignored when `existing` is provided. */
    url?: string;
    /** Extra ioredis options merged on top of `url`. */
    options?: RedisOptions;
    /**
     * Bring-your-own client. When provided, this exact instance is
     * returned and `url`/`options` are ignored — useful for sharing one
     * pool across cluster + cache.
     */
    existing?: Redis;
    /**
     * If true, the returned client is created in lazyConnect mode so the
     * TCP connection happens on first command rather than at construction.
     * Default: true (matches ObjectStack's "fail at usage, not boot" stance).
     */
    lazyConnect?: boolean;
}

/**
 * Construct (or reuse) an ioredis client with ObjectStack defaults.
 *
 * Defaults applied when `existing` is absent:
 *   - `lazyConnect: true` — don't crash boot if Redis is briefly down
 *   - `maxRetriesPerRequest: 3` — bound the failure window before surfacing
 *   - `commandTimeout: REDIS_COMMAND_TIMEOUT_MS` — bound a black-holed server
 *     (see {@link REDIS_COMMAND_TIMEOUT_MS}); `client.duplicate()` inherits it,
 *     so the shared cache's derived connection is bounded the same way
 *   - `enableAutoPipelining: true` — modest throughput boost for batch workloads
 *
 * @example
 *   const client = createRedisClient({ url: 'redis://localhost:6379' });
 *
 * @example reuse one pool across services
 *   const shared = createRedisClient({ url });
 *   const clusterClient = createRedisClient({ existing: shared });
 *   const cacheClient   = createRedisClient({ existing: shared });
 */
export function createRedisClient(opts: CreateRedisOptions = {}): Redis {
    if (opts.existing) return opts.existing;

    const base: RedisOptions = {
        lazyConnect: opts.lazyConnect ?? true,
        maxRetriesPerRequest: 3,
        commandTimeout: REDIS_COMMAND_TIMEOUT_MS,
        enableAutoPipelining: true,
    };

    if (opts.url) {
        return new Redis(opts.url, { ...base, ...opts.options });
    }
    return new Redis({ ...base, ...opts.options });
}

/**
 * Duplicate a Redis client so that pub/sub commands (which monopolize
 * the connection) don't block regular commands. Mirrors the standard
 * ioredis "two clients" pattern.
 */
export function duplicateForPubSub(client: Redis): Redis {
    return client.duplicate();
}

/**
 * Report `client`'s connection transitions to `liveness` under `source`: an
 * `error` or an unexpected `close` is a failure, `ready` is a recovery.
 *
 * Attaching the `error` listener is also what keeps ioredis from printing
 * `[ioredis] Unhandled error event` with a stack per reconnect attempt: the
 * liveness logs the outage once instead, credential-free.
 *
 * @returns a disposer that removes the three listeners — call it BEFORE a
 * deliberate `quit()`, so the close that follows is not reported as an outage.
 */
export function watchRedisConnection(
    client: Redis,
    liveness: ClusterDriverLiveness,
    source: string,
): () => void {
    // The one listener style (`ClusterDriverLiveness.watchConnection`), shared
    // with the connections derived from this one (`watchClusterDriverConnection`).
    return liveness.watchConnection(client, source);
}

/**
 * `host:port` of `client`'s server — never the URL, which can carry a password.
 * `undefined` when the client does not say (a mock, a socket path).
 */
export function describeRedisTarget(client: Redis): string | undefined {
    const options = (client as { options?: { host?: unknown; port?: unknown; path?: unknown } }).options;
    if (!options) return undefined;
    if (typeof options.host === 'string' && options.port !== undefined) return `${options.host}:${String(options.port)}`;
    return undefined;
}
