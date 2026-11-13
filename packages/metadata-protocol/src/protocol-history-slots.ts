// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * # Whose versions the history and rollback doors address (ADR-0150 D3/D4)
 *
 * A type stored per `(package, name)` (`PACKAGE_SLOTTED_STORE_TYPES`) keeps
 * one `sys_metadata` row per package for a name, and its versions are
 * numbered per name across those rows (`sys_metadata_history`'s unique
 * `(type, name, version)`). So the name's change log interleaves every
 * holder's versions, and a version number alone does not say whose row it may
 * be restored into. `historyMetaItem` and `rollbackMetaItem` ask this module
 * which row slot they address, by the rule `DatabaseLoader` keeps for the
 * metadata service's own history doors (`MetadataManager.getHistory`,
 * `rollback`):
 *
 *  - **naming no package** (the bare door): a name whose active rows are held
 *    by more than one row slot — two packages', or a package's beside the
 *    package-less row — is refused `409` naming every holder
 *    (`ambiguous-in-environment`), before any row is read or written: nothing
 *    picks one (ADR-0150 D3, epic red line 2). A name one slot holds, or none,
 *    answers as before;
 *  - **naming package `P`** (`?package=P`, the `/layers?package=` spelling):
 *    the slot of the row a read naming `P` serves — `P`'s own row, or its
 *    `.custom` pair's declared override of `P` (ADR-0146 D2) — else `P`'s own
 *    slot when `P` ships the name in code and holds no row of it yet. A
 *    package that neither holds a row of the name nor ships it is refused
 *    `409` naming every holder (`not-held-by-qualifier`).
 *
 * A version belongs to a slot by its history row's attribution
 * (`historyRowAttribution`, `@objectstack/metadata`). A version attributed to
 * no package (recorded before `sys_metadata_history.package_id` was written
 * for this store) belongs to a slot only while the name has no other slot:
 * with two holders nothing says whose it is, so it is never guessed.
 *
 * Every other type is not addressed here, and `?package=` leaves its doors'
 * answers as they were (as `admitEnvironmentQualifier` keeps the bare read for
 * the types ADR-0150 does not address).
 */

import {
    PackageScopedNameRefusedError,
    packageScopedRefusalMessage,
    type PackageScopedHolder,
    type PackageScopedRefusal,
    type PackageScopedResolvableType,
} from '@objectstack/core';
import { PACKAGE_SLOTTED_STORE_TYPES } from '@objectstack/metadata';
import type { ProtocolHost } from './protocol-host.js';
import { memberOption } from './protocol-bundle-members.js';
import { shippingPackageIds } from './protocol-environment-rows.js';
import type { HistoryVersionOwner } from './sys-metadata-repository.js';

/** What {@link historySlotOf} answers for a door of a by-package type. */
export interface HistorySlot {
    /** The slot the door addresses, and which of the name's versions are its own. */
    readonly owner: HistoryVersionOwner;
    /** Whether the request named the package (`?package=`). */
    readonly addressed: boolean;
}

/** The name's row slots: each bound package, sorted, then the package-less row (`null`). */
async function rowSlotsOf(
    host: Pick<ProtocolHost, 'packagelessAddress'>,
    type: string,
    name: string,
    member: string | undefined,
): Promise<Array<string | null>> {
    const address = await host.packagelessAddress(type, name, member);
    return [...address.candidates, ...(address.unbound ? [null] : [])];
}

function holdersOf(slots: ReadonlyArray<string | null>): PackageScopedHolder[] {
    return slots.map((slot) => (slot === null
        ? { kind: 'environment' as const }
        : { kind: 'package' as const, packageId: slot }));
}

function slotRefusal(
    type: string,
    name: string,
    reason: 'ambiguous-in-environment' | 'not-held-by-qualifier',
    callerPackageId: string | null,
    slots: ReadonlyArray<string | null>,
): PackageScopedNameRefusedError {
    const base: Omit<PackageScopedRefusal, 'message'> = {
        status: 'refused',
        reason,
        type: type as PackageScopedResolvableType,
        name,
        callerPackageId,
        candidates: holdersOf(slots),
    };
    return new PackageScopedNameRefusedError({ ...base, message: packageScopedRefusalMessage(base) });
}

/**
 * The row slot a history or rollback request of `(type, name)` addresses —
 * see the module header. `type` is the canonical type key and `member` the
 * resolved bundle member.
 *
 * @returns `undefined` for a type not stored per `(package, name)`, and for a
 *   bare request of a name no row holds: the door answers as before.
 * @throws {PackageScopedNameRefusedError} `ambiguous-in-environment` for a
 *   bare request of a name two or more row slots hold; `not-held-by-qualifier`
 *   for a package that neither holds a row of the name nor ships it, while
 *   another slot holds one.
 */
export async function historySlotOf(
    host: Pick<ProtocolHost, 'findServedOverlayRow' | 'packagelessAddress' | 'shippedArtifactsOf'>,
    request: { type: string; name: string; member?: string; packageId?: string },
): Promise<HistorySlot | undefined> {
    const { type, name, member, packageId } = request;
    if (!PACKAGE_SLOTTED_STORE_TYPES.has(type)) return undefined;
    const slots = await rowSlotsOf(host, type, name, member);
    if (packageId === undefined) {
        if (slots.length > 1) throw slotRefusal(type, name, 'ambiguous-in-environment', null, slots);
        if (slots.length === 0) return undefined;
        return { owner: { packageId: slots[0] ?? null, unattributed: true }, addressed: false };
    }
    // The row a read naming `P` serves: its own, or its pair's declared
    // override. The package-less fallback of that read is not `P`'s slot.
    const served = await host.findServedOverlayRow({
        type, name, state: 'active', packageId, ...memberOption(member), servedOverride: true,
    });
    const binding = (served?.row as { package_id?: unknown } | undefined)?.package_id;
    const slot = typeof binding === 'string' && binding !== '' ? binding : packageId;
    if (!slots.includes(slot) && slots.length > 0
        && !shippingPackageIds(host.shippedArtifactsOf(type, name, undefined, member)).has(packageId)) {
        throw slotRefusal(type, name, 'not-held-by-qualifier', packageId, slots);
    }
    const sole = slots.length === 0 || (slots.length === 1 && slots[0] === slot);
    return { owner: { packageId: slot, unattributed: sole }, addressed: true };
}
