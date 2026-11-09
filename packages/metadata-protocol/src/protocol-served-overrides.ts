// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#28411, ADR-0146 D8 item 4] The overrides half of the per-package
 * customization read: every item of a base X's paired `<X>.custom` package
 * that the effective read serves over X's item of the same name.
 *
 * `GET /packages/:id/customizations` (`@objectstack/runtime`) answers "what did
 * we change on HotCRM" from three lists; this module is the first of them. The
 * other two are not the protocol's: the extensions are the object registry's
 * `extend` contributors, and the switched-off items are the activation
 * ledger's rows, each read by the door from its own owner.
 *
 * ## One predicate, not a second spelling
 *
 * A row is listed exactly when it holds one of the pair's candidates for X in
 * the served reads' order — `isServedOverrideRowOf`, the predicate the
 * effective read asks before it serves a `.custom` row at X's address
 * (`servedOverlayRowCandidates`, N-10), or [#31656] the moved edit's
 * {@link isMovedOverrideRowOf} (below). ⛔ Never a body-only
 * test such as `overrides.package === X`: a declaration from a package that is
 * not X's pair, or a pair row with no declaration, is not served as X's item,
 * so it is not an override of X either. The agreement is pinned in
 * `@objectstack/objectql`'s `protocol-package-customizations.test.ts`: every
 * override listed is the item the layered read reports as `overlay` for X.
 *
 * ## Only rows a read serves
 *
 * Three narrowings, each the read path's own:
 *
 *  - ACTIVE rows only. A pending draft serves nothing until it is published.
 *  - The environment's rows only ({@link ObjectStackProtocolImplementation.findEnvironmentRows}
 *    leaves a legacy organization's out, ADR-0131 D6/D7). No per-organization
 *    axis exists to filter on (ADR-0131 D6), so every caller gets one answer.
 *  - A row the reads decline ({@link ObjectStackProtocolImplementation.declinesStoredRow}:
 *    a code-defined datasource name, sealed managed content) is not listed.
 *    Its declaration may be well formed, but the base's document is what
 *    every read serves for the name, so it overrides nothing. [#28412] A
 *    shipped flow name's declared override is not declined (ADR-0146 D9
 *    item 1): the reads serve it over the base's flow, so it is listed; the
 *    row is handed over whole, so the decline judges it on its own binding.
 *
 * ## What it reports, and what it never computes
 *
 * ## [#31656] A moved edit is listed where it is served now, and only there
 *
 * A row is admitted through the served reads' own candidates, in their order
 * ({@link servedOverlayRowCandidates}, {@link holdsServedOverlayCandidate}):
 * the pair's declared override of X first, then the pair's override of the
 * item from before a later version of X's App moved it to X
 * ({@link isMovedOverrideRowOf}, `suite-moved-overlay.ts`). So after a suite
 * split (or its rollback) the tenant's edit is listed under the package that
 * ships the item now, the one whose address serves it. ⛔ It is no longer
 * listed under the former owner whose name the declaration still carries: a
 * pair row that a package shipping the item now holds as a moved edit is that
 * package's. Same App is read only through the predicates (`appOf` over the
 * installed manifests), never here. Which packages ship the item is the
 * registry's answer the served by-name read takes too (`shippedArtifactsOf`).
 *
 * The list stays the pair's rows. A row bound to a package of the App itself
 * (a Regime O save from before the ADR-0146 D11 close) is served at the new
 * owner through `isMovedBaseRowOf`'s candidate, last, but it is not a
 * pair row, so it is listed under no package, as such a row bound to the
 * package that still ships the item is not listed today.
 *
 * Each entry is the row's own facts: its type (folded to the canonical
 * singular), its name, its bundle member when the type's identity is a pair,
 * the `basedOn` its declaration records and the row's history `version`.
 * ⛔ No diff against the base's document and no `basedOn` verdict (ADR-0146
 * D2, D6): `basedOn` is copied as recorded.
 *
 * Shape: the host-split of `protocol-environment-rows.ts`. The class keeps the
 * method and its declared signature; the body here reads only the
 * {@link ServedOverridesHost} members.
 */

import { pairsOf } from '@objectstack/metadata-core';
import { PLURAL_TO_SINGULAR } from '@objectstack/spec/shared';
import { storedRowDocument } from './item-lock.js';
import type { ObjectStackProtocolImplementation } from './protocol.js';
import { holdsServedOverlayCandidate, servedOverlayRowCandidates } from './protocol-overlay-merge.js';
import { shippingPackageIds } from './protocol-environment-rows.js';
import { isMovedOverrideRowOf } from './suite-moved-overlay.js';
import { installedManifestsOfEngine } from './installed-manifests.js';

/** The class members {@link listServedOverrides} reads, typed as the class declares them. */
export interface ServedOverridesHost {
    readonly engine: ObjectStackProtocolImplementation['engine'];
    readonly findEnvironmentRows: ObjectStackProtocolImplementation['findEnvironmentRows'];
    readonly declinesStoredRow: ObjectStackProtocolImplementation['declinesStoredRow'];
    readonly shippedArtifactsOf: ObjectStackProtocolImplementation['shippedArtifactsOf'];
    readonly rethrowUnlessMetadataStoreUnprovisioned: ObjectStackProtocolImplementation['rethrowUnlessMetadataStoreUnprovisioned'];
}

