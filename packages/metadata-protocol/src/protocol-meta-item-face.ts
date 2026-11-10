// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25467 cut 31] The by-name item read's disabled-package face, from
 * `ObjectStackProtocolImplementation`, moved out of `protocol.ts` whole:
 * `readMetaItemFace`, the one body behind `getMetaItem` and
 * `getMetaItemForExecution`. It refuses an object of a disabled package,
 * withholds any other item of one, and otherwise answers what `readMetaItem`
 * answers.
 *
 * A MOVE, not a redesign. The function below is the body of the
 * `ObjectStackProtocolImplementation` method of the same name as it stood,
 * re-indented one level and otherwise unedited. Since then, [#32183] added
 * one arm: a name only disabled packages hold reads as their withheld item.
 *
 * ## How the moved body reaches the class
 *
 * The shape #23050 set for `rest-server.ts` (its `data-action-routes.ts`
 * header carries the full reasoning), as `protocol-batch-data.ts` applies it.
 * The class keeps the method — the published `dist/*.d.ts` lists its name,
 * docblock and declared signature — and its body is one literal of exactly
 * the {@link MetaItemFaceHost} members it reads, plus a `.call`. The `engine`
 * field is handed over as a getter, so the read finds it as it stands at call
 * time; the call to `readMetaItem` is handed over as a closure, so it still
 * reaches the class method. Every caller keeps calling the class method.
 *
 * The disabled-package helpers it reads are `protocol.ts`'s own, and are
 * imported from there. Nothing re-exports this module, so the published
 * surface does not move.
 */

import type { ObjectStackProtocolImplementation } from './protocol.js';
import {
    isActionWithheldByDisabledPackage,
    isItemOfDisabledPackage,
    isObjectOfDisabledPackage,
    noPendingDraftError,
    objectPackageDisabledError,
} from './protocol.js';

/**
 * The `ObjectStackProtocolImplementation` members the function below reads —
 * every one of them, and no other; the function's `this` is the `Pick` of
 * them. Each is typed AS the class member (an indexed access on the class),
 * so a change to a member's signature on the class is a change here too.
 */
export interface MetaItemFaceHost {
    readonly engine: ObjectStackProtocolImplementation['engine'];
    readonly readMetaItem: ObjectStackProtocolImplementation['readMetaItem'];
}

/**
 * [#32183] The package holding `(type, name)` when every package that holds
 * it is disabled; `undefined` when none holds it or an enabled one does.
 * Read over every holder (`includeDisabledPackages`). Optional-called, as
 * {@link isItemOfDisabledPackage} is: a registry without the two reads hides
 * nothing more.
 */
function disabledOnlyHolderOf(registry: any, type: string, name: string): string | undefined {
    if (typeof registry?.packageScopedHoldersOf !== 'function' || typeof registry?.isPackageDisabled !== 'function') {
        return undefined;
    }
    const holders: readonly string[] = registry.packageScopedHoldersOf(type, name, null, { includeDisabledPackages: true }) ?? [];
    return holders.length > 0 && holders.every((id) => registry.isPackageDisabled(id) === true) ? holders[0] : undefined;
}

/**
 * [#32183] The package whose stack a read naming no package takes, for a
 * name a disabled package also holds: the one holder ADR-0150 D3 resolves
 * over the served set. `undefined` leaves the read as it was: a type the
 * registry does not read by package, a name no disabled package holds (the
 * read is `main`'s, untouched), the environment's own item (D3 (a) serves
 * it), no served holder (the withheld arm of the face) or two or more (the
 * read's own refusal).
 *
 * Without it, the reads that pick a layer by name alone (the layered read's
 * code layer, the first composite in registration order, and the package-less
 * overlay row's address, which counts every shipper) reached the disabled
 * holder's body while the by-name read served the enabled one. Shared by
 * the face and the layered read, so both read one stack. Optional-called:
 * a registry without these reads leaves every read as it was.
 */
