// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25467 cut 33] Two degradations said out loud, from
 * `ObjectStackProtocolImplementation`, moved out of `protocol.ts` whole:
 *
 *  - `throwMetadataServiceUnavailable` — a degraded MetadataService read
 *    turned into the same 503 the overlay half of the reads throws;
 *  - `warnClosureReadUnavailable` — why the batch closure degraded, once per
 *    process.
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
 * the {@link LoudDegradationsHost} members it reads, plus a `.call`; a body
 * that reads no member is called as a plain function. The warned-once flag is
 * handed over as a getter and a setter, so the read and the write reach the
 * class field as it stands at call time. Every caller keeps calling the class
 * methods.
 *
 * What the bodies read from elsewhere, they import from where `protocol.ts`
 * imports it; `metadataStoreUnavailableError` is `protocol.ts`'s own and is imported from there. Nothing re-exports this module, so the published surface does
 * not move.
 */

import type { ObjectStackProtocolImplementation } from './protocol.js';
import { metadataStoreUnavailableError } from './protocol.js';

/**
 * The `ObjectStackProtocolImplementation` members the functions below read —
 * every one of them, and no other; each function's `this` is the `Pick` of
 * the members it reads. Each is typed AS the class member (an indexed access
 * on the class), so a change to a member's signature on the class is a change
 * here too, and naming a member the class does not have is a compile error.
 */
export interface LoudDegradationsHost {
    closureReadWarned: ObjectStackProtocolImplementation['closureReadWarned'];
}

/** The body of `ObjectStackProtocolImplementation#throwMetadataServiceUnavailable`; the method's docblock there is its contract. */
export function throwMetadataServiceUnavailable(errors: string[]): never {
    throw metadataStoreUnavailableError(
        new Error(
            `The metadata service could not read every loader: ${
                    errors.length > 0 ? errors.join('; ') : 'no loader detail reported'
                }`,
        ),
    );
}

/** The body of `ObjectStackProtocolImplementation#warnClosureReadUnavailable`; the method's docblock there is its contract. */
export function warnClosureReadUnavailable(this: Pick<LoudDegradationsHost, 'closureReadWarned'>, type: string, name: string): void {
    if (this.closureReadWarned) return;
    this.closureReadWarned = true;
    console.warn(
        `[Protocol] publishPackageDrafts: this overlay repository declares no 'get', so the batch's own `
        + `pending drafts cannot be read (first reached at ${type}/${name}). Author-time validation falls `
        + `back to the LIVE declarations only, without this batch's own drafts in the closure, so a draft that references a `
        + `sibling drafted in the SAME batch may be refused as unresolved. Nothing is published unchecked: `
        + `the gate still runs, with strictly less resolution context.`,
    );
}
