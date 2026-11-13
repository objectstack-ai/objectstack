---
'@objectstack/objectql': patch
'@objectstack/runtime': patch
---

fix(objectql, runtime): a function's bare-name record follows its holders (ADR-0150 D4)

Clause-②: yes (widening)
Metadata-protocol: none

The engine's function registry and the registry's one-holder rule each keep a record of who holds a function name, and two of those records outlived the holding:

- **A re-bind takes the old owner's bare-name claim off with the function.** The hook binder records a claim for every function a package's bind brings (`SchemaRegistry#claimBareNameFunctions`), and only `uninstallPackage` released it. When a re-bind of a multi-package artifact (`bindAppArtifactHandlers`) moved a function to another owner, or dropped the package body that held it, the old owner's claim stayed. After the cold-boot seal, a bind of that name by a package of the old owner's namespace was then refused naming a holder that no longer registers it. FROM: the gaining owner's whole group refused at bind (`NAMESPACE_CONFLICT`, logged at error; its hooks never fire and the moved function is held by nobody), and a co-owner's bind of a dropped body's function refused the same way. TO: the group binds and the function is held by its new owner; the co-owner's bind is admitted. The new `SchemaRegistry#releaseBareNameFunctions(owner, stillHolds)` releases the owner's package's claim on each function name it claims that `stillHolds` says it no longer holds, and nothing else; the binder calls it right after the engine's removal and asks the engine's holder set. So a name the package still holds under another owner spelling (its bare id) keeps its claim and is refused as before, a name an earlier bind gave it that left with the removal is released too, and every other holder's claims stay. Before the seal, a released claim is no clash for the seal to report.
- **The last remaining holder answers the bare function read.** `ObjectQL#unregisterFunctionsByPackage` deleted the bare entry of a name only when the leaving package had registered it last, and left the other holders in the holder set. FROM: two packages hold `f`, the last-registered leaves, and `resolveFunction('f')` / `resolveFunctionEntry('f')` answer nothing while `functionHoldersOf('f')` still names the other package. TO: when exactly one holder of the name remains, the bare read answers that holder's entry, a package's or the platform's (owner-less) registration. Two or more remaining holders get no pick: two packages' name stays refused (409 naming both). The platform beside one package is left as it is today: after such a leave it answers nothing. That is today's behaviour, not the rule: ADR-0150 D4 refuses a caller with no package when the platform and a package both hold the name, and #32907 aligns the bare read with it.

Unchanged: the first-registered holder leaving, a one-holder name leaving (nothing answers), an owner-less registration (it never leaves with a package), and every reader that resolves by package (`functionHoldersOf`: the flow `script` and screen nodes, the hook binder). Nothing to migrate.
