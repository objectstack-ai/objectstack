// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25467 cut 19] A package write's validation scope, as
 * `ObjectStackProtocolImplementation` resolves it
 * (`resolveWritePackageScope`): the written package and the closure of the
 * dependencies its manifest declares, read from the registry, or `undefined`
 * wherever that cannot be read. Moved out of `protocol.ts` whole.
 *
 * A MOVE, not a redesign. The function below is the body of the
 * `ObjectStackProtocolImplementation` method of the same name: the same
 * guards, the same dependency walk (since #28240 the shared
 * `resolvePackageClosure`, unchanged), and the same silent `catch` answering
 * `undefined`.
 *
 * ## How the moved body reaches the class
 *
 * The shape #23050 set for `rest-server.ts` (its `data-action-routes.ts`
 * header carries the full reasoning), as `protocol-batch-data.ts` applies it.
 * The class keeps the method — the published `dist/*.d.ts` lists its name,
 * docblock and declared signature — and its body is one literal of exactly
 * the {@link WritePackageScopeHost} members it reads, plus a `.call`. The
 * engine is handed over as a getter, so the body reads the protocol's engine
 * (and so its registry) at call time. Every other reader of the method keeps
 * calling the class method: `tenantAuthoredWriteRefusal`, and the authoring
 * gate's host (cut 8, `protocol-authoring-gate.ts`), whose closure calls it.
 *
 * The body reads no module-level declaration of `protocol.ts`; it imports the
 * class type and the shared walk ({@link packageDependencyClosure}).
 *
 * ## One declared dependency closure for every reader (#31575, ADR-0150 D3)
 *
 * {@link packageDependencyClosure} is the one answer to "what may package P
 * reach by declaration": the save door's write scope (the method above, which
 * now only adds its silent `catch`) and objectql's package-scoped name
 * resolver (`resolvePackageScopedName`) both ask it, so the closure a write is
 * judged against and the closure a bare name resolves in can never disagree.
 * It is the one export of this module the package root re-exports.
 *
 * [epic #31527 child R2] The walk, the App-pair widening and this closure live
 * in `@objectstack/metadata-core` (`package-closure.ts`), so the resolution
 * rule's readers inside objectql's lean entry, which this package stays out
 * of (ADR-0076 D2), read the same one. Re-exported here under their names, so
 * this package's surface is unchanged.
 */

import { packageDependencyClosure, widenPairClosureToAppMembers, type PackageClosureRegistry } from '@objectstack/metadata-core';
import type { ObjectStackProtocolImplementation } from './protocol.js';

export { packageDependencyClosure, widenPairClosureToAppMembers };

/**
 * The `ObjectStackProtocolImplementation` members the function below reads —
 * every one of them, and no other; the function's `this` is the `Pick` of the
 * members it reads. Each is typed AS the class member (an indexed access on
 * the class), so a change to a member's signature on the class is a change
 * here too, and naming a member the class does not have is a compile error.
 */
export interface WritePackageScopeHost {
    readonly engine: ObjectStackProtocolImplementation['engine'];
}

/**
 * The body of `ObjectStackProtocolImplementation#resolveWritePackageScope`; the method's docblock there is its contract.
 *
 * [#28240] The dependency walk itself is `resolvePackageClosure` (in
 * `@objectstack/metadata-core` since epic #31527 child R2, re-exported by
 * `@objectstack/lint`), the same function Studio's object pickers call over
 * the served package list, so the picker offers exactly what this gate
 * admits. This body keeps the two host guards: a registry with no
 * `getPackage`, and the silent `catch` answering `undefined`. An App's pair's
 * closure is widened by the App's members ({@link widenPairClosureToAppMembers}).
 */
export function resolveWritePackageScope(
    this: Pick<WritePackageScopeHost, 'engine'>,
    packageId: string | null | undefined,
): { packageId: string; dependencies: string[] } | undefined {
    try {
        return packageDependencyClosure(packageId, this.engine.registry as PackageClosureRegistry | undefined);
    } catch {
        // Context gathering must never fail a write (the same contract
        // `listCollection` above holds). An unreadable registry means an
        // unnarrowed gate, not a refused publish.
        return undefined;
    }
}
