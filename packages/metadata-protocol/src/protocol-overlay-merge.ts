// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#25467 E0] Part of the module preamble of `protocol.ts`, moved here verbatim: the served
// overlay row candidates and the package-aware overlay merge.
//
// A MOVE, not a redesign: every declaration below is byte-identical to the text that stood
// above `ObjectStackProtocolImplementation`; only the imports and the export list at the foot
// are new. `protocol.ts` re-exports what it exported.
import {
    itemDiscriminator,
} from '@objectstack/metadata-core';

/**
 * One place a stored `sys_metadata` row of an item can sit, as
 * {@link servedOverlayRowCandidates} orders them: a spelling of the type
 * (`'canonical'`, or `'other'`, the type's singular/plural twin, pre-#4432
 * residue), and the package the row is bound to: the address's package, `null`
 * for the package-less row, or `undefined` for any row (an address that names
 * no package). Every row in a candidate's place is the environment's
 * (ADR-0131 D6/D7: the reads leave a legacy organization's rows out).
 */
interface ServedOverlayRowCandidate {
    readonly spelling: 'canonical' | 'other';
    readonly packageId: string | null | undefined;
}

/**
 * [#21804] Where a stored row the list read sits, beside the package it is
 * bound to: the type spelling it is stored under (the row's own `type`
 * column).
 */
interface StoredRowPlace {
    readonly type: string;
}

/**
 * [#21804, ADR-0131 D6, ADR-0048] THE served-row resolution: the order in
 * which the stored rows of one item are tried for the CONTENT a read serves.
 * The first candidate that holds a row is the served row.
 *
 *  - Scope (ADR-0131 D6): the environment's rows only. A legacy
 *    organization-scoped row is refused at boot
 *    (the v18 boot refusal, ADR-0131 D10 item 5)
 *    and never served, by any read: the anonymous form doors' read of the
 *    Default Organization's legacy layer was deleted when the v18 migration
 *    ceremony began carrying those rows' withdrawals into the environment
 *    (ADR-0131 C7, rulings A on #22008 and #22011).
 *  - Then the spelling: the canonical type, then the other spelling (the
 *    at-rest tolerance the reads have always had, #4432).
 *  - Then the package (ADR-0048 prefer-local): with a `packageId`, that
 *    package's own row, then the package-less row, never another package's;
 *    with none, any row.
 *
 * Both readers of stored content take this order, so they cannot pick
 * differently: {@link ObjectStackProtocolImplementation.findServedOverlayRow}
 * (`getMetaItem`, its draft-preview arm, `getMetaItemLayered`) asks the store
 * candidate by candidate, and {@link mergePackageAwareOverlay} (the list's
 * active and draft-preview merges, a list scoped to a package included, whose
 * package-less rows enter as stand-ins, #21817) asks the rows it already read. Before
 * #21804 the list took the LATEST of a package's row and the package-less row
 * in row order, so in one order the list served the package-less body for a
 * package whose by-name read served the package's own row.
 *
 * It decides content only. The lock is selected separately, from every row in
 * scope (`resolveOverlayLockLayer` in `item-lock.ts`, #21761).
 */
export function servedOverlayRowCandidates(address: {
    /**
     * [#23715] `null` addresses the package-unbound row alone: the strict
     * draft read naming no package, at the draft its `version` names
     * ({@link ObjectStackProtocolImplementation.strictDraftReadAddress}).
     */
    readonly packageId: string | null | undefined;
}): ServedOverlayRowCandidate[] {
    const packages: Array<string | null | undefined> = address.packageId === null
        ? [null]
        : address.packageId ? [address.packageId, null] : [undefined];
    return (['canonical', 'other'] as const).flatMap((spelling) =>
        packages.map((packageId) => ({ spelling, packageId })));
}

/**
 * [#24371] Whether a stored row read by
 * {@link ObjectStackProtocolImplementation.readItemActiveRows} is one the
 * store would answer for `where`, an equality `where` of the shape the
 * by-name read's selections send ({@link servedOverlayRowCandidates}'
 * candidates, the package-less binding and the lock's scope): every key equal,
 * and `null` matching an absent value as the store's IS NULL does.
 */
export function rowMatchesOverlayWhere(row: object, where: Readonly<Record<string, unknown>>): boolean {
    const stored = row as Readonly<Record<string, unknown>>;
    return Object.entries(where).every(([key, value]) => (stored[key] ?? null) === value);
}

/**
 * [#21967, ADR-0048] The package dimension of
 * {@link servedOverlayRowCandidates}, in its order: with a package, that
 * package (`packageId`) and then the package-less rows (`null`); with none,
 * `undefined`, which matches a row of any package.
 */
export function addressPackages(packageId: string | undefined): ReadonlyArray<string | null | undefined> {
    return [...new Set(servedOverlayRowCandidates({ packageId })
        .map((candidate) => candidate.packageId))];
}

