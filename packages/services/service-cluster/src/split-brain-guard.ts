// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Split-brain guard (ADR-0010, path A).
 *
 * The `memory` cluster driver keeps PubSub/Lock/KV/Counter state **per
 * process**. On a single node that is correct; across multiple replicas
 * each process holds its own state, so:
 *   - `ILock` is acquired locally by every replica -> no mutual exclusion;
 *   - `ICounter`/`IKV` versions diverge per replica;
 *   - `IPubSub` does not fan out across processes.
 *
 * This fails silently -- single-node tests and dev pass, only production
 * multi-replica corrupts. The guard turns that silent corruption into a
 * loud startup error when the operator has *declared* a multi-node
 * topology yet wired an in-process driver.
 *
 * Detection is deliberately conservative (path A): it keys off an
 * explicit operator declaration, not active peer discovery (that is the
 * optional path B in ADR-0010). It cannot know at boot whether the
 * cluster primitives are actually used cross-node, so it offers an
 * escape hatch for the rare "replicas declared but primitives unused"
 * case.
 */

/** In-process drivers whose state does not coordinate across replicas. */
const IN_PROCESS_DRIVERS = new Set(['memory']);

/**
 * True when `driver` keeps its cluster primitives **inside one process**, so
 * `IPubSub` does not fan out to peer replicas.
 *
 * Exported (#11968) so the authorization-cache posture statement reads this
 * fact from the module that owns it rather than re-deciding which drivers are
 * in-process. The two consumers ask it for different reasons and must not be
 * allowed to drift: this guard throws when a multi-node topology is *declared*
 * over an in-process driver, while the posture statement warns when an enabled
 * grants cache has no cross-node invalidation channel — a case that needs no
 * declaration to be real, because `Runtime` registers the memory driver by
 * default.
 */
export function isInProcessClusterDriver(driver: string): boolean {
    return IN_PROCESS_DRIVERS.has(driver);
}

/** Environment inputs the guard reads. */
export interface SplitBrainGuardEnv {
    /** `'true'` -> operator declares a multi-node deployment. */
    OS_EXPECT_MULTI_NODE?: string;
    /** Replica count; `> 1` -> multi-node. */
    OS_CLUSTER_REPLICAS?: string;
    /** `'true'` -> bypass the guard (replicas declared but primitives unused cross-node). */
    OS_ALLOW_MEMORY_CLUSTER_MULTINODE?: string;
}

function isTrue(v: string | undefined): boolean {
    return String(v).trim().toLowerCase() === 'true';
}

/**
 * True when the operator has declared a multi-node topology via
 * `OS_EXPECT_MULTI_NODE=true` or `OS_CLUSTER_REPLICAS` greater than 1.
 */
export function declaresMultiNode(env: SplitBrainGuardEnv = process.env): boolean {
    if (isTrue(env.OS_EXPECT_MULTI_NODE)) return true;
    const replicas = Number(env.OS_CLUSTER_REPLICAS);
    return Number.isFinite(replicas) && replicas > 1;
}

/**
 * Throw if a multi-node topology is declared while the resolved cluster
 * `driver` is in-process (`memory`), unless explicitly allowed via
 * `OS_ALLOW_MEMORY_CLUSTER_MULTINODE=true`.
 *
 * Call this at startup *before* registering the cluster service so a
 * misconfiguration fails fast.
 */
export function assertClusterDriverSafeForTopology(
    driver: string,
    env: SplitBrainGuardEnv = process.env,
): void {
    if (!declaresMultiNode(env)) return;
    if (!isInProcessClusterDriver(driver)) return;
    if (isTrue(env.OS_ALLOW_MEMORY_CLUSTER_MULTINODE)) return;

    throw new Error(
        `ClusterServicePlugin: multi-node deployment declared ` +
            `(OS_EXPECT_MULTI_NODE / OS_CLUSTER_REPLICAS>1) but the cluster driver is ` +
            `in-process "${driver}" -- its locks/counters/pub-sub do not coordinate across ` +
            `processes, so multiple replicas silently split-brain. Configure a remote cluster ` +
            `driver (e.g. @objectstack/service-cluster-redis) or a DB-backed driver. To override ` +
            `(replicas declared but cluster primitives unused cross-node), set ` +
            `OS_ALLOW_MEMORY_CLUSTER_MULTINODE=true. See cloud ADR-0010.`,
    );
}
