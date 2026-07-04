// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * @objectstack/service-cluster
 *
 * Pluggable cluster primitives (PubSub / Lock / KV / Counter) for
 * ObjectStack. The default `memory` driver is exported here and is the
 * only driver needed for single-process runtimes.
 *
 * A remote driver is required only when running multiple processes that
 * must share these primitives. Remote drivers ship as sibling packages
 * and register via `registerClusterDriver()`; `@objectstack/service-cluster-redis`
 * is the reference remote driver. (Postgres/NATS drivers are not built —
 * add one on demand against the same SPI.)
 *
 * NOTE: the `memory` driver is per-process. Running multiple replicas on
 * the memory driver silently splits state (each process holds its own
 * locks/counters; pub/sub does not fan out across processes). Use a
 * remote driver for any multi-replica deployment.
 *
 * See `content/docs/kernel/cluster.mdx` for the protocol.
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

export {
    assertClusterDriverSafeForTopology,
    declaresMultiNode,
    type SplitBrainGuardEnv,
} from './split-brain-guard.js';

export { MetadataClusterBridgePlugin } from './metadata-cluster-bridge-plugin.js';

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

export {
    registerMultiNodeGate,
    checkMultiNodeAllowed,
    __resetMultiNodeGate,
    type MultiNodeGate,
} from './multi-node-gate.js';
