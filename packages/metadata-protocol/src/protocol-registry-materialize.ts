// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25467 cut 11] The registry materialize/strip pair of
 * `ObjectStackProtocolImplementation` — the read exits' registry-side
 * convergence of a served object document (`materializeFromRegistry`), the
 * whole of what a `/meta` read exit owes an object document
 * (`governServedObject`), the write path's inverse of the registry seam
 * (`stripMaterializedFromRegistry`) and the whole of what the write path owes
 * the read (`stripServedObjectColumns`) — moved out of `protocol.ts` whole.
 *
 * A MOVE, not a redesign. Each function below is the body of the
 * `ObjectStackProtocolImplementation` method of the same name as it stood,
 * re-indented one level and otherwise unedited: the same reads, in the same
 * order, with the same `try`/`catch` fallbacks for partial registry doubles.
 *
 * ## How the moved bodies reach the class
 *
 * The shape #23050 set for `rest-server.ts` (its `data-action-routes.ts`
 * header carries the full reasoning), as `protocol-batch-data.ts` applies it.
 * The class keeps every method — the published `dist/*.d.ts` lists each one's
 * name, docblock and declared signature — and each body is one literal of
 * exactly the {@link RegistryMaterializeHost} members that method reads, plus
 * a `.call`. A method is handed over as a closure that calls it on the
 * protocol at call time, so a test double or spy set on the instance is still
 * the one the body reaches, and the moved bodies that call one another do so
 * through the protocol, exactly as before. Every other reader of these four
 * methods keeps calling the class method.
 *
 * The field the bodies read, `engine`, goes as a GETTER, so each read happens
 * when the body makes it: tests replace it on a constructed protocol.
 *
 * The module-level declarations of `protocol.ts` the bodies read stay there
 * and are imported from there: `canonicalMetaType`, which code that did not
 * move reads too, and `governServedItem` / `stripServedSystemColumns`, whose
 * docblocks the class's read and write paths cite by name. The module cycle is
 * evaluation-safe because every one of them is read only inside a function
 * body, never while the two modules are first evaluated. `index.ts` names what
 * it publishes from `protocol.ts` one by one, so the `export` the last two
 * gained for this keeps them off the published surface, and nothing
 * re-exports this module, so the published surface does not move.
 */

import type { ObjectStackProtocolImplementation } from './protocol.js';
import { canonicalMetaType, governServedItem, stripServedSystemColumns } from './protocol.js';

/**
 * The `ObjectStackProtocolImplementation` members the functions below read —
 * every one of them, and no other; each function's `this` is the `Pick` of the
 * members IT reads. Each is typed AS the class member (an indexed access on
 * the class), so a change to a member's signature on the class is a change
 * here too, and naming a member the class does not have is a compile error.
 * See the module header for which members are getters.
 */
export interface RegistryMaterializeHost {
    readonly engine: ObjectStackProtocolImplementation['engine'];
    materializeFromRegistry: ObjectStackProtocolImplementation['materializeFromRegistry'];
    stripMaterializedFromRegistry: ObjectStackProtocolImplementation['stripMaterializedFromRegistry'];
}

/** The body of `ObjectStackProtocolImplementation#materializeFromRegistry`; the method's docblock there is its contract. */
export function materializeFromRegistry<T>(
    this: Pick<RegistryMaterializeHost, 'engine'>,
    type: string, body: T): T {
    if (canonicalMetaType(type) !== 'object') return body;
    if (body === null || typeof body !== 'object') return body;
    const registry = (this.engine as any)?.registry;
    // Partial registry doubles in tests predate this method; a host that
    // cannot answer the gate answers exactly as it did before. The
    // `provisionSearchCompanionOnto` fallback keeps a double that was
    // written against #8038's narrower seam serving what it served then,
    // rather than silently losing the companion convergence to a rename.
    if (registry && typeof registry.materializeServedObjectOnto === 'function') {
        try {
            return registry.materializeServedObjectOnto(body) as T;
        } catch {
            // A read over an in-memory flag, the registry's own resolved
            // answer and the body's own fields; a failure here must not turn
            // a served schema into a 5xx.
            return body;
        }
    }
    if (registry && typeof registry.provisionSearchCompanionOnto === 'function') {
        try {
            return registry.provisionSearchCompanionOnto(body) as T;
        } catch {
            return body;
        }
    }
    return body;
}

/** The body of `ObjectStackProtocolImplementation#governServedObject`; the method's docblock there is its contract. */
export function governServedObject<T>(
    this: Pick<RegistryMaterializeHost, 'materializeFromRegistry'>,
    type: string, item: T): T {
    return this.materializeFromRegistry(type, governServedItem(type, item));
}

/** The body of `ObjectStackProtocolImplementation#stripMaterializedFromRegistry`; the method's docblock there is its contract. */
export function stripMaterializedFromRegistry<T>(
    this: Pick<RegistryMaterializeHost, 'engine'>,
    type: string, item: T): T {
    if (canonicalMetaType(type) !== 'object') return item;
    if (item === null || typeof item !== 'object') return item;
    const registry = (this.engine as any)?.registry;
    // Partial registry doubles in tests predate this method; the narrower
    // #8038 spelling keeps such a host stripping what it stripped before
    // rather than silently losing the companion strip to a rename.
    if (registry && typeof registry.stripMaterializedStampsFrom === 'function') {
        try {
            return registry.stripMaterializedStampsFrom(item) as T;
        } catch {
            // A read over the body's own fields; a failure here must not
            // turn a save into a 5xx.
            return item;
        }
    }
    if (registry && typeof registry.stripProvisionedSearchCompanionFrom === 'function') {
        try {
            return registry.stripProvisionedSearchCompanionFrom(item) as T;
        } catch {
            return item;
        }
    }
    return item;
}

/** The body of `ObjectStackProtocolImplementation#stripServedObjectColumns`; the method's docblock there is its contract. */
export function stripServedObjectColumns<T>(
    this: Pick<RegistryMaterializeHost, 'stripMaterializedFromRegistry'>,
    type: string, item: T): T {
    return this.stripMaterializedFromRegistry(type, stripServedSystemColumns(type, item));
}