export function servedHolderAddressOf(registry: any, type: string, name: string): string | undefined {
    if (typeof registry?.readsByPackage !== 'function' || registry.readsByPackage(type) !== true) return undefined;
    if (typeof registry.packageScopedHoldersOf !== 'function' || typeof registry.isPackageDisabled !== 'function') return undefined;
    const every: readonly string[] = registry.packageScopedHoldersOf(type, name, null, { includeDisabledPackages: true }) ?? [];
    if (!every.some((id) => registry.isPackageDisabled(id) === true)) return undefined;
    const served: readonly string[] = registry.packageScopedHoldersOf(type, name, null) ?? [];
    if (served.length !== 1) return undefined;
    if (typeof registry.getEnvironmentScopedItem === 'function' && registry.getEnvironmentScopedItem(type, name) !== undefined) {
        return undefined;
    }
    return served[0];
}

/**
 * [#32183, contract review M4] Whether `copy`, the metadata service's copy of
 * a name read at `address` (the served holder {@link servedHolderAddressOf}
 * answers), is another holder's: stamped (`_packageId`) with a package that
 * holds the name in the registry, a disabled one included, other than
 * `address`. The metadata manager keys most types by name alone, so for a
 * name two packages ship it keeps the body registered last, which can be the
 * disabled holder's. The plain read replaces such a copy with the addressed
 * holder's item (`exactQualifierItem`). The layered read's code layer and the
 * bare `/published` exit ask this, so neither serves it. A copy stamped with
 * no holder of the name (a provenance sentinel, a customization pair) is not
 * another holder's.
 */
export function isAnotherHoldersCopy(registry: any, type: string, name: string, address: string, copy: unknown): boolean {
    const stamp = (copy as { _packageId?: unknown } | null | undefined)?._packageId;
    if (typeof stamp !== 'string' || stamp === '' || stamp === address) return false;
    if (typeof registry?.packageScopedHoldersOf !== 'function') return false;
    const every: readonly string[] = registry.packageScopedHoldersOf(type, name, null, { includeDisabledPackages: true }) ?? [];
    return every.includes(stamp);
}

/** The body of `ObjectStackProtocolImplementation#readMetaItemFace`; the method's docblock there is its contract. */
export async function readMetaItemFace(
    this: Pick<MetaItemFaceHost, 'engine' | 'readMetaItem'>,
    request: {
        type: string, name: string, packageId?: string, state?: 'active' | 'draft', previewDrafts?: boolean,
        member?: string,
    },
    face: 'served' | 'execution',
) {
    if (request.type === 'object' && isObjectOfDisabledPackage(this.engine?.registry, request.name)) {
        throw objectPackageDisabledError(request.name);
    }
    // [#32183] A name a disabled package also holds is read at the served
    // holder's address ({@link servedHolderAddressOf}), so no layer of the
    // read can be the disabled holder's.
    const servedAddress = request.packageId ? undefined : servedHolderAddressOf(this.engine?.registry, request.type, request.name);
    const answer = await this.readMetaItem(servedAddress === undefined ? request : { ...request, packageId: servedAddress }, { face });
    // [#28877] The served read of an `action` also withholds one that launches
    // into a disabled package, as the served list does.
    const withheldAction = request.type === 'action' && face === 'served'
        && isActionWithheldByDisabledPackage(this.engine?.registry, answer?.item);
    // [#32183] A name only disabled packages hold resolves to nothing: the
    // read judges a name's holders over the served set. Its answer is that
    // package's withheld item, the shape a disabled holder's read had, so
    // every door that asks the envelope whether a disable withheld the item
    // (the layered view's step 1b, `/published`) keeps answering the missing
    // name and never serves that package's layers.
    const disabledOnlyHolder = request.type !== 'object' && request.type !== 'package' && answer?.item == null
        ? disabledOnlyHolderOf(this.engine?.registry, request.type, request.name)
        : undefined;
    if (disabledOnlyHolder === undefined && (request.type === 'object' || request.type === 'package'
        || (!withheldAction && !isItemOfDisabledPackage(this.engine?.registry, answer?.item)))) {
        return answer;
    }
    if (request.state === 'draft') throw noPendingDraftError(request.type, request.name);
    const { item: _withheld, registration: _servedOnly, ...envelope } = answer as typeof answer & { registration?: unknown };
    const withheld = { ...envelope, item: undefined };
    // Not every arm of the read's envelope declares `packageId`; each may carry it.
    if (disabledOnlyHolder !== undefined) (withheld as { packageId?: string }).packageId = disabledOnlyHolder;
    return withheld;
}
