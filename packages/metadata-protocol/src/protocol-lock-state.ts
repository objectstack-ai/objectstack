// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25467 cut 10] The served lock state and the stored-row decline of
 * `ObjectStackProtocolImplementation` — the read envelope's lock derivation
 * (`servedLockState`), the shipped-flow-name predicate and its registry half
 * (`isShippedFlowName`, `isStoredFlowEntryOfShippedName`), the one by-name
 * decision the active reads take before they serve a stored row
 * (`declinesStoredRow`), its sealed-overlay limb (`isUnservedSealedOverlay`)
 * and its registry half (`isStoredEntryOfDeclinedName`) — moved out of
 * `protocol.ts` whole.
 *
 * A MOVE, not a redesign. Each function below is the body of the
 * `ObjectStackProtocolImplementation` method of the same name as it stood,
 * re-indented one level and otherwise unedited: the same reads, in the same
 * order, throwing exactly where they did with the same message.
 *
 * Edited since: [#28412, ADR-0146 D9 item 1] `declinesStoredRow` takes the
 * stored row it judges, and does not decline a shipped flow name's row that
 * the one served-override predicate (`isServedOverrideRowOf`) admits for the
 * shipping package — its declared `.custom` override, the packaged flow.
 *
 * ## How the moved bodies reach the class
 *
 * The shape #23050 set for `rest-server.ts` (its `data-action-routes.ts`
 * header carries the full reasoning), as `protocol-batch-data.ts` applies it.
 * The class keeps every method — the published `dist/*.d.ts` lists each one's
 * name, docblock and declared signature — and each body is one literal of
 * exactly the {@link LockStateHost} members that method reads, plus a
 * `.call`. A method is handed over as a closure that calls it on the protocol
 * at call time, so a test double or spy set on the instance is still the one
 * the body reaches, and the moved bodies that call one another do so through
 * the protocol, exactly as before. Every other reader of these six methods
 * keeps calling the class method, the REST and runtime published doors among
 * them.
 *
 * The bodies read no field, so the host carries no getter.
 *
 * The one module-level declaration of `protocol.ts` the bodies read,
 * `canonicalMetaType`, stays there, where code that did not move reads it too,
 * and is imported from there: the module cycle is evaluation-safe because it
 * is read only inside a function body, never while the two modules are first
 * evaluated. Everything else is imported from the module `protocol.ts`
 * imports it from. Nothing re-exports this module, so the published surface
 * does not move.
 */

import type { ObjectStackProtocolImplementation } from './protocol.js';
import { canonicalMetaType } from './protocol.js';
import type { ItemLock } from './item-lock.js';
import { isOriginGatedType } from './packaged-base-regime.js';
import { isServedOverrideRowOf, type ServedOverrideRow } from './served-override.js';
import { isCodeArtifactBody } from '@objectstack/metadata-core';
import { PLURAL_TO_SINGULAR } from '@objectstack/spec/shared';
import {
    extractProtection,
    evaluateLockForWrite,
    evaluateLockForDelete,
    MetadataLockSchema,
} from '@objectstack/spec/kernel';
import type { resolveLockState } from '@objectstack/spec/kernel';

/**
 * The `ObjectStackProtocolImplementation` members the functions below read —
 * every one of them, and no other; each function's `this` is the `Pick` of the
 * members IT reads. Each is typed AS the class member (an indexed access on
 * the class), so a change to a member's signature on the class is a change
 * here too, and naming a member the class does not have is a compile error.
 */
export interface LockStateHost {
    declinesStoredRow: ObjectStackProtocolImplementation['declinesStoredRow'];
    isDeclaredCodeDatasource: ObjectStackProtocolImplementation['isDeclaredCodeDatasource'];
    isSealedManagedItem: ObjectStackProtocolImplementation['isSealedManagedItem'];
    isShippedFlowName: ObjectStackProtocolImplementation['isShippedFlowName'];
    isUnservedSealedOverlay: ObjectStackProtocolImplementation['isUnservedSealedOverlay'];
    packagedArtifactOwner: ObjectStackProtocolImplementation['packagedArtifactOwner'];
    packagedBaseRefusal: ObjectStackProtocolImplementation['packagedBaseRefusal'];
}

