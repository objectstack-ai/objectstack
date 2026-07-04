// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Cluster Service Contracts
 *
 * Runtime interfaces for the four cluster primitives defined in
 * `content/docs/kernel/cluster.mdx` §3:
 *
 *   - IPubSub   — fan-out messaging across nodes
 *   - ILock     — distributed mutual exclusion with TTL fencing
 *   - IKV       — small ephemeral coordination state
 *   - ICounter  — monotonic sequence generation
 *
 * Concrete drivers (memory / postgres / redis / nats / custom) live in
 * `@objectstack/service-cluster` and implement these interfaces.
 *
 * Per ObjectStack convention:
 *   - Configuration & metadata go through Zod (see `kernel/cluster.zod.ts`).
 *   - Runtime contracts are plain TypeScript interfaces (this file).
 *
 * These interfaces are the abstraction boundary that lets plugins
 * remain driver-agnostic — a plugin author writes against `IPubSub`,
 * never against `redis.publish` or `pg.query('NOTIFY ...')`.
 */

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

/** Disposer returned from subscription / watch APIs. Calling it is idempotent. */
export type Unsubscribe = () => void;

/** Common metadata attached to cluster primitives for observability. */
export interface ClusterCallContext {
    /** Tenant or org channel-prefix; injected by the kernel, may be undefined for system primitives. */
    tenant?: string;
    /** Free-form trace id for correlation with logs. */
    traceId?: string;
}

// ---------------------------------------------------------------------------
// IPubSub
// ---------------------------------------------------------------------------

export interface PubSubMessage<T = unknown> {
    /** Logical channel name (already tenant-prefixed by the driver). */
    channel: string;
    /** Decoded payload. */
    payload: T;
    /** Wall-clock publish time, ms since epoch. Best-effort. */
    publishedAt: number;
    /** Origin node id, or undefined for local publishers. */
    fromNode?: string;
}

export type PubSubHandler<T = unknown> = (
    msg: PubSubMessage<T>,
) => void | Promise<void>;

export interface PublishOptions {
    /** Partition key — used by partitioned drivers to preserve ordering. */
    partitionKey?: string;
    /** Optional context for logging / metrics. */
    ctx?: ClusterCallContext;
}

export interface SubscribeOptions {
    /** Optional context for logging / metrics. */
    ctx?: ClusterCallContext;
}

/**
 * Fan-out messaging primitive. At-least-once delivery; handlers MUST be
 * idempotent. The memory driver delivers synchronously within a process;
 * remote drivers (redis pub/sub, postgres LISTEN/NOTIFY, nats) deliver
 * across nodes.
 */
export interface IPubSub {
    publish<T = unknown>(
        channel: string,
        payload: T,
        opts?: PublishOptions,
    ): Promise<void>;

    subscribe<T = unknown>(
        channel: string,
        handler: PubSubHandler<T>,
        opts?: SubscribeOptions,
    ): Unsubscribe;

    /** Release any underlying resources (sockets, listeners). Idempotent. */
    close(): Promise<void>;
}

// ---------------------------------------------------------------------------
// ILock
// ---------------------------------------------------------------------------

export interface LockAcquireOptions {
    /** Lease duration in ms. Driver default applies if omitted. */
    ttlMs?: number;
    /**
     * Wait up to this many ms for the lock to become available.
     * `0` (default) = fail-fast, never queue.
     */
    waitMs?: number;
    /** Optional context for logging / metrics. */
    ctx?: ClusterCallContext;
}

/**
 * Opaque handle held by the lock owner. Carrying a fencing token lets
 * downstream resources reject zombie writes from an expired holder.
 */
export interface LockHandle {
    /** Logical lock key. */
    readonly key: string;
    /**
     * Monotonically-increasing fencing token, unique per (key, acquisition).
     * Use this when calling into resources that may have outlived the
     * lock-holder process — pass it along so the resource can reject
     * out-of-order writes.
     */
    readonly fencingToken: bigint;
    /** Extend the lease by another `ttlMs`. Throws if the lock was lost. */
    renew(ttlMs?: number): Promise<void>;
    /** Release the lock. Safe to call multiple times. */
    release(): Promise<void>;
    /** Returns true while this handle still owns the lock. */
    isHeld(): boolean;
}

