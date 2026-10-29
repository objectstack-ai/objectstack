// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25467 cut 33] What a stored `sys_metadata` overlay row binds, read off the
 * stored rows, from `ObjectStackProtocolImplementation`, moved out of
 * `protocol.ts` whole:
 *
 *  - `overlayLockLayerAt` — the item-lock resolution's `overlay` layer for an
 *    item's address, over its stored ACTIVE rows;
 *  - `resolveOverlayPackageBinding` — the package binding of a persisted
 *    overlay row, read from the row itself;
 *  - `storedRowKnownDatasources` — the datasource a stored `object` row's
 *    `external` binding names, for the stored-migration refused-shape listing.
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
 * the {@link StoredRowBindingsHost} members it reads, plus a `.call`; a body
 * that reads no member is called as a plain function. Each call to another
 * member is handed over as a closure, so it still reaches the class method.
 * Every caller keeps calling the class methods.
 *
 * What the bodies read from elsewhere, they import from where `protocol.ts`
 * imports it; `rowMatchesOverlayWhere` is `protocol.ts`'s own and is imported from there. Nothing re-exports this module, so the published surface does
 * not move.
 */

import { PLURAL_TO_SINGULAR, SINGULAR_TO_PLURAL } from '@objectstack/spec/shared';
import type { ItemAddress, StoredOverlayRow } from './item-lock.js';
import { resolveOverlayLockLayer } from './item-lock.js';
import { overlayMemberWhere } from './migrations/overlay-index.js';
import type { ObjectStackProtocolImplementation } from './protocol.js';
import { rowMatchesOverlayWhere } from './protocol.js';

/**
 * The `ObjectStackProtocolImplementation` members the functions below read —
 * every one of them, and no other; each function's `this` is the `Pick` of
 * the members it reads. Each is typed AS the class member (an indexed access
 * on the class), so a change to a member's signature on the class is a change
 * here too, and naming a member the class does not have is a compile error.
 */
export interface StoredRowBindingsHost {
    readonly externalBindingDatasourceDefinition: ObjectStackProtocolImplementation['externalBindingDatasourceDefinition'];
    readonly findEnvironmentRow: ObjectStackProtocolImplementation['findEnvironmentRow'];
    readonly findEnvironmentRows: ObjectStackProtocolImplementation['findEnvironmentRows'];
}

/** The body of `ObjectStackProtocolImplementation#storedRowKnownDatasources`; the method's docblock there is its contract. */
export async function storedRowKnownDatasources(
    this: Pick<StoredRowBindingsHost, 'externalBindingDatasourceDefinition'>,
    singularType: string,
    body: unknown,
): Promise<ReadonlyMap<string, { readonly schemaMode?: unknown }> | undefined> {
    if (singularType !== 'object' || !body || typeof body !== 'object' || Array.isArray(body)) return undefined;
    const { external, datasource } = body as { external?: unknown; datasource?: unknown };
    if (external === undefined || external === null) return undefined;
    if (typeof datasource !== 'string' || datasource === '') return undefined;
    const definition = await this.externalBindingDatasourceDefinition(datasource);
    return definition ? new Map([[datasource, definition]]) : undefined;
}

/** The body of `ObjectStackProtocolImplementation#overlayLockLayerAt`; the method's docblock there is its contract. */
export function overlayLockLayerAt(
    this: Pick<StoredRowBindingsHost, 'findEnvironmentRows'>,
    address: ItemAddress,
    options: { readonly otherSpelling: boolean },
    activeRows?: readonly StoredOverlayRow[],
): Promise<unknown> {
    const other = PLURAL_TO_SINGULAR[address.type] ?? SINGULAR_TO_PLURAL[address.type];
    return resolveOverlayLockLayer(address, async (spelling) => {
        const type = spelling === 'canonical' ? address.type : other;
        if (type === undefined) return [];
        const where = { type, name: address.name, state: 'active' };
        if (activeRows !== undefined) return activeRows.filter((row) => rowMatchesOverlayWhere(row, where));
        // [#21911] The explicit system opt-in — see findServedOverlayRow.
        const rows: StoredOverlayRow[] | null | undefined = await this.findEnvironmentRows('sys_metadata', {
            where,
            context: { isSystem: true },
        });
        return rows ?? [];
    }, options);
}

/** The body of `ObjectStackProtocolImplementation#resolveOverlayPackageBinding`; the method's docblock there is its contract. */
export async function resolveOverlayPackageBinding(
    this: Pick<StoredRowBindingsHost, 'findEnvironmentRow'>,
    type: string,
    name: string,
    /**
     * [#22877] The bundle member whose row's binding to read; omitted, the
     * canonical member. Nothing for a type with no members.
     */
    member?: string,
): Promise<string | null> {
    // [#21911] The explicit system opt-in — see findServedOverlayRow.
    const row = await this.findEnvironmentRow('sys_metadata', {
        where: {
            type,
            name,
            state: 'active',
            ...overlayMemberWhere(type, member),
        },
        context: { isSystem: true },
    });
    return (row as { package_id?: string | null } | null)?.package_id ?? null;
}