/**
 * [#21967, ADR-0048] The stored view container expansion that serves `name`
 * at the address of `packageId`, among `expansions`
 * ({@link ObjectStackProtocolImplementation.expandStoredViewContainers}, each
 * paired with the container row it came from); `undefined` when none does.
 *
 * The package order is the package dimension of
 * {@link servedOverlayRowCandidates}, the one prefer-local resolution: with a
 * package, the expansion of that package's own container row first, then the
 * expansion of a package-less one, which stands in for every package with no
 * container row of its own, and never another package's; with none, any
 * expansion. Within one package the last expansion of the name wins, as
 * before (two containers of one package that expand one name are refused at
 * the save door).
 *
 * Both doors select through this function: the list read
 * ({@link ObjectStackProtocolImplementation.readFlattenedMetaItems}) for each
 * package's slot of the name, and the by-name read
 * ({@link ObjectStackProtocolImplementation.resolveRowlessExpandedView}) for
 * the package it names. So a package's slot in the list and the by-name read
 * naming that package serve the same expansion. Before, the list upserted the
 * last expansion of a name over every package's item of it, so one package's
 * stored copy of a container displaced another package's item of each name
 * the copy expands, a withdrawn public form included.
 */
export function servedViewExpansion<E extends { packageId: string | undefined }>(
    expansions: ReadonlyArray<{ item: Record<string, unknown>; container: E }>,
    name: string,
    packageId: string | undefined,
): { item: Record<string, unknown>; container: E } | undefined {
    for (const pkg of addressPackages(packageId)) {
        let served: { item: Record<string, unknown>; container: E } | undefined;
        for (const expanded of expansions) {
            if (expanded.item.name !== name) continue;
            if (pkg === undefined || (expanded.container.packageId ?? null) === pkg) served = expanded;
        }
        if (served !== undefined) return served;
    }
    return undefined;
}

/**
 * ADR-0048 (#1828) — package-aware overlay merge for the unscoped metadata list.
 *
 * `baseItems` (the lower layer: registry artifacts, or the running result) and
 * `records` (the higher layer: active `sys_metadata` overlays, or draft rows)
 * are merged so that:
 *
 *   • Two installed packages shipping the same `type/name` stay TWO rows —
 *     resolution is per `(package, name)`, not bare `name`, so a higher-layer
 *     row no longer collapses a same-name row from a different package.
 *   • For each package `P` that owns a row of a given name, the winner is
 *     `P`'s own row or a package-less ("global", `package_id IS NULL`) row,
 *     the higher layer winning — `getMetaItem(name, packageId=P)`'s
 *     "scoped-then-global-fallback" resolution, so the list and single-item
 *     paths agree. This is also why a legacy row whose active/draft layers
 *     disagree on package attribution still collapses (a package-less active
 *     row + its `package_id`-bearing draft resolve to the one package slot,
 *     draft winning).
 *   • [#21804] When `records` are stored rows the caller read (each record
 *     carrying its `stored` place), the winner among them is the one
 *     {@link servedOverlayRowCandidates} picks for `P`: `P`'s own row before
 *     the package-less one. It
 *     is the resolution `getMetaItem` takes, so it does not depend on the
 *     order the store returned the rows in. Records with no `stored` place
 *     (the MetadataService merge, whose `records` are already-resolved items)
 *     leave the LATEST contribution the winner, as before.
 *   • A name with NO package-owned row resolves to its latest package-less
 *     contribution — the pre-existing env-wide behaviour, unchanged.
 *   • [#21817] A list scoped to one package passes the package-less rows in
 *     its scope as STAND-INS (`standIn` on a record). A stand-in serves a
 *     slot the package seats, by the same served-row resolution, so the
 *     scoped list's slot is what `getMetaItem` naming the package serves:
 *     the package's own row, else the package-less row. A stand-in never
 *     seats a slot itself, so the scoped list still lists only the items the
 *     package ships. A slot that only stand-ins reach is emitted with its
 *     latest stand-in and recorded in `unseated`, and an item recorded there
 *     that arrives as a base item counts as a stand-in again: a later layer
 *     (the draft preview, the MetadataService listing) may still seat that
 *     slot, and the caller drops what is still recorded once the last layer
 *     has merged.
 *
 * `transform(data, prev)` runs on each `records` body before it enters the
 * merge (view-identity healing, draft tagging); `prev` is the base row it
 * shadows at the same slot (or any same-name base row), else undefined.
 *
 * [#7774] The bucket is per SLOT, not per name, and for a type in
 * `ITEM_KEY_DISCRIMINATORS` the slot is `(name, discriminator)`. This is the
 * half of the collapse that #7774's card predicted would need no change, and
 * it needed one: the card reasoned about the OVERLAY rows (correctly — they
 * are unique on `type+name+organization_id+package_id` and carry no locale
 * column), but the rows are only the higher layer. `baseItems` is the
 * SchemaRegistry's listing, and since #7730 that listing carries every member
 * of a bundle. Bucketed by bare name, two members of one bundle landed in one
 * bucket and the loop below emitted exactly one row per `(bucket, package)` —
 * so a single unrelated overlay row for the type was enough to drop a locale,
 * and the surviving row was the overlay body regardless of which member it
 * actually customizes. Slot-keyed, the overlay lands on its OWN member and the
 * others are served untouched. An undiscriminated type's slot is its name, so
 * its buckets are unchanged.
 *
 * @param type Canonical (singular) metadata type of every row being merged.
 * @param unseated [#21817] The scoped list's record of stand-ins no
 *        contribution has seated yet (see the stand-in bullet above).
 */
