// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * @objectstack/service-cluster
 *
 * Pluggable cluster primitives (PubSub / Lock / KV / Counter) for
 * ObjectStack. The default `memory` driver is exported here; remote
 * drivers (postgres/redis/nats) ship as sibling packages and register
 * themselves via `registerClusterDriver()`.
 *
 * See `content/docs/concepts/cluster-semantics.mdx` for the protocol.
 */

export {
    defineCluster,
    registerClusterDriver,
    ComposedClusterService,
    type ClusterDriverFactory,
    type DriverFactoryConfig,
} from './cluster.js';

export { MemoryPubSub, type MemoryPubSubOptions } from './memory/pubsub.js';
export { MemoryLock, type MemoryLockOptions } from './memory/lock.js';
export { MemoryKV, VersionMismatchError } from './memory/kv.js';
export { MemoryCounter } from './memory/counter.js';

export {
    ClusterServicePlugin,
    type ClusterServicePluginOptions,
} from './cluster-service-plugin.js';

// Re-export contracts for convenience.
export type {
    IClusterService,
    IPubSub,
    PubSubMessage,
    PubSubHandler,
    PublishOptions,
    SubscribeOptions,
    Unsubscribe,
    ILock,
    LockHandle,
    LockAcquireOptions,
    IKV,
    KVEntry,
    KVSetOptions,
    ICounter,
    CounterIncrOptions,
    ClusterCallContext,
} from '@objectstack/spec/contracts';
