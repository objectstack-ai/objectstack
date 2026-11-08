// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A remote cluster driver's connection, offered for reuse.
 *
 * A remote driver (`@objectstack/service-cluster-redis`) holds the one client
 * configuration a deployment wrote for its shared store (`OS_REDIS_URL`, or a
 * `driverOptions.client`). A service that must reach the SAME store — the
 * shared `cache` a multi-node deployment's rate-limit counters count in
 * (ADR-0069 D2) — reads it from here instead of carrying a second client
 * configuration that could name a different server. Two configurations for one
 * store are two answers to "which Redis is shared", and the day they disagree
 * the limits stop being global with nothing looking wrong.
 *
 * ## Why a `Symbol.for` key on the cluster instance, and not a module registry
 *
 * The driver registers into `@objectstack/service-cluster`'s module scope, and
 * a process has been measured holding TWO instances of that module (the ESM and
 * CJS builds, resolved through two legs of the host importer — see `os serve`'s
 * cluster wiring). A `WeakMap` here would be per module instance, so the driver
 * could offer into one copy while the cache read the other and found nothing.
 * The offer therefore lives ON the cluster instance — the one object both sides
 * provably share, since the reader got it from the kernel's `cluster` service —
 * under a key from the global symbol registry, which every module instance
 * resolves to the same symbol.
 *
 * The property is non-enumerable and read-only: it never shows up in a
 * `JSON.stringify` / spread / `Object.keys` of the cluster, and a reader cannot
 * swap the connection out from under the driver that owns it.
 */

/** The global-registry key the offer is stored under. */
const DRIVER_CONNECTION_KEY = Symbol.for('@objectstack/service-cluster:driver-connection');

/** What a remote driver offers. */
export interface ClusterDriverConnection<C = unknown> {
    /** The driver that owns the connection (`'redis'`). Matches `IClusterService.driver`. */
    readonly driver: string;
    /**
     * The driver's native client. The DRIVER owns it and closes it on
     * `cluster.close()`: a borrower ⛔ never closes it. A borrower that needs
     * its own connection lifecycle (or must not share the driver's connection
     * state, e.g. Redis `WATCH`) derives one from it — for ioredis,
     * `client.duplicate()`, which copies the connection settings exactly.
     */
    readonly client: C;
    /**
     * The key namespace the driver writes under (`'os:'` by default). A
     * borrower writes under its OWN sub-namespace of it (`<prefix>cache:`), so
     * the deployment's one prefix still partitions everything it stores.
     */
    readonly keyPrefix: string;
}

/**
 * Offer `connection` on `cluster` for reuse. Called once by a remote driver's
 * factory, on the instance it returns. A second offer on the same instance is
 * a programming error and throws — two drivers cannot own one cluster.
 */
export function offerClusterDriverConnection(cluster: object, connection: ClusterDriverConnection): void {
    if (Object.prototype.hasOwnProperty.call(cluster, DRIVER_CONNECTION_KEY)) {
        throw new Error(
            `offerClusterDriverConnection: this cluster instance already offers a "${readOffer(cluster)?.driver ?? 'unknown'}" ` +
                `connection; a cluster instance carries exactly one driver's connection.`,
        );
    }
    Object.defineProperty(cluster, DRIVER_CONNECTION_KEY, {
        value: Object.freeze({ ...connection }),
        enumerable: false,
        writable: false,
        configurable: false,
    });
}

/**
 * The connection `cluster` offers for `driver`, or `undefined` when it offers
 * none — a non-remote driver (`memory`), a driver that predates the offer, or a
 * different driver than the one asked for. Never throws: an absent offer is an
 * ordinary answer the caller decides about.
 */
export function readClusterDriverConnection<C = unknown>(
    cluster: unknown,
    driver: string,
): ClusterDriverConnection<C> | undefined {
    const offer = readOffer(cluster);
    if (!offer || offer.driver !== driver) return undefined;
    return offer as ClusterDriverConnection<C>;
}

function readOffer(cluster: unknown): ClusterDriverConnection | undefined {
    if (!cluster || (typeof cluster !== 'object' && typeof cluster !== 'function')) return undefined;
    const value = (cluster as Record<symbol, unknown>)[DRIVER_CONNECTION_KEY];
    if (!value || typeof value !== 'object') return undefined;
    const { driver, keyPrefix } = value as Partial<ClusterDriverConnection>;
    if (typeof driver !== 'string' || typeof keyPrefix !== 'string') return undefined;
    return value as ClusterDriverConnection;
}
