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
 * class type and the shared walk (`resolvePackageClosure`, below).
 *
 * ## One declared dependency closure for every reader (#31575, ADR-0150 D3)
 *
 * {@link packageDependencyClosure} is the one answer to "what may package P
 * reach by declaration": the save door's write scope (the method above, which
 * now only adds its silent `catch`) and objectql's package-scoped name
 * resolver (`resolvePackageScopedName`) both ask it, so the closure a write is
 * judged against and the closure a bare name resolves in can never disagree.
 * It is the one export of this module the package root re-exports.
 */

import { resolvePackageClosure } from '@objectstack/lint/runtime';
import { installedManifestsOf, pairOf } from '@objectstack/metadata-core';
import { customizationBasePackageId } from '@objectstack/spec/kernel';
import type { ObjectStackProtocolImplementation } from './protocol.js';

/** The registry slice {@link widenPairClosureToAppMembers} reads. */
interface MemberRegistry {
    getPackage?: (id: string) => { manifest?: unknown } | undefined;
    getAllPackages?: () => ReadonlyArray<{ manifest?: unknown }>;
}

/**
 * [ADR-0146 D3, ruling record 6691022506] The write closure of an App's pair:
 * `closure` — the pair and what it declares, the App — widened, when it
 * declares its App, by every other installed package whose pair it is (`pairOf`, `@objectstack/metadata-core`)
 * and their own declared closures. A customization of any package of the App
 * lands in the App's pair, and the pair declares only the App (its range is
 * the App's), so the members it overrides and extends are reached through the
 * App's membership, not through a dependency the pair would have to restate
 * for every module the App delivers. Any other package's closure is returned
 * as it is.
 */
export function widenPairClosureToAppMembers(
    closure: { packageId: string; dependencies: string[] },
    registry: MemberRegistry | undefined,
): { packageId: string; dependencies: string[] } {
    const pairId = closure.packageId;
    const appId = customizationBasePackageId(pairId);
    // Members are reached THROUGH the App: a pair that does not declare its
    // App (an installed copy that dropped the dependency) is widened by
    // nothing, and the App itself is only ever in the closure by declaration.
    if (appId === null || !closure.dependencies.includes(appId)) return closure;
    if (!registry || typeof registry.getPackage !== 'function' || typeof registry.getAllPackages !== 'function') return closure;
    const installed = installedManifestsOf(registry as { getPackage(id: string): { manifest?: unknown } | undefined });
    const getPackage = (id: string) => registry.getPackage!.call(registry, id);
    const dependencies = new Set(closure.dependencies);
    for (const row of registry.getAllPackages.call(registry)) {
        const id = (row?.manifest as { id?: unknown } | undefined)?.id;
        if (typeof id !== 'string' || id === pairId || id === appId || dependencies.has(id)) continue;
        const pair = pairOf(id, installed);
        if (!pair.ok || pair.value !== pairId) continue;
        dependencies.add(id);
        for (const dep of resolvePackageClosure(id, getPackage)?.dependencies ?? []) {
            if (dep !== pairId) dependencies.add(dep);
        }
    }
    return { packageId: pairId, dependencies: [...dependencies] };
}

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
 * [#28240] The dependency walk itself is `resolvePackageClosure` in
 * `@objectstack/lint`, the same function Studio's object pickers call over
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
        return packageDependencyClosure(packageId, this.engine.registry as MemberRegistry | undefined);
    } catch {
        // Context gathering must never fail a write (the same contract
        // `listCollection` above holds). An unreadable registry means an
        // unnarrowed gate, not a refused publish.
        return undefined;
    }
}

/**
 * [#31575, ADR-0150 D3, ADR-0141] Package `packageId`'s DECLARED dependency
 * closure, read from `registry`: the package itself and every package its
 * manifest's `dependencies` name, transitively (`resolvePackageClosure`, the
 * walk Studio's object pickers share), with an App's pair widened by the App's
 * members ({@link widenPairClosureToAppMembers}). The one implementation: the
 * save door's write scope ({@link resolveWritePackageScope}) is this call
 * inside a silent `catch`, and objectql's package-scoped name resolver asks it
 * for the closure a bare name resolves in.
 *
 * Answers `undefined` exactly where the walk does — no package id, the
 * `sys_metadata` sentinel, a package `registry` cannot produce — and for a
 * registry with no `getPackage` (a metadata-only test double). Each reader
 * decides what `undefined` means for it: the save door narrows nothing, the
 * resolver reaches nothing beyond the caller's own items and `sys`.
 *
 * Not a widening of anything: it adds no package the walk and the pair
 * widening did not already add. ⛔ It does NOT add the `sys` kernel namespace
 * ADR-0150 D3 puts in a resolution closure: the save door's scope stays as it
 * was, so the resolver adds `sys` itself.
 *
 * A `getPackage` that throws propagates; the caller decides what an unreadable
 * registry means.
 */
export function packageDependencyClosure(
    packageId: string | null | undefined,
    registry: MemberRegistry | undefined,
): { packageId: string; dependencies: string[] } | undefined {
    const getPackage = registry?.getPackage;
    if (typeof getPackage !== 'function') return undefined;
    const closure = resolvePackageClosure(packageId, (id) => getPackage.call(registry, id));
    return closure === undefined ? undefined : widenPairClosureToAppMembers(closure, registry);
}
