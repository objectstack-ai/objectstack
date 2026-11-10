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
    type PackageScopedResolution,
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

/**
 * [ADR-0150 D3] The engine's reader over the one package-scoped resolver for
 * the `connector` type (`AutomationEngine.setConnectorNameResolver`): which
 * declared connector instance a bare `connectorConfig.connectorId` means for a
 * caller of package `callerPackageId` (`null`: no package).
 *
 * Resolved at QUESTION time, never at boot, like the flow reader. A
 * composition with no ObjectQL, or whose registry offers none of the
 * package-scoped reads, has no registry to ask: the answer is `undefined` and
 * `connector_action` dispatches by name as before.
 */
export function connectorNameResolver(
    ctx: { getService<T>(name: string): T },
): (name: string, callerPackageId: string | null) => PackageScopedResolution | undefined {
    return (name, callerPackageId) => {
        let registry: PackageScopedRegistry | undefined;
        try {
            registry = packageScopedRegistryOf(ctx.getService<{ registry?: unknown }>('objectql')?.registry);
        } catch {
            return undefined;
        }
        if (!registry) return undefined;
        return resolvePackageScopedName(registry, { type: 'connector', name, callerPackageId });
    };
}

/**
 * [ADR-0150 D3, #32071] The connector pull's reader of a `mapping` name for a
 * caller of package `callerPackageId` (`ConnectorSourcePullRequest
 * .callerPackageId`, which the job binder sets to the package that declares
 * the job): the package's own mapping, else the one holder in its declared
 * dependency closure plus `sys`, else a refusal naming every candidate.
 *
 * Not the protocol's `getMetaItem({ packageId })`: that is the exact
 * qualifier (ADR-0150 D5), which refuses every holder but the named package,
 * so a mapping the job's package reaches through its closure would be refused.
 * A pull that names no package keeps the protocol's read.
 *
 * Resolved at QUESTION time, like the connector reader. A composition with no
 * ObjectQL, or whose registry offers none of the package-scoped reads, has no
 * registry to ask: the answer is `undefined`, and the pull reads by no package
 * as before.
 */
export function mappingNameResolver(
    ctx: { getService<T>(name: string): T },
): (name: string, callerPackageId: string) => PackageScopedResolution | undefined {
    return (name, callerPackageId) => {
        let registry: PackageScopedRegistry | undefined;
        try {
            registry = packageScopedRegistryOf(ctx.getService<{ registry?: unknown }>('objectql')?.registry);
        } catch {
            return undefined;
        }
        if (!registry) return undefined;
        return resolvePackageScopedName(registry, { type: 'mapping', name, callerPackageId });
    };
}
