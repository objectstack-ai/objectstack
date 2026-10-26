// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25467 cut 15] The artifact registry's lookups of
 * `ObjectStackProtocolImplementation` (ADR-0010 metadata protection): the
 * artifact an installed code package registered for an item
 * (`lookupArtifactItem`), every package's artifact for it
 * (`shippedArtifactsOf`), the packages that can ship an item of a type
 * (`shippingPackagesOf`), and the item-lock resolution's artifact layer over
 * them (`artifactLockLayerAt`), moved out of `protocol.ts` whole.
 *
 * A MOVE, not a redesign. Each function below is the body of the
 * `ObjectStackProtocolImplementation` method of the same name as it stood,
 * re-indented one level and otherwise unedited: the same registry reads, in
 * the same order, answering the same artifacts.
 *
 * ## How the moved bodies reach the class
 *
 * The shape #23050 set for `rest-server.ts` (its `data-action-routes.ts`
 * header carries the full reasoning), as `protocol-batch-data.ts` applies it.
 * The class keeps every method — the published `dist/*.d.ts` lists each one's
 * name, docblock and declared signature — and each body is one literal of
 * exactly the {@link ArtifactLookupHost} members that method reads, plus a
 * `.call`. The engine is handed over as a getter, so the body reads the
 * protocol's engine at call time. A method is handed over as a closure that
 * calls it on the protocol at call time, so a test double or spy set on the
 * instance is still the one the body reaches. That holds between the four
 * functions here too: `shippedArtifactsOf` reaches the lookup and the
 * shipping-package read through the class methods, not by calling the
 * functions below directly. Every other reader of these four methods keeps
 * calling the class method.
 *
 * #22024's call-site pin (`protocol.lookup-artifact-item-call-sites.test.ts`)
 * scans this module beside `protocol.ts`: the lookup's definition and
 * `shippedArtifactsOf`'s two calls of it live here now.
 *
 * What the bodies read at module level they import from where `protocol.ts`
 * imported it; `ShippingPackages` is `protocol.ts`'s own exported type.
 * Nothing re-exports this module, so the published surface does not move.
 */

import { PLURAL_TO_SINGULAR } from '@objectstack/spec/shared';
import { resolveArtifactLockLayer, type ItemAddress } from './item-lock.js';
import type { ObjectStackProtocolImplementation, ShippingPackages } from './protocol.js';

/**
 * The `ObjectStackProtocolImplementation` members the functions below read —
 * every one of them, and no other; each function's `this` is the `Pick` of the
 * members IT reads. Each is typed AS the class member (an indexed access on
 * the class), so a change to a member's signature on the class is a change
 * here too, and naming a member the class does not have is a compile error.
 */
export interface ArtifactLookupHost {
    readonly engine: ObjectStackProtocolImplementation['engine'];
    lookupArtifactItem: ObjectStackProtocolImplementation['lookupArtifactItem'];
    shippingPackagesOf: ObjectStackProtocolImplementation['shippingPackagesOf'];
    shippedArtifactsOf: ObjectStackProtocolImplementation['shippedArtifactsOf'];
}

/** The body of `ObjectStackProtocolImplementation#lookupArtifactItem`; the method's docblock there is its contract. */
export function lookupArtifactItem(
    this: Pick<ArtifactLookupHost, 'engine'>,
    type: string, name: string, currentPackageId?: string, member?: string,
): unknown {
    const registry = (this.engine as any)?.registry;
    if (!registry) return undefined;
    const singular = PLURAL_TO_SINGULAR[type] ?? type;
    // Prefer the artifact-only lookup: it scans composite
    // (`<packageId>:<name>`) entries first, so an overlay row hydrated
    // into the plain key (getMetaItems / loadMetaFromDb) can never
    // shadow the packaged artifact's protection envelope (ADR-0010
    // §3.3 — pre-fix, that shadow made a `_lock: full` app read back
    // as unlocked after PUT+GET until restart). `currentPackageId`
    // (ADR-0048) makes that scan package-scoped (prefer-local).
    if (typeof registry.getArtifactItem === 'function') {
        return registry.getArtifactItem(singular, name, currentPackageId, member)
            ?? registry.getArtifactItem(type, name, currentPackageId, member);
    }
    // Partial registry mocks in tests — fall back to getItem and apply
    // the same package-provenance filter inline.
    if (typeof registry.getItem !== 'function') return undefined;
    const item = registry.getItem(singular, name, currentPackageId) ?? registry.getItem(type, name, currentPackageId);
    if (!item || !(item as any)._packageId || (item as any)._packageId === 'sys_metadata') {
        return undefined;
    }
    return item;
}

