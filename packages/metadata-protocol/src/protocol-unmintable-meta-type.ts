// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25467 cut 33] The `/meta` save door's refusal of a `:type` segment that is
 * not a metadata type at all, on the one entry point that mints a
 * `sys_metadata` namespace, from `ObjectStackProtocolImplementation`, moved
 * out of `protocol.ts` whole: `refuseUnmintableMetaType`.
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
 * the {@link UnmintableMetaTypeHost} members it reads, plus a `.call`; a body
 * that reads no member is called as a plain function. Its call to
 * `metaTypeNamespaceExists` is handed over as a closure, so it still reaches
 * the class method, which stays. Every caller keeps calling the class
 * methods.
 *
 * What the bodies read from elsewhere, they import from where `protocol.ts`
 * imports it. Nothing re-exports this module, so the published surface does
 * not move.
 */

import { unrecognisedMetaTypeRefusal } from '@objectstack/spec/shared';
import type { ObjectStackProtocolImplementation } from './protocol.js';

/**
 * The `ObjectStackProtocolImplementation` members the function below reads —
 * every one of them, and no other; the function's `this` is the `Pick` of them. Each is typed AS the class member (an indexed access
 * on the class), so a change to a member's signature on the class is a change
 * here too, and naming a member the class does not have is a compile error.
 */
export interface UnmintableMetaTypeHost {
    readonly metaTypeNamespaceExists: ObjectStackProtocolImplementation['metaTypeNamespaceExists'];
}

/** The body of `ObjectStackProtocolImplementation#refuseUnmintableMetaType`; the method's docblock there is its contract. */
export async function refuseUnmintableMetaType(this: Pick<UnmintableMetaTypeHost, 'metaTypeNamespaceExists'>, request: { type: string, name: string }): Promise<void> {
    const unrecognised = unrecognisedMetaTypeRefusal(request.type);
    if (!unrecognised) return;
    // The old exemption 1 (skip when the name contains a slash) was
    // removed by commit 311433f6b — the grammar verdict upstream refuses every
    // slash-bearing name before this probe runs. See the header.
    // Exemption 2 — the namespace predates this write.
    if (await this.metaTypeNamespaceExists(unrecognised.type)) return;
    const err = new Error(
        `'${unrecognised.type}' is not a metadata type. The platform declares `
        + `no such type, and a plugin cannot declare one either: 'additionalTypes' was retired because `
        + `nothing ever read it — so this write would mint a sys_metadata namespace under `
        + `type='${unrecognised.type}' that nothing reads and nothing serves. Address a real `
        + `metadata type; GET /api/v1/meta/types lists the ones this deployment carries.`,
    );
    (err as any).code = 'INVALID_REQUEST';
    (err as any).status = 400;
    throw err;
}
