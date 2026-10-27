// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25467 cut 20] The code-layer read of `ObjectStackProtocolImplementation`
 * through the `metadata` service (`readItemFromMetadataService`): one item,
 * package-scoped (ADR-0048), its diagnosis when the service gives one, the
 * singular/plural spelling as a fallback, and a stored object row's copy not
 * counted as a code layer (#23645). Moved out of `protocol.ts` whole.
 *
 * A MOVE, not a redesign. The function below is the body of the
 * `ObjectStackProtocolImplementation` method of the same name as it stood,
 * re-indented one level and otherwise unedited: the same service lookup, the
 * same two reads in the same order, and the same merged answer.
 *
 * ## How the moved body reaches the class
 *
 * The shape #23050 set for `rest-server.ts` (its `data-action-routes.ts`
 * header carries the full reasoning), as `protocol-batch-data.ts` applies it.
 * The class keeps the method — the published `dist/*.d.ts` lists its name,
 * docblock and declared signature — and its body is one literal of exactly
 * the {@link MetadataServiceReadHost} members it reads, plus a `.call`. The
 * `getServicesRegistry` field is handed over as a getter, as
 * `protocol-package-install.ts` and `protocol-save-door-refusals.ts` hand it,
 * so the body reads the protocol's field at call time. Every other reader of
 * the method keeps calling the class method.
 *
 * What the body reads of `protocol.ts`'s own module-level declarations it
 * imports from it; what it imports from elsewhere, it imports from where
 * `protocol.ts` imported it. Nothing re-exports this module, so the published
 * surface does not move.
 */

import { isTenantAuthored } from '@objectstack/metadata-core';
import { PLURAL_TO_SINGULAR, SINGULAR_TO_PLURAL } from '@objectstack/spec/shared';
import type { ObjectStackProtocolImplementation } from './protocol.js';
import { canonicalMetaType } from './protocol.js';

/**
 * The `ObjectStackProtocolImplementation` members the function below reads —
 * every one of them, and no other; the function's `this` is the `Pick` of the
 * members it reads. Each is typed AS the class member (an indexed access on
 * the class), so a change to a member's signature on the class is a change
 * here too, and naming a member the class does not have is a compile error.
 */
export interface MetadataServiceReadHost {
    readonly getServicesRegistry: ObjectStackProtocolImplementation['getServicesRegistry'];
}

/** The body of `ObjectStackProtocolImplementation#readItemFromMetadataService`; the method's docblock there is its contract. */
export async function readItemFromMetadataService(
    this: Pick<MetadataServiceReadHost, 'getServicesRegistry'>,
    type: string,
    name: string,
    packageId?: string,
): Promise<{ data: unknown; degraded: boolean; errors: string[] }> {
    const services = this.getServicesRegistry?.();
    const metadataService: any = services?.get('metadata');
    if (!metadataService || typeof metadataService.get !== 'function') {
        return { data: undefined, degraded: false, errors: [] };
    }
    // ADR-0048 — thread the caller's package id so a single-item fetch is
    // package-scoped. Passed positionally to BOTH reads, so whatever the
    // occupant of the `metadata` slot makes of a third argument today is
    // unchanged by which of the two methods answers.
    const read = async (t: string): Promise<{ data: unknown; degraded: boolean; errors: string[] }> => {
        let answer: { data: unknown; degraded: boolean; errors: string[] };
        if (typeof metadataService.getDiagnosed === 'function') {
            const diagnosed = await metadataService.getDiagnosed(t, name, packageId);
            answer = {
                data: diagnosed?.data,
                degraded: diagnosed?.degraded === true,
                errors: Array.isArray(diagnosed?.errors) ? diagnosed.errors : [],
            };
        } else {
            answer = { data: await metadataService.get(t, name, packageId), degraded: false, errors: [] };
        }
        // [#23645] A stored object row's copy is not a code layer. See the header.
        return canonicalMetaType(t) === 'object' && isTenantAuthored(answer.data)
            ? { ...answer, data: undefined }
            : answer;
    };

    const primary = await read(type);
    if (primary.data !== undefined && primary.data !== null) return primary;
    const alt = PLURAL_TO_SINGULAR[type] ?? SINGULAR_TO_PLURAL[type];
    if (!alt) return { data: undefined, degraded: primary.degraded, errors: primary.errors };
    const secondary = await read(alt);
    if (secondary.data !== undefined && secondary.data !== null) return secondary;
    return {
        data: undefined,
        degraded: primary.degraded || secondary.degraded,
        errors: [...primary.errors, ...secondary.errors],
    };
}
