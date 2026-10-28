// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25467 cut 28] The code-datasource predicates, from
 * `ObjectStackProtocolImplementation`, moved out of `protocol.ts` whole: the
 * two answers to "is this datasource name defined in code?" (#21899, #21944).
 *
 *  - `isDeclaredCodeDatasource` — does an installed package declare it, or
 *    does the host register it from code? The `/meta` door's artifact-backed
 *    verdict and the stored-row lock read it.
 *  - `isHostCodeDatasource` — the host's code-datasource set alone, the
 *    first half of that answer and exactly what the datasource-admin boot
 *    restore reads.
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
 * the {@link CodeDatasourcePredicatesHost} members it reads, plus a `.call`.
 * The `engine` and `getServicesRegistry` fields are handed over as getters,
 * so each read finds them as they stand at call time;
 * `isDeclaredCodeDatasource`'s call to `isHostCodeDatasource` is handed over
 * as a closure, so it still reaches the class method. Every caller keeps
 * calling the class methods.
 *
 * What the bodies read from elsewhere, they import from where `protocol.ts`
 * imports it. Nothing re-exports this module, so the published surface does
 * not move.
 */

import { PLURAL_TO_SINGULAR } from '@objectstack/spec/shared';
import type { ObjectStackProtocolImplementation } from './protocol.js';

/**
 * The `ObjectStackProtocolImplementation` members the functions below read —
 * every one of them, and no other; each function's `this` is the `Pick` of
 * the members it reads. Each is typed AS the class member (an indexed access
 * on the class), so a change to a member's signature on the class is a change
 * here too, and naming a member the class does not have is a compile error.
 */
export interface CodeDatasourcePredicatesHost {
    readonly engine: ObjectStackProtocolImplementation['engine'];
    readonly getServicesRegistry: ObjectStackProtocolImplementation['getServicesRegistry'];
    readonly isHostCodeDatasource: ObjectStackProtocolImplementation['isHostCodeDatasource'];
}

/** The body of `ObjectStackProtocolImplementation#isDeclaredCodeDatasource`; the method's docblock there is its contract. */
export function isDeclaredCodeDatasource(
    this: Pick<CodeDatasourcePredicatesHost, 'engine' | 'isHostCodeDatasource'>,
    type: string,
    name: string,
): boolean {
    if ((PLURAL_TO_SINGULAR[type] ?? type) !== 'datasource') return false;
    if (this.isHostCodeDatasource(type, name)) return true;
    const registry = (this.engine as any)?.registry;
    if (typeof registry?.getAllPackages !== 'function') return false;
    for (const record of registry.getAllPackages() as unknown[]) {
        const declared = (record as { manifest?: { datasources?: unknown } } | null | undefined)
            ?.manifest?.datasources;
        if (Array.isArray(declared) && declared.some((ds) => (ds as { name?: unknown } | null)?.name === name)) {
            return true;
        }
    }
    return false;
}

/** The body of `ObjectStackProtocolImplementation#isHostCodeDatasource`; the method's docblock there is its contract. */
export function isHostCodeDatasource(
    this: Pick<CodeDatasourcePredicatesHost, 'getServicesRegistry'>,
    type: string,
    name: string,
): boolean {
    if ((PLURAL_TO_SINGULAR[type] ?? type) !== 'datasource') return false;
    const hostCode = this.getServicesRegistry?.().get('code-datasource-names') as { has?: unknown } | undefined;
    return typeof hostCode?.has === 'function' && (hostCode as { has(n: string): boolean }).has(name);
}
