// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0150 D3/D5, epic #31527] The package-scoped slice of a registry that
 * reads every type through its own `getItem` and holds no item of a type
 * ADR-0150 addresses by `(package, name)` in a package's slot.
 *
 * A by-name read of such a type fails closed on an engine whose registry
 * cannot judge it (`refuseUnjudgeableByNameRead` in
 * `protocol-exact-qualifier.ts`): a read naming no package needs the registry
 * to say how it reads the type (`readsByPackage`), and a read naming a package
 * or the environment needs the exact qualifier's reads. A protocol test double
 * that pins something else spreads this into its registry. It declares every
 * type read through the double's own `getItem`, as `SchemaRegistry` reads a
 * type no child of epic #31527 has wired, and no package holder of any name,
 * so the exact qualifier names no one and the read answers what the double's
 * layers answer. Nor does it hold an object-less action under two packages, so
 * the bare action read's own judge (`SchemaRegistry.refuseAmbiguousObjectLessAction`,
 * #31697) refuses nothing, and the read of that narrowed type is judged rather
 * than refused as unjudgeable.
 *
 * [#31696] `flow` is the one narrowed type `SchemaRegistry` reads by package
 * (`readsByPackage`): its bare read goes through `resolveItem`, which here is
 * the double's own `getItem` read, as the registry's resolver answers a name
 * one holder (or none) holds.
 */
export const NO_PACKAGE_SCOPED_READS = Object.freeze({
    readsByPackage: (type: string): boolean => type === 'flow',
    resolveItem(this: { getItem(type: string, name: string, packageId?: string, member?: string): unknown },
        type: string, name: string, callerPackageId?: string | null, member?: string): unknown {
        return this.getItem(type, name, callerPackageId ?? undefined, member);
    },
    packageScopedHoldersOf: (_type: string, _name: string): string[] => [],
    getEnvironmentScopedItem: (_type: string, _name: string, _member?: string): unknown => undefined,
    getPackageScopedItem: (_type: string, _name: string, _packageId: string, _member?: string): unknown => undefined,
    refuseAmbiguousObjectLessAction: async (_name: string): Promise<void> => undefined,
});
