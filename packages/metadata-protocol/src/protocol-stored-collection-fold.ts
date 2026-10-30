// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25467 cut 35] Folding a collection's stored rows over the registered
 * ones, from `ObjectStackProtocolImplementation`, moved out of
 * `protocol.ts` whole: `foldStoredCollection`.
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
 * the {@link StoredCollectionFoldHost} members it reads, plus a `.call`. The `engine`
 * field is handed over as a getter, so each read reaches the class field as
 * it stands at call time; each call to another member is a closure, so it
 * still reaches the class method.
 * Every caller keeps calling the class methods.
 *
 * The read-seam census follows both directions of this shape (its
 * `HOST_SPLIT` note in `scripts/check-durability-degradation-log-level.mjs`),
 * so the storage reads below are still counted as the seams they were.
 *
 * What the bodies read from elsewhere, they import from where `protocol.ts`
 * imports it. Nothing re-exports this module, so the published surface does
 * not move.
 */

import { isMissingTableError } from '@objectstack/metadata/errors';
import type { ObjectStackProtocolImplementation } from './protocol.js';
import { mergePackageAwareOverlay } from './protocol.js';

/**
 * The `ObjectStackProtocolImplementation` members the functions below read —
 * every one of them, and no other; each function's `this` is the `Pick` of
 * the members it reads. Each is typed AS the class member (an indexed access
 * on the class), so a change to a member's signature on the class is a change
 * here too, and naming a member the class does not have is a compile error.
 */
export interface StoredCollectionFoldHost {
    readonly convertStoredItem: ObjectStackProtocolImplementation['convertStoredItem'];
    readonly engine: ObjectStackProtocolImplementation['engine'];
    readonly findEnvironmentRows: ObjectStackProtocolImplementation['findEnvironmentRows'];
    readonly foldObjectExtendersFromRegistry: ObjectStackProtocolImplementation['foldObjectExtendersFromRegistry'];
}

/** The body of `ObjectStackProtocolImplementation#foldStoredCollection`; the method's docblock there is its contract. */
export async function foldStoredCollection(
    this: Pick<StoredCollectionFoldHost, 'convertStoredItem' | 'engine' | 'findEnvironmentRows' | 'foldObjectExtendersFromRegistry'>,
    registered: unknown[],
    singularType: string,
    pluralType: string,
): Promise<unknown[]> {
    if (typeof this.engine?.find !== 'function') return registered;
    let rows: Record<string, unknown>[];
    try {
        // [ADR-0131 D6] The environment's rows only: a legacy
        // organization-scoped row is refused at boot, never read
        // (the v18 boot refusal, ADR-0131 D10 item 5).
        const read = async (type: string): Promise<Record<string, unknown>[]> => {
            // [#21911] The explicit system opt-in — see findServedOverlayRow.
            const rs = await this.findEnvironmentRows('sys_metadata', {
                where: { type, state: 'active' },
                context: { isSystem: true },
            });
            return (rs ?? []) as Record<string, unknown>[];
        };
        // The same singular/plural retry the registry half and
        // `getMetaItems` both perform: rows written through a plural
        // URL spelling are stored under it.
        rows = await read(singularType);
        if (rows.length === 0) rows = await read(pluralType);
    } catch (error) {
        if (!isMissingTableError(error, 'sys_metadata')) {
            console.warn(
                `[Protocol] the runtime authoring gate could not read stored '${singularType}' `
                + `metadata: ${(error as { message?: string } | null)?.message ?? String(error)}. `
                + `This write is NOT blocked, and nothing it saves is at risk — but the gate is `
                + `judging references against the SchemaRegistry alone for this write, so a `
                + `reference to a runtime-authored ${singularType} may be refused as unknown.`,
            );
        }
        return registered;
    }
    if (rows.length === 0) return registered;

    // Every readable row, in the shape {@link mergePackageAwareOverlay}
    // consumes: the converted body plus the row's own package provenance.
    // Reading a row is the only thing that can fail here, so it is the only
    // thing this loop does.
    const overlays: Array<{ data: unknown; packageId: string | undefined }> = [];
    for (const row of rows) {
        const name = row.name;
        if (typeof name !== 'string') continue;
        let body: unknown;
        try {
            const raw = row.metadata;
            body = this.convertStoredItem(
                singularType,
                typeof raw === 'string' ? JSON.parse(raw) : raw,
            );
        } catch (error) {
            // One unreadable row must not cost the other rows their place
            // in the universe — but it is said out loud, because dropping
            // it silently is the same manufactured phantom as above, one
            // name narrower.
            console.warn(
                `[Protocol] stored ${singularType}/${name} could not be read into the runtime `
                + `authoring gate's resolution context: `
                + `${(error as { message?: string } | null)?.message ?? String(error)}. `
                + `References to it may be refused as unknown until the row is re-saved.`,
            );
            continue;
        }
        if (!body || typeof body !== 'object') continue;
        overlays.push({
            data: body,
            packageId: typeof row.package_id === 'string' ? row.package_id : undefined,
        });
    }
    if (overlays.length === 0) return registered;

    // [#16224] The read API's OWN merge, with the read API's own transform
    // — not a second implementation of it. `mergePackageAwareOverlay` keys
    // by ADR-0048 package slot rather than by bare name, so an overlay
    // shadows the entry it actually overrides and two installed packages
    // shipping one `type/name` are still two entries; the transform is the
    // #8027 fold that keeps a winning `object` body at its RESOLVED shape.
    // Together they are the two lines {@link getMetaItems} runs, which is
    // the point: the gate's universe is now the same universe the platform
    // answers `GET /meta/:type` from, by construction rather than by
    // agreement.
    const merged = mergePackageAwareOverlay(singularType, registered, overlays, (data) =>
        this.foldObjectExtendersFromRegistry(
            singularType, (data as { name?: unknown } | null)?.name, data,
        ),
    );

    // A registry entry with no `name` is not addressable by any reference,
    // so the merge above has no slot for it and drops it. It is carried
    // through anyway: the rules that judge a collection's own coherence
    // (`measure-aggregate-incoherent` and its siblings) walk the list by
    // index and would lose a finding, and this method's contract is that
    // the universe GROWS. Empty in every ordinary deployment.
    const unaddressable = registered.filter(
        (item) => !(item && typeof item === 'object' && 'name' in item),
    );
    return unaddressable.length > 0 ? [...merged, ...unaddressable] : merged;
}
