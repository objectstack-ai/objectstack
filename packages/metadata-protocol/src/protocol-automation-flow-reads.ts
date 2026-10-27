// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25467 cut 27] The automation service's flow reads, from
 * `ObjectStackProtocolImplementation`, moved out of `protocol.ts` whole: the
 * three members through which this protocol asks the `automation` service —
 * the engine of THIS process — about flows.
 *
 *  - `resolveFlowCanonicalizer` — the service's `canonicalizeStoredFlow`, bound,
 *    for the doors that canonicalize a stored flow body; nothing when the
 *    service offers none.
 *  - `resolveFlowRegistrationReader` — the service's `getFlowRegistration`,
 *    bound, for a `flow` type only (#23775).
 *  - `flowRegistrationsOf` — the list's `registrations`: that reader's verdict
 *    per listed, non-draft item (#23316).
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
 * the {@link AutomationFlowReadsHost} members it reads, plus a `.call`. The
 * constructor-supplied `getServicesRegistry` field is handed over as a
 * getter, so each read finds the registry as it stands at call time;
 * `flowRegistrationsOf`'s call to `resolveFlowRegistrationReader` is handed
 * over as a closure, so it still reaches the class method. Every caller keeps
 * calling the class methods.
 *
 * What the bodies read from elsewhere, they import from where `protocol.ts`
 * imports it. Nothing re-exports this module, so the published surface does
 * not move.
 */

import type { FlowRegistration } from '@objectstack/spec/api';
import type { ObjectStackProtocolImplementation } from './protocol.js';
import { canonicalMetaType } from './protocol.js';
import type { StoredFlowCanonicalization } from './stored-migration.js';

/**
 * The `ObjectStackProtocolImplementation` members the functions below read —
 * every one of them, and no other; each function's `this` is the `Pick` of
 * the members it reads. Each is typed AS the class member (an indexed access
 * on the class), so a change to a member's signature on the class is a change
 * here too, and naming a member the class does not have is a compile error.
 */
export interface AutomationFlowReadsHost {
    readonly getServicesRegistry: ObjectStackProtocolImplementation['getServicesRegistry'];
    readonly resolveFlowRegistrationReader: ObjectStackProtocolImplementation['resolveFlowRegistrationReader'];
}

/** The body of `ObjectStackProtocolImplementation#resolveFlowCanonicalizer`; the method's docblock there is its contract. */
export function resolveFlowCanonicalizer(
    this: Pick<AutomationFlowReadsHost, 'getServicesRegistry'>,
):
    ((name: string, body: unknown, options?: { includeRetired?: boolean }) => StoredFlowCanonicalization) | undefined {
    const automation = this.getServicesRegistry?.().get('automation') as
        | {
            canonicalizeStoredFlow?: (
                name: string, definition: unknown, options?: { includeRetired?: boolean },
            ) => StoredFlowCanonicalization;
        }
        | undefined;
    const canonicalize = automation?.canonicalizeStoredFlow;
    if (typeof canonicalize !== 'function') return undefined;
    return (name, body, options) => (options === undefined
        ? canonicalize.call(automation, name, body)
        : canonicalize.call(automation, name, body, options));
}

/** The body of `ObjectStackProtocolImplementation#resolveFlowRegistrationReader`; the method's docblock there is its contract. */
export function resolveFlowRegistrationReader(
    this: Pick<AutomationFlowReadsHost, 'getServicesRegistry'>,
    type: string,
): ((name: string) => FlowRegistration) | undefined {
    if (canonicalMetaType(type) !== 'flow') return undefined;
    const automation = this.getServicesRegistry?.().get('automation') as
        | { getFlowRegistration?: (name: string) => FlowRegistration }
        | undefined;
    const read = automation?.getFlowRegistration;
    if (typeof read !== 'function') return undefined;
    return (name) => read.call(automation, name);
}

/** The body of `ObjectStackProtocolImplementation#flowRegistrationsOf`; the method's docblock there is its contract. */
export function flowRegistrationsOf(
    this: Pick<AutomationFlowReadsHost, 'resolveFlowRegistrationReader'>,
    type: string,
    items: readonly unknown[],
): { registrations?: Record<string, FlowRegistration> } {
    const read = this.resolveFlowRegistrationReader(type);
    if (!read) return {};
    const entries: Array<[string, FlowRegistration]> = [];
    for (const it of items) {
        const name = (it as { name?: unknown } | null | undefined)?.name;
        if (typeof name !== 'string' || (it as { _draft?: unknown })._draft === true) continue;
        entries.push([name, read(name)]);
    }
    return { registrations: Object.fromEntries(entries) };
}
