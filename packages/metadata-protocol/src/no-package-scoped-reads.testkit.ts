// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0150 D3/D5, epic #31527] The package-scoped resolver slice of a
 * registry whose by-name readers consult `(package, name)` for NO type.
 *
 * A by-name read of a type ADR-0150 addresses by `(package, name)` fails
 * closed on an engine whose registry has no package-scoped resolver
 * (`refuseUnjudgeableByNameRead` in `protocol-exact-qualifier.ts`). A protocol
 * test double that pins something else spreads this into its registry: every
 * by-name read then stays the double's own `getItem`, exactly the read it
 * answered before the refusal existed, and the double says so in one place.
 *
 * `resolveItem` is consulted only for a type the registry reads by package, so
 * it throws: a double that ever reaches it has a type read by package, and
 * needs a real slice (or `SchemaRegistry`), not this one.
 */
export const NO_PACKAGE_SCOPED_READS = Object.freeze({
    readsByPackage: (_type: string): boolean => false,
    packageScopedHoldersOf: (_type: string, _name: string): string[] => [],
    getEnvironmentScopedItem: (_type: string, _name: string, _member?: string): unknown => undefined,
    getPackageScopedItem: (_type: string, _name: string, _packageId: string, _member?: string): unknown => undefined,
    resolveItem: (type: string, name: string): never => {
        throw new Error(`[test double] '${type}' '${name}': this registry reads no type by package`);
    },
});
