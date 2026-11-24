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
 * two arms: a name only disabled packages hold reads as their withheld item,
 * and so does an exact address that reads only disabled packages (a disabled
 * package named, or a pair whose every base is disabled), judged by
 * `disabledExactAddressHolder` (`protocol-exact-qualifier.ts`). Any other
 * exact address of such a name serves only a row stored under its own
 * package (epic ruling R4-B).
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

import {
    PackageScopedNameRefusedError,
    packageScopedRefusalMessage,
    type PackageScopedResolvableType,
} from '@objectstack/core';
import type { ObjectStackProtocolImplementation } from './protocol.js';
import { shippingPackageIds } from './protocol-environment-rows.js';
import { bundleMemberDiscriminator, resolveBundleMemberSelector } from './protocol-bundle-members.js';
import { installedManifestsOfEngine } from './installed-manifests.js';
import { packageDependencyClosure, pairsOf, type PackageClosureRegistry } from '@objectstack/metadata-core';
import { disabledExactAddressHolder } from './protocol-exact-qualifier.js';
import type { PrereadActiveRows } from './protocol-meta-item-reads.js';
import { PLURAL_TO_SINGULAR } from '@objectstack/spec/shared';
import { RELATED_LISTS_ARRANGEMENT_DECORATION, type RelatedListsArrangement } from '@objectstack/spec/data';
import { overlayMemberValue, overlayMemberWhere } from './migrations/overlay-index.js';
import { isServedOverrideRowOf } from './served-override.js';
import {
    isActionWithheldByDisabledPackage,
    isItemOfDisabledPackage,
    isObjectOfDisabledPackage,
    noPendingDraftError,
    objectPackageDisabledError,
    rowMatchesOverlayWhere,
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
    readonly packagelessAddress: ObjectStackProtocolImplementation['packagelessAddress'];
    readonly shippedArtifactsOf: ObjectStackProtocolImplementation['shippedArtifactsOf'];
    readonly readItemActiveRows: ObjectStackProtocolImplementation['readItemActiveRows'];
    readonly declinesStoredRow: ObjectStackProtocolImplementation['declinesStoredRow'];
    readonly rethrowUnlessMetadataStoreUnprovisioned: ObjectStackProtocolImplementation['rethrowUnlessMetadataStoreUnprovisioned'];
}

/** The host {@link servedRowHolderOf} and {@link servedAddressJudgment} read. */
type ServedRowHost = Pick<MetaItemFaceHost,
    'engine' | 'packagelessAddress' | 'shippedArtifactsOf' | 'readItemActiveRows' | 'declinesStoredRow' | 'rethrowUnlessMetadataStoreUnprovisioned'>;

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

/** [#32183, epic ruling R4-B] Whether `item` is stamped (`_packageId`) with `packageId`: a row stored under that package. */
function isStoredUnder(item: unknown, packageId: string): boolean {
    return (item as { _packageId?: unknown } | null | undefined)?._packageId === packageId;
}

/**
 * [#32814] Whether `item` is a row of a customization pair (`pairsOf`) of a
 * package holding `(type, name)`, a disabled one included: stamped
 * (`_packageId`) with such a pair, and with no holder of the name. A pair row
 * is bound over every holder it is a pair of, never a holder of its own
 * (#32354 contract review N2, #32408), so on the read naming no package it is
 * judged as the name's holders are ({@link disabledOnlyHolderOf}): when only
 * disabled packages hold the name, it is their customization and withheld
 * with them, as the exact address of such a pair is (ruling (c),
 * `disabledExactAddressHolder`). A row stamped with a holder is that holder's
 * item ({@link isItemOfDisabledPackage} judges it); a row of no holder's pair
 * (a package-less row, another package's row) is not judged here.
 */
function isHoldersPairRow(engine: unknown, type: string, name: string, item: unknown): boolean {
    const stamp = (item as { _packageId?: unknown } | null | undefined)?._packageId;
    if (typeof stamp !== 'string' || stamp === '') return false;
    const registry: any = (engine as { registry?: unknown } | undefined)?.registry;
    if (typeof registry?.packageScopedHoldersOf !== 'function') return false;
    const every: readonly string[] = registry.packageScopedHoldersOf(type, name, null, { includeDisabledPackages: true }) ?? [];
    if (every.includes(stamp)) return false;
    const installed = installedManifestsOfEngine(engine);
    return every.some((holder) => pairsOf(holder, installed).includes(stamp));
}

/**
 * [#33401, ADR-0150 D4] The package a package-less row (stamped with no
 * package, `''` or the `sys_metadata` sentinel) that the read naming no
 * package reached is withheld with: the holder whose key the row customizes,
 * when every holder of that key is disabled. Seat ruling 6882483833 on
 * #32814: a package-less row whose key (`(type, name)`; `(object, name)` for
 * an `action`) an installed package holds is that holder's overlay, owned
 * over every holder, disabled included (epic ruling 6816940784 on #31699), so
 * with every holder disabled the read answers as if no row were stored. The
 * member is not part of the key: a locale the holder never shipped is still
 * its customization.
 *
 * The key's holders are the registry's one owner rule
 * (`overlayRowBinding`, every holder counted): `null` is the environment's
 * own item (D3 (a), no holder at its key, a same-name action on another
 * object included), served; one holder is withheld when it is disabled; two
 * or more are judged as the name's holders are ({@link disabledOnlyHolderOf}).
 * The row itself is untouched, so it is served again on re-enable.
 * `undefined` when the item is not such a row, or the registry cannot bind
 * one (optional-called: such a registry hides nothing more).
 */
function packagelessRowWithheldHolder(registry: any, type: string, name: string, item: unknown): string | undefined {
    const stamp = (item as { _packageId?: unknown } | null | undefined)?._packageId;
    if (stamp !== undefined && stamp !== null && stamp !== '' && stamp !== 'sys_metadata') return undefined;
    if (typeof registry?.overlayRowBinding !== 'function' || typeof registry?.isPackageDisabled !== 'function') return undefined;
    const holder: unknown = registry.overlayRowBinding(type, name, item, { includeDisabledPackages: true });
    if (holder === null) return undefined;
    if (typeof holder === 'string') return registry.isPackageDisabled(holder) === true ? holder : undefined;
    return disabledOnlyHolderOf(registry, type, name);
}

