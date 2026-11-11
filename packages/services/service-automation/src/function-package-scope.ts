// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0150 D3/D4, #32073] Which registered function a flow `script` node's
 * name means — answered by the ONE package-scoped resolver for functions
 * (`resolvePackageScopedFunction`, `@objectstack/objectql`), never by the bare
 * map's last registration.
 *
 * A function is registered by package (`defineStack({ functions })` through
 * `AppPlugin`, or `engine.registerFunction(name, fn, packageId)`); the engine
 * keeps every holder (`ObjectQL#functionHoldersOf`), and an owner-less
 * registration is the platform's holder (code a plugin or the host
 * registers), in every caller's reach like `sys`. The caller is the package
 * the calling flow's armed body comes from
 * (`AutomationEngine#flowCallerPackage`); a flow with no package (an
 * environment-authored flow, an environment override) is a caller with no
 * package. So a packaged flow runs its own package's function, else the one
 * holder its declared closure (plus `sys` and the platform) reaches; a caller
 * with no package runs the one holder in the environment. Every other answer
 * is the resolver's refusal — `409 RESOURCE_CONFLICT`, every candidate named
 * — thrown out of the resolver so the node fails with it, never a candidate
 * picked on a guess.
 *
 * With one holder per name (every first-party app today) a caller in that
 * holder's reach is served exactly the function the bare map serves; the one
 * one-holder answer this moves is a packaged flow naming a function only a
 * package OUTSIDE its declared closure holds (ADR-0150 D3 (c)), now refused
 * `outside-closure`.
 */

import {
    PackageScopedNameRefusedError,
    resolvePackageScopedFunction,
    type PackageScopedFunctionEngine,
} from '@objectstack/objectql';
import type { FlowFunctionResolver } from './engine.js';

/**
 * The ObjectQL service, when it carries the slice the function resolver reads
 * (`functionHoldersOf` and a registry for the caller's closure walk). A
 * composition whose `objectql` offers neither is left unbridged: a `script`
 * node there fails with "no function named … is registered", never with the
 * last registration of a bare map nobody resolved by package.
 */
export function packageScopedFunctionEngineOf(service: unknown): PackageScopedFunctionEngine | undefined {
    const engine = service as Partial<Record<keyof PackageScopedFunctionEngine, unknown>> | null | undefined;
    return typeof engine?.functionHoldersOf === 'function' && !!engine.registry && typeof engine.registry === 'object'
        ? (service as PackageScopedFunctionEngine)
        : undefined;
}

/**
 * [ADR-0150 D3] The engine's function reader
 * (`AutomationEngine.setFunctionResolver`) over the one package-scoped
 * resolver: the function `name` means for a caller of package
 * `callerPackageId` (`null`: no package), with what it declared about itself
 * (#4396 `effect`). `undefined` when no holder in reach registers the name.
 * A refused name THROWS {@link PackageScopedNameRefusedError}.
 *
 * Resolved at CALL time, never at boot: a package installed or removed later
 * moves the answer with it, as the holder set does.
 */
export function functionResolverOf(engine: PackageScopedFunctionEngine): FlowFunctionResolver {
    return (name, callerPackageId) => {
        const resolved = resolvePackageScopedFunction(engine, { name, callerPackageId });
        if (resolved.status === 'refused') throw new PackageScopedNameRefusedError(resolved);
        if (resolved.status !== 'resolved') return undefined;
        const { handler, effect } = resolved.item;
        if (typeof handler !== 'function') return undefined;
        return {
            handler: (fnCtx) => (handler as (c: unknown) => unknown)(fnCtx),
            ...(effect ? { effect } : {}),
        };
    };
}

/**
 * [ADR-0150 D3/D5] Whether a thrown value is the package-scoped rule's refusal
 * (`PackageScopedNameRefusedError`, `409 RESOURCE_CONFLICT` with its
 * candidates) — by class, or by shape for a copy of the class from another
 * module instance. The same predicate as runtime `domains/meta.ts`.
 */
export function isPackageScopedRefusal(e: unknown): e is PackageScopedNameRefusedError {
    if (e instanceof PackageScopedNameRefusedError) return true;
    const thrown = e as { code?: unknown; refusal?: { status?: unknown } } | null | undefined;
    return thrown?.code === 'RESOURCE_CONFLICT' && thrown.refusal?.status === 'refused';
}
