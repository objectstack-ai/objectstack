// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25467 cut 24] The save door's answer to an optimistic-save conflict, from
 * `ObjectStackProtocolImplementation` (`saveConflict`), moved out of
 * `protocol.ts` whole: the 409 for a `ConflictError` — the repository's race,
 * or a caller's token the keyed comparison refused — built by the one
 * conflict builder, plus its decision-audit row (#21207, #23406).
 *
 * A MOVE, not a redesign. The function below is the body of the
 * `ObjectStackProtocolImplementation` method of the same name as it stood,
 * re-indented one level and otherwise unedited: the same refusal text and
 * first-write pin, the same audit row, in the same order.
 *
 * ## How the moved body reaches the class
 *
 * The shape #23050 set for `rest-server.ts` (its `data-action-routes.ts`
 * header carries the full reasoning), as `protocol-batch-data.ts` applies it.
 * The class keeps the method — the published `dist/*.d.ts` lists its name,
 * docblock and declared signature — and its body is one literal of exactly
 * the {@link SaveConflictHost} members it reads, each handed over as a
 * closure, plus a `.call`. Every other reader of the method keeps calling
 * the class method.
 *
 * What the body reads from elsewhere, it imports from where `protocol.ts`
 * imported it. Nothing re-exports this module, so the published surface does
 * not move.
 */

import type { ConflictError } from '@objectstack/metadata-core';
import type { ObjectStackProtocolImplementation } from './protocol.js';

/**
 * The `ObjectStackProtocolImplementation` members the function below reads —
 * every one of them, and no other; the function's `this` is the `Pick` of the
 * members it reads. Each is typed AS the class member (an indexed access on
 * the class), so a change to a member's signature on the class is a change
 * here too, and naming a member the class does not have is a compile error.
 */
export interface SaveConflictHost {
    readonly metadataConflictRefusal: ObjectStackProtocolImplementation['metadataConflictRefusal'];
    readonly recordOptimisticConflictAudit: ObjectStackProtocolImplementation['recordOptimisticConflictAudit'];
}

/** The body of `ObjectStackProtocolImplementation#saveConflict`; the method's docblock there is its contract. */
export async function saveConflict(
    this: Pick<SaveConflictHost, 'metadataConflictRefusal' | 'recordOptimisticConflictAudit'>,
    err: ConflictError,
    request: { type: string; name: string; actor?: string; parentVersion?: string | null; mode?: 'draft' | 'publish' },
    writeSource: string,
): Promise<Error> {
    const conflict = await this.metadataConflictRefusal(
        err,
        `${request.type}/${request.name}`,
        `${request.type}/${request.name} has been modified since you loaded it.`,
        request.parentVersion === null ? (request.mode === 'draft' ? 'draft' : 'active') : undefined,
    );
    await this.recordOptimisticConflictAudit({
        type: request.type,
        name: request.name,
        operation: 'save',
        ...(request.actor ? { actor: request.actor } : {}),
        source: writeSource,
        expectedParent: err.expectedParent,
        actualHead: err.actualHead,
    });
    return conflict;
}
