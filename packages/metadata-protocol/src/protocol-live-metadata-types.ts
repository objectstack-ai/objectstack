// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25467 cut 24] The live metadata-type listing of
 * `ObjectStackProtocolImplementation` (`listLiveMetadataTypes`), moved out
 * of `protocol.ts` whole: the types the engine's SchemaRegistry holds, plus
 * the types the `metadata` service reports, de-duplicated — the one answer to
 * "which types exist here" that `getMetaTypes` and every other caller share.
 *
 * A MOVE, not a redesign. The function below is the body of the
 * `ObjectStackProtocolImplementation` method of the same name as it stood,
 * re-indented one level and otherwise unedited: the same two sources in the
 * same order, the same tolerance of an absent `metadata` service, and the
 * same de-duplication.
 *
 * ## How the moved body reaches the class
 *
 * The shape #23050 set for `rest-server.ts` (its `data-action-routes.ts`
 * header carries the full reasoning), as `protocol-batch-data.ts` applies it.
 * The class keeps the method — the published `dist/*.d.ts` lists its name,
 * docblock and declared signature — and its body is one literal of exactly
 * the {@link LiveMetadataTypesHost} members it reads, plus a `.call`. Both
 * are handed over as getters, so the body reads the protocol's own `engine`
 * and its constructor-supplied `getServicesRegistry` field at call time, as
 * `protocol-metadata-service-read.ts` hands that field over. Every other
 * reader of the method keeps calling the class method.
 *
 * The body reads none of `protocol.ts`'s module-level declarations and
 * imports nothing but the class's type. Nothing re-exports this module, so
 * the published surface does not move.
 */

import type { ObjectStackProtocolImplementation } from './protocol.js';

/**
 * The `ObjectStackProtocolImplementation` members the function below reads —
 * every one of them, and no other; the function's `this` is the `Pick` of the
 * members it reads. Each is typed AS the class member (an indexed access on
 * the class), so a change to a member's signature on the class is a change
 * here too, and naming a member the class does not have is a compile error.
 */
export interface LiveMetadataTypesHost {
    readonly engine: ObjectStackProtocolImplementation['engine'];
    readonly getServicesRegistry: ObjectStackProtocolImplementation['getServicesRegistry'];
}

/** The body of `ObjectStackProtocolImplementation#listLiveMetadataTypes`; the method's docblock there is its contract. */
export async function listLiveMetadataTypes(
    this: Pick<LiveMetadataTypesHost, 'engine' | 'getServicesRegistry'>,
): Promise<string[]> {
    const schemaTypes = this.engine.registry.getRegisteredTypes();

    // Also include types from MetadataService (runtime-registered: agent, tool, etc.)
    let runtimeTypes: string[] = [];
    try {
        const services = this.getServicesRegistry?.();
        const metadataService = services?.get('metadata');
        if (metadataService && typeof metadataService.getRegisteredTypes === 'function') {
            runtimeTypes = await metadataService.getRegisteredTypes();
        }
    } catch {
        // MetadataService not available
    }

    return Array.from(new Set([...schemaTypes, ...runtimeTypes]));
}
