// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25467 cut 19] A package write's validation scope, as
 * `ObjectStackProtocolImplementation` resolves it
 * (`resolveWritePackageScope`): the written package and the closure of the
 * dependencies its manifest declares, read from the registry, or `undefined`
 * wherever that cannot be read. Moved out of `protocol.ts` whole.
 *
 * A MOVE, not a redesign. The function below is the body of the
 * `ObjectStackProtocolImplementation` method of the same name as it stood,
 * re-indented one level and otherwise unedited: the same guards, the same
 * dependency walk, and the same silent `catch` answering `undefined`.
 *
 * ## How the moved body reaches the class
 *
 * The shape #23050 set for `rest-server.ts` (its `data-action-routes.ts`
 * header carries the full reasoning), as `protocol-batch-data.ts` applies it.
 * The class keeps the method — the published `dist/*.d.ts` lists its name,
 * docblock and declared signature — and its body is one literal of exactly
 * the {@link WritePackageScopeHost} members it reads, plus a `.call`. The
 * engine is handed over as a getter, so the body reads the protocol's engine
 * (and so its registry) at call time. Every other reader of the method keeps
 * calling the class method: `tenantAuthoredWriteRefusal`, and the authoring
 * gate's host (cut 8, `protocol-authoring-gate.ts`), whose closure calls it.
 *
 * The body reads no module-level declaration of `protocol.ts` and no import,
 * so this module imports only the class type. Nothing re-exports this module,
 * so the published surface does not move.
 */

import type { ObjectStackProtocolImplementation } from './protocol.js';

/**
 * The `ObjectStackProtocolImplementation` members the function below reads —
 * every one of them, and no other; the function's `this` is the `Pick` of the
 * members it reads. Each is typed AS the class member (an indexed access on
 * the class), so a change to a member's signature on the class is a change
 * here too, and naming a member the class does not have is a compile error.
 */
export interface WritePackageScopeHost {
    readonly engine: ObjectStackProtocolImplementation['engine'];
}

/** The body of `ObjectStackProtocolImplementation#resolveWritePackageScope`; the method's docblock there is its contract. */
export function resolveWritePackageScope(
    this: Pick<WritePackageScopeHost, 'engine'>,
    packageId: string | null | undefined,
): { packageId: string; dependencies: string[] } | undefined {
    if (typeof packageId !== 'string' || packageId === '' || packageId === 'sys_metadata') return undefined;
    try {
        const registry = this.engine.registry as
            | { getPackage?: (id: string) => { manifest?: unknown } | undefined }
            | undefined;
        if (typeof registry?.getPackage !== 'function') return undefined;
        // The written package itself must be readable: its manifest is the
        // ONLY declaration of what it may reference, and narrowing without
        // it would be narrowing on nothing.
        if (!registry.getPackage(packageId)) return undefined;

        const dependencies = new Set<string>();
        const frontier = [packageId];
        while (frontier.length > 0) {
            const current = frontier.pop() as string;
            const manifest = registry.getPackage(current)?.manifest as
                | { dependencies?: Record<string, unknown> }
                | undefined;
            const declared = manifest?.dependencies;
            if (!declared || typeof declared !== 'object') continue;
            for (const dep of Object.keys(declared)) {
                // A dependency the registry cannot resolve is still IN the
                // closure: the package declared it, so an object stamped
                // with it is reachable by declaration. Only the transitive
                // walk stops there — `getPackage` returns undefined and the
                // loop above simply contributes nothing further.
                if (dep === packageId || dependencies.has(dep)) continue;
                dependencies.add(dep);
                frontier.push(dep);
            }
        }
        return { packageId, dependencies: [...dependencies] };
    } catch {
        // Context gathering must never fail a write (the same contract
        // `listCollection` above holds). An unreadable registry means an
        // unnarrowed gate, not a refused publish.
        return undefined;
    }
}
