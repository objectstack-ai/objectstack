// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25467 cut 33] The registry and view-container predicates, from
 * `ObjectStackProtocolImplementation`, moved out of `protocol.ts` whole:
 *
 *  - `expandStoredViewContainers` — every item the stored view containers in
 *    a row list expand, each paired with its row;
 *  - `runtimeViewContainerObject` — the object a runtime view container binds;
 *  - `copiesOwnShippedViewContainer` — whether a stored container copies one
 *    its own package ships;
 *  - `isAnotherPackagesObject` — whether a code package other than the
 *    container's owns its object;
 *  - `registryTakesStoredRows` — whether this protocol's engine registry takes
 *    the rows this kernel stores;
 *  - `overlaidShippedContainerViewNames` — the view names of the shipped
 *    container a container row overlays by its own name.
 *
 * A MOVE, not a redesign. Each function below is the body of the
 * `ObjectStackProtocolImplementation` method of the same name as it stood,
 * re-indented one level and otherwise unedited.
 *
 * ## How the moved bodies reach the class
 *
 * The shape #23050 set for `rest-server.ts` (its `data-action-routes.ts`
 * header carries the full reasoning), as `protocol-batch-data.ts` applies it.
 * The class keeps each method — the published `dist/*.d.ts` lists its name,
 * docblock and declared signature — and its body is one literal of exactly
 * the {@link RegistryViewPredicatesHost} members it reads, plus a `.call`; a
 * body that reads no member is called as a plain function. Fields are handed
 * over as getters, so each read finds the field as it stands at call time;
 * each call to another member is a closure, so it still reaches the class
 * method. Every caller keeps calling the class methods.
 *
 * What the bodies read from elsewhere, they import from where `protocol.ts`
 * imports it. Nothing re-exports this module, so the published surface does
 * not move.
 */

import type { ObjectStackProtocolImplementation } from './protocol.js';

/**
 * The `ObjectStackProtocolImplementation` members the functions below read —
 * every one of them, and no other; each function's `this` is the `Pick` of
 * the members it reads. Each is typed AS the class member (an indexed access
 * on the class), so a change to a member's signature on the class is a change
 * here too, and naming a member the class does not have is a compile error.
 */
export interface RegistryViewPredicatesHost {
    readonly engine: ObjectStackProtocolImplementation['engine'];
    readonly environmentId: ObjectStackProtocolImplementation['environmentId'];
    readonly expandRuntimeViewContainer: ObjectStackProtocolImplementation['expandRuntimeViewContainer'];
    readonly runtimeViewContainerObject: ObjectStackProtocolImplementation['runtimeViewContainerObject'];
    readonly runtimeViewContainerPackage: ObjectStackProtocolImplementation['runtimeViewContainerPackage'];
    readonly shippedViewContainerOf: ObjectStackProtocolImplementation['shippedViewContainerOf'];
    readonly storeHydratedIntoRegistry: ObjectStackProtocolImplementation['storeHydratedIntoRegistry'];
}

/** The body of `ObjectStackProtocolImplementation#expandStoredViewContainers`; the method's docblock there is its contract. */
export function expandStoredViewContainers<E extends { data: unknown; packageId: string | undefined }>(
    this: Pick<RegistryViewPredicatesHost, 'expandRuntimeViewContainer'>,
    type: string,
    overlays: readonly E[],
): Array<{ item: Record<string, unknown>; container: E }> {
    const out: Array<{ item: Record<string, unknown>; container: E }> = [];
    for (const container of overlays) {
        for (const item of this.expandRuntimeViewContainer(type, container.data, { packageId: container.packageId })) {
            out.push({ item, container });
        }
    }
    return out;
}

/** The body of `ObjectStackProtocolImplementation#runtimeViewContainerObject`; the method's docblock there is its contract. */
export function runtimeViewContainerObject(container: Record<string, any>): string | undefined {
    return (typeof container.object === 'string' && container.object ? container.object : undefined)
        ?? container?.list?.data?.object
        ?? container?.form?.data?.object
        ?? (typeof container.name === 'string' ? container.name : undefined);
}

/** The body of `ObjectStackProtocolImplementation#copiesOwnShippedViewContainer`; the method's docblock there is its contract. */
export function copiesOwnShippedViewContainer(
    this: Pick<RegistryViewPredicatesHost, 'runtimeViewContainerObject' | 'shippedViewContainerOf'>,
    type: string,
    object: string,
    container: Record<string, any>,
    ownPackageId: string | undefined,
): boolean {
    const shipped = this.shippedViewContainerOf(type, container.name, ownPackageId);
    return shipped !== undefined && this.runtimeViewContainerObject(shipped) === object;
}

/** The body of `ObjectStackProtocolImplementation#isAnotherPackagesObject`; the method's docblock there is its contract. */
export function isAnotherPackagesObject(this: Pick<RegistryViewPredicatesHost, 'engine'>, object: string, ownPackageId: string | undefined): boolean {
    const registry: any = (this.engine as any)?.registry;
    const owner = typeof registry?.getPackagedObjectOwner === 'function'
        ? registry.getPackagedObjectOwner(object)
        : undefined;
    const ownerPackageId: unknown = owner?.packageId;
    return typeof ownerPackageId === 'string' && ownerPackageId !== '' && ownerPackageId !== ownPackageId;
}

/** The body of `ObjectStackProtocolImplementation#registryTakesStoredRows`; the method's docblock there is its contract. */
export function registryTakesStoredRows(this: Pick<RegistryViewPredicatesHost, 'environmentId' | 'storeHydratedIntoRegistry'>): boolean {
    return this.environmentId === undefined || this.storeHydratedIntoRegistry;
}

/** The body of `ObjectStackProtocolImplementation#overlaidShippedContainerViewNames`; the method's docblock there is its contract. */
export function overlaidShippedContainerViewNames(
    this: Pick<RegistryViewPredicatesHost, 'expandRuntimeViewContainer' | 'runtimeViewContainerPackage' | 'shippedViewContainerOf'>,
    type: string,
    container: Record<string, unknown>,
    packageId: string | null | undefined,
): ReadonlySet<string> {
    const ownPackageId = this.runtimeViewContainerPackage(type, container, { packageId });
    const shipped = this.shippedViewContainerOf(type, container.name, ownPackageId);
    if (shipped === undefined) return new Set();
    return new Set(
        this.expandRuntimeViewContainer(type, shipped, { packageId: ownPackageId }).map((view) => String(view.name)),
    );
}
