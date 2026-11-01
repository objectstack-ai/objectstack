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
 * A row is listed exactly when {@link isServedOverrideRowOf} holds for it and
 * X — the predicate the effective read asks before it serves a `.custom` row
 * at X's address (`servedOverlayRowCandidates`, N-10). ⛔ Never a body-only
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

import { customizationPackageId } from '@objectstack/spec/kernel';
import { PLURAL_TO_SINGULAR } from '@objectstack/spec/shared';
import { storedRowDocument } from './item-lock.js';
import type { ObjectStackProtocolImplementation } from './protocol.js';
import { isServedOverrideRowOf } from './served-override.js';

/** The class members {@link listServedOverrides} reads, typed as the class declares them. */
export interface ServedOverridesHost {
    readonly findEnvironmentRows: ObjectStackProtocolImplementation['findEnvironmentRows'];
    readonly declinesStoredRow: ObjectStackProtocolImplementation['declinesStoredRow'];
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
 * The served overrides of `request.packageId`'s items: the ACTIVE rows of its
 * pair that {@link isServedOverrideRowOf} admits and no read declines, ordered
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
    this: Pick<ServedOverridesHost, 'findEnvironmentRows' | 'declinesStoredRow' | 'rethrowUnlessMetadataStoreUnprovisioned'>,
    request: { packageId: string },
): Promise<ServedOverrideEntry[]> {
    const base = request.packageId;
    const pair = customizationPackageId(base);
    if (!pair.ok) return [];
    let rows: any[] = [];
    try {
        rows = await this.findEnvironmentRows('sys_metadata', {
            where: { package_id: pair.value, state: 'active' },
            context: { isSystem: true },
        });
    } catch (error) {
        // [#5532] An unprovisioned store holds no row, so no override; any
        // other failure is a read that did not happen, never "nothing
        // overridden".
        this.rethrowUnlessMetadataStoreUnprovisioned(error, 'sys_metadata');
    }
    const entries = new Map<string, ServedOverrideEntry>();
    for (const row of rows ?? []) {
        if (typeof row?.name !== 'string' || row.name === '') continue;
        if (!isServedOverrideRowOf(row, base)) continue;
        const type = PLURAL_TO_SINGULAR[row.type] ?? row.type;
        if (this.declinesStoredRow(type, row.name, row)) continue;
        const member = typeof row.bundle_member === 'string' && row.bundle_member !== '' ? row.bundle_member : undefined;
        // `isServedOverrideRowOf` parsed this body already; a body it admitted parses.
        const declaration = (storedRowDocument(row) as { overrides?: { basedOn?: unknown } }).overrides;
        const version = typeof row.version === 'number' && Number.isInteger(row.version) && row.version >= 0
            ? row.version
            : undefined;
        const entry: ServedOverrideEntry = {
            type,
            name: row.name,
            ...(member !== undefined ? { member } : {}),
            ...(typeof declaration?.basedOn === 'string' ? { basedOn: declaration.basedOn } : {}),
            ...(version !== undefined ? { version } : {}),
        };
        // A row stored under the type's other spelling (pre-#4432 residue)
        // and one under the canonical spelling are one item: listed once,
        // the canonical row's facts kept.
        const key = `${type}\u0000${row.name}\u0000${member ?? ''}`;
        if (!entries.has(key) || row.type === type) entries.set(key, entry);
    }
    return [...entries.values()].sort((a, b) =>
        a.type.localeCompare(b.type) || a.name.localeCompare(b.name) || (a.member ?? '').localeCompare(b.member ?? ''));
}
