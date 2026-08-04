---
'@objectstack/spec': patch
---

fix(spec,runtime): `EngineSchemaRegistryView` now declares the six package-lifecycle members it always had (#4311).

`getPackage` / `installPackage` / `uninstallPackage` / `enablePackage` / `disablePackage` /
`updatePackageManifest` are additions to the exported `EngineSchemaRegistryView` type only —
`SchemaRegistry` has implemented all six since long before the contract existed, and three
packages outside the engine already call them (`runtime`'s `/packages` domain handler,
`metadata-protocol`'s install/update primitives, `service-package`'s hydration). The contract
landed in #4404 declaring eight members; these six were missed, and nothing caught it because
`@objectstack/runtime` had no `typecheck` script to read the caller. Zero runtime behaviour
change: no implementation, call site or response shape moves.

`@objectstack/runtime` itself is not released by this change — it gains a `typecheck` script and
loses its `check-type-check-coverage` DEBT entry, plus type-only annotations (unused parameters
renamed to `_`-prefixed, one unused import dropped).
