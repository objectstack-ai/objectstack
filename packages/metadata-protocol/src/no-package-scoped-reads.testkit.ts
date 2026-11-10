// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0150 D3/D5, epic #31527] The declaration of a registry whose by-name
 * readers consult `(package, name)` for NO type.
 *
 * A by-name read of a type ADR-0150 addresses by `(package, name)` fails
 * closed on an engine whose registry cannot judge it
 * (`refuseUnjudgeableByNameRead` in `protocol-exact-qualifier.ts`), and a
 * registry with no `readsByPackage` cannot say how it reads a type. A protocol
 * test double that pins something else spreads this into its registry: it
 * declares every type read through the double's own `getItem`, exactly the read
 * it answered before the refusal existed, as `SchemaRegistry` reads a type no
 * child of epic #31527 has wired. Nothing else is declared, so a reader that
 * asks the registry for its package-scoped holders still finds none to ask.
 */
export const NO_PACKAGE_SCOPED_READS = Object.freeze({
    readsByPackage: (_type: string): boolean => false,
});
