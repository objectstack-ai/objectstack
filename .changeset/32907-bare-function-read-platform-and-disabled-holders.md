---
'@objectstack/objectql': patch
'@objectstack/runtime': patch
---

fix(objectql, runtime)!: a function's bare-name read is refused naming both when the platform and a package hold the name, and answers nothing for a name only a disabled package holds (ADR-0150 D4)

Clause-②: no (narrowing) — two engine function reads that name no package stop answering: `ObjectQL#resolveFunction` / `resolveFunctionEntry` refuse `409 RESOURCE_CONFLICT`, naming both, a name the platform (an owner-less registration) and a package hold, where they answered whichever registered last or, after another holder left, nothing; and they, with `resolvePackageScopedFunction` for a caller with no package (a flow `script` node of an environment-authored flow), answer nothing for a name only a disabled package holds, where they answered its function. Nothing that was refused is now answered, and no export is added.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) no key of any schema is added, removed, renamed or re-shaped and no stored row changes shape: what moves is which engine function a read that names no package answers, so there is nothing for `objectstack migrate meta` to rewrite -->

**BREAKING** for a caller of `ObjectQL#resolveFunction` / `resolveFunctionEntry` (or a flow `script` node of an environment-authored flow) naming a function that host code or a plugin registers under no package and an installed package also registers: the call is now refused, naming both. Address the function by its package (`resolvePackageScopedFunction` with the caller's package, or a packaged flow), or rename one of the two. A caller naming a function only a disabled package registers now gets no function; enable the package to get it back.

The engine keeps every holder of a function name: each package that registered one, and the platform for a registration under no package. A read that names no package resolves it by ADR-0150 D3 over those holders.

- **The platform beside a package.** The bare read refused a name two packages hold, but counted packages only, so with the platform and one package it answered the last registration: the package's function if the package registered last, the platform's if the platform did, and nothing once a third package that registered last had left. It is now refused like two packages are, `409 RESOURCE_CONFLICT` with reason `ambiguous-in-environment`, naming the package and the platform, in every registration order. The package-scoped read with no caller package already refused it; the two reads now agree.
- **A disabled package.** A disabled package is still counted as a holder, so a name it makes ambiguous stays refused, naming it (ruling 6824698376: a disable never turns a refusal into an answer). It is no longer answered: a name only a disabled package holds answers nothing to a read that names no package, and answers again once the package is enabled. A reader naming the package itself (a flow of that package) still resolves its own function, and the hook binder's bind after the seal and the cold-boot seal still count the disabled package as a holder.
- **The runtime's re-bind** (`bindAppArtifactHandlers`, when a re-bind moves a function off a package) puts back the functions that package keeps from the package's own holder entry instead of the bare read. The bare read now refuses a name the platform holds beside the package, which would have aborted the re-bind's teardown, and answers nothing for a disabled package, which would have dropped the owner spelling the package held a kept function by.

Not changed: a name one enabled package holds, or only the platform holds, answers its function as before; a name two packages hold stays refused naming both; a reader that names its package resolves as before.
