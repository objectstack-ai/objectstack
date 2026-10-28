// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25467 cut 29] The legacy-organization row filters, from
 * `ObjectStackProtocolImplementation`, moved out of `protocol.ts` whole: on a
 * database the ADR-0131 ceremony has not migrated, the rows that still belong
 * to one organization rather than to the environment.
 *
 *  - `legacyOrganizationRowsOf` — those rows of one table, read off the
 *    physical column through the table's driver (a read inside a transaction
 *    joins it).
 *  - `withoutLegacyOrganizationRows` — a row list with those rows left out.
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
 * the {@link LegacyOrganizationRowsHost} members it reads, plus a `.call`.
 * The `engine` field is handed over as a getter, so each read finds it as it
 * stands at call time; `withoutLegacyOrganizationRows`'s call to
 * `legacyOrganizationRowsOf` is handed over as a closure, so it still reaches
 * the class method. Every caller keeps calling the class methods.
 *
 * What the bodies read from elsewhere, they import from where `protocol.ts`
 * imports it. Nothing re-exports this module, so the published surface does
 * not move.
 */

import { readLegacyOrganizationRows } from '@objectstack/metadata-core';
import type { ObjectStackProtocolImplementation } from './protocol.js';

/**
 * The `ObjectStackProtocolImplementation` members the functions below read —
 * every one of them, and no other; each function's `this` is the `Pick` of
 * the members it reads. Each is typed AS the class member (an indexed access
 * on the class), so a change to a member's signature on the class is a change
 * here too, and naming a member the class does not have is a compile error.
 */
export interface LegacyOrganizationRowsHost {
    readonly engine: ObjectStackProtocolImplementation['engine'];
    readonly legacyOrganizationRowsOf: ObjectStackProtocolImplementation['legacyOrganizationRowsOf'];
}

/** The body of `ObjectStackProtocolImplementation#withoutLegacyOrganizationRows`; the method's docblock there is its contract. */
export async function withoutLegacyOrganizationRows<R>(
    this: Pick<LegacyOrganizationRowsHost, 'legacyOrganizationRowsOf'>,
    table: string,
    rows: R[] | null | undefined,
    context?: unknown,
): Promise<R[]> {
    if (!rows || rows.length === 0) return rows ?? [];
    const legacy = await this.legacyOrganizationRowsOf(table, context);
    return legacy.size === 0 ? rows : rows.filter((row) => !legacy.has(String((row as { id?: unknown }).id)));
}

/** The body of `ObjectStackProtocolImplementation#legacyOrganizationRowsOf`; the method's docblock there is its contract. */
export function legacyOrganizationRowsOf(
    this: Pick<LegacyOrganizationRowsHost, 'engine'>,
    table: string,
    context?: unknown,
): Promise<ReadonlyMap<string, string>> {
    const transaction = (context as { transaction?: unknown } | undefined)?.transaction;
    return readLegacyOrganizationRows(
        (this.engine as { getDriverForObject?: (objectName: string) => unknown }).getDriverForObject?.(table),
        table,
        transaction !== undefined ? { transaction } : {},
    );
}