/**
 * [#33401, review#2 S5] Whether an enabled package holds `(type, name)`
 * through a stored active row the reads serve: a row bound to an enabled
 * package that the reads do not decline (`declinesStoredRow`) and that is no
 * holder's customization pair row (a pair row is that holder's item, never a
 * holder of its own). The registry's owner rule does not see such a row
 * until it is hydrated, so {@link packagelessRowWithheldHolder} alone would
 * withhold a package-less row while an enabled package holds the name, and
 * the answer would follow hydration order.
 */
function enabledRowHolds(
    host: Pick<ServedRowHost, 'engine' | 'declinesStoredRow'>,
    type: string, name: string,
    rows: ReadonlyArray<Awaited<ReturnType<ServedRowHost['readItemActiveRows']>>[number]>,
): boolean {
    const registry: any = host.engine?.registry;
    const every: readonly string[] = registry?.packageScopedHoldersOf?.(type, name, null, { includeDisabledPackages: true }) ?? [];
    const installed = installedManifestsOfEngine(host.engine);
    return rows.some((row) => {
        const bound = typeof row.package_id === 'string' && row.package_id !== '' && row.package_id !== 'sys_metadata'
            ? row.package_id : undefined;
        return bound !== undefined && registry?.isPackageDisabled?.(bound) !== true
            && !host.declinesStoredRow(type, name, row)
            && !every.some((holder) => pairsOf(holder, installed).includes(bound));
    });
}

/**
 * [#33401] The holder a package-less `item` of `(type, name)` is withheld
 * with ({@link packagelessRowWithheldHolder}), unless an enabled package
 * holds the name through a stored active row ({@link enabledRowHolds},
 * review#2 S5): then the answer is `main`'s, whichever order the rows were
 * hydrated in. `rows` are the item's active rows when the caller already
 * read them; otherwise they are read here, only once the registry would
 * withhold the item. The read naming no package and the list naming no
 * package (`protocol-meta-list-reads.ts`) both ask this, so the list carries
 * no row the by-name read withholds.
 */
export async function packagelessRowWithheld(
    host: Pick<ServedRowHost, 'engine' | 'declinesStoredRow' | 'readItemActiveRows' | 'rethrowUnlessMetadataStoreUnprovisioned'>,
    type: string, name: string, item: unknown,
    rows?: ReadonlyArray<Awaited<ReturnType<ServedRowHost['readItemActiveRows']>>[number]>,
): Promise<string | undefined> {
    const holder = packagelessRowWithheldHolder(host.engine?.registry, type, name, item);
    if (holder === undefined) return undefined;
    let active: ReadonlyArray<Awaited<ReturnType<ServedRowHost['readItemActiveRows']>>[number]> | undefined = rows;
    if (active === undefined) {
        try {
            active = await host.readItemActiveRows(type, name);
        } catch (error) {
            host.rethrowUnlessMetadataStoreUnprovisioned(error, 'sys_metadata');
            active = [];
        }
    }
    return enabledRowHolds(host, type, name, active) ? undefined : holder;
}

/**
 * [#32183] The package whose stack a read naming no package takes, for a
 * name a disabled package also holds: the one holder ADR-0150 D3 resolves
 * over the served set. `undefined` leaves the read as it was: a type judged
 * elsewhere ({@link SERVED_HOLDER_JUDGED_ELSEWHERE}), a name no disabled package holds (the
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
 *
 * [#34041, ADR-0150 D3] …and for a type the registry does not read by
 * package (a `doc`, `view`, `translation`, `hook`, …) too: a disabled package
 * holds no name of any type. Such a type's layers are the metadata service's
 * copy, which it keeps by name alone (the body registered last), and the
 * registry's first composite, so either one could be the disabled holder's.
 * The face then withheld it, and the bare read answered 404 although an
 * enabled package ships the name; `/layers` served the disabled body. Read at
 * the served holder's address, the read is that holder's exact read, which
 * never answers another package's copy (`serviceCopyOfAnotherPackage`).
 * Not an `object` (one package owns the name; the face refuses a disabled
 * package's) and not an `action` (judged over every holder by its own bare
 * judge, `judgeBareActionRead`, which serves the one enabled holder already).
 */
