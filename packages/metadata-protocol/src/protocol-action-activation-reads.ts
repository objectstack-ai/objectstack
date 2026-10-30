// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#27842] The data engine's packaged-action activation read, for the `object`
 * meta reads: `disabledActions` beside the item read's envelope (both doors)
 * and beside the list's items, keyed by object name
 * (`GetMetaItemResponseSchema` / `GetMetaItemsResponseSchema` in
 * `@objectstack/spec/api`).
 *
 *  - `resolveDisabledActionsReader` — the engine's `getDisabledActions`, read
 *    ONCE per meta read, turned into a reader of one object body; nothing for
 *    every other type, and nothing where no ledger answered.
 *  - `disabledActionsOf` — the list's `disabledActions`: that reader's answer
 *    per listed, non-draft object.
 *
 * ## The seam
 *
 * The automation twin's (`protocol-automation-flow-reads.ts`,
 * `getFlowRegistration`): the kernel's service table, read by name and per
 * call, for an optional member the engine declares on its contract —
 * `IObjectQLEngine.getDisabledActions` in `@objectstack/spec/contracts`. This
 * package never imports `@objectstack/objectql` (which depends on it). The
 * slot is `objectql`, the one the dispatch doors resolve the engine from
 * before they consult the same projection, so the read and the 409 refusal
 * answer from one fact.
 *
 * ## What it never does
 *
 * ⛔ It never reads or rewrites the body it is given: `actions[]` is served as
 * declared, a switched-off action included (the Setup page lists from it to
 * offer the switch back on), and no `visible` / `disabled` member is written
 * into an action, which would ride the GET → edit → PUT round trip back into
 * the stored body. ⛔ It never makes up an answer: where the engine declares
 * no member, or answers `undefined` (no ledger attached), the read serves no
 * key — absence is "no ledger answered", never "nothing is switched off".
 *
 * The bodies take the host-literal shape `protocol-automation-flow-reads.ts`
 * documents, so the class keeps each method and its docblock.
 */

import type { IObjectQLEngine } from '@objectstack/spec/contracts';
import type { ObjectStackProtocolImplementation } from './protocol.js';
import { canonicalMetaType } from './protocol.js';

/**
 * The `ObjectStackProtocolImplementation` members the functions below read —
 * every one of them, and no other; each function's `this` is the `Pick` of
 * the members it reads, typed AS the class member.
 */
export interface ActionActivationReadsHost {
    readonly getServicesRegistry: ObjectStackProtocolImplementation['getServicesRegistry'];
    readonly resolveDisabledActionsReader: ObjectStackProtocolImplementation['resolveDisabledActionsReader'];
}

/**
 * The names of `body.actions[]` the switched-off set holds, in the order the
 * body declares them, each once. A body with no `actions` array holds none.
 */
function switchedOffActionsOf(body: unknown, off: ReadonlySet<string>): string[] {
    const actions = (body as { actions?: unknown } | null | undefined)?.actions;
    if (!Array.isArray(actions)) return [];
    const named = new Set<string>();
    for (const action of actions) {
        const name = (action as { name?: unknown } | null | undefined)?.name;
        if (typeof name === 'string' && off.has(name)) named.add(name);
    }
    return [...named];
}

/** The body of `ObjectStackProtocolImplementation#resolveDisabledActionsReader`; the method's docblock there is its contract. */
export function resolveDisabledActionsReader(
    this: Pick<ActionActivationReadsHost, 'getServicesRegistry'>,
    type: string,
): ((body: unknown) => string[]) | undefined {
    if (canonicalMetaType(type) !== 'object') return undefined;
    const engine = this.getServicesRegistry?.().get('objectql') as
        | Pick<IObjectQLEngine, 'getDisabledActions'>
        | undefined;
    const read = engine?.getDisabledActions;
    if (typeof read !== 'function') return undefined;
    const answer = read.call(engine);
    if (!Array.isArray(answer)) return undefined;
    const off = new Set<string>(answer);
    return (body) => switchedOffActionsOf(body, off);
}

/** The body of `ObjectStackProtocolImplementation#disabledActionsOf`; the method's docblock there is its contract. */
export function disabledActionsOf(
    this: Pick<ActionActivationReadsHost, 'resolveDisabledActionsReader'>,
    type: string,
    items: readonly unknown[],
): { disabledActions?: Record<string, string[]> } {
    const read = this.resolveDisabledActionsReader(type);
    if (!read) return {};
    const entries: Array<[string, string[]]> = [];
    for (const it of items) {
        const name = (it as { name?: unknown } | null | undefined)?.name;
        if (typeof name !== 'string' || (it as { _draft?: unknown })._draft === true) continue;
        entries.push([name, read(it)]);
    }
    return { disabledActions: Object.fromEntries(entries) };
}
