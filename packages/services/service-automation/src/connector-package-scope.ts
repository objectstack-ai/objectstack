// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0150 D3/D4, epic #31527 child E5] Which declared connector instance a
 * name means — answered by the ONE package-scoped resolver
 * (`resolvePackageScopedName`, `@objectstack/objectql`), never by list order.
 *
 * A connector is addressed by `(package, name)`. The engine keeps one live
 * instance per name, and the reconcile that materializes declared instances
 * is context-free: it reads the whole environment's declaration, so it asks
 * as a caller with no package — the environment's own item, else the unique
 * package holder, else a refusal naming every candidate. A refused name is not
 * materialized: the reconcile reports the refusal (the boot fails loudly on a
 * host-declared entry, as it does for a duplicate name) and tears down what
 * it materialized before, so no flow dispatches to one of the candidates on a
 * guess. Every other answer leaves the name to the reconcile as it stood.
 *
 * While phase 1's one-holder refusal stands (`connector` is one of its types)
 * no two packages hold a connector name, so this refuses nothing on a booted
 * deployment; it is the reader the type's trailing backstop child (ADR-0150
 * D9) narrows that refusal behind.
 *
 * A connector a plugin registers in code (`engine.registerConnector`) is no
 * registry item: the resolver answers not-found for it, and it keeps the
 * engine's own ADR-0097 §4 one-origin rule.
 */

import {
    resolvePackageScopedName,
    type PackageScopedRefusal,
    type PackageScopedRegistry,
} from '@objectstack/objectql';

/** The registry, when it carries the slice the package-scoped resolver reads. */
export function packageScopedRegistryOf(registry: unknown): PackageScopedRegistry | undefined {
    const r = registry as Partial<Record<keyof PackageScopedRegistry, unknown>> | null | undefined;
    return typeof r?.packageScopedHoldersOf === 'function'
        && typeof r.getPackageScopedItem === 'function'
        && typeof r.getEnvironmentScopedItem === 'function'
        && typeof r.getPackage === 'function'
        && typeof r.getAllPackages === 'function'
        ? (registry as PackageScopedRegistry)
        : undefined;
}

/**
 * The refusal of every declared connector name in `names` that resolves to no
 * single holder (ADR-0150 D3, a caller with no package), keyed by name. A name
 * the resolver answers — or does not hold at all — is absent.
 */
export function refusedConnectorNames(
    registry: PackageScopedRegistry,
    names: Iterable<string>,
): Map<string, PackageScopedRefusal> {
    const refused = new Map<string, PackageScopedRefusal>();
    for (const name of new Set(names)) {
        const resolved = resolvePackageScopedName(registry, { type: 'connector', name });
        if (resolved.status === 'refused') refused.set(name, resolved);
    }
    return refused;
}