export function servedHolderAddressOf(registry: any, type: string, name: string): string | undefined {
    if (SERVED_HOLDER_JUDGED_ELSEWHERE.has(type)) return undefined;
    if (typeof registry?.packageScopedHoldersOf !== 'function' || typeof registry.isPackageDisabled !== 'function') return undefined;
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
 * [#34041] The types whose bare read {@link servedHolderAddressOf} never
 * re-addresses: each is judged against a disabled package elsewhere.
 */
const SERVED_HOLDER_JUDGED_ELSEWHERE: ReadonlySet<string> = new Set(['object', 'action', 'package']);

/**
 * [#32354, ADR-0150 D3] The served holder of a name for a read naming no
 * package, judged over the stored rows too: what {@link servedHolderAddressOf}
 * answers from the registry alone, for the names whose holders live only in
 * `sys_metadata`. The registry keeps one bare slot per name, so a stored row a
 * package saved under a name no enabled package ships is in it only when it
 * was the last one written or hydrated; the rows themselves name every
 * package that holds the name ({@link packagelessAddress}'s candidates).
 *
 * Asked only when a package is disabled ([#32607] or when the item face
 * asks, below), of a type the registry reads by package, when an enabled
 * package ships no code item of the name (otherwise the shipped item is the
 * name's, ADR-0048 §3.3, and a row of another package never stands in for
 * it: {@link servedHolderAddressOf} and `packagelessContentPackage` judge
 * it), and when no package-less row and no
 * environment item is stored (a customization of no one holder, judged as
 * before). [#33210] On the item face (`options.refuseWithoutDisabled`) a
 * package-less row, or the registry's environment item, beside rows bound to
 * two or more packages with no disabled package among them is judged with
 * those rows instead ({@link storedRowHoldersRefusal}), so it is refused
 * naming them; beside one holder, none, or a disabled holder the read is left
 * as it was. Then the holders are the registry's served holders and the
 * packages the active rows are bound to, less every disabled package:
 *
 *  - one → `{ kind: 'served' }`, read at its address, as the registry's
 *    served holder is;
 *  - two or more → `{ kind: 'refused' }`, the by-name read's own refusal
 *    (`ambiguous-in-environment`), naming only the served holders (epic ruling
 *    on #32354, Q2): a disabled package is never named;
 *  - none → `undefined`, the read as it was.
 *
 * [#32607] With no disabled package among the holders, and only when
 * `options.refuseWithoutDisabled` asks (the item face, {@link
 * readMetaItemFace}), two or more are refused the same way, naming each: the
 * plain read served the row saved first while `/layers` refused naming both.
 * That arm is {@link storedRowHoldersRefusal}, which judges the holders at
 * the rows' grain alone.
 * Otherwise, and for one holder, `undefined` (the read already reads there).
 * The layered reads keep their own refusal for that case, the one the
 * package-less writes give (#28337).
 *
 * [#32354 contract review S4] A row the reads decline
 * ({@link ObjectStackProtocolImplementation.declinesStoredRow}: a shipped flow
 * name's undeclared row, a sealed managed name's row) serves nothing at its
 * package's address, so it makes that package no holder here: counted, it
 * re-addressed the read to an address that serves nothing, and two of them
 * were refused naming two such addresses. It still counts toward whether a
 * disabled package holds the name, and an unbound one still leaves the read
 * as it was.
 *
 * [#32354 contract review N2, #32408] Nor does a row bound to a holder's
 * customization pair (`pairsOf`): a pair row is bound over every holder it
 * is a pair of, never a holder of its own, so a disable never moves it (a
 * disabled holder's declared override row is that holder's item, ADR-0146
 * D9, withheld with it). Counted for the enabled pair, it served a disabled
 * holder's customization at the bare address, where the read answered the
 * missing name.
 *
 * Every holder is judged by save order no more: the disabled package's row
 * read first answered the missing name, the enabled one's served it.
 */
export async function servedRowHolderOf(
    host: ServedRowHost,
    type: string, name: string, member?: string,
    options: { readonly refuseWithoutDisabled?: boolean } = {},
): Promise<{ kind: 'served'; packageId: string } | { kind: 'refused'; error: PackageScopedNameRefusedError } | undefined> {
    const registry: any = host.engine?.registry;
    if (typeof registry?.readsByPackage !== 'function' || registry.readsByPackage(type) !== true) return undefined;
    if (typeof registry.packageScopedHoldersOf !== 'function' || typeof registry.isPackageDisabled !== 'function') return undefined;
    const disabled = (id: string): boolean => registry.isPackageDisabled(id) === true;
    // No disabled package at all, and no refusal asked of that case: no read
    // moves, and no row is read for it. The predicate `isPackageDisabled`
    // reads, asked of each installed record.
    if (options.refuseWithoutDisabled !== true && typeof registry.getAllPackages === 'function'
        && !(registry.getAllPackages() as ReadonlyArray<{ enabled?: unknown; status?: unknown } | undefined>)
            .some((pkg) => pkg?.enabled === false || pkg?.status === 'disabled')) {
        return undefined;
    }
    if ([...shippingPackageIds(host.shippedArtifactsOf(type, name, undefined, member))].some((id) => !disabled(id))) return undefined;
    const environmentItem = typeof registry.getEnvironmentScopedItem === 'function'
        && registry.getEnvironmentScopedItem(type, name, member) !== undefined;
    if (environmentItem && options.refuseWithoutDisabled !== true) return undefined;
    // The item's active rows, read once: every row binds a holder, and only
    // the rows the reads serve make a served one (S4). An unprovisioned store
    // holds no row.
    let activeRows: Awaited<ReturnType<ServedRowHost['readItemActiveRows']>>;
    try {
        activeRows = await host.readItemActiveRows(type, name);
    } catch (error) {
        host.rethrowUnlessMetadataStoreUnprovisioned(error, 'sys_metadata');
        activeRows = [];
    }
    const rows = await host.packagelessAddress(type, name, member, 'active', activeRows);
    // [#33210, ADR-0150 D3] The registry's environment item of a name no
    // package ships is the bare slot's entry, the row hydrated last: after a
    // reboot that is the package-less row whenever it was saved last. Beside
    // rows bound to two or more packages it is no environment item but a
    // customization of a name it cannot say whose, judged with them below, so
    // the answer follows no save order. Otherwise the environment's own item
    // leaves the read as it was.
    if (environmentItem && !(rows.unbound && rows.candidates.length > 1)) return undefined;
    const every: readonly string[] = registry.packageScopedHoldersOf(type, name, null, { includeDisabledPackages: true }) ?? [];
    const anyDisabled = [...every, ...rows.candidates].some(disabled);
    // [#33210] The no-disabled arm judges a package-less row itself
    // ({@link storedRowHoldersRefusal}); beside a disabled holder it leaves
    // the read as it was.
    if (!anyDisabled) return options.refuseWithoutDisabled === true ? storedRowHoldersRefusal(host, type, name, member, every, activeRows, rows.candidates) : undefined;
    if (rows.unbound) return undefined;
    const installed = installedManifestsOfEngine(host.engine);
    const pairRow = (row: { package_id?: unknown }): boolean =>
        typeof row.package_id === 'string' && every.some((holder) => pairsOf(holder, installed).includes(row.package_id as string));
    const servingRows = await host.packagelessAddress(type, name, member, 'active', activeRows.filter((row) =>
        !host.declinesStoredRow(type, name, row) && !pairRow(row)));
    const served = [...new Set([...(registry.packageScopedHoldersOf(type, name, null) ?? []), ...servingRows.candidates])]
        .filter((id) => !disabled(id));
    if (served.length === 1) return { kind: 'served', packageId: served[0] };
    if (served.length === 0) return undefined;
    const base = {
        status: 'refused' as const,
        reason: 'ambiguous-in-environment' as const,
        type: type as PackageScopedResolvableType,
        name,
        callerPackageId: null,
        candidates: served.sort().map((packageId) => ({ kind: 'package' as const, packageId })),
    };
    return { kind: 'refused', error: new PackageScopedNameRefusedError({ ...base, message: packageScopedRefusalMessage(base) }) };
}

/**
 * [#32607] The marker {@link storedRowHoldersRefusal} sets on its refusal, a
 * registered symbol (so every copy of this package reads the same key, and
 * no envelope serializes it). The layered chains' owner step in `RestServer`
 * and the runtime dispatcher reads it by the same `Symbol.for` key (neither
 * depends on this package at run time): it hands over to the package-less
 * refusal step only the refusal this judgment made, and rethrows every other
 * (contract review S1).
 */
const STORED_ROW_HOLDERS_REFUSAL: unique symbol = Symbol.for('objectstack.metadata-protocol.storedRowHoldersRefusal') as never;

/**
 * [#32607] The item face's judgment of a name with no disabled holder
 * ({@link servedRowHolderOf} with `refuseWithoutDisabled`): two or more
 * packages holding it only as stored rows are refused naming each, where the
 * plain read served the row saved first. `undefined` leaves the read as it
 * was.
 *
 * Only a name no enabled package ships, at any member: a shipped name keeps
 * the read's own content judgment, which counts the shipper
 * (`packagelessContentPackage` over the name's shipped artifacts), so there is
 * no save order to guess there (a bundled type's base shipping one locale
 * beside another package's row of another).
 *
 * [contract review M1, M2] The holders are judged at ONE grain: the packages
 * the item's active rows are bound to at the member, as the read itself
 * binds them ({@link packagelessAddress}), and never united with the
 * registry's holders of the name. With no shipper the registry knows a
 * row-only name through one bare slot, the row written or hydrated last, at
 * the name's grain, so the union followed save order (a customization pair
 * named as a holder when its row was the slot's entry) and counted a holder
 * of another member (a base's `en-US` row against a dependent's added
 * `fr-FR`). Excluded, as beside a disabled holder: a row the reads decline
 * ({@link ObjectStackProtocolImplementation.declinesStoredRow}) and a row of a
 * customization pair of another package the rows or the registry name
 * (`pairsOf`), which is that package's customization, never a holder of its
 * own.
 *
 * [#33210, ADR-0150 red line 2] A package-less row among them is no holder
 * and no tie-break: beside two or more holders the read is refused naming
 * them, as `/layers` refuses the same rows (`packagelessLayeredReadRefusal`),
 * where it served a row by store order; beside one holder or none it leaves
 * the read as it was.
 *
 * [#34441 cell 2] Not refused, of a bundled type: two or more holders at the
 * member where one is the base the others' rows are bundle additions to
 * ({@link rowHeldBaseAddressOf}), with no package-less row beside them. The
 * read is that base's, as a shipped base's own member is served.
 */
async function storedRowHoldersRefusal(
    host: ServedRowHost,
    type: string, name: string, member: string | undefined,
    every: readonly string[],
    activeRows: Awaited<ReturnType<ServedRowHost['readItemActiveRows']>>,
    bound: readonly string[],
): Promise<{ kind: 'served'; packageId: string } | { kind: 'refused'; error: PackageScopedNameRefusedError } | undefined> {
    const registry: any = host.engine?.registry;
    if ([...shippingPackageIds(host.shippedArtifactsOf(type, name))].some((id) => registry.isPackageDisabled(id) !== true)) return undefined;
    const installed = installedManifestsOfEngine(host.engine);
    const known = [...new Set([...every, ...bound])];
    const pairOfAnother = (row: { package_id?: unknown }): boolean => typeof row.package_id === 'string'
        && known.some((holder) => holder !== row.package_id && pairsOf(holder, installed).includes(row.package_id as string));
    const holding = await host.packagelessAddress(type, name, member, 'active', activeRows.filter((row) =>
        !host.declinesStoredRow(type, name, row) && !pairOfAnother(row)));
    // [#33210, ADR-0150 red line 2] A package-less row beside two or more
    // holders is a customization of a name it cannot say whose (the
    // registry binds it to no package): reading past it still leaves those
    // holders, so it is refused naming them below, as `/layers` refuses it,
    // and never served in their place. Beside one holder or none it leaves
    // the read as it was.
    if (holding.unbound && holding.candidates.length < 2) return undefined;
    // [#32662 scope note (b), ADR-0150 D3] One holder whose rows are its own
    // and its customization pair's: the read is that holder's, at its address,
    // as `/published` reads it, so the layer served is its own row in both
    // save orders. Read as it was, it served the row stored first.
    if (holding.candidates.length === 1) {
        const [holder] = holding.candidates;
        const ownAndPair = bound.length > 1 && bound.includes(holder)
            && bound.every((id) => id === holder || pairsOf(holder, installed).includes(id));
        return ownAndPair ? { kind: 'served', packageId: holder } : undefined;
    }
    if (holding.candidates.length < 2) return undefined;
    // [#34441 cell 2, ADR-0146] Two or more packages holding the member as
    // rows, where one is the base and every other one's row is a bundle
    // addition to it ({@link rowHeldBaseAddressOf}): no ambiguity, as the
    // registry names the base the one holder. The read is the base's, as a
    // shipped base's own member is. Beside a package-less row the refusal
    // above stands (#33210).
    if (!holding.unbound) {
        const rowHeldBase = await rowHeldBaseAddressOf(host, type, name, member, activeRows);
        if (rowHeldBase !== undefined && holding.candidates.includes(rowHeldBase)) return { kind: 'served', packageId: rowHeldBase };
    }
    const base = {
        status: 'refused' as const,
        reason: 'ambiguous-in-environment' as const,
        type: type as PackageScopedResolvableType,
        name,
        callerPackageId: null,
        candidates: [...holding.candidates].sort().map((packageId) => ({ kind: 'package' as const, packageId })),
    };
    const error = new PackageScopedNameRefusedError({ ...base, message: packageScopedRefusalMessage(base) });
    Object.defineProperty(error, STORED_ROW_HOLDERS_REFUSAL, { value: true });
    return { kind: 'refused', error };
}

/**
 * [#32183, #32354] The judgment of the address a read naming no package takes
 * for a name a disabled package also holds: the registry's served holder
 * ({@link servedHolderAddressOf}), else the stored rows' ({@link
 * servedRowHolderOf}), which may be the refusal naming two or more served
 * holders; `undefined` leaves the read as it was. Answered, never thrown: the
 * plain read throws the refusal ({@link servedAddressOf}); the layered read
 * only re-addresses, and leaves the refusal to its door (contract review S1).
 * `options` as on {@link servedRowHolderOf}: only the item face asks it, so
 * [#32607] two enabled row holders of a name nobody ships are refused there
 * alone.
 */
export async function servedAddressJudgment(
    host: ServedRowHost,
    type: string, name: string, member?: string,
    options: { readonly refuseWithoutDisabled?: boolean } = {},
): Promise<{ kind: 'served'; packageId: string } | { kind: 'refused'; error: PackageScopedNameRefusedError } | undefined> {
    const registryAddress = servedHolderAddressOf(host.engine?.registry, type, name);
    if (registryAddress !== undefined) return { kind: 'served', packageId: registryAddress };
    return servedRowHolderOf(host, type, name, member, options);
}

/**
 * [#32183, #32354] {@link servedAddressJudgment} for the plain read: the
 * served address, or `undefined`; throws the refusal when two or more served
 * packages hold the name.
 */
export async function servedAddressOf(
    host: ServedRowHost,
    type: string, name: string, member?: string,
    options: { readonly refuseWithoutDisabled?: boolean } = {},
): Promise<string | undefined> {
    const judged = await servedAddressJudgment(host, type, name, member, options);
    if (judged?.kind === 'refused') throw judged.error;
    return judged?.packageId;
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

/**
 * [#32849, ADR-0150 D4, ADR-0146 D8 item 2] The address a read naming no
 * package takes for a bundle member whose one shipper's declared override is
 * stored: that shipper, so the read serves the override as the shipper's own
 * address does. `undefined` leaves the read as it was.
 *
 * The arrangement: two or more packages ship the name, one of them (a bundle
 * addition Z) is the one enabled package that ships the member named
 * (`fr-FR`), and an active row of that member is the served override of Z's
 * item ({@link isServedOverrideRowOf}: bound to Z's pair, declaring
 * `overrides.package` Z). The read naming no package takes its content from
 * `packagelessContentPackage`, which weighs the name's shippers and the
 * rows' bindings at the name's grain: with several shippers and the row bound
 * to the pair (no shipper) it answers the package-unbound row alone, so the
 * read served Z's shipped member and dropped the override that `?package=Z`,
 * Z's list and the registry's slot at Z all serve. A name one package ships
 * is that package's content already, and is left as it was.
 *
 * Only that arrangement moves: a member two packages ship stays the read's
 * own judgment (red line 2, ambiguity never guessed), as does a row declaring
 * another package (the #32606 shape), an undeclared pair row, the
 * environment's own item, a disabled shipper, and the strict draft read.
 * The rows are read through `host.readItemActiveRows`, so the read below takes
 * them instead of reading them again (#24371). The layered read naming no
 * package takes the same address for its layers (`getMetaItemLayered`).
 *
 * [#32849] The read that names no member addresses the CANONICAL member
 * ({@link bundleMemberDiscriminator}), which is the same request as naming it
 * (`?member=en-US`), so it is judged at that member here and takes the same
 * address. Before, it was left as it was: with the addition Z shipping the
 * canonical member and a pair row declaring Z for it, the read naming no
 * member served Z's shipped member while `?member=en-US` served the override.
 * A bundle with no shipped canonical member has no one shipper of it here, and
 * is left as it was. A type with no members is never moved.
 */
export async function declaredMemberOverrideAddressOf(
    host: ServedRowHost,
    type: string, name: string, member: string | undefined,
): Promise<string | undefined> {
    const addressed = bundleMemberDiscriminator(type, member);
    if (addressed === undefined) return undefined;
    const registry: any = host.engine?.registry;
    if (typeof registry?.readsByPackage !== 'function' || registry.readsByPackage(type) !== true) return undefined;
    if (shippingPackageIds(host.shippedArtifactsOf(type, name)).size < 2) return undefined;
    const memberShippers = [...shippingPackageIds(host.shippedArtifactsOf(type, name, undefined, addressed))];
    if (memberShippers.length !== 1) return undefined;
    const [shipper] = memberShippers;
    if (typeof registry.isPackageDisabled === 'function' && registry.isPackageDisabled(shipper) === true) return undefined;
    if (typeof registry.getEnvironmentScopedItem === 'function' && registry.getEnvironmentScopedItem(type, name, addressed) !== undefined) {
        return undefined;
    }
    let activeRows: Awaited<ReturnType<ServedRowHost['readItemActiveRows']>>;
    try {
        activeRows = await host.readItemActiveRows(type, name);
    } catch (error) {
        host.rethrowUnlessMetadataStoreUnprovisioned(error, 'sys_metadata');
        activeRows = [];
    }
    const singular = PLURAL_TO_SINGULAR[type] ?? type;
    const where = { type: singular, name, state: 'active', ...overlayMemberWhere(singular, addressed) };
    const installed = installedManifestsOfEngine(host.engine);
    return activeRows.some((row) => rowMatchesOverlayWhere(row, where) && isServedOverrideRowOf(row, shipper, installed))
        ? shipper
        : undefined;
}

/**
 * [#33210 (c), ADR-0150 D3, #28802 R2] The address a read naming no package
 * takes for a bundle member that only a dependent's ADDITION holds, over a
 * base that holds the name only as stored rows: that base. The read then
 * answers the base's member, which it does not hold (404), as it does when the
 * base ships the name, where `packagelessContentPackage` reads the shipper.
 * `undefined` leaves the read as it was.
 *
 * Measured on `main` 66f6638fa4, on a booted kernel, before and after a
 * reboot. Base A holds `welcome` in `en-US`, and dependent D, which declares
 * A, holds `fr-FR`. When A ships `en-US`, the plain read, `/layers` and the
 * execution face at `fr-FR` answered 404. When A holds `en-US` only as a
 * stored row, all three served D's row. In both, the registry named A the
 * name's one holder (a bundle addition holds no name). The two differed only
 * in the grain the base was read at: the shippers at the name, the rows'
 * bindings at the member.
 *
 * Judged at the rows' grain, as the registry judges an addition
 * (`isBundleAddition`, read by `packageScopedHoldersOf`). Every active row at
 * the member is bound to a package, and none is declined
 * ({@link ObjectStackProtocolImplementation.declinesStoredRow}). Each package
 * holding members of the name as active rows is judged against its OWN
 * declared dependency closure: it is an addition when some other row-holding
 * package B is in that closure and it is not in B's. [#33210 contract review
 * S2] A member both hold is no clash here: the registry counts a clash only
 * at a member either package ships in code (`codeMembersOf`, #33127), and
 * this arm runs only for a name no package ships, so a member two packages
 * hold only as stored rows never clashes. A dependent that also stores a
 * member the base stores (D's `en-US` and `fr-FR` over A's `en-US`) stays an
 * addition, as the registry names A the one holder there; the read at the
 * shared member is A's (below, #34441 cell 2). The
 * base is the one row-holding package that is no addition;
 * the read is moved only when there is exactly one and no package at the
 * member is a customization pair of another row-holding package (`pairsOf`:
 * a pair's added member is served on its base's address already, #28802
 * ruling A). Where the base holds no row at the member, the read moves at a
 * named non-canonical member only (the S1 guard); where it holds one, see
 * the #34441 cell 2 paragraph below. So a second dependent adding a
 * member of its own (D1 `fr-FR`, D2 `de-DE` over A's `en-US`) leaves A the
 * base at each dependent's member, as the registry names A the one holder
 * whichever packages are installed, and a dependent of a dependent is an
 * addition to it. Both arms apply only to a bundled type the registry reads
 * by package (a type with no members has no additions: its row holders stay
 * holders, #34441 contract review M1), for a name no package ships (a shipped
 * name is the shipper's already), with no environment item at the member and
 * no disabled package among the row-holding packages (the served-holder
 * judgment above reads those).
 *
 * [#34441 cell 2] …and, at ANY member the base itself holds as a row (the
 * canonical one included), beside one or more dependents' rows of the same
 * member: that base, as the registry names it the one holder there and as a
 * shipped base's own member is served. The dependents' rows of it are
 * additions, served at their own addresses. The item face's refusal of two
 * row holders ({@link storedRowHoldersRefusal}) and the layered door's
 * (`packagelessLayeredReadRefusal`) ask this first, so the plain read,
 * `/layers` and the execution face serve the base's row where they refused
 * naming both; beside a package-less row they still refuse (#33210).
 * [#34681] The writes naming no package ask it too, where their rows' address
 * names two or more packages (`packagelessRowHeldBaseAddress`): the save,
 * delete, draft discard, publish, history, diff and rollback doors act on the
 * base's row, as the read serves it.
 * `preread` is the item's active rows when the caller read them already.
 */
export async function rowHeldBaseAddressOf(
    host: ServedRowHost,
    type: string, name: string, member: string | undefined,
    preread?: Awaited<ReturnType<ServedRowHost['readItemActiveRows']>>,
): Promise<string | undefined> {
    const judged = await rowHeldBaseJudgment(host, type, name, member, preread);
    if (judged === undefined || judged.pairAmongHolders) return undefined;
    const { base, atMember } = judged;
    // [#34441 cell 2] A member the base holds as a row beside a dependent's
    // addition of the same member (D's `en-US` over A's `en-US`, the canonical
    // member included) is the base's, as the registry names A the one holder
    // there and as a shipped base's own member is served: the dependent's row
    // is an addition, never a second holder. FROM (`main` 31096af83d): two
    // holders, refused `409` naming A and D, where a shipped base served A's.
    if (atMember.has(base)) return atMember.size >= 2 ? base : undefined;
    // [#33210 contract review S1] A member only additions hold moves for a
    // NAMED non-canonical member only. `overlayMemberValue` answers null for
    // the canonical member, named or not, and the read naming no member
    // addresses it (reachable without `?member=` and from `/published`). That
    // mirror is left as it was: a dependent's canonical row over a base that
    // holds only another member is served naming no package (the S1 pin).
    return typeof overlayMemberValue(PLURAL_TO_SINGULAR[type] ?? type, member) === 'string' ? base : undefined;
}

/**
 * The row-grain judgment {@link rowHeldBaseAddressOf} answers from: over a
 * name no package ships, of a bundled type the registry reads by package, the
 * one row-holding package that is no addition to another (the base), the
 * packages holding a row at `member`, and whether one of those is a
 * customization pair of a holder. `undefined` when the shape does not apply
 * (see that function's docblock for each exclusion). `preread` is the item's
 * active rows when the caller read them already (#24371: one read).
 */
async function rowHeldBaseJudgment(
    host: ServedRowHost,
    type: string, name: string, member: string | undefined,
    preread?: Awaited<ReturnType<ServedRowHost['readItemActiveRows']>>,
): Promise<{ base: string; atMember: ReadonlySet<string>; pairAmongHolders: boolean } | undefined> {
    const registry: any = host.engine?.registry;
    if (typeof registry?.readsByPackage !== 'function' || registry.readsByPackage(type) !== true) return undefined;
    const singular = PLURAL_TO_SINGULAR[type] ?? type;
    // [#34441 contract review M1] A bundled type only. For a type with no
    // members every row of the name is at the member, and the registry names
    // every holder (`packageScopedHoldersOf` with no discriminator: a bundle
    // addition exists only for a bundled type), so two packages holding such
    // a name as rows stay two holders, refused naming both (#32607), whatever
    // their dependencies. Judged before the rows are read: such a read reads
    // nothing more than it did.
    if (overlayMemberValue(singular, member) === undefined) return undefined;
    if (shippingPackageIds(host.shippedArtifactsOf(type, name)).size > 0) return undefined;
    if (typeof registry.getEnvironmentScopedItem === 'function' && registry.getEnvironmentScopedItem(type, name, member) !== undefined) {
        return undefined;
    }
    let activeRows: Awaited<ReturnType<ServedRowHost['readItemActiveRows']>>;
    if (preread !== undefined) {
        activeRows = preread;
    } else {
        try {
            activeRows = await host.readItemActiveRows(type, name);
        } catch (error) {
            host.rethrowUnlessMetadataStoreUnprovisioned(error, 'sys_metadata');
            activeRows = [];
        }
    }
    const rows = activeRows.filter((row) => rowMatchesOverlayWhere(row, { type: singular, name, state: 'active' }));
    const memberWhere = { type: singular, name, state: 'active', ...overlayMemberWhere(singular, member) };
    const atMember = rows.filter((row) => rowMatchesOverlayWhere(row, memberWhere));
    const packageOf = (row: { package_id?: unknown }): string | undefined =>
        typeof row.package_id === 'string' && row.package_id !== '' ? row.package_id : undefined;
    if (atMember.length === 0 || atMember.some((row) => packageOf(row) === undefined || host.declinesStoredRow(type, name, row))) {
        return undefined;
    }
    const holders = [...new Set(rows
        .filter((row) => !host.declinesStoredRow(type, name, row))
        .map(packageOf)
        .filter((id): id is string => id !== undefined))];
    if (typeof registry.isPackageDisabled === 'function' && holders.some((id) => registry.isPackageDisabled(id) === true)) {
        return undefined;
    }
    const closure = (id: string): readonly string[] => packageDependencyClosure(id, registry as PackageClosureRegistry)?.dependencies ?? [];
    // [#33210 contract review M1] Each package against its own closure, as
    // `isBundleAddition` judges it: an addition to ANY other holder it
    // declares, never to one base every package must share. [S2] No member
    // clashes: no package ships the name here, and the registry's clash is
    // a member shipped in code (`codeMembersOf`), never one held only as
    // stored rows.
    const isAdditionTo = (id: string, other: string): boolean => other !== id
        && closure(id).includes(other) && !closure(other).includes(id);
    const bases = holders.filter((id) => !holders.some((other) => isAdditionTo(id, other)));
    if (bases.length !== 1) return undefined;
    const [base] = bases;
    const atMemberPackages = new Set(atMember.map((row) => packageOf(row)!));
    const installed = installedManifestsOfEngine(host.engine);
    const isPairOfAHolder = (id: string): boolean => holders.some((other) => other !== id && pairsOf(other, installed).includes(id));
    return { base, atMember: atMemberPackages, pairAmongHolders: [...atMemberPackages].some(isPairOfAHolder) };
}

/**
 * [#34901] `item`, a SERVED object body, with the `_withheldFields` read
 * decoration: each field a disabled package's `extend` contribution adds and
 * the served fold therefore withholds, with that package
 * (`SchemaRegistry.getWithheldExtensionFields`), less any name the body itself
 * declares. `item` itself when nothing is withheld, or when the registry
 * cannot answer.
 *
 * Why it is served: an owner's view keeps naming such a field on purpose (the
 * column returns when the package is re-enabled, with no write), while the
 * data door refuses the name as unknown on every query axis. The console reads
 * this map to leave exactly those names out of a request — a name nothing
 * declares is still sent, and still refused, so a typo stays loud.
 *
 * A read decoration (`METADATA_READ_DECORATIONS`, `@objectstack/spec`): derived
 * on every read, stripped on every write and before any re-parse, never
 * authorable. Stamped on the served faces only (this by-name read and the
 * served list); never on the layered/editor read, the execution face, a
 * pending draft's authoring read or a registry fold.
 */
export function withWithheldFieldsDecoration(registry: unknown, item: unknown, name?: string): unknown {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) return item;
    const body = item as Record<string, unknown>;
    const objectName = typeof name === 'string' && name !== '' ? name : body.name;
    const r = registry as { getWithheldExtensionFields?: (name: string) => Record<string, { packageId: string }> } | null | undefined;
    if (typeof objectName !== 'string' || typeof r?.getWithheldExtensionFields !== 'function') return item;
    const withheld = r.getWithheldExtensionFields(objectName);
    const declared = body.fields !== null && typeof body.fields === 'object' && !Array.isArray(body.fields)
        ? body.fields as Record<string, unknown>
        : undefined;
    const entries = Object.entries(withheld)
        .filter(([field]) => !(declared && Object.prototype.hasOwnProperty.call(declared, field)));
    if (entries.length === 0) return item;
    return { ...body, _withheldFields: Object.fromEntries(entries.map(([field, at]) => [field, { packageId: at.packageId }])) };
}

/**
 * [ADR-0146 D10] `item` with the served object read's
 * `_relatedListsArrangement` decoration: what the tab list the base's paired
 * `.custom` package declares says that the served `relatedLists` cannot
 * (`SchemaRegistry.getRelatedListsArrangement`): the lists it hides, and
 * whether a list no entry names is shown after the listed tabs. `item` itself
 * when no `.custom` package arranges the object's tabs, or when the registry
 * cannot answer.
 *
 * Why it is served: the registry fold writes the `.custom` tab list into
 * `relatedLists` (the entries it shows, then the entries of the arrangement
 * it replaces that it does not name), and `relatedLists` keeps the meaning it
 * has on every object. Which lists exist for the reader is the record page's
 * to know, so the two things that depend on it travel beside the list, and
 * the record page reads them through `readRelatedListsArrangement`
 * (`@objectstack/spec/data`).
 *
 * A read decoration (`METADATA_READ_DECORATIONS`, `@objectstack/spec`), on the
 * faces {@link withWithheldFieldsDecoration} is stamped on and no other.
 */
export function withRelatedListsArrangementDecoration(registry: unknown, item: unknown, name?: string): unknown {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) return item;
    const body = item as Record<string, unknown>;
    const objectName = typeof name === 'string' && name !== '' ? name : body.name;
    const r = registry as { getRelatedListsArrangement?: (name: string) => RelatedListsArrangement | undefined } | null | undefined;
    if (typeof objectName !== 'string' || typeof r?.getRelatedListsArrangement !== 'function') return item;
    const arrangement = r.getRelatedListsArrangement(objectName);
    if (arrangement === undefined) return item;
    return {
        ...body,
        [RELATED_LISTS_ARRANGEMENT_DECORATION]: {
            packageId: arrangement.packageId,
            hidden: [...arrangement.hidden],
            unlisted: arrangement.unlisted,
        },
    };
}

/**
 * `item` with every decoration the served object read derives from the
 * registry: {@link withWithheldFieldsDecoration} and
 * {@link withRelatedListsArrangementDecoration}. `item` itself when neither
 * applies. The one call of the served by-name read and the served list.
 */
export function withServedObjectDecorations(registry: unknown, item: unknown, name?: string): unknown {
    return withRelatedListsArrangementDecoration(registry, withWithheldFieldsDecoration(registry, item, name), name);
}

/** The body of `ObjectStackProtocolImplementation#readMetaItemFace`; the method's docblock there is its contract. */
export async function readMetaItemFace(
    this: Pick<MetaItemFaceHost, 'readMetaItem'> & ServedRowHost,
    request: {
        type: string, name: string, packageId?: string, state?: 'active' | 'draft', previewDrafts?: boolean,
        member?: string,
        /** [#34818] The draft read's user-sentence locales (`GetMetaItemRequestSchema.userTextLocales`). */
        userTextLocales?: readonly string[],
    },
    face: 'served' | 'execution',
) {
    if (request.type === 'object' && isObjectOfDisabledPackage(this.engine?.registry, request.name)) {
        throw objectPackageDisabledError(request.name);
    }
    // [#32183] A name a disabled package also holds is read at the served
    // holder's address ({@link servedHolderAddressOf}), so no layer of the
    // read can be the disabled holder's. [#32354] …judged over the stored
    // rows too ({@link servedAddressOf}), so the answer never follows save order.
    // [contract review N1] The member selector resolved once, as the layered
    // read resolves it: a malformed one is the read's own 400, never a 409
    // judged at a member nobody named.
    // [#32607] …and refuses two enabled row holders of a name nobody ships.
    // The rows that judgment reads are read on the face's key and handed to
    // the read below, which takes them instead of reading them again
    // (#24371: the item's active rows, one read). [#34441 cell 2] Every
    // judgment below that reads them takes the rows read already, so the
    // served-holder and row-held-base judgments together are still one read.
    let activeRows: PrereadActiveRows | undefined;
    const host = this;
    const judgeHost: ServedRowHost = {
        get engine() { return host.engine; },
        packagelessAddress: (...a) => this.packagelessAddress(...a),
        shippedArtifactsOf: (...a) => this.shippedArtifactsOf(...a),
        declinesStoredRow: (...a) => this.declinesStoredRow(...a),
        rethrowUnlessMetadataStoreUnprovisioned: (...a) => this.rethrowUnlessMetadataStoreUnprovisioned(...a),
        readItemActiveRows: async (type, name) => {
            if (activeRows !== undefined && activeRows.type === type && activeRows.name === name) return [...activeRows.rows];
            const rows = await this.readItemActiveRows(type, name, true);
            activeRows = { type, name, rows };
            return rows;
        },
    };
    // [#32849] …and a member whose one shipper's declared override is stored
    // is read at that shipper ({@link declaredMemberOverrideAddressOf}).
    const member = request.packageId ? undefined : resolveBundleMemberSelector(request.type, request.member);
    // [#33210 (c)] …and a member only a dependent's addition holds, over a
    // base holding the name only as stored rows, is read at that base
    // ({@link rowHeldBaseAddressOf}), as it is when the base ships the name.
    const servedAddress = request.packageId
        ? undefined
        : await servedAddressOf(judgeHost, request.type, request.name, member, { refuseWithoutDisabled: true })
            ?? (request.state === 'draft'
                ? undefined
                : await declaredMemberOverrideAddressOf(judgeHost, request.type, request.name, member)
                    ?? await rowHeldBaseAddressOf(judgeHost, request.type, request.name, member));
    const answer = await this.readMetaItem(servedAddress === undefined ? request : { ...request, packageId: servedAddress }, { face, ...(activeRows !== undefined ? { activeRows } : {}) });
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
    // [#32183, ruling (c)] …and an address naming a disabled package, or a
    // pair whose every base is disabled, is that package's withheld item,
    // whichever envelope a layer of the read reached: the disabled body is
    // never served under another package's envelope.
    // [#32183, epic ruling R4-B] …and so is any other exact address of a name
    // only disabled packages hold, unless the read reached a row stored under
    // that address's own package: a sibling module's address must not serve a
    // disabled holder's pair row (row 17).
    // [#32814] …and the read naming no package that reached a row of a
    // holder's customization pair ({@link isHoldersPairRow}) judges the
    // name's holders too, as it does when it reached nothing: a pair row of a
    // name only disabled packages hold is their withheld item, the answer the
    // same read gives with no row stored.
    // [#33401] …and so does a package-less row of a key whose every holder is
    // disabled ({@link packagelessRowWithheld}): that holder's customization,
    // withheld with it; the environment's own item is served, and so is the
    // row while an enabled package holds the name through a stored row
    // (review#2 S5), judged over the active rows read above.
    const withheldHolder = request.type === 'object' || request.type === 'package'
        ? undefined
        : (request.packageId ? disabledExactAddressHolder(this, { type: request.type, name: request.name, packageId: request.packageId }) : undefined)
            ?? (answer?.item == null
                || (request.packageId
                    ? !isStoredUnder(answer.item, request.packageId)
                    : isHoldersPairRow(this.engine, request.type, request.name, answer.item))
                ? disabledOnlyHolderOf(this.engine?.registry, request.type, request.name)
                : undefined)
            ?? (request.packageId || answer?.item == null
                ? undefined
                : await packagelessRowWithheld(this, request.type, request.name, answer.item,
                    activeRows !== undefined && activeRows.type === request.type && activeRows.name === request.name
                        ? activeRows.rows : undefined));
    if (withheldHolder === undefined && (request.type === 'object' || request.type === 'package'
        || (!withheldAction && !isItemOfDisabledPackage(this.engine?.registry, answer?.item)))) {
        // [#34901] The served object read names the fields a disabled
        // package withholds, and [ADR-0146 D10] what the paired `.custom`
        // tab list says beside `relatedLists`
        // ({@link withServedObjectDecorations}); the execution face and a
        // pending draft's authoring read never do.
        if (request.type === 'object' && face === 'served' && request.state !== 'draft' && answer?.item != null) {
            const item = withServedObjectDecorations(this.engine?.registry, answer.item, request.name);
            return item === answer.item ? answer : { ...answer, item };
        }
        return answer;
    }
    if (request.state === 'draft') throw noPendingDraftError(request.type, request.name);
    const { item: _withheld, registration: _servedOnly, ...envelope } = answer as typeof answer & { registration?: unknown };
    const withheld = { ...envelope, item: undefined };
    // Not every arm of the read's envelope declares `packageId`; each may carry it.
    if (withheldHolder !== undefined) (withheld as { packageId?: string }).packageId = withheldHolder;
    return withheld;
}
