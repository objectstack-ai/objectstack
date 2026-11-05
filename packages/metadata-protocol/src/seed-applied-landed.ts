// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#30348] `seedApplied.landed` — which stored rows a published seed landed
 * on, per object, split into the rows this publish CREATED and the
 * pre-existing rows a seed key MATCHED (objectstack-ai/cloud#3598 ruling A).
 *
 * One projection for both producers of the receipt: this package's
 * `applySeedBodies` (the in-protocol apply both publish doors run) and the
 * route-level fallback apply in `@objectstack/runtime`'s package-publish
 * door. Two copies would let the receipt's two producers disagree about what
 * "landed" means, which is the one thing a reader of the ids cannot check.
 *
 * The ids are the loader's own (`SeedLoadResult.landedIds` /
 * `insertedIds`); nothing here re-derives a row from the dataset. The shape
 * and the cap are the spec's ({@link SeedAppliedLandedSchema},
 * {@link SEED_APPLIED_LANDED_IDS_CAP}).
 */

import { SEED_APPLIED_LANDED_IDS_CAP } from '@objectstack/spec/api';
import type { SeedAppliedIdListParsed, SeedAppliedLandedParsed } from '@objectstack/spec/api';

/** The members of a loader dataset result this projection reads. */
export interface SeedLandingResult {
    readonly object: string;
    readonly landedIds?: readonly string[];
    readonly insertedIds?: readonly string[];
}

function cappedList(ids: readonly string[]): SeedAppliedIdListParsed {
    return {
        ids: ids.slice(0, SEED_APPLIED_LANDED_IDS_CAP),
        total: ids.length,
        truncated: ids.length > SEED_APPLIED_LANDED_IDS_CAP,
    };
}

/**
 * Fold the loader's per-dataset results into one entry per object, in the
 * order the objects first loaded. Several datasets of one object merge; an
 * id is listed once; an id some dataset of the object INSERTED is never also
 * listed as matched (a second dataset's key matching the row the first one
 * just created does not make it a customer's row). An object whose datasets
 * landed nothing still gets an entry with two empty lists: the loader ran
 * and reported, which is not the same answer as an absent key.
 */
export function seedAppliedLanded(results: ReadonlyArray<SeedLandingResult>): SeedAppliedLandedParsed[] {
    const byObject = new Map<string, { inserted: Set<string>; landed: Set<string> }>();
    for (const r of results) {
        if (!r || typeof r.object !== 'string') continue;
        let acc = byObject.get(r.object);
        if (!acc) {
            acc = { inserted: new Set(), landed: new Set() };
            byObject.set(r.object, acc);
        }
        for (const id of r.insertedIds ?? []) acc.inserted.add(id);
        for (const id of r.landedIds ?? []) acc.landed.add(id);
    }
    return [...byObject].map(([object, { inserted, landed }]) => ({
        object,
        inserted: cappedList([...inserted]),
        matched: cappedList([...landed].filter((id) => !inserted.has(id))),
    }));
}