/**
 * Distributed mutual exclusion. The memory driver is a per-process Mutex;
 * remote drivers use Redis SETNX+TTL, Postgres advisory locks, or
 * equivalents.
 *
 * **Always** acquire with a TTL — the lock MUST self-release if the holder
 * crashes. Use `renew()` for long-running operations.
 */
export interface ILock {
    /**
     * Acquire `key`. Returns a `LockHandle` on success, or `null` if the
     * lock is held and `waitMs` elapsed without it becoming free.
     */
    acquire(key: string, opts?: LockAcquireOptions): Promise<LockHandle | null>;

    /**
     * Run `fn` while holding `key`. Releases the lock automatically; on
     * timeout returns `null` and never invokes `fn`.
     */
    withLock<T>(
        key: string,
        fn: (handle: LockHandle) => Promise<T>,
        opts?: LockAcquireOptions,
    ): Promise<T | null>;

    /** Release driver resources. */
    close(): Promise<void>;
}

// ---------------------------------------------------------------------------
// IKV
// ---------------------------------------------------------------------------

export interface KVSetOptions {
    /** Time-to-live in seconds. Omit for "no expiry". */
    ttl?: number;
    /**
     * If set, the write succeeds only when the existing value's version
     * matches `ifVersion`. Use `0n` to require the key not exist.
     */
    ifVersion?: bigint;
    ctx?: ClusterCallContext;
}

export interface KVEntry<T = unknown> {
    key: string;
    value: T;
    /** Monotonic per-key version, incremented on every successful write. */
    version: bigint;
    /** Expiry in ms since epoch, or undefined for no TTL. */
    expiresAt?: number;
}

/**
 * Small ephemeral coordination KV. **NOT** a cache and **NOT** a database;
 * intended for cluster bookkeeping like leader handles, heartbeat state,
 * feature-flag flips. Values should be small (KB range).
 *
 * Supports optimistic concurrency via `ifVersion`.
 */
export interface IKV {
    get<T = unknown>(key: string): Promise<KVEntry<T> | undefined>;
    set<T = unknown>(key: string, value: T, opts?: KVSetOptions): Promise<KVEntry<T>>;
    delete(key: string, opts?: { ifVersion?: bigint }): Promise<boolean>;
    /**
     * Compare-and-set convenience. Returns the new entry on success, or
     * undefined if the precondition failed.
     */
    cas<T = unknown>(
        key: string,
        expectedVersion: bigint,
        next: T,
        opts?: Omit<KVSetOptions, 'ifVersion'>,
    ): Promise<KVEntry<T> | undefined>;
    close(): Promise<void>;
}

// ---------------------------------------------------------------------------
// ICounter
// ---------------------------------------------------------------------------

export interface CounterIncrOptions {
    /** Delta to add. Default 1. May be negative. */
    by?: number;
    ctx?: ClusterCallContext;
}

/**
 * Monotonic counter. The memory driver is a process-local integer; remote
 * drivers use Redis INCRBY, Postgres sequences, etc.
 *
 * Use cases: id allocation, idempotency keys, fencing tokens (which is how
 * `ILock` typically gets its `fencingToken`).
 */
export interface ICounter {
    /** Increment and return the new value. */
    incr(key: string, opts?: CounterIncrOptions): Promise<bigint>;
    /** Read without mutating; returns 0n if the key has never been incremented. */
    peek(key: string): Promise<bigint>;
    /** Reset to a given value. Use sparingly — breaks monotonicity guarantees. */
    reset(key: string, value?: bigint): Promise<void>;
    close(): Promise<void>;
}

// ---------------------------------------------------------------------------
// IClusterService (facade)
// ---------------------------------------------------------------------------

/**
 * The unified cluster facade exposed by the kernel to plugins.
 *
 * Plugins access primitives via `ctx.cluster.pubsub` etc., never by
 * constructing a driver directly. The kernel resolves the registry from
 * `ClusterCapabilityConfig` on the active stack.
 */
export interface IClusterService {
    /** Stable identifier of this node within the cluster. */
    readonly nodeId: string;
    /** Driver name in use ('memory' | 'redis' | 'postgres' | 'nats' | 'custom'). */
    readonly driver: string;
    readonly pubsub: IPubSub;
    readonly lock: ILock;
    readonly kv: IKV;
    readonly counter: ICounter;
    /**
     * Tear down every primitive in reverse order of construction.
     * Safe to call multiple times.
     */
    close(): Promise<void>;
}