/** The body of `ObjectStackProtocolImplementation#servedLockState`; the method's docblock there is its contract. */
export function servedLockState(
    this: Pick<LockStateHost, 'packagedBaseRefusal'>,
    type: string,
    name: string,
    document: unknown,
    artifactBacked: boolean,
    itemLock: ItemLock,
    storedRowServed = false,
): ReturnType<typeof resolveLockState> {
    const { provenance, packageId, packageVersion } = extractProtection(document);
    const editable = evaluateLockForWrite(itemLock.lock) === null
        && this.packagedBaseRefusal({ type, name, operation: 'save' }) === null;
    const removalRefusal = this.packagedBaseRefusal({ type, name, operation: 'delete' });
    const deletable = evaluateLockForDelete(itemLock.lock) === null
        && (removalRefusal === null || (storedRowServed && isOriginGatedType(type)));
    const lock = MetadataLockSchema.options.find((state) =>
        (evaluateLockForWrite(state) === null) === editable
        && (evaluateLockForDelete(state) === null) === deletable);
    if (lock === undefined) {
        // Unreachable while the lock algebra covers all four verdict pairs;
        // a state added to it without a write/delete answer must fail here,
        // loudly, not publish a guessed lock.
        throw new Error(
            `No ADR-0010 lock state answers editable=${editable}, deletable=${deletable}.`,
        );
    }
    return {
        lock,
        lockReason: itemLock.lockReason,
        lockSource: itemLock.lockSource,
        lockDocsUrl: itemLock.lockDocsUrl,
        provenance,
        packageId,
        packageVersion,
        editable,
        deletable,
        resettable: artifactBacked,
    };
}

/** The body of `ObjectStackProtocolImplementation#isShippedFlowName`; the method's docblock there is its contract. */
export function isShippedFlowName(
    this: Pick<LockStateHost, 'packagedArtifactOwner'>,
    type: string, name: unknown): boolean {
    if ((PLURAL_TO_SINGULAR[type] ?? type) !== 'flow') return false;
    if (typeof name !== 'string' || name === '') return false;
    return this.packagedArtifactOwner({ type: 'flow', name }) !== undefined;
}

/** The body of `ObjectStackProtocolImplementation#isStoredFlowEntryOfShippedName`; the method's docblock there is its contract. */
export function isStoredFlowEntryOfShippedName(
    this: Pick<LockStateHost, 'isShippedFlowName'>,
    type: string, item: unknown): boolean {
    return this.isShippedFlowName(type, (item as { name?: unknown } | null | undefined)?.name)
        && !isCodeArtifactBody(item);
}

/** The body of `ObjectStackProtocolImplementation#declinesStoredRow`; the method's docblock there is its contract. */
export function declinesStoredRow(
    this: Pick<LockStateHost, 'isDeclaredCodeDatasource' | 'isShippedFlowName' | 'isUnservedSealedOverlay' | 'packagedArtifactOwner'>,
    type: string, name: unknown, row?: ServedOverrideRow): boolean {
    if (this.isShippedFlowName(type, name)) {
        // [#28412, ADR-0146 D9 item 1] …except the one row that IS the
        // packaged flow now: the shipping package's declared override, judged
        // on the row's own `package_id` and body by the one served-override
        // predicate. Every other stored row of the name stays declined.
        return !isServedOverrideRowOf(row, this.packagedArtifactOwner({ type: 'flow', name: name as string }));
    }
    if (typeof name !== 'string' || name === '') return false;
    return this.isDeclaredCodeDatasource(type, name) || this.isUnservedSealedOverlay(type, name);
}

/** The body of `ObjectStackProtocolImplementation#isUnservedSealedOverlay`; the method's docblock there is its contract. */
export function isUnservedSealedOverlay(
    this: Pick<LockStateHost, 'isSealedManagedItem'>,
    type: string, name: string): boolean {
    if (canonicalMetaType(type) === 'permission') return false;
    return this.isSealedManagedItem(type, name);
}

/** The body of `ObjectStackProtocolImplementation#isStoredEntryOfDeclinedName`; the method's docblock there is its contract. */
export function isStoredEntryOfDeclinedName(
    this: Pick<LockStateHost, 'declinesStoredRow'>,
    type: string, item: unknown): boolean {
    return this.declinesStoredRow(type, (item as { name?: unknown } | null | undefined)?.name)
        && !isCodeArtifactBody(item);
}
