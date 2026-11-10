// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Declared multi-replica over the Redis cluster driver — the one switch every
 * multi-replica behaviour keys on (cloud#3814 R2/R3).
 *
 * The maintainer's rulings on the multi-replica epic bind every card under it
 * to one condition: the single-node default path is unchanged, and
 * multi-replica behaviour switches on only when the operator has DECLARED
 * several replicas AND the cluster service runs the Redis driver. This module
 * is that condition, named once, so the cards cannot drift apart:
 *
 *   - "declared" is {@link declaresMultiNode} — the split-brain guard's own
 *     reading of `OS_CLUSTER_REPLICAS` / `OS_EXPECT_MULTI_NODE`. The guard is
 *     untouched: a declaration over the in-process driver still refuses the
 *     boot, so the only multi-replica deployment that reaches a request is one
 *     on a remote driver.
 *   - "on Redis" is the `driver` of the composed `cluster` service (the
 *     `IClusterService.driver` contract field), read where the answer is used
 *     — a request handler, a plugin's `init()` after the cluster plugin — and
 *     never recorded at a moment the boot could still contradict.
 *
 * Readers today: the marketplace install-local doors refuse a package change
 * under it ({@link MULTI_REPLICA_PACKAGE_CHANGE_REFUSED}), and the cloud
 * binding credential moves to the shared row under it.
 */

import { declaresMultiNode, type SplitBrainGuardEnv } from './split-brain-guard.js';

/**
 * The one cluster driver multi-replica behaviour switches on behind
 * (cloud#3814 R2: Redis is required for multi-replica, and only for it).
 */
export const MULTI_REPLICA_CLUSTER_DRIVER = 'redis';

/**
 * The error code a door answers when it refuses a package change because this
 * deployment declares several replicas over {@link MULTI_REPLICA_CLUSTER_DRIVER}
 * and the change would reach the one replica that served the request (`409`).
 * Spelled once here so every refusing door answers the same code; each door's
 * message names its own act and the condition its change needs, around the
 * one recipe {@link multiReplicaMaintenanceWindowRecipe}.
 */
export const MULTI_REPLICA_PACKAGE_CHANGE_REFUSED = 'MULTI_REPLICA_PACKAGE_CHANGE_REFUSED';

/**
 * The maintenance-window recipe every {@link MULTI_REPLICA_PACKAGE_CHANGE_REFUSED}
 * refusal names, spelled once, beside the reader of the declaration it lifts.
 *
 * While the declaration stands, every replica refuses the change the same way,
 * whichever client sends it, so "run it on one replica" or "run it through a
 * client" is refused again. The recipe lifts the declaration on a deployment
 * scaled to the one replica that makes the change: `OS_CLUSTER_REPLICAS` at 1
 * and `OS_EXPECT_MULTI_NODE` unset, the two settings {@link declaresMultiNode}
 * reads, so it reads false there. Then the count and the declaration come back
 * and every replica restarts, which is when the others read the change.
 *
 * `act` is what the operator runs against that replica (`run the install`,
 * `repeat the request`). The condition the change needs to reach the other
 * replicas is the door's own, so the caller states it after this sentence.
 */
export function multiReplicaMaintenanceWindowRecipe(act: string): string {
    return 'Make the change in a maintenance window instead: scale the deployment to one replica and restart it with '
        + `OS_CLUSTER_REPLICAS=1 and OS_EXPECT_MULTI_NODE unset, ${act} against that replica, then restore the `
        + 'replica count and the declaration and restart every replica.';
}

/**
 * True exactly when the operator declares several replicas
 * ({@link declaresMultiNode}) AND `clusterDriver` is
 * {@link MULTI_REPLICA_CLUSTER_DRIVER}. Anything else — a single node, the
 * in-process driver, any other driver, no cluster service — is `false`, so the
 * single-node default path never sees a difference.
 */
export function declaresMultiReplicaOnRedis(
    env: SplitBrainGuardEnv | Readonly<Record<string, string | undefined>>,
    clusterDriver: string | undefined,
): boolean {
    return declaresMultiNode(env) && clusterDriver?.trim() === MULTI_REPLICA_CLUSTER_DRIVER;
}

/**
 * The `driver` of the `cluster` service `services` composes, or `undefined`
 * when none is composed. Never throws: a kernel's `getService` throws for an
 * empty slot, and an absent cluster service is an ordinary answer (single
 * node).
 */
export function composedClusterDriver(services: { getService<T = unknown>(name: string): T }): string | undefined {
    try {
        const cluster = services.getService<{ driver?: unknown } | undefined>('cluster');
        return typeof cluster?.driver === 'string' ? cluster.driver : undefined;
    } catch {
        return undefined;
    }
}