/** The body of `ObjectStackProtocolImplementation#artifactLockLayerAt`; the method's docblock there is its contract. */
export function artifactLockLayerAt(
    this: Pick<ArtifactLookupHost, 'shippedArtifactsOf'>,
    address: ItemAddress, shipping?: ShippingPackages,
): readonly unknown[] {
    return resolveArtifactLockLayer(address, () => this.shippedArtifactsOf(address.type, address.name, shipping));
}

/** The body of `ObjectStackProtocolImplementation#shippedArtifactsOf`; the method's docblock there is its contract. */
export function shippedArtifactsOf(
    this: Pick<ArtifactLookupHost, 'lookupArtifactItem' | 'shippingPackagesOf'>,
    type: string, name: string, shipping?: ShippingPackages,
): unknown[] {
    const shipped: unknown[] = [];
    const add = (artifact: unknown): void => {
        if (artifact !== undefined && artifact !== null && !shipped.includes(artifact)) shipped.push(artifact);
    };
    add(this.lookupArtifactItem(type, name));
    if ((PLURAL_TO_SINGULAR[type] ?? type) === 'object') return shipped;
    const packages = shipping ?? this.shippingPackagesOf(type);
    for (const packageId of new Set([...(packages.byName.get(name) ?? []), ...packages.anyName])) {
        const own = this.lookupArtifactItem(type, name, packageId) as { _packageId?: unknown } | undefined;
        if (own?._packageId === packageId) add(own);
    }
    return shipped;
}

/** The body of `ObjectStackProtocolImplementation#shippingPackagesOf`; the method's docblock there is its contract. */
export function shippingPackagesOf(
    this: Pick<ArtifactLookupHost, 'engine'>,
    type: string,
): ShippingPackages {
    const registry = (this.engine as any)?.registry;
    const byName = new Map<string, Set<string>>();
    const anyName = new Set<string>();
    if (!registry) return { byName, anyName };
    const isPackage = (id: unknown): id is string => typeof id === 'string' && id !== '' && id !== 'sys_metadata';
    const listing = (read: () => unknown): readonly unknown[] => {
        try {
            const listed = read();
            return Array.isArray(listed) ? listed : [];
        } catch {
            return []; // See this method's header: the package-less lookup still answers.
        }
    };
    if (typeof registry.listItems === 'function') {
        for (const spelling of new Set([PLURAL_TO_SINGULAR[type] ?? type, type])) {
            for (const entry of listing(() => registry.listItems(spelling))) {
                const { _packageId: id, name } = (entry ?? {}) as { _packageId?: unknown; name?: unknown };
                if (!isPackage(id)) continue;
                if (typeof name !== 'string') {
                    anyName.add(id);
                    continue;
                }
                const ids = byName.get(name);
                if (ids) ids.add(id);
                else byName.set(name, new Set([id]));
            }
        }
    }
    if (typeof registry.getAllPackages === 'function') {
        const canTell = typeof registry.isPackageDisabled === 'function';
        for (const record of listing(() => registry.getAllPackages())) {
            const r = record as { manifest?: { id?: unknown }; id?: unknown } | null | undefined;
            const id = r?.manifest?.id ?? r?.id;
            if (isPackage(id) && (!canTell || registry.isPackageDisabled(id))) anyName.add(id);
        }
    }
    return { byName, anyName };
}
