---
'@objectstack/objectql': patch
---

feat(objectql): the package-scoped resolver takes holders from a source other than the registry, and the engine keeps each function's registering package (ADR-0150 D3/D4)

Clause-②: no
Metadata-protocol: none

- **`resolvePackageScopedHolders`** runs the ADR-0150 D3 rule over a holder set the caller supplies (`PackageScopedHolderSource`: the package holders, one holder's item, the environment's own item), with the same declared closure, the same refusals and the same baseline rule as `resolvePackageScopedName`, which is now that call over the registry's holders. `packageScopedHolderSource` builds a source from `(package, item)` pairs, a `null` package being the environment's own item. `ENGINE_FUNCTION_TYPE` (`'function'`) is the one type it resolves beside `PACKAGE_SCOPED_TYPES`: a function is not a metadata type, so it resolves in the package of the flow or action that names it (ADR-0150 D4).
- **`ObjectQL#functionHoldersOf(name)`** answers every holder of a function name: each package that registered one (the owner `app:PACKAGE_ID` read as the package id), with its own entry, and an owner-less registration as the environment's own item.

Nothing changes for a running deployment: no reader calls either yet, `resolveFunction` and `resolveFunctionEntry` keep answering the one last-registered function per name, and phase 1's one-holder refusal stays in force.