export function mergePackageAwareOverlay(
    type: string,
    baseItems: unknown[],
    records: Array<{ data: unknown; packageId: string | undefined; stored?: StoredRowPlace; standIn?: boolean }>,
    transform?: (data: any, prev: any) => any,
    unseated?: WeakSet<object>,
): unknown[] {
    // Per-SLOT, layer-ordered contributions; `pkg: undefined` = package-less.
    // `stored` marks a contribution that is a stored row the caller read;
    // `standIn` one that serves a slot without seating it ([#21817]).
    type Contribution = { pkg: string | undefined; item: any; stored?: StoredRowPlace; standIn?: true };
    const buckets = new Map<string, Contribution[]>();
    const order: string[] = []; // first-seen slot order → stable output
    const slotOf = (item: unknown, name: unknown): string => {
        const disc = itemDiscriminator(type, item);
        return disc === undefined ? String(name) : `${String(name)}\u0000${disc}`;
    };
    const push = (slot: string, pkg: string | undefined, item: any, stored?: StoredRowPlace, standIn?: boolean) => {
        let list = buckets.get(slot);
        if (!list) { buckets.set(slot, (list = [])); order.push(slot); }
        const c: Contribution = stored ? { pkg, item, stored } : { pkg, item };
        if (standIn) c.standIn = true;
        list.push(c);
    };
    // [#21804] The stored row the served-row resolution picks for package
    // `real` among a slot's contributions: the first candidate of
    // {@link servedOverlayRowCandidates} that one of the rows sits at.
    const servedStoredRow = (list: readonly Contribution[], real: string | undefined): any => {
        for (const candidate of servedOverlayRowCandidates({ packageId: real })) {
            const hit = list.find((c) => c.stored !== undefined
                && (c.stored.type === type ? 'canonical' : 'other') === candidate.spelling
                && (candidate.packageId === undefined || (c.pkg ?? null) === candidate.packageId));
            if (hit) return hit.item;
        }
        return undefined;
    };

    for (const raw of baseItems) {
        const item = raw as any;
        if (item && typeof item === 'object' && 'name' in item) {
            push(slotOf(item, item.name), (item._packageId ?? undefined) as string | undefined, item,
                undefined, unseated?.has(item));
        }
    }
    for (const { data, packageId, stored, standIn } of records) {
        const body = data as any;
        if (!(body && typeof body === 'object' && 'name' in body)) continue;
        // The base row this record shadows at its own slot (for view-identity
        // healing): a same-package row, else a package-less one, else any
        // same-slot row it stands in for.
        const slot = slotOf(body, body.name);
        const list = buckets.get(slot);
        const prev = list
            ? (list.find((c) => c.pkg === packageId)?.item
                ?? list.find((c) => c.pkg === undefined)?.item
                ?? list[0]?.item)
            : undefined;
        push(slot, packageId, transform ? transform(body, prev) : body, stored, standIn);
    }

    const out: unknown[] = [];
    for (const slot of order) {
        const list = buckets.get(slot)!;
        // [#21817] Only stand-ins reach this slot: no item of the package is
        // here (yet), so the stand-in is held back, not served as one.
        if (list.every((c) => c.standIn)) {
            // The stand-in the one candidate order picks among the stored
            // rows here, else (no stored row: a stand-in held back by an
            // earlier merge) the latest.
            let held = servedStoredRow(list, undefined);
            if (held === undefined) held = list[list.length - 1].item;
            unseated?.add(held);
            out.push(held);
            continue;
        }
        const reals = Array.from(new Set(list.filter((c) => c.pkg !== undefined).map((c) => c.pkg)));
        if (reals.length === 0) {
            out.push(list[list.length - 1].item); // latest package-less row wins
            continue;
        }
        for (const real of reals) {
            // getMetaItem(name, real) resolution. [#21804] A stored row is
            // chosen by the served-row resolution, whatever order the rows
            // came back in; with no stored row of `real`'s own or package-less,
            // the latest lower-layer contribution of either stands, as before.
            let chosen: any = servedStoredRow(list, real);
            if (chosen === undefined) {
                for (const c of list) {
                    if ((c.pkg === real || c.pkg === undefined) && c.stored === undefined) chosen = c.item;
                }
            }
            if (chosen === undefined) continue;
            // A package-less body standing in for package `real` must carry
            // `real`'s provenance (the base row it replaced was `real`'s).
            if (chosen._packageId === undefined) chosen = { ...chosen, _packageId: real };
            out.push(chosen);
        }
    }
    return out;
}