/** One served override of a base package's item, as the per-package read lists it. */
export interface ServedOverrideEntry {
    /** The overriding item's metadata type, canonical singular (`view`, `dashboard`). */
    type: string;
    /** The item's name: the base's name it is served under. */
    name: string;
    /** The bundle member, for a type whose identity is a pair (`email_template`, `(name, locale)`); absent otherwise. */
    member?: string;
    /** `overrides.basedOn` exactly as the declaration records it; absent when the stored body records none. */
    basedOn?: string;
    /** The stored row's history version; absent when the row carries none. */
    version?: number;
}

/**
 * The served overrides of `request.packageId`'s items: per item, the ACTIVE
 * row of its pair that the served reads' candidates pick (the declared
 * override, else [#31656] the moved edit, module header) and no read
 * declines, ordered
 * by type, name and member. A base with no pair package, or a package id that
 * has no pair (a `.custom` id, an invalid id), answers `[]`; this read never
 * creates the pair.
 *
 * @throws the `sys_metadata` read failure, classified as every overlay read
 *         classifies it ({@link ObjectStackProtocolImplementation.rethrowUnlessMetadataStoreUnprovisioned}):
 *         a read that did not happen is never reported as "nothing overridden".
 *         An unprovisioned table answers `[]`.
 */
export async function listServedOverrides(
    this: Pick<ServedOverridesHost, 'engine' | 'findEnvironmentRows' | 'declinesStoredRow' | 'shippedArtifactsOf' | 'rethrowUnlessMetadataStoreUnprovisioned'>,
    request: { packageId: string },
): Promise<ServedOverrideEntry[]> {
    const base = request.packageId;
    const installed = installedManifestsOfEngine(this.engine);
    // [ADR-0146 D3 merge question 12] The App's pair, and a per-package pair
    // an earlier version created while it is installed (`pairsOf`).
    const pairs = pairsOf(base, installed);
    if (pairs.length === 0) return [];
    let rows: any[] = [];
    try {
        rows = await this.findEnvironmentRows('sys_metadata', {
            where: { package_id: pairs.length === 1 ? pairs[0] : { $in: pairs }, state: 'active' },
            context: { isSystem: true },
        });
    } catch (error) {
        // [#5532] An unprovisioned store holds no row, so no override; any
        // other failure is a read that did not happen, never "nothing
        // overridden".
        this.rethrowUnlessMetadataStoreUnprovisioned(error, 'sys_metadata');
    }
    // [#31656] The pair's rows of one item (type folded, name, member) are
    // judged together: the served reads pick one of them by candidate order.
    const items = new Map<string, { type: string; name: string; member: string | undefined; rows: any[] }>();
    for (const row of rows ?? []) {
        if (typeof row?.name !== 'string' || row.name === '') continue;
        const type = PLURAL_TO_SINGULAR[row.type] ?? row.type;
        if (typeof type !== 'string' || type === '') continue;
        const member = typeof row.bundle_member === 'string' && row.bundle_member !== '' ? row.bundle_member : undefined;
        const key = `${type}\u0000${row.name}\u0000${member ?? ''}`;
        const item = items.get(key) ?? { type, name: row.name as string, member, rows: [] as any[] };
        item.rows.push(row);
        items.set(key, item);
    }
    const entries: ServedOverrideEntry[] = [];
    for (const { type, name, member, rows: itemRows } of items.values()) {
        // The code packages that ship the item, read once per item and only
        // when a moved edit is in question (the by-name read's own reading).
        let shippers: ReadonlySet<string> | undefined;
        const shippersOf = (): ReadonlySet<string> =>
            (shippers ??= shippingPackageIds(this.shippedArtifactsOf(type, name, undefined, member)));
        const ships = (packageId: string): boolean => shippersOf().has(packageId);
        let served: any;
        for (const candidate of servedOverlayRowCandidates({ packageId: base, servedOverride: true, installed, ships })) {
            // Only the pair's candidates: the base's own row, the
            // package-less row and a row bound to a former owner are not
            // the pair's, and this list reads the pair's rows alone.
            if (candidate.overrideOf === undefined || candidate.moved === 'base') continue;
            served = itemRows.find((row) => (row.type === type ? 'canonical' : 'other') === candidate.spelling
                && row.package_id === candidate.packageId
                && holdsServedOverlayCandidate(candidate, row, installed, ships));
            if (served === undefined) continue;
            // A declared override the base no longer ships, which a package
            // shipping the item now holds as its moved edit, is that
            // package's: listed there, never also here.
            if (candidate.moved === undefined && !ships(base)
                && [...shippersOf()].some((now) => now !== base && isMovedOverrideRowOf(served, now, installed, ships))) {
                served = undefined;
            }
            break;
        }
        if (served === undefined) continue;
        if (this.declinesStoredRow(type, name, served)) continue;
        // The candidate's predicate parsed this body already; a body it admitted parses.
        const declaration = (storedRowDocument(served) as { overrides?: { basedOn?: unknown } }).overrides;
        const version = typeof served.version === 'number' && Number.isInteger(served.version) && served.version >= 0
            ? served.version
            : undefined;
        entries.push({
            type,
            name,
            ...(member !== undefined ? { member } : {}),
            ...(typeof declaration?.basedOn === 'string' ? { basedOn: declaration.basedOn } : {}),
            ...(version !== undefined ? { version } : {}),
        });
    }
    return entries.sort((a, b) =>
        a.type.localeCompare(b.type) || a.name.localeCompare(b.name) || (a.member ?? '').localeCompare(b.member ?? ''));
}
