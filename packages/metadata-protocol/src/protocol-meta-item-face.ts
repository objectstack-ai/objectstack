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
 * re-indented one level and otherwise unedited.
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

import type { ObjectStackProtocolImplementation } from './protocol.js';
import {
    isItemOfDisabledPackage,
    isObjectOfDisabledPackage,
    noPendingDraftError,
    objectPackageDisabledError,
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
}

/** The body of `ObjectStackProtocolImplementation#readMetaItemFace`; the method's docblock there is its contract. */
export async function readMetaItemFace(
    this: Pick<MetaItemFaceHost, 'engine' | 'readMetaItem'>,
    request: {
        type: string, name: string, packageId?: string, state?: 'active' | 'draft', previewDrafts?: boolean,
        member?: string,
    },
    face: 'served' | 'execution',
) {
    if (request.type === 'object' && isObjectOfDisabledPackage(this.engine?.registry, request.name)) {
        throw objectPackageDisabledError(request.name);
    }
    const answer = await this.readMetaItem(request, { face });
    if (request.type === 'object' || request.type === 'package'
        || !isItemOfDisabledPackage(this.engine?.registry, answer?.item)) {
        return answer;
    }
    if (request.state === 'draft') throw noPendingDraftError(request.type, request.name);
    const { item: _withheld, registration: _servedOnly, ...envelope } = answer as typeof answer & { registration?: unknown };
    return { ...envelope, item: undefined };
}
