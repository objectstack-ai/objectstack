---
'@objectstack/objectql': patch
'@objectstack/metadata-protocol': patch
---

feat(objectql, metadata-protocol): one package-scoped resolver for behavioural metadata, and one declared dependency closure for it and the save door (ADR-0150 D3/D4)

Clause-②: no
Metadata-protocol: none

- **`@objectstack/objectql`** exports `resolvePackageScopedName`, the resolution rule of ADR-0150 D3 for the metadata types addressed by `(package, name)` (`PACKAGE_SCOPED_TYPES`). A caller of package P is answered P's own item, else the unique holder in P's declared dependency closure plus the `sys` packages, else a refusal that names every candidate; a caller with no package is answered the environment's own item, else the unique package holder, else the refusal. Zero holders is `not-found`. The platform-requested name `guest_portal` resolves environment-wide whatever the caller. `SchemaRegistry` gains three read-only methods the resolver reads, `packageScopedHoldersOf`, `getPackageScopedItem` and `getEnvironmentScopedItem`, which apply the per-package overlay slot (ADR-0150 D4): a stored overlay binds to the package whose item it customizes, so it never shadows another package's same-named item there.
- **`@objectstack/metadata-protocol`** exports `packageDependencyClosure`, a package's declared dependency closure (its manifest's `dependencies`, transitively, with an App's customization pair widened by the App's members). The save door's write scope now calls it, so the closure a write is judged against and the closure a name resolves in are one implementation.

Nothing changes for a running deployment: no reader calls the resolver yet, `getItem` keeps serving the bare slot first to every caller, the one-holder refusal of ADR-0048 §3.4 stays in force, and the save door admits and refuses exactly what it did.
