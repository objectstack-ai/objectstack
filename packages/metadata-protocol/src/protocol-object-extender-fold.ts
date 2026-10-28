// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25467 cut 30] The object-extender fold, from
 * `ObjectStackProtocolImplementation`, moved out of `protocol.ts` whole:
 * `foldObjectExtendersFromRegistry`, which folds the registry's `extend`
 * contributors onto an OBJECT body that came from the MetadataService, so the
 * by-name read serves the object's resolved schema as the list read does
 * (#7556).
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
 * the {@link ObjectExtenderFoldHost} member it reads, plus a `.call`. The
 * `engine` field is handed over as a getter, so the read finds it as it
 * stands at call time. Every caller keeps calling the class method.
 *
 * What the body reads from elsewhere, it imports from where `protocol.ts`
 * imports it. Nothing re-exports this module, so the published surface does
 * not move.
 */

import { PLURAL_TO_SINGULAR } from '@objectstack/spec/shared';
import type { ObjectStackProtocolImplementation } from './protocol.js';

/**
 * The `ObjectStackProtocolImplementation` member the function below reads —
 * the only one; the function's `this` is the `Pick` of it. It is typed AS the
 * class member (an indexed access on the class), so a change to its
 * signature on the class is a change here too.
 */
export interface ObjectExtenderFoldHost {
    readonly engine: ObjectStackProtocolImplementation['engine'];
}

/** The body of `ObjectStackProtocolImplementation#foldObjectExtendersFromRegistry`; the method's docblock there is its contract. */
export function foldObjectExtendersFromRegistry(
    this: Pick<ObjectExtenderFoldHost, 'engine'>,
    type: string,
    name: unknown,
    body: unknown,
): unknown {
    const singular = PLURAL_TO_SINGULAR[type] ?? type;
    if (singular !== 'object') return body;
    if (body === null || typeof body !== 'object') return body;
    // [#8027] The list caller reads the name off the ROW rather than off a
    // request, and a row with no usable `name` has no contributor list to
    // look up — `mergePackageAwareOverlay` skips such rows too.
    if (typeof name !== 'string' || name === '') return body;
    const registry = (this.engine as any)?.registry;
    // Partial registry doubles in tests predate this method; a host that
    // cannot fold answers exactly as it did before.
    if (!registry || typeof registry.foldObjectExtendersOnto !== 'function') return body;
    try {
        return registry.foldObjectExtendersOnto(name, body);
    } catch {
        // The fold is a read over in-memory contributors; a failure here
        // must not turn a served schema into a 5xx.
        return body;
    }
}
