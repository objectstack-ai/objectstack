// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0150 D3/D4, epic #31527 child E5; #32071] Which declared connector
 * instance a name means, and which `mapping` a package caller's connector
 * pull reads ({@link mappingNameResolver}) — answered by the ONE
 * package-scoped resolver (`resolvePackageScopedName`, `@objectstack/objectql`),
 * never by list order.
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
    type PackageScopedHolder,
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
        return withholdDisabledHolder(registry, resolvePackageScopedName(registry, { type: 'mapping', name, callerPackageId }));
    };
}

/**
 * [#32071] The answer as the served face gives it on `main`: an item of a
 * disabled package is answered as a missing name is (#24210,
 * `isItemOfDisabledPackage` in the protocol's item face, applied AFTER
 * resolution). So the pull answers `mapping_not_found` for a disabled
 * package's mapping on the package-caller path as the no-package read does.
 *
 *  - Resolved to a package holder that is disabled (the caller's own item, or
 *    the one holder in its closure): `not-found`.
 *  - Refused `outside-closure` naming exactly one holder, a disabled package:
 *    `not-found`, as the no-package read withholds that one holder's item.
 *  - Every other refusal stands as the resolver wrote it. A disabled holder
 *    beside an enabled one in the closure still counts, as it does for the
 *    no-package read today; dropping disabled holders from the holder set is
 *    #32183's change at `packageScopedHoldersOf`, which this does not touch.
 *
 * A registry that cannot say whether a package is disabled is read as is
 * (plugin-sharing's `listedHoldersView` precedent).
 */
function withholdDisabledHolder(
    registry: PackageScopedRegistry,
    resolution: PackageScopedResolution,
): PackageScopedResolution {
    const isDisabled = (registry as { isPackageDisabled?: (id?: string) => boolean }).isPackageDisabled;
    if (typeof isDisabled !== 'function') return resolution;
    const disabled = (holder: PackageScopedHolder | undefined): boolean =>
        holder?.kind === 'package' && isDisabled.call(registry, holder.packageId) === true;
    if (resolution.status === 'resolved') {
        return disabled(resolution.holder) ? { status: 'not-found' } : resolution;
    }
    if (resolution.status === 'refused'
        && resolution.reason === 'outside-closure'
        && resolution.candidates.length === 1
        && disabled(resolution.candidates[0])) {
        return { status: 'not-found' };
    }
    return resolution;
}
