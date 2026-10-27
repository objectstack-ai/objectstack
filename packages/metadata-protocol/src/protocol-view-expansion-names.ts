// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25467 cut 22] Two view-container expansion members of
 * `ObjectStackProtocolImplementation`, moved out of `protocol.ts` whole: the
 * by-name read's answer for a view name no stored row holds but a stored
 * container expands (`resolveRowlessExpandedView`, #21442/#21967: the list
 * read's own rows, parse, expansion and selection), and the expansion of a
 * container on another package's object under the container's own name
 * (`expandUnderOwnName`, #21334).
 *
 * A MOVE, not a redesign. Each function below is the body of the
 * `ObjectStackProtocolImplementation` method of the same name as it stood,
 * re-indented one level and otherwise unedited: the same reads in the same
 * order, the same `#5532` discrimination, the same selection, and the same
 * names given to the expanded items.
 *
 * ## How the moved bodies reach the class
 *
 * The shape #23050 set for `rest-server.ts` (its `data-action-routes.ts`
 * header carries the full reasoning), as `protocol-batch-data.ts` applies it.
 * The class keeps both methods — the published `dist/*.d.ts` lists their
 * names, docblocks and declared signatures — and each body is one literal of
 * exactly the {@link ViewExpansionNamesHost} members it reads, each handed
 * over as a closure, plus a `.call`. Every other reader of either method
 * keeps calling the class method.
 *
 * What the bodies read of `protocol.ts`'s own module-level declarations they
 * import from it; what they import from elsewhere, they import from where
 * `protocol.ts` imported it. Nothing re-exports this module, so the published
 * surface does not move.
 */

import { PLURAL_TO_SINGULAR } from '@objectstack/spec/shared';
import { expandViewContainer } from '@objectstack/spec/ui';
import type { ObjectStackProtocolImplementation, RowlessExpandedView } from './protocol.js';
import { servedViewExpansion } from './protocol.js';

/**
 * The `ObjectStackProtocolImplementation` members the functions below read —
 * every one of them, and no other; a function's `this` is the `Pick` of the
 * members it reads. Each is typed AS the class member (an indexed access on
 * the class), so a change to a member's signature on the class is a change
 * here too, and naming a member the class does not have is a compile error.
 */
export interface ViewExpansionNamesHost {
    readonly expandStoredViewContainers: ObjectStackProtocolImplementation['expandStoredViewContainers'];
    readonly isShippedByAnotherPackage: ObjectStackProtocolImplementation['isShippedByAnotherPackage'];
    readonly namesWithOwnStoredRow: ObjectStackProtocolImplementation['namesWithOwnStoredRow'];
    readonly readActiveOverlayRows: ObjectStackProtocolImplementation['readActiveOverlayRows'];
    readonly rethrowUnlessMetadataStoreUnprovisioned: ObjectStackProtocolImplementation['rethrowUnlessMetadataStoreUnprovisioned'];
    readonly storedOverlayEntries: ObjectStackProtocolImplementation['storedOverlayEntries'];
}

/** The body of `ObjectStackProtocolImplementation#resolveRowlessExpandedView`; the method's docblock there is its contract. */
export async function resolveRowlessExpandedView(
    this: Pick<ViewExpansionNamesHost, 'expandStoredViewContainers' | 'namesWithOwnStoredRow' | 'readActiveOverlayRows' | 'rethrowUnlessMetadataStoreUnprovisioned' | 'storedOverlayEntries'>,
    request: { type: string; name: string; packageId?: string },
): Promise<RowlessExpandedView | undefined> {
    if ((PLURAL_TO_SINGULAR[request.type] ?? request.type) !== 'view') return undefined;
    let records: any[] = [];
    // [#21967] Naming a package, the package-less rows in scope stand in,
    // read as the list scoped to that package reads them (the
    // package-agnostic read, filtered back to the package-less rows).
    let standInRows: any[] = [];
    try {
        records = await this.readActiveOverlayRows(
            { type: request.type, ...(request.packageId ? { packageId: request.packageId } : {}) },
        );
        if (request.packageId) {
            standInRows = (await this.readActiveOverlayRows({ type: request.type }))
                .filter((row) => (row?.package_id ?? null) === null);
        }
    } catch (error) {
        // [#5532] The list read's rule: only an unprovisioned store means
        // "no rows". Any other failure is not answered as "nothing expands
        // this name".
        this.rethrowUnlessMetadataStoreUnprovisioned(error, 'sys_metadata');
    }
    const rows = [...records, ...standInRows];
    if (this.namesWithOwnStoredRow(rows, request.packageId).has(request.name)) return undefined;
    return servedViewExpansion(
        this.expandStoredViewContainers(request.type, this.storedOverlayEntries(request, rows)),
        request.name,
        request.packageId,
    );
}

/** The body of `ObjectStackProtocolImplementation#expandUnderOwnName`; the method's docblock there is its contract. */
export function expandUnderOwnName(
    this: Pick<ViewExpansionNamesHost, 'isShippedByAnotherPackage'>,
    type: string,
    object: string,
    container: Record<string, any>,
    ownPackageId: string | undefined,
): Record<string, unknown>[] {
    const ownName = typeof container.name === 'string' && container.name !== '' ? container.name : undefined;
    if (ownName === undefined) return [];
    const under = `${object}.${ownName}`;
    const expandAt = under;
    const list = container.list;
    const bare = !!list && typeof list === 'object' && !(typeof list.name === 'string' && list.name !== '');
    const source = bare ? { ...container, list: { ...list, name: ownName } } : container;
    const bareSpelled = `${expandAt}.${ownName}`;
    const underIsShipped = this.isShippedByAnotherPackage(type, under, ownPackageId);
    return expandViewContainer(expandAt, source).map((vi) => {
        const item: Record<string, any> = { ...vi, object };
        const name = String(item.name);
        const fromBare = bare
            && item.viewKind === 'list'
            && item.config?.name === ownName
            && name.startsWith(bareSpelled)
            && /^(_\d+)?$/.test(name.slice(bareSpelled.length));
        if (fromBare) {
            const authored = { ...item.config };
            delete authored.name;
            item.config = authored;
            if (!underIsShipped) {
                item.name = under;
                delete item._diagnostics;
            }
        }
        return item;
    });
}
