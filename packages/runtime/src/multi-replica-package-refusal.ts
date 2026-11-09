// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [cloud#3814 D1] The refusal every runtime package door gives when this
 * deployment declares several replicas over the Redis cluster driver.
 *
 * A runtime package change reaches ONE replica. The package registry is loaded
 * from the database at boot only, so a package created, installed, edited or
 * deleted on one replica is not seen by the others until they restart; and the
 * enable/disable choice is written to the serving replica's own package-state
 * store (`OS_HOME/package-state/<hash>.json` when the host registers none), a
 * file on its own volume, so replicas that restart read different choices for
 * good. The maintainer ruled 「多副本时拒绝」: under declared replicas these doors
 * refuse, `409` with `MULTI_REPLICA_PACKAGE_CHANGE_REFUSED`, naming the
 * maintenance-window recipe, before anything is written.
 *
 * Two clone doors create a package as a side effect: a "new similar" copy of a
 * flow or a permission set shipped by a read-only package lands in that
 * base's paired customization package, ensured on the spot. Those doors are
 * refused only when the ensure would CREATE the pair on this replica
 * ({@link multiReplicaPairCreationRefusal}); a pair this replica already
 * serves is reused, which creates no package, and the copy itself is a
 * metadata write like any other.
 *
 * The condition is the cluster package's `declaresMultiReplicaOnRedis` — the
 * one every multi-replica card keys on, which the marketplace install-local
 * doors refuse under too, with the same code. The cluster service's driver is
 * read per request, where the answer is used. On a single node, the in-process
 * driver, any other driver, or with no cluster service composed, the doors are
 * byte-for-byte what they were.
 */

import { declaresMultiReplicaOnRedis, MULTI_REPLICA_PACKAGE_CHANGE_REFUSED } from '@objectstack/service-cluster';
import { customizationPackageId } from '@objectstack/spec/kernel';
import type { HttpDispatcherResult, HttpProtocolContext } from './http-dispatcher.js';

/** What the refusal needs from the domain's deps: service resolution and the error envelope. */
export interface MultiReplicaRefusalDeps {
    resolveService(context: HttpProtocolContext, name: string): any;
    error(message: string, status: number, details?: Record<string, unknown>): any;
}

/** True when this request runs on a deployment that declares replicas over the Redis cluster driver. */
export async function packageChangeReachesOneReplica(
    deps: Pick<MultiReplicaRefusalDeps, 'resolveService'>,
    context: HttpProtocolContext,
): Promise<boolean> {
    let driver: string | undefined;
    try {
        const cluster = await deps.resolveService(context, 'cluster');
        driver = typeof cluster?.driver === 'string' ? cluster.driver : undefined;
    } catch {
        // A cluster service that cannot be resolved names no driver: single node.
    }
    return declaresMultiReplicaOnRedis(process.env, driver);
}

/**
 * The refusal sentence. `subject` names the change in the gerund the walled
 * refusal uses (`Enabling package "crm"`).
 */
export function multiReplicaPackageChangeMessage(subject: string): string {
    return `${subject} was refused: this deployment declares several replicas (OS_CLUSTER_REPLICAS greater than 1, `
        + 'or OS_EXPECT_MULTI_NODE=true) on the Redis cluster driver, and a package change at runtime reaches only '
        + 'the replica that serves the request: the package registry is read at boot and the enable/disable choice '
        + 'is kept per replica, so the other replicas would keep serving the packages as they were. Make the change '
        + 'in a maintenance window instead: run it on a single replica or through the CLI, then restart every '
        + 'replica. Nothing was changed or written.';
}

/**
 * The door's answer under declared replicas on Redis, or `null` when the door
 * proceeds exactly as before.
 */
export async function refuseMultiReplicaPackageChange(
    deps: MultiReplicaRefusalDeps,
    context: HttpProtocolContext,
    subject: string,
): Promise<HttpDispatcherResult | null> {
    if (!(await packageChangeReachesOneReplica(deps, context))) return null;
    return {
        handled: true,
        response: deps.error(multiReplicaPackageChangeMessage(subject), 409, { code: MULTI_REPLICA_PACKAGE_CHANGE_REFUSED }),
    };
}

/**
 * [cloud#3814 D1] For a door that ensures `basePackageId`'s paired
 * customization package as a side effect: the refusal message when this
 * deployment declares replicas on Redis AND this replica's registry does not
 * hold the pair yet (so the ensure would create a package on this replica
 * alone), else `null`. A base that derives no pair id is left to the ensure's
 * own refusal.
 */
export async function multiReplicaPairCreationRefusal(
    deps: Pick<MultiReplicaRefusalDeps, 'resolveService'>,
    context: HttpProtocolContext,
    ql: unknown,
    basePackageId: string,
    subject: string,
): Promise<string | null> {
    if (!(await packageChangeReachesOneReplica(deps, context))) return null;
    const pair = customizationPackageId(basePackageId);
    if (!pair.ok) return null;
    const registry = (ql as { registry?: { getPackage?(id: string): unknown } } | undefined)?.registry;
    if (registry?.getPackage?.(pair.value)) return null;
    return multiReplicaPackageChangeMessage(`${subject} needs the paired customization package '${pair.value}', which `
        + 'does not exist yet, and creating it');
}

/** {@link multiReplicaPairCreationRefusal}'s answer as a thrown ADR-0112 refusal (`409`, the code). */
export function multiReplicaPackageChangeError(message: string): Error {
    return Object.assign(new Error(message), { statusCode: 409, code: MULTI_REPLICA_PACKAGE_CHANGE_REFUSED });
}
